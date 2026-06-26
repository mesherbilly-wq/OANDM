import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import {
  documentMatchesSystem,
  loadDocumentProjectSystems,
  PROJECT_WIDE_SYSTEM_KEY,
  PROJECT_WIDE_SYSTEM_LABEL,
  resolveActiveDocumentSystem,
  systemAssignmentFields,
} from '../lib/documentProjectSystems';
import { getCategoryStyle, type ProjectSystem } from '../lib/systems';
import SafetyCulturePage from './SafetyCulturePage';
import {
  Upload, X, ExternalLink, CheckCircle, FileText, Loader2,
  Camera, Lock, ShieldAlert, Award, GraduationCap,
  ClipboardCheck, Shield, HardHat, Plus, Link2, Download,
  RefreshCw, AlertCircle, Network, Phone, Car, Trash2, Settings,
  FolderPlus,
} from 'lucide-react';

function scInspectionUrl(id: string): string {
  if (id.startsWith('audit_')) return `https://app.safetyculture.com/inspection/${id}`;
  if (id.startsWith('insp_')) return `https://app.safetyculture.com/inspection/audit_${id.slice(5)}`;
  return `https://app.safetyculture.com/inspection/audit_${id.replace(/-/g, '')}`;
}

// ── Document definitions ─────────────────────────────────────────────────────

interface DocDef {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  systems?: string[];
  scEnabled: boolean;
  multi?: boolean;
}

const SC_DOCUMENTS: DocDef[] = [
  { id: 'handover_cctv',           title: 'CCTV Handover Certificate',                description: 'Signed customer acceptance for CCTV systems',                    icon: Camera,        systems: ['CCTV'],           scEnabled: true },
  { id: 'handover_ac',             title: 'Access Control Handover Certificate',       description: 'Signed customer acceptance for access control systems',           icon: Lock,          systems: ['Access Control'], scEnabled: true },
  { id: 'handover_intruder',       title: 'Intruder Alarm Completion Certificate',     description: 'Intruder alarm system completion & commissioning cert',           icon: ShieldAlert,   systems: ['Intruder'],       scEnabled: true },
  { id: 'handover_intruder_record',title: 'Intruder Record of System Checks',         description: "Engineer's record of all intruder system checks and test results", icon: ClipboardCheck,systems: ['Intruder'],       scEnabled: true },
  { id: 'handover_anpr',           title: 'ANPR Handover Certificate',                description: 'Signed customer acceptance for ANPR systems',                     icon: Car,           systems: ['ANPR'],           scEnabled: true },
  { id: 'handover_intercom',       title: 'Intercom Handover Certificate',             description: 'Signed customer acceptance for intercom systems',                 icon: Phone,         systems: ['Intercom'],       scEnabled: true },
  { id: 'handover_networking',     title: 'Networking Handover Certificate',           description: 'Signed customer acceptance for networking infrastructure',         icon: Network,       systems: ['Networking'],     scEnabled: true },
  { id: 'handover_training',       title: 'Training Record',                           description: 'Signed training record for customer staff',                       icon: GraduationCap, scEnabled: true },
  { id: 'handover_acceptance',     title: 'System Acceptance Certificate',             description: 'Overall project acceptance signed by customer',                   icon: Award,         scEnabled: true },
];

const UPLOAD_ONLY_DOCUMENTS: DocDef[] = [
  { id: 'nsi_certificate', title: 'NSI Certificate',  description: 'NSI / certification body approval certificate', icon: Shield, scEnabled: false },
  { id: 'rams',            title: 'RAMS',             description: 'Risk Assessment & Method Statements', icon: HardHat, scEnabled: false, multi: true },
];

type DocStatus = 'not_started' | 'in_progress' | 'completed' | 'imported' | 'uploaded';

interface HandoverDoc {
  id: number;
  document_type: string;
  title: string;
  system_type: string | null;
  project_system_id: number | null;
  status: DocStatus;
  sc_inspection_id: string | null;
  sc_inspection_name: string | null;
  sc_result: string | null;
  sc_score_pct: number | null;
  sc_engineer_name: string | null;
  sc_completion_date: string | null;
  sc_imported_at: string | null;
  file_name: string | null;
  file_url: string | null;
}

