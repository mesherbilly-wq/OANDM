import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Upload, FileText, X, Plus, ExternalLink, Pencil, Check, Loader2,
  ImageIcon, Hash, RefreshCw, AlertCircle, FileType,
} from 'lucide-react';

const DRAWING_TYPES = [
  'General Arrangement',
  'Floor Plan Layout',
  'CCTV Layout',
  'Access Control Layout',
  'Intruder Alarm Layout',
  'Network Topology',
  'Schematic Diagram',
  'Cable Schedule',
  'Equipment Layout',
  'Riser Diagram',
  'Other',
];

interface AsBuiltDrawing {
  id: number;
  project_id: number;
  title: string;
  drawing_number: string | null;
  revision: string | null;
  drawing_type: string | null;
  notes: string | null;
  file_name: string;
  file_url: string;
  file_size: number | null;
  created_at: string;
}

interface EditState {
  title: string;
  drawing_number: string;
  revision: string;
  drawing_type: string;
  notes: string;
}

interface PendingUpload {
  file: File;
  title: string;
  drawing_type: string;
  drawing_number: string;
  revision: string;
  notes: string;
}

const ic = 'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white text-slate-900';

export default function AsBuiltDrawingsPage() {
  const { id } = useParams<{ id: string }>();
  const pid = id ? parseInt(id) : null;

  const [drawings, setDrawings] = useState<AsBuiltDrawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>({ title: '', drawing_number: '', revision: '', drawing_type: '', notes: '' });

  const [previewId, setPreviewId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Upload modal state
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!pid) return;
    const { data } = await supabase
      .from('as_fitted_drawings')
      .select('*')
      .eq('project_id', pid)
      .order('created_at', { ascending: false });
    setDrawings(data ?? []);
    setLoading(false);
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const openUploadModal = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setUploadError('Only PDF files are accepted');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setUploadError('File must be under 100 MB');
      return;
    }
    setUploadError(null);
    const baseName = file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
    setPendingUpload({
      file,
      title: baseName,
      drawing_type: '',
      drawing_number: '',
      revision: '',
      notes: '',
    });
  };

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length > 0) openUploadModal(arr[0]); // one at a time via modal
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [pid]);

  const confirmUpload = async () => {
    if (!pid || !pendingUpload) return;
    const { file, title, drawing_type, drawing_number, revision, notes } = pendingUpload;
    setUploading(true);
    setUploadError(null);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `as-fitted/${pid}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('om-uploads')
        .upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from('om-uploads').getPublicUrl(path);

      const { error: dbErr } = await supabase.from('as_fitted_drawings').insert({
        project_id: pid,
        title: title.trim() || file.name,
        drawing_type: drawing_type || null,
        drawing_number: drawing_number.trim() || null,
        revision: revision.trim() || null,
        notes: notes.trim() || null,
        file_name: file.name,
        file_url: publicUrl,
        file_size: file.size,
      });
      if (dbErr) throw dbErr;
      setPendingUpload(null);
      await load();
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (d: AsBuiltDrawing) => {
    setEditingId(d.id);
    setEditState({
      title: d.title,
      drawing_number: d.drawing_number ?? '',
      revision: d.revision ?? '',
      drawing_type: d.drawing_type ?? '',
      notes: d.notes ?? '',
    });
  };

  const saveEdit = async (id: number) => {
    await supabase.from('as_fitted_drawings').update({
      title: editState.title,
      drawing_number: editState.drawing_number || null,
      revision: editState.revision || null,
      drawing_type: editState.drawing_type || null,
      notes: editState.notes || null,
    }).eq('id', id);
    setEditingId(null);
    await load();
  };

  const remove = async (d: AsBuiltDrawing) => {
    if (!window.confirm(`Delete "${d.title || d.file_name}"?`)) return;
    try {
      const url = new URL(d.file_url);
      const storagePath = decodeURIComponent(url.pathname).split('/om-uploads/')[1];
      if (storagePath) await supabase.storage.from('om-uploads').remove([storagePath]);
    } catch { /* ignore storage errors */ }
    await supabase.from('as_fitted_drawings').delete().eq('id', d.id);
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">As Fitted Drawings</h2>
          <p className="text-sm text-slate-500 mt-0.5">Upload final installation drawings. These appear full-size in the O&M pack.</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-xl hover:bg-cyan-700 transition-colors text-sm font-medium shadow-sm"
        >
          <Plus className="w-4 h-4" />Add Drawing
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all mb-6 ${
          dragOver ? 'border-cyan-400 bg-cyan-50' : 'border-slate-300 hover:border-cyan-400 hover:bg-cyan-50'
        }`}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,application/pdf"
          className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
        <Upload className={`w-8 h-8 mx-auto mb-2 transition-colors ${dragOver ? 'text-cyan-500' : 'text-slate-300'}`} />
        <p className="text-sm font-medium text-slate-500">Drop a PDF drawing here or click to browse</p>
        <p className="text-xs text-slate-400 mt-1">PDF format · Max 100 MB</p>
      </div>

      {uploadError && !pendingUpload && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{uploadError}
          <button onClick={() => setUploadError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Drawings list */}
      {drawings.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <ImageIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No drawings uploaded yet</p>
          <p className="text-xs text-slate-400 mt-1">Upload as-fitted PDFs to include them in the O&M pack</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100 bg-slate-50">
            <ImageIcon className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">{drawings.length} drawing{drawings.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {drawings.map(d => (
              <div key={d.id}>
                {editingId === d.id ? (
                  <div className="px-6 py-4 bg-slate-50 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Drawing Title <span className="text-red-500">*</span></label>
                        <input value={editState.title} onChange={e => setEditState(s => ({ ...s, title: e.target.value }))} className={ic} placeholder="e.g. Ground Floor CCTV Layout" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Drawing Type</label>
                        <select value={editState.drawing_type} onChange={e => setEditState(s => ({ ...s, drawing_type: e.target.value }))} className={ic}>
                          <option value="">Select type…</option>
                          {DRAWING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Drawing No.</label>
                        <input value={editState.drawing_number} onChange={e => setEditState(s => ({ ...s, drawing_number: e.target.value }))} className={ic} placeholder="e.g. DWG-001" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Revision</label>
                        <input value={editState.revision} onChange={e => setEditState(s => ({ ...s, revision: e.target.value }))} className={ic} placeholder="e.g. Rev A" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                        <input value={editState.notes} onChange={e => setEditState(s => ({ ...s, notes: e.target.value }))} className={ic} placeholder="Optional notes" />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
                      <button onClick={() => saveEdit(d.id)} className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                      <div className="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-red-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{d.title || d.file_name}</p>
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-0.5">
                          {d.drawing_type && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              <FileType className="w-3 h-3" />{d.drawing_type}
                            </span>
                          )}
                          {d.drawing_number && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                              <Hash className="w-3 h-3" />{d.drawing_number}
                            </span>
                          )}
                          {d.revision && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                              <RefreshCw className="w-3 h-3" />{d.revision}
                            </span>
                          )}
                          {d.notes && <span className="text-xs text-slate-400 truncate max-w-xs">{d.notes}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => setPreviewId(previewId === d.id ? null : d.id)}
                          className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${previewId === d.id ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                          {previewId === d.id ? <X className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                          {previewId === d.id ? 'Close' : 'Preview'}
                        </button>
                        <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs px-2 py-1 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />Open
                        </a>
                        <button onClick={() => startEdit(d)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => remove(d)}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {previewId === d.id && (
                      <div className="border-t border-slate-100 bg-slate-100 px-6 py-4">
                        <iframe src={d.file_url} title={d.title || d.file_name}
                          className="w-full rounded-lg shadow border border-slate-200" style={{ height: '1050px' }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Upload modal ── */}
      {pendingUpload && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Add Drawing</h2>
                <p className="text-xs text-slate-400 mt-0.5 font-mono truncate max-w-xs">{pendingUpload.file.name}</p>
              </div>
              <button onClick={() => { setPendingUpload(null); setUploadError(null); }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {uploadError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />{uploadError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Drawing Title <span className="text-red-500">*</span></label>
                <input value={pendingUpload.title}
                  onChange={e => setPendingUpload(p => p ? { ...p, title: e.target.value } : p)}
                  className={ic} placeholder="e.g. Ground Floor CCTV Layout" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Drawing Type</label>
                  <select value={pendingUpload.drawing_type}
                    onChange={e => setPendingUpload(p => p ? { ...p, drawing_type: e.target.value } : p)}
                    className={ic}>
                    <option value="">Select type…</option>
                    {DRAWING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Drawing No.</label>
                  <input value={pendingUpload.drawing_number}
                    onChange={e => setPendingUpload(p => p ? { ...p, drawing_number: e.target.value } : p)}
                    className={ic} placeholder="e.g. DWG-001" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Revision</label>
                  <input value={pendingUpload.revision}
                    onChange={e => setPendingUpload(p => p ? { ...p, revision: e.target.value } : p)}
                    className={ic} placeholder="e.g. Rev A" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notes</label>
                <textarea value={pendingUpload.notes}
                  onChange={e => setPendingUpload(p => p ? { ...p, notes: e.target.value } : p)}
                  rows={2} className={`${ic} resize-none`} placeholder="Optional description or notes about this drawing" />
              </div>
            </div>
            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => { setPendingUpload(null); setUploadError(null); }}
                className="px-4 py-2 text-slate-600 font-medium text-sm hover:text-slate-800 transition-colors">
                Cancel
              </button>
              <button onClick={confirmUpload} disabled={uploading || !pendingUpload.title.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" />Uploading…</> : <><Upload className="w-4 h-4" />Upload Drawing</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
