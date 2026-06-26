import React, { useCallback, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  X, Upload, Sparkles, Loader2, AlertCircle, CheckCircle,
  ChevronDown, ChevronUp, FileText, MapPin, Tag, Package,
  Minus, Plus, Check, FileSearch,
} from 'lucide-react';
import type { SystemType } from '../types';
import { getDevicePrefix } from '../lib/deviceLabel';
import { ensureProjectSystem } from '../lib/projectSystemsDb';

interface ExtractedDevice {
  system_type: string;
  device_type: string;
  manufacturer: string | null;
  model_number: string | null;
  quantity: number;
  location: string | null;
  notes: string | null;
  confidence: number;
}

interface SelectableDevice extends ExtractedDevice {
  key: string;
  selected: boolean;
  importQty: number;
}

const SYSTEM_COLORS: Record<string, string> = {
  'CCTV':           'bg-blue-100 text-blue-700 border-blue-200',
  'Access Control': 'bg-green-100 text-green-700 border-green-200',
  'Intercom':       'bg-purple-100 text-purple-700 border-purple-200',
  'Intruder':       'bg-red-100 text-red-700 border-red-200',
  'Networking':     'bg-amber-100 text-amber-700 border-amber-200',
};

type Stage = 'upload' | 'processing' | 'results' | 'importing';



