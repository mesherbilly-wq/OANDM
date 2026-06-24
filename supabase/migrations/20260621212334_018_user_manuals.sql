CREATE TABLE user_manuals (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  manufacturer TEXT,
  model_number TEXT,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_manuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_user_manuals" ON user_manuals FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_user_manuals" ON user_manuals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_user_manuals" ON user_manuals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_user_manuals" ON user_manuals FOR DELETE TO authenticated USING (true);

CREATE TABLE project_user_manuals (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  manual_id BIGINT NOT NULL REFERENCES user_manuals(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, manual_id)
);

ALTER TABLE project_user_manuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_project_user_manuals" ON project_user_manuals FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert_project_user_manuals" ON project_user_manuals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "update_project_user_manuals" ON project_user_manuals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_project_user_manuals" ON project_user_manuals FOR DELETE TO authenticated USING (true);
