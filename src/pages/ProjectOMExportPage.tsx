import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { groupDevices } from '../lib/deviceGrouping';
import { useProject } from './ProjectLayout';
import type { Device, CommissioningRecord, HandoverDocument, Datasheet, SystemType } from '../types';
import { SYSTEM_TYPES } from '../types';
import {
  Printer, BookOpen, FileText, ClipboardCheck, Award, Wrench,
  Upload, X, CheckCircle, AlertCircle, ExternalLink, ChevronRight,
  Camera, Lock, ShieldAlert, PhoneCall, ScanLine, Radar, Network,
  Building2, Calendar, User, Tag, CalendarCheck, Loader2, Layers,
  ListOrdered, Wifi, BookMarked, Plus, Search, Trash2, Download,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OmUpload {
  id: number;
  section: string;
  file_name: string;
  file_url: string;
}

interface ProjectDoc {
  id: number;
  document_type: string;
  title: string;
  content: string | null;
  status: string;
  generated_by: string | null;
}

interface AsBuiltDrawing {
  id: number;
  title: string;
  drawing_number: string | null;
  revision: string | null;
  file_name: string;
  file_url: string;
}

// ─── PDF page renderer ────────────────────────────────────────────────────────
// Renders all pages of a PDF URL into base64 image data URLs using pdfjs-dist.
// Returns an array of data URL strings (one per page), or null on error.

async function renderPdfToImages(url: string): Promise<string[] | null> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    // Use a stable CDN-independent worker path via import.meta.url
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;

    const pdf = await pdfjsLib.getDocument({ url, withCredentials: false }).promise;
    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push(canvas.toDataURL('image/jpeg', 0.92));
    }
    return pages;
  } catch {
    return null;
  }
}

interface DeviceWithDatasheet extends Device {
  datasheet: Datasheet | null;
  warrantyYears: number | null;
  maintenanceNotes: string | null;
}

type Section = 'index' | 'cover' | 'scope' | 'schedule' | 'technical_docs' | 'maintenance_plan' | 'commissioning' | 'handover' | 'as_fitted' | 'datasheets' | 'user_manuals';

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'index',            label: 'Table of Contents',   icon: ListOrdered },
  { id: 'cover',            label: 'Cover Page',          icon: BookOpen },
  { id: 'scope',            label: 'Scope of Works',      icon: FileText },
  { id: 'schedule',         label: 'Device Schedule',     icon: ClipboardCheck },
  { id: 'technical_docs',   label: 'Technical Docs',      icon: Wifi },
  { id: 'maintenance_plan', label: 'Maintenance Plan',    icon: CalendarCheck },
  { id: 'commissioning',    label: 'Commissioning Pack',  icon: CheckCircle },
  { id: 'handover',         label: 'Handover Certificate', icon: Award },
  { id: 'as_fitted',        label: 'As Fitted Drawings',  icon: Layers },
  { id: 'datasheets',       label: 'Datasheet Index',     icon: ExternalLink },
  { id: 'user_manuals',     label: 'User Manuals',        icon: BookMarked },
];

const SYS_ICONS: Partial<Record<SystemType, React.ElementType>> = {
  'CCTV': Camera, 'Access Control': Lock, 'Intruder': ShieldAlert,
  'Intercom': PhoneCall, 'ANPR': ScanLine, 'Perimeter Detection': Radar, 'Networking': Network,
};

// All upload sections that belong to the Handover pack
const HANDOVER_SECTION_LABELS: Record<string, string> = {
  handover_cctv:            'CCTV Handover Certificate',
  handover_ac:              'Access Control Handover Certificate',
  handover_intruder:        'Intruder Alarm Completion Certificate',
  handover_intruder_record: 'Record of System Checks',
  handover_training:        'Training Record',
  handover_acceptance:      'System Acceptance Certificate',
  nsi_certificate:          'NSI Certificate',
  rams:                     'RAMS',
  handover:                 'Handover Certificate',
};
const HANDOVER_SECTIONS = new Set(Object.keys(HANDOVER_SECTION_LABELS));

// ─── Markdown renderer (minimal) ─────────────────────────────────────────────

function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  let out = '';
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|\s*[-:]+/.test(line)) continue;
    if (line.startsWith('| ')) {
      if (!inTable) { out += '<table class="w-full text-sm border-collapse mb-4">'; inTable = true; }
      const cells = line.slice(1, -1).split('|').map(c =>
        `<td class="border border-slate-200 px-3 py-1.5">${inline(c.trim())}</td>`).join('');
      out += `<tr>${cells}</tr>`;
      continue;
    }
    if (inTable) { out += '</table>'; inTable = false; }
    if (line.startsWith('#### ')) { out += `<h4 class="text-sm font-semibold mt-3 mb-1 text-slate-700">${inline(line.slice(5))}</h4>`; continue; }
    if (line.startsWith('### ')) { out += `<h3 class="text-base font-bold mt-4 mb-1.5 text-slate-800">${inline(line.slice(4))}</h3>`; continue; }
    if (line.startsWith('## ')) { out += `<h2 class="text-lg font-bold mt-5 mb-2 text-slate-900">${inline(line.slice(3))}</h2>`; continue; }
    if (line.startsWith('# ')) { out += `<h1 class="text-xl font-bold mt-6 mb-2 text-slate-900">${inline(line.slice(2))}</h1>`; continue; }
    if (/^[-*] /.test(line)) { out += `<li class="ml-4 text-sm text-slate-700 list-disc">${inline(line.slice(2))}</li>`; continue; }
    if (/^\d+\. /.test(line)) { out += `<li class="ml-4 text-sm text-slate-700 list-decimal">${inline(line.replace(/^\d+\. /, ''))}</li>`; continue; }
    if (line === '') { out += '<div class="h-2"></div>'; continue; }
    out += `<p class="text-sm text-slate-700 mb-1.5">${inline(line)}</p>`;
  }
  if (inTable) out += '</table>';
  return out;
}

function inline(t: string): string {
  // HTML-escape first to prevent injection via user-editable markdown content
  const safe = t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="font-mono text-xs bg-slate-100 px-1 rounded">$1</code>');
}

