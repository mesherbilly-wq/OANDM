-- A system can have more than one completion document assigned.

ALTER TABLE project_completion_documents
  DROP CONSTRAINT IF EXISTS project_completion_documents_project_id_system_type_key;

ALTER TABLE project_completion_documents
  DROP CONSTRAINT IF EXISTS project_completion_documents_project_system_template_key;

ALTER TABLE project_completion_documents
  ADD CONSTRAINT project_completion_documents_project_system_template_key
  UNIQUE (project_id, system_type, template_key);
