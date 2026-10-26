import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { CompaniesManager } from '../components/CompaniesManager';
import { canEditOperations, canManageUsers, defaultHomePath } from '../lib/appRoles';
import { useUserAccess } from '../lib/userAccess';
import { supabase } from '../lib/supabase';

export function CompaniesPage() {
  const { role, roleLoading, companyId, companyName, companyStatus, subscriptionPlan, refreshRole } = useUserAccess();
  const [accountName, setAccountName] = useState(companyName);
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  useEffect(() => {
    setAccountName(companyName);
    if (!companyId) return;
    void supabase.from('platform_companies').select('name, contact_email, phone').eq('id', companyId).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setAccountName(String(data.name ?? ''));
        setContactEmail(String(data.contact_email ?? ''));
        setPhone(String(data.phone ?? ''));
      });
  }, [companyId, companyName]);

  const saveAccount = async () => {
    if (!companyId) return;
    setAccountMessage(null);
    const { error } = await supabase.from('platform_companies').update({
      name: accountName.trim(),
      contact_email: contactEmail.trim() || null,
      phone: phone.trim() || null,
    }).eq('id', companyId);
    if (error) {
      setAccountMessage(error.message);
      return;
    }
    setAccountMessage('Company profile saved.');
    await refreshRole();
  };

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canEditOperations(role)) {
    return <Navigate to={defaultHomePath(role)} replace />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-slate-400" />
          <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Select a company to see its logo, colours and details. Those appear on O&amp;M packs, completion templates, and document headers and footers. Save keeps the details. Use the company on documents to switch existing projects.
        </p>
      </div>
      {canManageUsers(role) && companyId && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Company profile</h2>
          <p className="text-xs text-slate-500">
            Plan: {subscriptionPlan || 'standard'}. Status: {companyStatus || 'active'}. Subscription and suspension are changed by the platform owner.
          </p>
          <div className="grid sm:grid-cols-3 gap-2">
            <input value={accountName} onChange={event => setAccountName(event.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Company name" />
            <input value={contactEmail} onChange={event => setContactEmail(event.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Account email" />
            <input value={phone} onChange={event => setPhone(event.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Phone" />
          </div>
          <button type="button" onClick={() => void saveAccount()} className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white">
            Save profile
          </button>
          {accountMessage && <p className="text-xs text-slate-600">{accountMessage}</p>}
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <CompaniesManager />
      </div>
    </div>
  );
}
