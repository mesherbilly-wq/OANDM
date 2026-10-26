-- Appoint william@pacific-uk.co.uk as platform owner.
-- Safe to run again. Requires 051 (the master role and company_id column).

DO $$
DECLARE
  owner_email text := 'william@pacific-uk.co.uk';
  uid uuid;
  token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.app_profiles'::regclass
      AND conname = 'app_profiles_role_check'
      AND pg_get_constraintdef(oid) LIKE '%master%'
  ) THEN
    RAISE EXCEPTION 'Run the platform companies migration before appointing the owner';
  END IF;

  SELECT u.id INTO uid
  FROM auth.users u
  WHERE lower(u.email) = owner_email
  LIMIT 1;

  IF uid IS NOT NULL THEN
    PERFORM set_config('app.allow_profile_write', '1', true);
    INSERT INTO public.app_profiles (user_id, email, role, company_id)
    VALUES (uid, owner_email, 'master', NULL)
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          role = 'master',
          company_id = NULL,
          updated_at = now();
    RETURN;
  END IF;

  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  PERFORM set_config('app.allow_master_invite', '1', true);
  INSERT INTO public.app_user_invites (email, role, token, company_id)
  VALUES (owner_email, 'master', token, NULL)
  ON CONFLICT (email) DO UPDATE
    SET role = 'master',
        company_id = NULL,
        accepted_at = NULL,
        user_id = NULL,
        token = EXCLUDED.token,
        invited_at = now();
END $$;
