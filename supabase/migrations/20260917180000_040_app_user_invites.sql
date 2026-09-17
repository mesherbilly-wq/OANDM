-- Invite users from the Users page with Admin / Staff / End user already set.
-- Requires 028 (app_profiles). Optional project grant for end users uses 029 if present.

CREATE TABLE IF NOT EXISTS public.app_user_invites (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'staff', 'end_user')),
  project_id  bigint REFERENCES public.projects(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token       text UNIQUE NOT NULL,
  invited_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at  timestamptz DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS app_user_invites_token_idx ON public.app_user_invites (token);

ALTER TABLE public.app_user_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_app_user_invites_admin" ON public.app_user_invites;
DROP POLICY IF EXISTS "write_app_user_invites_admin" ON public.app_user_invites;
DROP POLICY IF EXISTS "update_app_user_invites_admin" ON public.app_user_invites;
DROP POLICY IF EXISTS "delete_app_user_invites_admin" ON public.app_user_invites;

CREATE POLICY "select_app_user_invites_admin"
  ON public.app_user_invites FOR SELECT TO authenticated
  USING (public.app_role() = 'admin');

CREATE POLICY "write_app_user_invites_admin"
  ON public.app_user_invites FOR INSERT TO authenticated
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY "update_app_user_invites_admin"
  ON public.app_user_invites FOR UPDATE TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

CREATE POLICY "delete_app_user_invites_admin"
  ON public.app_user_invites FOR DELETE TO authenticated
  USING (public.app_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_invites TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.app_user_invites_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_app_user_invite(invite public.app_user_invites, uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_profiles (user_id, email, role)
  VALUES (uid, invite.email, invite.role)
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        role = EXCLUDED.role,
        updated_at = now();

  UPDATE public.app_user_invites
  SET user_id = uid,
      accepted_at = COALESCE(accepted_at, now())
  WHERE id = invite.id;

  IF invite.project_id IS NOT NULL AND to_regclass('public.project_end_user_access') IS NOT NULL THEN
    INSERT INTO public.project_end_user_access (
      project_id, email, user_id, token, invited_by, accepted_at
    )
    VALUES (
      invite.project_id,
      invite.email,
      uid,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      invite.invited_by,
      now()
    )
    ON CONFLICT (project_id, email) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          accepted_at = COALESCE(public.project_end_user_access.accepted_at, now());
  END IF;
END;
$$;

-- If this email already has a pending Users-page invite, assign that role on signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_role text;
  invite public.app_user_invites%ROWTYPE;
BEGIN
  SELECT * INTO invite
  FROM public.app_user_invites i
  WHERE lower(i.email) = lower(COALESCE(NEW.email, ''))
    AND i.accepted_at IS NULL
  LIMIT 1;

  IF invite.id IS NOT NULL THEN
    PERFORM public.apply_app_user_invite(invite, NEW.id);
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION public.get_app_user_invite(invite_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite public.app_user_invites%ROWTYPE;
BEGIN
  SELECT * INTO invite
  FROM public.app_user_invites
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invite not found');
  END IF;

  RETURN jsonb_build_object(
    'email', invite.email,
    'role', invite.role,
    'accepted', invite.accepted_at IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_app_user_invite(invite_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  invite public.app_user_invites%ROWTYPE;
  uid uuid := auth.uid();
  user_email text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;

  SELECT email INTO user_email FROM auth.users WHERE id = uid;

  SELECT * INTO invite
  FROM public.app_user_invites
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF lower(invite.email) <> lower(COALESCE(user_email, '')) THEN
    RAISE EXCEPTION 'This invite is for %', invite.email;
  END IF;

  PERFORM public.apply_app_user_invite(invite, uid);

  RETURN jsonb_build_object('ok', true, 'role', invite.role);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_user_from_invite(invite_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  invite public.app_user_invites%ROWTYPE;
  updated_count integer;
BEGIN
  SELECT * INTO invite
  FROM public.app_user_invites
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now())
  WHERE lower(email) = lower(invite.email);

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_user');
  END IF;

  RETURN jsonb_build_object('ok', true, 'email', invite.email);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_user_from_invite(invite_token text, new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  invite public.app_user_invites%ROWTYPE;
  existing_id uuid;
  existing_confirmed timestamptz;
  new_id uuid;
  hashed text;
  inst uuid;
BEGIN
  IF new_password IS NULL OR length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  SELECT * INTO invite
  FROM public.app_user_invites
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  hashed := crypt(new_password, gen_salt('bf'));

  SELECT u.id, u.email_confirmed_at
  INTO existing_id, existing_confirmed
  FROM auth.users u
  WHERE lower(u.email) = lower(invite.email);

  IF existing_id IS NOT NULL THEN
    UPDATE auth.users
    SET encrypted_password = hashed,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = existing_id;

    PERFORM public.apply_app_user_invite(invite, existing_id);
    RETURN jsonb_build_object('ok', true, 'user_id', existing_id, 'created', false, 'role', invite.role);
  END IF;

  SELECT instance_id INTO inst FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1;
  IF inst IS NULL THEN
    inst := '00000000-0000-0000-0000-000000000000';
  END IF;

  new_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    inst,
    new_id,
    'authenticated',
    'authenticated',
    lower(invite.email),
    hashed,
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    new_id,
    jsonb_build_object(
      'sub', new_id::text,
      'email', lower(invite.email),
      'email_verified', true
    ),
    'email',
    new_id::text,
    now(),
    now(),
    now()
  );

  PERFORM public.apply_app_user_invite(invite, new_id);
  RETURN jsonb_build_object('ok', true, 'user_id', new_id, 'created', true, 'role', invite.role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_user_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_app_user_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_user_from_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_user_from_invite(text, text) TO anon, authenticated;
