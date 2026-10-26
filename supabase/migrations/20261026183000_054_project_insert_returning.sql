-- Creating a project failed with:
--   new row violates row-level security policy for table "projects"
--
-- The insert check was fine for an admin or staff member. The failure was the
-- row coming back. can_access_project() reads projects again, and that read
-- cannot see the row that is still being inserted. Check the row's own company
-- instead.

DROP POLICY IF EXISTS "select_projects_by_role" ON public.projects;

CREATE POLICY "select_projects_by_role"
  ON public.projects FOR SELECT TO authenticated
  USING (
    public.company_is_active()
    AND company_id IS NOT NULL
    AND company_id = public.current_company_id()
    AND (
      public.app_role() IN ('admin', 'staff')
      OR (
        public.app_role() = 'end_user'
        AND EXISTS (
          SELECT 1
          FROM public.project_end_user_access access
          WHERE access.project_id = projects.id
            AND access.accepted_at IS NOT NULL
            AND access.user_id = auth.uid()
        )
      )
    )
  );
