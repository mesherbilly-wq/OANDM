import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award, Building2, Globe, Hash, Mail, Phone, Plus, Save, Trash2, Upload,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_BRAND_INK,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_TAGLINE,
  normalizeBrandHex,
} from '../lib/contractorBrand';

export interface CompanyForm {
  id?: number;
  company_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postcode: string;
  telephone: string;
  email: string;
  website: string;
  company_reg_number: string;
  vat_number: string;
  nsi_number: string;
  ssaib_number: string;
  other_certifications: string;
  logo_url: string;
  brand_primary: string;
  brand_ink: string;
  tagline: string;
  is_default: boolean;
}

const BLANK: CompanyForm = {
  company_name: '', address_line1: '', address_line2: '', city: '', postcode: '',
  telephone: '', email: '', website: '', company_reg_number: '', vat_number: '',
  nsi_number: '', ssaib_number: '', other_certifications: '', logo_url: '',
  brand_primary: DEFAULT_BRAND_PRIMARY, brand_ink: DEFAULT_BRAND_INK,
  tagline: DEFAULT_BRAND_TAGLINE, is_default: false,
};

const ic = 'w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-shadow';
const label = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5';

function normalizeRow(row: Partial<CompanyForm>): CompanyForm {
  return {
    ...BLANK,
    ...row,
    brand_primary: normalizeBrandHex(row.brand_primary, DEFAULT_BRAND_PRIMARY),
    brand_ink: normalizeBrandHex(row.brand_ink, DEFAULT_BRAND_INK),
    tagline: row.tagline || DEFAULT_BRAND_TAGLINE,
    is_default: Boolean(row.is_default),
  };
}

