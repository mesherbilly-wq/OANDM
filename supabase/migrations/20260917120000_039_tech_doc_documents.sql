-- Named technical documents (spreadsheets) plus as-fitted scope copy of the proposed works.

CREATE TABLE IF NOT EXISTS tech_doc_documents (
  id                BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title             TEXT NOT NULL DEFAULT '',
  document_type     TEXT,
  notes             TEXT,
  system_type       TEXT,
  project_system_id BIGINT,
  file_name         TEXT,
  file_url          TEXT,
  file_size         BIGINT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tech_doc_documents_project ON tech_doc_documents(project_id);

ALTER TABLE tech_doc_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_select_tech_doc_documents" ON tech_doc_documents;
DROP POLICY IF EXISTS "public_insert_tech_doc_documents" ON tech_doc_documents;
DROP POLICY IF EXISTS "public_update_tech_doc_documents" ON tech_doc_documents;
DROP POLICY IF EXISTS "public_delete_tech_doc_documents" ON tech_doc_documents;

CREATE POLICY "public_select_tech_doc_documents" ON tech_doc_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "public_insert_tech_doc_documents" ON tech_doc_documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "public_update_tech_doc_documents" ON tech_doc_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_tech_doc_documents" ON tech_doc_documents FOR DELETE TO authenticated USING (true);

ALTER TABLE tech_doc_rows
  ADD COLUMN IF NOT EXISTS document_id BIGINT REFERENCES tech_doc_documents(id) ON DELETE CASCADE;

ALTER TABLE tech_doc_column_configs
  ADD COLUMN IF NOT EXISTS document_id BIGINT REFERENCES tech_doc_documents(id) ON DELETE CASCADE;

ALTER TABLE tech_doc_column_configs
  DROP CONSTRAINT IF EXISTS tech_doc_column_configs_project_id_system_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS tech_doc_column_configs_document_id_uidx
  ON tech_doc_column_configs (document_id)
  WHERE document_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tech_doc_column_configs_legacy_uidx
  ON tech_doc_column_configs (project_id, system_type)
  WHERE document_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tech_doc_rows_document ON tech_doc_rows(document_id);

INSERT INTO tech_doc_documents (project_id, title, document_type, system_type)
SELECT DISTINCT r.project_id,
       COALESCE(NULLIF(r.system_type, ''), 'Technical Documentation') || ' table',
       'Imported table',
       r.system_type
FROM tech_doc_rows r
WHERE r.document_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM tech_doc_documents d
    WHERE d.project_id = r.project_id
      AND COALESCE(d.system_type, '') = COALESCE(r.system_type, '')
      AND d.document_type = 'Imported table'
  );

UPDATE tech_doc_rows r
SET document_id = d.id
FROM tech_doc_documents d
WHERE r.document_id IS NULL
  AND d.project_id = r.project_id
  AND COALESCE(d.system_type, '') = COALESCE(r.system_type, '')
  AND d.document_type = 'Imported table';

UPDATE tech_doc_column_configs c
SET document_id = d.id
FROM tech_doc_documents d
WHERE c.document_id IS NULL
  AND d.project_id = c.project_id
  AND COALESCE(d.system_type, '') = COALESCE(c.system_type, '')
  AND d.document_type = 'Imported table';
