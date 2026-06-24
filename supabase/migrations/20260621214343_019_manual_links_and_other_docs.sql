-- Make file_name and file_url nullable in user_manuals (to support link-only manuals)
ALTER TABLE user_manuals ALTER COLUMN file_name DROP NOT NULL;
ALTER TABLE user_manuals ALTER COLUMN file_url DROP NOT NULL;
ALTER TABLE user_manuals ADD COLUMN IF NOT EXISTS link_url TEXT;

-- Other handover documents (upload or URL link, with title + description)
CREATE TABLE handover_other_docs (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT,
  file_url TEXT,
  link_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE handover_other_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_handover_other_docs" ON handover_other_docs FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_handover_other_docs" ON handover_other_docs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_handover_other_docs" ON handover_other_docs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_handover_other_docs" ON handover_other_docs FOR DELETE TO authenticated USING (true);
