import { isAppRole, roleLabel, type AppRole } from './appRoles';
import { supabase } from './supabase';

export interface AppUserInvite {
  id: number;
  email: string;
  role: AppRole;
  project_id: number | null;
  user_id: string | null;
  token: string;
  invited_at: string;
  accepted_at: string | null;
}

export interface AppUserInvitePreview {
  email: string;
  role: AppRole;
  accepted: boolean;
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isMissingAppUserInviteTable(message: string): boolean {
  return /schema cache|does not exist|app_user_invites|get_app_user_invite|register_user_from_invite|claim_app_user_invite/i.test(message);
}

export function userInviteUrl(token: string): string {
  return `${window.location.origin}/u/${token}`;
}

export function userInviteMailto(to: string, role: AppRole, url: string): string {
  const subject = encodeURIComponent(`O&M access (${roleLabel(role)})`);
  const body = encodeURIComponent(
    `You have been invited to the O&M builder as ${roleLabel(role)}.\n\nOpen this link, then sign in or create a password with this email address:\n\n${url}\n`,
  );
  return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
}

export async function listAppUserInvites(): Promise<{
  invites: AppUserInvite[];
  error: string | null;
  needsMigration: boolean;
}> {
  const { data, error } = await supabase
    .from('app_user_invites')
    .select('id, email, role, project_id, user_id, token, invited_at, accepted_at')
    .order('invited_at', { ascending: false });

  if (error) {
    return { invites: [], error: error.message, needsMigration: isMissingAppUserInviteTable(error.message) };
  }

  return {
    invites: (data ?? []).map(row => ({
      ...row,
      role: isAppRole(row.role) ? row.role : 'end_user',
    })) as AppUserInvite[],
    error: null,
    needsMigration: false,
  };
}

export async function createAppUserInvite(
  email: string,
  role: AppRole,
  projectId?: number | null,
): Promise<{ invite: AppUserInvite; url: string; mailtoHref: string }> {
  const normalised = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    throw new Error('Enter a valid email address.');
  }
  if (!isAppRole(role)) {
    throw new Error('Choose Admin, Staff, or End user.');
  }

  const { data: existingProfiles, error: profileError } = await supabase
    .from('app_profiles')
    .select('email');
  if (profileError && !isMissingAppUserInviteTable(profileError.message)) {
    throw new Error(profileError.message);
  }
  if ((existingProfiles ?? []).some(row => String(row.email ?? '').trim().toLowerCase() === normalised)) {
    throw new Error('That email already has an account. Change their level on the list below.');
  }

  const { data: { user } } = await supabase.auth.getUser();
  const project_id = role === 'end_user' && projectId && projectId > 0 ? projectId : null;

  const { data: existing, error: existingError } = await supabase
    .from('app_user_invites')
    .select('id, email, role, project_id, user_id, token, invited_at, accepted_at')
    .eq('email', normalised)
    .maybeSingle();

  if (existingError && isMissingAppUserInviteTable(existingError.message)) {
    throw new Error('Run 040 in the Supabase SQL Editor to enable user invites.');
  }
  if (existingError) throw new Error(existingError.message);

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from('app_user_invites')
      .update({
        role,
        project_id,
        invited_by: user?.id ?? null,
        invited_at: new Date().toISOString(),
        accepted_at: null,
      })
      .eq('id', existing.id)
      .select('id, email, role, project_id, user_id, token, invited_at, accepted_at')
      .single();
    if (updateError) throw new Error(updateError.message);
    const invite = { ...updated, role: isAppRole(updated.role) ? updated.role : role } as AppUserInvite;
    const url = userInviteUrl(invite.token);
    return { invite, url, mailtoHref: userInviteMailto(normalised, invite.role, url) };
  }

  const token = randomToken();
  const { data, error } = await supabase
    .from('app_user_invites')
    .insert({
      email: normalised,
      role,
      project_id,
      token,
      invited_by: user?.id ?? null,
    })
    .select('id, email, role, project_id, user_id, token, invited_at, accepted_at')
    .single();

  if (error) {
    if (isMissingAppUserInviteTable(error.message)) {
      throw new Error('Run 040 in the Supabase SQL Editor to enable user invites.');
    }
    throw new Error(error.message);
  }

  const invite = { ...data, role: isAppRole(data.role) ? data.role : role } as AppUserInvite;
  const url = userInviteUrl(token);
  return { invite, url, mailtoHref: userInviteMailto(normalised, invite.role, url) };
}

export async function revokeAppUserInvite(id: number): Promise<void> {
  const { error } = await supabase.from('app_user_invites').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function previewAppUserInvite(token: string): Promise<AppUserInvitePreview> {
  const { data, error } = await supabase.rpc('get_app_user_invite', { invite_token: token });
  if (error) {
    if (isMissingAppUserInviteTable(error.message)) {
      throw new Error('Run 040 in the Supabase SQL Editor, then open this invite again.');
    }
    throw new Error(error.message);
  }
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (!parsed || parsed.error) throw new Error(parsed?.error || 'Invite not found');
  if (!isAppRole(parsed.role)) throw new Error('Invite not found');
  return parsed as AppUserInvitePreview;
}

export async function claimAppUserInvite(token: string): Promise<{ role: AppRole }> {
  const { data, error } = await supabase.rpc('claim_app_user_invite', { invite_token: token });
  if (error) throw new Error(error.message);
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (!parsed?.ok) throw new Error('Invite could not be accepted.');
  return { role: isAppRole(parsed.role) ? parsed.role : 'end_user' };
}

export async function confirmUserFromInvite(token: string): Promise<void> {
  const { data, error } = await supabase.rpc('confirm_user_from_invite', { invite_token: token });
  if (error) {
    if (isMissingAppUserInviteTable(error.message)) {
      throw new Error('Run 040 in the Supabase SQL Editor, then try again.');
    }
    throw new Error(error.message);
  }
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (parsed && parsed.ok === false && parsed.reason === 'no_user') {
    throw new Error('Create a password on this invite first, then sign in.');
  }
}

export async function registerUserFromInvite(token: string, password: string): Promise<void> {
  const { data, error } = await supabase.rpc('register_user_from_invite', {
    invite_token: token,
    new_password: password,
  });
  if (error) {
    if (isMissingAppUserInviteTable(error.message)) {
      throw new Error('Run 040 in the Supabase SQL Editor, then try again.');
    }
    throw new Error(error.message);
  }
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (parsed && parsed.ok === false) {
    throw new Error('This invite could not create an account. Open the link again and try signing in.');
  }
}
