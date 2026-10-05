-- Templates belong to a system type. A project can pick which document
-- is used for each system, the same way Handover picks a document set.

ALTER TABLE completion_form_templates
  ADD COLUMN IF NOT EXISTS system_type text;

ALTER TABLE completion_form_templates
  ADD COLUMN IF NOT EXISTS source_file_name text;

UPDATE completion_form_templates
SET system_type = 'CCTV'
WHERE system_type IS NULL AND template_key = 'cctv_ncp104_completion';

CREATE TABLE IF NOT EXISTS project_completion_documents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  system_type text NOT NULL,
  template_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, system_type)
);

ALTER TABLE project_completion_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sel_project_completion_documents ON project_completion_documents;
DROP POLICY IF EXISTS wr_project_completion_documents ON project_completion_documents;

CREATE POLICY sel_project_completion_documents ON project_completion_documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY wr_project_completion_documents ON project_completion_documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
