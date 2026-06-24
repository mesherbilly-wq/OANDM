-- Handover & commissioning document tracking with SC integration
CREATE TABLE IF NOT EXISTS project_handover_docs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz DEFAULT now(),
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  title text NOT NULL,
  system_type text,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','completed','imported','uploaded')),
  -- SafetyCulture linkage
  sc_inspection_id text,
  sc_template_id text,
  sc_inspection_name text,
  sc_result text,
  sc_score_pct numeric,
  sc_engineer_name text,
  sc_completion_date timestamptz,
  sc_imported_at timestamptz,
  -- Upload linkage
  file_name text,
  file_url text,
  -- Metadata
  notes text,
  UNIQUE(project_id, document_type)
);

ALTER TABLE project_handover_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_handover_docs" ON project_handover_docs FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE projects.id = project_handover_docs.project_id)
  );
CREATE POLICY "insert_own_handover_docs" ON project_handover_docs FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE projects.id = project_handover_docs.project_id)
  );
CREATE POLICY "update_own_handover_docs" ON project_handover_docs FOR UPDATE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE projects.id = project_handover_docs.project_id)
  ) WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE projects.id = project_handover_docs.project_id)
  );
CREATE POLICY "delete_own_handover_docs" ON project_handover_docs FOR DELETE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE projects.id = project_handover_docs.project_id)
  );
