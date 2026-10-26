import { useEffect, useState } from 'react';
import { Building2, Loader2, Shield } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { defaultHomePath, isPlatformMaster } from '../lib/appRoles';
import { useUserAccess } from '../lib/userAccess';
import { userInviteUrl } from '../lib/appUserInvites';

interface CompanyUsage {
  company_id: string;
  name: string;
  status: string;
  subscription_plan: string;
  subscription_status: string;
  contact_email: string | null;
  created_at: string;
  user_count: number;
  project_count: number;
  form_count: number;
  signed_pdf_count: number;
}

export function PlatformPage() {
  const { role, roleLoading } = useUserAccess();
  const [rows, setRows] = useState<CompanyUsage[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [plan, setPlan] = useState('standard');
  const [adminEmail, setAdminEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [usage, boundary] = await Promise.all([
      supabase.rpc('platform_company_usage'),
      supabase.rpc('platform_infrastructure_bypass'),
    ]);
    if (usage.error) {
      setError(usage.error.message);
      setRows([]);
    } else {
      setRows((usage.data ?? []) as CompanyUsage[]);
    }
    const payload = boundary.data as { notes?: string[] } | null;
    setNotes(Array.isArray(payload?.notes) ? payload.notes : []);
    setLoading(false);
  };

  useEffect(() => {
    if (role === 'master') void load();
  }, [role]);

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-700" />
      </div>
    );
  }

  if (!isPlatformMaster(role)) {
    return <Navigate to={defaultHomePath(role)} replace />;
  }

  const createCompany = async () => {
    setSaving(true);
    setError(null);
    setInviteUrl(null);
    const { data, error: createError } = await supabase.rpc('create_platform_company', {
      company_name: name.trim(),
      admin_email: adminEmail.trim(),
      contact_email: contactEmail.trim(),
      plan_name: plan.trim() || 'standard',
    });
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    const token = String((data as { invite_token?: string } | null)?.invite_token ?? '');
    if (token) setInviteUrl(userInviteUrl(token));
    setName('');
    setContactEmail('');
    setAdminEmail('');
    await load();
  };

  const setStatus = async (companyId: string, status: 'active' | 'suspended') => {
    setBusyId(companyId);
    setError(null);
    const { error: statusError } = await supabase.rpc('set_platform_company_status', {
      target: companyId,
      next_status: status,
    });
    setBusyId(null);
    if (statusError) {
      setError(statusError.message);
      return;
    }
    await load();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-slate-400" />
          <h1 className="text-2xl font-bold text-slate-900">Platform</h1>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Manage company accounts, subscriptions and suspension. This account cannot open customer records, documents, forms, signatures or integration credentials.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Create a company</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={name} onChange={event => setName(event.target.value)} placeholder="Company name" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={contactEmail} onChange={event => setContactEmail(event.target.value)} placeholder="Account email" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={plan} onChange={event => setPlan(event.target.value)} placeholder="Subscription plan" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={adminEmail} onChange={event => setAdminEmail(event.target.value)} placeholder="Company admin email" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button
          type="button"
          onClick={() => void createCompany()}
          disabled={saving || !name.trim() || !adminEmail.trim()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
          Create company and invite admin
        </button>
        {inviteUrl && <p className="text-xs font-mono text-slate-700 break-all">{inviteUrl}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading companies…
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Users</th>
                <th className="px-4 py-3 font-semibold">Projects</th>
                <th className="px-4 py-3 font-semibold">Forms</th>
                <th className="px-4 py-3 font-semibold">Signed PDFs</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => (
                <tr key={row.company_id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{row.name}</p>
                    <p className="text-xs text-slate-500">{row.contact_email || 'No account email'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.subscription_plan}</td>
                  <td className="px-4 py-3">{row.user_count}</td>
                  <td className="px-4 py-3">{row.project_count}</td>
                  <td className="px-4 py-3">{row.form_count}</td>
                  <td className="px-4 py-3">{row.signed_pdf_count}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={busyId === row.company_id}
                      onClick={() => void setStatus(row.company_id, row.status === 'active' ? 'suspended' : 'active')}
                      className={`text-xs font-semibold px-2 py-1 rounded-full ${row.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                    >
                      {busyId === row.company_id ? 'Saving…' : row.status === 'active' ? 'Active' : 'Suspended'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {notes.length > 0 && (
        <div className="bg-slate-950 text-slate-200 rounded-xl px-5 py-4 space-y-2">
          <h2 className="text-sm font-semibold text-white">Infrastructure access that bypasses the app account</h2>
          <ul className="space-y-2 text-sm text-slate-300">
            {notes.map(note => <li key={note}>{note}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
