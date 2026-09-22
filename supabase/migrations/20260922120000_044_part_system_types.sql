-- Remember the install system type staff pick for a part during import,
-- so the next import can auto-populate CCTV / Access Control / Intruder / Fire.

CREATE TABLE IF NOT EXISTS part_system_types (
  part_key     text PRIMARY KEY,
  part_number  text NOT NULL,
  manufacturer text,
  system_type  text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE part_system_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_part_system_types" ON part_system_types;
DROP POLICY IF EXISTS "ins_part_system_types" ON part_system_types;
DROP POLICY IF EXISTS "upd_part_system_types" ON part_system_types;
DROP POLICY IF EXISTS "del_part_system_types" ON part_system_types;

CREATE POLICY "sel_part_system_types" ON part_system_types FOR SELECT TO public USING (true);
CREATE POLICY "ins_part_system_types" ON part_system_types FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_part_system_types" ON part_system_types FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_part_system_types" ON part_system_types FOR DELETE TO public USING (true);
