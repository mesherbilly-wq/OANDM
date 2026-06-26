-- Link O&M documents to project systems (cost centres).

ALTER TABLE as_fitted_drawings
  ADD COLUMN IF NOT EXISTS system_type text,
  ADD COLUMN IF NOT EXISTS project_system_id bigint
    REFERENCES project_systems(id) ON DELETE SET NULL;

ALTER TABLE om_pack_uploads
  ADD COLUMN IF NOT EXISTS system_type text,
  ADD COLUMN IF NOT EXISTS project_system_id bigint
    REFERENCES project_systems(id) ON DELETE SET NULL;

ALTER TABLE handover_other_docs
  ADD COLUMN IF NOT EXISTS system_type text,
  ADD COLUMN IF NOT EXISTS project_system_id bigint
    REFERENCES project_systems(id) ON DELETE SET NULL;

ALTER TABLE project_handover_docs
  ADD COLUMN IF NOT EXISTS project_system_id bigint
    REFERENCES project_systems(id) ON DELETE SET NULL;

ALTER TABLE project_handover_docs
  DROP CONSTRAINT IF EXISTS project_handover_docs_project_id_document_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS project_handover_docs_project_type_system_uq
  ON project_handover_docs (project_id, document_type, system_type) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_as_fitted_project_system
  ON as_fitted_drawings(project_id, project_system_id);

CREATE INDEX IF NOT EXISTS idx_om_uploads_project_system
  ON om_pack_uploads(project_id, project_system_id);

COMMENT ON COLUMN as_fitted_drawings.system_type IS
  'Denormalized project_systems.system_name for legacy queries and export grouping.';
COMMENT ON COLUMN om_pack_uploads.system_type IS
  'Cost centre / system name this upload belongs to. NULL = project-wide.';
