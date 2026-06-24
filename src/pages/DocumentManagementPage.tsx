import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProject } from './ProjectLayout';
import type { Project, ProjectRevision } from '../types';
import {
  Building2, FileCheck, User, ClipboardList, RotateCcw,
  Save, Plus, Trash2, Upload, X, CheckCircle, Pencil,
  Phone, Mail, Globe, Hash, Award, Calendar,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContractorProfile {
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
}

interface DocumentAuthority {
  id?: number;
  project_id?: number;
  prepared_by: string;
  prepared_date: string;
  prepared_signature_url: string;
  checked_by: string;
  checked_date: string;
  checked_signature_url: string;
  approved_by: string;
  approved_date: string;
  approved_signature_url: string;
}

const BLANK_CONTRACTOR: ContractorProfile = {
  company_name: '', address_line1: '', address_line2: '', city: '', postcode: '',
  telephone: '', email: '', website: '', company_reg_number: '', vat_number: '',
  nsi_number: '', ssaib_number: '', other_certifications: '', logo_url: '',
};

const BLANK_AUTHORITY: DocumentAuthority = {
  prepared_by: '', prepared_date: '', prepared_signature_url: '',
  checked_by: '', checked_date: '', checked_signature_url: '',
  approved_by: '', approved_date: '', approved_signature_url: '',
};

type Tab = 'authority' | 'contractor' | 'project' | 'revisions';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'authority',  label: 'Document Authority',   icon: FileCheck },
  { id: 'contractor', label: 'Contractor Information', icon: Building2 },
  { id: 'project',    label: 'Project Information',   icon: ClipboardList },
  { id: 'revisions',  label: 'Revision Control',      icon: RotateCcw },
];

// ─── Shared input styles ───────────────────────────────────────────────────────