export function AIImportModal({
  projectId,
  systemType,
  onClose,
  onImported,
}: {
  projectId: number;
  systemType: SystemType;
  onClose: () => void;
  onImported: () => void;
}) {
  const [stage, setStage] = useState<Stage>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [devices, setDevices] = useState<SelectableDevice[]>([]);
  const [showOther, setShowOther] = useState(false);
  const [sourceFileUrl, setSourceFileUrl] = useState<string | null>(null);
  const [sourceMediaType, setSourceMediaType] = useState<string>('application/pdf');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const matchingCount = devices.filter(d => d.system_type === systemType && d.selected).length;
  const totalSelected = devices.filter(d => d.selected).length;

  const processFile = async (file: File) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF or image file (PNG, JPEG, WebP)');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('File must be under 50 MB');
      return;
    }

    setError(null);
    setFileName(file.name);
    setStage('processing');

    try {
      // Upload to storage
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `ai-imports/${projectId}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('om-uploads')
        .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
      if (upErr) throw new Error('Upload failed: ' + upErr.message);

      const { data: { publicUrl } } = supabase.storage.from('om-uploads').getPublicUrl(path);

      // Remember the source file for scope regeneration
      setSourceFileUrl(publicUrl);
      setSourceMediaType(file.type || 'application/pdf');

      // Call extraction function
      const { data, error: fnErr } = await supabase.functions.invoke('extract-drawing', {
        body: { file_url: publicUrl, media_type: file.type || 'application/pdf' },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);

      const extracted: ExtractedDevice[] = data?.devices ?? [];

      if (extracted.length === 0) {
        setError('No devices were found in this document. Try a drawing, schedule, or specification sheet.');
        setStage('upload');
        return;
      }

      // Build selectable list — pre-select matching system type
      const selectable: SelectableDevice[] = extracted.map((d, i) => ({
        ...d,
        key: `${i}_${d.system_type}_${d.device_type}`,
        selected: d.system_type === systemType,
        importQty: Math.max(1, d.quantity ?? 1),
      }));

      setDevices(selectable);
      setStage('results');
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong');
      setStage('upload');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [projectId, systemType]);

  const toggleDevice = (key: string) =>
    setDevices(prev => prev.map(d => d.key === key ? { ...d, selected: !d.selected } : d));

  const setQty = (key: string, qty: number) =>
    setDevices(prev => prev.map(d => d.key === key ? { ...d, importQty: Math.max(1, qty) } : d));

  const handleImport = async () => {
    const toImport = devices.filter(d => d.selected);
    if (toImport.length === 0) return;

    setStage('importing');

    // Fetch existing device names so we continue the label sequence
    const { data: existingDevices } = await supabase
      .from('devices')
      .select('device_name')
      .eq('project_id', projectId);

    const prefixCounters: Record<string, number> = {};
    for (const d of existingDevices ?? []) {
      const m = d.device_name?.match(/^([A-Z]+)-(\d+)$/);
      if (m) {
        const n = parseInt(m[2]);
        if (!prefixCounters[m[1]] || n > prefixCounters[m[1]]) prefixCounters[m[1]] = n;
      }
    }

    const systemIdByName = new Map<string, number>();
    for (const name of [...new Set(toImport.map(d => d.system_type.trim() || 'Unnamed System'))]) {
      const systemId = await ensureProjectSystem(projectId, name, null, 'ai');
      systemIdByName.set(name, systemId);
    }

    const rows: object[] = [];
    for (const d of toImport) {
      const systemName = d.system_type.trim() || 'Unnamed System';
      const prefix = getDevicePrefix(d.system_type, d.device_type);
      for (let i = 0; i < d.importQty; i++) {
        prefixCounters[prefix] = (prefixCounters[prefix] ?? 0) + 1;
        rows.push({
          project_id: projectId,
          project_system_id: systemIdByName.get(systemName) ?? null,
          system_type: d.system_type,
          device_type: d.device_type,
          manufacturer: d.manufacturer,
          model_number: d.model_number,
          location: d.location,
          notes: d.notes,
          device_name: `${prefix}-${String(prefixCounters[prefix]).padStart(3, '0')}`,
          status: 'pending_review',
          ai_confidence: d.confidence,
        });
      }
    }

    const { error: dbErr } = await supabase.from('devices').insert(rows);
    if (dbErr) {
      setError('Failed to save devices: ' + dbErr.message);
      setStage('results');
      return;
    }

    // Save source document reference so scope regeneration can re-process this file
    if (sourceFileUrl) {
      const systemsImported = [...new Set(toImport.map(d => d.system_type))];
      await supabase.from('project_source_docs').insert(
        systemsImported.map(sys => ({
          project_id: projectId,
          system_type: sys,
          file_name: fileName,
          file_url: sourceFileUrl,
          media_type: sourceMediaType,
        }))
      );
    }

    onImported();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const thisSystemDevices = devices.filter(d => d.system_type === systemType);
  const otherDevices = devices.filter(d => d.system_type !== systemType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-md flex-shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-900">AI Document Import</h2>
            <p className="text-xs text-slate-400 truncate">
              {stage === 'results'
                ? `Extracted from "${fileName}"`
                : `Import devices for ${systemType} from a drawing or specification`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Upload stage ─────────────────────────────────────────────── */}
          {(stage === 'upload') && (
            <div className="p-6 space-y-4">
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{error}
                </div>
              )}

              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${dragOver ? 'border-violet-400 bg-violet-50' : 'border-slate-300 hover:border-violet-400 hover:bg-violet-50'}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }}
                />
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-colors ${dragOver ? 'bg-violet-100' : 'bg-slate-100'}`}>
                  <FileSearch className={`w-7 h-7 transition-colors ${dragOver ? 'text-violet-500' : 'text-slate-400'}`} />
                </div>
                <p className="text-sm font-semibold text-slate-700 mb-1">Drop a document to analyse</p>
                <p className="text-xs text-slate-400">PDF drawings, quotes, schedules, specs · PNG / JPEG images · Max 50 MB</p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1.5">
                <p className="font-medium text-slate-600">What works well</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Security system drawings &amp; floor plans</li>
                  <li>Device schedules and equipment lists</li>
                  <li>Installation quotes and specifications</li>
                  <li>Scanned survey notes or scope documents</li>
                </ul>
              </div>
            </div>
          )}

          {/* ── Processing stage ─────────────────────────────────────────── */}
          {stage === 'processing' && (
            <div className="flex flex-col items-center justify-center py-20 px-6 gap-5">
              <div className="relative">
                <div className="w-16 h-16 bg-gradient-to-br from-violet-100 to-purple-100 rounded-2xl flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-violet-500" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-md">
                  <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-800 mb-1">Analysing document…</p>
                <p className="text-xs text-slate-400">Claude is reading "{fileName}"</p>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          )}

          {/* ── Results stage ────────────────────────────────────────────── */}
          {(stage === 'results' || stage === 'importing') && (
            <div className="divide-y divide-slate-100">

              {/* Summary bar */}
              <div className="px-6 py-3 bg-slate-50 flex items-center gap-3 text-xs text-slate-500">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span>
                  <strong className="text-slate-800">{devices.length}</strong> devices extracted —
                  <strong className="text-slate-800"> {totalSelected}</strong> selected for import
                  {matchingCount < totalSelected && (
                    <span className="ml-1 text-amber-600">({totalSelected - matchingCount} from other system types)</span>
                  )}
                </span>
                <button
                  onClick={() => setDevices(prev => prev.map(d => ({ ...d, selected: d.system_type === systemType })))}
                  className="ml-auto text-violet-600 hover:underline font-medium"
                >
                  Reset selection
                </button>
              </div>

              {/* Devices matching this system */}
              {thisSystemDevices.length > 0 && (
                <>
                  <div className="px-6 py-2 bg-slate-50">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{systemType} devices ({thisSystemDevices.length})</span>
                  </div>
                  {thisSystemDevices.map(d => (
                    <DeviceRow key={d.key} device={d} onToggle={toggleDevice} onQty={setQty} disabled={stage === 'importing'} />
                  ))}
                </>
              )}

              {/* Other system devices */}
              {otherDevices.length > 0 && (
                <>
                  <button
                    onClick={() => setShowOther(p => !p)}
                    className="w-full px-6 py-3 flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:bg-slate-50 transition-colors"
                  >
                    {showOther ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    Other system devices ({otherDevices.length}) — click to {showOther ? 'hide' : 'show'}
                  </button>
                  {showOther && otherDevices.map(d => (
                    <DeviceRow key={d.key} device={d} onToggle={toggleDevice} onQty={setQty} disabled={stage === 'importing'} />
                  ))}
                </>
              )}

              {thisSystemDevices.length === 0 && (
                <div className="px-6 py-8 text-center">
                  <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-700 mb-1">No {systemType} devices detected</p>
                  <p className="text-xs text-slate-400">
                    {otherDevices.length > 0
                      ? `Found ${otherDevices.length} device(s) for other systems — expand above to import them.`
                      : 'Try a different document — a drawing or equipment schedule works best.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(stage === 'results' || stage === 'importing') && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3 flex-shrink-0 bg-white">
            <button
              onClick={() => { setStage('upload'); setDevices([]); setError(null); }}
              className="text-sm text-slate-500 border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-50 transition-colors"
              disabled={stage === 'importing'}
            >
              Upload different file
            </button>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="text-sm text-slate-500 px-4 py-2 hover:text-slate-700 transition-colors"
              disabled={stage === 'importing'}
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={totalSelected === 0 || stage === 'importing'}
              className="inline-flex items-center gap-2 bg-violet-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-violet-700 transition-colors disabled:opacity-40 shadow-sm shadow-violet-200"
            >
              {stage === 'importing'
                ? <><Loader2 className="w-4 h-4 animate-spin" />Importing…</>
                : <><Check className="w-4 h-4" />Import {totalSelected} device{totalSelected !== 1 ? 's' : ''} for review</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Device row ────────────────────────────────────────────────────────────────

function DeviceRow({
  device, onToggle, onQty, disabled,
}: {
  device: SelectableDevice;
  onToggle: (key: string) => void;
  onQty: (key: string, qty: number) => void;
  disabled: boolean;
}) {
  const confidenceColor =
    device.confidence >= 0.8 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    device.confidence >= 0.5 ? 'text-amber-700 bg-amber-50 border-amber-200' :
                               'text-red-700 bg-red-50 border-red-200';
  const systemColor = SYSTEM_COLORS[device.system_type] ?? 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <div
      onClick={() => !disabled && onToggle(device.key)}
      className={`flex items-start gap-4 px-6 py-4 cursor-pointer transition-colors ${device.selected ? 'bg-violet-50' : 'hover:bg-slate-50'}`}
    >
      {/* Checkbox */}
      <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-colors ${device.selected ? 'bg-violet-600 border-violet-600' : 'border-slate-300'}`}>
        {device.selected && <Check className="w-3 h-3 text-white" />}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800">{device.device_type}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${systemColor}`}>{device.system_type}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${confidenceColor}`}>
            {Math.round(device.confidence * 100)}% confidence
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
          {(device.manufacturer || device.model_number) && (
            <span className="inline-flex items-center gap-1">
              <Package className="w-3 h-3" />
              {[device.manufacturer, device.model_number].filter(Boolean).join(' — ')}
            </span>
          )}
          {device.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />{device.location}
            </span>
          )}
        </div>
      </div>

      {/* Quantity */}
      {device.selected && (
        <div
          className="flex items-center gap-1 flex-shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <span className="text-[10px] text-slate-400 mr-1">Qty</span>
          <button
            onClick={() => onQty(device.key, device.importQty - 1)}
            disabled={device.importQty <= 1 || disabled}
            className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-30"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="w-7 text-center text-sm font-semibold text-slate-800">{device.importQty}</span>
          <button
            onClick={() => onQty(device.key, device.importQty + 1)}
            disabled={disabled}
            className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-30"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
