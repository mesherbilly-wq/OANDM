import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Upload, FileText, X, CheckCircle, AlertCircle, Plus, Trash2,
  ChevronRight, Building, MapPin, User, FileSearch, ArrowLeft, Loader2,
  Camera, Lock, PhoneCall, ShieldAlert, Network, FolderOpen, Eye, Edit3,
  ClipboardList, Tag, ImageIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SystemType } from '../types';
import { getDevicePrefix } from '../lib/deviceLabel';
import { ensureProjectSystem } from '../lib/projectSystemsDb';
import { ImportSourceSelector } from '../components/ImportSourceSelector';
import { SimproImportFlow } from '../components/simpro/SimproImportFlow';
import type { ConnectorId } from '../integrations';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 'source' | 'upload' | 'analyzing' | 'review' | 'creating' | 'done' | 'simpro';
type AnalyzePhase = 'extracting' | 'generating';
type ReviewTab = 'devices' | 'documents';

interface UploadedDoc {
  id: string;
  file: File;
  label: 'Quote' | 'Proposal' | 'Scope of Works' | 'Design Specification' | 'Other';
}

interface ReviewDevice {
  id: string;
  selected: boolean;
  system_type: string;
  device_type: string;
  manufacturer: string;
  model_number: string;
  quantity: number;
  location: string;
  notes: string;
  ai_confidence?: number;
}

interface ReviewDocument {
  type: string;
  title: string;
  content: string;
}

interface ReviewProject {
  project_name: string;
  client_name: string;
  site_name: string;
  project_manager: string;
  project_summary: string;
  devices: ReviewDevice[];
  documents: ReviewDocument[];
}

const DOC_LABELS = ['Quote', 'Proposal', 'Scope of Works', 'Design Specification', 'Other'] as const;

const DOCUMENT_DEFS: { type: string; title: string }[] = [
  { type: 'scope_of_works',      title: 'Scope of Works' },
  { type: 'method_statement',    title: 'Method Statement' },
  { type: 'risk_assessment',     title: 'Risk Assessment' },
  { type: 'health_safety_summary', title: 'Health & Safety Summary' },
  { type: 'commissioning_pack',  title: 'Commissioning Pack' },
  { type: 'asset_register',      title: 'Asset Register' },
  { type: 'om_pack',             title: 'O&M Pack' },
  { type: 'handover_certificate', title: 'Handover Certificate' },
];

const VALID_SYSTEM_TYPES = ['CCTV', 'Access Control', 'Intercom', 'Intruder', 'Networking'];

const SYSTEM_TYPE_COLORS: Record<string, string> = {
  'CCTV': 'bg-blue-100 text-blue-700',
  'Access Control': 'bg-emerald-100 text-emerald-700',
  'Intercom': 'bg-amber-100 text-amber-700',
  'Intruder': 'bg-red-100 text-red-700',
  'Networking': 'bg-slate-100 text-slate-600',
};

// Compute expansion names for the full device list (for preview)
function computeNamePreviews(devices: ReviewDevice[]): string[] {
  const counters: Record<string, number> = {};
  return devices.map(d => {
    if (!d.selected) return '';
    const prefix = getDevicePrefix(d.system_type, d.device_type);
    const start = (counters[prefix] ?? 0) + 1;
    counters[prefix] = (counters[prefix] ?? 0) + d.quantity;
    const end = counters[prefix];
    if (d.quantity === 1) return `${prefix}-${String(start).padStart(3, '0')}`;
    return `${prefix}-${String(start).padStart(3, '0')} → ${prefix}-${String(end).padStart(3, '0')}`;
  });
}

