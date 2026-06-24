-- ── Projects: extended fields ──────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS site_address   text,
  ADD COLUMN IF NOT EXISTS quote_number   text,
  ADD COLUMN IF NOT EXISTS project_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS project_notes  text;

-- ── Project team members ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_team (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now(),
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       text NOT NULL,   -- 'project_manager','engineer','surveyor','other'
  name       text NOT NULL,
  email      text,
  phone      text
);
ALTER TABLE project_team ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sel_project_team"  ON project_team FOR SELECT TO public USING (true);
CREATE POLICY "ins_project_team"  ON project_team FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_project_team"  ON project_team FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_project_team"  ON project_team FOR DELETE TO public USING (true);

-- ── Project revision history ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_revisions (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  project_id      bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_number text,
  description     text,
  revised_by      text,
  revised_at      date
);
ALTER TABLE project_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sel_project_revisions" ON project_revisions FOR SELECT TO public USING (true);
CREATE POLICY "ins_project_revisions" ON project_revisions FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_project_revisions" ON project_revisions FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_project_revisions" ON project_revisions FOR DELETE TO public USING (true);

-- ── Devices: hierarchy + technical fields ───────────────────────────────────────
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS parent_device_id  bigint REFERENCES devices(id),
  ADD COLUMN IF NOT EXISTS component_type    text,
  ADD COLUMN IF NOT EXISTS is_component      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mac_address       text,
  ADD COLUMN IF NOT EXISTS firmware_version  text,
  ADD COLUMN IF NOT EXISTS username_hint     text,
  ADD COLUMN IF NOT EXISTS password_hint     text,
  ADD COLUMN IF NOT EXISTS controller_address text,
  ADD COLUMN IF NOT EXISTS reader_address    text,
  ADD COLUMN IF NOT EXISTS network_zone      text,
  ADD COLUMN IF NOT EXISTS vlan              text,
  ADD COLUMN IF NOT EXISTS port_number       text,
  ADD COLUMN IF NOT EXISTS retention_days    integer,
  ADD COLUMN IF NOT EXISTS sort_order        integer NOT NULL DEFAULT 0;

-- ── Product models: extended fields ────────────────────────────────────────────
ALTER TABLE product_models
  ADD COLUMN IF NOT EXISTS product_family    text,
  ADD COLUMN IF NOT EXISTS part_number       text,
  ADD COLUMN IF NOT EXISTS category          text,
  ADD COLUMN IF NOT EXISTS product_image_url text,
  ADD COLUMN IF NOT EXISTS warranty_info     text,
  ADD COLUMN IF NOT EXISTS is_component      boolean NOT NULL DEFAULT false;

-- ── Commissioning records ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commissioning_records (
  id               bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  project_id       bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  system_type      text NOT NULL,
  section          text,
  test_description text NOT NULL,
  expected_result  text,
  actual_result    text,
  pass             boolean,
  engineer_name    text,
  test_date        date,
  notes            text,
  sort_order       integer NOT NULL DEFAULT 0
);
ALTER TABLE commissioning_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sel_commissioning" ON commissioning_records FOR SELECT TO public USING (true);
CREATE POLICY "ins_commissioning" ON commissioning_records FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_commissioning" ON commissioning_records FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_commissioning" ON commissioning_records FOR DELETE TO public USING (true);

-- ── Handover documents ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS handover_documents (
  id             bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  project_id     bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_type  text NOT NULL,
  title          text NOT NULL,
  content        text,
  status         text NOT NULL DEFAULT 'draft',
  signed_by      text,
  signed_at      timestamptz,
  customer_name  text
);
ALTER TABLE handover_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sel_handover" ON handover_documents FOR SELECT TO public USING (true);
CREATE POLICY "ins_handover" ON handover_documents FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_handover" ON handover_documents FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_handover" ON handover_documents FOR DELETE TO public USING (true);
