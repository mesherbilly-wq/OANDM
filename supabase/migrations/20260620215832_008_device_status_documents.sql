-- Extend devices with AI import fields
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS ai_confidence float,
  ADD COLUMN IF NOT EXISTS source_document text,
  ADD COLUMN IF NOT EXISTS model_name text;

-- Project documents table
CREATE TABLE IF NOT EXISTS project_documents (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now(),
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  title text NOT NULL,
  content text,
  status text NOT NULL DEFAULT 'draft',
  generated_by text DEFAULT 'ai'
);

ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_project_documents" ON project_documents
  FOR SELECT TO public USING (true);
CREATE POLICY "insert_project_documents" ON project_documents
  FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "update_project_documents" ON project_documents
  FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "delete_project_documents" ON project_documents
  FOR DELETE TO public USING (true);
