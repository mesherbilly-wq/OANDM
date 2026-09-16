import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, Loader2, Shield, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { APP_ROLES, isAppRole, roleLabel, type AppRole } from '../lib/appRoles';
import { useUserAccess } from '../lib/userAccess';
import migration028Sql from '../../supabase/migrations/20260916140000_028_app_roles_and_simpro.sql?raw';

interface ProfileRow {
  user_id: string;
  email: string;
  role: AppRole;
}

export function UsersPage() {
  const { role: myRole, refreshRole } = useUserAccess();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('app_profiles')
      .select('user_id, email, role')
      .order('created_at', { ascending: true });

    if (loadError) {
      setNeedsMigration(/does not exist|schema cache|42P01/i.test(loadError.message));
      setError(loadError.message);
      setProfiles([]);
      setLoading(false);
      return;
    }

    setNeedsMigration(false);
    setProfiles(
      (data ?? [])
        .map(row => ({
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

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-md">
            <Users className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        </div>
        <p className="text-slate-500 ml-[52px]">
          New people register from a project invite, or you change Staff/Admin here. End users only see projects they were invited to.
        </p>
      </div>

      {needsMigration && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900">Paste 028 in the Supabase SQL Editor to create roles and keep Simpro saved.</p>
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
            {profiles.map(profile => (
              <li key={profile.user_id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
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
                  disabled={savingId === profile.user_id || myRole !== 'admin'}
                  onChange={event => void changeRole(profile, event.target.value as AppRole)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
                >
                  {APP_ROLES.map(item => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </li>
            ))}
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
