-- Configurable handover document types and template sets.

CREATE TABLE IF NOT EXISTS handover_document_types (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  key           text NOT NULL UNIQUE,
  label         text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS handover_document_definitions (
  id               bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id      text NOT NULL UNIQUE,
  type_key         text NOT NULL REFERENCES handover_document_types(key) ON UPDATE CASCADE,
  title            text NOT NULL,
  description      text,
  icon_key         text NOT NULL DEFAULT 'file',
  sc_enabled       boolean NOT NULL DEFAULT false,
  sc_template_id   text,
  field_mappings   jsonb NOT NULL DEFAULT '{}',
  required         boolean NOT NULL DEFAULT false,
  upload_only      boolean NOT NULL DEFAULT false,
  multi            boolean NOT NULL DEFAULT false,
  display_order    integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handover_document_definitions_type
  ON handover_document_definitions(type_key, display_order);

ALTER TABLE project_systems
  ADD COLUMN IF NOT EXISTS handover_document_type_key text
    REFERENCES handover_document_types(key) ON UPDATE CASCADE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS handover_project_wide_type_key text
    REFERENCES handover_document_types(key) ON UPDATE CASCADE;

ALTER TABLE handover_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_document_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_handover_document_types" ON handover_document_types;
DROP POLICY IF EXISTS "ins_handover_document_types" ON handover_document_types;
DROP POLICY IF EXISTS "upd_handover_document_types" ON handover_document_types;
DROP POLICY IF EXISTS "del_handover_document_types" ON handover_document_types;

CREATE POLICY "sel_handover_document_types" ON handover_document_types FOR SELECT TO public USING (true);
CREATE POLICY "ins_handover_document_types" ON handover_document_types FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_handover_document_types" ON handover_document_types FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_handover_document_types" ON handover_document_types FOR DELETE TO public USING (true);

DROP POLICY IF EXISTS "sel_handover_document_definitions" ON handover_document_definitions;
DROP POLICY IF EXISTS "ins_handover_document_definitions" ON handover_document_definitions;
DROP POLICY IF EXISTS "upd_handover_document_definitions" ON handover_document_definitions;
DROP POLICY IF EXISTS "del_handover_document_definitions" ON handover_document_definitions;

CREATE POLICY "sel_handover_document_definitions" ON handover_document_definitions FOR SELECT TO public USING (true);
CREATE POLICY "ins_handover_document_definitions" ON handover_document_definitions FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_handover_document_definitions" ON handover_document_definitions FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_handover_document_definitions" ON handover_document_definitions FOR DELETE TO public USING (true);

-- Document types
INSERT INTO handover_document_types (key, label, display_order) VALUES
  ('cctv',            'CCTV',            10),
  ('access_control',  'Access Control',  20),
  ('intruder_alarm',  'Intruder Alarm',  30),
  ('fire_alarm',      'Fire Alarm',      40),
  ('intercom',        'Intercom',        50),
  ('anpr',            'ANPR',            60),
  ('networking',      'Networking',      70),
  ('other',           'Other',           80),
  ('project_wide',    'Project-wide',    90)
ON CONFLICT (key) DO NOTHING;

-- CCTV
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, required, display_order)
VALUES
  ('handover_cctv', 'cctv', 'CCTV Handover Certificate', 'Signed customer acceptance for CCTV systems', 'camera', true, true, 10),
  ('cctv_commissioning_sheet', 'cctv', 'CCTV Commissioning Sheet', 'Commissioning checks and test results for CCTV', 'clipboard', true, false, 20),
  ('camera_schedule', 'cctv', 'Camera Schedule', 'Schedule of installed cameras and locations', 'file', false, false, 30),
  ('nvr_dvr_configuration', 'cctv', 'NVR/DVR Configuration', 'Recorder configuration and settings record', 'file', false, false, 40),
  ('cctv_customer_training', 'cctv', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', true, false, 50)
ON CONFLICT (document_id) DO NOTHING;

-- Access Control
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, required, display_order)
VALUES
  ('handover_ac', 'access_control', 'Access Control Handover Certificate', 'Signed customer acceptance for access control systems', 'lock', true, true, 10),
  ('ac_door_schedule', 'access_control', 'Door Schedule', 'Schedule of controlled doors and hardware', 'file', false, false, 20),
  ('ac_controller_configuration', 'access_control', 'Controller Configuration', 'Access controller configuration record', 'file', false, false, 30),
  ('ac_reader_test_sheet', 'access_control', 'Reader Test Sheet', 'Reader and door hardware test results', 'clipboard', true, false, 40),
  ('ac_customer_training', 'access_control', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', true, false, 50)
ON CONFLICT (document_id) DO NOTHING;

-- Intruder Alarm
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, required, display_order)
VALUES
  ('handover_intruder', 'intruder_alarm', 'Intruder Alarm Completion Certificate', 'Intruder alarm system completion and commissioning certificate', 'shield_alert', true, true, 10),
  ('handover_intruder_record', 'intruder_alarm', 'Intruder Record of System Checks', 'Engineer record of intruder system checks and test results', 'clipboard', true, false, 20),
  ('intruder_zone_list', 'intruder_alarm', 'Zone List', 'Configured alarm zones and descriptions', 'file', false, false, 30),
  ('intruder_bell_strobe_test', 'intruder_alarm', 'Bell/Strobe Test', 'Audible and visual alarm device test record', 'clipboard', false, false, 40),
  ('intruder_keyholder_confirmation', 'intruder_alarm', 'Keyholder Confirmation', 'Confirmed keyholder details and response plan', 'file', false, false, 50),
  ('intruder_customer_training', 'intruder_alarm', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', true, false, 60)
ON CONFLICT (document_id) DO NOTHING;

-- Fire Alarm
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, required, display_order)
VALUES
  ('fire_commissioning_certificate', 'fire_alarm', 'Fire Alarm Commissioning Certificate', 'Fire alarm commissioning and acceptance certificate', 'shield', true, true, 10),
  ('fire_cause_effect', 'fire_alarm', 'Cause & Effect', 'Fire system cause and effect matrix', 'file', false, false, 20),
  ('fire_zone_chart', 'fire_alarm', 'Zone Chart', 'Fire alarm zone layout and chart', 'file', false, false, 30),
  ('fire_detector_test_record', 'fire_alarm', 'Detector Test Record', 'Detector walk-test and functional test record', 'clipboard', true, false, 40),
  ('fire_customer_training', 'fire_alarm', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', true, false, 50)
ON CONFLICT (document_id) DO NOTHING;

-- Intercom
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, required, display_order)
VALUES
  ('handover_intercom', 'intercom', 'Intercom Handover Certificate', 'Signed customer acceptance for intercom systems', 'phone', true, true, 10),
  ('intercom_customer_training', 'intercom', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', true, false, 20)
ON CONFLICT (document_id) DO NOTHING;

-- ANPR
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, required, display_order)
VALUES
  ('handover_anpr', 'anpr', 'ANPR Handover Certificate', 'Signed customer acceptance for ANPR systems', 'car', true, true, 10),
  ('anpr_customer_training', 'anpr', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', true, false, 20)
ON CONFLICT (document_id) DO NOTHING;

-- Networking
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, required, display_order)
VALUES
  ('handover_networking', 'networking', 'Networking Handover Certificate', 'Signed customer acceptance for networking infrastructure', 'network', true, true, 10),
  ('networking_customer_training', 'networking', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', true, false, 20)
ON CONFLICT (document_id) DO NOTHING;

-- Other
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, required, display_order)
VALUES
  ('other_handover_certificate', 'other', 'System Handover Certificate', 'Signed customer acceptance certificate', 'award', true, true, 10),
  ('other_customer_training', 'other', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', true, false, 20)
ON CONFLICT (document_id) DO NOTHING;

-- Project-wide
INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, upload_only, multi, required, display_order)
VALUES
  ('handover_acceptance', 'project_wide', 'System Acceptance Certificate', 'Overall project acceptance signed by customer', 'award', true, false, false, true, 10),
  ('handover_training', 'project_wide', 'Training Record', 'Signed training record for customer staff', 'graduation', true, false, false, false, 20),
  ('nsi_certificate', 'project_wide', 'NSI Certificate', 'NSI or certification body approval certificate', 'shield', false, true, false, false, 30),
  ('rams', 'project_wide', 'RAMS', 'Risk Assessment and Method Statements', 'hardhat', false, true, true, false, 40)
ON CONFLICT (document_id) DO NOTHING;

COMMENT ON TABLE handover_document_types IS
  'Taxonomy for handover document sets (CCTV, Access Control, Project-wide, etc.).';
COMMENT ON TABLE handover_document_definitions IS
  'Configurable handover document cards per type. document_id matches project_handover_docs.document_type for backwards compatibility.';
COMMENT ON COLUMN project_systems.handover_document_type_key IS
  'Selected handover document type for this install section / cost centre.';
COMMENT ON COLUMN projects.handover_project_wide_type_key IS
  'Selected handover document type for the Project-wide tab (defaults to project_wide).';
