import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, Loader2, Mail, Trash2, UserPlus } from 'lucide-react';
import {
  createProjectEndUserInvite,
  listProjectEndUserInvites,
  revokeProjectEndUserInvite,
  type ProjectEndUserInvite,
} from '../lib/projectEndUserAccess';
import migration029Sql from '../../supabase/migrations/20260916150000_029_project_end_user_invites.sql?raw';

export function OmClientInvitePanel({ projectId }: { projectId: number }) {
  const [email, setEmail] = useState('');
  const [invites, setInvites] = useState<ProjectEndUserInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [lastMailto, setLastMailto] = useState<string | null>(null);
  const [sqlCopied, setSqlCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await listProjectEndUserInvites(projectId);
    setInvites(result.invites);
    setNeedsMigration(result.needsMigration);
    if (result.error && !result.needsMigration) setError(result.error);
    else if (!result.needsMigration) setError(null);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const copySql = async () => {
    await navigator.clipboard.writeText(migration029Sql);
    setSqlCopied(true);
    window.setTimeout(() => setSqlCopied(false), 2500);
  };

  const invite = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await createProjectEndUserInvite(projectId, email);
      setLastUrl(result.url);
      setLastMailto(result.mailtoHref);
      setEmail('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm print:hidden">
      <div className="flex items-center gap-2 mb-1">
        <UserPlus className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-900">Invite client to this O&amp;M pack</h3>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        They only see this project. Invite them to another project as well if they need that pack too.
      </p>

      {needsMigration && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-900 font-semibold mb-2">Paste 029 in the Supabase SQL Editor to turn on client invites.</p>
          <button type="button" onClick={() => void copySql()} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900">
            {sqlCopied ? 'Copied 029 — paste in Supabase' : 'Copy 029 SQL'}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void invite()}
          placeholder="client@company.co.uk"
          className="flex-1 min-w-[14rem] border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void invite()}
          disabled={saving || !email.trim() || needsMigration}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          Create invite
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      {lastUrl && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-2">
          <p className="text-xs font-mono text-slate-700 break-all">{lastUrl}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void copyLink(lastUrl)} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border border-emerald-300 bg-white text-emerald-800">
              {copied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
              Copy link
            </button>
            {lastMailto && (
              <a href={lastMailto} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-cyan-600 text-white">
                <Mail className="w-3.5 h-3.5" />Open email
              </a>
            )}
          </div>
        </div>
      )}

      <div className="mt-3">
        {loading ? (
          <p className="text-xs text-slate-400">Loading invites…</p>
        ) : invites.length === 0 ? (
          <p className="text-xs text-slate-400">No clients invited to this project yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {invites.map(inviteRow => (
              <li key={inviteRow.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 min-w-0 truncate">{inviteRow.email}</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${inviteRow.accepted_at ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {inviteRow.accepted_at ? 'Accepted' : 'Pending'}
                </span>
                <button
                  type="button"
                  onClick={() => void revokeProjectEndUserInvite(inviteRow.id).then(load).catch(e => setError(e.message))}
                  className="p-1 text-slate-400 hover:text-red-600"
                  title="Remove access"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
