import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import { canAccessHandoverConfig } from '../lib/appRoles';
import { useUserAccess } from '../lib/userAccess';
import {
  documentMatchesSystem,
  loadDocumentProjectSystems,
  PROJECT_WIDE_SYSTEM_KEY,
  PROJECT_WIDE_SYSTEM_LABEL,
  resolveActiveDocumentSystem,
  systemAssignmentFields,
} from '../lib/documentProjectSystems';
import {
  fetchHandoverDocumentDefinitions,
  fetchHandoverDocumentTypes,
  handoverDocumentIcon,
  inferHandoverDocumentTypeKey,
  applyHandoverTypeSelectionsToSystems,
  definitionsForType,
  PROJECT_WIDE_DOCUMENT_TYPE_KEY,
  resolveProjectWideHandoverTypeKey,
  saveProjectSystemHandoverType,
  saveProjectWideHandoverType,
  type HandoverDocumentDefinition,
  type HandoverDocumentType,
} from '../lib/handoverDocumentConfig';
import { createHandoverFormInvite } from '../lib/handoverFormsApi';
import { formTemplateKeyForDefinition, getHandoverFormTemplate } from '../lib/handoverFormTemplates';
import { getCategoryStyle, type ProjectSystem } from '../lib/systems';
import HandoverConfigPage from './HandoverConfigPage';
import type { Device } from '../types';
import { sendCompletionPack } from '../lib/completionPackWorkflow';
import { listSdpRevisions } from '../lib/sdpRevisionsApi';
import { buildSdpAnswers } from '../lib/sdpAnswers';
import { fetchPublicContractorBrand } from '../lib/contractorBrand';
import { Link } from 'react-router-dom';
import {
  Upload, X, ExternalLink, CheckCircle, FileText, Loader2,
  Award, Plus, Mail, Copy,
  AlertCircle, Trash2,
  FolderPlus, SlidersHorizontal,
} from 'lucide-react';

