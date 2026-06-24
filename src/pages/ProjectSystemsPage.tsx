import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { groupDevices } from '../lib/deviceGrouping';
import {
  Camera, Lock, ShieldAlert, PhoneCall, ScanLine, Radar, Network,
  Plus, Trash2, Pencil, Check, X, CheckCheck, Sparkles, FileSearch,
} from 'lucide-react';
import { AddDeviceModal } from '../components/AddDeviceModal';
import { EditDeviceModal } from '../components/EditDeviceModal';
import { AIImportModal } from '../components/AIImportModal';
import { useProject } from './ProjectLayout';
import type { Device, SystemType } from '../types';
import { SYSTEM_TYPES } from '../types';

const SYSTEM_CONFIG: Record<SystemType, { icon: React.ElementType; color: string }> = {
  'CCTV':               { icon: Camera,      color: 'blue' },
  'Access Control':     { icon: Lock,        color: 'emerald' },
  'Intruder':           { icon: ShieldAlert, color: 'red' },
  'Intercom':           { icon: PhoneCall,   color: 'violet' },
  'ANPR':               { icon: ScanLine,    color: 'orange' },
  'Perimeter Detection':{ icon: Radar,       color: 'teal' },
  'Networking':         { icon: Network,     color: 'amber' },
};

const COLOR_MAP: Record<string, string> = {
  blue:    'text-blue-600 border-b-2 border-blue-600 bg-blue-50',
  emerald: 'text-emerald-600 border-b-2 border-emerald-600 bg-emerald-50',
  red:     'text-red-600 border-b-2 border-red-600 bg-red-50',
  violet:  'text-violet-600 border-b-2 border-violet-600 bg-violet-50',
  orange:  'text-orange-600 border-b-2 border-orange-600 bg-orange-50',
  teal:    'text-teal-600 border-b-2 border-teal-600 bg-teal-50',
  amber:   'text-amber-600 border-b-2 border-amber-600 bg-amber-50',
};

function groupedLocations(devices: Device[]): string {
  const locs = [...new Set(devices.map(d => d.location?.trim()).filter(Boolean))] as string[];
  if (locs.length === 0) return '—';
  if (locs.length === 1) return locs[0];
  return locs.slice(0, 3).join(', ') + (locs.length > 3 ? ` +${locs.length - 3}` : '');
}

function groupedNotes(devices: Device[]): string {
  const notes = [...new Set(devices.map(d => d.notes?.trim()).filter(Boolean))] as string[];
  if (notes.length === 0) return '—';
  if (notes.length === 1) return notes[0];
  return notes.slice(0, 2).join('; ') + (notes.length > 2 ? ` +${notes.length - 2}` : '');
}

