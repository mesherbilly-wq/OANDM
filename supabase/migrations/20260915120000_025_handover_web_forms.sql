-- Browser handover forms: emailable fill-and-sign links saved into project documents.

CREATE TABLE IF NOT EXISTS handover_form_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id text NOT NULL,
  document_title text NOT NULL,
  form_template_key text NOT NULL,
  recipient_email text,
  recipient_name text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'completed', 'cancelled')),
  prefill jsonb NOT NULL DEFAULT '{}'::jsonb,
  answers jsonb,
  signer_name text,
  signature_path text,
  handover_doc_id bigint,
  system_type text,
  project_system_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_handover_form_invites_project
  ON handover_form_invites (project_id, document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_handover_form_invites_token
  ON handover_form_invites (token);

ALTER TABLE handover_form_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_handover_form_invites" ON handover_form_invites;
DROP POLICY IF EXISTS "ins_handover_form_invites" ON handover_form_invites;
DROP POLICY IF EXISTS "upd_handover_form_invites" ON handover_form_invites;

CREATE POLICY "sel_handover_form_invites" ON handover_form_invites
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_handover_form_invites" ON handover_form_invites
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_handover_form_invites" ON handover_form_invites
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_handover_form(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite handover_form_invites%ROWTYPE;
  project_row projects%ROWTYPE;
  company text;
BEGIN
  SELECT * INTO invite FROM handover_form_invites WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This form link is not valid.';
  END IF;

  SELECT * INTO project_row FROM projects WHERE id = invite.project_id;
  SELECT company_name INTO company FROM contractor_profile LIMIT 1;

  RETURN jsonb_build_object(
    'token', invite.token,
    'status', invite.status,
    'document_title', invite.document_title,
    'form_template_key', invite.form_template_key,
    'company_name', company,
    'recipient_name', invite.recipient_name,
    'recipient_email', invite.recipient_email,
    'prefill', coalesce(invite.prefill, '{}'::jsonb) || jsonb_build_object(
      'job_number', coalesce(project_row.job_number, ''),
      'project_name', coalesce(project_row.project_name, ''),
      'client_name', coalesce(project_row.client_name, ''),
      'site_name', coalesce(project_row.site_name, ''),
      'site_address', coalesce(project_row.site_address, ''),
      'project_manager', coalesce(project_row.project_manager, ''),
      'document_title', invite.document_title,
      'signer_name', coalesce(invite.recipient_name, ''),
      'signer_email', coalesce(invite.recipient_email, '')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_handover_form(
  p_token text,
  p_answers jsonb,
  p_signer_name text,
  p_file_name text,
  p_file_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite handover_form_invites%ROWTYPE;
  doc_id bigint;
BEGIN
  SELECT * INTO invite FROM handover_form_invites WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This form link is not valid.';
  END IF;
  IF invite.status = 'completed' THEN
    RAISE EXCEPTION 'This form has already been completed.';
  END IF;

  UPDATE project_handover_docs
  SET status = 'completed',
      sc_inspection_id = invite.token,
      sc_template_id = invite.form_template_key,
      sc_inspection_name = invite.document_title || ' — signed form',
      sc_result = 'pass',
      sc_engineer_name = p_signer_name,
      sc_completion_date = now(),
      sc_imported_at = now(),
      file_name = p_file_name,
      file_url = p_file_url,
      title = invite.document_title,
      project_system_id = coalesce(invite.project_system_id, project_handover_docs.project_system_id)
  WHERE project_id = invite.project_id
    AND document_type = invite.document_id
    AND system_type IS NOT DISTINCT FROM invite.system_type
  RETURNING id INTO doc_id;

  IF doc_id IS NULL THEN
    INSERT INTO project_handover_docs (
      project_id, document_type, title, status,
      sc_inspection_id, sc_template_id, sc_inspection_name,
      sc_result, sc_engineer_name, sc_completion_date, sc_imported_at,
      file_name, file_url, system_type, project_system_id
    ) VALUES (
      invite.project_id, invite.document_id, invite.document_title, 'completed',
      invite.token, invite.form_template_key, invite.document_title || ' — signed form',
      'pass', p_signer_name, now(), now(),
      p_file_name, p_file_url, invite.system_type, invite.project_system_id
    )
    RETURNING id INTO doc_id;
  END IF;

  UPDATE handover_form_invites
  SET status = 'completed',
      answers = p_answers,
      signer_name = p_signer_name,
      completed_at = now(),
      handover_doc_id = doc_id
  WHERE id = invite.id;

  RETURN jsonb_build_object('ok', true, 'file_url', p_file_url);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_handover_form(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_handover_form(text, jsonb, text, text, text) TO anon, authenticated;

-- Default web-form templates for existing document types that previously used SafetyCulture.
UPDATE handover_document_definitions
SET sc_template_id = CASE
  WHEN title ILIKE '%train%' THEN 'training_record'
  WHEN title ILIKE '%keyholder%' THEN 'keyholder_confirmation'
  WHEN title ILIKE '%commissioning sheet%' OR title ILIKE '%system checks%' THEN 'commissioning_sheet'
  WHEN title ILIKE '%test%' THEN 'test_record'
  ELSE 'handover_certificate'
END
WHERE sc_enabled = true
  AND upload_only = false
  AND (sc_template_id IS NULL OR sc_template_id NOT IN (
    'handover_certificate', 'training_record', 'commissioning_sheet', 'test_record', 'keyholder_confirmation'
  ));
