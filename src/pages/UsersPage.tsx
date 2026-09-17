import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCopy, FolderOpen, Loader2, Mail, Plus, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { APP_ROLES, canEditOperations, isAppRole, roleLabel, type AppRole } from '../lib/appRoles';
import { useUserAccess } from '../lib/userAccess';
import {
  grantUserProjectAccess,
  listAllProjectEndUserAccess,
  revokeProjectEndUserInvite,
  type ProjectEndUserInvite,
} from '../lib/projectEndUserAccess';
import {
  createAppUserInvite,
  listAppUserInvites,
  revokeAppUserInvite,
  userInviteMailto,
  userInviteUrl,
  type AppUserInvite,
} from '../lib/appUserInvites';
import migration028Sql from '../../supabase/migrations/20260916140000_028_app_roles_and_simpro.sql?raw';
import migration040Sql from '../../supabase/migrations/20260917180000_040_app_user_invites.sql?raw';

interface ProfileRow {
  user_id: string;
  email: string;
  role: AppRole;
}

interface ProjectOption {
  id: number;
  label: string;
}

function projectLabel(project: { project_name?: string | null; site_name?: string | null; job_number?: string | null; id: number }): string {
  return project.project_name?.trim()
    || project.site_name?.trim()
    || project.job_number?.trim()
    || `Project ${project.id}`;
}

function accessRowsForUser(profile: ProfileRow, rows: ProjectEndUserInvite[]): ProjectEndUserInvite[] {
  const email = profile.email.trim().toLowerCase();
  const seen = new Set<number>();
  const matched: ProjectEndUserInvite[] = [];
  for (const row of rows) {
    const sameUser = row.user_id === profile.user_id;
    const sameEmail = Boolean(email) && row.email.trim().toLowerCase() === email;
    if (!sameUser && !sameEmail) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    matched.push(row);
  }
  return matched;
}

