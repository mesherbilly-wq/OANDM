CREATE TABLE IF NOT EXISTS project_source_docs (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  system_type text,
  file_name   text,
  file_url    text NOT NULL,
  media_type  text NOT NULL DEFAULT 'application/pdf'
);

ALTER TABLE project_source_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_project_source_docs" ON project_source_docs
  FOR SELECT TO public USING (true);
CREATE POLICY "insert_project_source_docs" ON project_source_docs
  FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "update_project_source_docs" ON project_source_docs
  FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "delete_project_source_docs" ON project_source_docs
  FOR DELETE TO public USING (true);
