-- End users are invited to specific projects from the O&M Builder.
-- They only see invited projects. Requires 028 (app_profiles / app_role).

CREATE TABLE IF NOT EXISTS public.project_end_user_access (
  id          bigserial PRIMARY KEY,
  project_id  bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email       text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token       text UNIQUE NOT NULL,
  invited_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at  timestamptz DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (project_id, email)
);

CREATE INDEX IF NOT EXISTS project_end_user_access_user_id_idx
  ON public.project_end_user_access (user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.project_end_user_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_project_end_user_access" ON public.project_end_user_access;
DROP POLICY IF EXISTS "write_project_end_user_access" ON public.project_end_user_access;
DROP POLICY IF EXISTS "update_project_end_user_access" ON public.project_end_user_access;
DROP POLICY IF EXISTS "delete_project_end_user_access" ON public.project_end_user_access;

CREATE POLICY "select_project_end_user_access"
  ON public.project_end_user_access FOR SELECT TO authenticated
  USING (
    public.app_role() IN ('admin', 'staff')
    OR user_id = auth.uid()
    OR lower(email) = lower(COALESCE((SELECT email FROM public.app_profiles WHERE user_id = auth.uid()), ''))
  );

CREATE POLICY "write_project_end_user_access"
  ON public.project_end_user_access FOR INSERT TO authenticated
  WITH CHECK (public.app_role() IN ('admin', 'staff'));

CREATE POLICY "update_project_end_user_access"
  ON public.project_end_user_access FOR UPDATE TO authenticated
  USING (public.app_role() IN ('admin', 'staff'))
  WITH CHECK (public.app_role() IN ('admin', 'staff'));

CREATE POLICY "delete_project_end_user_access"
  ON public.project_end_user_access FOR DELETE TO authenticated
  USING (public.app_role() IN ('admin', 'staff'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_end_user_access TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.project_end_user_access_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.get_end_user_invite(invite_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite public.project_end_user_access%ROWTYPE;
  proj_name text;
BEGIN
  SELECT * INTO invite
  FROM public.project_end_user_access
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invite not found');
  END IF;

  SELECT project_name INTO proj_name FROM public.projects WHERE id = invite.project_id;

  RETURN jsonb_build_object(
    'email', invite.email,
    'project_id', invite.project_id,
    'project_name', COALESCE(proj_name, 'Project'),
    'accepted', invite.accepted_at IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_end_user_invite(invite_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite public.project_end_user_access%ROWTYPE;
  uid uuid := auth.uid();
  user_email text;
  proj_name text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;

  SELECT email INTO user_email FROM auth.users WHERE id = uid;

  SELECT * INTO invite
  FROM public.project_end_user_access
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF lower(invite.email) <> lower(COALESCE(user_email, '')) THEN
    RAISE EXCEPTION 'This invite is for %', invite.email;
  END IF;

  UPDATE public.project_end_user_access
  SET user_id = uid,
      accepted_at = COALESCE(accepted_at, now())
  WHERE id = invite.id;

  INSERT INTO public.app_profiles (user_id, email, role)
  VALUES (uid, COALESCE(user_email, invite.email), 'end_user')
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email
    WHERE public.app_profiles.role = 'end_user';

  SELECT project_name INTO proj_name FROM public.projects WHERE id = invite.project_id;

  RETURN jsonb_build_object(
    'project_id', invite.project_id,
    'project_name', COALESCE(proj_name, 'Project')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_end_user_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_end_user_invite(text) TO authenticated;

-- End users only see invited projects. Staff and admin see all.
DROP POLICY IF EXISTS "public_select_projects" ON public.projects;
DROP POLICY IF EXISTS "select_projects_by_role" ON public.projects;

CREATE POLICY "select_projects_by_role"
  ON public.projects FOR SELECT TO authenticated
  USING (
    public.app_role() IN ('admin', 'staff')
    OR EXISTS (
      SELECT 1
      FROM public.project_end_user_access a
      WHERE a.project_id = projects.id
        AND a.accepted_at IS NOT NULL
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "public_insert_projects" ON public.projects;
DROP POLICY IF EXISTS "public_update_projects" ON public.projects;
DROP POLICY IF EXISTS "public_delete_projects" ON public.projects;
DROP POLICY IF EXISTS "write_projects_staff_admin" ON public.projects;
DROP POLICY IF EXISTS "update_projects_staff_admin" ON public.projects;
DROP POLICY IF EXISTS "delete_projects_staff_admin" ON public.projects;

CREATE POLICY "write_projects_staff_admin"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.app_role() IN ('admin', 'staff'));

CREATE POLICY "update_projects_staff_admin"
  ON public.projects FOR UPDATE TO authenticated
  USING (public.app_role() IN ('admin', 'staff'))
  WITH CHECK (public.app_role() IN ('admin', 'staff'));

CREATE POLICY "delete_projects_staff_admin"
  ON public.projects FOR DELETE TO authenticated
  USING (public.app_role() IN ('admin', 'staff'));
