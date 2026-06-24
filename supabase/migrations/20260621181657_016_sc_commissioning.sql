-- ── Job number on projects ────────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS job_number text;

-- ── SafetyCulture template field mappings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_template_mappings (
  id                   bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at           timestamptz NOT NULL DEFAULT now(),
  template_id          text NOT NULL UNIQUE,
  template_name        text,
  -- Maps project/device field names → SC item_id values
  -- e.g. { "job_number": "item_abc", "device_name": "item_xyz" }
  field_mappings       jsonb NOT NULL DEFAULT '{}',
  -- Maps table column data fields → SC table column field_ids
  table_column_mappings jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE sc_template_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sel_sc_template_mappings" ON sc_template_mappings FOR SELECT TO public USING (true);
CREATE POLICY "ins_sc_template_mappings" ON sc_template_mappings FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_sc_template_mappings" ON sc_template_mappings FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_sc_template_mappings" ON sc_template_mappings FOR DELETE TO public USING (true);

-- ── SafetyCulture created inspections ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_inspections (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  project_id      bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id     text NOT NULL,
  template_name   text,
  inspection_id   text NOT NULL,           -- SC's insp_xxx identifier
  inspection_name text,
  method          text NOT NULL DEFAULT 'per_device', -- 'per_device' | 'per_system'
  system_type     text,
  device_ids      jsonb DEFAULT '[]',      -- array of device ids included
  device_id       bigint REFERENCES devices(id) ON DELETE SET NULL,
  device_name     text,
  status          text NOT NULL DEFAULT 'created', -- 'created','in_progress','completed'
  result          text,                    -- 'pass' | 'fail'
  score_pct       numeric,
  engineer_name   text,
  completion_date text,
  notes           text,
  pdf_url         text,
  imported_at     timestamptz
);
ALTER TABLE sc_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sel_sc_inspections" ON sc_inspections FOR SELECT TO public USING (true);
CREATE POLICY "ins_sc_inspections" ON sc_inspections FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_sc_inspections" ON sc_inspections FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_sc_inspections" ON sc_inspections FOR DELETE TO public USING (true);

-- Index for fast project lookups
CREATE INDEX IF NOT EXISTS sc_inspections_project_idx ON sc_inspections(project_id);
