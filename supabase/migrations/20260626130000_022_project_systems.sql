-- First-class project systems (install sections / cost centres).
-- Devices link via project_system_id; devices.system_type remains for backwards compatibility.
-- Safe to rerun: uses IF NOT EXISTS, DROP POLICY IF EXISTS, NOT EXISTS on insert,
-- and project_system_id IS NULL on update.
-- Orphan devices (project_id not in projects) are skipped entirely.

CREATE TABLE IF NOT EXISTS project_systems (
  id               bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  project_id       bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  system_name      text NOT NULL,
  system_category  text,
  source_type      text,
  source_reference text,
  notes            text,
  display_order    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_systems_category_check CHECK (
    system_category IS NULL OR system_category IN (
      'Security',
      'Fire',
      'Electrical',
      'Mechanical',
      'HVAC',
      'Plumbing',
      'Audio Visual',
      'IT',
      'Building Fabric',
      'Other'
    )
  ),
  CONSTRAINT project_systems_project_name_unique UNIQUE (project_id, system_name)
);

CREATE INDEX IF NOT EXISTS idx_project_systems_project
  ON project_systems(project_id);

ALTER TABLE project_systems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_project_systems" ON project_systems;
DROP POLICY IF EXISTS "ins_project_systems" ON project_systems;
DROP POLICY IF EXISTS "upd_project_systems" ON project_systems;
DROP POLICY IF EXISTS "del_project_systems" ON project_systems;

CREATE POLICY "sel_project_systems" ON project_systems FOR SELECT TO public USING (true);
CREATE POLICY "ins_project_systems" ON project_systems FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_project_systems" ON project_systems FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_project_systems" ON project_systems FOR DELETE TO public USING (true);

COMMENT ON TABLE project_systems IS
  'Install sections within a project. Trade category is for icons/reporting only; hierarchy is system_name.';

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS project_system_id bigint
    REFERENCES project_systems(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devices_project_system
  ON devices(project_id, project_system_id);

COMMENT ON COLUMN devices.project_system_id IS
  'FK to project_systems. NULL on legacy rows until backfill. system_type kept as denormalized cache.';

-- Backfill one project_system row per distinct (project_id, system_type).
-- Only devices whose project_id exists in projects (orphans skipped).
INSERT INTO project_systems (
  project_id,
  system_name,
  system_category,
  source_type,
  display_order,
  created_at,
  updated_at
)
WITH device_systems AS (
  SELECT
    d.project_id,
    COALESCE(NULLIF(trim(d.system_type), ''), 'Unnamed System') AS system_name,
    d.system_category
  FROM devices d
  INNER JOIN projects p ON p.id = d.project_id
  WHERE d.project_id IS NOT NULL
),
distinct_groups AS (
  SELECT DISTINCT project_id, system_name
  FROM device_systems
),
grouped AS (
  SELECT
    dg.project_id,
    dg.system_name,
    (
      SELECT ds.system_category
      FROM device_systems ds
      WHERE ds.project_id = dg.project_id
        AND ds.system_name = dg.system_name
        AND ds.system_category IS NOT NULL
      LIMIT 1
    ) AS system_category,
    row_number() OVER (
      PARTITION BY dg.project_id
      ORDER BY dg.system_name
    )::integer AS display_order
  FROM distinct_groups dg
)
SELECT
  grouped.project_id,
  grouped.system_name,
  grouped.system_category,
  'legacy',
  grouped.display_order,
  now(),
  now()
FROM grouped
WHERE NOT EXISTS (
  SELECT 1
  FROM project_systems ps
  WHERE ps.project_id = grouped.project_id
    AND ps.system_name = grouped.system_name
);

-- Link devices to backfilled systems (valid projects only; skip already linked).
UPDATE devices d
SET project_system_id = ps.id
FROM project_systems ps
WHERE d.project_id = ps.project_id
  AND COALESCE(NULLIF(trim(d.system_type), ''), 'Unnamed System') = ps.system_name
  AND d.project_system_id IS NULL
  AND EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id);
