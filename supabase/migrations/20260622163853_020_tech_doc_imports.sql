-- Technical documentation: imported rows per system per project
CREATE TABLE tech_doc_rows (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  system_type TEXT NOT NULL,
  row_index  INT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Column configuration per system per project
CREATE TABLE tech_doc_column_configs (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  system_type TEXT NOT NULL,
  columns     JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, system_type)
);

CREATE INDEX idx_tech_doc_rows_project_system ON tech_doc_rows(project_id, system_type);
CREATE INDEX idx_tech_doc_column_configs_project ON tech_doc_column_configs(project_id);

ALTER TABLE tech_doc_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_doc_column_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_select_tech_doc_rows"    ON tech_doc_rows FOR SELECT    TO authenticated USING (true);
CREATE POLICY "public_insert_tech_doc_rows"    ON tech_doc_rows FOR INSERT    TO authenticated WITH CHECK (true);
CREATE POLICY "public_update_tech_doc_rows"    ON tech_doc_rows FOR UPDATE    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_tech_doc_rows"    ON tech_doc_rows FOR DELETE    TO authenticated USING (true);

CREATE POLICY "public_select_tech_doc_col_cfg" ON tech_doc_column_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "public_insert_tech_doc_col_cfg" ON tech_doc_column_configs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "public_update_tech_doc_col_cfg" ON tech_doc_column_configs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_tech_doc_col_cfg" ON tech_doc_column_configs FOR DELETE TO authenticated USING (true);
