-- App roles (admin / staff / end_user) and persist Simpro credentials in integration_settings.
-- Existing signed-in users become admin so the current account is not locked out.
-- New sign-ups after an admin exists become end_user until an admin changes their role.

CREATE TABLE IF NOT EXISTS public.app_profiles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL DEFAULT '',
  role       text NOT NULL CHECK (role IN ('admin', 'staff', 'end_user')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.app_profiles WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_role text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_profiles WHERE role = 'admin') THEN
    next_role := 'end_user';
  ELSE
    next_role := 'admin';
  END IF;

  INSERT INTO public.app_profiles (user_id, email, role)
  VALUES (NEW.id, COALESCE(NEW.email, ''), next_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

INSERT INTO public.app_profiles (user_id, email, role)
SELECT id, COALESCE(email, ''), 'admin'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

DROP POLICY IF EXISTS "select_own_or_admin_app_profiles" ON public.app_profiles;
DROP POLICY IF EXISTS "insert_own_end_user_app_profiles" ON public.app_profiles;
DROP POLICY IF EXISTS "admin_update_app_profiles" ON public.app_profiles;

CREATE POLICY "select_own_or_admin_app_profiles"
  ON public.app_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.app_role() = 'admin');

CREATE POLICY "insert_own_end_user_app_profiles"
  ON public.app_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'end_user');

CREATE POLICY "admin_update_app_profiles"
  ON public.app_profiles FOR UPDATE TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

GRANT SELECT, INSERT, UPDATE ON public.app_profiles TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_role() TO authenticated, anon;

-- Simpro tokens: admin can link/unlink; staff can read so they can import; end users cannot.
DROP POLICY IF EXISTS "select_integration_settings" ON public.integration_settings;
DROP POLICY IF EXISTS "insert_integration_settings" ON public.integration_settings;
DROP POLICY IF EXISTS "update_integration_settings" ON public.integration_settings;
DROP POLICY IF EXISTS "delete_integration_settings" ON public.integration_settings;
DROP POLICY IF EXISTS "select_integration_settings_staff_admin" ON public.integration_settings;
DROP POLICY IF EXISTS "write_integration_settings_admin" ON public.integration_settings;
DROP POLICY IF EXISTS "update_integration_settings_admin" ON public.integration_settings;
DROP POLICY IF EXISTS "delete_integration_settings_admin" ON public.integration_settings;

CREATE POLICY "select_integration_settings_staff_admin"
  ON public.integration_settings FOR SELECT TO authenticated
  USING (public.app_role() IN ('admin', 'staff'));

CREATE POLICY "write_integration_settings_admin"
  ON public.integration_settings FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY "update_integration_settings_admin"
  ON public.integration_settings FOR UPDATE TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY "delete_integration_settings_admin"
  ON public.integration_settings FOR DELETE TO authenticated
  USING (public.app_role() = 'admin');