export default function ProjectSystemsPage() {
  const { id, system: systemSlug } = useParams<{ id: string; system?: string }>();
  const { productModels, datasheets } = useProject();

  const initialSystem: SystemType = (() => {
    if (!systemSlug) return 'CCTV';
    const found = SYSTEM_TYPES.find(s =>
      SYSTEM_CONFIG[s] && s.toLowerCase().replace(/\s+/g, '-') === systemSlug
    );
    return found ?? 'CCTV';
  })();

  const [activeSystem, setActiveSystem] = useState<SystemType>(initialSystem);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pending, setPending] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingAll, setApprovingAll] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showAIImport, setShowAIImport] = useState(false);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [viewMode, setViewMode] = useState<'grouped' | 'individual'>('grouped');

  // Sync tab when route changes (sidebar navigation)
  useEffect(() => {
    if (!systemSlug) return;
    const found = SYSTEM_TYPES.find(s =>
      s.toLowerCase().replace(/\s+/g, '-') === systemSlug
    );
    if (found) setActiveSystem(found);
  }, [systemSlug]);

  const fetchDevices = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: active }, { data: pend }] = await Promise.all([
      supabase.from('devices').select('*').eq('project_id', parseInt(id)).eq('system_type', activeSystem).neq('status', 'pending_review').order('sort_order').order('device_name'),
      supabase.from('devices').select('*').eq('project_id', parseInt(id)).eq('system_type', activeSystem).eq('status', 'pending_review').order('device_name'),
    ]);
    setDevices(active ?? []);
    setPending(pend ?? []);
    setLoading(false);
  }, [id, activeSystem]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const equipmentGroups = useMemo(() => groupDevices(devices), [devices]);

  const handleApprove = async (deviceId: number) => {
    await supabase.from('devices').update({ status: 'active' }).eq('id', deviceId);
    fetchDevices();
  };

  const handleReject = async (deviceId: number) => {
    if (!confirm('Delete this AI-suggested device?')) return;
    await supabase.from('devices').delete().eq('id', deviceId);
    fetchDevices();
  };

  const handleApproveAll = async () => {
    if (!pending.length) return;
    setApprovingAll(true);
    await supabase.from('devices').update({ status: 'active' }).in('id', pending.map(d => d.id));
    setApprovingAll(false);
    fetchDevices();
  };

  const handleAddDevice = async (deviceData: Partial<Device>): Promise<string | null> => {
    if (!id) return 'No project ID';
    const { error } = await supabase.from('devices').insert({
      ...deviceData,
      project_id: parseInt(id),
      system_type: activeSystem,
      status: 'active',
    });
    if (error) return error.message;
    setShowAdd(false);
    fetchDevices();
    return null;
  };

  const handleDelete = async (deviceId: number) => {
    if (!confirm('Delete this device?')) return;
    await supabase.from('devices').delete().eq('id', deviceId);
    fetchDevices();
  };

  const cfg = SYSTEM_CONFIG[activeSystem];
  const tabActive = COLOR_MAP[cfg.color] ?? COLOR_MAP['blue'];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* System tabs */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto">
          {SYSTEM_TYPES.map(sys => {
            const c = SYSTEM_CONFIG[sys];
            const Icon = c.icon;
            const isActive = sys === activeSystem;
            return (
              <button
                key={sys}
                onClick={() => setActiveSystem(sys)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive ? tabActive.replace(COLOR_MAP[cfg.color], COLOR_MAP[c.color]) : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                } ${isActive ? COLOR_MAP[c.color] : ''}`}
              >
                <Icon className="w-4 h-4" />
                {sys}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pending review banner */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span className="text-sm font-semibold text-amber-800">
                {pending.length} AI-suggested device{pending.length !== 1 ? 's' : ''} pending review
              </span>
            </div>
            <button
              onClick={handleApproveAll}
              disabled={approvingAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {approvingAll ? 'Approving…' : 'Approve All'}
            </button>
          </div>

          <div className="mt-3 space-y-1.5">
            {pending.map(d => (
              <div key={d.id} className="flex items-center gap-3 bg-white border border-amber-200 rounded-lg px-3.5 py-2.5">
                <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr_1fr_1fr] gap-x-4 items-center">
                  <span className="text-xs font-mono font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded">{d.device_name}</span>
                  <span className="text-xs text-slate-600 truncate">{d.device_type ?? '—'}</span>
                  <span className="text-xs text-slate-500 truncate">{[d.manufacturer, d.model_number].filter(Boolean).join(' · ') || '—'}</span>
                  <span className="text-xs text-slate-500 truncate">{d.location ?? '—'}</span>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setEditDevice(d)} className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded transition-colors" title="Edit before approving">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleApprove(d.id)} className="p-1.5 text-white bg-emerald-500 hover:bg-emerald-600 rounded transition-colors" title="Approve">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleReject(d.id)} className="p-1.5 text-white bg-red-500 hover:bg-red-600 rounded transition-colors" title="Reject">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Devices table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <cfg.icon className="w-5 h-5 text-slate-500" />
            <h2 className="font-semibold text-slate-900">{activeSystem}</h2>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-medium">{devices.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm mr-1">
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={`px-3 py-1.5 transition-colors ${viewMode === 'grouped' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Grouped View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('individual')}
                className={`px-3 py-1.5 border-l border-slate-300 transition-colors ${viewMode === 'individual' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Individual View
              </button>
            </div>
            <button
              onClick={() => setShowAIImport(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors shadow-sm shadow-violet-200"
            >
              <FileSearch className="w-4 h-4" />AI Import
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-cyan-600 text-white text-sm font-medium rounded-lg hover:bg-cyan-700 transition-colors"
            >
              <Plus className="w-4 h-4" />Add Device
            </button>
          </div>
        </div>

        {devices.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <cfg.icon className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No {activeSystem} devices yet</p>
            <p className="text-xs mt-1">Add a device or use the AI Project Builder to import.</p>
          </div>
        ) : viewMode === 'grouped' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {['System Type', 'Description', 'Manufacturer', 'Model', 'Quantity', 'Locations', 'Notes'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {equipmentGroups.map(row => (
                  <tr key={`${row.system_type}|${row.manufacturer}|${row.model_number}|${row.description}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-700">{row.system_type ?? activeSystem}</td>
                    <td className="px-4 py-3 text-slate-600">{row.description ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{row.manufacturer ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{row.model_number ?? '—'}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.quantity}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px]">{groupedLocations(row.devices)}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px]">{groupedNotes(row.devices)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Label</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Manufacturer / Model</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs font-bold text-slate-700">{d.device_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{d.device_type ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {[d.manufacturer, d.model_number].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[180px] truncate">{d.location ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        d.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        d.status === 'commissioned' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {d.status ?? 'active'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setEditDevice(d)} className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(d.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddDeviceModal
          productModels={productModels}
          datasheets={datasheets}
          defaultSystemType={activeSystem}
          onClose={() => setShowAdd(false)}
          onAdd={handleAddDevice}
        />
      )}

      {showAIImport && id && (
        <AIImportModal
          projectId={parseInt(id)}
          systemType={activeSystem}
          onClose={() => setShowAIImport(false)}
          onImported={() => { setShowAIImport(false); fetchDevices(); }}
        />
      )}

      {editDevice && (
        <EditDeviceModal
          device={editDevice}
          productModels={productModels}
          onClose={() => setEditDevice(null)}
          onSave={() => { setEditDevice(null); fetchDevices(); }}
        />
      )}
    </div>
  );
}