interface LegacyUpload {
  id: number;
  section: string;
  system_type: string | null;
  project_system_id: number | null;
  file_name: string;
  file_url: string;
}

interface OtherDoc {
  id: number;
  title: string;
  description: string | null;
  system_type: string | null;
  project_system_id: number | null;
  file_name: string | null;
  file_url: string | null;
  link_url: string | null;
}

const STATUS_CONFIG: Record<DocStatus, { label: string; color: string }> = {
  not_started: { label: 'Not Started', color: 'bg-slate-100 text-slate-500 border-slate-200' },
  in_progress: { label: 'In Progress', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  completed:   { label: 'Completed',   color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  imported:    { label: 'Imported',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  uploaded:    { label: 'Uploaded',    color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
};

export default function HandoverPage() {
  const { project } = useProject();
  const pid = project?.id;

  const [activeTab, setActiveTab] = useState<'documents' | 'safetyculture'>('documents');
  const [docs, setDocs] = useState<HandoverDoc[]>([]);
  const [legacyUploads, setLegacyUploads] = useState<LegacyUpload[]>([]);
  const [otherDocs, setOtherDocs] = useState<OtherDoc[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [projectSystems, setProjectSystems] = useState<ProjectSystem[]>([]);
  const [activeSystemKey, setActiveSystemKey] = useState<string>(PROJECT_WIDE_SYSTEM_KEY);
  const [loading, setLoading] = useState(true);
  const [scConnected, setScConnected] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [savedMappings, setSavedMappings] = useState<Record<string, SCTemplateMapping>>({});

  // Modal states
  const [activeDoc, setActiveDoc] = useState<DocDef | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'link' | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [linkInspectionId, setLinkInspectionId] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [importingDoc, setImportingDoc] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadDocRef = useRef('');

  // Other docs modal
  const [showOtherModal, setShowOtherModal] = useState(false);
  const [otherTitle, setOtherTitle] = useState('');
  const [otherDesc, setOtherDesc] = useState('');
  const [otherMode, setOtherMode] = useState<'upload' | 'link'>('upload');
  const [otherLink, setOtherLink] = useState('');
  const [otherLinkVerified, setOtherLinkVerified] = useState<boolean | null>(null);
  const [otherLinkVerifying, setOtherLinkVerifying] = useState(false);
  const [otherFile, setOtherFile] = useState<File | null>(null);
  const [otherSaving, setOtherSaving] = useState(false);
  const otherFileRef = useRef<HTMLInputElement>(null);

  const invoke = async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('safetyculture-proxy', { body: { action, ...extra } });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const load = useCallback(async () => {
    if (!pid) return;
    const [{ data: docRows }, { data: uploadRows }, { data: otherRows }, { data: devRows }, { data: tokRow }, { data: maps }] = await Promise.all([
      supabase.from('project_handover_docs').select('*').eq('project_id', pid),
      supabase.from('om_pack_uploads').select('*').eq('project_id', pid).or('section.like.handover_%,section.eq.nsi_certificate,section.eq.rams'),
      supabase.from('handover_other_docs').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('devices').select('*').eq('project_id', pid),
      supabase.from('integration_settings').select('value').eq('key', 'safetyculture_api_token').maybeSingle(),
      supabase.from('sc_template_mappings').select('*'),
    ]);
    setDocs((docRows ?? []) as HandoverDoc[]);
    setLegacyUploads((uploadRows ?? []) as LegacyUpload[]);
    setOtherDocs((otherRows ?? []) as OtherDoc[]);
    setDevices(devRows ?? []);
    setProjectSystems(await loadDocumentProjectSystems(pid, devRows ?? []));
    setScConnected(!!tokRow?.value);
    const byTmpl: Record<string, SCTemplateMapping> = {};
    for (const m of maps ?? []) byTmpl[m.template_id] = m;
    setSavedMappings(byTmpl);
    setLoading(false);
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (scConnected) {
      invoke('list_templates').then(d => setTemplates(d.templates ?? [])).catch(() => {});
    }
  }, [scConnected]);

  // Determine which systems are installed (legacy helper — doc visibility uses project systems tabs)
  const installedSystems = [...new Set(devices.map(d => d.system_type).filter(Boolean))] as string[];
  const activeDocumentSystem = resolveActiveDocumentSystem(projectSystems, activeSystemKey);
  const activeSystemFields = systemAssignmentFields(activeDocumentSystem);

  const docMatchesActiveSystem = (record: { system_type?: string | null; project_system_id?: number | null }) => {
    if (activeSystemKey === PROJECT_WIDE_SYSTEM_KEY) {
      return !record.system_type?.trim() && record.project_system_id == null;
    }
    if (!activeDocumentSystem) return false;
    return documentMatchesSystem(record, activeDocumentSystem);
  };

  // Filter SC documents to only show relevant ones (legacy category hint; all show on active system tab)
  const visibleScDocs = SC_DOCUMENTS.filter(doc => {
    if (activeSystemKey !== PROJECT_WIDE_SYSTEM_KEY && doc.systems) return true;
    if (!doc.systems) return true;
    return doc.systems.some(s => installedSystems.includes(s));
  });

  const getDocRecord = (docType: string) =>
    docs.find(d => d.document_type === docType && docMatchesActiveSystem(d));
  const getLegacyUpload = (section: string) =>
    legacyUploads.find(u => u.section === section && docMatchesActiveSystem(u));
  const getLegacyUploads = (section: string) =>
    legacyUploads.filter(u => u.section === section && docMatchesActiveSystem(u));

  const buildInspectionName = (docTitle: string) => {
    const name = project.project_name || project.job_number || 'Project';
    return `${name} - ${docTitle}`;
  };

  // ── Create from SafetyCulture ──────────────────────────────────────────────
  const createFromSC = async () => {
    if (!activeDoc || !selectedTemplateId || !pid) return;
    setActionLoading(true);
    try {
      const mapping = savedMappings[selectedTemplateId];
      const items: any[] = [];
      if (mapping) {
        const fm = mapping.field_mappings;
        const addText = (key: string, value: string | null | undefined) => {
          if (fm[key] && value) items.push({ item_id: fm[key], item_type: 'TEXT', text_item: { value } });
        };
        addText('job_number', project.job_number);
        addText('project_name', project.project_name);
        addText('client_name', project.client_name);
        addText('site_name', project.site_name);
        addText('site_address', project.site_address);
        addText('project_manager', project.project_manager);
      }

      const inspName = buildInspectionName(activeDoc.title);
      const d = await invoke('create_inspection', { template_id: selectedTemplateId, items, name: inspName });
      const inspId = d.inspection_id;

      await supabase.from('project_handover_docs').upsert({
        project_id: pid,
        document_type: activeDoc.id,
        title: activeDoc.title,
        status: 'in_progress',
        sc_inspection_id: inspId,
        sc_template_id: selectedTemplateId,
        sc_inspection_name: inspName,
        ...activeSystemFields,
      }, { onConflict: 'project_id,document_type,system_type' });

      setModalMode(null);
      setActiveDoc(null);
      await load();
    } catch (e: any) {
      alert('Failed to create inspection: ' + e.message);
    } finally { setActionLoading(false); }
  };

  // ── Link existing inspection ───────────────────────────────────────────────
  const linkExisting = async () => {
    if (!activeDoc || !linkInspectionId.trim() || !pid) return;
    setActionLoading(true);
    try {
      const inspName = buildInspectionName(activeDoc.title);
      await supabase.from('project_handover_docs').upsert({
        project_id: pid,
        document_type: activeDoc.id,
        title: activeDoc.title,
        status: 'in_progress',
        sc_inspection_id: linkInspectionId.trim(),
        sc_inspection_name: inspName,
        ...activeSystemFields,
      }, { onConflict: 'project_id,document_type,system_type' });
      setModalMode(null);
      setActiveDoc(null);
      await load();
    } catch (e: any) {
      alert('Failed to link: ' + e.message);
    } finally { setActionLoading(false); }
  };

  // ── Import results ─────────────────────────────────────────────────────────
  const importResults = async (docType: string) => {
    const doc = getDocRecord(docType);
    if (!doc?.sc_inspection_id || !pid) return;
    setImportingDoc(docType);
    try {
      const d = await invoke('get_inspection', { inspection_id: doc.sc_inspection_id });
      const isComplete = d.status === 'completed' || !!d.date_completed;
      const status: DocStatus = isComplete ? 'imported' : 'in_progress';

      // Build the update payload
      const update: Record<string, unknown> = {
        status,
        sc_result: d.result ?? null,
        sc_score_pct: d.score_pct ?? null,
        sc_engineer_name: d.engineer_name ?? null,
        sc_completion_date: d.date_completed ?? null,
        sc_imported_at: isComplete ? new Date().toISOString() : null,
      };

      // If completed and no PDF yet, export and attach it
      if (isComplete && !doc.file_url) {
        try {
          const pdf = await invoke('export_pdf', { inspection_id: doc.sc_inspection_id, project_id: pid, path_prefix: 'handover' });
          if (pdf.pdf_url) {
            update.file_url = pdf.pdf_url;
            update.file_name = pdf.file_name;
          }
        } catch {
          // PDF export failure is non-fatal — still mark as imported
        }
      }

      await supabase.from('project_handover_docs').update(update).eq('id', doc.id);
      await load();
    } catch (e: any) {
      alert('Import failed: ' + e.message);
    } finally { setImportingDoc(null); }
  };

  // ── Upload PDF ─────────────────────────────────────────────────────────────
  const triggerUpload = (docId: string) => {
    uploadDocRef.current = docId;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pid) return;
    const docId = uploadDocRef.current;

    const path = `${pid}/${docId}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('om-uploads').upload(path, file, { upsert: true });
    if (upErr) { alert('Upload failed: ' + upErr.message); return; }
    const { data: { publicUrl } } = supabase.storage.from('om-uploads').getPublicUrl(path);

    // For SC-enabled docs, update the handover_docs table
    const scDoc = SC_DOCUMENTS.find(d => d.id === docId);
    if (scDoc) {
      await supabase.from('project_handover_docs').upsert({
        project_id: pid,
        document_type: docId,
        title: scDoc.title,
        status: 'uploaded' as DocStatus,
        file_name: file.name,
        file_url: publicUrl,
        ...activeSystemFields,
      }, { onConflict: 'project_id,document_type,system_type' });
    } else {
      // Legacy upload for NSI/RAMS
      const isMulti = UPLOAD_ONLY_DOCUMENTS.find(d => d.id === docId)?.multi;
      if (!isMulti) {
        const existing = getLegacyUpload(docId);
        if (existing) await supabase.from('om_pack_uploads').delete().eq('id', existing.id);
      }
      await supabase.from('om_pack_uploads').insert({
        project_id: pid,
        section: docId,
        file_name: file.name,
        file_url: publicUrl,
        ...activeSystemFields,
      });
    }

    e.target.value = '';
    await load();
  };

  const removeLegacyUpload = async (upload: LegacyUpload) => {
    if (!confirm(`Remove "${upload.file_name}"?`)) return;
    await supabase.from('om_pack_uploads').delete().eq('id', upload.id);
    await load();
  };

  const removeScDocFile = async (docId: string, fileName: string | null) => {
    if (!confirm(`Remove "${fileName ?? 'this file'}"?`)) return;
    await supabase.from('project_handover_docs').update({
      file_name: null,
      file_url: null,
      status: 'not_started',
    }).eq('project_id', pid!).eq('document_type', docId);
    await load();
  };

  const removeScInspection = async (docId: string, inspName: string | null) => {
    if (!confirm(`Unlink inspection "${inspName ?? 'this inspection'}"? This will not delete it from SafetyCulture.`)) return;
    await supabase.from('project_handover_docs').update({
      status: 'not_started',
      sc_inspection_id: null,
      sc_inspection_name: null,
      sc_template_id: null,
      sc_result: null,
      sc_score_pct: null,
      sc_engineer_name: null,
      sc_completion_date: null,
      sc_imported_at: null,
    }).eq('project_id', pid!).eq('document_type', docId);
    await load();
  };

  // ── Other Docs ────────────────────────────────────────────────────────────
  const verifyOtherLink = async () => {
    if (!otherLink.trim()) return;
    setOtherLinkVerifying(true);
    setOtherLinkVerified(null);
    try {
      await fetch(otherLink.trim(), { method: 'HEAD', mode: 'no-cors' });
      setOtherLinkVerified(true);
    } catch {
      setOtherLinkVerified(false);
    } finally { setOtherLinkVerifying(false); }
  };

  const saveOtherDoc = async () => {
    if (!pid || !otherTitle.trim()) return;
    setOtherSaving(true);
    try {
      let file_name: string | null = null;
      let file_url: string | null = null;
      let link_url: string | null = null;

      if (otherMode === 'upload' && otherFile) {
        const path = `${pid}/other/${Date.now()}_${otherFile.name}`;
        const { error: upErr } = await supabase.storage.from('om-uploads').upload(path, otherFile, { upsert: true });
        if (upErr) throw new Error(upErr.message);
        const { data: { publicUrl } } = supabase.storage.from('om-uploads').getPublicUrl(path);
        file_name = otherFile.name;
        file_url = publicUrl;
      } else if (otherMode === 'link' && otherLink.trim()) {
        link_url = otherLink.trim();
      } else {
        throw new Error('Please select a file or enter a link.');
      }

      await supabase.from('handover_other_docs').insert({
        project_id: pid,
        title: otherTitle.trim(),
        description: otherDesc.trim() || null,
        file_name,
        file_url,
        link_url,
        ...activeSystemFields,
      });

      setShowOtherModal(false);
      setOtherTitle('');
      setOtherDesc('');
      setOtherLink('');
      setOtherFile(null);
      setOtherLinkVerified(null);
      setOtherMode('upload');
      await load();
    } catch (e: any) {
      alert('Failed to save: ' + e.message);
    } finally { setOtherSaving(false); }
  };

  const removeOtherDoc = async (id: number, title: string) => {
    if (!confirm(`Remove "${title}"?`)) return;
    await supabase.from('handover_other_docs').delete().eq('id', id);
    await load();
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalDocs = visibleScDocs.length + UPLOAD_ONLY_DOCUMENTS.length;
  const completedDocs = visibleScDocs.filter(d => {
    const rec = getDocRecord(d.id);
    return rec && ['completed', 'imported', 'uploaded'].includes(rec.status);
  }).length + UPLOAD_ONLY_DOCUMENTS.filter(d => d.multi ? getLegacyUploads(d.id).length > 0 : getLegacyUpload(d.id)).length;

  if (loading) {
    return <div className="flex items-center justify-center min-h-64"><div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
      <input ref={otherFileRef} type="file" accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" className="hidden" onChange={e => { setOtherFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />

      {/* Tab switcher */}
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-fit">
        <button
          onClick={() => setActiveTab('documents')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'documents' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <Award className="w-4 h-4" />
          Documents
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${activeTab === 'documents' ? 'bg-cyan-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {completedDocs}/{totalDocs}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('safetyculture')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'safetyculture' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <Settings className="w-4 h-4" />
          SafetyCulture Config
          {scConnected && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activeTab === 'safetyculture' ? 'bg-emerald-300' : 'bg-emerald-500'}`} />}
        </button>
      </div>

      {activeTab === 'safetyculture' && <SafetyCulturePage />}

      {activeTab === 'documents' && (
        <>
      {/* System / cost centre tabs */}
      <div className="flex flex-wrap gap-1.5 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
        <button
          onClick={() => setActiveSystemKey(PROJECT_WIDE_SYSTEM_KEY)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeSystemKey === PROJECT_WIDE_SYSTEM_KEY ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {PROJECT_WIDE_SYSTEM_LABEL}
        </button>
        {projectSystems.map(system => {
          const Icon = getCategoryStyle(system.category).icon;
          return (
            <button
              key={system.name}
              onClick={() => setActiveSystemKey(system.name)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeSystemKey === system.name ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              {system.name}
            </button>
          );
        })}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">Handover Documents</h2>
          <p className="text-sm text-slate-500 mt-0.5">Create inspections from SafetyCulture, upload signed PDFs, or import results</p>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${completedDocs === totalDocs ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {completedDocs}/{totalDocs} complete
        </span>
      </div>

      {/* SC-enabled document cards */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Certificates & Records</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleScDocs.map(doc => {
            const record = getDocRecord(doc.id);
            const status: DocStatus = record?.status as DocStatus ?? 'not_started';
            const statusCfg = STATUS_CONFIG[status];
            const Icon = doc.icon;

            return (
              <div key={doc.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${status !== 'not_started' ? 'border-slate-200' : 'border-slate-200'}`}>
                <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${status === 'not_started' ? 'bg-slate-200' : 'bg-emerald-100'}`}>
                    {['completed', 'imported', 'uploaded'].includes(status) ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <Icon className="w-5 h-5 text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{doc.title}</p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{doc.description}</p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusCfg.color}`}>
                    {statusCfg.label}
                  </span>
                </div>

                <div className="px-5 py-4 space-y-3">
                  {/* Show linked inspection info */}
                  {record?.sc_inspection_id && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                        <span className="text-xs font-medium text-slate-700 truncate flex-1 min-w-0">{record.sc_inspection_name ?? record.sc_inspection_id}</span>
                        <a href={scInspectionUrl(record.sc_inspection_id)} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-600 hover:underline flex items-center gap-0.5 flex-shrink-0">
                          Open <ExternalLink className="w-3 h-3" />
                        </a>
                        <button onClick={() => removeScInspection(doc.id, record.sc_inspection_name)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0" title="Unlink inspection">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {record.sc_engineer_name && <p className="text-xs text-slate-500">Engineer: {record.sc_engineer_name}</p>}
                      {record.sc_result && <p className="text-xs text-slate-500">Result: <span className={record.sc_result === 'pass' ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>{record.sc_result}</span></p>}
                    </div>
                  )}

                  {/* Show uploaded file */}
                  {record?.file_url && (
                    <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
                      <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-sm text-emerald-800 font-medium flex-1 min-w-0 truncate">{record.file_name}</span>
                      <a href={record.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 hover:underline flex-shrink-0">View</a>
                      <button onClick={() => removeScDocFile(doc.id, record.file_name)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    {scConnected && (
                      <>
                        <button onClick={() => { setActiveDoc(doc); setModalMode('create'); setSelectedTemplateId(''); }} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors">
                          <Plus className="w-3.5 h-3.5" />{record?.sc_inspection_id ? 'Replace Inspection' : 'Create from SafetyCulture'}
                        </button>
                        {!record?.sc_inspection_id && (
                          <button onClick={() => { setActiveDoc(doc); setModalMode('link'); setLinkInspectionId(''); }} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                            <Link2 className="w-3.5 h-3.5" />Link Existing
                          </button>
                        )}
                      </>
                    )}
                    {record?.sc_inspection_id && status !== 'imported' && (
                      <button onClick={() => importResults(doc.id)} disabled={importingDoc === doc.id} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50">
                        {importingDoc === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        Import Results
                      </button>
                    )}
                    <button onClick={() => triggerUpload(doc.id)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                      <Upload className="w-3.5 h-3.5" />Upload PDF
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upload-only documents */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Upload-Only Documents</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {UPLOAD_ONLY_DOCUMENTS.map(doc => {
            const Icon = doc.icon;
            if (doc.multi) {
              const uploads = getLegacyUploads(doc.id);
              return (
                <div key={doc.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${uploads.length > 0 ? 'border-emerald-200' : 'border-slate-200'}`}>
                  <div className={`flex items-center gap-3 px-5 py-4 border-b ${uploads.length > 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${uploads.length > 0 ? 'bg-emerald-100' : 'bg-slate-200'}`}>
                      {uploads.length > 0 ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <Icon className="w-5 h-5 text-slate-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${uploads.length > 0 ? 'text-emerald-900' : 'text-slate-800'}`}>{doc.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{doc.description}</p>
                    </div>
                    {uploads.length > 0 && <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">{uploads.length}</span>}
                  </div>
                  <div className="px-5 py-4 space-y-2">
                    {uploads.map(u => (
                      <div key={u.id} className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
                        <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm text-emerald-800 font-medium flex-1 min-w-0 truncate">{u.file_name}</span>
                        <a href={u.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 hover:underline flex-shrink-0">View</a>
                        <button onClick={() => removeLegacyUpload(u)} className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <button onClick={() => triggerUpload(doc.id)} className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all">
                      <Plus className="w-4 h-4" /><span className="text-sm font-medium">{uploads.length > 0 ? 'Add another' : 'Upload PDF'}</span>
                    </button>
                  </div>
                </div>
              );
            }

            const upload = getLegacyUpload(doc.id);
            return (
              <div key={doc.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${upload ? 'border-emerald-200' : 'border-slate-200'}`}>
                <div className={`flex items-center gap-3 px-5 py-4 border-b ${upload ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${upload ? 'bg-emerald-100' : 'bg-slate-200'}`}>
                    {upload ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <Icon className="w-5 h-5 text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${upload ? 'text-emerald-900' : 'text-slate-800'}`}>{doc.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{doc.description}</p>
                  </div>
                </div>
                <div className="px-5 py-4">
                  {upload ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
                        <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm text-emerald-800 font-medium flex-1 min-w-0 truncate">{upload.file_name}</span>
                      </div>
                      <div className="flex gap-2">
                        <a href={upload.file_url} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-emerald-300 text-emerald-700 text-sm font-medium rounded-lg hover:bg-emerald-50 transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" />View
                        </a>
                        <button onClick={() => triggerUpload(doc.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">
                          <Upload className="w-3.5 h-3.5" />Replace
                        </button>
                        <button onClick={() => removeLegacyUpload(upload)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => triggerUpload(doc.id)} className="w-full flex items-center justify-center gap-2.5 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all">
                      <Upload className="w-4 h-4" /><span className="text-sm font-medium">Upload signed PDF</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Other Documents */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Other Documents</h3>
          <button
            onClick={() => { setShowOtherModal(true); setOtherMode('upload'); setOtherTitle(''); setOtherDesc(''); setOtherLink(''); setOtherFile(null); setOtherLinkVerified(null); }}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />Add Document
          </button>
        </div>

        {otherDocs.length === 0 ? (
          <button
            onClick={() => { setShowOtherModal(true); setOtherMode('upload'); setOtherTitle(''); setOtherDesc(''); setOtherLink(''); setOtherFile(null); setOtherLinkVerified(null); }}
            className="w-full flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all"
          >
            <FolderPlus className="w-6 h-6" />
            <span className="text-sm font-medium">Add other handover documents</span>
            <span className="text-xs text-slate-400">Upload a PDF or link to an external document</span>
          </button>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {otherDocs.filter(docMatchesActiveSystem).map(doc => (
              <div key={doc.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                    {doc.link_url ? <ExternalLink className="w-4 h-4 text-slate-500" /> : <FileText className="w-4 h-4 text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{doc.title}</p>
                    {doc.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{doc.description}</p>}
                  </div>
                  <button onClick={() => removeOtherDoc(doc.id, doc.title)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="px-4 py-3">
                  {doc.link_url ? (
                    <a href={doc.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                      <ExternalLink className="w-3.5 h-3.5" />Open Link
                    </a>
                  ) : doc.file_url ? (
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors">
                      <FileText className="w-3.5 h-3.5" />{doc.file_name ?? 'View File'}
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
            <button
              onClick={() => { setShowOtherModal(true); setOtherMode('upload'); setOtherTitle(''); setOtherDesc(''); setOtherLink(''); setOtherFile(null); setOtherLinkVerified(null); }}
              className="flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all"
            >
              <Plus className="w-5 h-5" />
              <span className="text-xs font-medium">Add another</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Other Doc Modal ───────────────────────────────────────────────────── */}
      {showOtherModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">Add Other Document</h3>
              <button onClick={() => setShowOtherModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">Title <span className="text-red-500">*</span></label>
                <input value={otherTitle} onChange={e => setOtherTitle(e.target.value)} placeholder="e.g. Warranty Certificate" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">Description</label>
                <input value={otherDesc} onChange={e => setOtherDesc(e.target.value)} placeholder="Optional description" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">Source</label>
                <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-3">
                  <button onClick={() => setOtherMode('upload')} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${otherMode === 'upload' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                    Upload PDF
                  </button>
                  <button onClick={() => setOtherMode('link')} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${otherMode === 'link' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                    Paste Link
                  </button>
                </div>
                {otherMode === 'upload' ? (
                  <div>
                    {otherFile ? (
                      <div className="flex items-center gap-3 bg-cyan-50 border border-cyan-200 rounded-lg px-3.5 py-2.5">
                        <FileText className="w-4 h-4 text-cyan-600 flex-shrink-0" />
                        <span className="text-sm text-cyan-800 font-medium flex-1 min-w-0 truncate">{otherFile.name}</span>
                        <button onClick={() => setOtherFile(null)} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <button onClick={() => otherFileRef.current?.click()} className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all">
                        <Upload className="w-4 h-4" /><span className="text-sm font-medium">Select file</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={otherLink}
                        onChange={e => { setOtherLink(e.target.value); setOtherLinkVerified(null); }}
                        placeholder="https://..."
                        className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                      <button onClick={verifyOtherLink} disabled={!otherLink.trim() || otherLinkVerifying} className="px-3 py-2 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 whitespace-nowrap">
                        {otherLinkVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Verify'}
                      </button>
                    </div>
                    {otherLinkVerified === true && <p className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />Link verified</p>}
                    {otherLinkVerified === false && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />Could not verify — you can still save the link</p>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <button onClick={() => setShowOtherModal(false)} className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
              <button
                onClick={saveOtherDoc}
                disabled={!otherTitle.trim() || otherSaving || (otherMode === 'upload' && !otherFile) || (otherMode === 'link' && !otherLink.trim())}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40"
              >
                {otherSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Save Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create from SC Modal ─────────────────────────────────────────────── */}
      {modalMode === 'create' && activeDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Create from SafetyCulture</h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeDoc.title}</p>
              </div>
              <button onClick={() => { setModalMode(null); setActiveDoc(null); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">Select Template</label>
                <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500">
                  <option value="">Choose a template...</option>
                  {templates.map(t => {
                    const tid = t.template_id ?? t.id;
                    const mapped = !!savedMappings[tid];
                    return <option key={tid} value={tid}>{t.name}{mapped ? ' (mapped)' : ''}</option>;
                  })}
                </select>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-slate-700">Inspection will be named:</p>
                <p className="text-sm font-mono text-cyan-700">{buildInspectionName(activeDoc.title)}</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs font-medium text-slate-700 mb-1">Auto-populated fields:</p>
                <div className="text-xs text-slate-500 space-y-0.5">
                  {project.job_number && <p>Job Number: {project.job_number}</p>}
                  {project.project_name && <p>Project: {project.project_name}</p>}
                  {project.client_name && <p>Client: {project.client_name}</p>}
                  {project.site_name && <p>Site: {project.site_name}</p>}
                  {project.site_address && <p>Address: {project.site_address}</p>}
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <button onClick={() => { setModalMode(null); setActiveDoc(null); }} className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={createFromSC} disabled={!selectedTemplateId || actionLoading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40">
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Inspection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link Existing Modal ───────────────────────────────────────────────── */}
      {modalMode === 'link' && activeDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Link Existing Inspection</h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeDoc.title}</p>
              </div>
              <button onClick={() => { setModalMode(null); setActiveDoc(null); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">SafetyCulture Inspection ID</label>
                <input value={linkInspectionId} onChange={e => setLinkInspectionId(e.target.value)} placeholder="e.g. audit_abc123..." className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                <p className="text-xs text-slate-400 mt-1">Find this in the SafetyCulture inspection URL or details.</p>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <button onClick={() => { setModalMode(null); setActiveDoc(null); }} className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={linkExisting} disabled={!linkInspectionId.trim() || actionLoading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40">
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Link Inspection
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