// ── Document status ───────────────────────────────────────────────────────────

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
  workflow_status?: string | null;
  revision_no?: number | null;
  extraction_flag?: string | null;
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
  const { role } = useUserAccess();
  const showConfig = canAccessHandoverConfig(role);

  const [activeTab, setActiveTab] = useState<'documents' | 'config'>('documents');
  const [docs, setDocs] = useState<HandoverDoc[]>([]);
  const [legacyUploads, setLegacyUploads] = useState<LegacyUpload[]>([]);
  const [otherDocs, setOtherDocs] = useState<OtherDoc[]>([]);
  const [projectSystems, setProjectSystems] = useState<ProjectSystem[]>([]);
  const [documentTypes, setDocumentTypes] = useState<HandoverDocumentType[]>([]);
  const [documentDefinitions, setDocumentDefinitions] = useState<HandoverDocumentDefinition[]>([]);
  const [selectedDocTypeKey, setSelectedDocTypeKey] = useState<string>(PROJECT_WIDE_DOCUMENT_TYPE_KEY);
  const [projectWideTypeKey, setProjectWideTypeKey] = useState<string>(PROJECT_WIDE_DOCUMENT_TYPE_KEY);
  const [activeSystemKey, setActiveSystemKey] = useState<string>(PROJECT_WIDE_SYSTEM_KEY);
  const [loading, setLoading] = useState(true);
  const [savingDocType, setSavingDocType] = useState(false);

  // Modal states
  const [activeDoc, setActiveDoc] = useState<HandoverDocumentDefinition | null>(null);
  const [modalMode, setModalMode] = useState<'email' | null>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [formLink, setFormLink] = useState<string | null>(null);
  const [mailtoHref, setMailtoHref] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [packEmail, setPackEmail] = useState('');
  const [packName, setPackName] = useState(project.engineer ?? '');
  const [packSending, setPackSending] = useState(false);
  const [packNotice, setPackNotice] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    if (!pid) return;
    const [{ data: docRows }, { data: uploadRows }, { data: otherRows }, { data: devRows }, typeRows, defRows] = await Promise.all([
      supabase.from('project_handover_docs').select('*').eq('project_id', pid),
      supabase.from('om_pack_uploads').select('*').eq('project_id', pid).or('section.like.handover_%,section.eq.nsi_certificate,section.eq.rams'),
      supabase.from('handover_other_docs').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('devices').select('*').eq('project_id', pid),
      fetchHandoverDocumentTypes(),
      fetchHandoverDocumentDefinitions(),
    ]);
    setDocs((docRows ?? []) as HandoverDoc[]);
    setLegacyUploads((uploadRows ?? []) as LegacyUpload[]);
    setOtherDocs((otherRows ?? []) as OtherDoc[]);
    const systems = await loadDocumentProjectSystems(pid, (devRows ?? []) as Device[]);
    applyHandoverTypeSelectionsToSystems(pid, systems);
    setProjectSystems(systems);
    setDocumentTypes(typeRows.filter(type => type.is_active));
    setDocumentDefinitions(defRows);
    setLoading(false);
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  // Determine which systems are installed (legacy helper — doc visibility uses project systems tabs)
  const activeDocumentSystem = resolveActiveDocumentSystem(projectSystems, activeSystemKey);
  const activeSystemFields = systemAssignmentFields(activeDocumentSystem);

  const activeTypeOptions = useMemo(() => {
    if (activeSystemKey === PROJECT_WIDE_SYSTEM_KEY) {
      return documentTypes.filter(type => type.key === PROJECT_WIDE_DOCUMENT_TYPE_KEY);
    }
    return documentTypes.filter(type => type.key !== PROJECT_WIDE_DOCUMENT_TYPE_KEY);
  }, [documentTypes, activeSystemKey]);

  useEffect(() => {
    if (!pid) return;
    setProjectWideTypeKey(resolveProjectWideHandoverTypeKey(pid, project.handover_project_wide_type_key));
  }, [pid, project.handover_project_wide_type_key]);

  useEffect(() => {
    if (activeSystemKey === PROJECT_WIDE_SYSTEM_KEY) {
      setSelectedDocTypeKey(projectWideTypeKey);
      return;
    }

    const system = resolveActiveDocumentSystem(projectSystems, activeSystemKey);
    if (!system) return;

    setSelectedDocTypeKey(
      system.handoverDocumentTypeKey || inferHandoverDocumentTypeKey(system.name, system.category),
    );
  }, [activeSystemKey, projectWideTypeKey, activeDocumentSystem?.id, activeDocumentSystem?.name]);

  const handleDocTypeChange = async (typeKey: string) => {
    setSelectedDocTypeKey(typeKey);
    if (!pid) return;
    setSavingDocType(true);

    let saveError: string | null = null;
    if (activeSystemKey === PROJECT_WIDE_SYSTEM_KEY) {
      setProjectWideTypeKey(typeKey);
      saveError = await saveProjectWideHandoverType(pid, typeKey);
    } else if (activeDocumentSystem?.id) {
      saveError = await saveProjectSystemHandoverType(pid, activeDocumentSystem.id, typeKey);
    }

    setSavingDocType(false);
    if (saveError) {
      alert(`Could not save document type: ${saveError}`);
      return;
    }

    setProjectSystems(current =>
      current.map(system =>
        system.id === activeDocumentSystem?.id
          ? { ...system, handoverDocumentTypeKey: typeKey }
          : system,
      ),
    );
  };

  const docMatchesActiveSystem = (record: { system_type?: string | null; project_system_id?: number | null }) => {
    if (activeSystemKey === PROJECT_WIDE_SYSTEM_KEY) {
      return !record.system_type?.trim() && record.project_system_id == null;
    }
    if (!activeDocumentSystem) return false;
    return documentMatchesSystem(record, activeDocumentSystem);
  };

  const getDocRecord = (documentId: string) =>
    docs.find(d => d.document_type === documentId && docMatchesActiveSystem(d));
  const getLegacyUpload = (section: string) =>
    legacyUploads.find(u => u.section === section && docMatchesActiveSystem(u));
  const getLegacyUploads = (section: string) =>
    legacyUploads.filter(u => u.section === section && docMatchesActiveSystem(u));

  const visibleDefinitions = useMemo(
    () => definitionsForType(documentDefinitions, selectedDocTypeKey),
    [documentDefinitions, selectedDocTypeKey],
  );

  const scEnabledDefinitions = visibleDefinitions.filter(def => def.sc_enabled && !def.upload_only);
  const uploadOnlyDefinitions = visibleDefinitions.filter(def => def.upload_only);
  const fileOnlyDefinitions = visibleDefinitions.filter(def => !def.sc_enabled && !def.upload_only);

  const definitionsById = useMemo(
    () => new Map(documentDefinitions.map(def => [def.document_id, def])),
    [documentDefinitions],
  );

  const openEmailFormModal = (definition: HandoverDocumentDefinition) => {
    setActiveDoc(definition);
    setModalMode('email');
    setRecipientEmail('');
    setRecipientName('');
    setFormLink(null);
    setMailtoHref(null);
  };

  const sendHandoverForm = async () => {
    if (!activeDoc || !pid) return;
    const templateKey = formTemplateKeyForDefinition(activeDoc);
    if (!templateKey) {
      alert(showConfig
        ? 'Link a web form to this document on the Handover Config tab first.'
        : 'Ask an admin to link a web form on Handover Config first.');
      if (showConfig) setActiveTab('config');
      return;
    }
    setActionLoading(true);
    try {
      const invite = await createHandoverFormInvite({
        project_id: pid,
        document_id: activeDoc.document_id,
        document_title: activeDoc.title,
        form_template_key: templateKey,
        recipient_email: recipientEmail.trim() || undefined,
        recipient_name: recipientName.trim() || undefined,
        system_type: activeSystemFields.system_type,
        project_system_id: activeSystemFields.project_system_id,
        prefill: {
          job_number: project.job_number ?? '',
          project_name: project.project_name ?? '',
          client_name: project.client_name ?? '',
          site_name: project.site_name ?? '',
          site_address: project.site_address ?? '',
          project_manager: project.project_manager ?? '',
          quote_number: project.quote_number ?? '',
          engineer: project.engineer ?? '',
          document_title: activeDoc.title,
        },
      });

      await supabase.from('project_handover_docs').upsert({
        project_id: pid,
        document_type: activeDoc.document_id,
        title: activeDoc.title,
        status: 'in_progress',
        sc_inspection_id: invite.token,
        sc_template_id: templateKey,
        sc_inspection_name: invite.fill_url,
        ...activeSystemFields,
      }, { onConflict: 'project_id,document_type,system_type' });

      setFormLink(invite.fill_url);
      setMailtoHref(invite.mailto_href);
      if (invite.mailto_href && recipientEmail.trim()) {
        window.location.href = invite.mailto_href;
      }
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Could not create the form link.');
    } finally {
      setActionLoading(false);
    }
  };

  const copyFormLink = async () => {
    if (!formLink) return;
    await navigator.clipboard.writeText(formLink);
  };

  const sendPackToEngineer = async () => {
    if (!pid) return;
    if (!packEmail.trim()) {
      alert('Enter the engineer email address.');
      return;
    }
    setPackSending(true);
    setPackNotice(null);
    try {
      const [{ data: scopeRow }, { data: asFitted }, { data: systemRows }, contractor] = await Promise.all([
        supabase.from('project_documents').select('content').eq('project_id', pid).eq('document_type', 'scope_of_works').maybeSingle(),
        supabase.from('as_fitted_items').select('quoted_description,quoted_quantity,source_quote_line_id').eq('project_id', pid),
        supabase.from('project_systems').select('category'),
        fetchPublicContractorBrand(),
      ]);
      let sdpAnswers;
      let revisionNo = 1;
      try {
        const revisions = await listSdpRevisions(pid);
        if (revisions[0]) {
          sdpAnswers = revisions[0].answers;
          revisionNo = revisions[0].revision_no;
        }
      } catch {
        sdpAnswers = undefined;
      }
      if (!sdpAnswers) {
        sdpAnswers = buildSdpAnswers({
          project,
          scopeText: scopeRow?.content ?? project.project_notes,
          equipment: (asFitted ?? []).map(item => ({
            item: item.quoted_description,
            qty_proposed: item.quoted_quantity,
            source: item.source_quote_line_id ? `Simpro line ${item.source_quote_line_id}` : 'Simpro quote line',
          })),
        });
      }
      const result = await sendCompletionPack({
        projectId: pid,
        project,
        systemCategories: (systemRows ?? []).map(row => String(row.category ?? '')),
        recipientEmail: packEmail.trim(),
        recipientName: packName.trim() || project.engineer || 'Engineer',
        sdpAnswers,
        sdpRevisionNo: revisionNo,
        brand: contractor,
      });
      setPackNotice(result.emailed
        ? `Pack emailed via ${result.provider}.`
        : `Development outbox saved. Opening a mail draft with ${result.links.length} document links.`);
      if (result.mailtoHref) window.location.href = result.mailtoHref;
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Could not email the completion pack.');
    } finally {
      setPackSending(false);
    }
  };

  const setWorkflowStatus = async (documentId: string, workflowStatus: string) => {
    if (!pid) return;
    await supabase.from('project_handover_docs').update({
      workflow_status: workflowStatus,
      status: workflowStatus === 'finalised' ? 'completed' : 'completed',
    }).eq('project_id', pid).eq('document_type', documentId);
    if (documentId === 'sdp') {
      const revisionNo = docs.find(item => item.document_type === documentId)?.revision_no;
      if (revisionNo) {
        await supabase.from('sdp_revisions').update({ status: workflowStatus }).eq('project_id', pid).eq('revision_no', revisionNo);
      }
    }
    await load();
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
    const scDoc = definitionsById.get(docId);
    if (scDoc && !scDoc.upload_only) {
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
      const uploadDef = definitionsById.get(docId);
      const isMulti = uploadDef?.multi;
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
    if (!confirm(`Cancel the outstanding form for "${inspName ?? 'this document'}"?`)) return;
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
  const totalDocs = visibleDefinitions.length;
  const completedDocs = scEnabledDefinitions.filter(def => {
    const rec = getDocRecord(def.document_id);
    return rec && ['completed', 'imported', 'uploaded'].includes(rec.status);
  }).length
    + fileOnlyDefinitions.filter(def => {
      const rec = getDocRecord(def.document_id);
      return rec && ['uploaded', 'imported', 'completed'].includes(rec.status);
    }).length
    + uploadOnlyDefinitions.filter(def => def.multi ? getLegacyUploads(def.document_id).length > 0 : getLegacyUpload(def.document_id)).length;

  if (loading) {
    return <div className="flex items-center justify-center min-h-64"><div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
      <input ref={otherFileRef} type="file" accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" className="hidden" onChange={e => { setOtherFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />

      {/* Tab switcher */}
      {showConfig ? (
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
          onClick={() => setActiveTab('config')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'config' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Handover Config
        </button>
      </div>
      ) : null}

      {showConfig && activeTab === 'config' && <HandoverConfigPage />}

      {(!showConfig || activeTab === 'documents') && (
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

      {/* System document type */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 flex flex-wrap items-end gap-4">
        <div className="min-w-[16rem] flex-1">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            System document type
          </label>
          <select
            value={selectedDocTypeKey}
            onChange={event => void handleDocTypeChange(event.target.value)}
            disabled={savingDocType || activeTypeOptions.length === 0}
            className="w-full max-w-md text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
          >
            {activeTypeOptions.map(type => (
              <option key={type.key} value={type.key}>{type.label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1.5">
            {activeSystemKey === PROJECT_WIDE_SYSTEM_KEY
              ? 'Project-wide documents such as acceptance certificates and RAMS.'
              : `Showing ${documentTypes.find(type => type.key === selectedDocTypeKey)?.label ?? selectedDocTypeKey} documents for ${activeDocumentSystem?.name ?? 'this system'}.`}
          </p>
        </div>
        {savingDocType && (
          <div className="flex items-center gap-2 text-xs text-slate-500 pb-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…
          </div>
        )}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">
            {documentTypes.find(type => type.key === selectedDocTypeKey)?.label ?? 'Handover'} documents
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Email the SDP and relevant handover PDFs, or complete one document at a time</p>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${completedDocs === totalDocs ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {completedDocs}/{totalDocs} complete
        </span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-slate-900">Email completion pack to engineer</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Sends the current SDP plus IA01, CC01 or AC01 for the systems on this job. Includes fill links and a backup return upload.
            </p>
          </div>
          <Link to="../sdp" className="text-xs font-medium text-cyan-700 hover:underline">Open SDP editor</Link>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Engineer name
            <input value={packName} onChange={event => setPackName(event.target.value)} className="mt-1 block w-56 text-sm border border-slate-200 rounded-lg px-3 py-2" />
          </label>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Engineer email
            <input type="email" value={packEmail} onChange={event => setPackEmail(event.target.value)} className="mt-1 block w-64 text-sm border border-slate-200 rounded-lg px-3 py-2" placeholder="name@pacific-uk.co.uk" />
          </label>
          <button type="button" onClick={() => void sendPackToEngineer()} disabled={packSending} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50">
            {packSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {packSending ? 'Preparing…' : 'Generate and email pack'}
          </button>
        </div>
        {packNotice && <p className="text-xs text-emerald-800">{packNotice}</p>}
      </div>

      {/* SC-enabled document cards */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Certificates & Records</h3>
        {scEnabledDefinitions.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-6 text-center">
            No documents configured for this system document type.
          </p>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {scEnabledDefinitions.map(doc => {
            const record = getDocRecord(doc.document_id);
            const status: DocStatus = record?.status as DocStatus ?? 'not_started';
            const statusCfg = STATUS_CONFIG[status];
            const Icon = handoverDocumentIcon(doc.icon_key);

            return (
              <div key={doc.document_id} className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${status !== 'not_started' ? 'border-slate-200' : 'border-slate-200'}`}>
                <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${status === 'not_started' ? 'bg-slate-200' : 'bg-emerald-100'}`}>
                    {['completed', 'imported', 'uploaded'].includes(status) ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <Icon className="w-5 h-5 text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{doc.title}</p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{doc.description}</p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusCfg.color}`}>
                    {record?.workflow_status ? record.workflow_status.replace(/_/g, ' ') : statusCfg.label}
                  </span>
                </div>

                <div className="px-5 py-4 space-y-3">
                  {record?.sc_inspection_id && status !== 'completed' && status !== 'uploaded' && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-cyan-600 flex-shrink-0" />
                        <span className="text-xs font-medium text-slate-700 truncate flex-1 min-w-0">Form sent — waiting for signature</span>
                        {record.sc_inspection_name?.startsWith('http') && (
                          <a href={record.sc_inspection_name} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-600 hover:underline flex items-center gap-0.5 flex-shrink-0">
                            Open <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <button onClick={() => removeScInspection(doc.document_id, record.sc_inspection_name)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0" title="Cancel form">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {record.sc_engineer_name && <p className="text-xs text-slate-500">Signed by: {record.sc_engineer_name}</p>}
                    </div>
                  )}

                  {record?.file_url && (
                    <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
                      <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-sm text-emerald-800 font-medium flex-1 min-w-0 truncate">{record.file_name}</span>
                      <a href={record.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 hover:underline flex-shrink-0">View</a>
                      <button onClick={() => removeScDocFile(doc.document_id, record.file_name)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  )}

                  {record?.extraction_flag && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Returned PDF could not be read as form fields ({record.extraction_flag}). The original file is kept for review.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {doc.document_id === 'sdp' && (
                      <Link to="../sdp" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
                        Edit SDP
                      </Link>
                    )}
                    <button onClick={() => openEmailFormModal(doc)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors">
                      <Mail className="w-3.5 h-3.5" />{record?.sc_inspection_id && status === 'in_progress' ? 'Resend form' : 'Email form'}
                    </button>
                    <button onClick={() => triggerUpload(doc.document_id)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                      <Upload className="w-3.5 h-3.5" />Upload PDF
                    </button>
                    {record?.file_url && (
                      <>
                        <button onClick={() => void setWorkflowStatus(doc.document_id, 'needs_correction')} className="text-xs px-3 py-2 rounded-lg border border-amber-200 text-amber-800">Needs correction</button>
                        <button onClick={() => void setWorkflowStatus(doc.document_id, 'technically_reviewed')} className="text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-700">Technically reviewed</button>
                        <button onClick={() => void setWorkflowStatus(doc.document_id, 'finalised')} className="text-xs px-3 py-2 rounded-lg border border-emerald-200 text-emerald-800">Finalise for O&M</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {fileOnlyDefinitions.length > 0 && (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Supporting Documents</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fileOnlyDefinitions.map(doc => {
            const record = getDocRecord(doc.document_id);
            const Icon = handoverDocumentIcon(doc.icon_key);
            const uploaded = Boolean(record?.file_url);
            return (
              <div key={doc.document_id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${uploaded ? 'border-emerald-200' : 'border-slate-200'}`}>
                <div className={`flex items-center gap-3 px-5 py-4 border-b ${uploaded ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${uploaded ? 'bg-emerald-100' : 'bg-slate-200'}`}>
                    {uploaded ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <Icon className="w-5 h-5 text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{doc.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{doc.description}</p>
                  </div>
                </div>
                <div className="px-5 py-4">
                  {record?.file_url ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
                        <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm text-emerald-800 font-medium flex-1 min-w-0 truncate">{record.file_name}</span>
                      </div>
                      <div className="flex gap-2">
                        <a href={record.file_url} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-emerald-300 text-emerald-700 text-sm font-medium rounded-lg hover:bg-emerald-50 transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" />View
                        </a>
                        <button onClick={() => triggerUpload(doc.document_id)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">
                          <Upload className="w-3.5 h-3.5" />Replace
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => triggerUpload(doc.document_id)} className="w-full flex items-center justify-center gap-2.5 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all">
                      <Upload className="w-4 h-4" /><span className="text-sm font-medium">Upload PDF</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Upload-only documents */}
      {uploadOnlyDefinitions.length > 0 && (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Upload-Only Documents</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {uploadOnlyDefinitions.map(doc => {
            const Icon = handoverDocumentIcon(doc.icon_key);
            if (doc.multi) {
              const uploads = getLegacyUploads(doc.document_id);
              return (
                <div key={doc.document_id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${uploads.length > 0 ? 'border-emerald-200' : 'border-slate-200'}`}>
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
                    <button onClick={() => triggerUpload(doc.document_id)} className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all">
                      <Plus className="w-4 h-4" /><span className="text-sm font-medium">{uploads.length > 0 ? 'Add another' : 'Upload PDF'}</span>
                    </button>
                  </div>
                </div>
              );
            }

            const upload = getLegacyUpload(doc.document_id);
            return (
              <div key={doc.document_id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${upload ? 'border-emerald-200' : 'border-slate-200'}`}>
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
                        <button onClick={() => triggerUpload(doc.document_id)} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">
                          <Upload className="w-3.5 h-3.5" />Replace
                        </button>
                        <button onClick={() => removeLegacyUpload(upload)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => triggerUpload(doc.document_id)} className="w-full flex items-center justify-center gap-2.5 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all">
                      <Upload className="w-4 h-4" /><span className="text-sm font-medium">Upload signed PDF</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

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

      {modalMode === 'email' && activeDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Email form</h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeDoc.title}</p>
              </div>
              <button onClick={() => { setModalMode(null); setActiveDoc(null); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                {getHandoverFormTemplate(formTemplateKeyForDefinition(activeDoc)).name}. Project details are filled in automatically. When they sign, the PDF is saved here.
              </p>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">Recipient name</label>
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Customer or engineer" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">Recipient email</label>
                <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="name@client.co.uk" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              {formLink && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-emerald-800">Form link ready</p>
                  <p className="text-[11px] font-mono text-slate-700 break-all">{formLink}</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void copyFormLink()} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-800 bg-white">
                      <Copy className="w-3.5 h-3.5" />Copy link
                    </button>
                    {mailtoHref && (
                      <a href={mailtoHref} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600 text-white">
                        <Mail className="w-3.5 h-3.5" />Open email
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <button onClick={() => { setModalMode(null); setActiveDoc(null); }} className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">Close</button>
              <button onClick={() => void sendHandoverForm()} disabled={actionLoading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40">
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                {formLink ? 'Create another link' : 'Create and email'}
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
