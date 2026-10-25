-- Templates and the documents assigned to a system are an admin feature.
-- Staff can still read them so commissioning can issue the assigned forms.
-- Once a template is assigned, only an admin can take it off the system.

DROP POLICY IF EXISTS wr_completion_form_templates ON completion_form_templates;
DROP POLICY IF EXISTS ins_completion_form_templates ON completion_form_templates;
DROP POLICY IF EXISTS upd_completion_form_templates ON completion_form_templates;
DROP POLICY IF EXISTS del_completion_form_templates ON completion_form_templates;

CREATE POLICY ins_completion_form_templates ON completion_form_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY upd_completion_form_templates ON completion_form_templates
  FOR UPDATE TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY del_completion_form_templates ON completion_form_templates
  FOR DELETE TO authenticated
  USING (public.app_role() = 'admin');

DROP POLICY IF EXISTS wr_project_completion_documents ON project_completion_documents;
DROP POLICY IF EXISTS ins_project_completion_documents ON project_completion_documents;
DROP POLICY IF EXISTS upd_project_completion_documents ON project_completion_documents;
DROP POLICY IF EXISTS del_project_completion_documents ON project_completion_documents;

CREATE POLICY ins_project_completion_documents ON project_completion_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY upd_project_completion_documents ON project_completion_documents
  FOR UPDATE TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY del_project_completion_documents ON project_completion_documents
  FOR DELETE TO authenticated
  USING (public.app_role() = 'admin');