export function CompaniesManager({
  variant = 'global',
  projectId,
  onAssigned,
}: {
  variant?: 'global' | 'project';
  projectId?: number | null;
  onAssigned?: () => void;
}) {
  const isProject = variant === 'project';
  const [companies, setCompanies] = useState<CompanyForm[]>([]);
  const [contractor, setContractor] = useState<CompanyForm>(BLANK);
  const [projectCompanyId, setProjectCompanyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [toast, setToast] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const selectedCompanyIdRef = useRef<number | 'draft' | null>(null);

  const load = useCallback(async (opts?: { selectId?: number | 'draft' | null }) => {
    const [{ data: contrData }, projectRow] = await Promise.all([
      supabase.from('contractor_profile').select('*').order('company_name'),
      projectId
        ? supabase.from('projects').select('contractor_profile_id').eq('id', projectId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const rows = ((contrData ?? []) as CompanyForm[])
      .map(normalizeRow)
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.company_name.localeCompare(b.company_name));
    setCompanies(rows);
    const assignedId = projectRow.data?.contractor_profile_id ?? rows.find(row => row.is_default)?.id ?? rows[0]?.id ?? null;
    setProjectCompanyId(assignedId);
    const keepId = opts?.selectId !== undefined ? opts.selectId : selectedCompanyIdRef.current;
    if (keepId === 'draft') {
      selectedCompanyIdRef.current = 'draft';
      setLoading(false);
      return;
    }
    const selected = (typeof keepId === 'number' ? rows.find(row => row.id === keepId) : undefined)
      ?? rows.find(row => row.id === assignedId)
      ?? rows[0];
    selectedCompanyIdRef.current = selected?.id ?? null;
    setContractor(selected ? normalizeRow(selected) : { ...BLANK, is_default: rows.length === 0 });
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    const { id: contractorId, ...payload } = {
      ...contractor,
      brand_primary: normalizeBrandHex(contractor.brand_primary, DEFAULT_BRAND_PRIMARY),
      brand_ink: normalizeBrandHex(contractor.brand_ink, DEFAULT_BRAND_INK),
    };
    if (contractor.is_default) {
      await supabase.from('contractor_profile').update({ is_default: false }).neq('id', contractorId ?? 0);
    }
    if (contractorId) {
      const { error } = await supabase.from('contractor_profile').update(payload).eq('id', contractorId);
      if (error) { setSaving(false); alert(error.message); return; }
      setSaving(false);
      setToast('Company details saved');
      await load({ selectId: contractorId });
      return;
    }
    const { data, error } = await supabase.from('contractor_profile').insert({
      ...payload,
      is_default: contractor.is_default || companies.length === 0,
    }).select().maybeSingle();
    if (error || !data?.id) {
      setSaving(false);
      alert(error?.message ?? 'Could not add company');
      return;
    }
    selectedCompanyIdRef.current = data.id;
    setSaving(false);
    setToast('Company added');
    await load({ selectId: data.id });
  };

  const addCompany = () => {
    selectedCompanyIdRef.current = 'draft';
    setContractor({ ...BLANK, is_default: companies.length === 0 });
    setToast('New company — fill the details and Save to add it');
  };

  const selectCompany = (id: number) => {
    const next = companies.find(row => row.id === id);
    if (!next) return;
    selectedCompanyIdRef.current = id;
    setContractor(normalizeRow(next));
  };

  const deleteCompany = async (id: number | undefined) => {
    if (!id) return;
    if (companies.length < 2) {
      alert('Keep at least one company.');
      return;
    }
    if (!confirm('Delete this company? Projects using it will fall back to the default company.')) return;
    const { error } = await supabase.from('contractor_profile').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    selectedCompanyIdRef.current = null;
    await load();
    setToast('Company deleted');
  };

  const assignToProject = async (id: number | undefined) => {
    if (!projectId || !id) return;
    const { error } = await supabase.from('projects').update({ contractor_profile_id: id }).eq('id', projectId);
    if (error) { alert(error.message); return; }
    setProjectCompanyId(id);
    onAssigned?.();
    setToast('This project now uses this company on O&M packs');
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!contractor.id) {
      alert('Save the company first, then upload a logo.');
      e.target.value = '';
      return;
    }
    setLogoUploading(true);
    const ext = file.name.split('.').pop() || 'png';
    const path = `${contractor.id}/logo_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('company-logos').upload(path, file, { upsert: true });
    if (error) {
      alert('Logo upload failed: ' + error.message);
      setLogoUploading(false);
      e.target.value = '';
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from('company-logos').getPublicUrl(path);
    setContractor(c => ({ ...c, logo_url: publicUrl }));
    await supabase.from('contractor_profile').update({ logo_url: publicUrl }).eq('id', contractor.id);
    setLogoUploading(false);
    e.target.value = '';
    setToast('Logo saved');
  };

  const f = (field: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setContractor({ ...contractor, [field]: e.target.value });
  const isProjectCompany = Boolean(contractor.id && contractor.id === projectCompanyId);
  const primary = normalizeBrandHex(contractor.brand_primary, DEFAULT_BRAND_PRIMARY);
  const ink = normalizeBrandHex(contractor.brand_ink, DEFAULT_BRAND_INK);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-40">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isProject && companies.length === 0) {
    return (
      <div className="text-center py-10 px-6">
        <p className="text-sm text-slate-500">No companies yet. Add logos, colours and companies before you use them on a project.</p>
        <Link to="/companies" className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-700">
          Open Companies
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoUpload} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800">{isProject ? 'Project company' : 'Companies'}</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            {isProject
              ? 'Choose which company this project O&M uses. Add logos, colours and new companies on the Companies page first.'
              : 'Add companies, logos and O&M colours here before you create a project. Save writes that company only — it does not replace the others.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isProject ? (
            <Link to="/companies" className="inline-flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 font-medium text-sm text-slate-700">
              Manage companies
            </Link>
          ) : (
            <button onClick={addCompany} type="button"
              className="inline-flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 font-medium text-sm text-slate-700">
              <Plus className="w-4 h-4" />Add company
            </button>
          )}
          <button onClick={() => void save()} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors disabled:opacity-50">
            <Save className="w-4 h-4" />{saving ? 'Saving…' : contractor.id ? 'Save' : 'Save new company'}
          </button>
        </div>
      </div>

      {(companies.length > 0 || !contractor.id) && (
        <div className="flex flex-wrap gap-2">
          {companies.map(company => {
            const active = Boolean(contractor.id && company.id === contractor.id);
            return (
              <button
                key={company.id}
                type="button"
                onClick={() => company.id && selectCompany(company.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  active ? 'bg-cyan-50 text-cyan-800 border-cyan-300' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {company.company_name || 'Untitled company'}
                {company.is_default ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">Default</span> : null}
                {isProject && company.id === projectCompanyId ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-emerald-600">This project</span> : null}
              </button>
            );
          })}
          {!contractor.id && (
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium border bg-cyan-50 text-cyan-800 border-cyan-300">
              New company
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isProject && (
          <button type="button" onClick={() => void assignToProject(contractor.id)} disabled={!contractor.id || isProjectCompany}
            className="inline-flex items-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 text-sm font-medium disabled:opacity-40">
            Use this company on this project&apos;s O&amp;M
          </button>
        )}
        {!isProject && (
          <button type="button" onClick={() => void deleteCompany(contractor.id)} disabled={!contractor.id || companies.length < 2}
            className="inline-flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium disabled:opacity-40">
            <Trash2 className="w-4 h-4" />Delete company
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="md:col-span-2">
          <label className={label}><Building2 className="inline w-3.5 h-3.5 mr-1" />Company Name</label>
          <input type="text" value={contractor.company_name} onChange={f('company_name')} className={ic} placeholder="Your company name" />
        </div>
        <div className="md:col-span-2">
          <label className={label}>O&amp;M tagline</label>
          <input type="text" value={contractor.tagline} onChange={f('tagline')} className={ic} placeholder={DEFAULT_BRAND_TAGLINE} />
        </div>
        <div>
          <label className={label}>Address Line 1</label>
          <input type="text" value={contractor.address_line1} onChange={f('address_line1')} className={ic} placeholder="Building / street" />
        </div>
        <div>
          <label className={label}>Address Line 2</label>
          <input type="text" value={contractor.address_line2} onChange={f('address_line2')} className={ic} placeholder="District (optional)" />
        </div>
        <div>
          <label className={label}>City / Town</label>
          <input type="text" value={contractor.city} onChange={f('city')} className={ic} placeholder="City" />
        </div>
        <div>
          <label className={label}>Postcode</label>
          <input type="text" value={contractor.postcode} onChange={f('postcode')} className={ic} placeholder="Postcode" />
        </div>
        <div>
          <label className={label}><Phone className="inline w-3.5 h-3.5 mr-1" />Telephone</label>
          <input type="tel" value={contractor.telephone} onChange={f('telephone')} className={ic} placeholder="01234 567890" />
        </div>
        <div>
          <label className={label}><Mail className="inline w-3.5 h-3.5 mr-1" />Email</label>
          <input type="email" value={contractor.email} onChange={f('email')} className={ic} placeholder="info@company.co.uk" />
        </div>
        <div className="md:col-span-2">
          <label className={label}><Globe className="inline w-3.5 h-3.5 mr-1" />Website</label>
          <input type="text" value={contractor.website} onChange={f('website')} className={ic} placeholder="www.company.co.uk" />
        </div>
      </div>

      {!isProject && (
        <div className="border-t border-slate-100 pt-5 space-y-4">
          <h4 className="text-sm font-semibold text-slate-700">O&amp;M branding</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={label}>Logo</label>
              {contractor.logo_url ? (
                <div className="flex items-center gap-3">
                  <img src={contractor.logo_url} alt="" className="h-12 max-w-[10rem] object-contain border border-slate-200 rounded bg-white px-2 py-1" />
                  <div className="space-y-1">
                    <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoUploading} className="text-sm text-cyan-700 hover:underline">
                      {logoUploading ? 'Uploading…' : 'Replace logo'}
                    </button>
                    <button type="button" onClick={() => setContractor({ ...contractor, logo_url: '' })} className="block text-sm text-slate-500 hover:text-red-600">Remove</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
                  className="w-full flex items-center justify-center gap-2 py-6 border-2 border-dashed border-slate-300 rounded-lg text-slate-400 hover:border-cyan-400 hover:text-cyan-600 text-sm">
                  <Upload className="w-4 h-4" />{logoUploading ? 'Uploading…' : 'Upload company logo'}
                </button>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <label className={label}>Primary colour</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={primary} onChange={e => setContractor({ ...contractor, brand_primary: e.target.value })} className="h-10 w-12 border border-slate-200 rounded cursor-pointer" />
                  <input type="text" value={contractor.brand_primary} onChange={f('brand_primary')} className={ic} placeholder="#C00000" />
                </div>
              </div>
              <div>
                <label className={label}>Text colour</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={ink} onChange={e => setContractor({ ...contractor, brand_ink: e.target.value })} className="h-10 w-12 border border-slate-200 rounded cursor-pointer" />
                  <input type="text" value={contractor.brand_ink} onChange={f('brand_ink')} className={ic} placeholder="#404040" />
                </div>
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={contractor.is_default}
              onChange={e => setContractor({ ...contractor, is_default: e.target.checked })}
              className="rounded border-slate-300"
            />
            Default company for new projects
          </label>
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: primary }}>
            <div className="px-4 py-3 text-white text-sm font-semibold" style={{ background: primary }}>
              {contractor.company_name || 'Company preview'}
            </div>
            <div className="px-4 py-3 text-xs" style={{ color: ink }}>
              {contractor.tagline || DEFAULT_BRAND_TAGLINE}
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 pt-5">
        <h4 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Hash className="w-4 h-4 text-slate-400" />Registration & Certification Numbers
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={label}>Companies House Reg Number</label>
            <input type="text" value={contractor.company_reg_number} onChange={f('company_reg_number')} className={ic} placeholder="12345678" />
          </div>
          <div>
            <label className={label}>VAT Number</label>
            <input type="text" value={contractor.vat_number} onChange={f('vat_number')} className={ic} placeholder="GB 123 4567 89" />
          </div>
          <div>
            <label className={label}><Award className="inline w-3.5 h-3.5 mr-1" />NSI Number</label>
            <input type="text" value={contractor.nsi_number} onChange={f('nsi_number')} className={ic} placeholder="NSI number" />
          </div>
          <div>
            <label className={label}><Award className="inline w-3.5 h-3.5 mr-1" />SSAIB Number</label>
            <input type="text" value={contractor.ssaib_number} onChange={f('ssaib_number')} className={ic} placeholder="SSAIB number" />
          </div>
          <div className="md:col-span-2">
            <label className={label}>Other Certification Numbers</label>
            <textarea value={contractor.other_certifications} onChange={f('other_certifications')} rows={2}
              className={`${ic} resize-none`} placeholder="e.g., CHAS, Safe Contractor, ISO 9001:2015 — one per line" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="fixed top-5 right-5 z-50 flex items-center gap-2.5 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-xl animate-fade-in-out text-sm font-medium">
      {message}
    </div>
  );
}
