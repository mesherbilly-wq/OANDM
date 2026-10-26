import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Upload, FileText, X, CheckCircle, AlertCircle, Plus,
  ArrowLeft, Loader2, ImageIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ImportSourceSelector } from '../components/ImportSourceSelector';
import { SimproImportFlow } from '../components/simpro/SimproImportFlow';
import type { ConnectorId } from '../integrations';
import { normalizeAiExtract } from '../integrations/connectors/aiDocuments/normalizeAiExtract';
import { setSimproImportSession } from '../lib/simproImportSession';
import { fetchAllProductModels } from '../lib/productDatabaseDb';
import { enrichImportReviewDraftWithMemory } from '../lib/importEquipmentValidation';
import { htmlFromScopeImportFile } from '../lib/scopeOfWorksImport';
import { ownCompanyId } from '../lib/companyScope';
import { readDocumentPages } from '../lib/aiImport/readPages';
import { extractAiPages } from '../lib/aiImport/runExtract';
import type { AiImportStoredFile, AiSourcePage } from '../lib/aiImport/types';

type Step = 'source' | 'upload' | 'analyzing' | 'simpro';

interface UploadedDoc {
  id: string;
  file: File;
  label: (typeof DOC_LABELS)[number];
}

const DOC_LABELS = ['Quote', 'Proposal', 'Scope of Works', 'Design Specification', 'Drawing', 'Schedule', 'Equipment list', 'Other'] as const;

function preferScopeHtml(documents: { name: string; html?: string }[]): string | null {
  const scoped = documents.filter(doc => /scope of works/i.test(doc.name) && doc.html);
  const html = (scoped.length > 0 ? scoped : documents)
    .map(doc => doc.html?.trim())
    .filter(Boolean)
    .join('\n');
  return html || null;
}