const ic = 'w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-shadow';
const label = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5';

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="fixed top-5 right-5 z-50 flex items-center gap-2.5 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-xl animate-fade-in-out text-sm font-medium">
      <CheckCircle className="w-4 h-4" />{message}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocumentManagementPage() {
  const { id } = useParams<{ id: string }>();
  const { project, refreshProject } = useProject();
  const pid = id ? parseInt(id) : null;

  const [tab, setTab] = useState<Tab>('authority');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);

  // Authority state
  const [authority, setAuthority] = useState<DocumentAuthority>(BLANK_AUTHORITY);
  const [authSaving, setAuthSaving] = useState(false);
  const [uploadingSig, setUploadingSig] = useState<string | null>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);
  const sigFieldRef = useRef<string>('');

  // Contractor state
  const [contractor, setContractor] = useState<ContractorProfile>(BLANK_CONTRACTOR);
  const [contractorSaving, setContractorSaving] = useState(false);

  // Project state
  const [projectForm, setProjectForm] = useState<Partial<Project & { main_contractor: string; project_number: string; engineer: string }>>({});
  const [projectSaving, setProjectSaving] = useState(false);

  // Revision state
  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  const [addingRev, setAddingRev] = useState(false);
  const [newRev, setNewRev] = useState({ revision_number: '', revised_at: new Date().toISOString().split('T')[0], description: '', revised_by: '', reviewer: '' });

  // ── Load ─────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!pid) return;
    const [
      { data: authData },
      { data: contrData },
      { data: revData },
    ] = await Promise.all([
      supabase.from('document_authority').select('*').eq('project_id', pid).maybeSingle(),
      supabase.from('contractor_profile').select('*').limit(1).maybeSingle(),
      supabase.from('project_revisions').select('*').eq('project_id', pid).order('revised_at', { ascending: false }),
    ]);
    if (authData) setAuthority({ ...BLANK_AUTHORITY, ...authData });
    if (contrData) setContractor({ ...BLANK_CONTRACTOR, ...contrData });
    setRevisions(revData ?? []);
    setLoading(false);
  }, [pid]);

  useEffect(() => {
    if (project) setProjectForm(project as any);
  }, [project]);

  useEffect(() => { load(); }, [load]);

  // ── Authority save ────────────────────────────────────────────────────────────

  const saveAuthority = async () => {
    if (!pid) return;
    setAuthSaving(true);
    const existing = authority.id;
    if (existing) {
      await supabase.from('document_authority').update({ ...authority }).eq('id', existing);
    } else {
      const { data } = await supabase.from('document_authority').insert({ ...authority, project_id: pid }).select().maybeSingle();
      if (data) setAuthority(a => ({ ...a, id: data.id }));
    }
    setAuthSaving(false);
    setToast('Document authority saved');
  };

  // ── Signature upload ──────────────────────────────────────────────────────────

  const triggerSigUpload = (field: string) => {
    sigFieldRef.current = field;
    sigInputRef.current?.click();
  };

  const handleSigUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pid) return;
    const field = sigFieldRef.current;
    setUploadingSig(field);
    const path = `${pid}/${field}_${Date.now()}.${file.name.split('.').pop()}`;
    const { error } = await supabase.storage.from('signatures').upload(path, file, { upsert: true });
    if (error) { alert('Upload failed: ' + error.message); setUploadingSig(null); return; }
    const { data: { publicUrl } } = supabase.storage.from('signatures').getPublicUrl(path);
    setAuthority(a => ({ ...a, [field]: publicUrl }));
    setUploadingSig(null);
    e.target.value = '';
  };

  // ── Contractor save ───────────────────────────────────────────────────────────

  const saveContractor = async () => {
    setContractorSaving(true);
    if (contractor.id) {
      await supabase.from('contractor_profile').update({ ...contractor }).eq('id', contractor.id);
    } else {
      const { data } = await supabase.from('contractor_profile').insert({ ...contractor }).select().maybeSingle();
      if (data) setContractor(c => ({ ...c, id: data.id }));
    }
    setContractorSaving(false);
    setToast('Contractor profile saved');
  };

  // ── Project save ──────────────────────────────────────────────────────────────

  const saveProject = async () => {
    if (!pid) return;
    setProjectSaving(true);
    await supabase.from('projects').update(projectForm as any).eq('id', pid);
    setProjectSaving(false);
    setToast('Project information saved');
    refreshProject();
  };

  // ── Revision add/delete ───────────────────────────────────────────────────────

  const addRevision = async () => {
    if (!pid || !newRev.revision_number) return;
    await supabase.from('project_revisions').insert({
      project_id: pid,
      revision_number: newRev.revision_number,
      description: newRev.description,
      revised_by: newRev.revised_by,
      revised_at: newRev.revised_at,
    });
    setNewRev({ revision_number: '', revised_at: new Date().toISOString().split('T')[0], description: '', revised_by: '', reviewer: '' });
    setAddingRev(false);
    load();
  };

  const deleteRevision = async (revId: number) => {
    await supabase.from('project_revisions').delete().eq('id', revId);
    setRevisions(r => r.filter(x => x.id !== revId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      <input ref={sigInputRef} type="file" accept="image/*" className="hidden" onChange={handleSigUpload} />

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4">
        <h2 className="font-semibold text-slate-900">Document Management</h2>
        <p className="text-sm text-slate-500 mt-0.5">All information here is automatically pulled into every generated document — enter it once, used everywhere.</p>
      </div>

      {/* Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-cyan-50 text-cyan-700 border-b-2 border-cyan-500' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}>
              <t.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === 'authority' && (
            <AuthorityTab
              authority={authority}
              onChange={setAuthority}
              onSave={saveAuthority}
              saving={authSaving}
              onUploadSig={triggerSigUpload}
              uploadingSig={uploadingSig}
            />
          )}
          {tab === 'contractor' && (
            <ContractorTab
              contractor={contractor}
              onChange={setContractor}
              onSave={saveContractor}
              saving={contractorSaving}
            />
          )}
          {tab === 'project' && (
            <ProjectTab
              form={projectForm}
              onChange={f => setProjectForm(f)}
              onSave={saveProject}
              saving={projectSaving}
            />
          )}
          {tab === 'revisions' && (
            <RevisionsTab
              revisions={revisions}
              onDelete={deleteRevision}
              addingRev={addingRev}
              setAddingRev={setAddingRev}
              newRev={newRev}
              setNewRev={setNewRev}
              onAdd={addRevision}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Document Authority tab ───────────────────────────────────────────────────

function AuthorityTab({ authority, onChange, onSave, saving, onUploadSig, uploadingSig }: {
  authority: DocumentAuthority;
  onChange: (a: DocumentAuthority) => void;
  onSave: () => void;
  saving: boolean;
  onUploadSig: (field: string) => void;
  uploadingSig: string | null;
}) {
  const roles = [
    { key: 'prepared', label: 'Prepared By' },
    { key: 'checked',  label: 'Checked By' },
    { key: 'approved', label: 'Approved By' },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Document Authority</h3>
          <p className="text-sm text-slate-500 mt-0.5">Record who prepared, checked, and approved this project's documents</p>
        </div>
        <button onClick={onSave} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {roles.map(r => (
          <div key={r.key} className="border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/50">
            <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
              <User className="w-4 h-4 text-slate-400" />{r.label}
            </h4>
            <div>
              <label className={label}>Name</label>
              <input type="text" value={(authority as any)[`${r.key}_by`] ?? ''} onChange={e => onChange({ ...authority, [`${r.key}_by`]: e.target.value })} className={ic} placeholder="Full name" />
            </div>
            <div>
              <label className={label}>Date</label>
              <input type="date" value={(authority as any)[`${r.key}_date`] ?? ''} onChange={e => onChange({ ...authority, [`${r.key}_date`]: e.target.value })} className={ic} />
            </div>
            <div>
              <label className={label}>Electronic Signature</label>
              {(authority as any)[`${r.key}_signature_url`] ? (
                <div className="space-y-2">
                  <div className="relative border border-emerald-200 bg-white rounded-lg p-2 h-16 flex items-center justify-center">
                    <img src={(authority as any)[`${r.key}_signature_url`]} alt="Signature" className="max-h-12 max-w-full object-contain" />
                    <button onClick={() => onChange({ ...authority, [`${r.key}_signature_url`]: '' })}
                      className="absolute top-1 right-1 p-0.5 text-slate-400 hover:text-red-500 rounded transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button onClick={() => onUploadSig(`${r.key}_signature_url`)} disabled={uploadingSig === `${r.key}_signature_url`}
                    className="w-full text-xs text-slate-500 hover:text-slate-700 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                    Replace signature
                  </button>
                </div>
              ) : (
                <button onClick={() => onUploadSig(`${r.key}_signature_url`)} disabled={uploadingSig === `${r.key}_signature_url`}
                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-400 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all text-sm disabled:opacity-50">
                  {uploadingSig === `${r.key}_signature_url` ? (
                    <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <><Upload className="w-4 h-4" />Upload signature image</>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Contractor Information tab ───────────────────────────────────────────────

function ContractorTab({ contractor, onChange, onSave, saving }: {
  contractor: ContractorProfile;
  onChange: (c: ContractorProfile) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const f = (field: keyof ContractorProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...contractor, [field]: e.target.value });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Contractor Information</h3>
          <p className="text-sm text-slate-500 mt-0.5">Your company details — saved globally and reused across all projects</p>
        </div>
        <button onClick={onSave} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Company details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="md:col-span-2">
          <label className={label}><Building2 className="inline w-3.5 h-3.5 mr-1" />Company Name</label>
          <input type="text" value={contractor.company_name} onChange={f('company_name')} className={ic} placeholder="Your company name" />
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

      {/* Registration & certification numbers */}
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

// ─── Project Information tab ──────────────────────────────────────────────────

function ProjectTab({ form, onChange, onSave, saving }: {
  form: any;
  onChange: (f: any) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const inp = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [field]: e.target.value });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Project Information</h3>
          <p className="text-sm text-slate-500 mt-0.5">Core project details automatically included in all generated documents</p>
        </div>
        <button onClick={onSave} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="md:col-span-2">
          <label className={label}>Project Name</label>
          <input type="text" value={form.project_name ?? ''} onChange={inp('project_name')} className={ic} placeholder="Project name" />
        </div>
        <div>
          <label className={label}>Project Number</label>
          <input type="text" value={form.project_number ?? ''} onChange={inp('project_number')} className={ic} placeholder="e.g., PRJ-2024-001" />
        </div>
        <div>
          <label className={label}>Quote / Reference Number</label>
          <input type="text" value={form.quote_number ?? ''} onChange={inp('quote_number')} className={ic} placeholder="Quote reference" />
        </div>
        <div>
          <label className={label}>Site Name</label>
          <input type="text" value={form.site_name ?? ''} onChange={inp('site_name')} className={ic} placeholder="Site name" />
        </div>
        <div>
          <label className={label}>Site Address</label>
          <input type="text" value={form.site_address ?? ''} onChange={inp('site_address')} className={ic} placeholder="Full site address" />
        </div>
        <div>
          <label className={label}>Client</label>
          <input type="text" value={form.client_name ?? ''} onChange={inp('client_name')} className={ic} placeholder="Client company name" />
        </div>
        <div>
          <label className={label}>Main Contractor</label>
          <input type="text" value={form.main_contractor ?? ''} onChange={inp('main_contractor')} className={ic} placeholder="Main contractor (if applicable)" />
        </div>
        <div>
          <label className={label}>Project Manager</label>
          <input type="text" value={form.project_manager ?? ''} onChange={inp('project_manager')} className={ic} placeholder="PM name" />
        </div>
        <div>
          <label className={label}>Engineer</label>
          <input type="text" value={form.engineer ?? ''} onChange={inp('engineer')} className={ic} placeholder="Lead engineer name" />
        </div>
        <div>
          <label className={label}><Calendar className="inline w-3.5 h-3.5 mr-1" />Start Date</label>
          <input type="date" value={form.start_date ?? ''} onChange={inp('start_date')} className={ic} />
        </div>
        <div>
          <label className={label}><Calendar className="inline w-3.5 h-3.5 mr-1" />Completion Date</label>
          <input type="date" value={form.completion_date ?? ''} onChange={inp('completion_date')} className={ic} />
        </div>
        <div>
          <label className={label}>Status</label>
          <select value={form.project_status ?? ''} onChange={inp('project_status')} className={ic}>
            <option value="">Select status…</option>
            {['active', 'on-hold', 'completed', 'cancelled'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={label}>Project Notes</label>
          <textarea value={form.project_notes ?? ''} onChange={inp('project_notes')} rows={3} className={`${ic} resize-none`} placeholder="Internal notes about this project" />
        </div>
      </div>
    </div>
  );
}

// ─── Revision Control tab ─────────────────────────────────────────────────────

function RevisionsTab({ revisions, onDelete, addingRev, setAddingRev, newRev, setNewRev, onAdd }: {
  revisions: ProjectRevision[];
  onDelete: (id: number) => void;
  addingRev: boolean;
  setAddingRev: (v: boolean) => void;
  newRev: any;
  setNewRev: (v: any) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Revision Control</h3>
          <p className="text-sm text-slate-500 mt-0.5">Track all document revisions with author, reviewer, date, and comments</p>
        </div>
        <button onClick={() => setAddingRev(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors">
          <Plus className="w-4 h-4" />Add Revision
        </button>
      </div>

      {/* Revision table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Rev No.</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Comments</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Author</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Reviewer</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {revisions.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">No revisions yet</td></tr>
            )}
            {revisions.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-mono font-semibold text-slate-800">{r.revision_number}</td>
                <td className="px-4 py-3 text-slate-600">{r.revised_at ? new Date(r.revised_at).toLocaleDateString('en-GB') : '—'}</td>
                <td className="px-4 py-3 text-slate-700">{r.description || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{r.revised_by || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{(r as any).reviewer || '—'}</td>
                <td className="px-2 py-3">
                  <button onClick={() => onDelete(r.id)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add revision inline form */}
      {addingRev && (
        <div className="border border-cyan-200 bg-cyan-50 rounded-xl p-5 space-y-4">
          <h4 className="font-semibold text-cyan-800 text-sm">New Revision</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={label}>Revision Number</label>
              <input type="text" value={newRev.revision_number} onChange={e => setNewRev({ ...newRev, revision_number: e.target.value })} className={ic} placeholder="e.g., A, B, 1, 2" />
            </div>
            <div>
              <label className={label}>Date</label>
              <input type="date" value={newRev.revised_at} onChange={e => setNewRev({ ...newRev, revised_at: e.target.value })} className={ic} />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className={label}>Author</label>
              <input type="text" value={newRev.revised_by} onChange={e => setNewRev({ ...newRev, revised_by: e.target.value })} className={ic} placeholder="Name" />
            </div>
            <div>
              <label className={label}>Reviewer</label>
              <input type="text" value={newRev.reviewer} onChange={e => setNewRev({ ...newRev, reviewer: e.target.value })} className={ic} placeholder="Name" />
            </div>
            <div className="col-span-2 md:col-span-2">
              <label className={label}>Comments</label>
              <input type="text" value={newRev.description} onChange={e => setNewRev({ ...newRev, description: e.target.value })} className={ic} placeholder="Description of changes" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors">
              <Plus className="w-3.5 h-3.5" />Add
            </button>
            <button onClick={() => setAddingRev(false)}
              className="px-4 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
