import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCopy, FolderOpen, Loader2, Plus, Shield, Trash2, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { APP_ROLES, canEditOperations, isAppRole, roleLabel, type AppRole } from '../lib/appRoles';
import { useUserAccess } from '../lib/userAccess';
import {
  grantUserProjectAccess,
  listAllProjectEndUserAccess,
  revokeProjectEndUserInvite,
  type ProjectEndUserInvite,
} from '../lib/projectEndUserAccess';
import migration028Sql from '../../supabase/migrations/20260916140000_028_app_roles_and_simpro.sql?raw';

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
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);

  const projectById = useMemo(
    () => new Map(projects.map(project => [project.id, project])),
    [projects],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    const [{ data, error: loadError }, projectsRes, accessRes] = await Promise.all([
      supabase.from('app_profiles').select('user_id, email, role').order('created_at', { ascending: true }),
      supabase.from('projects').select('id, project_name, site_name, job_number').order('project_name', { ascending: true }),
      listAllProjectEndUserAccess(),
    ]);

    if (loadError) {
      setNeedsMigration(/does not exist|schema cache|42P01/i.test(loadError.message));
      setError(loadError.message);
      setProfiles([]);
      setProjects([]);
      setAccessRows([]);
      setLoading(false);
      return;
    }

    setNeedsMigration(accessRes.needsMigration);
    if (accessRes.error && !accessRes.needsMigration) setError(accessRes.error);
    setAccessRows(accessRes.rows);
    setProjects(
      (projectsRes.data ?? []).map(row => ({
        id: Number(row.id),
        label: projectLabel(row),
      })),
    );
    setProfiles(
      (data ?? []).map(row => ({
        user_id: String(row.user_id),
        email: String(row.email ?? ''),
        role: isAppRole(row.role) ? row.role : 'end_user',
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const copyMigrationSql = async () => {
    try {
      await navigator.clipboard.writeText(migration028Sql);
      setSqlCopied(true);
      window.setTimeout(() => setSqlCopied(false), 2500);
    } catch {
      setError('Clipboard is blocked. Copy supabase/migrations/20260916140000_028_app_roles_and_simpro.sql instead.');
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
          Set Admin/Staff/End user, then grant or remove individual project access for end users.
        </p>
      </div>

      {needsMigration && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900">Paste 028 (and 029 for project invites) in the Supabase SQL Editor if roles or project access are missing.</p>
          <button
            type="button"
            onClick={() => void copyMigrationSql()}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            {sqlCopied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
            {sqlCopied ? 'Copied 028 — paste in Supabase' : 'Copy 028 SQL'}
          </button>
        </div>
      )}

      {error && !needsMigration && (
        <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading users…
          </div>
        ) : profiles.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-500 text-center">No users yet. Ask people to register, then set their role here.</p>
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
