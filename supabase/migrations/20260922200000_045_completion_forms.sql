-- Versioned CCTV completion / handover forms with engineer and customer links.
-- Office staff use authenticated table access. Public links go through RPCs / the
-- completion-forms function. Photos sit in a private bucket.

CREATE TABLE IF NOT EXISTS completion_form_templates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_key text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'published',
  schema jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (template_key, version)
);

CREATE TABLE IF NOT EXISTS completion_forms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id bigint REFERENCES completion_form_templates(id),
  template_key text NOT NULL,
  template_version integer NOT NULL,
  title text NOT NULL,
  schema_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  assigned_name text,
  assigned_email text,
  assigned_company text,
  issued_at timestamptz,
  expires_at timestamptz,
  opened_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  current_revision_no integer NOT NULL DEFAULT 1,
  pdf_url text,
  pdf_file_name text,
  pdf_storage_path text,
  review_note text,
  outstanding_handover_authorised boolean NOT NULL DEFAULT false,
  simpro_attach_status text,
  simpro_attach_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS completion_form_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id bigint NOT NULL REFERENCES completion_forms(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked boolean NOT NULL DEFAULT false,
  engineer_signature jsonb,
  customer_signature jsonb,
  engineer_signed_at timestamptz,
  customer_signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, revision_no)
);

CREATE TABLE IF NOT EXISTS completion_form_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id bigint NOT NULL REFERENCES completion_forms(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  role text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS completion_form_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id bigint NOT NULL REFERENCES completion_forms(id) ON DELETE CASCADE,
  revision_no integer NOT NULL DEFAULT 1,
  field_path text NOT NULL,
  file_name text NOT NULL,
  caption text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT 'image/jpeg',
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS completion_form_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id bigint NOT NULL REFERENCES completion_forms(id) ON DELETE CASCADE,
  revision_no integer,
  event_type text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_completion_forms_project ON completion_forms (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_completion_form_tokens_form ON completion_form_tokens (form_id, role);
CREATE INDEX IF NOT EXISTS idx_completion_form_assets_form ON completion_form_assets (form_id, revision_no);

ALTER TABLE completion_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE completion_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE completion_form_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE completion_form_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE completion_form_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE completion_form_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_completion_form_templates ON completion_form_templates;
DROP POLICY IF EXISTS wr_completion_form_templates ON completion_form_templates;
DROP POLICY IF EXISTS sel_completion_forms ON completion_forms;
DROP POLICY IF EXISTS wr_completion_forms ON completion_forms;
DROP POLICY IF EXISTS sel_completion_form_revisions ON completion_form_revisions;
DROP POLICY IF EXISTS wr_completion_form_revisions ON completion_form_revisions;
DROP POLICY IF EXISTS sel_completion_form_tokens ON completion_form_tokens;
DROP POLICY IF EXISTS wr_completion_form_tokens ON completion_form_tokens;
DROP POLICY IF EXISTS sel_completion_form_assets ON completion_form_assets;
DROP POLICY IF EXISTS wr_completion_form_assets ON completion_form_assets;
DROP POLICY IF EXISTS sel_completion_form_events ON completion_form_events;
DROP POLICY IF EXISTS wr_completion_form_events ON completion_form_events;

CREATE POLICY sel_completion_form_templates ON completion_form_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY wr_completion_form_templates ON completion_form_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY sel_completion_forms ON completion_forms FOR SELECT TO authenticated USING (true);
CREATE POLICY wr_completion_forms ON completion_forms FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY sel_completion_form_revisions ON completion_form_revisions FOR SELECT TO authenticated USING (true);
CREATE POLICY wr_completion_form_revisions ON completion_form_revisions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY sel_completion_form_tokens ON completion_form_tokens FOR SELECT TO authenticated USING (true);
CREATE POLICY wr_completion_form_tokens ON completion_form_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY sel_completion_form_assets ON completion_form_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY wr_completion_form_assets ON completion_form_assets FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY sel_completion_form_events ON completion_form_events FOR SELECT TO authenticated USING (true);
CREATE POLICY wr_completion_form_events ON completion_form_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('completion-form-files', 'completion-form-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS sel_completion_form_files ON storage.objects;
DROP POLICY IF EXISTS wr_completion_form_files ON storage.objects;

CREATE POLICY sel_completion_form_files ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'completion-form-files');

CREATE POLICY wr_completion_form_files ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'completion-form-files')
  WITH CHECK (bucket_id = 'completion-form-files');