// ── Simple markdown renderer ───────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  let html = '';
  for (const line of lines) {
    if (/^\|\s*[-:]+/.test(line)) { html += ''; continue; } // separator row
    if (line.startsWith('| ')) {
      const cells = line.slice(1, -1).split('|').map(c => `<td class="border border-slate-200 px-3 py-1.5 text-sm">${inlineMd(c.trim())}</td>`).join('');
      html += `<tr>${cells}</tr>`;
      continue;
    }
    if (line.startsWith('### ')) { html += `<h3 class="text-base font-semibold mt-4 mb-1 text-slate-800">${inlineMd(line.slice(4))}</h3>`; continue; }
    if (line.startsWith('## '))  { html += `<h2 class="text-lg font-bold mt-5 mb-2 text-slate-900">${inlineMd(line.slice(3))}</h2>`; continue; }
    if (line.startsWith('# '))   { html += `<h1 class="text-xl font-bold mt-2 mb-3 text-slate-900">${inlineMd(line.slice(2))}</h1>`; continue; }
    if (line.startsWith('- ') || line.startsWith('* ')) { html += `<li class="ml-5 list-disc text-sm text-slate-700 my-0.5">${inlineMd(line.slice(2))}</li>`; continue; }
    if (/^\d+\.\s/.test(line)) { html += `<li class="ml-5 list-decimal text-sm text-slate-700 my-0.5">${inlineMd(line.replace(/^\d+\.\s/, ''))}</li>`; continue; }
    if (/^\[[ x]\]/.test(line)) { const checked = line[1] === 'x'; html += `<div class="flex items-start gap-2 my-0.5"><span class="mt-0.5 ${checked ? 'text-emerald-600' : 'text-slate-400'}">${checked ? '☑' : '☐'}</span><span class="text-sm text-slate-700">${inlineMd(line.slice(3).trim())}</span></div>`; continue; }
    if (line.trim() === '') { html += '<div class="h-2"></div>'; continue; }
    html += `<p class="text-sm text-slate-700 my-0.5">${inlineMd(line)}</p>`;
  }
  // Wrap table rows
  html = html.replace(/(<tr>.*?<\/tr>)+/gs, m => `<table class="w-full border-collapse my-3 text-left">${m}</table>`);
  return html;
}

function inlineMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-slate-100 px-1 rounded text-xs font-mono">$1</code>');
}

// ── PDF text extraction ────────────────────────────────────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((item: any) => item.str).join(' '));
  }
  return parts.join('\n');
}

