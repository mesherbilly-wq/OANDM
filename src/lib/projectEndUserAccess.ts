import { supabase } from './supabase';

export interface ProjectEndUserInvite {
  id: number;
  project_id: number;
  email: string;
  user_id: string | null;
  token: string;
  invited_at: string;
  accepted_at: string | null;
}

export interface EndUserInvitePreview {
  email: string;
  project_id: number;
  project_name: string;
  accepted: boolean;
}

export function inviteUrl(token: string): string {
  return `${window.location.origin}/i/${token}`;
}

export function inviteMailto(to: string, projectName: string, url: string): string {
  const subject = encodeURIComponent(`O&M pack for ${projectName}`);
  const body = encodeURIComponent(
    `You have been invited to view the O&M pack for ${projectName}.\n\nOpen this link, then sign in or create a password with this email address:\n\n${url}\n`,
  );
  return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isMissingEndUserInviteTable(message: string): boolean {
  return /schema cache|does not exist|project_end_user_access|get_end_user_invite|claim_end_user_invite/i.test(message);
}

export async function listProjectEndUserInvites(projectId: number): Promise<{ invites: ProjectEndUserInvite[]; error: string | null; needsMigration: boolean }> {
  const { data, error } = await supabase
    .from('project_end_user_access')
    .select('id, project_id, email, user_id, token, invited_at, accepted_at')
    .eq('project_id', projectId)
    .order('invited_at', { ascending: false });

  if (error) {
    return { invites: [], error: error.message, needsMigration: isMissingEndUserInviteTable(error.message) };
  }

  return { invites: (data ?? []) as ProjectEndUserInvite[], error: null, needsMigration: false };
}

export async function createProjectEndUserInvite(projectId: number, email: string): Promise<{
  invite: ProjectEndUserInvite;
  url: string;
  mailtoHref: string;
  projectName: string;
}> {
  const normalised = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    throw new Error('Enter a valid email address.');
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { data: project } = await supabase.from('projects').select('project_name').eq('id', projectId).maybeSingle();
  const projectName = project?.project_name || 'this project';

  const { data: existing, error: existingError } = await supabase
    .from('project_end_user_access')
    .select('id, project_id, email, user_id, token, invited_at, accepted_at')
    .eq('project_id', projectId)
    .eq('email', normalised)
    .maybeSingle();

  if (existingError && isMissingEndUserInviteTable(existingError.message)) {
    throw new Error('Run 029 in the Supabase SQL Editor to enable client invites.');
  }
  if (existingError) throw new Error(existingError.message);

  if (existing) {
    const url = inviteUrl(existing.token);
    return {
      invite: existing as ProjectEndUserInvite,
      url,
      mailtoHref: inviteMailto(normalised, projectName, url),
      projectName,
    };
  }

  const token = randomToken();
  const { data, error } = await supabase
    .from('project_end_user_access')
    .insert({
      project_id: projectId,
      email: normalised,
      token,
      invited_by: user?.id ?? null,
    })
    .select('id, project_id, email, user_id, token, invited_at, accepted_at')
    .single();

  if (error) {
    if (isMissingEndUserInviteTable(error.message)) {
      throw new Error('Run 029 in the Supabase SQL Editor to enable client invites.');
    }
    throw new Error(error.message);
  }

  const url = inviteUrl(token);
  return {
    invite: data as ProjectEndUserInvite,
    url,
    mailtoHref: inviteMailto(normalised, projectName, url),
    projectName,
  };
}

export async function revokeProjectEndUserInvite(id: number): Promise<void> {
  const { error } = await supabase.from('project_end_user_access').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function listAllProjectEndUserAccess(): Promise<{
  rows: ProjectEndUserInvite[];
  error: string | null;
  needsMigration: boolean;
}> {
  const { data, error } = await supabase
    .from('project_end_user_access')
    .select('id, project_id, email, user_id, token, invited_at, accepted_at')
    .order('invited_at', { ascending: false });

  if (error) {
    return { rows: [], error: error.message, needsMigration: isMissingEndUserInviteTable(error.message) };
  }
  return { rows: (data ?? []) as ProjectEndUserInvite[], error: null, needsMigration: false };
}

export async function grantUserProjectAccess(projectId: number, email: string, userId: string): Promise<void> {
  const normalised = normalizeEmail(email);
  if (!normalised) throw new Error('This user has no email address to grant access with.');

  const { data: { user } } = await supabase.auth.getUser();
  const now = new Date().toISOString();

  const { data: byUser, error: byUserError } = await supabase
    .from('project_end_user_access')
    .select('id, accepted_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (byUserError && isMissingEndUserInviteTable(byUserError.message)) {
    throw new Error('Run 029 in the Supabase SQL Editor to enable project access.');
  }
  if (byUserError) throw new Error(byUserError.message);
  if (byUser) {
    if (byUser.accepted_at) return;
    const { error } = await supabase
      .from('project_end_user_access')
      .update({ accepted_at: now, email: normalised })
      .eq('id', byUser.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { data: byEmail, error: byEmailError } = await supabase
    .from('project_end_user_access')
    .select('id, accepted_at')
    .eq('project_id', projectId)
    .eq('email', normalised)
    .maybeSingle();
  if (byEmailError) throw new Error(byEmailError.message);
  if (byEmail) {
    const { error } = await supabase
      .from('project_end_user_access')
      .update({
        user_id: userId,
        accepted_at: byEmail.accepted_at ?? now,
      })
      .eq('id', byEmail.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from('project_end_user_access')
    .insert({
      project_id: projectId,
      email: normalised,
      user_id: userId,
      token: randomToken(),
      invited_by: user?.id ?? null,
      accepted_at: now,
    });
  if (error) {
    if (isMissingEndUserInviteTable(error.message)) {
      throw new Error('Run 029 in the Supabase SQL Editor to enable project access.');
    }
    throw new Error(error.message);
  }
}

export async function previewEndUserInvite(token: string): Promise<EndUserInvitePreview> {
  const { data, error } = await supabase.rpc('get_end_user_invite', { invite_token: token });
  if (error) {
    if (isMissingEndUserInviteTable(error.message)) {
      throw new Error('Run 029 in the Supabase SQL Editor, then open this invite again.');
    }
    throw new Error(error.message);
  }
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (!parsed || parsed.error) throw new Error(parsed?.error || 'Invite not found');
  return parsed as EndUserInvitePreview;
}

export async function claimEndUserInvite(token: string): Promise<{ project_id: number; project_name: string }> {
  const { data, error } = await supabase.rpc('claim_end_user_invite', { invite_token: token });
  if (error) throw new Error(error.message);
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (!parsed?.project_id) throw new Error('Invite could not be accepted.');
  return parsed as { project_id: number; project_name: string };
}

export async function confirmEndUserFromInvite(token: string): Promise<void> {
  const { data, error } = await supabase.rpc('confirm_end_user_from_invite', { invite_token: token });
  if (error) {
    if (/does not exist|schema cache|confirm_end_user_from_invite/i.test(error.message)) {
      throw new Error('Run 030 in the Supabase SQL Editor, then try again. The invite already proves this email.');
    }
    throw new Error(error.message);
  }
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (parsed && parsed.ok === false && parsed.reason === 'no_user') {
    throw new Error('Create a password on this invite first, then sign in.');
  }
}

export async function registerEndUserFromInvite(token: string, password: string): Promise<void> {
  const { data, error } = await supabase.rpc('register_end_user_from_invite', {
    invite_token: token,
    new_password: password,
  });
  if (error) {
    if (/does not exist|schema cache|register_end_user_from_invite/i.test(error.message)) {
      throw new Error('Run 032 in the Supabase SQL Editor, then try again. Invited accounts do not need a confirmation email.');
    }
    throw new Error(error.message);
  }
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (parsed && parsed.ok === false) {
    throw new Error('This invite could not create an account. Open the link again and try signing in.');
  }
}

export async function registerStaffUser(email: string, password: string): Promise<void> {
  const { data, error } = await supabase.rpc('register_staff_user', {
    user_email: email.trim().toLowerCase(),
    new_password: password,
  });
  if (error) {
    if (/does not exist|schema cache|register_staff_user/i.test(error.message)) {
      throw new Error('Run 033 in the Supabase SQL Editor, then try again. Staff accounts do not need a confirmation email.');
    }
    throw new Error(error.message);
  }
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (parsed && parsed.ok === false) {
    throw new Error('This account could not be created. Try signing in.');
  }
}

export function isEmailNotConfirmedError(message: string): boolean {
  return /email not confirmed|email_not_confirmed/i.test(message);
}

export function isAlreadyRegisteredError(message: string): boolean {
  return /already registered|already been registered|user already exists/i.test(message);
}

export function isEmailRateLimitError(message: string): boolean {
  return /rate limit|over_email_send_rate_limit/i.test(message);
}
