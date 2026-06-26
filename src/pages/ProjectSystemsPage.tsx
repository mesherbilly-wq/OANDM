import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchProjectDevices } from '../lib/fetchProjectDevices';
import { groupDevices, type GroupedEquipment } from '../lib/deviceGrouping';
import {
  buildPrefixCounters,
  renameProjectSystem,
  updateProjectSystemCategory,
} from '../lib/deviceProjectEdits';
import {
  deriveProjectSystems,
  getCategoryStyle,
  notifyProjectDevicesChanged,
  resolveSystemName,
  resolveSystemSlugToName,
  systemNameToSlug,
  SYSTEM_CATEGORIES,
} from '../lib/systems';
import { Plus, Trash2, Pencil, Check, X, CheckCheck, Sparkles, FileSearch } from 'lucide-react';
import { AddDeviceModal } from '../components/AddDeviceModal';
import { EditDeviceModal } from '../components/EditDeviceModal';
import { EditEquipmentGroupModal } from '../components/EditEquipmentGroupModal';
import { AIImportModal } from '../components/AIImportModal';
import { useProject } from './ProjectLayout';
import type { Device, SystemCategory } from '../types';

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
  const navigate = useNavigate();
  const { id, system: systemSlug } = useParams<{ id: string; system?: string }>();
  const { productModels, datasheets } = useProject();
  const projectId = id ? parseInt(id, 10) : null;

  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingAll, setApprovingAll] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showAIImport, setShowAIImport] = useState(false);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [editGroup, setEditGroup] = useState<GroupedEquipment | null>(null);
  const [viewMode, setViewMode] = useState<'grouped' | 'individual'>('grouped');
  const [editingSystem, setEditingSystem] = useState(false);
  const [systemNameDraft, setSystemNameDraft] = useState('');
  const [systemCategoryDraft, setSystemCategoryDraft] = useState<SystemCategory | ''>('');
  const [systemSaveError, setSystemSaveError] = useState<string | null>(null);
  const [savingSystem, setSavingSystem] = useState(false);

  const projectSystems = useMemo(() => deriveProjectSystems(allDevices), [allDevices]);
  const projectSystemNames = useMemo(() => projectSystems.map(system => system.name), [projectSystems]);
  const prefixCounters = useMemo(() => buildPrefixCounters(allDevices), [allDevices]);

  const activeSystemName = useMemo(() => {
    const resolved = resolveSystemSlugToName(projectSystems, systemSlug);
    if (resolved) return resolved;
    return projectSystems[0]?.name ?? null;
  }, [projectSystems, systemSlug]);

  const activeSystemMeta = useMemo(
    () => projectSystems.find(system => system.name === activeSystemName) ?? null,
    [projectSystems, activeSystemName],
  );

  const systemDevices = useMemo(
    () => allDevices.filter(device => resolveSystemName(device) === activeSystemName),
    [allDevices, activeSystemName],
  );

  const pending = useMemo(
    () => systemDevices.filter(device => device.status === 'pending_review'),
    [systemDevices],
  );

  const equipmentGroups = useMemo(() => groupDevices(systemDevices), [systemDevices]);

  const fetchDevices = useCallback(async (): Promise<Device[]> => {
    if (!projectId) return [];
    setLoading(true);
    try {
      const devices = await fetchProjectDevices(projectId);
      setAllDevices(devices);
      notifyProjectDevicesChanged();
      return devices;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  useEffect(() => {
    if (!id || !activeSystemName || systemSlug) return;
    if (projectSystems.length > 0) {
      navigate(`/projects/${id}/systems/${systemNameToSlug(activeSystemName)}`, { replace: true });
    }
  }, [id, activeSystemName, systemSlug, projectSystems.length, navigate]);

  useEffect(() => {
    setEditingSystem(false);
    setSystemSaveError(null);
    setSystemNameDraft(activeSystemName ?? '');
    setSystemCategoryDraft(activeSystemMeta?.category ?? '');
  }, [activeSystemName, activeSystemMeta?.category]);

  const handleApprove = async (deviceId: number) => {
    await supabase.from('devices').update({ status: 'active' }).eq('id', deviceId);
    fetchDevices();
  };

  const handleReject = async (deviceId: number) => {
    if (!confirm('Delete this imported device?')) return;
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

  const handleSaveSystem = async () => {
    if (!projectId || !activeSystemName) return;
    setSavingSystem(true);
    setSystemSaveError(null);

    const renameError = await renameProjectSystem(projectId, activeSystemName, systemNameDraft);
    if (renameError) {
      setSystemSaveError(renameError);
      setSavingSystem(false);
      return;
    }

    const savedName = systemNameDraft.trim() || activeSystemName;
    if (systemCategoryDraft) {
      const categoryError = await updateProjectSystemCategory(projectId, savedName, systemCategoryDraft);
      if (categoryError) {
        setSystemSaveError(categoryError);
        setSavingSystem(false);
        await fetchDevices();
        return;
      }
    }

    setSavingSystem(false);
    setEditingSystem(false);
    const refreshedDevices = await fetchDevices();
    const savedSystem = deriveProjectSystems(refreshedDevices).find(system => system.name === savedName);
    if (savedSystem && id) {
      navigate(`/projects/${id}/systems/${savedSystem.slug}`, { replace: true });
    } else if (savedName !== activeSystemName && id) {
      navigate(`/projects/${id}/systems/${systemNameToSlug(savedName)}`, { replace: true });
    }
  };

  const handleAddDevice = async (deviceData: Partial<Device>): Promise<string | null> => {
    if (!projectId) return 'No project ID';
    const { error } = await supabase.from('devices').insert({
      ...deviceData,
      project_id: projectId,
      system_type: activeSystemName,
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

  const categoryStyle = getCategoryStyle(activeSystemMeta?.category ?? null);
  const HeaderIcon = categoryStyle.icon;
  const tabActiveClass = 'text-cyan-700 border-b-2 border-cyan-600 bg-cyan-50';
  const ic = 'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex overflow-x-auto">
          {projectSystems.length === 0 ? (
            <div className="px-5 py-3.5 text-sm text-slate-500">No systems yet — import or add devices to create systems.</div>
          ) : (
            projectSystems.map(system => {
              const Icon = getCategoryStyle(system.category).icon;
              const isActive = system.name === activeSystemName;
              return (
                <button
                  key={`${system.slug}:${system.name}`}
                  onClick={() => navigate(`/projects/${id}/systems/${system.slug}`)}
                  className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive ? tabActiveClass : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {system.name}
                  <span className="text-xs opacity-70">({system.deviceCount})</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span className="text-sm font-semibold text-amber-800">
                {pending.length} imported device unit{pending.length !== 1 ? 's' : ''} pending review
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
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            {editingSystem ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">System name</label>
                    <input
                      value={systemNameDraft}
                      onChange={event => setSystemNameDraft(event.target.value)}
                      className={`${ic} w-full`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Trade category</label>
                    <select
                      value={systemCategoryDraft}
                      onChange={event => setSystemCategoryDraft(event.target.value as SystemCategory | '')}
                      className={`${ic} w-full bg-white`}
                    >
                      <option value="">Auto-detect</option>
                      {SYSTEM_CATEGORIES.map(category => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {systemSaveError && <p className="text-sm text-red-600">{systemSaveError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveSystem}
                    disabled={savingSystem}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-600 text-white text-sm rounded-lg hover:bg-cyan-700 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />Save system
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSystem(false);
                      setSystemNameDraft(activeSystemName ?? '');
                      setSystemCategoryDraft(activeSystemMeta?.category ?? '');
                      setSystemSaveError(null);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-slate-600 text-sm rounded-lg hover:bg-slate-100"
                  >
                    <X className="w-4 h-4" />Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 flex-wrap">
                <HeaderIcon className="w-5 h-5 text-slate-500" />
                <h2 className="font-semibold text-slate-900">{activeSystemName ?? 'Systems'}</h2>
                {activeSystemMeta?.category && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${categoryStyle.badgeClass}`}>
                    {activeSystemMeta.category}
                  </span>
                )}
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                  {systemDevices.length} unit{systemDevices.length !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingSystem(true)}
                  className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors"
                  title="Edit system name and category"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            )}
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

        {systemDevices.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <HeaderIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No devices in {activeSystemName ?? 'this system'} yet</p>
            <p className="text-xs mt-1">Add a device or use Create Project to import.</p>
          </div>
        ) : viewMode === 'grouped' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {['Description', 'Manufacturer', 'Model', 'Quantity', 'Locations', 'Notes', ''].map(h => (
                    <th key={h || 'actions'} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {equipmentGroups.map(row => (
                  <tr key={`${row.system_type}|${row.manufacturer}|${row.model_number}|${row.description}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-600">{row.description ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{row.manufacturer ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{row.model_number ?? '—'}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.quantity}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px]">{groupedLocations(row.devices)}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px]">{groupedNotes(row.devices)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setEditGroup(row)}
                        className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors"
                        title="Edit equipment group"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </td>
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
                {systemDevices.map(d => (
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
                        d.status === 'pending_review' ? 'bg-amber-100 text-amber-800' :
                        d.status === 'commissioned' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {d.status === 'pending_review' ? 'pending review' : (d.status ?? 'active')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {d.status === 'pending_review' && (
                          <>
                            <button onClick={() => handleApprove(d.id)} className="p-1.5 text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors" title="Approve">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleReject(d.id)} className="p-1.5 text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors" title="Reject">
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button onClick={() => setEditDevice(d)} className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                        {d.status !== 'pending_review' && (
                          <button onClick={() => handleDelete(d.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
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
          defaultSystemType={activeSystemName ?? undefined}
          onClose={() => setShowAdd(false)}
          onAdd={handleAddDevice}
        />
      )}

      {showAIImport && projectId && (
        <AIImportModal
          projectId={projectId}
          systemType={activeSystemName ?? 'General'}
          onClose={() => setShowAIImport(false)}
          onImported={() => { setShowAIImport(false); fetchDevices(); }}
        />
      )}

      {editDevice && (
        <EditDeviceModal
          device={editDevice}
          productModels={productModels}
          projectSystemNames={projectSystemNames}
          onClose={() => setEditDevice(null)}
          onSave={() => { setEditDevice(null); fetchDevices(); }}
        />
      )}

      {editGroup && projectId && (
        <EditEquipmentGroupModal
          projectId={projectId}
          group={editGroup}
          prefixCounters={{ ...prefixCounters }}
          onClose={() => setEditGroup(null)}
          onSaved={() => { setEditGroup(null); fetchDevices(); }}
        />
      )}
    </div>
  );
}
