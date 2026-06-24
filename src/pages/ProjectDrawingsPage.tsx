import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProject } from './ProjectLayout';
import type { Drawing, DrawingProposal, ProductModel } from '../types';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Upload, CheckCircle, XCircle, AlertCircle, Sparkles, FileText,
  Trash2, Clock, RefreshCw, Search, MapPin,
  X, Edit2, Info, ImageIcon, Cpu, ExternalLink, FileSearch,
} from 'lucide-react';

const SYSTEM_TYPES = ['CCTV', 'Access Control', 'Intercom', 'Intruder', 'Networking'];
const DEVICE_TYPES = ['Camera', 'Door Controller', 'Access Reader', 'Recorder', 'Sensor', 'Intercom', 'Network Switch', 'Other'];

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-400 border-amber-500 text-white',
  approved: 'bg-green-500 border-green-600 text-white',
  rejected: 'bg-slate-400 border-slate-500 text-white',
};

const STATUS_RING: Record<string, string> = {
  pending: 'ring-amber-400',
  approved: 'ring-green-500',
  rejected: 'ring-slate-400',
};

export function ProjectDrawingsPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { productModels } = useProject();

  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawing, setSelectedDrawing] = useState<Drawing | null>(null);
  const [proposals, setProposals] = useState<DrawingProposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // URL param deep-link support
  const paramDrawingId = searchParams.get('drawing_id');
  const paramDevice = searchParams.get('device');

  useEffect(() => { fetchDrawings(); }, [id]);

  useEffect(() => {
    if (selectedDrawing) fetchProposals(selectedDrawing.id);
    else setProposals([]);
  }, [selectedDrawing?.id]);

  // Deep-link: once drawings load, auto-select the target drawing
  useEffect(() => {
    if (!paramDrawingId || drawings.length === 0) return;
    const target = drawings.find(d => d.id === parseInt(paramDrawingId));
    if (target) setSelectedDrawing(target);
  }, [paramDrawingId, drawings]);

  // Deep-link: auto-select the target proposal once proposals load
  useEffect(() => {
    if (!paramDevice || proposals.length === 0) return;
    const target = proposals.find(p => p.device_name === paramDevice);
    if (target) setSelectedProposalId(target.id);
  }, [paramDevice, proposals]);

  const fetchDrawings = async () => {
    if (!id) return;
    const { data } = await supabase.from('drawings').select('*').eq('project_id', parseInt(id)).order('created_at', { ascending: false });
    setDrawings(data ?? []);
  };

  const fetchProposals = async (drawingId: number) => {
    const { data } = await supabase.from('drawing_proposals').select('*').eq('drawing_id', drawingId).order('created_at');
    setProposals(data ?? []);
    setSelectedProposalId(null);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !id) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
      const path = `${id}/${Date.now()}-${file.name}`;
      const { data: storageData, error: storageErr } = await supabase.storage.from('drawings').upload(path, file);
      if (storageErr) { setError('Upload failed: ' + storageErr.message); continue; }
      const { data: urlData } = supabase.storage.from('drawings').getPublicUrl(storageData.path);
      const { data: drawing } = await supabase.from('drawings').insert({
        project_id: parseInt(id),
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_type: ext,
        file_size: file.size,
        processing_status: 'pending',
      }).select().single();
      if (drawing) {
        setDrawings(prev => [drawing, ...prev]);
        setSelectedDrawing(drawing);
      }
    }
    setUploading(false);
  };

  const handleProcess = async (drawing: Drawing) => {
    setProcessing(drawing.id);
    setError(null);
    await supabase.from('drawings').update({ processing_status: 'processing' }).eq('id', drawing.id);
    setDrawings(prev => prev.map(d => d.id === drawing.id ? { ...d, processing_status: 'processing' } : d));
    if (selectedDrawing?.id === drawing.id) setSelectedDrawing(d => d ? { ...d, processing_status: 'processing' } : d);

    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-drawing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ drawing_id: drawing.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Processing failed. Check that ANTHROPIC_API_KEY is configured in Edge Function secrets.');
        await supabase.from('drawings').update({ processing_status: 'failed' }).eq('id', drawing.id);
        setDrawings(prev => prev.map(d => d.id === drawing.id ? { ...d, processing_status: 'failed' } : d));
        if (selectedDrawing?.id === drawing.id) setSelectedDrawing(d => d ? { ...d, processing_status: 'failed' } : d);
      } else {
        await supabase.from('drawings').update({ processing_status: 'completed' }).eq('id', drawing.id);
        const updated = { ...drawing, processing_status: 'completed' as const };
        setDrawings(prev => prev.map(d => d.id === drawing.id ? updated : d));
        setSelectedDrawing(updated);
        await fetchProposals(drawing.id);
      }
    } catch (e: any) {
      setError('Network error: ' + e.message);
      await supabase.from('drawings').update({ processing_status: 'failed' }).eq('id', drawing.id);
      setDrawings(prev => prev.map(d => d.id === drawing.id ? { ...d, processing_status: 'failed' } : d));
    }
    setProcessing(null);
  };

  const handleDeleteDrawing = async (drawingId: number) => {
    if (!confirm('Delete this drawing and all its extracted proposals?')) return;
    await supabase.from('drawings').delete().eq('id', drawingId);
    setDrawings(prev => prev.filter(d => d.id !== drawingId));
    if (selectedDrawing?.id === drawingId) { setSelectedDrawing(null); setProposals([]); }
  };

  const handleConfirm = async (proposal: DrawingProposal, edits: ProposalEdits) => {
    setConfirming(true);
    const updates = {
      device_name: edits.name || proposal.device_name,
      system_type: edits.systemType || proposal.system_type,
      device_type: edits.deviceType || proposal.device_type,
      manufacturer: edits.manufacturer || proposal.manufacturer,
      model_number: edits.modelNumber || proposal.model_number,
      status: 'approved' as const,
    };
    await supabase.from('drawing_proposals').update(updates).eq('id', proposal.id);

    if (proposal.status !== 'approved') {
      await supabase.from('devices').insert({
        project_id: parseInt(id!),
        system_type: updates.system_type,
        device_type: updates.device_type,
        device_name: updates.device_name,
        manufacturer: updates.manufacturer,
        model_number: updates.model_number,
        location: proposal.location,
        notes: proposal.notes,
        matched: edits.linkedModelId !== null,
        datasheet_found: false,
        drawing_id: proposal.drawing_id,
      });
    }

    setProposals(prev => prev.map(p => p.id === proposal.id ? { ...p, ...updates } : p));
    // Auto-advance to next pending
    const nextPending = proposals.find(p => p.id !== proposal.id && p.status === 'pending');
    setSelectedProposalId(nextPending?.id ?? null);
    setConfirming(false);
  };

  const handleReject = async (proposalId: number) => {
    await supabase.from('drawing_proposals').update({ status: 'rejected' }).eq('id', proposalId);
    setProposals(prev => prev.map(p => p.id === proposalId ? { ...p, status: 'rejected' } : p));
    const nextPending = proposals.find(p => p.id !== proposalId && p.status === 'pending');
    setSelectedProposalId(nextPending?.id ?? null);
  };

  const selectedProposal = proposals.find(p => p.id === selectedProposalId) ?? null;
  const isImageDrawing = selectedDrawing ? ['png', 'jpg', 'jpeg', 'webp', 'tiff'].includes(selectedDrawing.file_type?.toLowerCase() ?? '') : false;
  const pendingCount = proposals.filter(p => p.status === 'pending').length;
  const approvedCount = proposals.filter(p => p.status === 'approved').length;
  const rejectedCount = proposals.filter(p => p.status === 'rejected').length;

  const statusBadge = (status: Drawing['processing_status']) => {
    switch (status) {
      case 'completed': return <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded"><CheckCircle className="w-3 h-3" />Processed</span>;
      case 'processing': return <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded"><RefreshCw className="w-3 h-3 animate-spin" />Processing</span>;
      case 'failed': return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded"><XCircle className="w-3 h-3" />Failed</span>;
      default: return <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded"><Clock className="w-3 h-3" />Pending</span>;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Drawing Review</h2>
            <p className="text-sm text-slate-500">Upload drawings, extract devices with AI, then confirm each one</p>
          </div>
        </div>
        <button onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-lg hover:bg-cyan-700 transition-colors font-medium text-sm">
          <Upload className="w-4 h-4" />Upload Drawing
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.webp" multiple className="hidden"
          onChange={e => handleUpload(e.target.files)} />
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Processing unavailable</p>
            <p className="text-sm mt-0.5">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="ml-auto text-amber-500 hover:text-amber-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Main 3-pane layout */}
      <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 280px)' }}>

        {/* Pane 1: Drawing list */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">Drawings</p>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${dragOver ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
          >
            {uploading
              ? <div className="w-4 h-4 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto" />
              : <><Upload className="w-4 h-4 text-slate-400 mx-auto mb-1" /><p className="text-xs text-slate-400">Drop or click</p></>
            }
          </div>

          <div className="flex flex-col gap-1 overflow-y-auto">
            {drawings.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">No drawings yet</p>
            )}
            {drawings.map(drawing => (
              <div key={drawing.id}
                onClick={() => setSelectedDrawing(drawing)}
                className={`group relative rounded-lg px-3 py-2.5 cursor-pointer transition-colors border ${selectedDrawing?.id === drawing.id ? 'bg-cyan-50 border-cyan-300' : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
              >
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">{drawing.file_name}</p>
                    <div className="mt-1">{statusBadge(drawing.processing_status)}</div>
                  </div>
                </div>
                {/* Actions on hover */}
                <div className="absolute right-1.5 top-1.5 hidden group-hover:flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                  {drawing.processing_status !== 'processing' && (
                    <button onClick={() => handleProcess(drawing)} disabled={processing === drawing.id}
                      title="AI Extract"
                      className="p-1 bg-slate-900 text-white rounded hover:bg-slate-700 transition-colors disabled:opacity-50">
                      <Sparkles className="w-3 h-3" />
                    </button>
                  )}
                  <button onClick={() => handleDeleteDrawing(drawing.id)} title="Delete"
                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pane 2: Drawing viewer */}
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden min-w-0">
          {!selectedDrawing ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <ImageIcon className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium">No drawing selected</p>
              <p className="text-slate-400 text-sm mt-1">Select a drawing from the left panel, or upload a new one</p>
            </div>
          ) : (
            <>
              {/* Viewer header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <p className="text-sm font-medium text-slate-900 truncate">{selectedDrawing.file_name}</p>
                  {statusBadge(selectedDrawing.processing_status)}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {proposals.length > 0 && (
                    <div className="flex items-center gap-3 text-xs mr-2">
                      <span className="flex items-center gap-1 text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{pendingCount} pending</span>
                      <span className="flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{approvedCount} confirmed</span>
                      {rejectedCount > 0 && <span className="flex items-center gap-1 text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />{rejectedCount} rejected</span>}
                    </div>
                  )}
                  {selectedDrawing.processing_status !== 'processing' && (
                    <button onClick={() => handleProcess(selectedDrawing)} disabled={processing === selectedDrawing.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
                      <Sparkles className="w-3.5 h-3.5" />
                      {processing === selectedDrawing.id ? 'Extracting...' : proposals.length > 0 ? 'Re-extract' : 'AI Extract'}
                    </button>
                  )}
                </div>
              </div>

              {/* Drawing canvas */}
              <div className="flex-1 overflow-auto bg-slate-100 p-4">
                {selectedDrawing.processing_status === 'processing' ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 text-sm">AI is analysing the drawing...</p>
                  </div>
                ) : isImageDrawing ? (
                  <DrawingWithPins
                    drawing={selectedDrawing}
                    proposals={proposals}
                    selectedProposalId={selectedProposalId}
                    onSelectProposal={setSelectedProposalId}
                  />
                ) : (
                  <PdfViewer drawing={selectedDrawing} proposals={proposals} selectedProposalId={selectedProposalId} onSelectProposal={setSelectedProposalId} />
                )}
              </div>
            </>
          )}
        </div>

        {/* Pane 3: Review panel */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-3">
          {/* Proposal list */}
          <div className="bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden flex-1 min-h-0">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Extracted Devices
                {proposals.length > 0 && <span className="ml-2 font-normal text-slate-400 normal-case">{proposals.length} total</span>}
              </p>
            </div>
            {proposals.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <Cpu className="w-8 h-8 text-slate-200 mb-2" />
                <p className="text-sm text-slate-400">
                  {selectedDrawing
                    ? selectedDrawing.processing_status === 'completed'
                      ? 'No devices found'
                      : 'Run AI Extract to find devices'
                    : 'Select a drawing to begin'}
                </p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1">
                {proposals.map((p, i) => (
                  <ProposalListItem
                    key={p.id}
                    proposal={p}
                    index={i + 1}
                    isSelected={selectedProposalId === p.id}
                    onClick={() => setSelectedProposalId(selectedProposalId === p.id ? null : p.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Review form */}
          {selectedProposal && (
            <ReviewPanel
              key={selectedProposal.id}
              proposal={selectedProposal}
              productModels={productModels}
              confirming={confirming}
              onConfirm={edits => handleConfirm(selectedProposal, edits)}
              onReject={() => handleReject(selectedProposal.id)}
              onClose={() => setSelectedProposalId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PDF viewer — canvas renderer with pin overlay ───────────────────────────

function PdfViewer({ drawing, proposals, selectedProposalId, onSelectProposal }: {
  drawing: Drawing;
  proposals: DrawingProposal[];
  selectedProposalId: number | null;
  onSelectProposal: (id: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Holds the loaded PDF doc across renders — avoids re-fetching on zoom
  const pdfDocRef = useRef<any>(null);
  // The effective zoom at which the canvas was last rendered
  const renderedZoomRef = useRef(1);
  // Current CSS-only zoom (multiplied on top of renderedZoom)
  const cssZoomRef = useRef(1);
  const rerenderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [rerendering, setRerendering] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [numPages, setNumPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  // cssZoom drives the CSS transform; renderedZoom is baked into canvas pixels
  const [cssZoom, setCssZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });

  // ── Render one page at a given effective zoom ───────────────────────────────
  const renderPage = useCallback(async (pageNum: number, effectiveZoom: number, centerV = false) => {
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (!pdf || !canvas || !vp) return;

    const page = await pdf.getPage(pageNum);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const containerW = vp.clientWidth || 700;
    const baseVp = page.getViewport({ scale: 1 });
    const scale = (containerW / baseVp.width) * dpr * effectiveZoom;
    const pdfVp = page.getViewport({ scale });

    canvas.width = pdfVp.width;
    canvas.height = pdfVp.height;
    // CSS size so 1 CSS px = 1 rendered px / dpr (no extra CSS scaling)
    const cssW = pdfVp.width / dpr;
    const cssH = pdfVp.height / dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: pdfVp }).promise;

    renderedZoomRef.current = effectiveZoom;
    // Canvas is now the correct size — reset CSS zoom to 1 (pan is unchanged)
    cssZoomRef.current = 1;
    setCssZoom(1);
    if (centerV) {
      setPan({ x: 0, y: Math.max(0, (vp.clientHeight - cssH) / 2) });
    }
  }, []);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    pdfDocRef.current = null;
    renderedZoomRef.current = 1;
    cssZoomRef.current = 1;
    setCurrentPage(1);
    setCssZoom(1);
    setPan({ x: 0, y: 0 });
    setLoading(true);
    setFetchError(false);

    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

        const res = await fetch(drawing.file_url ?? '');
        if (!res.ok) throw new Error('fetch failed');
        const data = await res.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;

        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        await renderPage(1, 1, true);
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) { setFetchError(true); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [drawing.file_url, drawing.id, renderPage]);

  // ── Re-render when page changes ─────────────────────────────────────────────
  useEffect(() => {
    if (!pdfDocRef.current || loading) return;
    const effectiveZoom = renderedZoomRef.current * cssZoomRef.current;
    setRerendering(true);
    renderPage(currentPage, effectiveZoom, true).then(() => setRerendering(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, renderPage]);

  // ── Debounced re-render after zoom settles ──────────────────────────────────
  // When cssZoom != 1 the user has zoomed beyond the current render resolution.
  // After 350ms of inactivity we re-render at the new effective zoom, which
  // makes the canvas pixel-perfect again and resets cssZoom to 1.
  useEffect(() => {
    if (cssZoom === 1) return;
    if (rerenderTimer.current) clearTimeout(rerenderTimer.current);
    rerenderTimer.current = setTimeout(() => {
      const effectiveZoom = renderedZoomRef.current * cssZoomRef.current;
      setRerendering(true);
      renderPage(currentPage, effectiveZoom).then(() => setRerendering(false));
    }, 350);
    return () => { if (rerenderTimer.current) clearTimeout(rerenderTimer.current); };
  }, [cssZoom, currentPage, renderPage]);

  // ── Mouse wheel zoom toward cursor (non-passive) ────────────────────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const prevZ = cssZoomRef.current;
      const newZ = Math.max(0.25, Math.min(12, prevZ * factor));
      cssZoomRef.current = newZ;
      setCssZoom(newZ);
      // Keep the point under the cursor fixed
      setPan(prev => {
        const cx = (cursorX - prev.x) / prevZ;
        const cy = (cursorY - prev.y) / prevZ;
        return { x: cursorX - cx * newZ, y: cursorY - cy * newZ };
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // ── Drag to pan ─────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragOrigin.current = { mouseX: e.clientX, mouseY: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setPan({
        x: dragOrigin.current.panX + (e.clientX - dragOrigin.current.mouseX),
        y: dragOrigin.current.panY + (e.clientY - dragOrigin.current.mouseY),
      });
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const resetView = () => {
    cssZoomRef.current = 1;
    setCssZoom(1);
    const canvas = canvasRef.current;
    const vp = viewportRef.current;
    if (canvas && vp) {
      const cH = parseFloat(canvas.style.height || '0');
      setPan({ x: 0, y: Math.max(0, (vp.clientHeight - cH) / 2) });
    } else {
      setPan({ x: 0, y: 0 });
    }
    // Re-render at zoom=1 if we're far from it
    if (renderedZoomRef.current !== 1) {
      setRerendering(true);
      renderPage(currentPage, 1, true).then(() => setRerendering(false));
    }
  };

  const effectiveZoomPct = Math.round(renderedZoomRef.current * cssZoom * 100);

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-t-lg px-3 py-1.5 flex-shrink-0">
        {numPages > 1 && (
          <>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              className="text-xs px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors text-slate-600">← Prev</button>
            <span className="text-xs text-slate-500 font-medium px-1">Page {currentPage}/{numPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))} disabled={currentPage === numPages}
              className="text-xs px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors text-slate-600">Next →</button>
            <div className="w-px h-4 bg-slate-200 mx-1" />
          </>
        )}
        <button onClick={() => {
          const newZ = Math.min(12, cssZoomRef.current * 1.25);
          cssZoomRef.current = newZ; setCssZoom(newZ);
        }} className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-600 transition-colors font-bold text-base">+</button>
        <span className="text-xs text-slate-500 font-medium w-12 text-center">{effectiveZoomPct}%</span>
        <button onClick={() => {
          const newZ = Math.max(0.25, cssZoomRef.current / 1.25);
          cssZoomRef.current = newZ; setCssZoom(newZ);
        }} className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-600 transition-colors font-bold text-base">−</button>
        <button onClick={resetView} className="text-xs px-2 py-1 rounded hover:bg-slate-100 text-slate-500 transition-colors ml-1">Fit</button>
        <div className="flex-1" />
        {rerendering && <span className="text-xs text-slate-400 italic mr-2">Sharpening…</span>}
        <span className="text-xs text-slate-400 select-none">Scroll to zoom · Drag to pan</span>
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden bg-slate-300 rounded-b-lg cursor-grab active:cursor-grabbing select-none"
        style={{ minHeight: 480 }}
        onMouseDown={handleMouseDown}
      >
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 bg-slate-100">
            <div className="w-7 h-7 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Rendering PDF…</p>
          </div>
        )}
        {fetchError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <FileSearch className="w-10 h-10 text-slate-300" />
            <p className="text-slate-500 text-sm">Could not render PDF.</p>
            <a href={drawing.file_url ?? '#'} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors text-sm">
              <ExternalLink className="w-4 h-4" />Open in New Tab
            </a>
          </div>
        )}

        {/* Canvas + pins — translated and scaled */}
        <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${cssZoom})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0 }}>
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="block shadow-lg" />
            {!loading && !fetchError && proposals.map((p, i) => {
              const x = p.position_x ?? (10 + (i % 8) * 11);
              const y = p.position_y ?? (10 + Math.floor(i / 8) * 12);
              const isSelected = selectedProposalId === p.id;
              return (
                <button key={p.id}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => onSelectProposal(p.id)}
                  title={p.device_name ?? ''}
                  style={{ left: `${x}%`, top: `${y}%` }}
                  className={`absolute transform -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-150 ${isSelected ? 'scale-125' : 'hover:scale-110'}`}>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center font-bold shadow-md ${STATUS_COLOR[p.status]} ${isSelected ? `ring-2 ring-offset-1 ${STATUS_RING[p.status]}` : ''}`}
                    style={{ fontSize: 10 }}>{i + 1}</div>
                  {isSelected && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-7 bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg z-20 pointer-events-none">
                      {p.device_name ?? 'Device ' + (i + 1)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Drawing with overlaid pins ──────────────────────────────────────────────

function DrawingWithPins({ drawing, proposals, selectedProposalId, onSelectProposal }: {
  drawing: Drawing;
  proposals: DrawingProposal[];
  selectedProposalId: number | null;
  onSelectProposal: (id: number) => void;
}) {
  return (
    <div className="flex items-start justify-center">
      <div className="relative inline-block" style={{ maxWidth: '100%' }}>
        <img
          src={drawing.file_url ?? ''}
          alt={drawing.file_name ?? ''}
          className="block max-w-full h-auto rounded shadow"
          draggable={false}
        />
        {proposals.map((p, i) => {
          const x = p.position_x ?? (10 + (i % 8) * 11);
          const y = p.position_y ?? (10 + Math.floor(i / 8) * 12);
          const isSelected = selectedProposalId === p.id;
          const status = p.status;
          return (
            <button
              key={p.id}
              onClick={() => onSelectProposal(p.id)}
              title={p.device_name ?? ''}
              style={{ left: `${x}%`, top: `${y}%` }}
              className={`absolute transform -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-150 ${isSelected ? 'scale-125' : 'hover:scale-110'}`}
            >
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold shadow-md
                ${STATUS_COLOR[status]}
                ${isSelected ? `ring-2 ring-offset-1 ${STATUS_RING[status]}` : ''}
              `}>
                {i + 1}
              </div>
              {isSelected && (
                <div className="absolute left-1/2 -translate-x-1/2 top-7 bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg z-20 pointer-events-none">
                  {p.device_name ?? 'Device ' + (i + 1)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Proposal list item ───────────────────────────────────────────────────────

function ProposalListItem({ proposal, index, isSelected, onClick }: {
  proposal: DrawingProposal;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const confidencePct = Math.round((proposal.confidence ?? 0.8) * 100);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b border-slate-100 last:border-0 ${isSelected ? 'bg-cyan-50' : 'hover:bg-slate-50'}`}
    >
      <div className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs font-bold ${STATUS_COLOR[proposal.status]}`}>
        {index}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-900 truncate">{proposal.device_name ?? 'Unnamed'}</p>
          <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
            proposal.status === 'approved' ? 'bg-green-100 text-green-700' :
            proposal.status === 'rejected' ? 'bg-slate-100 text-slate-500' :
            'bg-amber-100 text-amber-700'
          }`}>{proposal.status}</span>
        </div>
        <p className="text-xs text-slate-400 truncate mt-0.5">
          {proposal.device_type ?? 'Unknown type'}
          {proposal.location && <> · {proposal.location}</>}
        </p>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        <div className="w-10 bg-slate-200 rounded-full h-1">
          <div className="bg-cyan-500 h-1 rounded-full" style={{ width: `${confidencePct}%` }} />
        </div>
        <span className="text-xs text-slate-400">{confidencePct}%</span>
      </div>
    </button>
  );
}

// ─── Review panel ─────────────────────────────────────────────────────────────

interface ProposalEdits {
  name: string;
  systemType: string;
  deviceType: string;
  manufacturer: string;
  modelNumber: string;
  linkedModelId: number | null;
}

function ReviewPanel({ proposal, productModels, confirming, onConfirm, onReject, onClose }: {
  proposal: DrawingProposal;
  productModels: ProductModel[];
  confirming: boolean;
  onConfirm: (edits: ProposalEdits) => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(proposal.device_name ?? '');
  const [systemType, setSystemType] = useState(proposal.system_type ?? '');
  const [deviceType, setDeviceType] = useState(proposal.device_type ?? '');
  const [manufacturer, setManufacturer] = useState(proposal.manufacturer ?? '');
  const [modelNumber, setModelNumber] = useState(proposal.model_number ?? '');
  const [linkedModel, setLinkedModel] = useState<ProductModel | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const isReviewed = proposal.status !== 'pending';
  const confidencePct = Math.round((proposal.confidence ?? 0.8) * 100);
  const confidenceColor = confidencePct >= 80 ? 'text-green-600 bg-green-50' : confidencePct >= 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pickerResults = useMemo(() => {
    const q = pickerSearch.toLowerCase();
    if (!q) return productModels.slice(0, 30);
    return productModels.filter(pm =>
      pm.manufacturer?.toLowerCase().includes(q) ||
      pm.model_number?.toLowerCase().includes(q) ||
      pm.model_name?.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [productModels, pickerSearch]);

  const handleLinkModel = (pm: ProductModel) => {
    setLinkedModel(pm);
    setManufacturer(pm.manufacturer ?? '');
    setModelNumber(pm.model_number ?? '');
    if (pm.device_type) setDeviceType(pm.device_type);
    setPickerOpen(false);
    setPickerSearch('');
  };

  const ic = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 bg-white';

  return (
    <div className="bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Edit2 className="w-4 h-4 text-slate-500" />
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Review Device</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${confidenceColor}`}>{confidencePct}% confidence</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3 overflow-y-auto max-h-96">
        {isReviewed && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${proposal.status === 'approved' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
            {proposal.status === 'approved' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {proposal.status === 'approved' ? 'Confirmed — added to device schedule' : 'Rejected — not added to device schedule'}
          </div>
        )}

        {/* Reference name */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Reference / Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className={ic} placeholder="e.g. CAM-01" disabled={isReviewed} />
        </div>

        {/* System + device type */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">System</label>
            <select value={systemType} onChange={e => setSystemType(e.target.value)} className={ic} disabled={isReviewed}>
              <option value="">Select...</option>
              {SYSTEM_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Device Type</label>
            <select value={deviceType} onChange={e => setDeviceType(e.target.value)} className={ic} disabled={isReviewed}>
              <option value="">Select...</option>
              {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Product model picker */}
        {!isReviewed && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Product Model</label>
            {linkedModel ? (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-green-900 truncate">{linkedModel.model_name || linkedModel.model_number}</p>
                  <p className="text-xs text-green-700">{linkedModel.manufacturer}</p>
                </div>
                <button onClick={() => setLinkedModel(null)} className="text-green-500 hover:text-green-700 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <div ref={pickerRef} className="relative">
                <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 hover:border-cyan-400 transition-colors">
                  <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <input
                    value={pickerSearch}
                    onChange={e => { setPickerSearch(e.target.value); setPickerOpen(true); }}
                    onFocus={() => setPickerOpen(true)}
                    placeholder="Search product library..."
                    className="flex-1 text-sm outline-none bg-transparent text-slate-900 placeholder-slate-400"
                  />
                </div>
                {pickerOpen && (
                  <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                      {pickerResults.length === 0
                        ? <p className="text-xs text-slate-400 text-center py-3">No matches</p>
                        : pickerResults.map(pm => (
                          <button key={pm.id} type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => handleLinkModel(pm)}
                            className="w-full text-left px-3 py-2 hover:bg-cyan-50 transition-colors">
                            <p className="text-xs font-medium text-slate-900">{pm.model_name || pm.model_number}</p>
                            <p className="text-xs text-slate-500">{pm.manufacturer} · <span className="font-mono">{pm.model_number}</span></p>
                          </button>
                        ))
                      }
                    </div>
                    <button onClick={() => { setLinkedModel(null); setPickerOpen(false); setPickerSearch(''); }}
                      className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 border-t border-slate-100">
                      Manual / Not Listed
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Manual manufacturer / model */}
        {!linkedModel && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Manufacturer</label>
              <input value={manufacturer} onChange={e => setManufacturer(e.target.value)} className={ic} placeholder="e.g. Axis" disabled={isReviewed} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Model</label>
              <input value={modelNumber} onChange={e => setModelNumber(e.target.value)} className={ic} placeholder="e.g. P3245" disabled={isReviewed} />
            </div>
          </div>
        )}

        {proposal.location && (
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />{proposal.location}
          </div>
        )}
      </div>

      {/* Actions */}
      {!isReviewed && (
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex gap-2">
          <button onClick={onReject}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors">
            <XCircle className="w-4 h-4" />Reject
          </button>
          <button
            onClick={() => onConfirm({ name, systemType, deviceType, manufacturer: linkedModel?.manufacturer ?? manufacturer, modelNumber: linkedModel?.model_number ?? modelNumber, linkedModelId: linkedModel?.id ?? null })}
            disabled={confirming}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            <CheckCircle className="w-4 h-4" />{confirming ? 'Adding...' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  );
}
