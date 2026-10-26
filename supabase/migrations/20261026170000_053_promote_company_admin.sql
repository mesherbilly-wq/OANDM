-- Make billymesher@icloud.com a company admin on the original company.
-- Does not change a platform owner account.

DO $$
DECLARE
  target_email text := 'billymesher@icloud.com';
  uid uuid;
  current_role text;
BEGIN
  SELECT u.id, p.role
  INTO uid, current_role
  FROM auth.users u
  LEFT JOIN public.app_profiles p ON p.user_id = u.id
  WHERE lower(u.email) = target_email
  LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'No account for %', target_email;
  END IF;

  IF current_role = 'master' THEN
    RAISE EXCEPTION '% is the platform owner and cannot also be a company admin', target_email;
  END IF;

  PERFORM set_config('app.allow_profile_write', '1', true);

  UPDATE public.app_profiles
  SET role = 'admin',
      email = target_email,
      company_id = COALESCE(company_id, public.original_company_id()),
      updated_at = now()
  WHERE user_id = uid;

  IF NOT FOUND THEN
    INSERT INTO public.app_profiles (user_id, email, role, company_id)
    VALUES (uid, target_email, 'admin', public.original_company_id());
  END IF;
END $$;
