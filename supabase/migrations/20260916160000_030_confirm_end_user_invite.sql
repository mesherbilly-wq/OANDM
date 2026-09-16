-- Confirm an invited end user's auth email. The invite link already proved they
-- have that address, so they should not need a second confirmation email.

CREATE OR REPLACE FUNCTION public.confirm_end_user_from_invite(invite_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  invite public.project_end_user_access%ROWTYPE;
  updated_count integer;
BEGIN
  SELECT * INTO invite
  FROM public.project_end_user_access
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

GRANT EXECUTE ON FUNCTION public.confirm_end_user_from_invite(text) TO anon, authenticated;
