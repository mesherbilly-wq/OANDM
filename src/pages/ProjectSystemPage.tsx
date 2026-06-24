import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProject } from './ProjectLayout';
import { AddDeviceModal } from '../components/AddDeviceModal';
import { EditDeviceModal } from '../components/EditDeviceModal';
import { UploadDatasheetModal } from '../components/UploadDatasheetModal';
import { AIImportModal } from '../components/AIImportModal';
import type { Device, Datasheet, SystemType } from '../types';
import {
  Camera, Lock, PhoneCall, ShieldAlert, Network,
  Plus, Search, CheckCircle, XCircle, ExternalLink, Trash2, Cpu, AlertCircle,
  Pencil, Upload, ArrowUp, ArrowDown, ArrowUpDown, MapPin, Sparkles, ThumbsUp, ThumbsDown, FileSearch,
} from 'lucide-react';

const SYSTEM_CONFIG: Record<SystemType, { icon: React.ElementType; color: string; bg: string; border: string }> = {
  'CCTV':           { icon: Camera,      color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  'Access Control': { icon: Lock,        color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200' },
  'Intercom':       { icon: PhoneCall,   color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  'Intruder':       { icon: ShieldAlert, color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200' },
  'Networking':     { icon: Network,     color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200' },
};

type SortField = 'device_name' | 'device_type' | 'manufacturer' | 'model_number' | 'ip_address' | 'location';
type SortDir = 'asc' | 'desc';

interface Props {
  systemType: SystemType;
}

export function ProjectSystemPage({ systemType }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { productModels, datasheets, refreshDatasheets } = useProject();
  const [devices, setDevices] = useState<Device[]>([]);
  const [pendingDevices, setPendingDevices] = useState<Device[]>([]);
  const [approvingAll, setApprovingAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [matchFilter, setMatchFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showAdd, setShowAdd] = useState(false);
  const [showAIImport, setShowAIImport] = useState(false);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [uploadDatasheetFor, setUploadDatasheetFor] = useState<Device | null>(null);

  const cfg = SYSTEM_CONFIG[systemType];
  const Icon = cfg.icon;

  useEffect(() => { fetchDevices(); }, [id, systemType]);

  const fetchDevices = async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('project_id', parseInt(id))
      .eq('system_type', systemType)
      .order('device_name', { ascending: true });
    if (error) { setError(error.message); setLoading(false); return; }
    const all = data ?? [];
    setPendingDevices(all.filter(d => d.status === 'pending_review'));
    setDevices(all.filter(d => d.status !== 'pending_review'));
    setLoading(false);
  };

  const handleApprove = async (deviceId: number) => {
    await supabase.from('devices').update({ status: 'active' }).eq('id', deviceId);
    setPendingDevices(prev => {
      const approved = prev.find(d => d.id === deviceId);
      if (approved) setDevices(existing => [{ ...approved, status: 'active' }, ...existing]);
      return prev.filter(d => d.id !== deviceId);
    });
  };

  const handleReject = async (deviceId: number) => {
    if (!confirm('Remove this AI-suggested device?')) return;
    await supabase.from('devices').delete().eq('id', deviceId);
    setPendingDevices(prev => prev.filter(d => d.id !== deviceId));
  };

  const handleApproveAll = async () => {
    setApprovingAll(true);
    const ids = pendingDevices.map(d => d.id);
    await supabase.from('devices').update({ status: 'active' }).in('id', ids);
    setDevices(existing => [...pendingDevices.map(d => ({ ...d, status: 'active' })), ...existing]);
    setPendingDevices([]);
    setApprovingAll(false);
  };

  const handleAdd = async (device: Partial<Device>): Promise<string | null> => {
    const mfr = device.manufacturer?.trim().toLowerCase();
    const model = device.model_number?.trim().toLowerCase();
    const hasDatasheet = datasheets.some(
      (ds) => ds.manufacturer?.trim().toLowerCase() === mfr &&
               ds.model_number?.trim().toLowerCase() === model &&
               ds.datasheet_url?.trim()
    );
    const { data, error } = await supabase
      .from('devices')
      .insert({ ...device, project_id: parseInt(id!), system_type: systemType, datasheet_found: hasDatasheet })
      .select().single();
    if (error) return error.message;
    setDevices((prev) => [data, ...prev]);
    return null;
  };

  const handleSaveEdit = (updated: Device) => {
    setDevices((prev) => prev.map((d) => d.id === updated.id ? updated : d));
    setEditDevice(null);
  };

  const handleDatasheetUploaded = async (datasheet: Datasheet) => {
    await refreshDatasheets();
    const mfr = datasheet.manufacturer?.trim().toLowerCase();
    const model = datasheet.model_number?.trim().toLowerCase();
    setDevices((prev) => prev.map((d) =>
      d.manufacturer?.trim().toLowerCase() === mfr && d.model_number?.trim().toLowerCase() === model
        ? { ...d, datasheet_found: true }
        : d
    ));
    setUploadDatasheetFor(null);
  };

  const handleDelete = async (deviceId: number) => {
    if (!confirm('Delete this device?')) return;
    await supabase.from('devices').delete().eq('id', deviceId);
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const goToDrawing = (device: Device) => {
    if (!device.drawing_id) return;
    const params = new URLSearchParams({ drawing_id: String(device.drawing_id) });
    if (device.device_name) params.set('device', device.device_name);
    navigate(`/projects/${id}/drawings?${params.toString()}`);
  };

  const displayedDevices = useMemo(() => {
    let list = devices.filter((d) => {
      const q = search.toLowerCase();
      const ms = !q || d.device_name?.toLowerCase().includes(q) || d.manufacturer?.toLowerCase().includes(q) || d.model_number?.toLowerCase().includes(q) || d.ip_address?.toLowerCase().includes(q) || d.location?.toLowerCase().includes(q);
      const mm = matchFilter === 'all' || (matchFilter === 'matched' && d.matched) || (matchFilter === 'unmatched' && !d.matched);
      return ms && mm;
    });

    if (sortField) {
      list = [...list].sort((a, b) => {
        const av = (a[sortField] ?? '').toLowerCase();
        const bv = (b[sortField] ?? '').toLowerCase();
        const cmp = av.localeCompare(bv);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return list;
  }, [devices, search, matchFilter, sortField, sortDir]);

  const stats = {
    total: devices.length,
    matched: devices.filter((d) => d.matched).length,
    withDatasheet: devices.filter((d) => d.datasheet_found).length,
  };

  return (
    <div>
      {/* AI Pending Review banner */}
      {pendingDevices.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-amber-200">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {pendingDevices.length} AI-imported device{pendingDevices.length !== 1 ? 's' : ''} pending review
                </p>
                <p className="text-xs text-amber-600">Approve to add to the project schedule, or reject to discard</p>
              </div>
            </div>
            <button onClick={handleApproveAll} disabled={approvingAll}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors text-sm font-semibold disabled:opacity-50">
              <ThumbsUp className="w-4 h-4" />
              {approvingAll ? 'Approving…' : 'Approve All'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-200 bg-amber-50/60">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Device Name</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Type</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Manufacturer / Model</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Location</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wider">Confidence</th>
                  <th className="px-5 py-2.5 text-right text-xs font-semibold text-amber-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {pendingDevices.map(device => (
                  <tr key={device.id} className="hover:bg-amber-50/80 transition-colors">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-amber-100 rounded flex items-center justify-center flex-shrink-0">
                          <Cpu className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <span className="font-mono text-sm font-semibold text-slate-800">{device.device_name ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">{device.device_type ?? '-'}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <p className="text-sm text-slate-800">{device.manufacturer ?? '-'}</p>
                      <p className="text-xs text-slate-400 font-mono">{device.model_number ?? '-'}</p>
                    </td>
                    <td className="px-5 py-2.5 text-sm text-slate-600">{device.location ?? '-'}</td>
                    <td className="px-5 py-2.5">
                      {device.ai_confidence != null ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                          ${device.ai_confidence >= 0.8 ? 'bg-emerald-100 text-emerald-700'
                            : device.ai_confidence >= 0.6 ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'}`}>
                          {Math.round(device.ai_confidence * 100)}%
                        </span>
                      ) : <span className="text-slate-400 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => handleApprove(device.id)} title="Approve — add to schedule"
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors">
                          <ThumbsUp className="w-3.5 h-3.5" />Approve
                        </button>
                        <button onClick={() => handleReject(device.id)} title="Reject — discard device"
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">
                          <ThumbsDown className="w-3.5 h-3.5" />Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* System header */}
      <div className={`rounded-xl border ${cfg.border} ${cfg.bg} px-5 py-4 mb-6 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
            <Icon className={`w-5 h-5 ${cfg.color}`} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{systemType}</h2>
            <p className="text-sm text-slate-500">{stats.total} device{stats.total !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAIImport(true)}
            className="inline-flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors font-medium text-sm shadow-sm shadow-violet-200">
            <FileSearch className="w-4 h-4" />
            AI Import
          </button>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-lg hover:bg-cyan-700 transition-colors font-medium text-sm">
            <Plus className="w-4 h-4" />
            Add Device
          </button>
        </div>
      </div>

      {devices.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-xl font-bold text-slate-900">{stats.total}</p>
            <p className="text-xs text-slate-500 mt-0.5">Total</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <p className="text-xl font-bold text-green-600">{stats.matched}</p>
            <p className="text-xs text-green-700 mt-0.5">Model Matched</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <p className="text-xl font-bold text-blue-600">{stats.withDatasheet}</p>
            <p className="text-xs text-blue-700 mt-0.5">With Datasheet</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="Search devices..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
        </div>
        <select value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500">
          <option value="all">All Status</option>
          <option value="matched">Matched</option>
          <option value="unmatched">Unmatched</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading devices...</p>
        </div>
      ) : displayedDevices.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-xl border border-slate-200">
          <Icon className={`w-10 h-10 mx-auto mb-3 ${cfg.color} opacity-30`} />
          <h3 className="font-medium text-slate-900 mb-1">
            {devices.length === 0 ? `No ${systemType} devices yet` : 'No devices match your search'}
          </h3>
          <p className="text-slate-500 text-sm mb-5">
            {devices.length === 0 ? `Add your first device to the ${systemType} system` : 'Try adjusting your filters'}
          </p>
          {devices.length === 0 && (
            <button onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-lg hover:bg-cyan-700 transition-colors text-sm">
              <Plus className="w-4 h-4" />Add Device
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <SortTh field="device_name" label="Device" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh field="device_type" label="Type" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh field="manufacturer" label="Manufacturer / Model" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh field="ip_address" label="IP" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh field="location" label="Location" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedDevices.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Cpu className="w-4 h-4 text-slate-500" />
                        </div>
                        {device.drawing_id ? (
                          <button
                            onClick={() => goToDrawing(device)}
                            title="View in drawing"
                            className="group flex items-center gap-1.5"
                          >
                            <span className="font-medium text-slate-900 text-sm group-hover:text-cyan-600 group-hover:underline underline-offset-2 transition-colors">
                              {device.device_name || <span className="text-slate-400 italic">Unnamed</span>}
                            </span>
                            <MapPin className="w-3.5 h-3.5 text-slate-300 group-hover:text-cyan-500 transition-colors flex-shrink-0" />
                          </button>
                        ) : (
                          <p className="font-medium text-slate-900 text-sm">
                            {device.device_name || <span className="text-slate-400 italic">Unnamed</span>}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded">
                        {device.device_type || '-'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-slate-900">{device.manufacturer || '-'}</p>
                      <p className="text-xs text-slate-400 font-mono">{device.model_number || '-'}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-500 font-mono">{device.ip_address || '-'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">{device.location || '-'}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {device.matched ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                            <CheckCircle className="w-3 h-3" />Matched
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                            <XCircle className="w-3 h-3" />Unmatched
                          </span>
                        )}
                        {device.datasheet_found ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                            <ExternalLink className="w-3 h-3" />Datasheet
                          </span>
                        ) : (
                          <button
                            onClick={() => setUploadDatasheetFor(device)}
                            title="Upload datasheet for this model"
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-500 rounded hover:bg-amber-50 hover:text-amber-700 transition-colors"
                          >
                            <Upload className="w-3 h-3" />Upload
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditDevice(device)} title="Edit device"
                          className="p-1.5 text-slate-300 hover:text-cyan-600 hover:bg-cyan-50 rounded transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(device.id)} title="Delete device"
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">{displayedDevices.length} of {devices.length} devices
        {sortField && <span className="ml-2 text-slate-300">sorted by {sortField.replace('_', ' ')} {sortDir === 'asc' ? '↑' : '↓'}</span>}
      </p>

      {showAdd && (
        <AddDeviceModal productModels={productModels} datasheets={datasheets} defaultSystemType={systemType}
          onClose={() => setShowAdd(false)} onAdd={handleAdd} />
      )}
      {showAIImport && id && (
        <AIImportModal
          projectId={parseInt(id)}
          systemType={systemType}
          onClose={() => setShowAIImport(false)}
          onImported={() => { setShowAIImport(false); fetchDevices(); }}
        />
      )}
      {editDevice && (
        <EditDeviceModal device={editDevice} productModels={productModels}
          onClose={() => setEditDevice(null)} onSave={handleSaveEdit} />
      )}
      {uploadDatasheetFor && (
        <UploadDatasheetModal
          manufacturer={uploadDatasheetFor.manufacturer ?? ''}
          modelNumber={uploadDatasheetFor.model_number ?? ''}
          onClose={() => setUploadDatasheetFor(null)}
          onUploaded={handleDatasheetUploaded}
        />
      )}
    </div>
  );
}

function SortTh({ field, label, sortField, sortDir, onSort }: {
  field: SortField; label: string;
  sortField: SortField | null; sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  const SortIcon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      onClick={() => onSort(field)}
      className="px-5 py-3.5 text-left select-none cursor-pointer group"
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-semibold uppercase tracking-wider transition-colors ${active ? 'text-cyan-600' : 'text-slate-500 group-hover:text-slate-700'}`}>
          {label}
        </span>
        <SortIcon className={`w-3 h-3 transition-colors ${active ? 'text-cyan-500' : 'text-slate-300 group-hover:text-slate-400'}`} />
      </div>
    </th>
  );
}
