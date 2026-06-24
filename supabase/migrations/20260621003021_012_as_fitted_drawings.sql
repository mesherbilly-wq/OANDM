CREATE TABLE IF NOT EXISTS as_fitted_drawings (
  id          bigserial PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',
  drawing_number text,
  revision    text,
  file_name   text NOT NULL,
  file_url    text NOT NULL,
  file_size   bigint,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE as_fitted_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_as_fitted" ON as_fitted_drawings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_as_fitted" ON as_fitted_drawings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_as_fitted" ON as_fitted_drawings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_as_fitted" ON as_fitted_drawings FOR DELETE TO anon, authenticated USING (true);