export function AIProjectBuilderPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('source');
  const [sourceMode, setSourceMode] = useState<'documents' | 'drawing'>('documents');
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [progress, setProgress] = useState('Reading the upload');
  const importIdRef = useRef(crypto.randomUUID());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawingInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      return ['pdf', 'txt', 'csv', 'md', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)
        || f.type.startsWith('text/')
        || f.type.startsWith('image/')
        || f.type.includes('wordprocessingml')
        || f.type === 'application/msword';
    });
    setDocs(prev => [...prev, ...arr.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      label: (sourceMode === 'drawing' ? 'Drawing' : 'Other') as UploadedDoc['label'],
    }))]);
  }, [sourceMode]);

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
    setProgress('Checking the company account');
    setStep('analyzing');
    try {
      const companyId = await ownCompanyId();
      if (!companyId) {
        throw new Error('Sign in as a company admin or staff member. The platform owner cannot import company documents.');
      }
      const selected = sourceMode === 'drawing' && drawingFile
        ? [{ id: 'drawing', file: drawingFile, label: 'Drawing' as const }]
        : docs;
      if (selected.length === 0) throw new Error('Add a drawing or document first.');

      const stored: AiImportStoredFile[] = [];
      const pages: AiSourcePage[] = [];
      for (const doc of selected) {
        const safeName = doc.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${companyId}/ai-import/${importIdRef.current}/${safeName}`;
        const mediaType = doc.file.type || (doc.file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        const { error: uploadError } = await supabase.storage.from('om-uploads').upload(path, doc.file, {
          contentType: mediaType,
          upsert: true,
        });
        if (uploadError) {
          throw new Error(`Could not store ${doc.file.name} in this company: ${uploadError.message}`);
        }
        stored.push({ fileName: doc.file.name, storagePath: path, mediaType, label: doc.label });
        pages.push(...await readDocumentPages(doc.file, doc.label, setProgress));
      }

      const readable = pages.filter(page => page.text.trim() || page.imageBase64);
      if (readable.length === 0) {
        throw new Error('No text or drawing image could be read. Try a PDF with selectable text, or a clearer scan.');
      }
      const extracted = await extractAiPages(readable, setProgress);
      const connectorId = sourceMode === 'drawing' ? 'ai_drawings' : 'ai_documents';
      let scopeHtmlFallback: string | null = null;
      try {
        scopeHtmlFallback = preferScopeHtml(await Promise.all(selected.map(async doc => ({
          name: `${doc.label}: ${doc.file.name}`,
          html: await htmlFromScopeImportFile(doc.file),
        }))));
      } catch {
        scopeHtmlFallback = null;
      }
      const draft = normalizeAiExtract(extracted, {
        connectorId,
        displayReference: selected.map(doc => doc.file.name).join(', '),
        scopeHtmlFallback,
      });
      const { products, error: productError } = await fetchAllProductModels();
      const enrichedDraft = await enrichImportReviewDraftWithMemory(draft, products);
      if (productError) {
        enrichedDraft.issues = [
          ...enrichedDraft.issues,
          {
            code: 'ai.product_database',
            message: `Product Database could not be loaded (${productError}). Import Review will open without autofill.`,
            severity: 'warning',
          },
        ];
      }

      setSimproImportSession({ draft: enrichedDraft, rawJob: extracted, sourceFiles: stored });
      navigate('/import-review');
    } catch (err: unknown) {
      setAnalyzeError(err instanceof Error ? err.message : 'Unknown error');
      setStep('upload');
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
        {step === 'analyzing' && <AnalyzingStep progress={progress} />}
      </div>
    </div>
  );
}

const STEP_ORDER: Step[] = ['source', 'upload', 'analyzing'];
const STEP_LABELS: Record<string, string> = { source: 'Source', upload: 'Upload', analyzing: 'Analyse' };

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <div className="flex items-center">
      {STEP_ORDER.map((s, i) => {
        const stepIdx = STEP_ORDER.indexOf(s);
        const done = currentIdx > stepIdx;
        const active = s === current;
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
            {i < STEP_ORDER.length - 1 && (
              <div className={`flex-1 h-0.5 mx-3 min-w-8 ${currentIdx > stepIdx ? 'bg-cyan-600' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function UploadStep({
  sourceMode,
  docs, isDragOver, analyzeError,
  fileInputRef, drawingInputRef, drawingFile, onSetDrawingFile,
  onDrop, onDragOver, onDragLeave, onFileInput,
  onRemove, onUpdateLabel, onAnalyze, onBack,
}: {
  sourceMode: 'documents' | 'drawing';
  docs: UploadedDoc[]; isDragOver: boolean; analyzeError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  drawingInputRef: React.RefObject<HTMLInputElement | null>;
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
          {' — '}extracts project details, equipment and scope for Import Review. It does not write method statements or RAMS.
        </span>
      </div>

      {sourceMode === 'documents' ? (
        <>
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
            <input ref={fileInputRef as React.Ref<HTMLInputElement>} type="file" multiple accept=".pdf,.doc,.docx,.txt,.csv,.md,.png,.jpg,.jpeg,.webp,text/*,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onFileInput} className="hidden" />
            <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${isDragOver ? 'bg-cyan-100' : 'bg-slate-100'}`}>
              <Upload className={`w-8 h-8 ${isDragOver ? 'text-cyan-600' : 'text-slate-400'}`} />
            </div>
            <p className="text-lg font-semibold text-slate-700 mb-1">{isDragOver ? 'Drop files here' : 'Drag & drop documents'}</p>
            <p className="text-sm text-slate-400">or click to browse — PDF, Word, images, TXT, CSV</p>
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
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3">
            <ImageIcon className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-600">
              <strong className="font-semibold text-slate-800">Upload a drawing PDF</strong> — floor plan, site plan, or device schedule. Claude extracts devices, locations and system types for Import Review.
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
              <input ref={drawingInputRef as React.Ref<HTMLInputElement>} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={e => { if (e.target.files?.[0]) onSetDrawingFile(e.target.files[0]); }} className="hidden" />
              <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${isDragOver ? 'bg-cyan-100' : 'bg-slate-100'}`}>
                <ImageIcon className={`w-8 h-8 ${isDragOver ? 'text-cyan-600' : 'text-slate-400'}`} />
              </div>
              <p className="text-lg font-semibold text-slate-700 mb-1">{isDragOver ? 'Drop drawing here' : 'Drag & drop a drawing PDF'}</p>
              <p className="text-sm text-slate-400">or click to browse — PDF or image, including a scan</p>
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

function AnalyzingStep({ progress }: { progress: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-8">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-xl shadow-cyan-300/50">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
        <div className="absolute inset-0 rounded-full bg-cyan-400/30 animate-ping" />
      </div>
      <div className="text-center max-w-md">
        <h2 className="text-xl font-bold text-slate-900 mb-1">Reading the upload</h2>
        <p className="text-slate-500 text-sm">{progress}</p>
        <p className="text-slate-400 text-xs mt-3">Each page is read. Sparse or scanned pages are sent as images. Nothing is saved until you approve the review.</p>
      </div>
      <Loader2 className="w-6 h-6 text-cyan-600 animate-spin" />
    </div>
  );
}
