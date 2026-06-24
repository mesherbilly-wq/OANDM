import React, { useRef, useState } from 'react';
import { X, Upload, CheckCircle, AlertCircle, FileText, Info, Search, Link, ExternalLink, Loader2, Download, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Datasheet } from '../types';

interface Props {
  manufacturer: string;
  modelNumber: string;
  onClose: () => void;
  onUploaded: (datasheet: Datasheet) => void;
}

type Mode = 'search' | 'upload' | 'link';

interface Candidate {
  url: string;
  title: string;
  domain: string;
  verified: boolean;
}

const ic = 'w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 bg-white text-sm';

export function UploadDatasheetModal({ manufacturer, modelNumber, onClose, onUploaded }: Props) {
  const [mfr, setMfr] = useState(manufacturer);
  const [model, setModel] = useState(modelNumber);
  const [mode, setMode] = useState<Mode>('search');

  // Search state
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null); // url being attached
  const [attachError, setAttachError] = useState<string | null>(null);

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Search ──────────────────────────────────────────────────────────────────

  const handleSearch = async () => {
    if (!mfr.trim() || !model.trim()) {
      setSearchError('Enter manufacturer and model number first');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setCandidates(null);
    setAttachError(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('find-datasheet', {
        body: { manufacturer: mfr.trim(), model: model.trim() },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      setCandidates(data?.candidates ?? []);
    } catch (e: any) {
      setSearchError(e.message ?? 'Search failed — try uploading a PDF or pasting a URL instead');
    } finally {
      setSearching(false);
    }
  };

  const handleAttach = async (candidate: Candidate) => {
    setAttaching(candidate.url);
    setAttachError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('fetch-datasheet', {
        body: { url: candidate.url, manufacturer: mfr.trim(), model: model.trim() },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      onUploaded(data.datasheet as Datasheet);
    } catch (e: any) {
      setAttachError(candidate.url + '::' + (e.message ?? 'Failed to download PDF'));
    } finally {
      setAttaching(null);
    }
  };

  // ── Upload / Link ───────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfr.trim() || !model.trim()) { setError('Manufacturer and model number are required'); return; }
    if (mode === 'upload' && !file) { setError('Please select a PDF file'); return; }
    if (mode === 'link' && !linkUrl.trim()) { setError('Please enter a PDF URL'); return; }

    setSaving(true);
    setError(null);

    let publicUrl: string;
    let fileName: string;

    if (mode === 'upload') {
      const safeName = file!.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${mfr.trim().toLowerCase().replace(/\s+/g, '-')}_${model.trim().replace(/\s+/g, '-')}_${Date.now()}_${safeName}`;
      const { data: storageData, error: storageErr } = await supabase.storage
        .from('user-datasheets')
        .upload(path, file!, { contentType: 'application/pdf', upsert: false });
      if (storageErr) { setError(`Upload failed: ${storageErr.message}`); setSaving(false); return; }
      const { data: urlData } = supabase.storage.from('user-datasheets').getPublicUrl(storageData.path);
      publicUrl = urlData.publicUrl;
      fileName = file!.name;
    } else {
      publicUrl = linkUrl.trim();
      fileName = `${mfr.trim()}_${model.trim()}_datasheet.pdf`;
    }

    const { data: existing } = await supabase
      .from('datasheets').select('id')
      .ilike('manufacturer', mfr.trim()).ilike('model_number', model.trim())
      .maybeSingle();

    let datasheet: Datasheet | null = null;
    if (existing) {
      const { data } = await supabase.from('datasheets')
        .update({ datasheet_url: publicUrl, file_name: fileName })
        .eq('id', existing.id).select().single();
      datasheet = data;
    } else {
      const { data } = await supabase.from('datasheets')
        .insert({ manufacturer: mfr.trim(), model_number: model.trim(), file_name: fileName, datasheet_url: publicUrl })
        .select().single();
      datasheet = data;
    }

    if (!datasheet) { setError('Failed to save datasheet record'); setSaving(false); return; }

    await supabase.from('devices').update({ datasheet_found: true })
      .filter('manufacturer', 'ilike', mfr.trim())
      .filter('model_number', 'ilike', model.trim());

    onUploaded(datasheet);
  };

  const tabs: { key: Mode; label: string; icon: React.ReactNode }[] = [
    { key: 'search', label: 'Auto-Find', icon: <Search className="w-3.5 h-3.5" /> },
    { key: 'upload', label: 'Upload PDF', icon: <Upload className="w-3.5 h-3.5" /> },
    { key: 'link',   label: 'Paste URL', icon: <Link className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Add Datasheet</h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              {(mfr || manufacturer)} · {(model || modelNumber)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="p-6 space-y-5">

            {/* Manufacturer / Model */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Manufacturer <span className="text-red-500">*</span></label>
                <input value={mfr} onChange={e => setMfr(e.target.value)} className={ic} placeholder="e.g. Axis" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Model Number <span className="text-red-500">*</span></label>
                <input value={model} onChange={e => setModel(e.target.value)} className={ic} placeholder="e.g. P3245-LVE" />
              </div>
            </div>

            {/* Mode tabs */}
            <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
              {tabs.map(t => (
                <button key={t.key} type="button"
                  onClick={() => { setMode(t.key); setError(null); setSearchError(null); setAttachError(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                    mode === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            {/* ── SEARCH TAB ── */}
            {mode === 'search' && (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors"
                >
                  {searching ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Searching for datasheet PDF…</>
                  ) : (
                    <><Search className="w-4 h-4" />Find Datasheet Automatically</>
                  )}
                </button>

                {searchError && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Search failed</p>
                      <p className="text-xs mt-0.5 text-red-600">{searchError}</p>
                    </div>
                  </div>
                )}

                {candidates !== null && candidates.length === 0 && !searching && (
                  <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-200">
                    <Search className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-600">No results found</p>
                    <p className="text-xs text-slate-400 mt-1">Try the Upload or Paste URL tabs, or search Google manually.</p>
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(`${mfr} ${model} datasheet filetype:pdf`)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />Search Google for PDF
                    </a>
                  </div>
                )}

                {candidates && candidates.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {candidates.length} result{candidates.length !== 1 ? 's' : ''} found — select one to auto-attach
                    </p>
                    {candidates.map((c, i) => {
                      const isAttaching = attaching === c.url;
                      const errKey = c.url + '::';
                      const thisError = attachError?.startsWith(errKey) ? attachError.slice(errKey.length) : null;
                      return (
                        <div key={i} className={`border rounded-xl p-4 transition-all ${
                          thisError ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}>
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                              c.verified ? 'bg-green-100' : 'bg-slate-100'
                            }`}>
                              <FileText className={`w-4 h-4 ${c.verified ? 'text-green-600' : 'text-slate-400'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 leading-snug">{c.title}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-slate-500 truncate max-w-[180px]">{c.domain}</span>
                                {c.verified && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                                    <ShieldCheck className="w-3 h-3" />Verified
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 truncate mt-0.5">{c.url}</p>
                              {thisError && <p className="text-xs text-red-600 mt-1">{thisError}</p>}
                            </div>
                            <div className="flex flex-col gap-1.5 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => handleAttach(c)}
                                disabled={!!attaching}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors"
                              >
                                {isAttaching ? (
                                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />Attaching…</>
                                ) : (
                                  <><Download className="w-3.5 h-3.5" />Attach</>
                                )}
                              </button>
                              <a href={c.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-colors">
                                <ExternalLink className="w-3 h-3" />Preview
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {candidates === null && !searching && (
                  <div className="text-center py-5 text-slate-400 text-xs">
                    Click the button above to search for a datasheet PDF automatically.
                  </div>
                )}
              </div>
            )}

            {/* ── UPLOAD TAB ── */}
            {mode === 'upload' && (
              <form id="ds-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}
                <div>
                  {file ? (
                    <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                      <FileText className="w-5 h-5 text-green-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-green-900 truncate">{file.name}</p>
                        <p className="text-xs text-green-700">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <button type="button" onClick={() => setFile(null)} className="text-green-600 hover:text-green-800">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type === 'application/pdf') setFile(f); else setError('Only PDF files are accepted'); }}
                      className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-cyan-400 hover:bg-cyan-50 transition-all"
                    >
                      <Upload className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-medium text-slate-600">Click to select or drop a PDF here</p>
                      <p className="text-xs text-slate-400 mt-1">PDF only · up to 50 MB</p>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
                </div>
              </form>
            )}

            {/* ── LINK TAB ── */}
            {mode === 'link' && (
              <form id="ds-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Direct PDF URL <span className="text-red-500">*</span></label>
                  <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
                    className={ic} placeholder="https://example.com/product-datasheet.pdf" />
                  <p className="text-xs text-slate-400 mt-1.5">Paste a direct link to a PDF from the manufacturer's website.</p>
                  {linkUrl && (
                    <a href={linkUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-2 text-xs text-cyan-600 hover:text-cyan-700 font-medium">
                      <ExternalLink className="w-3 h-3" />Preview link
                    </a>
                  )}
                </div>
              </form>
            )}

            {/* Library note */}
            {mode !== 'search' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex gap-2.5">
                <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800">
                  Saved to the product library — automatically matched to all existing and future devices with this manufacturer and model.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer — only for upload/link modes */}
        {mode !== 'search' && (
          <div className="p-6 pt-0 flex justify-end gap-3 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm transition-colors">
              Cancel
            </button>
            <button
              form="ds-form"
              type="submit"
              disabled={saving || (mode === 'upload' ? !file : !linkUrl.trim())}
              className="inline-flex items-center gap-2 px-5 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
              ) : mode === 'upload' ? (
                <><Upload className="w-4 h-4" />Upload & Save</>
              ) : (
                <><CheckCircle className="w-4 h-4" />Save Link</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
