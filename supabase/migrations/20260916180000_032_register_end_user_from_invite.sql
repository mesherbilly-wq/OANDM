-- Create or complete an invited end-user account without sending a Supabase
-- confirmation email. The invite link already proved the address, so signup
-- must not hit the Auth email rate limit.

CREATE OR REPLACE FUNCTION public.register_end_user_from_invite(invite_token text, new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  invite public.project_end_user_access%ROWTYPE;
  existing_id uuid;
  existing_role text;
  existing_confirmed timestamptz;
  new_id uuid;
  hashed text;
  inst uuid;
BEGIN
  IF new_password IS NULL OR length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  SELECT * INTO invite
  FROM public.project_end_user_access
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  hashed := crypt(new_password, gen_salt('bf'));

  SELECT u.id, u.email_confirmed_at, p.role
  INTO existing_id, existing_confirmed, existing_role
  FROM auth.users u
  LEFT JOIN public.app_profiles p ON p.user_id = u.id
  WHERE lower(u.email) = lower(invite.email);

  IF existing_id IS NOT NULL THEN
    IF existing_confirmed IS NOT NULL AND existing_role IN ('admin', 'staff') THEN
      RAISE EXCEPTION 'This email already has an account. Sign in instead.';
    END IF;

    UPDATE auth.users
    SET encrypted_password = hashed,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = existing_id;

    RETURN jsonb_build_object('ok', true, 'user_id', existing_id, 'created', false);
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

  RETURN jsonb_build_object('ok', true, 'user_id', new_id, 'created', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_end_user_from_invite(text, text) TO anon, authenticated;