async function extractDocText(doc: UploadedDoc): Promise<{ name: string; content: string }> {
  const { file, label } = doc;
  const name = `${label}: ${file.name}`;
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try { return { name, content: await extractPdfText(file) }; }
    catch { return { name, content: `[PDF extraction failed for ${file.name}]` }; }
  }
  return { name, content: await file.text() };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AIProjectBuilderPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('source');
  const [analyzePhase, setAnalyzePhase] = useState<AnalyzePhase>('extracting');
  const [sourceMode, setSourceMode] = useState<'documents' | 'drawing'>('documents');
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [project, setProject] = useState<ReviewProject | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawingInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      return ['pdf', 'txt', 'csv', 'md'].includes(ext) || f.type.startsWith('text/');
    });
    setDocs(prev => [...prev, ...arr.map(f => ({ id: crypto.randomUUID(), file: f, label: 'Other' as const }))]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (sourceMode === 'drawing') {
      const file = e.dataTransfer.files[0];
      if (file) setDrawingFile(file);
    } else {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles, sourceMode]);

  const removeDoc = (id: string) => setDocs(prev => prev.filter(d => d.id !== id));
  const updateLabel = (id: string, label: UploadedDoc['label']) =>
    setDocs(prev => prev.map(d => d.id === id ? { ...d, label } : d));

  const selectImportSource = (source: ConnectorId) => {
    if (source === 'ai_documents') {
      setSourceMode('documents');
      setStep('upload');
    } else if (source === 'ai_drawings') {
      setSourceMode('drawing');
      setDrawingFile(null);
      setStep('upload');
    } else if (source === 'simpro') {
      setStep('simpro');
    }
  };

  const analyze = async () => {
    setAnalyzeError(null);
    setAnalyzePhase('extracting');
    setStep('analyzing');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};

      if (sourceMode === 'drawing' && drawingFile) {
        // ── Drawing path: upload to storage → call extract-drawing edge fn ──
        const safeName = drawingFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `drawings-ai/${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from('om-pack-uploads')
          .upload(path, drawingFile, { contentType: 'application/pdf', upsert: false });
        if (upErr) throw upErr;

        const { data: { publicUrl } } = supabase.storage.from('om-pack-uploads').getPublicUrl(path);

        const extractRes = await supabase.functions.invoke('extract-drawing', {
          body: { file_url: publicUrl, media_type: 'application/pdf' },
          headers: authHeader,
        });
        if (extractRes.error) throw new Error(extractRes.error.message);
        const extracted = extractRes.data;
        if (extracted?.error) throw new Error(extracted.error);

        const reviewDevices: ReviewDevice[] = (extracted.devices ?? []).map((d: any) => ({
          id: crypto.randomUUID(),
          selected: true,
          system_type: d.system_type ?? 'CCTV',
          device_type: d.device_type ?? '',
          manufacturer: d.manufacturer ?? '',
          model_number: d.model_number ?? '',
          quantity: Math.max(1, Math.round(d.quantity ?? 1)),
          location: d.location ?? '',
          notes: d.notes ?? '',
          ai_confidence: d.confidence ?? null,
        }));

        setAnalyzePhase('generating');
        let reviewDocs: ReviewDocument[] = DOCUMENT_DEFS.map(def => ({ ...def, content: '' }));
        try {
          const genRes = await supabase.functions.invoke('generate-documents', {
            body: { project: { ...extracted, devices: extracted.devices ?? [] } },
            headers: authHeader,
          });
          if (!genRes.error && genRes.data?.documents) {
            const gd = genRes.data.documents;
            reviewDocs = DOCUMENT_DEFS.map(def => ({
              ...def,
              content: gd[def.type] ?? `# ${def.title}\n\nPlease edit this document.`,
            }));
          }
        } catch { /* non-fatal */ }

        setProject({
          project_name: extracted.project_name ?? '',
          client_name: extracted.client_name ?? '',
          site_name: extracted.site_name ?? '',
          project_manager: extracted.project_manager ?? '',
          project_summary: extracted.project_summary ?? '',
          devices: reviewDevices,
          documents: reviewDocs,
        });
        setStep('review');
        return;
      }

      // ── Document path (existing) ──────────────────────────────────────────
      const documents = await Promise.all(docs.map(extractDocText));

      // Phase 1: extract project + devices
      const extractRes = await supabase.functions.invoke('extract-project', { body: { documents }, headers: authHeader });
      if (extractRes.error) throw new Error(extractRes.error.message);
      const extracted = extractRes.data;
      if (extracted?.error) throw new Error(extracted.error);

      const reviewDevices: ReviewDevice[] = (extracted.devices ?? []).map((d: any) => ({
        id: crypto.randomUUID(),
        selected: true,
        system_type: d.system_type ?? 'CCTV',
        device_type: d.device_type ?? '',
        manufacturer: d.manufacturer ?? '',
        model_number: d.model_number ?? '',
        quantity: Math.max(1, Math.round(d.quantity ?? 1)),
        location: d.location ?? '',
        notes: d.notes ?? '',
        ai_confidence: d.confidence ?? null,
      }));

      // Phase 2: generate project documents
      setAnalyzePhase('generating');
      let reviewDocs: ReviewDocument[] = DOCUMENT_DEFS.map(def => ({ ...def, content: '' }));
      try {
        const genRes = await supabase.functions.invoke('generate-documents', {
          body: { project: { ...extracted, devices: extracted.devices ?? [] } },
          headers: authHeader,
        });
        if (!genRes.error && genRes.data?.documents) {
          const gd = genRes.data.documents;
          reviewDocs = DOCUMENT_DEFS.map(def => ({
            ...def,
            content: gd[def.type] ?? `# ${def.title}\n\nPlease edit this document.`,
          }));
        }
      } catch {
        // Document generation failing is non-fatal — continue with empty templates
      }

      setProject({
        project_name: extracted.project_name ?? '',
        client_name: extracted.client_name ?? '',
        site_name: extracted.site_name ?? '',
        project_manager: extracted.project_manager ?? '',
        project_summary: extracted.project_summary ?? '',
        devices: reviewDevices,
        documents: reviewDocs,
      });
      setStep('review');
    } catch (err: any) {
      setAnalyzeError(err.message ?? 'Unknown error');
      setStep('upload');
    }
  };

  const createProject = async () => {
    if (!project) return;
    setCreateError(null);
    setStep('creating');
    try {
      // Create project record
      const { data: proj, error: projErr } = await supabase
        .from('projects')
        .insert({
          project_name: project.project_name || null,
          client_name: project.client_name || null,
          site_name: project.site_name || null,
          project_manager: project.project_manager || null,
        })
        .select().single();
      if (projErr || !proj) throw new Error(projErr?.message ?? 'Failed to create project');

      // Fetch existing device names to avoid sequence conflicts
      const { data: existingDevices } = await supabase
        .from('devices').select('device_name').eq('project_id', proj.id);
      const prefixCounters: Record<string, number> = {};
      for (const d of existingDevices ?? []) {
        const m = d.device_name?.match(/^([A-Z]+)-(\d+)$/);
        if (m) {
          const n = parseInt(m[2]);
          if (!prefixCounters[m[1]] || n > prefixCounters[m[1]]) prefixCounters[m[1]] = n;
        }
      }

      // Expand devices: one record per unit
      const selectedDevices = project.devices.filter(d => d.selected);
      const MAX_PER_LINE = 200;
      const systemIdByName = new Map<string, number>();
      for (const name of [
        ...new Set(selectedDevices.map(d => String(d.system_type).trim() || 'Unnamed System')),
      ]) {
        const systemId = await ensureProjectSystem(proj.id, name, null, 'ai');
        systemIdByName.set(name, systemId);
      }

      const deviceRows: any[] = [];
      for (const d of selectedDevices) {
        const systemName = String(d.system_type).trim() || 'Unnamed System';
        const prefix = getDevicePrefix(d.system_type, d.device_type);
        const qty = Math.min(d.quantity, MAX_PER_LINE);
        for (let i = 0; i < qty; i++) {
          prefixCounters[prefix] = (prefixCounters[prefix] ?? 0) + 1;
          deviceRows.push({
            project_id: proj.id,
            project_system_id: systemIdByName.get(systemName) ?? null,
            system_type: d.system_type as SystemType,
            device_type: d.device_type || null,
            device_name: `${prefix}-${String(prefixCounters[prefix]).padStart(3, '0')}`,
            manufacturer: d.manufacturer || null,
            model_number: d.model_number || null,
            location: d.location || null,
            notes: d.notes || null,
            matched: false,
            datasheet_found: false,
            status: 'pending_review',
            ai_confidence: d.ai_confidence ?? null,
            source_document: 'AI Project Builder',
          });
        }
      }

      if (deviceRows.length > 0) {
        // Insert in batches of 100
        for (let i = 0; i < deviceRows.length; i += 100) {
          await supabase.from('devices').insert(deviceRows.slice(i, i + 100));
        }
      }

      // Save project documents
      const docRows = project.documents
        .filter(d => d.content.trim())
        .map(d => ({
          project_id: proj.id,
          document_type: d.type,
          title: d.title,
          content: d.content,
          status: 'draft',
          generated_by: 'ai',
        }));
      if (docRows.length > 0) {
        await supabase.from('project_documents').insert(docRows);
      }

      setCreatedId(proj.id);
      setStep('done');
    } catch (err: any) {
      setCreateError(err.message ?? 'Unknown error');
      setStep('review');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-md">
            <Plus className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Create Project</h1>
        </div>
        <p className="text-slate-500 ml-[52px]">Choose an import source from the Integration Centre — AI extraction, integrations, and manual entry</p>
      </div>

      {step !== 'source' && step !== 'simpro' && <StepIndicator current={step} />}

      <div className={step === 'source' || step === 'simpro' ? 'mt-0' : 'mt-8'}>
        {step === 'source' && (
          <ImportSourceSelector onSelect={selectImportSource} />
        )}
        {step === 'simpro' && (
          <SimproImportFlow onBack={() => setStep('source')} />
        )}
        {step === 'upload' && (
          <UploadStep
            sourceMode={sourceMode}
            docs={docs} isDragOver={isDragOver} analyzeError={analyzeError}
            fileInputRef={fileInputRef} drawingInputRef={drawingInputRef}
            drawingFile={drawingFile} onSetDrawingFile={setDrawingFile}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onFileInput={e => { if (e.target.files) addFiles(e.target.files); }}
            onRemove={removeDoc} onUpdateLabel={updateLabel} onAnalyze={analyze}
            onBack={() => setStep('source')} />
        )}
        {step === 'analyzing' && <AnalyzingStep phase={analyzePhase} />}
        {step === 'review' && project && (
          <ReviewStep project={project} onChange={setProject} createError={createError}
            onBack={() => setStep('upload')} onCreate={createProject} />
        )}
        {step === 'creating' && <CreatingStep />}
        {step === 'done' && createdId !== null && (
          <DoneStep projectId={createdId} onNavigate={() => navigate(`/projects/${createdId}`)} />
        )}
      </div>
    </div>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEP_ORDER: Step[] = ['source', 'upload', 'analyzing', 'review', 'creating', 'done'];
const STEP_LABELS: Record<string, string> = { source: 'Source', upload: 'Upload', analyzing: 'Analyse', review: 'Review', done: 'Done' };
const VISIBLE_STEPS: Step[] = ['source', 'upload', 'analyzing', 'review', 'done'];

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <div className="flex items-center">
      {VISIBLE_STEPS.map((s, i) => {
        const stepIdx = STEP_ORDER.indexOf(s);
        const done = currentIdx > stepIdx;
        const active = s === current || (current === 'creating' && s === 'review');
        return (
          <React.Fragment key={s}>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all
                ${done ? 'bg-cyan-600 border-cyan-600 text-white' : active ? 'border-cyan-600 text-cyan-600 bg-white' : 'border-slate-200 text-slate-400 bg-white'}`}>
                {done ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-sm font-medium ${active ? 'text-slate-900' : done ? 'text-slate-600' : 'text-slate-400'}`}>
                {STEP_LABELS[s]}
              </span>
            </div>
            {i < VISIBLE_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-3 min-w-8 ${currentIdx > stepIdx ? 'bg-cyan-600' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Upload step ────────────────────────────────────────────────────────────────

function UploadStep({
  sourceMode,
  docs, isDragOver, analyzeError,
  fileInputRef, drawingInputRef, drawingFile, onSetDrawingFile,
  onDrop, onDragOver, onDragLeave, onFileInput,
  onRemove, onUpdateLabel, onAnalyze, onBack,
}: {
  sourceMode: 'documents' | 'drawing';
  docs: UploadedDoc[]; isDragOver: boolean; analyzeError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  drawingInputRef: React.RefObject<HTMLInputElement>;
  drawingFile: File | null; onSetDrawingFile: (f: File | null) => void;
  onDrop: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void; onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void; onUpdateLabel: (id: string, label: UploadedDoc['label']) => void;
  onAnalyze: () => void; onBack: () => void;
}) {
  const canAnalyze = sourceMode === 'drawing' ? !!drawingFile : docs.length > 0;
  const sourceLabel = sourceMode === 'drawing' ? 'AI Drawings' : 'AI Documents';

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to import sources
      </button>

      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-cyan-600 flex-shrink-0" />
        <span className="text-sm text-slate-700">
          Importing via <strong className="font-semibold text-slate-900">{sourceLabel}</strong>
        </span>
      </div>

      {sourceMode === 'documents' ? (
        <>
          {/* Document type hints */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['Quote', 'Proposal', 'Scope of Works', 'Design Specification'] as const).map(type => (
              <div key={type} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
                <FileText className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm font-medium text-slate-700">{type}</span>
              </div>
            ))}
          </div>

          <div onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
              ${isDragOver ? 'border-cyan-500 bg-cyan-50' : 'border-slate-300 bg-white hover:border-cyan-400 hover:bg-slate-50'}`}>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.txt,.csv,.md,text/*" onChange={onFileInput} className="hidden" />
            <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${isDragOver ? 'bg-cyan-100' : 'bg-slate-100'}`}>
              <Upload className={`w-8 h-8 ${isDragOver ? 'text-cyan-600' : 'text-slate-400'}`} />
            </div>
            <p className="text-lg font-semibold text-slate-700 mb-1">{isDragOver ? 'Drop files here' : 'Drag & drop documents'}</p>
            <p className="text-sm text-slate-400">or click to browse — PDF, TXT, CSV supported</p>
          </div>

          {docs.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <span className="text-sm font-semibold text-slate-700">{docs.length} document{docs.length !== 1 ? 's' : ''} ready</span>
              </div>
              <div className="divide-y divide-slate-100">
                {docs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-9 h-9 rounded-lg bg-cyan-50 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-cyan-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{doc.file.name}</p>
                      <p className="text-xs text-slate-400">{(doc.file.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <select value={doc.label} onChange={e => onUpdateLabel(doc.id, e.target.value as UploadedDoc['label'])}
                      onClick={e => e.stopPropagation()}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500">
                      {DOC_LABELS.map(l => <option key={l}>{l}</option>)}
                    </select>
                    <button onClick={() => onRemove(doc.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Drawing upload */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3">
            <ImageIcon className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-600">
              <strong className="font-semibold text-slate-800">Upload a drawing PDF</strong> — floor plan, site plan, or device schedule. Claude analyses the visual content and extracts every device reference, location, and system type using AI vision.
            </div>
          </div>

          {drawingFile ? (
            <div className="bg-white border border-emerald-200 rounded-xl p-5 flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{drawingFile.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{(drawingFile.size / 1024).toFixed(0)} KB · Ready for AI analysis</p>
              </div>
              <button onClick={() => onSetDrawingFile(null)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
              onClick={() => drawingInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
                ${isDragOver ? 'border-cyan-500 bg-cyan-50' : 'border-slate-300 bg-white hover:border-cyan-400 hover:bg-slate-50'}`}>
              <input ref={drawingInputRef} type="file" accept=".pdf,application/pdf" onChange={e => { if (e.target.files?.[0]) onSetDrawingFile(e.target.files[0]); }} className="hidden" />
              <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${isDragOver ? 'bg-cyan-100' : 'bg-slate-100'}`}>
                <ImageIcon className={`w-8 h-8 ${isDragOver ? 'text-cyan-600' : 'text-slate-400'}`} />
              </div>
              <p className="text-lg font-semibold text-slate-700 mb-1">{isDragOver ? 'Drop drawing here' : 'Drag & drop a drawing PDF'}</p>
              <p className="text-sm text-slate-400">or click to browse — single PDF drawing</p>
            </div>
          )}
        </>
      )}

      {analyzeError && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Extraction failed</p>
            <p className="text-sm text-red-600 mt-0.5">{analyzeError}</p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onAnalyze} disabled={!canAnalyze}
          className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white px-6 py-3 rounded-xl font-semibold hover:from-cyan-700 hover:to-blue-700 transition-all shadow-md shadow-cyan-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
          <Sparkles className="w-5 h-5" />
          {sourceMode === 'drawing' ? 'Analyse Drawing with Claude AI' : 'Analyse with Claude AI'}
        </button>
      </div>
    </div>
  );
}

// ── Analyzing step ─────────────────────────────────────────────────────────────

const EXTRACT_STAGES = [
  'Reading document content…',
  'Identifying project and client details…',
  'Extracting device specifications and quantities…',
  'Matching system types and manufacturers…',
  'Building device schedule…',
];
const GENERATE_STAGES = [
  'Generating Scope of Works…',
  'Writing Method Statement and Risk Assessment…',
  'Compiling Commissioning Pack and Asset Register…',
  'Producing O&M Pack and Handover Certificate…',
];

function AnalyzingStep({ phase }: { phase: AnalyzePhase }) {
  const [stageIdx, setStageIdx] = useState(0);
  const stages = phase === 'extracting' ? EXTRACT_STAGES : GENERATE_STAGES;

  useEffect(() => {
    setStageIdx(0);
    const id = setInterval(() => setStageIdx(i => Math.min(i + 1, stages.length - 1)), 2000);
    return () => clearInterval(id);
  }, [phase, stages.length]);

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-8">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-xl shadow-cyan-300/50">
          {phase === 'extracting' ? <Sparkles className="w-10 h-10 text-white" /> : <ClipboardList className="w-10 h-10 text-white" />}
        </div>
        <div className="absolute inset-0 rounded-full bg-cyan-400/30 animate-ping" />
      </div>
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${phase === 'extracting' ? 'bg-cyan-100 text-cyan-700' : 'bg-emerald-100 text-emerald-700'}`}>
            Phase {phase === 'extracting' ? '1 of 2' : '2 of 2'}
          </span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          {phase === 'extracting' ? 'Analysing your documents' : 'Generating project documents'}
        </h2>
        <p className="text-slate-500 text-sm">
          {phase === 'extracting' ? 'Claude is extracting every device and project detail…' : 'Claude is drafting your full document pack…'}
        </p>
      </div>
      <div className="w-full max-w-sm space-y-2">
        {stages.map((stage, i) => (
          <div key={stage} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-500 ${i <= stageIdx ? 'opacity-100' : 'opacity-20'}`}>
            {i < stageIdx ? <CheckCircle className="w-5 h-5 text-cyan-600 flex-shrink-0" />
              : i === stageIdx ? <Loader2 className="w-5 h-5 text-cyan-600 animate-spin flex-shrink-0" />
              : <div className="w-5 h-5 rounded-full border-2 border-slate-200 flex-shrink-0" />}
            <span className={`text-sm font-medium ${i <= stageIdx ? 'text-slate-700' : 'text-slate-400'}`}>{stage}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Review step ────────────────────────────────────────────────────────────────

function ReviewStep({ project, onChange, createError, onBack, onCreate }: {
  project: ReviewProject; onChange: (p: ReviewProject) => void;
  createError: string | null; onBack: () => void; onCreate: () => void;
}) {
  const [tab, setTab] = useState<ReviewTab>('devices');
  const setField = (key: keyof Omit<ReviewProject, 'devices' | 'documents'>, val: string) =>
    onChange({ ...project, [key]: val });

  const totalExpanded = useMemo(() =>
    project.devices.filter(d => d.selected).reduce((s, d) => s + d.quantity, 0), [project.devices]);

  const namePreviews = useMemo(() => computeNamePreviews(project.devices), [project.devices]);
  const systemTypes = useMemo(() =>
    [...new Set(project.devices.filter(d => d.selected).map(d => d.system_type))], [project.devices]);

  return (
    <div className="space-y-5">
      {/* Project info card */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
          <FolderOpen className="w-5 h-5 text-cyan-600" />
          <h2 className="text-base font-semibold text-slate-800">Project Details</h2>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Project Name *</label>
            <input value={project.project_name} onChange={e => setField('project_name', e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Project name" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Client</label>
            <div className="relative"><Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={project.client_name} onChange={e => setField('client_name', e.target.value)}
                className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Client name" /></div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Site</label>
            <div className="relative"><MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={project.site_name} onChange={e => setField('site_name', e.target.value)}
                className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Site address or name" /></div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Project Manager</label>
            <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={project.project_manager} onChange={e => setField('project_manager', e.target.value)}
                className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Project manager" /></div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">System Types</label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {systemTypes.map(st => (
                <span key={st} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${SYSTEM_TYPE_COLORS[st] ?? 'bg-slate-100 text-slate-600'}`}>
                  {st}
                </span>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Project Summary</label>
            <textarea value={project.project_summary} onChange={e => setField('project_summary', e.target.value)}
              rows={2} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button onClick={() => setTab('devices')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all
            ${tab === 'devices' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <Tag className="w-4 h-4" />
          Devices
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${tab === 'devices' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-200 text-slate-500'}`}>
            {project.devices.length}
          </span>
        </button>
        <button onClick={() => setTab('documents')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all
            ${tab === 'documents' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <ClipboardList className="w-4 h-4" />
          Documents
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${tab === 'documents' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-200 text-slate-500'}`}>
            {project.documents.length}
          </span>
        </button>
      </div>

      {tab === 'devices' && (
        <DevicesTab project={project} onChange={onChange} namePreviews={namePreviews} />
      )}
      {tab === 'documents' && (
        <DocumentsTab documents={project.documents}
          onChange={docs => onChange({ ...project, documents: docs })} />
      )}

      {createError && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Failed to create project</p>
            <p className="text-sm text-red-600 mt-0.5">{createError}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between py-2">
        <button onClick={onBack} className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 font-medium transition-colors">
          <ArrowLeft className="w-4 h-4" />Back to upload
        </button>
        <div className="flex items-center gap-4">
          <p className="text-sm text-slate-500">
            Creates <span className="font-semibold text-slate-700">{totalExpanded}</span> individual device records
          </p>
          <button onClick={onCreate} disabled={!project.project_name.trim()}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white px-6 py-3 rounded-xl font-semibold hover:from-cyan-700 hover:to-blue-700 transition-all shadow-md shadow-cyan-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
            <CheckCircle className="w-5 h-5" />Create Project
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Devices tab ────────────────────────────────────────────────────────────────

function DevicesTab({ project, onChange, namePreviews }: {
  project: ReviewProject; onChange: (p: ReviewProject) => void; namePreviews: string[];
}) {
  const setDevice = (id: string, key: keyof ReviewDevice, val: any) =>
    onChange({ ...project, devices: project.devices.map(d => d.id === id ? { ...d, [key]: val } : d) });
  const removeDevice = (id: string) =>
    onChange({ ...project, devices: project.devices.filter(d => d.id !== id) });
  const addDevice = () =>
    onChange({ ...project, devices: [...project.devices, { id: crypto.randomUUID(), selected: true, system_type: 'CCTV', device_type: '', manufacturer: '', model_number: '', quantity: 1, location: '', notes: '' }] });
  const selectedCount = project.devices.filter(d => d.selected).length;
  const allSelected = selectedCount === project.devices.length;
  const totalExpanded = project.devices.filter(d => d.selected).reduce((s, d) => s + d.quantity, 0);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
        <FileSearch className="w-5 h-5 text-cyan-600" />
        <h2 className="text-base font-semibold text-slate-800">Extracted Devices</h2>
        <span className="text-xs bg-cyan-100 text-cyan-700 font-semibold px-2 py-0.5 rounded-full">{project.devices.length} line items</span>
        <span className="text-xs bg-slate-100 text-slate-600 font-medium px-2 py-0.5 rounded-full">→ {totalExpanded} individual records</span>
        <span className="ml-auto text-xs text-slate-400">{selectedCount} selected</span>
        <button onClick={() => onChange({ ...project, devices: project.devices.map(d => ({ ...d, selected: !allSelected })) })}
          className="text-xs text-cyan-600 hover:text-cyan-800 font-medium">
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="w-10 px-4 py-3" />
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">System</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Device Type</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Manufacturer</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Model</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-16">Qty</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Names (preview)</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {project.devices.map((device, i) => (
              <DeviceRow key={device.id} device={device} namePreview={namePreviews[i] ?? ''}
                onToggle={() => setDevice(device.id, 'selected', !device.selected)}
                onChange={(key, val) => setDevice(device.id, key, val)}
                onRemove={() => removeDevice(device.id)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-3 border-t border-slate-100">
        <button onClick={addDevice} className="inline-flex items-center gap-2 text-sm text-cyan-600 hover:text-cyan-800 font-medium">
          <Plus className="w-4 h-4" />Add device
        </button>
      </div>
    </div>
  );
}

function DeviceRow({ device, namePreview, onToggle, onChange, onRemove }: {
  device: ReviewDevice; namePreview: string;
  onToggle: () => void; onChange: (key: keyof ReviewDevice, val: any) => void; onRemove: () => void;
}) {
  const inp = `px-2 py-1.5 border border-slate-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400`;
  return (
    <tr className={device.selected ? '' : 'opacity-40'}>
      <td className="px-4 py-2 text-center">
        <input type="checkbox" checked={device.selected} onChange={onToggle}
          className="w-4 h-4 rounded border-slate-300 text-cyan-600 cursor-pointer" />
      </td>
      <td className="px-3 py-2">
        <select value={device.system_type} onChange={e => onChange('system_type', e.target.value)}
          disabled={!device.selected} className={`${inp} min-w-[130px]`}>
          {VALID_SYSTEM_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        <input value={device.device_type} onChange={e => onChange('device_type', e.target.value)}
          disabled={!device.selected} className={`${inp} min-w-[120px]`} placeholder="Device type" />
      </td>
      <td className="px-3 py-2">
        <input value={device.manufacturer} onChange={e => onChange('manufacturer', e.target.value)}
          disabled={!device.selected} className={`${inp} min-w-[110px]`} placeholder="Manufacturer" />
      </td>
      <td className="px-3 py-2">
        <input value={device.model_number} onChange={e => onChange('model_number', e.target.value)}
          disabled={!device.selected} className={`${inp} min-w-[110px]`} placeholder="Model" />
      </td>
      <td className="px-3 py-2">
        <input type="number" min={1} value={device.quantity}
          onChange={e => onChange('quantity', Math.max(1, parseInt(e.target.value) || 1))}
          disabled={!device.selected} className={`${inp} w-16 text-center`} />
      </td>
      <td className="px-3 py-2">
        <span className={`text-xs font-mono font-semibold px-2 py-1 rounded whitespace-nowrap
          ${device.selected && namePreview ? 'bg-cyan-50 text-cyan-700' : 'text-slate-300'}`}>
          {device.selected && namePreview ? namePreview : '—'}
        </span>
      </td>
      <td className="px-3 py-2">
        <input value={device.location} onChange={e => onChange('location', e.target.value)}
          disabled={!device.selected} className={`${inp} min-w-[110px]`} placeholder="Location" />
      </td>
      <td className="px-3 py-2 text-center">
        <button onClick={onRemove} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

// ── Documents tab ──────────────────────────────────────────────────────────────

function DocumentsTab({ documents, onChange }: {
  documents: ReviewDocument[]; onChange: (docs: ReviewDocument[]) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isPreview, setIsPreview] = useState(false);
  const doc = documents[selectedIdx];

  const updateContent = (content: string) => {
    onChange(documents.map((d, i) => i === selectedIdx ? { ...d, content } : d));
  };

  return (
    <div className="flex gap-4" style={{ height: 640 }}>
      {/* Sidebar */}
      <div className="w-52 flex-shrink-0 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Draft Documents</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {documents.map((d, i) => (
            <button key={d.type} onClick={() => setSelectedIdx(i)}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm transition-all
                ${i === selectedIdx ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
              <FileText className={`w-4 h-4 flex-shrink-0 mt-0.5 ${i === selectedIdx ? 'text-white' : 'text-slate-400'}`} />
              <span className="font-medium leading-tight">{d.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor panel */}
      <div className="flex-1 flex flex-col border border-slate-200 rounded-2xl overflow-hidden bg-white">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-slate-800">{doc?.title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">AI-generated draft — edit as needed before export</p>
          </div>
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
            <button onClick={() => setIsPreview(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
                ${!isPreview ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
              <Edit3 className="w-3.5 h-3.5" />Edit
            </button>
            <button onClick={() => setIsPreview(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
                ${isPreview ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
              <Eye className="w-3.5 h-3.5" />Preview
            </button>
          </div>
        </div>

        {isPreview ? (
          <div className="flex-1 overflow-auto p-6 bg-white">
            {doc?.content
              ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.content) }} />
              : <p className="text-slate-400 italic text-sm">No content to preview.</p>
            }
          </div>
        ) : (
          <textarea
            value={doc?.content ?? ''}
            onChange={e => updateContent(e.target.value)}
            className="flex-1 p-5 font-mono text-sm text-slate-700 bg-white resize-none focus:outline-none border-0"
            placeholder="Document content (markdown supported)…"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}

// ── Creating / Done steps ──────────────────────────────────────────────────────

function CreatingStep() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-xl shadow-cyan-300/40">
        <Loader2 className="w-9 h-9 text-white animate-spin" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-slate-900 mb-2">Creating your project…</h2>
        <p className="text-slate-500 text-sm">Adding devices, saving documents, building project structure</p>
      </div>
    </div>
  );
}

function DoneStep({ projectId, onNavigate }: { projectId: number; onNavigate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      <div className="w-24 h-24 rounded-full bg-emerald-100 flex items-center justify-center">
        <CheckCircle className="w-12 h-12 text-emerald-600" />
      </div>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Project created!</h2>
        <p className="text-slate-500 mb-1">Device records are marked <strong>pending review</strong> — approve them in the project to add to your schedule.</p>
        <p className="text-slate-400 text-sm">Draft documents are saved and ready to edit in the project.</p>
      </div>
      <button onClick={onNavigate}
        className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white px-8 py-3.5 rounded-xl font-semibold hover:from-cyan-700 hover:to-blue-700 transition-all shadow-md shadow-cyan-200 text-base">
        Open Project & Review Devices
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