function scInspectionUrl(id: string): string {
  if (id.startsWith('audit_')) return `https://app.safetyculture.com/inspection/${id}`;
  if (id.startsWith('insp_')) return `https://app.safetyculture.com/inspection/audit_${id.slice(5)}`;
  return `https://app.safetyculture.com/inspection/audit_${id.replace(/-/g, '')}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProjectOMExportPage() {
  const { id } = useParams<{ id: string }>();
  const { project, productModels, datasheets } = useProject();

  const [activeSection, setActiveSection] = useState<Section>('cover');
  const [devices, setDevices] = useState<DeviceWithDatasheet[]>([]);
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
  const [commRecords, setCommRecords] = useState<CommissioningRecord[]>([]);
  const [handoverDocs, setHandoverDocs] = useState<HandoverDocument[]>([]);
  const [omUploads, setOmUploads] = useState<OmUpload[]>([]);
  const [asFittedDrawings, setAsFittedDrawings] = useState<AsBuiltDrawing[]>([]);
  const [scHandoverDocs, setScHandoverDocs] = useState<{ document_type: string; title: string; status: string; file_url: string | null; file_name: string | null; sc_inspection_id: string | null; sc_result: string | null }[]>([]);
  const [projectManuals, setProjectManuals] = useState<{ id: number; manual_id: number; manual: { title: string; description: string | null; manufacturer: string | null; model_number: string | null; file_name: string; file_url: string } }[]>([]);
  const [contractorProfile, setContractorProfile] = useState<any>(null);
  const [docAuthority, setDocAuthority] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Tech doc imported data: { rows, colConfig } per system
  const [techDocState, setTechDocState] = useState<Partial<Record<string, { rows: { id: number; row_index: number; data: Record<string, string> }[]; colConfig: { key: string; display_name: string; visible: boolean; order: number }[] }>>>({});

  // Pre-rendered handover PDF pages: upload.id → { pages: dataUrlArray, loading: bool }
  const [handoverPageImages, setHandoverPageImages] = useState<Record<number, { pages: string[]; loading: boolean; failed: boolean }>>({});
  // Pre-rendered as-fitted drawing pages: drawing.id → { pages, loading, failed }
  const [asFittedPageImages, setAsFittedPageImages] = useState<Record<number, { pages: string[]; loading: boolean; failed: boolean }>>({});
  // Pre-rendered datasheet pages: datasheet.id → { pages, loading, failed }
  const [datasheetPageImages, setDatasheetPageImages] = useState<Record<number, { pages: string[]; loading: boolean; failed: boolean }>>({});

  // Scope of works edit state
  const [scopeContent, setScopeContent] = useState('');
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeRegenerating, setScopeRegenerating] = useState(false);
  const [activeSystems, setActiveSystems] = useState<string[]>([]);

  // Maintenance plan per-system edit state: Record<systemType, content>
  const [maintPlanContent, setMaintPlanContent] = useState<Record<string, string>>({});
  const [maintPlanSaving, setMaintPlanSaving] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSectionRef = useRef<string>('');

  const pid = id ? parseInt(id) : null;

  // ── Load data ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    const [
      { data: devData },
      { data: docData },
      { data: commData },
      { data: handData },
      { data: uplData },
      { data: afdData },
      { data: contrData },
      { data: authData },
      { data: scHandData },
      { data: manualData },
      { data: techRowData },
      { data: techCfgData },
    ] = await Promise.all([
      supabase.from('devices').select('*').eq('project_id', pid).neq('status', 'pending_review').order('system_type').order('device_name'),
      supabase.from('project_documents').select('*').eq('project_id', pid),
      supabase.from('commissioning_records').select('*').eq('project_id', pid).order('system_type').order('sort_order'),
      supabase.from('handover_documents').select('*').eq('project_id', pid),
      supabase.from('om_pack_uploads').select('*').eq('project_id', pid),
      supabase.from('as_fitted_drawings').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('contractor_profile').select('*').limit(1).maybeSingle(),
      supabase.from('document_authority').select('*').eq('project_id', pid).maybeSingle(),
      supabase.from('project_handover_docs').select('document_type,title,status,file_url,file_name,sc_inspection_id,sc_result').eq('project_id', pid).in('status', ['completed', 'imported', 'uploaded']),
      supabase.from('project_user_manuals').select('id, manual_id, manual:user_manuals(title,description,manufacturer,model_number,file_name,file_url)').eq('project_id', pid),
      supabase.from('tech_doc_rows').select('*').eq('project_id', pid).order('system_type').order('row_index'),
      supabase.from('tech_doc_column_configs').select('*').eq('project_id', pid),
    ]);

    const enriched: DeviceWithDatasheet[] = (devData ?? []).map(d => {
      const mfr = d.manufacturer?.trim().toLowerCase();
      const mod = d.model_number?.trim().toLowerCase();
      const pm = productModels.find(p => p.manufacturer?.trim().toLowerCase() === mfr && p.model_number?.trim().toLowerCase() === mod);
      const ds = datasheets.find(s => s.manufacturer?.trim().toLowerCase() === mfr && s.model_number?.trim().toLowerCase() === mod && s.datasheet_url);
      return { ...d, datasheet: ds ?? null, warrantyYears: pm?.warranty_years ?? null, maintenanceNotes: pm?.maintenance_notes ?? null };
    });

    setDevices(enriched);
    setProjectDocs(docData ?? []);
    setCommRecords(commData ?? []);
    setHandoverDocs(handData ?? []);
    setOmUploads(uplData ?? []);
    setAsFittedDrawings(afdData ?? []);
    setScHandoverDocs(scHandData ?? []);
    setProjectManuals((manualData ?? []) as any);
    setContractorProfile(contrData ?? null);
    setDocAuthority(authData ?? null);

    // Build techDocState per system
    const tdState: typeof techDocState = {};
    for (const sys of SYSTEM_TYPES) {
      const rows = ((techRowData ?? []).filter((r: any) => r.system_type === sys));
      const cfg = (techCfgData ?? []).find((c: any) => c.system_type === sys);
      tdState[sys] = { rows, colConfig: (cfg?.columns ?? []) };
    }
    setTechDocState(tdState);

    // Build per-system maintenance plan content from project_documents
    const planMap: Record<string, string> = {};
    (docData ?? []).filter(d => d.document_type.startsWith('maintenance_plan_')).forEach(d => {
      const sys = d.document_type.replace('maintenance_plan_', '');
      planMap[sys] = d.content ?? '';
    });

    // Auto-seed missing maintenance plans and scope for any newly active systems
    const activeSystemsList = [...new Set(
      (devData ?? []).map(d => d.system_type).filter(Boolean) as string[]
    )];
    setActiveSystems(activeSystemsList);

    const missingPlans = activeSystemsList.filter(
      sys => !(docData ?? []).some(d => d.document_type === `maintenance_plan_${sys}`)
    );
    if (missingPlans.length > 0) {
      await Promise.all(missingPlans.map(sys => {
        const template = MAINT_TEMPLATE[sys] ?? DEFAULT_TEMPLATE;
        planMap[sys] = template;
        return supabase.from('project_documents').insert({
          project_id: pid,
          document_type: `maintenance_plan_${sys}`,
          title: `${sys} Maintenance Plan`,
          content: template,
          status: 'draft',
          generated_by: 'auto',
        });
      }));
    }

    // Auto-generate scope when there is no existing content — use Claude if possible
    const existingScope = (docData ?? []).find(d => d.document_type === 'scope_of_works');
    if ((!existingScope || !existingScope.content?.trim()) && activeSystemsList.length > 0) {
      setScopeContent('');
      setScopeRegenerating(true);
      // Fire-and-forget so the rest of the page loads immediately
      (async () => {
        const { data: srcDocs } = await supabase.from('project_source_docs').select('*').eq('project_id', pid!);
        const generated = await callGenerateScope(project, srcDocs ?? [], devData ?? []);
        const finalScope = generated ?? buildAutoScope(
          activeSystemsList.map(sys => ({
            system: sys as string,
            devices: (devData ?? []).filter(d => d.system_type === sys) as any[],
          })),
          project?.site_name,
          project?.client_name
        );
        setScopeContent(finalScope);
        setScopeRegenerating(false);
        if (existingScope) {
          await supabase.from('project_documents').update({ content: finalScope, generated_by: 'auto' }).eq('id', existingScope.id);
        } else {
          await supabase.from('project_documents').insert({
            project_id: pid,
            document_type: 'scope_of_works',
            title: 'Scope of Works',
            content: finalScope,
            status: 'draft',
            generated_by: 'auto',
          });
        }
      })();
    } else {
      setScopeContent(existingScope?.content ?? '');
    }

    setMaintPlanContent(planMap);

    setLoading(false);
  }, [pid, productModels, datasheets, project]);

  useEffect(() => { load(); }, [load]);

  // Pre-render handover PDFs to images whenever the upload list changes
  useEffect(() => {
    const hUploads = omUploads.filter(u => HANDOVER_SECTIONS.has(u.section));
    if (hUploads.length === 0) return;
    hUploads.forEach(upload => {
      setHandoverPageImages(prev => {
        if (prev[upload.id]) return prev; // already loaded or loading
        return { ...prev, [upload.id]: { pages: [], loading: true, failed: false } };
      });
      renderPdfToImages(upload.file_url).then(pages => {
        setHandoverPageImages(prev => ({
          ...prev,
          [upload.id]: { pages: pages ?? [], loading: false, failed: pages === null },
        }));
      });
    });
  }, [omUploads]);

  // Pre-render as-fitted drawings to images whenever the list changes
  useEffect(() => {
    if (asFittedDrawings.length === 0) return;
    asFittedDrawings.forEach(drawing => {
      setAsFittedPageImages(prev => {
        if (prev[drawing.id]) return prev;
        return { ...prev, [drawing.id]: { pages: [], loading: true, failed: false } };
      });
      renderPdfToImages(drawing.file_url).then(pages => {
        setAsFittedPageImages(prev => ({
          ...prev,
          [drawing.id]: { pages: pages ?? [], loading: false, failed: pages === null },
        }));
      });
    });
  }, [asFittedDrawings]);

  // Pre-render unique datasheet PDFs to images whenever devices changes
  useEffect(() => {
    const seen = new Set<string>();
    const unique: { id: number; url: string }[] = [];
    for (const d of devices) {
      if (!d.datasheet?.datasheet_url || !d.datasheet.id) continue;
      const key = `${d.manufacturer?.trim().toLowerCase()}|${d.model_number?.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ id: d.datasheet.id, url: d.datasheet.datasheet_url });
    }
    if (unique.length === 0) return;
    unique.forEach(({ id, url }) => {
      setDatasheetPageImages(prev => {
        if (prev[id]) return prev;
        return { ...prev, [id]: { pages: [], loading: true, failed: false } };
      });
      renderPdfToImages(url).then(pages => {
        setDatasheetPageImages(prev => ({
          ...prev,
          [id]: { pages: pages ?? [], loading: false, failed: pages === null },
        }));
      });
    });
  }, [devices]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const systemGroups = SYSTEM_TYPES.map(st => ({
    system: st,
    devices: devices.filter(d => d.system_type === st),
  })).filter(g => g.devices.length > 0);

  const getUpload = (section: string) => omUploads.find(u => u.section === section);

  const sectionStatus = (s: Section): 'complete' | 'partial' | 'empty' => {
    if (s === 'index') return 'complete';
    if (s === 'cover') return 'complete';
    if (s === 'scope') return scopeContent ? 'complete' : 'empty';
    if (s === 'schedule') return devices.length > 0 ? 'complete' : 'empty';
    if (s === 'technical_docs') {
      const hasTechData = SYSTEM_TYPES.some(sys => (techDocState[sys]?.rows.length ?? 0) > 0);
      const techDevices = devices.filter(d =>
        d.ip_address || d.mac_address || d.firmware_version || d.username_hint || d.password_hint || d.controller_address || d.vlan || d.network_zone
      );
      return hasTechData || techDevices.length > 0 ? 'complete' : 'empty';
    }
    if (s === 'maintenance_plan') return systemGroups.some(g => maintPlanContent[g.system]?.trim()) ? 'complete' : 'empty';
    if (s === 'commissioning') return getUpload('commissioning') ? 'complete' : commRecords.length > 0 ? 'partial' : 'empty';
    if (s === 'handover') {
      const hUploads = omUploads.filter(u => HANDOVER_SECTIONS.has(u.section));
      return hUploads.length > 0 || scHandoverDocs.length > 0 ? 'complete' : handoverDocs.length > 0 ? 'partial' : 'empty';
    }
    if (s === 'as_fitted') return asFittedDrawings.length > 0 ? 'complete' : 'empty';
    if (s === 'datasheets') return devices.some(d => d.datasheet) ? 'complete' : 'empty';
    if (s === 'user_manuals') return projectManuals.length > 0 ? 'complete' : 'empty';
    return 'empty';
  };

  // ── Scope save ───────────────────────────────────────────────────────────────

  const handleSaveScope = async () => {
    if (!pid) return;
    setScopeSaving(true);
    const existing = projectDocs.find(d => d.document_type === 'scope_of_works');
    if (existing) {
      await supabase.from('project_documents').update({ content: scopeContent, status: 'final' }).eq('id', existing.id);
    } else {
      await supabase.from('project_documents').insert({ project_id: pid, document_type: 'scope_of_works', title: 'Scope of Works', content: scopeContent, status: 'final', generated_by: 'manual' });
    }
    setScopeSaving(false);
    load();
  };

  const handleRegenerateScope = async () => {
    if (!pid) return;
    setScopeRegenerating(true);
    try {
      const { data: sourceDocs } = await supabase
        .from('project_source_docs')
        .select('*')
        .eq('project_id', pid)
        .order('created_at', { ascending: true });

      const generated = await callGenerateScope(project, sourceDocs ?? [], devices);
      const newScope = generated ?? buildAutoScope(systemGroups, project?.site_name, project?.client_name);

      setScopeContent(newScope);
      setScopeSaving(true);
      const existing = projectDocs.find(d => d.document_type === 'scope_of_works');
      if (existing) {
        await supabase.from('project_documents').update({ content: newScope, generated_by: 'auto', status: 'draft' }).eq('id', existing.id);
      } else {
        await supabase.from('project_documents').insert({
          project_id: pid, document_type: 'scope_of_works', title: 'Scope of Works',
          content: newScope, status: 'draft', generated_by: 'auto',
        });
      }
      setScopeSaving(false);
    } finally {
      setScopeRegenerating(false);
    }
    load();
  };

  // ── Maintenance Plan save ─────────────────────────────────────────────────────

  const handleSaveMaintPlan = async (system: string) => {
    if (!pid) return;
    setMaintPlanSaving(system);
    const docType = `maintenance_plan_${system}`;
    const content = maintPlanContent[system] ?? '';
    const existing = projectDocs.find(d => d.document_type === docType);
    if (existing) {
      await supabase.from('project_documents').update({ content, status: 'final' }).eq('id', existing.id);
    } else {
      await supabase.from('project_documents').insert({ project_id: pid, document_type: docType, title: `${system} Maintenance Plan`, content, status: 'final', generated_by: 'manual' });
    }
    setMaintPlanSaving(null);
    load();
  };

  // ── PDF Upload ────────────────────────────────────────────────────────────────

  const triggerUpload = (section: string) => {
    uploadSectionRef.current = section;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pid) return;
    const section = uploadSectionRef.current;
    setUploading(section);

    const path = `${pid}/${section}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('om-uploads').upload(path, file, { upsert: true });
    if (upErr) { alert('Upload failed: ' + upErr.message); setUploading(null); return; }

    const { data: { publicUrl } } = supabase.storage.from('om-uploads').getPublicUrl(path);

    // Remove any previous upload for this section
    const existing = getUpload(section);
    if (existing) await supabase.from('om_pack_uploads').delete().eq('id', existing.id);

    await supabase.from('om_pack_uploads').insert({ project_id: pid, section, file_name: file.name, file_url: publicUrl });
    setUploading(null);
    e.target.value = '';
    load();
  };

  const handleRemoveUpload = async (upload: OmUpload) => {
    if (!confirm(`Remove "${upload.file_name}"?`)) return;
    await supabase.from('om_pack_uploads').delete().eq('id', upload.id);
    load();
  };

  // ── Print ─────────────────────────────────────────────────────────────────────

  const hUploads = omUploads.filter(u => HANDOVER_SECTIONS.has(u.section));
  const handoverRendering = hUploads.some(u => handoverPageImages[u.id]?.loading);
  const asFittedRendering = asFittedDrawings.some(d => asFittedPageImages[d.id]?.loading);
  const datasheetRendering = Object.values(datasheetPageImages).some(v => v.loading);
  const printRendering = handoverRendering || asFittedRendering || datasheetRendering;

  const handlePrint = () => window.print();

  const [generatingPdf, setGeneratingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (generatingPdf || printRendering) return;
    setGeneratingPdf(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: html2canvas } = await import('html2canvas');

      const printRoot = document.getElementById('om-print-root');
      if (!printRoot) return;

      // ── PDF page constants (mm) ───────────────────────────────────────────
      const PAGE_W = 210;
      const PAGE_H = 297;
      const M_TOP = 20;
      const M_BOTTOM = 20;
      const M_LEFT = 15;
      const M_RIGHT = 15;
      const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;  // 180mm
      const CONTENT_H = PAGE_H - M_TOP - M_BOTTOM;  // 257mm
      const FOOTER_Y = PAGE_H - 10; // 10mm from bottom edge

      // Rendering: content area width in px for html2canvas
      const RENDER_W_PX = Math.round(CONTENT_W * 4.5); // ~810px

      // ── Setup off-screen render ───────────────────────────────────────────
      const savedStyles = printRoot.style.cssText;
      printRoot.style.cssText = `
        display: block !important;
        position: fixed;
        top: 0; left: -9999px;
        width: ${RENDER_W_PX}px;
        z-index: -9999;
        background: white;
        visibility: visible;
      `;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // ── Collect sections (skip page-break divs) ───────────────────────────
      const pageEls = (Array.from(printRoot.children) as HTMLElement[]).filter(
        el => !el.classList.contains('page-break')
      );

      // ── PASS 1: Render all sections, calculate real page numbers ──────────
      type RenderedSection = {
        canvas: HTMLCanvasElement;
        anchorId: string | null;
        isCover: boolean;
      };

      const renderedSections: RenderedSection[] = [];
      for (let i = 0; i < pageEls.length; i++) {
        const el = pageEls[i];
        const anchorId = el.id || el.querySelector('[id]')?.id || null;
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          width: RENDER_W_PX,
          windowWidth: RENDER_W_PX,
          scrollX: 0, scrollY: 0,
          logging: false,
        });
        renderedSections.push({
          canvas,
          anchorId: anchorId?.startsWith('print-section-') ? anchorId : null,
          isCover: i === 0,
        });
      }

      // Calculate page numbers for each section in a dry run
      const sectionPageMap: Record<string, number> = {};
      let dryPage = 1;
      for (const section of renderedSections) {
        if (section.anchorId) {
          sectionPageMap[section.anchorId] = dryPage;
        }
        if (section.isCover) {
          // Cover always takes exactly 1 page
          dryPage++;
        } else {
          const contentH_mm = (section.canvas.height / section.canvas.width) * CONTENT_W;
          const pagesNeeded = Math.ceil(contentH_mm / CONTENT_H);
          dryPage += pagesNeeded;
        }
      }

      // ── PASS 2: Update ToC with real page numbers then re-render ToC ──────
      const tocEl = printRoot.querySelector('#print-section-toc');
      if (tocEl) {
        const tocPageLinks = tocEl.querySelectorAll('.toc-page-link');
        tocPageLinks.forEach(link => {
          const href = link.getAttribute('href');
          if (href) {
            const targetId = href.replace('#', '');
            const pageNum = sectionPageMap[targetId];
            if (pageNum) {
              (link as HTMLElement).textContent = String(pageNum);
            }
          }
        });
        // Re-render the ToC section canvas
        const tocSectionIdx = renderedSections.findIndex(s => s.anchorId === 'print-section-toc');
        if (tocSectionIdx >= 0) {
          const tocCanvas = await html2canvas(tocEl as HTMLElement, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#ffffff',
            width: RENDER_W_PX,
            windowWidth: RENDER_W_PX,
            scrollX: 0, scrollY: 0,
            logging: false,
          });
          renderedSections[tocSectionIdx].canvas = tocCanvas;
        }
      }

      // ── PASS 3: Build the actual PDF ──────────────────────────────────────
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      let currentPage = 0;

      const newPage = () => {
        if (currentPage > 0) pdf.addPage();
        currentPage++;
      };

      const drawFooter = (pageNum: number) => {
        pdf.setFontSize(7.5);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Page ${pageNum}`, PAGE_W / 2, FOOTER_Y, { align: 'center' });
        pdf.setFontSize(6.5);
        pdf.text(
          project?.project_name || 'O&M Pack',
          PAGE_W - M_RIGHT, FOOTER_Y,
          { align: 'right' }
        );
      };

      const drawHeaderLine = () => {
        pdf.setDrawColor(226, 232, 240);
        pdf.setLineWidth(0.3);
        pdf.line(M_LEFT, M_TOP - 3, PAGE_W - M_RIGHT, M_TOP - 3);
      };

      for (const section of renderedSections) {
        const { canvas, isCover } = section;
        const contentH_mm = (canvas.height / canvas.width) * CONTENT_W;
        const pxPerMm = canvas.width / CONTENT_W;

        if (isCover) {
          // Cover page: full-bleed, no margins, no footer
          newPage();
          const coverH = (canvas.height / canvas.width) * PAGE_W;
          const imgData = canvas.toDataURL('image/jpeg', 0.94);
          pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W, Math.min(coverH, PAGE_H));
          continue;
        }

        // Content sections: respect margins, slice across pages
        let srcY_px = 0;
        let remainingH_mm = contentH_mm;
        let isFirstSlice = true;

        while (remainingH_mm > 0.5) {
          newPage();

          // Draw subtle header line (not on first page of a section to avoid clutter)
          if (!isFirstSlice) drawHeaderLine();

          const availH_mm = CONTENT_H;
          const sliceH_mm = Math.min(remainingH_mm, availH_mm);
          const sliceH_px = Math.round(sliceH_mm * pxPerMm);

          // Extract slice from canvas
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.min(sliceH_px, canvas.height - srcY_px);
          const ctx = sliceCanvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0, srcY_px,
            canvas.width, sliceCanvas.height,
            0, 0,
            canvas.width, sliceCanvas.height
          );

          const actualSliceH_mm = (sliceCanvas.height / sliceCanvas.width) * CONTENT_W;
          const imgData = sliceCanvas.toDataURL('image/jpeg', 0.94);
          pdf.addImage(imgData, 'JPEG', M_LEFT, M_TOP, CONTENT_W, actualSliceH_mm);

          // Footer on every non-cover page
          drawFooter(currentPage);

          srcY_px += sliceH_px;
          remainingH_mm -= sliceH_mm;
          isFirstSlice = false;
        }
      }

      // ── Add PDF bookmarks ─────────────────────────────────────────────────
      const ANCHOR_LABELS: Record<string, string> = {
        'print-section-toc':              'Table of Contents',
        'print-section-cover':            'Cover Page',
        'print-section-scope':            'Scope of Works',
        'print-section-schedule':         'Device Schedule',
        'print-section-technical_docs':   'Technical Documentation',
        'print-section-maintenance_plan': 'Maintenance Plan',
        'print-section-commissioning':    'Commissioning Pack',
        'print-section-handover':         'Handover Documents',
        'print-section-as_fitted':        'As Fitted Drawings',
        'print-section-datasheets':       'Datasheet Index',
        'print-section-user_manuals':     'User Manuals',
      };
      for (const [anchorId, pageNum] of Object.entries(sectionPageMap)) {
        const label = ANCHOR_LABELS[anchorId] ?? anchorId.replace('print-section-', '');
        if ((pdf as any).outline) {
          (pdf as any).outline.add(null, label, { pageNumber: pageNum });
        }
      }

      // ── Add clickable internal links on ToC page ──────────────────────────
      const tocPageNum = sectionPageMap['print-section-toc'];
      if (tocPageNum) {
        pdf.setPage(tocPageNum);
        // Add link annotations for each ToC entry pointing to the target page
        for (const [anchorId, targetPage] of Object.entries(sectionPageMap)) {
          if (anchorId === 'print-section-toc' || anchorId === 'print-section-cover') continue;
          pdf.link(M_LEFT, 0, CONTENT_W, PAGE_H, { pageNumber: targetPage });
        }
      }

      // ── Restore DOM ───────────────────────────────────────────────────────
      printRoot.style.cssText = savedStyles;

      const filename = `OM-Pack-${(project?.project_name || project?.site_name || 'document').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(filename);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed. Please use the Print button and save as PDF from the print dialog.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const completeSections = SECTIONS.filter(s => sectionStatus(s.id) === 'complete').length;

  return (
    <div className="print:p-0">
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />

      {/* ── Screen toolbar ── */}
      <div className="flex items-center justify-between mb-5 print:hidden">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">O&M Pack Builder</h2>
          <p className="text-sm text-slate-500 mt-0.5">{completeSections}/{SECTIONS.length} sections complete · Ready to print and send to customer</p>
        </div>
        <div className="flex items-center gap-3">
          {printRendering && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />Preparing PDFs for print…
            </span>
          )}
          <button onClick={handlePrint} disabled={printRendering}
            className="inline-flex items-center gap-2 bg-slate-700 text-white px-4 py-2.5 rounded-xl hover:bg-slate-600 transition-colors font-medium text-sm shadow-sm disabled:opacity-50 disabled:cursor-wait">
            <Printer className="w-4 h-4" />Print
          </button>
          <button onClick={handleDownloadPdf} disabled={printRendering || generatingPdf}
            className="inline-flex items-center gap-2 bg-cyan-600 text-white px-5 py-2.5 rounded-xl hover:bg-cyan-700 transition-colors font-medium text-sm shadow-sm disabled:opacity-50 disabled:cursor-wait">
            {generatingPdf
              ? <><Loader2 className="w-4 h-4 animate-spin" />Generating PDF…</>
              : <><Download className="w-4 h-4" />Download PDF</>
            }
          </button>
        </div>
      </div>

      {/* ── Layout: sidebar + content ── */}
      <div className="flex gap-5 print:hidden">
        {/* Sidebar nav */}
        <div className="w-52 flex-shrink-0">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {SECTIONS.map((s, i) => {
              const st = sectionStatus(s.id);
              const isActive = activeSection === s.id;
              return (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors text-sm ${
                    i > 0 ? 'border-t border-slate-100' : ''
                  } ${isActive ? 'bg-cyan-50 text-cyan-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <s.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-cyan-600' : 'text-slate-400'}`} />
                  <span className="flex-1 font-medium truncate">{s.label}</span>
                  {st === 'complete' && <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />}
                  {st === 'partial' && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />}
                  {st === 'empty' && <span className="w-2 h-2 rounded-full bg-slate-200 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="mt-3 px-1">
            <p className="text-xs text-slate-400">Green = ready · Amber = partial · Grey = missing</p>
          </div>
        </div>

        {/* Section content */}
        <div className="flex-1 min-w-0">
          {activeSection === 'index' && (() => {
            const contentSections = SECTIONS.filter(s => s.id !== 'index');
            const sectionDetails: Record<string, string> = {
              cover: project?.project_name ? `${project.project_name}${project.client_name ? ' — ' + project.client_name : ''}` : 'Project overview and system summary',
              scope: scopeContent ? 'Scope of works document ready' : 'Not yet generated',
              schedule: devices.length > 0 ? `${devices.length} device${devices.length !== 1 ? 's' : ''} across ${systemGroups.length} system${systemGroups.length !== 1 ? 's' : ''}` : 'No devices added',
              technical_docs: (() => {
                const imported = SYSTEM_TYPES.filter(s => (techDocState[s]?.rows.length ?? 0) > 0);
                if (imported.length > 0) return `Imported data for: ${imported.join(', ')}`;
                const n = devices.filter(d => d.ip_address || d.mac_address || d.firmware_version || d.username_hint || d.password_hint).length;
                return n > 0 ? `${n} device${n !== 1 ? 's' : ''} with technical info` : 'No technical data entered';
              })(),
              maintenance_plan: systemGroups.filter(g => maintPlanContent[g.system]?.trim()).length > 0
                ? `Plans for ${systemGroups.filter(g => maintPlanContent[g.system]?.trim()).map(g => g.system).join(', ')}`
                : 'Not yet created',
              commissioning: getUpload('commissioning') ? 'PDF uploaded' : commRecords.length > 0 ? `${commRecords.length} test records in database` : 'Not yet uploaded',
              handover: (() => { const h = omUploads.filter(u => HANDOVER_SECTIONS.has(u.section)); const total = h.length + scHandoverDocs.length; return total > 0 ? `${total} document${total !== 1 ? 's' : ''} ready` : handoverDocs.length > 0 ? 'Handover data available' : 'Not yet uploaded'; })(),
              as_fitted: asFittedDrawings.length > 0 ? `${asFittedDrawings.length} drawing${asFittedDrawings.length !== 1 ? 's' : ''} uploaded` : 'No drawings uploaded',
              datasheets: (() => { const found = devices.filter(d => d.datasheet).length; return found > 0 ? `${found} of ${devices.length} devices have datasheets` : 'No datasheets found'; })(),
              user_manuals: projectManuals.length > 0 ? `${projectManuals.length} manual${projectManuals.length !== 1 ? 's' : ''} attached` : 'No manuals attached',
            };
            const complete = contentSections.filter(s => sectionStatus(s.id) === 'complete').length;
            const tocEntries = contentSections.map((s, i) => ({
              ...s,
              number: i + 1,
              status: sectionStatus(s.id),
              detail: sectionDetails[s.id],
            }));
            return (
              <div className="space-y-4">
                {/* Stats card */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                        <ListOrdered className="w-5 h-5 text-slate-600" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">Table of Contents</h2>
                        <p className="text-xs text-slate-500 mt-0.5">Auto-generated · updates as sections are completed</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-slate-900">{complete}<span className="text-slate-300">/{contentSections.length}</span></p>
                      <p className="text-xs text-slate-500">sections ready</p>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${(complete / contentSections.length) * 100}%` }} />
                  </div>
                </div>

                {/* ToC document-style list */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {project?.project_name || project?.site_name || 'Project'} — O&amp;M Pack Contents
                    </p>
                  </div>
                  <div className="px-6 py-3 divide-y divide-slate-50">
                    {tocEntries.map(entry => {
                      const st = entry.status;
                      return (
                        <button
                          key={entry.id}
                          onClick={() => setActiveSection(entry.id)}
                          className="w-full flex items-center gap-3 py-3.5 hover:bg-slate-50 -mx-6 px-6 transition-colors text-left group"
                        >
                          {/* Number */}
                          <span className="w-7 text-right text-sm font-bold text-slate-300 flex-shrink-0 tabular-nums">
                            {entry.number}
                          </span>
                          {/* Status dot */}
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            st === 'complete' ? 'bg-emerald-400' :
                            st === 'partial'  ? 'bg-amber-400' : 'bg-slate-200'
                          }`} />
                          {/* Title */}
                          <span className="text-sm font-semibold text-slate-900 flex-shrink-0">{entry.label}</span>
                          {/* Dotted leader */}
                          <span className="flex-1 border-b-2 border-dotted border-slate-200 mx-2 mb-0.5" />
                          {/* Status badge */}
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mr-2 ${
                            st === 'complete' ? 'bg-emerald-100 text-emerald-700' :
                            st === 'partial'  ? 'bg-amber-100 text-amber-700' :
                                               'bg-slate-100 text-slate-400'
                          }`}>
                            {st === 'complete' ? 'Ready' : st === 'partial' ? 'Partial' : 'Missing'}
                          </span>
                          {/* Detail */}
                          <span className="text-xs text-slate-400 hidden lg:block truncate max-w-[200px] flex-shrink-0">
                            {entry.detail}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-cyan-500 transition-colors flex-shrink-0 ml-1" />
                        </button>
                      );
                    })}
                  </div>
                  {complete === contentSections.length && (
                    <div className="px-6 py-4 bg-emerald-50 border-t border-emerald-100 flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                      <p className="text-sm font-semibold text-emerald-800">All sections complete — your O&amp;M pack is ready to print.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {activeSection === 'cover' && <CoverSection project={project} devices={devices} systemGroups={systemGroups} contractor={contractorProfile} authority={docAuthority} />}
          {activeSection === 'scope' && (
            <ScopeSection
              content={scopeContent}
              onChange={setScopeContent}
              onSave={handleSaveScope}
              onRegenerate={handleRegenerateScope}
              saving={scopeSaving}
              regenerating={scopeRegenerating}
              activeSystems={activeSystems}
              isAiGenerated={!!projectDocs.find(d => d.document_type === 'scope_of_works' && d.generated_by === 'ai')}
            />
          )}
          {activeSection === 'schedule' && <ScheduleSection systemGroups={systemGroups} />}
          {activeSection === 'technical_docs' && <TechnicalDocsSection devices={devices} techDocState={techDocState} />}
          {activeSection === 'maintenance_plan' && (
            <MaintenancePlanSection
              systemGroups={systemGroups}
              content={maintPlanContent}
              onChange={(sys, val) => setMaintPlanContent(prev => ({ ...prev, [sys]: val }))}
              onSave={handleSaveMaintPlan}
              saving={maintPlanSaving}
            />
          )}
          {activeSection === 'commissioning' && (
            <UploadSection
              sectionId="commissioning"
              title="Commissioning Pack"
              description="Upload your completed commissioning sign-off document (PDF). This can be the commissioning pack that was filled in and signed on site."
              upload={getUpload('commissioning')}
              uploading={uploading === 'commissioning'}
              onUpload={() => triggerUpload('commissioning')}
              onRemove={handleRemoveUpload}
              fallbackContent={commRecords.length > 0 ? <CommSummary records={commRecords} /> : null}
              fallbackLabel={`${commRecords.length} commissioning test records in database`}
            />
          )}
          {activeSection === 'handover' && (
            <HandoverPackSection
              uploads={omUploads.filter(u => HANDOVER_SECTIONS.has(u.section))}
              onRemove={handleRemoveUpload}
              handoverDocs={handoverDocs}
              scHandoverDocs={scHandoverDocs}
            />
          )}
          {activeSection === 'as_fitted' && (
            <AsFittedDrawingsSection drawings={asFittedDrawings} pageImages={asFittedPageImages} />
          )}
          {activeSection === 'datasheets' && <DatasheetsSection systemGroups={systemGroups} />}
          {activeSection === 'user_manuals' && (
            <UserManualsSection
              pid={pid!}
              projectManuals={projectManuals}
              onRefresh={load}
            />
          )}
        </div>
      </div>

      {/* ══ PRINT VIEW — all sections rendered sequentially ══ */}
      <div id="om-print-root" className="hidden print:block">
        {/* Cover page — page 1, @page :first suppresses footer */}
        <div id="print-section-cover">
          <PrintCoverPage project={project} devices={devices} systemGroups={systemGroups} contractor={contractorProfile} authority={docAuthority} />
        </div>
        <div className="page-break" />

        {/* Table of Contents — page 2 */}
        <PrintTableOfContents
          project={project}
          hasScope={!!scopeContent}
          hasSchedule={devices.length > 0}
          hasTechDocs={SYSTEM_TYPES.some(s => (techDocState[s]?.rows.length ?? 0) > 0) || devices.some(d => d.ip_address || d.mac_address || d.firmware_version || d.username_hint || d.password_hint || d.controller_address || d.vlan || d.network_zone)}
          hasMaintPlan={systemGroups.some(g => maintPlanContent[g.system]?.trim())}
          hasCommissioning={!!(getUpload('commissioning') || commRecords.length > 0)}
          hasHandover={!!(omUploads.filter(u => HANDOVER_SECTIONS.has(u.section)).length > 0 || handoverDocs.length > 0)}
          hasAsFitted={asFittedDrawings.length > 0}
          hasDatasheets={devices.some(d => d.datasheet)}
          hasUserManuals={projectManuals.length > 0}
        />
        <div className="page-break" />

        {scopeContent && (
          <>
            <PrintSection title="Scope of Works" anchorId="print-section-scope">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(scopeContent) }} />
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {devices.length > 0 && (
          <>
            <PrintSection title="Device Schedule" anchorId="print-section-schedule">
              {systemGroups.map(g => <PrintDeviceTable key={g.system} system={g.system} devices={g.devices} />)}
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {(() => {
          const hasTechImport = SYSTEM_TYPES.some(s => (techDocState[s]?.rows.length ?? 0) > 0);
          const techDevices = devices.filter(d => d.ip_address || d.mac_address || d.firmware_version || d.username_hint || d.password_hint || d.controller_address || d.vlan || d.network_zone);
          if (!hasTechImport && techDevices.length === 0) return null;
          if (hasTechImport) {
            const systemsWithData = SYSTEM_TYPES.filter(s => (techDocState[s]?.rows.length ?? 0) > 0);
            return (
              <>
                {systemsWithData.map((sys, idx) => (
                  <PrintSection
                    key={sys}
                    title={`${sys} — Technical Documentation`}
                    anchorId={idx === 0 ? 'print-section-technical_docs' : `print-section-technical_docs_${sys.toLowerCase().replace(/\s+/g, '_')}`}
                    forcePageBreak={idx > 0}
                  >
                    <PrintTechnicalDocsSystem sys={sys} state={techDocState[sys]!} />
                  </PrintSection>
                ))}
                <div className="page-break" />
              </>
            );
          }
          return (
            <>
              <PrintSection title="Technical Documentation" anchorId="print-section-technical_docs">
                <PrintTechnicalDocsLegacy devices={techDevices} />
              </PrintSection>
              <div className="page-break" />
            </>
          );
        })()}

        {systemGroups.some(g => maintPlanContent[g.system]?.trim()) && (
          <>
            <PrintSection title="Maintenance Plan" anchorId="print-section-maintenance_plan">
              {systemGroups.filter(g => maintPlanContent[g.system]?.trim()).map(g => (
                <div key={g.system} className="mb-8">
                  <h3 className="text-base font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">{g.system}</h3>
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(maintPlanContent[g.system]) }} />
                </div>
              ))}
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {getUpload('commissioning') ? (
          <>
            <PrintSection title="Commissioning Pack" anchorId="print-section-commissioning">
              <PrintAttachment upload={getUpload('commissioning')!} />
            </PrintSection>
            <div className="page-break" />
          </>
        ) : commRecords.length > 0 && (
          <>
            <PrintSection title="Commissioning Records" anchorId="print-section-commissioning">
              <CommSummary records={commRecords} />
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {(() => {
          const hUploads = omUploads.filter(u => HANDOVER_SECTIONS.has(u.section));
          if (hUploads.length > 0) return (
            <>
              <PrintSection title="Handover Documents" anchorId="print-section-handover">
                <PrintHandoverDocs uploads={hUploads} pageImages={handoverPageImages} />
              </PrintSection>
              <div className="page-break" />
            </>
          );
          if (handoverDocs.length > 0) return (
            <>
              <PrintSection title="Handover Documents" anchorId="print-section-handover">
                <HandoverSummary docs={handoverDocs} />
              </PrintSection>
              <div className="page-break" />
            </>
          );
          return null;
        })()}

        {asFittedDrawings.length > 0 && (
          <>
            <PrintAsFittedDrawings drawings={asFittedDrawings} pageImages={asFittedPageImages} />
            <div className="page-break" />
          </>
        )}

        {devices.some(d => d.datasheet) && (
          <>
            <PrintSection title="Datasheet Index" anchorId="print-section-datasheets">
              <PrintDatasheets groups={systemGroups} pageImages={datasheetPageImages} />
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {projectManuals.length > 0 && (
          <>
            <PrintSection title="User Manuals" anchorId="print-section-user_manuals">
              <div className="space-y-3">
                {projectManuals.map(pm => (
                  <div key={pm.id} className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg">
                    <BookMarked className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{pm.manual.title}</p>
                      {pm.manual.description && <p className="text-xs text-slate-500 mt-0.5">{pm.manual.description}</p>}
                      {(pm.manual.manufacturer || pm.manual.model_number) && (
                        <p className="text-xs text-slate-400 mt-0.5">{[pm.manual.manufacturer, pm.manual.model_number].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <a href={pm.manual.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-600 hover:underline flex-shrink-0">View</a>
                  </div>
                ))}
              </div>
            </PrintSection>
          </>
        )}
      </div>

      <style>{`
        /* ── O&M Print Styles ───────────────────────────────────────────── */
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-family: system-ui, -apple-system, sans-serif;
          }

          /* Page breaks */
          .page-break { page-break-after: always; break-after: page; }
          .om-cover-page { page-break-after: always; break-after: page; }

          /* Default page — A4 with 20mm header/footer reserved */
          @page {
            size: A4;
            margin: 20mm 15mm 20mm 15mm;
            @bottom-center {
              content: "Page " counter(page) " of " counter(pages);
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 8pt;
              color: #94a3b8;
            }
            @bottom-right {
              content: string(section-title);
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 7pt;
              color: #cbd5e1;
            }
          }

          /* Cover page (first) — no margins, no footer */
          @page :first {
            margin: 0;
            @bottom-center { content: none; }
            @bottom-right { content: none; }
          }

          /* ToC page number links via CSS target-counter (Chromium print engine) */
          .toc-page-link::after {
            content: target-counter(attr(href url), page);
            font-size: 0.85rem;
            font-weight: 800;
            color: #0f172a;
          }

          /* Running section title — picked up from h2 inside om-section */
          .om-section h2 {
            string-set: section-title content();
          }

          /* Prevent orphaned headings */
          h2, h3 { page-break-after: avoid; break-after: avoid; }

          /* Tables: allow page breaks between rows but repeat headers */
          table { border-collapse: collapse; }
          thead { display: table-header-group; }
          tbody tr { page-break-inside: avoid; break-inside: avoid; }

          img { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}

// ─── Screen sections ──────────────────────────────────────────────────────────

// ─── Screen sections ──────────────────────────────────────────────────────────

// ─── Technical Docs Section ───────────────────────────────────────────────────

function TechnicalDocsSection({ devices, techDocState }: {
  devices: DeviceWithDatasheet[];
  techDocState: Partial<Record<string, { rows: { id: number; row_index: number; data: Record<string, string> }[]; colConfig: { key: string; display_name: string; visible: boolean; order: number }[] }>>;
}) {
  const systemsWithImport = SYSTEM_TYPES.filter(s => (techDocState[s]?.rows.length ?? 0) > 0);

  if (systemsWithImport.length > 0) {
    return (
      <div className="space-y-6">
        {systemsWithImport.map(sys => {
          const state = techDocState[sys]!;
          const visibleCols = state.colConfig.filter(c => c.visible).sort((a, b) => a.order - b.order);
          return (
            <div key={sys} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200 bg-slate-50">
                <Wifi className="w-4 h-4 text-slate-400" />
                <h3 className="font-semibold text-slate-800">{sys}</h3>
                <span className="text-xs text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full ml-1">{state.rows.length} rows</span>
              </div>
              {visibleCols.length === 0 ? (
                <p className="text-sm text-slate-400 px-6 py-4">No columns configured. Go to Technical Docs to configure columns.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {visibleCols.map(col => (
                          <th key={col.key} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{col.display_name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {state.rows.map(row => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          {visibleCols.map(col => (
                            <td key={col.key} className="px-4 py-2.5 font-mono text-xs text-slate-700">{row.data[col.key] || <span className="text-slate-300">-</span>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Fallback to device schedule data
  const techDevices = devices.filter(d =>
    d.ip_address || d.mac_address || d.firmware_version ||
    d.username_hint || d.password_hint || d.controller_address || d.vlan || d.network_zone
  );

  if (techDevices.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <Wifi className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-medium">No technical data yet</p>
        <p className="text-sm text-slate-400 mt-1">Import CSV/Excel files in the Technical Docs page to populate this section.</p>
      </div>
    );
  }

  const fields: { key: keyof DeviceWithDatasheet; label: string }[] = [
    { key: 'ip_address',        label: 'IP Address' },
    { key: 'mac_address',       label: 'MAC Address' },
    { key: 'firmware_version',  label: 'Firmware' },
    { key: 'username_hint',     label: 'Username' },
    { key: 'password_hint',     label: 'Password' },
    { key: 'controller_address',label: 'Controller' },
    { key: 'vlan',              label: 'VLAN' },
    { key: 'network_zone',      label: 'Network Zone' },
  ];
  const usedFields = fields.filter(f => techDevices.some(d => d[f.key]));

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200">
        <Wifi className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Technical Documentation</h3>
        <span className="ml-auto text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{techDevices.length} devices with technical info</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Device</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">System</th>
              {usedFields.map(f => (
                <th key={f.key} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {techDevices.map(d => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{d.device_name || '-'}</p>
                  {d.location && <p className="text-xs text-slate-400">{d.location}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{d.system_type || '-'}</span>
                </td>
                {usedFields.map(f => (
                  <td key={f.key} className="px-4 py-3 font-mono text-xs text-slate-700">{String(d[f.key] ?? '') || <span className="text-slate-300">-</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── User Manuals Section ─────────────────────────────────────────────────────

interface ProjectManual {
  id: number;
  manual_id: number;
  manual: { title: string; description: string | null; manufacturer: string | null; model_number: string | null; file_name: string | null; file_url: string | null; link_url: string | null };
}

function UserManualsSection({ pid, projectManuals, onRefresh }: {
  pid: number;
  projectManuals: ProjectManual[];
  onRefresh: () => void;
}) {
  const [allManuals, setAllManuals] = useState<(ProjectManual['manual'] & { id: number })[]>([]);
  const [search, setSearch] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<'upload' | 'link'>('upload');
  const [form, setForm] = useState({ title: '', description: '', manufacturer: '', model_number: '', link_url: '' });
  const [linkVerified, setLinkVerified] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const refreshLibrary = () =>
    supabase.from('user_manuals').select('*').order('title').then(({ data }) => setAllManuals(data ?? []));

  useEffect(() => { refreshLibrary(); }, [projectManuals]);

  const linkedIds = new Set(projectManuals.map(pm => pm.manual_id));

  const filteredLibrary = allManuals.filter(m =>
    !linkedIds.has(m.id) &&
    (search === '' || [m.title, m.description, m.manufacturer, m.model_number].some(v => v?.toLowerCase().includes(search.toLowerCase())))
  );

  const handleAddFromLibrary = async (manualId: number) => {
    await supabase.from('project_user_manuals').insert({ project_id: pid, manual_id: manualId });
    onRefresh();
  };

  const handleRemove = async (pmId: number) => {
    if (!confirm('Remove this manual from the project?')) return;
    await supabase.from('project_user_manuals').delete().eq('id', pmId);
    onRefresh();
  };

  const handleVerifyLink = async () => {
    const url = form.link_url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) { setLinkVerified('fail'); return; }
    setLinkVerified('checking');
    try {
      const r = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
      setLinkVerified(r.type === 'opaque' || r.ok ? 'ok' : 'fail');
    } catch { setLinkVerified('fail'); }
  };

  const resetForm = () => {
    setForm({ title: '', description: '', manufacturer: '', model_number: '', link_url: '' });
    setPendingFile(null);
    setLinkVerified('idle');
    setShowAdd(false);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (addMode === 'upload' && !pendingFile) return;
    if (addMode === 'link' && !form.link_url.trim()) return;
    setSaving(true);
    try {
      let file_url: string | null = null;
      let file_name: string | null = null;
      if (addMode === 'upload' && pendingFile) {
        const path = `manuals/${Date.now()}_${pendingFile.name}`;
        const { error: upErr } = await supabase.storage.from('om-uploads').upload(path, pendingFile, { upsert: false });
        if (upErr) throw new Error(upErr.message);
        ({ data: { publicUrl: file_url } } = supabase.storage.from('om-uploads').getPublicUrl(path));
        file_name = pendingFile.name;
      }
      const { data: manual, error: insErr } = await supabase.from('user_manuals').insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        model_number: form.model_number.trim() || null,
        file_name, file_url,
        link_url: addMode === 'link' ? form.link_url.trim() : null,
      }).select().single();
      if (insErr || !manual) throw new Error(insErr?.message ?? 'Insert failed');
      await supabase.from('project_user_manuals').insert({ project_id: pid, manual_id: manual.id });
      resetForm();
      onRefresh();
      refreshLibrary();
    } catch (e: any) { alert('Save failed: ' + e.message); }
    finally { setSaving(false); }
  };

  const manualHref = (m: ProjectManual['manual']) => m.link_url ?? m.file_url ?? '#';
  const isLinkManual = (m: ProjectManual['manual']) => !!m.link_url && !m.file_url;

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
        onChange={e => { setPendingFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200">
          <BookMarked className="w-4 h-4 text-slate-400" />
          <h3 className="font-semibold text-slate-800">User Manuals</h3>
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full ml-1">{projectManuals.length}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => { setShowLibrary(l => !l); setShowAdd(false); }}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
              <Search className="w-3.5 h-3.5" />Library
            </button>
            <button onClick={() => { setShowAdd(a => !a); setShowLibrary(false); }}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors">
              <Plus className="w-3.5 h-3.5" />Add Manual
            </button>
          </div>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Add Manual</p>
              <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                <button onClick={() => { setAddMode('upload'); setLinkVerified('idle'); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${addMode === 'upload' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  Upload PDF
                </button>
                <button onClick={() => { setAddMode('link'); setPendingFile(null); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${addMode === 'link' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  Paste Link
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-700 mb-1 block">Title <span className="text-red-500">*</span></label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Genetec Security Center Administration Guide"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-700 mb-1 block">Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of the manual contents"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">Manufacturer</label>
                <input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))}
                  placeholder="e.g. Genetec"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">Model / Product</label>
                <input value={form.model_number} onChange={e => setForm(f => ({ ...f, model_number: e.target.value }))}
                  placeholder="e.g. Security Center 5.12"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
            </div>

            {addMode === 'upload' ? (
              <button onClick={() => fileRef.current?.click()}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg text-sm font-medium transition-all ${pendingFile ? 'border-emerald-400 text-emerald-700 bg-emerald-50' : 'border-slate-300 text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50'}`}>
                <FileText className="w-4 h-4" />
                {pendingFile ? pendingFile.name : 'Select PDF file (any size)'}
              </button>
            ) : (
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">URL <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input value={form.link_url} onChange={e => { setForm(f => ({ ...f, link_url: e.target.value })); setLinkVerified('idle'); }}
                    placeholder="https://..."
                    className={`flex-1 text-sm border rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 ${linkVerified === 'ok' ? 'border-emerald-400 bg-emerald-50' : linkVerified === 'fail' ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                  <button onClick={handleVerifyLink} disabled={!form.link_url.trim() || linkVerified === 'checking'}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 whitespace-nowrap ${linkVerified === 'ok' ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : linkVerified === 'fail' ? 'bg-red-50 border-red-300 text-red-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {linkVerified === 'checking' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : linkVerified === 'ok' ? '✓ Verified' : linkVerified === 'fail' ? '✗ Failed' : 'Verify'}
                  </button>
                </div>
                {linkVerified === 'fail' && <p className="text-xs text-amber-600 mt-1">Could not verify the URL — you can still save it.</p>}
                {linkVerified === 'ok' && <p className="text-xs text-emerald-600 mt-1">URL is reachable.</p>}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSave}
                disabled={!form.title.trim() || (addMode === 'upload' ? !pendingFile : !form.link_url.trim()) || saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white text-sm font-medium rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Save & Attach
              </button>
            </div>
          </div>
        )}

        {/* Library search */}
        {showLibrary && (
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">Manual Library</p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title, manufacturer, or model..."
                className="w-full text-sm border border-slate-200 rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
            </div>
            {filteredLibrary.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">{allManuals.length === 0 ? 'No manuals in library yet. Add one above.' : 'No unattached manuals match your search.'}</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredLibrary.map(m => (
                  <div key={m.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
                    {m.link_url && !m.file_url ? <ExternalLink className="w-4 h-4 text-blue-400 flex-shrink-0" /> : <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{m.title}</p>
                      {m.description && <p className="text-xs text-slate-500 truncate">{m.description}</p>}
                      <p className="text-xs text-slate-400">{[m.manufacturer, m.model_number].filter(Boolean).join(' · ')}{m.link_url && !m.file_url ? ' · Link' : ' · PDF'}</p>
                    </div>
                    <button onClick={() => handleAddFromLibrary(m.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors">
                      <Plus className="w-3 h-3" />Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Project manuals list */}
        <div className="divide-y divide-slate-100">
          {projectManuals.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <BookMarked className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No manuals attached to this project.</p>
              <p className="text-xs text-slate-400 mt-1">Upload a PDF or paste a link to add one, or search the library.</p>
            </div>
          ) : (
            projectManuals.map(pm => (
              <div key={pm.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isLinkManual(pm.manual) ? 'bg-blue-50' : 'bg-slate-100'}`}>
                  {isLinkManual(pm.manual) ? <ExternalLink className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-slate-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{pm.manual.title}</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isLinkManual(pm.manual) ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                      {isLinkManual(pm.manual) ? 'LINK' : 'PDF'}
                    </span>
                  </div>
                  {pm.manual.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{pm.manual.description}</p>}
                  {(pm.manual.manufacturer || pm.manual.model_number) && (
                    <p className="text-xs text-slate-400 mt-0.5">{[pm.manual.manufacturer, pm.manual.model_number].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a href={manualHref(pm.manual)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                    <ExternalLink className="w-3 h-3" />{isLinkManual(pm.manual) ? 'Open' : 'View'}
                  </a>
                  <button onClick={() => handleRemove(pm.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CoverSection({ project, devices, systemGroups, contractor, authority }: {
  project: any; devices: DeviceWithDatasheet[]; systemGroups: any[]; contractor: any; authority: any;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Cover Page Preview</h3>
        <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">Auto-populated</span>
      </div>

      <div className="border-2 border-slate-900 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 px-8 py-10 text-white">
          <img
            src="https://www.pacific-uk.co.uk/wp-content/uploads/2018/07/pacific-logo.png"
            alt="Pacific Fire and Security Systems"
            className="h-10 object-contain mb-5 brightness-0 invert"
          />
          {contractor?.company_name && (
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-1">{contractor.company_name}</p>
          )}
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Operations & Maintenance Manual</p>
          <h1 className="text-2xl font-bold leading-tight">{project.project_name || 'Untitled Project'}</h1>
          {project.site_name && <p className="text-slate-300 mt-2 text-sm">{project.site_name}</p>}
          {project.site_address && <p className="text-slate-400 mt-0.5 text-xs">{project.site_address}</p>}
        </div>

        {/* Project info grid */}
        <div className="bg-white px-8 py-6 grid grid-cols-2 gap-4">
          <InfoRow icon={Building2} label="Client" value={project.client_name} />
          <InfoRow icon={User} label="Project Manager" value={project.project_manager} />
          {project.engineer && <InfoRow icon={User} label="Engineer" value={project.engineer} />}
          <InfoRow icon={Tag} label="Project / Quote Ref" value={project.project_number || project.quote_number} />
          {project.main_contractor && <InfoRow icon={Building2} label="Main Contractor" value={project.main_contractor} />}
          <InfoRow icon={Calendar} label="Date" value={new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} />
          {project.completion_date && <InfoRow icon={Calendar} label="Completion Date" value={new Date(project.completion_date).toLocaleDateString('en-GB')} />}
        </div>

        {/* Stats bar */}
        <div className="bg-slate-50 border-t border-slate-200 px-8 py-3 flex gap-6">
          <div className="text-sm"><span className="font-semibold text-slate-900">{devices.length}</span> <span className="text-slate-500">Devices</span></div>
          <div className="text-sm"><span className="font-semibold text-slate-900">{systemGroups.length}</span> <span className="text-slate-500">Systems</span></div>
        </div>

        {/* Document authority strip */}
        {(authority?.prepared_by || authority?.checked_by || authority?.approved_by) && (
          <div className="bg-white border-t border-slate-200 px-8 py-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Document Authority</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { role: 'Prepared By', name: authority.prepared_by, date: authority.prepared_date, sig: authority.prepared_signature_url },
                { role: 'Checked By',  name: authority.checked_by,  date: authority.checked_date,  sig: authority.checked_signature_url },
                { role: 'Approved By', name: authority.approved_by, date: authority.approved_date, sig: authority.approved_signature_url },
              ].filter(r => r.name).map(r => (
                <div key={r.role} className="border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{r.role}</p>
                  {r.sig && <img src={r.sig} alt={r.role} className="h-8 object-contain" />}
                  <p className="text-xs font-semibold text-slate-800">{r.name}</p>
                  {r.date && <p className="text-[10px] text-slate-400">{new Date(r.date).toLocaleDateString('en-GB')}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contractor footer */}
        {contractor && (contractor.company_name || contractor.telephone || contractor.email) && (
          <div className="bg-slate-900 text-slate-400 px-8 py-3 flex flex-wrap gap-4 text-xs">
            {contractor.company_name && <span className="font-semibold text-white">{contractor.company_name}</span>}
            {contractor.telephone && <span>{contractor.telephone}</span>}
            {contractor.email && <span>{contractor.email}</span>}
            {contractor.website && <span>{contractor.website}</span>}
            {contractor.nsi_number && <span>NSI: {contractor.nsi_number}</span>}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">Cover page pulls from Document Management — fill in <strong>Contractor Information</strong>, <strong>Document Authority</strong> and <strong>Project Information</strong> to complete it.</p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        <p className="text-sm font-semibold text-slate-800">{value || '—'}</p>
      </div>
    </div>
  );
}

function ScopeSection({ content, onChange, onSave, onRegenerate, saving, regenerating, isAiGenerated, activeSystems }: {
  content: string; onChange: (v: string) => void; onSave: () => void;
  onRegenerate: () => void; saving: boolean; regenerating: boolean; isAiGenerated: boolean; activeSystems: string[];
}) {
  const [preview, setPreview] = useState(false);

  const missingSystems = activeSystems.filter(sys => !content.includes(sys));

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Scope of Works</h3>
        {isAiGenerated && <span className="text-xs text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-full font-medium ml-1">AI Generated</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setPreview(p => !p)} disabled={regenerating}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors disabled:opacity-40">
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button onClick={onSave} disabled={saving || regenerating}
            className="text-xs font-medium px-3 py-1 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {missingSystems.length > 0 && !regenerating && (
        <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 mb-0.5">
              {missingSystems.length} system{missingSystems.length > 1 ? 's' : ''} not in scope
            </p>
            <p className="text-xs text-amber-700">
              <strong>{missingSystems.join(', ')}</strong> {missingSystems.length > 1 ? 'have' : 'has'} devices but {missingSystems.length > 1 ? 'are' : 'is'} not mentioned in this scope of works.
            </p>
          </div>
          <button
            onClick={onRegenerate}
            disabled={saving}
            className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            Regenerate scope
          </button>
        </div>
      )}

      {regenerating && (
        <div className="mb-4 flex items-center gap-3 bg-cyan-50 border border-cyan-200 rounded-xl px-4 py-3">
          <Loader2 className="w-4 h-4 text-cyan-600 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-cyan-800">Generating scope of works…</p>
            <p className="text-xs text-cyan-600">Claude is writing a scope based on your installed devices</p>
          </div>
        </div>
      )}

      {!content && !preview && missingSystems.length === 0 && !regenerating && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          No Scope of Works found. You can type it below, or use Create Project (upload your quote/proposal) to auto-generate it.
        </div>
      )}

      {preview ? (
        <div className="min-h-64 p-4 border border-slate-200 rounded-lg bg-slate-50 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: content ? renderMarkdown(content) : '<p class="text-slate-400 text-sm">Nothing to preview.</p>' }} />
      ) : (
        <textarea
          value={content}
          onChange={e => onChange(e.target.value)}
          disabled={regenerating}
          rows={20}
          placeholder="Enter Scope of Works here (supports Markdown formatting)..."
          className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none disabled:opacity-50 disabled:bg-slate-50"
        />
      )}
    </div>
  );
}

function scheduleGroupKey(row: { manufacturer: string | null; model_number: string | null; description: string | null }) {
  return [row.manufacturer ?? '', row.model_number ?? '', row.description ?? ''].join('|');
}

function groupedScheduleLocation(devices: DeviceWithDatasheet[]): string {
  const locs = [...new Set(devices.map(d => d.location?.trim()).filter(Boolean))] as string[];
  if (locs.length === 0) return '—';
  if (locs.length === 1) return locs[0];
  return locs.slice(0, 3).join(', ') + (locs.length > 3 ? ` +${locs.length - 3}` : '');
}

function groupedScheduleWarranty(devices: DeviceWithDatasheet[]): string {
  const years = devices.find(d => d.warrantyYears != null)?.warrantyYears ?? 1;
  return `${years}yr`;
}

function ScheduleSection({ systemGroups }: { systemGroups: { system: SystemType; devices: DeviceWithDatasheet[] }[] }) {
  return (
    <div className="space-y-4">
      {systemGroups.length === 0 ? (
        <EmptyState icon={ClipboardCheck} message="No devices in this project yet." />
      ) : (
        systemGroups.map(g => {
          const equipmentGroups = groupDevices(g.devices);
          return (
            <div key={g.system} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <SystemHeader system={g.system} count={g.devices.length} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    {['Description', 'Manufacturer', 'Model', 'Qty', 'Location', 'Warranty'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {equipmentGroups.map(row => (
                      <tr key={scheduleGroupKey(row)} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-600">{row.description || '—'}</td>
                        <td className="px-4 py-2.5 text-slate-700">{row.manufacturer || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{row.model_number || '—'}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-800">{row.quantity}</td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate">{groupedScheduleLocation(row.devices as DeviceWithDatasheet[])}</td>
                        <td className="px-4 py-2.5 text-slate-600">{groupedScheduleWarranty(row.devices as DeviceWithDatasheet[])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function MaintenanceSection({ systemGroups }: { systemGroups: { system: SystemType; devices: DeviceWithDatasheet[] }[] }) {
  const withMaint = systemGroups.map(g => ({ ...g, devices: g.devices.filter(d => d.maintenanceNotes) })).filter(g => g.devices.length > 0);
  if (withMaint.length === 0) {
    return <EmptyState icon={Wrench} message="No maintenance notes found. Add maintenance notes to products in the Product Database." />;
  }
  return (
    <div className="space-y-4">
      {withMaint.map(g => (
        <div key={g.system} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <SystemHeader system={g.system} count={g.devices.length} />
          <div className="divide-y divide-slate-100">
            {g.devices.map(d => (
              <div key={d.id} className="flex gap-4 px-5 py-3">
                <span className="font-mono text-xs font-bold text-slate-800 w-28 flex-shrink-0 pt-0.5">{d.device_name || d.model_number}</span>
                <span className="text-sm text-slate-600 flex-1">{d.maintenanceNotes}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Maintenance Plan Section ─────────────────────────────────────────────────

const MAINT_TEMPLATE: Record<string, string> = {
  'CCTV':
`## Annual Maintenance

- Inspect all camera housings, brackets, and mounting hardware for damage or corrosion
- Clean camera domes and lenses; check for condensation
- Verify recording is functioning on all channels; check storage health
- Review retention period settings and ensure compliance
- Test remote access and monitoring connections
- Review and update user accounts; remove former staff
- Check UPS battery health and backup power operation

## Quarterly Checks

- Spot-check live view and playback on all cameras
- Verify motion detection zones are correctly configured
- Check network connectivity and latency`,

  'Access Control':
`## Annual Maintenance

- Inspect all door controllers, readers, and locks for physical condition
- Test all door locks, strikes, and magnetic lock functions
- Verify all access levels and cardholder database are current
- Remove departed staff credentials; audit access logs
- Test all REX (request to exit) buttons and break-glass units
- Check battery backup on all controllers
- Review software version and apply firmware updates

## Quarterly Checks

- Test door override and manual release functions
- Review access log reports for anomalies
- Check reader readability and credential response time`,

  'Intruder':
`## Annual Maintenance (to BS EN 50131)

- Full walk-test of all detection zones
- Inspect and test all detectors (PIR, door contacts, glass-break)
- Test control panel tamper protection
- Test siren and strobe functions (internal & external)
- Test communication path to monitoring centre (if applicable)
- Check battery backup; replace batteries if below spec
- Review and update user codes; remove former users
- Confirm compliance with applicable grade requirements

## Quarterly Checks

- Part-test detection zones
- Check event log for any unexplained activations`,

  'Intercom':
`## Annual Maintenance

- Inspect all door stations, master stations, and sub-stations for physical condition
- Clean camera lenses and check video quality at all stations
- Test call, answer, and door release functions between all stations
- Test electric strike/maglocks activated by the intercom system
- Check power supply and backup battery operation
- Review and update directory listings; remove former occupants
- Apply firmware updates where available

## Quarterly Checks

- Test call and video functions on a sample of stations
- Verify door release functions at each entry point
- Check audio clarity and video image quality`,

  'Networking':
`## Annual Maintenance

- Inspect all switches, routers, patch panels, and cabinets for physical condition
- Audit all active network ports; remove unused patch leads
- Review and update network documentation and IP address register
- Check UPS battery health and backup power duration
- Review firmware versions on all managed switches and apply updates
- Test all PoE ports for correct power delivery to connected devices
- Review VLAN configuration and network segmentation

## Quarterly Checks

- Review switch port utilisation and error/discard counters
- Spot-check network performance and latency to key devices
- Check system logs for anomalies or unauthorised access attempts`,

  'ANPR':
`## Annual Maintenance

- Inspect all ANPR cameras, housings, illuminators, and mounting hardware
- Clean camera lenses; test IR illuminator operation day and night
- Verify plate capture accuracy against test plates at entry/exit points
- Review and update vehicle permit, allow, and block lists
- Check storage health and review retention period settings
- Verify software licensing is current and renew if required
- Test integration with access control, barriers, or third-party systems

## Quarterly Checks

- Spot-check capture accuracy under varying lighting conditions
- Review alert, exception, and missed-read logs
- Check integration functions with connected systems`,

  'Perimeter Detection':
`## Annual Maintenance (to BS EN 50131 / EN 62676 as applicable)

- Full walk-test of all perimeter detection zones
- Inspect fence-mounted sensors, buried cables, or active beam detectors
- Check all zone tamper protections
- Test alarm output and monitoring centre communication path
- Inspect and test PTZ camera auto-follow/alarm integration (if fitted)
- Check battery backup on all field devices; replace below-spec cells
- Review and update zone sensitivity settings for seasonal variation

## Quarterly Checks

- Part-test detection zones in each perimeter sector
- Check for environmental factors (vegetation, flooding) affecting detection
- Review false alarm log and adjust sensitivity as required`,
};

const DEFAULT_TEMPLATE = `## Annual Maintenance

- [Add annual maintenance tasks here]
- Inspect all equipment for physical damage
- Test all system functions to manufacturers specification
- Review configuration and update as required
- Check and replace backup batteries if required
- Review user database and remove leavers

## Quarterly Checks

- [Add routine checks here]`;

type ScopeDevice = { device_type?: string | null; manufacturer?: string | null; location?: string | null };

async function callGenerateScope(
  project: any,
  sourceDocs: any[],
  deviceList: any[]
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('generate-scope', {
    body: {
      project: {
        project_name: project?.project_name ?? 'Security Project',
        client_name: project?.client_name ?? null,
        site_name: project?.site_name ?? null,
        project_manager: project?.project_manager ?? null,
      },
      sources: sourceDocs.map(d => ({
        system_type: d.system_type,
        file_name: d.file_name,
        file_url: d.file_url,
        media_type: d.media_type,
      })),
      devices: deviceList.map(d => ({
        system_type: d.system_type,
        device_type: d.device_type,
        manufacturer: d.manufacturer,
        model_number: d.model_number,
        location: d.location,
        notes: d.notes,
      })),
    },
  });
  return (!error && data?.scope?.trim()) ? data.scope : null;
}

function buildAutoScope(
  sysGroups: { system: string; devices: ScopeDevice[] }[],
  siteName?: string | null,
  clientName?: string | null
): string {
  const site = siteName || 'the above premises';
  const client = clientName ? ` for ${clientName}` : '';
  const plural = sysGroups.length > 1 ? 's' : '';

  let doc = `## Overview\n\nThis Operations & Maintenance manual covers the security system${plural} installed at ${site}${client}.\n\n`;

  sysGroups.forEach(g => {
    const count = g.devices.length;
    const types = [...new Set(g.devices.map(d => d.device_type).filter(Boolean) as string[])];
    const mfrs = [...new Set(g.devices.map(d => d.manufacturer).filter(Boolean) as string[])];
    const locs = [...new Set(g.devices.map(d => d.location).filter(Boolean) as string[])];

    doc += `## ${g.system}\n\n`;
    let line = `${count} device${count !== 1 ? 's' : ''} installed`;
    if (types.length > 0) line += ` comprising ${types.slice(0, 4).join(', ')}`;
    if (mfrs.length > 0) line += ` (${mfrs.slice(0, 3).join(' / ')})`;
    if (locs.length > 0) {
      const shown = locs.slice(0, 4);
      line += `, covering ${shown.join(', ')}`;
      if (locs.length > 4) line += ` and ${locs.length - 4} other area${locs.length - 4 !== 1 ? 's' : ''}`;
    }
    doc += line + '.\n\n';
  });

  const systems = sysGroups.map(g => g.system);
  doc += `## Deliverables\n\nThis manual provides:\n\n`;
  doc += `- Device schedule for all installed equipment\n`;
  doc += `- Maintenance requirements for each system\n`;
  doc += `- Commissioning test records and verification\n`;
  doc += `- Handover documentation and certification\n`;
  doc += `- Technical datasheets for installed equipment\n`;
  doc += `- As fitted installation drawings\n`;

  doc += `\n## Standards & Compliance\n\n`;
  if (systems.includes('CCTV'))              doc += `- CCTV: BS EN 50132, BS 8418 (where monitored)\n`;
  if (systems.includes('Intruder'))          doc += `- Intruder Alarm: BS EN 50131, BS 8243\n`;
  if (systems.includes('Access Control'))    doc += `- Access Control: BS EN 50133, PD 6662\n`;
  if (systems.includes('Intercom'))          doc += `- Intercom: BS EN 50133 (door entry provisions)\n`;
  if (systems.includes('Networking'))        doc += `- Networking: BS EN 50173, BS 6701\n`;
  if (systems.includes('Perimeter Detection')) doc += `- Perimeter Detection: BS EN 50131 Grade 3 as applicable\n`;

  doc += `\n## Warranty & Support\n\nAll equipment is covered by manufacturer warranty as detailed in the datasheets in this manual. For service and support contact the installing contractor using the details on the cover page.\n`;

  return doc;
}

function MaintenancePlanSection({ systemGroups, content, onChange, onSave, saving }: {
  systemGroups: { system: SystemType; devices: DeviceWithDatasheet[] }[];
  content: Record<string, string>;
  onChange: (system: string, value: string) => void;
  onSave: (system: string) => void;
  saving: string | null;
}) {
  const [activeSystem, setActiveSystem] = useState<string>(systemGroups[0]?.system ?? '');
  const [preview, setPreview] = useState(false);

  if (systemGroups.length === 0) {
    return <EmptyState icon={CalendarCheck} message="No systems in this project yet. Add devices to systems first." />;
  }

  const currentContent = content[activeSystem] ?? '';
  const template = MAINT_TEMPLATE[activeSystem] ?? DEFAULT_TEMPLATE;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <CalendarCheck className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Maintenance Plan</h3>
        <span className="text-xs text-slate-400 ml-1">· one schedule per system</span>
      </div>

      {/* System tabs */}
      <div className="flex gap-1 px-6 pt-4 flex-wrap">
        {systemGroups.map(g => {
          const hasContent = !!content[g.system]?.trim();
          return (
            <button key={g.system} onClick={() => { setActiveSystem(g.system); setPreview(false); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeSystem === g.system ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {g.system}
              {hasContent && <span className={`w-1.5 h-1.5 rounded-full ${activeSystem === g.system ? 'bg-cyan-300' : 'bg-emerald-400'}`} />}
            </button>
          );
        })}
      </div>

      {/* Editor */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-500">{activeSystem} — edit the maintenance schedule for this system type</p>
          <div className="flex items-center gap-2">
            {!currentContent && (
              <button onClick={() => onChange(activeSystem, template)}
                className="text-xs text-amber-600 hover:text-amber-700 px-2 py-1 rounded border border-amber-200 hover:border-amber-300 bg-amber-50 transition-colors">
                Use template
              </button>
            )}
            <button onClick={() => setPreview(p => !p)}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded border border-slate-200 hover:border-slate-300 transition-colors">
              {preview ? 'Edit' : 'Preview'}
            </button>
            <button onClick={() => onSave(activeSystem)} disabled={saving === activeSystem}
              className="text-xs font-medium px-3 py-1 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50">
              {saving === activeSystem ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {preview ? (
          <div className="min-h-48 p-4 border border-slate-200 rounded-lg bg-slate-50"
            dangerouslySetInnerHTML={{ __html: currentContent ? renderMarkdown(currentContent) : '<p class="text-slate-400 text-sm">Nothing to preview.</p>' }} />
        ) : (
          <textarea
            key={activeSystem}
            value={currentContent}
            onChange={e => onChange(activeSystem, e.target.value)}
            rows={16}
            placeholder={`Enter ${activeSystem} maintenance schedule (supports Markdown formatting)…`}
            className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
          />
        )}
      </div>
    </div>
  );
}

// ─── Handover Pack Section (screen) ──────────────────────────────────────────

function HandoverPackSection({ uploads, onRemove, handoverDocs, scHandoverDocs }: {
  uploads: OmUpload[];
  onRemove: (u: OmUpload) => void;
  handoverDocs: HandoverDocument[];
  scHandoverDocs: { document_type: string; title: string; status: string; file_url: string | null; file_name: string | null; sc_inspection_id: string | null; sc_result: string | null }[];
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (uploads.length === 0 && scHandoverDocs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">Handover Documents</h3>
          <p className="text-sm text-slate-500 mt-1">
            No handover documents uploaded yet. Go to the{' '}
            <strong>Handover</strong> section to upload signed PDFs or create inspections via SafetyCulture.
          </p>
        </div>
        {handoverDocs.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              <p className="text-xs text-amber-700 font-medium">Database records found (no PDFs uploaded):</p>
            </div>
            <HandoverSummary docs={handoverDocs} />
          </div>
        )}
      </div>
    );
  }

  // Group by section for display order, RAMS can have multiple
  const grouped: { section: string; label: string; items: OmUpload[] }[] = [];
  const seen = new Set<string>();
  for (const u of uploads) {
    if (!seen.has(u.section)) {
      seen.add(u.section);
      grouped.push({ section: u.section, label: HANDOVER_SECTION_LABELS[u.section] ?? u.section, items: uploads.filter(x => x.section === u.section) });
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <Award className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Handover Documents</h3>
        <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">{uploads.length + scHandoverDocs.length} document{(uploads.length + scHandoverDocs.length) > 1 ? 's' : ''}</span>
      </div>

      <div className="divide-y divide-slate-100">
        {grouped.map(({ section, label, items }) =>
          items.map((upload, idx) => {
            const docLabel = items.length > 1 ? `${label} (${idx + 1})` : label;
            const isExpanded = expandedId === upload.id;
            return (
              <div key={upload.id}>
                {/* Header row */}
                <div className={`flex items-center gap-3 px-6 py-4 transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                  <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{docLabel}</p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{upload.file_name}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a href={upload.file_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />Open
                    </a>
                    <button onClick={() => setExpandedId(isExpanded ? null : upload.id)}
                      className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${isExpanded ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                      {isExpanded ? <X className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {isExpanded ? 'Close' : 'View PDF'}
                    </button>
                    <button onClick={() => onRemove(upload)}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Embedded PDF viewer */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-100 px-6 py-4">
                    <iframe
                      src={upload.file_url}
                      title={docLabel}
                      className="w-full rounded-lg shadow-sm border border-slate-200"
                      style={{ height: '1050px' }}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* SC-imported documents */}
      {scHandoverDocs.length > 0 && (
        <div className="border-t border-slate-200 px-6 py-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">SafetyCulture Documents</p>
          {scHandoverDocs.map(doc => (
            <div key={doc.document_type} className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-900">{doc.title}</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  {doc.status === 'imported' ? 'Imported from SafetyCulture' : doc.status === 'uploaded' ? 'PDF uploaded' : 'Completed'}
                  {doc.sc_result && <span className="ml-2 font-medium">{doc.sc_result === 'pass' ? 'PASS' : 'FAIL'}</span>}
                </p>
              </div>
              {doc.file_url && (
                <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline flex items-center gap-1 flex-shrink-0">
                  <ExternalLink className="w-3 h-3" />View PDF
                </a>
              )}
              {doc.sc_inspection_id && (
                <a href={scInspectionUrl(doc.sc_inspection_id)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline flex items-center gap-1 flex-shrink-0">
                  <ExternalLink className="w-3 h-3" />SC
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PrintHandoverDocs({ uploads, pageImages }: {
  uploads: OmUpload[];
  pageImages: Record<number, { pages: string[]; loading: boolean; failed: boolean }>;
}) {
  const grouped: { label: string; items: OmUpload[] }[] = [];
  const seen = new Set<string>();
  for (const u of uploads) {
    if (!seen.has(u.section)) {
      seen.add(u.section);
      grouped.push({ label: HANDOVER_SECTION_LABELS[u.section] ?? u.section, items: uploads.filter(x => x.section === u.section) });
    }
  }
  return (
    <div className="space-y-8">
      {grouped.map(({ label, items }) =>
        items.map((upload, idx) => {
          const docLabel = items.length > 1 ? `${label} (${idx + 1})` : label;
          const rendered = pageImages[upload.id];
          return (
            <div key={upload.id}>
              <h3 className="text-base font-bold text-slate-800 mb-4 pb-2 border-b border-slate-300">{docLabel}</h3>
              {rendered?.failed ? (
                <div className="border border-slate-200 rounded p-6 text-center text-slate-500 text-sm">
                  <p className="font-medium mb-1">Could not render PDF for print</p>
                  <p className="text-xs text-slate-400">{upload.file_name}</p>
                </div>
              ) : rendered?.pages.length ? (
                <div className="space-y-2">
                  {rendered.pages.map((src, pageIdx) => (
                    <img
                      key={pageIdx}
                      src={src}
                      alt={`${docLabel} — page ${pageIdx + 1}`}
                      className="w-full"
                      style={{ pageBreakInside: 'avoid' }}
                    />
                  ))}
                </div>
              ) : (
                <div className="border border-slate-200 rounded p-6 text-center text-slate-500 text-sm">
                  <p>PDF not yet rendered — open the O&M Builder to prepare for print</p>
                  <p className="text-xs mt-1 text-slate-400">{upload.file_name}</p>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function UploadSection({ sectionId, title, description, upload, uploading, onUpload, onRemove, fallbackContent, fallbackLabel }: {
  onUpload: () => void; onRemove: (u: OmUpload) => void;
  fallbackContent: React.ReactNode; fallbackLabel: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-semibold text-slate-800">{title}</h3>
      </div>
      <p className="text-sm text-slate-500 mb-5">{description}</p>

      {/* Upload area */}
      {upload ? (
        <div className="flex items-center gap-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl mb-5">
          <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-900">{upload.file_name}</p>
            <p className="text-xs text-emerald-700 mt-0.5">PDF uploaded and will be included in the pack</p>
          </div>
          <a href={upload.file_url} target="_blank" rel="noopener noreferrer"
            className="text-xs font-medium text-emerald-700 hover:underline flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />View
          </a>
          <button onClick={() => onRemove(upload)} className="p-1.5 text-emerald-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div onClick={onUpload}
          className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-cyan-400 hover:bg-cyan-50 transition-colors mb-5 group">
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-cyan-600">
              <div className="w-5 h-5 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Uploading…</span>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-slate-300 group-hover:text-cyan-400 mx-auto mb-2 transition-colors" />
              <p className="text-sm font-medium text-slate-500 group-hover:text-cyan-600">Click to upload PDF</p>
              <p className="text-xs text-slate-400 mt-1">PDF files only · Max 50 MB</p>
            </>
          )}
        </div>
      )}

      {/* Fallback: show DB data if no PDF uploaded */}
      {!upload && fallbackContent && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs text-amber-700 font-medium">No PDF uploaded — showing {fallbackLabel}:</p>
          </div>
          {fallbackContent}
        </div>
      )}
      {!upload && !fallbackContent && (
        <div className="text-center py-4 text-slate-400 text-sm">No data found in database either. Upload a PDF or complete this section in the platform first.</div>
      )}
    </div>
  );
}

// ─── As Fitted Drawings — screen view ────────────────────────────────────────

function AsFittedDrawingsSection({ drawings, pageImages }: {
  drawings: AsBuiltDrawing[];
  pageImages: Record<number, { pages: string[]; loading: boolean; failed: boolean }>;
}) {
  const [previewId, setPreviewId] = useState<number | null>(null);
  if (drawings.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <Layers className="w-10 h-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500">No as-fitted drawings uploaded</p>
        <p className="text-xs text-slate-400 mt-1">
          Upload drawings in the <strong>As Fitted Drawings</strong> section — they will appear here full-size in the O&M pack.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
        <Layers className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">As Fitted Drawings</h3>
        <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
          {drawings.length} drawing{drawings.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {drawings.map(d => {
          const rendered = pageImages[d.id];
          const isOpen = previewId === d.id;
          return (
            <div key={d.id}>
              <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{d.title || d.file_name}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                    {d.drawing_number && <span>#{d.drawing_number}</span>}
                    {d.revision && <span>{d.revision}</span>}
                    <span className="truncate">{d.file_name}</span>
                    {rendered?.loading && <span className="text-amber-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Preparing…</span>}
                    {!rendered?.loading && rendered?.pages.length ? <span className="text-emerald-600">{rendered.pages.length} page{rendered.pages.length !== 1 ? 's' : ''} ready</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-2 py-1 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" />Open
                  </a>
                  <button onClick={() => setPreviewId(isOpen ? null : d.id)}
                    className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${isOpen ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                    {isOpen ? <X className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {isOpen ? 'Close' : 'Preview'}
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-100 px-6 py-4">
                  <iframe src={d.file_url} title={d.title || d.file_name}
                    className="w-full rounded-lg shadow border border-slate-200" style={{ height: '1050px' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── As Fitted Drawings — print view ─────────────────────────────────────────

function PrintAsFittedDrawings({ drawings, pageImages }: {
  drawings: AsBuiltDrawing[];
  pageImages: Record<number, { pages: string[]; loading: boolean; failed: boolean }>;
}) {
  return (
    <>
      {drawings.map((d, idx) => {
        const rendered = pageImages[d.id];
        return (
          <div key={d.id}>
            <PrintSection
              title={d.title || d.file_name}
              subtitle={[d.drawing_number && `#${d.drawing_number}`, d.revision].filter(Boolean).join(' · ') || undefined}
              anchorId={idx === 0 ? 'print-section-as_fitted' : undefined}
            >
              {rendered?.failed ? (
                <div className="border border-slate-200 rounded p-6 text-center text-slate-500 text-sm">
                  <p className="font-medium mb-1">Could not render PDF</p>
                  <p className="text-xs text-slate-400">{d.file_name}</p>
                </div>
              ) : rendered?.pages.length ? (
                <div className="space-y-1">
                  {rendered.pages.map((src, i) => (
                    <img key={i} src={src} alt={`${d.title} page ${i + 1}`} className="w-full" style={{ pageBreakInside: 'avoid' }} />
                  ))}
                </div>
              ) : (
                <div className="border border-slate-200 rounded p-6 text-center text-slate-500 text-sm">
                  <p>Drawing not yet rendered — open the O&M Builder to prepare for print</p>
                  <p className="text-xs mt-1 text-slate-400">{d.file_name}</p>
                </div>
              )}
            </PrintSection>
            <div className="page-break" />
          </div>
        );
      })}
    </>
  );
}

function DatasheetsSection({ systemGroups }: { systemGroups: { system: SystemType; devices: DeviceWithDatasheet[] }[] }) {
  const withDS = systemGroups.map(g => {
    const seen = new Set<string>();
    const unique = g.devices.filter(d => {
      if (!d.datasheet) return false;
      const key = `${d.manufacturer?.trim().toLowerCase()}|${d.model_number?.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...g, devices: unique };
  }).filter(g => g.devices.length > 0);

  if (withDS.length === 0) {
    return <EmptyState icon={ExternalLink} message="No datasheets linked to devices. Match products in the Product Database and upload datasheets." />;
  }
  return (
    <div className="space-y-4">
      {withDS.map(g => (
        <div key={g.system} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <SystemHeader system={g.system} count={g.devices.length} />
          <div className="divide-y divide-slate-100">
            {g.devices.map(d => (
              <div key={d.id} className="flex items-center gap-4 px-5 py-3">
                <span className="text-sm text-slate-700 flex-1">{[d.manufacturer, d.model_number].filter(Boolean).join(' ')}</span>
                {d.datasheet?.datasheet_url && (
                  <a href={d.datasheet.datasheet_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                    <ExternalLink className="w-3 h-3" />Datasheet
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Comm / Handover summaries (used in both screen and print) ────────────────

function CommSummary({ records }: { records: CommissioningRecord[] }) {
  const systems = [...new Set(records.map(r => r.system_type))];
  return (
    <div className="space-y-3">
      {systems.map(sys => {
        const recs = records.filter(r => r.system_type === sys);
        const passed = recs.filter(r => r.pass === true).length;
        const failed = recs.filter(r => r.pass === false).length;
        return (
          <div key={sys} className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-2 flex items-center justify-between border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-800">{sys}</span>
              <div className="flex gap-3 text-xs">
                <span className="text-emerald-600 font-medium">{passed} pass</span>
                {failed > 0 && <span className="text-red-600 font-medium">{failed} fail</span>}
                <span className="text-slate-400">{recs.length - passed - failed} pending</span>
              </div>
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {recs.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-700 w-8">
                      {r.pass === true ? <span className="text-emerald-600">✓</span> : r.pass === false ? <span className="text-red-500">✗</span> : <span className="text-slate-300">○</span>}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{r.test_description}</td>
                    <td className="px-2 py-2 text-slate-500 max-w-[160px] truncate">{r.actual_result || '—'}</td>
                    <td className="px-2 py-2 text-slate-400">{r.engineer_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function HandoverSummary({ docs }: { docs: HandoverDocument[] }) {
  return (
    <div className="space-y-2">
      {docs.map(d => (
        <div key={d.id} className="flex items-center justify-between px-4 py-3 border border-slate-200 rounded-lg">
          <div>
            <p className="text-sm font-medium text-slate-800">{d.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{d.document_type} · {d.status}</p>
          </div>
          {d.signed_by && (
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
              Signed: {d.signed_by}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SystemHeader({ system, count }: { system: SystemType; count: number }) {
  const Icon = SYS_ICONS[system] ?? BookOpen;
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 bg-slate-50 border-b border-slate-100">
      <Icon className="w-4 h-4 text-slate-500" />
      <span className="text-sm font-semibold text-slate-800">{system}</span>
      <span className="text-xs text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full">{count}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm text-center py-16 px-8">
      <Icon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}

// ─── Print components ─────────────────────────────────────────────────────────

// ─── Print Table of Contents ──────────────────────────────────────────────────

interface TocEntry {
  label: string;
  anchorId: string;
  number: number;
}

function PrintTableOfContents({
  project,
  hasScope, hasSchedule, hasTechDocs, hasMaintPlan,
  hasCommissioning, hasHandover, hasAsFitted, hasDatasheets, hasUserManuals,
}: {
  project: any;
  hasScope: boolean; hasSchedule: boolean; hasTechDocs: boolean; hasMaintPlan: boolean;
  hasCommissioning: boolean; hasHandover: boolean; hasAsFitted: boolean;
  hasDatasheets: boolean; hasUserManuals: boolean;
}) {
  const entries: TocEntry[] = [];
  let num = 1;

  if (hasScope) entries.push({ label: 'Scope of Works', anchorId: 'print-section-scope', number: num++ });
  if (hasSchedule) entries.push({ label: 'Device Schedule', anchorId: 'print-section-schedule', number: num++ });
  if (hasTechDocs) entries.push({ label: 'Technical Documentation', anchorId: 'print-section-technical_docs', number: num++ });
  if (hasMaintPlan) entries.push({ label: 'Maintenance Plan', anchorId: 'print-section-maintenance_plan', number: num++ });
  if (hasCommissioning) entries.push({ label: 'Commissioning Pack', anchorId: 'print-section-commissioning', number: num++ });
  if (hasHandover) entries.push({ label: 'Handover Documents', anchorId: 'print-section-handover', number: num++ });
  if (hasAsFitted) entries.push({ label: 'As Fitted Drawings', anchorId: 'print-section-as_fitted', number: num++ });
  if (hasDatasheets) entries.push({ label: 'Datasheet Index', anchorId: 'print-section-datasheets', number: num++ });
  if (hasUserManuals) entries.push({ label: 'User Manuals', anchorId: 'print-section-user_manuals', number: num++ });

  return (
    <div id="print-section-toc" style={{ padding: '3.5rem 3.5rem 3rem', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ flex: '0 0 auto' }}>
        <p style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.14em', color: '#94a3b8', textTransform: 'uppercase', margin: '0 0 0.5rem' }}>
          {[project?.client_name, project?.site_name || project?.project_name].filter(Boolean).join(' — ') || 'O&M Pack'}
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '3px solid #0f172a', paddingBottom: '1rem', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
            Table of Contents
          </h1>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400 }}>
            {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: '0 0 2.5rem', textAlign: 'right' }}>Operations &amp; Maintenance Manual</p>
      </div>

      {/* Entries */}
      <div style={{ flex: '1 1 auto' }}>
        {entries.map((entry, i) => (
          <div
            key={entry.anchorId}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0.8rem 0',
              borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none',
            }}
          >
            {/* Number badge */}
            <span style={{
              width: '1.75rem', height: '1.75rem', borderRadius: '50%',
              background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', fontWeight: 800, color: '#64748b', flexShrink: 0, marginRight: '0.75rem',
            }}>
              {entry.number}
            </span>
            {/* Label — clickable in PDF */}
            <a
              href={`#${entry.anchorId}`}
              style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b', textDecoration: 'none', flex: '0 0 auto' }}
            >
              {entry.label}
            </a>
            {/* Dotted leader */}
            <span style={{ flex: 1, borderBottom: '1.5px dotted #cbd5e1', margin: '0 0.75rem 0.2rem' }} />
            {/* Page number — populated by PDF generator pass 2, or CSS target-counter for print */}
            <a
              href={`#${entry.anchorId}`}
              className="toc-page-link"
              style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a', textDecoration: 'none', minWidth: '2rem', textAlign: 'right', flexShrink: 0 }}
            >
            </a>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ flex: '0 0 auto', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem', marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0 }}>
          This document has been automatically generated. All information should be verified against site records.
        </p>
        <p style={{ fontSize: '0.65rem', color: '#cbd5e1', margin: 0 }}>SecureOps Platform</p>
      </div>
    </div>
  );
}

function PrintCoverPage({ project, devices, systemGroups, contractor, authority }: {
  project: any; devices: any[]; systemGroups: any[]; contractor: any; authority: any;
}) {
  return (
    <div className="om-cover-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Dark header band */}
      <div style={{ background: '#0f172a', padding: '3rem 3.5rem 2.5rem', color: 'white', flex: '0 0 auto' }}>
        <img
          src="https://www.pacific-uk.co.uk/wp-content/uploads/2018/07/pacific-logo.png"
          alt="Pacific Fire and Security Systems"
          style={{ height: '2.5rem', objectFit: 'contain', marginBottom: '1.5rem', filter: 'brightness(0) invert(1)' }}
        />
        {contractor?.company_name && (
          <p style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#22d3ee', marginBottom: '0.35rem' }}>
            {contractor.company_name}
          </p>
        )}
        <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#64748b', marginBottom: '1rem' }}>
          Operations &amp; Maintenance Manual
        </p>
        <h1 style={{ fontSize: '2.25rem', fontWeight: 800, lineHeight: 1.2, color: 'white', margin: '0 0 0.75rem' }}>
          {project?.project_name || 'Untitled Project'}
        </h1>
        {project?.site_name && (
          <p style={{ fontSize: '1rem', color: '#94a3b8', margin: '0 0 0.25rem' }}>{project.site_name}</p>
        )}
        {project?.site_address && (
          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>{project.site_address}</p>
        )}
      </div>

      {/* Project info grid */}
      <div style={{ background: 'white', padding: '2rem 3.5rem', flex: '1 1 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem 3rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1.75rem', marginBottom: '1.75rem' }}>
          {[
            ['Client', project?.client_name],
            ['Project Manager', project?.project_manager],
            project?.engineer && ['Engineer', project.engineer],
            ['Reference', project?.project_number || project?.quote_number],
            project?.main_contractor && ['Main Contractor', project.main_contractor],
            ['Document Date', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })],
            project?.completion_date && ['Completion Date', new Date(project.completion_date).toLocaleDateString('en-GB')],
          ].filter(Boolean).map(([lbl, value]: any) => (
            <div key={String(lbl)}>
              <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.2rem' }}>{lbl}</p>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b', margin: 0 }}>{value || '—'}</p>
            </div>
          ))}
        </div>

        {/* Systems installed */}
        <div style={{ marginBottom: '1.75rem' }}>
          <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.75rem' }}>
            Systems Installed
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {systemGroups.map((g: any) => (
              <span key={g.system} style={{
                background: '#f1f5f9', border: '1px solid #e2e8f0',
                borderRadius: '0.375rem', padding: '0.25rem 0.75rem',
                fontSize: '0.75rem', fontWeight: 600, color: '#334155',
              }}>
                {g.system}
              </span>
            ))}
          </div>
        </div>

        {/* Document authority */}
        {(authority?.prepared_by || authority?.checked_by || authority?.approved_by) && (
          <div>
            <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.75rem' }}>
              Document Authority
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              {[
                { role: 'Prepared By', name: authority.prepared_by, date: authority.prepared_date, sig: authority.prepared_signature_url },
                { role: 'Checked By',  name: authority.checked_by,  date: authority.checked_date,  sig: authority.checked_signature_url },
                { role: 'Approved By', name: authority.approved_by, date: authority.approved_date, sig: authority.approved_signature_url },
              ].filter(r => r.name).map(r => (
                <div key={r.role} style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <p style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.5rem' }}>{r.role}</p>
                  {r.sig && <img src={r.sig} alt={r.role} style={{ height: '2rem', objectFit: 'contain', marginBottom: '0.5rem', display: 'block' }} />}
                  <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.15rem' }}>{r.name}</p>
                  {r.date && <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0 }}>{new Date(r.date).toLocaleDateString('en-GB')}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dark contractor footer */}
      {contractor && (contractor.company_name || contractor.telephone || contractor.email) && (
        <div style={{ background: '#0f172a', padding: '0.9rem 3.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center', flex: '0 0 auto' }}>
          {contractor.company_name && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'white' }}>{contractor.company_name}</span>}
          {contractor.address_line1 && <span style={{ fontSize: '0.65rem', color: '#64748b' }}>{[contractor.address_line1, contractor.city, contractor.postcode].filter(Boolean).join(', ')}</span>}
          {contractor.telephone && <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Tel: {contractor.telephone}</span>}
          {contractor.email && <span style={{ fontSize: '0.65rem', color: '#64748b' }}>{contractor.email}</span>}
          {contractor.nsi_number && <span style={{ fontSize: '0.65rem', color: '#64748b' }}>NSI: {contractor.nsi_number}</span>}
          {contractor.ssaib_number && <span style={{ fontSize: '0.65rem', color: '#64748b' }}>SSAIB: {contractor.ssaib_number}</span>}
          {contractor.company_reg_number && <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Reg: {contractor.company_reg_number}</span>}
        </div>
      )}
    </div>
  );
}

function PrintTechnicalDocsSystem({ sys, state }: {
  sys: string;
  state: { rows: { id: number; row_index: number; data: Record<string, string> }[]; colConfig: { key: string; display_name: string; visible: boolean; order: number }[] };
}) {
  const visibleCols = state.colConfig.filter(c => c.visible).sort((a, b) => a.order - b.order);
  if (visibleCols.length === 0) return <p style={{ color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>No columns configured.</p>;
  return (
    <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', border: '1px solid #e2e8f0' }}>
      <thead>
        <tr style={{ background: '#f8fafc' }}>
          {visibleCols.map(col => (
            <th key={col.key} style={{ textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '2px solid #e2e8f0', borderRight: '1px solid #f1f5f9' }}>
              {col.display_name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {state.rows.map((row, i) => (
          <tr key={row.id} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
            {visibleCols.map(col => (
              <td key={col.key} style={{ padding: '0.45rem 0.6rem', fontFamily: 'monospace', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>
                {row.data[col.key] || '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrintTechnicalDocs({ techDocState }: {
  techDocState: Partial<Record<string, { rows: { id: number; row_index: number; data: Record<string, string> }[]; colConfig: { key: string; display_name: string; visible: boolean; order: number }[] }>>;
}) {
  const systemsWithData = SYSTEM_TYPES.filter(s => (techDocState[s]?.rows.length ?? 0) > 0);
  return (
    <div>
      {systemsWithData.map(sys => {
        const state = techDocState[sys]!;
        const visibleCols = state.colConfig.filter(c => c.visible).sort((a, b) => a.order - b.order);
        if (visibleCols.length === 0) return null;
        return (
          <div key={sys} style={{ marginBottom: '2rem' }}>
            <div style={{ background: '#0f172a', padding: '0.5rem 0.75rem', borderRadius: '0.375rem 0.375rem 0 0' }}>
              <h3 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'white', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                {sys}
              </h3>
            </div>
            <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', border: '1px solid #e2e8f0' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {visibleCols.map(col => (
                    <th key={col.key} style={{ textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid #e2e8f0', borderRight: '1px solid #f1f5f9' }}>
                      {col.display_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row, i) => (
                  <tr key={row.id} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                    {visibleCols.map(col => (
                      <td key={col.key} style={{ padding: '0.45rem 0.6rem', fontFamily: 'monospace', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>
                        {row.data[col.key] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function PrintTechnicalDocsLegacy({ devices }: { devices: DeviceWithDatasheet[] }) {
  const fields: { key: keyof DeviceWithDatasheet; label: string }[] = [
    { key: 'ip_address',        label: 'IP Address' },
    { key: 'mac_address',       label: 'MAC Address' },
    { key: 'firmware_version',  label: 'Firmware' },
    { key: 'username_hint',     label: 'Username' },
    { key: 'password_hint',     label: 'Password' },
    { key: 'controller_address',label: 'Controller' },
    { key: 'vlan',              label: 'VLAN' },
    { key: 'network_zone',      label: 'Network Zone' },
  ];
  const usedFields = fields.filter(f => devices.some(d => d[f.key]));
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr>
          <th className="text-left py-2 pr-4 border-b border-slate-300 font-semibold text-slate-800">Device</th>
          {usedFields.map(f => (
            <th key={f.key} className="text-left py-2 pr-4 border-b border-slate-300 font-semibold text-slate-800">{f.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {devices.map(d => (
          <tr key={d.id} className="border-b border-slate-100">
            <td className="py-2 pr-4 font-medium text-slate-900">{d.device_name || '-'}</td>
            {usedFields.map(f => (
              <td key={f.key} className="py-2 pr-4 font-mono text-xs text-slate-700">{String(d[f.key] ?? '') || '-'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrintSection({ title, subtitle, anchorId, forcePageBreak, children }: { title: string; subtitle?: string; anchorId?: string; forcePageBreak?: boolean; children: React.ReactNode }) {
  const breakBefore = (anchorId || forcePageBreak) ? 'always' : 'auto';
  return (
    <div className="om-section" id={anchorId} style={{ padding: '2.5rem 3rem 2rem', fontFamily: 'system-ui, -apple-system, sans-serif', pageBreakBefore: breakBefore, breakBefore }}>
      {/* Section header bar */}
      <div style={{ borderBottom: '3px solid #0f172a', marginBottom: '1.75rem', paddingBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.35rem 0 0' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function PrintDeviceTable({ system, devices }: { system: SystemType; devices: DeviceWithDatasheet[] }) {
  const equipmentGroups = groupDevices(devices);
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ background: '#0f172a', padding: '0.5rem 0.75rem', borderRadius: '0.375rem 0.375rem 0 0', marginBottom: 0 }}>
        <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'white', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
          {system} <span style={{ color: '#64748b', fontWeight: 400 }}>— {devices.length} device{devices.length !== 1 ? 's' : ''}</span>
        </h3>
      </div>
      <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', border: '1px solid #e2e8f0' }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {['Description', 'Manufacturer', 'Model', 'Qty', 'Location', 'Warranty'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid #e2e8f0', borderRight: '1px solid #f1f5f9' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {equipmentGroups.map((row, i) => (
            <tr key={scheduleGroupKey(row)} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc', pageBreakInside: 'avoid' }}>
              <td style={{ padding: '0.45rem 0.6rem', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{row.description || '—'}</td>
              <td style={{ padding: '0.45rem 0.6rem', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{row.manufacturer || '—'}</td>
              <td style={{ padding: '0.45rem 0.6rem', fontFamily: 'monospace', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{row.model_number || '—'}</td>
              <td style={{ padding: '0.45rem 0.6rem', fontWeight: 700, color: '#0f172a', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{row.quantity}</td>
              <td style={{ padding: '0.45rem 0.6rem', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{groupedScheduleLocation(row.devices as DeviceWithDatasheet[])}</td>
              <td style={{ padding: '0.45rem 0.6rem', color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{groupedScheduleWarranty(row.devices as DeviceWithDatasheet[])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrintMaintenanceTable({ groups }: { groups: { system: SystemType; devices: DeviceWithDatasheet[] }[] }) {
  const rows = groups.flatMap(g => g.devices.filter(d => d.maintenanceNotes).map(d => ({ system: g.system, d })));
  if (rows.length === 0) {
    return (
      <p style={{ color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>No maintenance notes recorded for any device.</p>
    );
  }
  return (
    <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', border: '1px solid #e2e8f0' }}>
      <thead>
        <tr style={{ background: '#f8fafc' }}>
          {['System', 'Device', 'Manufacturer / Model', 'Maintenance Notes'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.65rem', fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '2px solid #e2e8f0', borderRight: '1px solid #f1f5f9' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ system, d }, i) => (
          <tr key={d.id} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
            <td style={{ padding: '0.45rem 0.65rem', color: '#475569', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', whiteSpace: 'nowrap' as const }}>{system}</td>
            <td style={{ padding: '0.45rem 0.65rem', fontWeight: 600, color: '#0f172a', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', fontFamily: 'monospace', whiteSpace: 'nowrap' as const }}>{d.device_name || '—'}</td>
            <td style={{ padding: '0.45rem 0.65rem', color: '#475569', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', whiteSpace: 'nowrap' as const }}>{[d.manufacturer, d.model_number].filter(Boolean).join(' ') || '—'}</td>
            <td style={{ padding: '0.45rem 0.65rem', color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{d.maintenanceNotes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrintAttachment({ upload }: { upload: OmUpload }) {
  return (
    <div style={{ border: '2px dashed #cbd5e1', borderRadius: '0.5rem', padding: '2rem', textAlign: 'center' as const }}>
      <p style={{ fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>Document Attached</p>
      <p style={{ fontSize: '0.85rem', color: '#64748b' }}>{upload.file_name}</p>
      <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem', wordBreak: 'break-all' as const }}>Print / attach this PDF separately: {upload.file_url}</p>
    </div>
  );
}

function PrintDatasheets({ groups, pageImages }: {
  groups: { system: SystemType; devices: DeviceWithDatasheet[] }[];
  pageImages: Record<number, { pages: string[]; loading: boolean; failed: boolean }>;
}) {
  const seen = new Set<string>();
  const unique: { system: SystemType; d: DeviceWithDatasheet }[] = [];
  for (const g of groups) {
    for (const d of g.devices) {
      if (!d.datasheet?.datasheet_url) continue;
      const key = `${d.manufacturer?.trim().toLowerCase()}|${d.model_number?.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ system: g.system, d });
    }
  }

  return (
    <div>
      {unique.map(({ system, d }) => {
        const dsId = d.datasheet!.id;
        const rendered = pageImages[dsId];
        const label = [d.manufacturer, d.model_number].filter(Boolean).join(' ');
        return (
          <div key={`${system}-${dsId}`} style={{ marginBottom: '2rem', pageBreakInside: 'avoid' }}>
            <div style={{ background: '#0f172a', padding: '0.4rem 0.75rem', borderRadius: '0.375rem 0.375rem 0 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <p style={{ fontWeight: 700, color: 'white', margin: 0, fontSize: '0.75rem' }}>{label || d.file_name}</p>
              <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 400 }}>{system}</span>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '0.5rem' }}>
              {rendered?.failed ? (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '1rem', textAlign: 'center' as const, color: '#64748b', fontSize: '0.8rem' }}>
                  <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Could not render datasheet PDF</p>
                  <p style={{ fontSize: '0.7rem', color: '#94a3b8', wordBreak: 'break-all' as const }}>{d.datasheet?.datasheet_url}</p>
                </div>
              ) : rendered?.pages.length ? (
                <div>
                  {rendered.pages.map((src, i) => (
                    <img key={i} src={src} alt={`${label} page ${i + 1}`} style={{ width: '100%', display: 'block', pageBreakInside: 'avoid' }} />
                  ))}
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '1rem', textAlign: 'center' as const, color: '#64748b', fontSize: '0.8rem' }}>
                  <p>Datasheet not yet rendered — open the O&M Builder to prepare for print</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