export function UsersPage() {
  const { role: myRole, refreshRole } = useUserAccess();
  const canEditAccess = myRole === 'admin';
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [accessRows, setAccessRows] = useState<ProjectEndUserInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [addProjectId, setAddProjectId] = useState<Record<string, string>>({});
  const [pendingInvites, setPendingInvites] = useState<AppUserInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('staff');
  const [inviteProjectId, setInviteProjectId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [lastInviteMailto, setLastInviteMailto] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [needsInviteMigration, setNeedsInviteMigration] = useState(false);
  const [sqlCopied, setSqlCopied] = useState<'028' | '040' | null>(null);

  const projectById = useMemo(
    () => new Map(projects.map(project => [project.id, project])),
    [projects],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    const [{ data, error: loadError }, projectsRes, accessRes, invitesRes] = await Promise.all([
      supabase.from('app_profiles').select('user_id, email, role').order('created_at', { ascending: true }),
      supabase.from('projects').select('id, project_name, site_name, job_number').order('project_name', { ascending: true }),
      listAllProjectEndUserAccess(),
      listAppUserInvites(),
    ]);

    if (loadError) {
      setNeedsMigration(/does not exist|schema cache|42P01/i.test(loadError.message));
      setNeedsInviteMigration(invitesRes.needsMigration);
      setError(loadError.message);
      setProfiles([]);
      setProjects([]);
      setAccessRows([]);
      setPendingInvites([]);
      setLoading(false);
      return;
    }

    setNeedsMigration(accessRes.needsMigration);
    setNeedsInviteMigration(invitesRes.needsMigration);
    if (accessRes.error && !accessRes.needsMigration) setError(accessRes.error);
    else if (invitesRes.error && !invitesRes.needsMigration) setError(invitesRes.error);
    setAccessRows(accessRes.rows);
    const nextProfiles = (data ?? []).map(row => ({
      user_id: String(row.user_id),
      email: String(row.email ?? ''),
      role: isAppRole(row.role) ? row.role : 'end_user' as AppRole,
    }));
    const registeredEmails = new Set(nextProfiles.map(profile => profile.email.trim().toLowerCase()));
    setPendingInvites(
      invitesRes.invites.filter(invite => !invite.accepted_at && !registeredEmails.has(invite.email.trim().toLowerCase())),
    );
    setProjects(
      (projectsRes.data ?? []).map(row => ({
        id: Number(row.id),
        label: projectLabel(row),
      })),
    );
    setProfiles(nextProfiles);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const copyMigrationSql = async (which: '028' | '040') => {
    try {
      await navigator.clipboard.writeText(which === '040' ? migration040Sql : migration028Sql);
      setSqlCopied(which);
      window.setTimeout(() => setSqlCopied(null), 2500);
    } catch {
      setError(
        which === '040'
          ? 'Clipboard is blocked. Copy supabase/migrations/20260917180000_040_app_user_invites.sql instead.'
          : 'Clipboard is blocked. Copy supabase/migrations/20260916140000_028_app_roles_and_simpro.sql instead.',
      );
    }
  };

  const changeRole = async (profile: ProfileRow, nextRole: AppRole) => {
    if (profile.role === nextRole) return;
    const adminCount = profiles.filter(row => row.role === 'admin').length;
    if (profile.role === 'admin' && nextRole !== 'admin' && adminCount <= 1) {
      setError('Keep at least one admin.');
      return;
    }

    setSavingId(profile.user_id);
    setError(null);
    const { error: saveError } = await supabase
      .from('app_profiles')
      .update({ role: nextRole, updated_at: new Date().toISOString() })
      .eq('user_id', profile.user_id);

    setSavingId(null);
    if (saveError) {
      setError(saveError.message);
      return;
    }

    setProfiles(current => current.map(row => (row.user_id === profile.user_id ? { ...row, role: nextRole } : row)));
    if (profile.user_id === (await supabase.auth.getUser()).data.user?.id) {
      await refreshRole();
    }
  };

  const addAccess = async (profile: ProfileRow) => {
    const projectId = Number(addProjectId[profile.user_id] ?? '');
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    setAddingFor(profile.user_id);
    setError(null);
    try {
      await grantUserProjectAccess(projectId, profile.email, profile.user_id);
      setAddProjectId(current => ({ ...current, [profile.user_id]: '' }));
      const accessRes = await listAllProjectEndUserAccess();
      setAccessRows(accessRes.rows);
      if (accessRes.error && !accessRes.needsMigration) setError(accessRes.error);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add project access.');
    } finally {
      setAddingFor(null);
    }
  };

  const removeAccess = async (row: ProjectEndUserInvite) => {
    const name = projectById.get(row.project_id)?.label ?? `project ${row.project_id}`;
    if (!confirm(`Remove access to ${name}?`)) return;
    setError(null);
    try {
      await revokeProjectEndUserInvite(row.id);
      setAccessRows(current => current.filter(item => item.id !== row.id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not remove project access.');
    }
  };

  const sendInvite = async () => {
    if (!canEditAccess) return;
    setInviting(true);
    setError(null);
    try {
      const result = await createAppUserInvite(
        inviteEmail,
        inviteRole,
        inviteRole === 'end_user' ? Number(inviteProjectId) : null,
      );
      setLastInviteUrl(result.url);
      setLastInviteMailto(result.mailtoHref);
      setInviteEmail('');
      setInviteProjectId('');
      const invitesRes = await listAppUserInvites();
      setPendingInvites(invitesRes.invites.filter(invite => !invite.accepted_at));
      setNeedsInviteMigration(invitesRes.needsMigration);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invite failed.');
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  };

  const removePendingInvite = async (invite: AppUserInvite) => {
    if (!confirm(`Revoke the invite for ${invite.email}?`)) return;
    setError(null);
    try {
      await revokeAppUserInvite(invite.id);
      setPendingInvites(current => current.filter(item => item.id !== invite.id));
      if (lastInviteUrl && lastInviteUrl.includes(invite.token)) {
        setLastInviteUrl(null);
        setLastInviteMailto(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not revoke invite.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-md">
            <Users className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        </div>
        <p className="text-slate-500 ml-[52px]">
          Invite people here and set Admin, Staff, or End user. End users still need a project assigned.
        </p>
      </div>

      {needsMigration && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900">Paste 028 (and 029 for project invites) in the Supabase SQL Editor if roles or project access are missing.</p>
          <button
            type="button"
            onClick={() => void copyMigrationSql('028')}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            {sqlCopied === '028' ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
            {sqlCopied === '028' ? 'Copied 028 — paste in Supabase' : 'Copy 028 SQL'}
          </button>
        </div>
      )}

      {needsInviteMigration && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900">Paste 040 in the Supabase SQL Editor to invite users from this page.</p>
          <button
            type="button"
            onClick={() => void copyMigrationSql('040')}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            {sqlCopied === '040' ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
            {sqlCopied === '040' ? 'Copied 040 — paste in Supabase' : 'Copy 040 SQL'}
          </button>
        </div>
      )}

      {error && !needsMigration && (
        <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {canEditAccess && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <UserPlus className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Invite a user</h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            They get a link to create a password. Their level is set now, so you do not wait for them to register first.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={event => setInviteEmail(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && void sendInvite()}
              placeholder="name@company.co.uk"
              disabled={needsInviteMigration}
              className="flex-1 min-w-[14rem] border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
            />
            <select
              value={inviteRole}
              onChange={event => setInviteRole(event.target.value as AppRole)}
              disabled={needsInviteMigration}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
            >
              {APP_ROLES.map(item => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            {inviteRole === 'end_user' && (
              <select
                value={inviteProjectId}
                onChange={event => setInviteProjectId(event.target.value)}
                disabled={needsInviteMigration || projects.length === 0}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50 min-w-[12rem]"
              >
                <option value="">{projects.length === 0 ? 'No projects yet' : 'First project (optional)'}</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{project.label}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => void sendInvite()}
              disabled={inviting || !inviteEmail.trim() || needsInviteMigration}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Invite
            </button>
          </div>

          {lastInviteUrl && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-2">
              <p className="text-xs font-mono text-slate-700 break-all">{lastInviteUrl}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyInviteLink(lastInviteUrl)}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border border-emerald-300 bg-white text-emerald-800"
                >
                  {linkCopied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                  Copy link
                </button>
                {lastInviteMailto && (
                  <a href={lastInviteMailto} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-cyan-600 text-white">
                    <Mail className="w-3.5 h-3.5" />
                    Open email
                  </a>
                )}
              </div>
            </div>
          )}

          {pendingInvites.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {pendingInvites.map(invite => (
                <li key={invite.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">{invite.email}</span>
                  <span className="text-xs text-slate-500">{roleLabel(invite.role)}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                    Pending
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyInviteLink(userInviteUrl(invite.token))}
                    className="p-1 text-slate-400 hover:text-cyan-700"
                    title="Copy invite link"
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={userInviteMailto(invite.email, invite.role, userInviteUrl(invite.token))}
                    className="p-1 text-slate-400 hover:text-cyan-700"
                    title="Open email"
                  >
                    <Mail className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void removePendingInvite(invite)}
                    className="p-1 text-slate-400 hover:text-red-600"
                    title="Revoke invite"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading users…
          </div>
        ) : profiles.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-500 text-center">No registered users yet. Invite someone above, or they can register and you set their level here.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {profiles.map(profile => {
              const grants = accessRowsForUser(profile, accessRows);
              const grantedIds = new Set(grants.map(row => row.project_id));
              const availableProjects = projects.filter(project => !grantedIds.has(project.id));
              const roleSeesAll = canEditOperations(profile.role);
              return (
                <li key={profile.user_id} className="px-5 py-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <Shield className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{profile.email || profile.user_id}</p>
                        <p className="text-xs text-slate-400">{roleLabel(profile.role)}</p>
                      </div>
                    </div>
                    <select
                      value={profile.role}
                      disabled={savingId === profile.user_id || !canEditAccess}
                      onChange={event => void changeRole(profile, event.target.value as AppRole)}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
                    >
                      {APP_ROLES.map(item => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:ml-12 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Project access</p>
                    {roleSeesAll ? (
                      <p className="text-xs text-slate-600">
                        {roleLabel(profile.role)} can open every project.
                      </p>
                    ) : grants.length === 0 ? (
                      <p className="text-xs text-slate-500">No project access yet.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {grants.map(row => (
                          <li
                            key={row.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                          >
                            <FolderOpen className="w-3 h-3 text-slate-400" />
                            <span className="max-w-[14rem] truncate">{projectById.get(row.project_id)?.label ?? `Project ${row.project_id}`}</span>
                            {!row.accepted_at && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Pending</span>
                            )}
                            {canEditAccess && (
                              <button
                                type="button"
                                onClick={() => void removeAccess(row)}
                                className="p-0.5 text-slate-300 hover:text-red-600"
                                title="Remove access"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {!roleSeesAll && canEditAccess && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          value={addProjectId[profile.user_id] ?? ''}
                          onChange={event => setAddProjectId(current => ({ ...current, [profile.user_id]: event.target.value }))}
                          disabled={availableProjects.length === 0 || addingFor === profile.user_id}
                          className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white disabled:opacity-50 min-w-[12rem]"
                        >
                          <option value="">{availableProjects.length === 0 ? 'All projects already granted' : 'Add a project…'}</option>
                          {availableProjects.map(project => (
                            <option key={project.id} value={project.id}>{project.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void addAccess(profile)}
                          disabled={!addProjectId[profile.user_id] || addingFor === profile.user_id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
                        >
                          {addingFor === profile.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                          Add access
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ul className="mt-6 space-y-2">
        {APP_ROLES.map(item => (
          <li key={item.value} className="text-sm text-slate-600">
            <span className="font-semibold text-slate-800">{item.label}:</span> {item.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
