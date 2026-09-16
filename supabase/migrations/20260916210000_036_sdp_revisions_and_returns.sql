-- SDP revisions, email outbox, document return tokens and workflow status.

CREATE TABLE IF NOT EXISTS sdp_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('proposed', 'as_fitted')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'issued', 'returned', 'needs_correction', 'technically_reviewed', 'finalised'
  )),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot jsonb,
  signed_pdf_url text,
  engineer_signed_at timestamptz,
  customer_signed_at timestamptz,
  parent_revision_id bigint REFERENCES sdp_revisions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision_no)
);

ALTER TABLE sdp_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sdp_revisions_authenticated ON sdp_revisions
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS email_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'development',
  recipient text,
  subject text,
  body text,
  meta jsonb,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_outbox_authenticated ON email_outbox
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS document_return_tokens (
  token text PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id text NOT NULL,
  revision_no integer,
  form_token text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_return_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_return_tokens_authenticated ON document_return_tokens
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE project_handover_docs
  ADD COLUMN IF NOT EXISTS workflow_status text,
  ADD COLUMN IF NOT EXISTS revision_no integer,
  ADD COLUMN IF NOT EXISTS extraction_json jsonb,
  ADD COLUMN IF NOT EXISTS extraction_flag text;

INSERT INTO integration_settings (key, value)
VALUES
  ('email_provider', 'development'),
  ('email_from', '')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION get_document_return(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec document_return_tokens%ROWTYPE;
BEGIN
  SELECT * INTO rec FROM document_return_tokens WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return link is not valid';
  END IF;
  RETURN json_build_object(
    'token', rec.token,
    'project_id', rec.project_id,
    'document_id', rec.document_id,
    'revision_no', rec.revision_no,
    'status', rec.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_document_return(
  p_token text,
  p_file_name text,
  p_file_url text,
  p_extraction jsonb DEFAULT NULL,
  p_flag text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec document_return_tokens%ROWTYPE;
  current_rev integer;
BEGIN
  SELECT * INTO rec FROM document_return_tokens WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return link is not valid';
  END IF;

  IF rec.status = 'received' THEN
    RETURN json_build_object('ok', true, 'duplicate', true, 'file_url', p_file_url);
  END IF;

  SELECT revision_no INTO current_rev
  FROM project_handover_docs
  WHERE project_id = rec.project_id
    AND document_type = rec.document_id
  LIMIT 1;

  IF rec.revision_no IS NOT NULL AND current_rev IS NOT NULL AND rec.revision_no < current_rev THEN
    UPDATE document_return_tokens SET status = 'superseded' WHERE token = p_token;
    INSERT INTO project_handover_docs (
      project_id, document_type, title, status, workflow_status, revision_no, file_name, file_url, extraction_json, extraction_flag
    ) VALUES (
      rec.project_id, rec.document_id || '_older_rev_' || rec.revision_no, rec.document_id || ' older revision',
      'uploaded', 'returned', rec.revision_no, p_file_name, p_file_url, p_extraction, coalesce(p_flag, 'older_revision')
    )
    ON CONFLICT DO NOTHING;
    RETURN json_build_object('ok', true, 'older_revision', true, 'file_url', p_file_url);
  END IF;

  UPDATE document_return_tokens SET status = 'received' WHERE token = p_token;

  UPDATE project_handover_docs
  SET
    status = 'completed',
    workflow_status = CASE WHEN p_flag IS NULL THEN 'returned' ELSE 'needs_correction' END,
    revision_no = coalesce(rec.revision_no, project_handover_docs.revision_no),
    file_name = p_file_name,
    file_url = p_file_url,
    extraction_json = p_extraction,
    extraction_flag = p_flag,
    sc_imported_at = now()
  WHERE project_id = rec.project_id
    AND document_type = rec.document_id;

  IF rec.document_id = 'sdp' AND rec.revision_no IS NOT NULL THEN
    UPDATE sdp_revisions
    SET
      status = CASE WHEN p_flag IS NULL THEN 'returned' ELSE 'needs_correction' END,
      signed_pdf_url = p_file_url,
      updated_at = now()
    WHERE project_id = rec.project_id
      AND revision_no = rec.revision_no;
  END IF;

  RETURN json_build_object('ok', true, 'duplicate', false, 'file_url', p_file_url);
END;
$$;

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
    'answers', invite.answers,
    'prefill', coalesce(invite.prefill, '{}'::jsonb) || jsonb_build_object(
      'job_number', coalesce(project_row.job_number, ''),
      'project_name', coalesce(project_row.project_name, ''),
      'client_name', coalesce(project_row.client_name, ''),
      'site_name', coalesce(project_row.site_name, ''),
      'site_address', coalesce(project_row.site_address, ''),
      'project_manager', coalesce(project_row.project_manager, ''),
      'engineer', coalesce(project_row.engineer, ''),
      'quote_number', coalesce(project_row.quote_number, ''),
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
      workflow_status = 'returned',
      sc_inspection_id = invite.token,
      sc_template_id = invite.form_template_key,
      sc_inspection_name = invite.document_title || ' — signed form',
      sc_result = 'pass',
      sc_engineer_name = p_signer_name,
      sc_completion_date = now(),
      sc_imported_at = now(),
      file_name = p_file_name,
      file_url = p_file_url,
      extraction_json = p_answers,
      title = invite.document_title,
      project_system_id = coalesce(invite.project_system_id, project_handover_docs.project_system_id)
  WHERE project_id = invite.project_id
    AND document_type = invite.document_id
    AND system_type IS NOT DISTINCT FROM invite.system_type
  RETURNING id INTO doc_id;

  IF doc_id IS NULL THEN
    INSERT INTO project_handover_docs (
      project_id, document_type, title, status, workflow_status,
      sc_inspection_id, sc_template_id, sc_inspection_name,
      sc_result, sc_engineer_name, sc_completion_date, sc_imported_at,
      file_name, file_url, extraction_json, system_type, project_system_id
    ) VALUES (
      invite.project_id, invite.document_id, invite.document_title, 'completed', 'returned',
      invite.token, invite.form_template_key, invite.document_title || ' — signed form',
      'pass', p_signer_name, now(), now(),
      p_file_name, p_file_url, p_answers, invite.system_type, invite.project_system_id
    )
    RETURNING id INTO doc_id;
  END IF;

  IF invite.document_id = 'sdp' THEN
    UPDATE sdp_revisions
    SET
      status = 'returned',
      answers = coalesce(p_answers, answers),
      signed_pdf_url = p_file_url,
      updated_at = now()
    WHERE project_id = invite.project_id
      AND revision_no = (
        SELECT coalesce(max(revision_no), 1) FROM sdp_revisions WHERE project_id = invite.project_id
      );
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

GRANT EXECUTE ON FUNCTION get_document_return(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_document_return(text, text, text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_handover_form(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_handover_form(text, jsonb, text, text, text) TO anon, authenticated;

