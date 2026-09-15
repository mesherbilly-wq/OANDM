-- Intruder master form drafts, function updates, and quoted vs as-fitted items.

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
      'quote_number', coalesce(project_row.quote_number, ''),
      'engineer', coalesce(project_row.engineer, ''),
      'document_title', invite.document_title,
      'signer_name', coalesce(invite.recipient_name, ''),
      'signer_email', coalesce(invite.recipient_email, '')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_handover_form_draft(p_token text, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE handover_form_invites
  SET answers = p_answers
  WHERE token = p_token
    AND status <> 'completed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This form link is not valid or has already been completed.';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_handover_form(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_handover_form_draft(text, jsonb) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS as_fitted_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_system_id bigint,
  source_quote_line_id text,
  source_prebuild_parent_id text,
  quoted_description text,
  quoted_quantity numeric,
  installed_description text,
  actual_installed_quantity numeric,
  unit text,
  reconciliation_status text NOT NULL DEFAULT 'awaiting_verification'
    CHECK (reconciliation_status IN (
      'awaiting_verification',
      'installed_as_quoted',
      'modified',
      'omitted',
      'added_on_site',
      'existing_retained'
    )),
  change_reason text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_as_fitted_items_project
  ON as_fitted_items (project_id, created_at);

ALTER TABLE as_fitted_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_as_fitted_items" ON as_fitted_items;
DROP POLICY IF EXISTS "ins_as_fitted_items" ON as_fitted_items;
DROP POLICY IF EXISTS "upd_as_fitted_items" ON as_fitted_items;
DROP POLICY IF EXISTS "del_as_fitted_items" ON as_fitted_items;

CREATE POLICY "sel_as_fitted_items" ON as_fitted_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_as_fitted_items" ON as_fitted_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_as_fitted_items" ON as_fitted_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "del_as_fitted_items" ON as_fitted_items FOR DELETE TO authenticated USING (true);

UPDATE handover_document_definitions
SET sc_template_id = 'intruder_alarm_master'
WHERE document_id = 'handover_intruder';
