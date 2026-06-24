CREATE TABLE IF NOT EXISTS integration_settings (
  id         bigserial PRIMARY KEY,
  key        text UNIQUE NOT NULL,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE integration_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_integration_settings" ON integration_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_integration_settings" ON integration_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_integration_settings" ON integration_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_integration_settings" ON integration_settings FOR DELETE TO anon, authenticated USING (true);
