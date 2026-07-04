import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchProjectDevices } from '../lib/fetchProjectDevices';
import { groupDevices, getGroupRowKey, type GroupedEquipment } from '../lib/deviceGrouping';
import {
  buildPrefixCounters,
  saveProjectSystem,
  updateEquipmentGroup,
  type EquipmentGroupUpdates,
} from '../lib/deviceProjectEdits';
import { loadProjectSystemsForProject } from '../lib/projectSystemsDb';
import {
  deriveProjectSystems,
  deviceBelongsToSystem,
  getCategoryStyle,
  notifyProjectDevicesChanged,
  resolveSystemSlugToName,
  systemNameToSlug,
  SYSTEM_CATEGORIES,
} from '../lib/systems';
import { Plus, Trash2, Pencil, Check, X, CheckCheck, Sparkles, FileSearch, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { AddDeviceModal } from '../components/AddDeviceModal';
import { EditDeviceModal } from '../components/EditDeviceModal';
import { AIImportModal } from '../components/AIImportModal';
import { ManufacturerSuggestHelper } from '../components/ManufacturerSuggestHelper';
import { useProject } from './ProjectLayout';
import type { ManufacturerSuggestion } from '../lib/manufacturerSuggestion';
import { saveProductModelPairIfNew } from '../lib/productModelPairing';
import { formatWarrantyYears, getDeviceProductDescription, extractProductCategoryFromNotes, extractWarrantyYearsFromNotes } from '../lib/deviceProductFields';
import {
  enrichDeviceWithAutoManufacturer,
  extractPendingManufacturerSuggestion,
  stripManufacturerLookupNotes,
  type PendingManufacturerSuggestion,
} from '../lib/autoManufacturerLookup';
import type { Device, ProjectSystemRecord, SystemCategory } from '../types';

function groupedLocations(devices: Device[]): string {
  const locs = [...new Set(devices.map(d => d.location?.trim()).filter(Boolean))] as string[];
  if (locs.length === 0) return '—';
  if (locs.length === 1) return locs[0];
  return locs.slice(0, 3).join(', ') + (locs.length > 3 ? ` +${locs.length - 3}` : '');
}

function primaryLocation(devices: Device[]): string {
  const locations = [...new Set(devices.map(d => d.location?.trim()).filter(Boolean))] as string[];
  return locations[0] ?? '';
}

function getGroupPendingSuggestion(row: GroupedEquipment): PendingManufacturerSuggestion | null {
  if (row.manufacturer?.trim()) return null;
  for (const device of row.devices) {
    const pending = extractPendingManufacturerSuggestion(device.notes);
    if (pending) return pending;
  }
  return null;
}

function getDevicePendingSuggestion(device: Device): PendingManufacturerSuggestion | null {
  if (device.manufacturer?.trim()) return null;
  return extractPendingManufacturerSuggestion(device.notes);
}

type GroupedField = 'description' | 'manufacturer' | 'model' | 'quantity' | 'location';
type IndividualField = 'description' | 'manufacturer' | 'model' | 'location';

type EditingCell =
  | { mode: 'grouped'; rowKey: string; field: GroupedField; draft: string }
  | { mode: 'individual'; deviceId: number; field: IndividualField; draft: string };

type SortDir = 'asc' | 'desc';

type GroupedSortKey = 'description' | 'manufacturer' | 'model' | 'productCategory' | 'warranty' | 'quantity' | 'locations';
type IndividualSortKey = 'label' | 'description' | 'manufacturer' | 'model' | 'productCategory' | 'warranty' | 'location' | 'status';

function cycleSort<K extends string>(
  current: { key: K; dir: SortDir } | null,
  key: K,
): { key: K; dir: SortDir } | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

function sortIcon(active: boolean, dir: SortDir | null) {
  if (!active || !dir) return <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />;
  return dir === 'asc'
    ? <ArrowUp className="w-3.5 h-3.5" />
    : <ArrowDown className="w-3.5 h-3.5" />;
}

export default function ProjectSystemsPage() {
  const navigate = useNavigate();
  const { id, system: systemSlug } = useParams<{ id: string; system?: string }>();
  const { productModels, datasheets, refreshProductModels } = useProject();
  const projectId = id ? parseInt(id, 10) : null;

  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [systemRows, setSystemRows] = useState<ProjectSystemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingAll, setApprovingAll] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showAIImport, setShowAIImport] = useState(false);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [viewMode, setViewMode] = useState<'grouped' | 'individual'>('grouped');
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [cellSaveError, setCellSaveError] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState(false);
  const [editingSystem, setEditingSystem] = useState(false);
  const [systemNameDraft, setSystemNameDraft] = useState('');
  const [systemCategoryDraft, setSystemCategoryDraft] = useState<SystemCategory | ''>('');
  const [systemSaveError, setSystemSaveError] = useState<string | null>(null);
  const [savingSystem, setSavingSystem] = useState(false);
  const [groupedSort, setGroupedSort] = useState<{ key: GroupedSortKey; dir: SortDir } | null>(null);
  const [individualSort, setIndividualSort] = useState<{ key: IndividualSortKey; dir: SortDir } | null>(null);

  const projectSystems = useMemo(
    () => deriveProjectSystems(allDevices, systemRows),
    [allDevices, systemRows],
  );
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

  const systemDevices = useMemo(() => {
    if (!activeSystemMeta) return [];
    return allDevices.filter(device =>
      deviceBelongsToSystem(device, { id: activeSystemMeta.id, name: activeSystemMeta.name }),
    );
  }, [allDevices, activeSystemMeta]);

  const pending = useMemo(
    () => systemDevices.filter(device => device.status === 'pending_review'),
    [systemDevices],
  );

  const equipmentGroups = useMemo(() => groupDevices(systemDevices), [systemDevices]);

  const sortedEquipmentGroups = useMemo(() => {
    if (!groupedSort) return equipmentGroups;
    const factor = groupedSort.dir === 'asc' ? 1 : -1;
    return [...equipmentGroups].sort((a, b) => {
      let left: string | number;
      let right: string | number;
      switch (groupedSort.key) {
        case 'description':
          left = (a.description ?? '').toLowerCase();
          right = (b.description ?? '').toLowerCase();
          break;
        case 'manufacturer':
          left = (a.manufacturer ?? '').toLowerCase();
          right = (b.manufacturer ?? '').toLowerCase();
          break;
        case 'model':
          left = (a.part_number ?? a.model_number ?? '').toLowerCase();
          right = (b.part_number ?? b.model_number ?? '').toLowerCase();
          break;
        case 'productCategory':
          left = (a.product_category ?? '').toLowerCase();
          right = (b.product_category ?? '').toLowerCase();
          break;
        case 'warranty':
          left = a.warranty_years ?? -1;
          right = b.warranty_years ?? -1;
          break;
        case 'quantity':
          left = a.quantity;
          right = b.quantity;
          break;
        case 'locations':
          left = groupedLocations(a.devices).toLowerCase();
          right = groupedLocations(b.devices).toLowerCase();
          break;
        default:
          left = '';
          right = '';
      }
      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * factor;
      }
      return String(left).localeCompare(String(right)) * factor;
    });
  }, [equipmentGroups, groupedSort]);

  const sortedSystemDevices = useMemo(() => {
    if (!individualSort) return systemDevices;
    const factor = individualSort.dir === 'asc' ? 1 : -1;
    return [...systemDevices].sort((a, b) => {
      let left: string | number;
      let right: string | number;
      switch (individualSort.key) {
        case 'label':
          left = (a.device_name ?? '').toLowerCase();
          right = (b.device_name ?? '').toLowerCase();
          break;
        case 'description':
          left = getDeviceProductDescription(a)?.toLowerCase() ?? '';
          right = getDeviceProductDescription(b)?.toLowerCase() ?? '';
          break;
        case 'manufacturer':
          left = (a.manufacturer ?? '').toLowerCase();
          right = (b.manufacturer ?? '').toLowerCase();
          break;
        case 'model':
          left = (a.model_number ?? '').toLowerCase();
          right = (b.model_number ?? '').toLowerCase();
          break;
        case 'productCategory':
          left = (extractProductCategoryFromNotes(a.notes) ?? '').toLowerCase();
          right = (extractProductCategoryFromNotes(b.notes) ?? '').toLowerCase();
          break;
        case 'warranty':
          left = extractWarrantyYearsFromNotes(a.notes) ?? -1;
          right = extractWarrantyYearsFromNotes(b.notes) ?? -1;
          break;
        case 'location':
          left = (a.location ?? '').toLowerCase();
          right = (b.location ?? '').toLowerCase();
          break;
        case 'status':
          left = (a.status ?? '').toLowerCase();
          right = (b.status ?? '').toLowerCase();
          break;
        default:
          left = '';
          right = '';
      }
      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * factor;
      }
      return String(left).localeCompare(String(right)) * factor;
    });
  }, [systemDevices, individualSort]);

  const fetchDevices = useCallback(async (): Promise<Device[]> => {
    if (!projectId) return [];
    setLoading(true);
    try {
      const devices = await fetchProjectDevices(projectId);
      const systems = await loadProjectSystemsForProject(projectId, devices);
      setAllDevices(devices);
      setSystemRows(systems);
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

    const savedName = systemNameDraft.trim() || activeSystemName;
    const categoryToSave = systemCategoryDraft || null;
    const saveError = await saveProjectSystem(
      projectId,
      activeSystemMeta?.id ?? null,
      activeSystemName,
      savedName,
      categoryToSave,
    );
    if (saveError) {
      setSystemSaveError(saveError);
      setSavingSystem(false);
      return;
    }

    setSavingSystem(false);
    setEditingSystem(false);
    await fetchDevices();
    if (id) {
      navigate(`/projects/${id}/systems/${systemNameToSlug(savedName)}`, { replace: true });
    }
  };

  const handleAddDevice = async (deviceData: Partial<Device>): Promise<string | null> => {
    if (!projectId) return 'No project ID';

    const row: Partial<Device> = {
      ...deviceData,
      project_id: projectId,
      project_system_id: activeSystemMeta?.id ?? null,
      system_type: activeSystemName,
      system_category: activeSystemMeta?.category ?? null,
      status: 'active',
    };

    if (!row.manufacturer?.trim()) {
      await enrichDeviceWithAutoManufacturer(row, productModels, {
        context: `systems-add:project-${projectId}`,
      });
    }

    const { error } = await supabase.from('devices').insert(row);
    if (error) return error.message;
    await refreshProductModels();
    setShowAdd(false);
    fetchDevices();
    return null;
  };

  const handleDelete = async (deviceId: number) => {
    if (!confirm('Delete this device?')) return;
    await supabase.from('devices').delete().eq('id', deviceId);
    fetchDevices();
  };

  const cancelCellEdit = () => setEditingCell(null);

  const persistManufacturerPairing = async (
    manufacturer: string,
    modelNumber: string | null,
    deviceType: string | null,
    deviceIds: number[],
    productId: number | null,
  ) => {
    if (modelNumber?.trim()) {
      const saved = await saveProductModelPairIfNew(
        manufacturer,
        modelNumber,
        deviceType,
        productModels,
      );
      if ('error' in saved) {
        setCellSaveError(saved.error);
      } else {
        await refreshProductModels();
      }
    }

    if (productId != null || modelNumber?.trim()) {
      await supabase.from('devices').update({ matched: true }).in('id', deviceIds);
    }
  };

  const applyGroupedManufacturerSuggestion = async (
    row: GroupedEquipment,
    manufacturer: string,
    suggestion: ManufacturerSuggestion,
  ) => {
    if (!projectId) return;

    const strippedNotes = stripManufacturerLookupNotes(row.devices[0]?.notes);
    const error = await updateEquipmentGroup(
      projectId,
      row,
      {
        manufacturer,
        ai_confidence: suggestion.confidence,
        notes: strippedNotes,
      },
      { ...prefixCounters },
    );
    if (error) {
      setCellSaveError(error);
      throw new Error(error);
    }

    await persistManufacturerPairing(
      manufacturer,
      row.model_number,
      row.description,
      row.devices.map(device => device.id),
      suggestion.productId,
    );
    await fetchDevices();
  };

  const applyIndividualManufacturerSuggestion = async (
    device: Device,
    manufacturer: string,
    suggestion: ManufacturerSuggestion,
  ) => {
    const { error } = await supabase
      .from('devices')
      .update({
        manufacturer,
        ai_confidence: suggestion.confidence,
        notes: stripManufacturerLookupNotes(device.notes),
      })
      .eq('id', device.id);
    if (error) {
      setCellSaveError(error.message);
      throw new Error(error.message);
    }

    notifyProjectDevicesChanged();
    await persistManufacturerPairing(
      manufacturer,
      device.model_number,
      device.device_type,
      [device.id],
      suggestion.productId,
    );
    await fetchDevices();
  };

  const beginGroupedManufacturerEdit = (row: GroupedEquipment, draft = '') => {
    setEditingCell({
      mode: 'grouped',
      rowKey: getGroupRowKey(row),
      field: 'manufacturer',
      draft,
    });
  };

  const beginIndividualManufacturerEdit = (device: Device, draft = '') => {
    setEditingCell({
      mode: 'individual',
      deviceId: device.id,
      field: 'manufacturer',
      draft,
    });
  };

  const commitCellEdit = async () => {
    if (!editingCell || !projectId || savingCell) return;
    setSavingCell(true);
    setCellSaveError(null);
    const trimmed = editingCell.draft.trim();
    let error: string | null = null;

    if (editingCell.mode === 'grouped') {
      const group = equipmentGroups.find(row => getGroupRowKey(row) === editingCell.rowKey);
      if (!group) {
        cancelCellEdit();
        setSavingCell(false);
        return;
      }

      const hadManufacturer = Boolean(group.manufacturer?.trim());
      const updates: EquipmentGroupUpdates = {};
      switch (editingCell.field) {
        case 'description':
          updates.model_name = trimmed || null;
          break;
        case 'manufacturer':
          updates.manufacturer = trimmed || null;
          updates.notes = stripManufacturerLookupNotes(group.devices[0]?.notes);
          break;
        case 'model':
          updates.model_number = trimmed || null;
          break;
        case 'quantity': {
          const parsed = parseInt(editingCell.draft, 10);
          if (Number.isFinite(parsed)) updates.quantity = parsed;
          break;
        }
        case 'location':
          updates.location = trimmed || null;
          break;
      }

      if (Object.keys(updates).length > 0) {
        error = await updateEquipmentGroup(
          projectId,
          group,
          updates,
          { ...prefixCounters },
        );
      }

      if (
        !error &&
        editingCell.field === 'manufacturer' &&
        !hadManufacturer &&
        trimmed &&
        group.model_number?.trim()
      ) {
        await persistManufacturerPairing(
          trimmed,
          group.model_number,
          group.description,
          group.devices.map(device => device.id),
          null,
        );
      }
    } else {
      const device = systemDevices.find(entry => entry.id === editingCell.deviceId);
      if (!device) {
        cancelCellEdit();
        setSavingCell(false);
        return;
      }

      const hadManufacturer = Boolean(device.manufacturer?.trim());
      const updates: Partial<Pick<Device, 'model_name' | 'manufacturer' | 'model_number' | 'location'>> = {};
      switch (editingCell.field) {
        case 'description':
          updates.model_name = trimmed || null;
          break;
        case 'manufacturer':
          updates.manufacturer = trimmed || null;
          updates.notes = stripManufacturerLookupNotes(device.notes);
          break;
        case 'model':
          updates.model_number = trimmed || null;
          break;
        case 'location':
          updates.location = trimmed || null;
          break;
      }

      if (Object.keys(updates).length > 0) {
        const { error: saveError } = await supabase
          .from('devices')
          .update(updates)
          .eq('id', editingCell.deviceId);
        error = saveError?.message ?? null;
        if (!error) notifyProjectDevicesChanged();
      }

      if (
        !error &&
        editingCell.field === 'manufacturer' &&
        !hadManufacturer &&
        trimmed &&
        device.model_number?.trim()
      ) {
        await persistManufacturerPairing(
          trimmed,
          device.model_number,
          device.device_type,
          [device.id],
          null,
        );
      }
    }

    setSavingCell(false);
    if (error) {
      setCellSaveError(error);
      return;
    }

    cancelCellEdit();
    await fetchDevices();
  };

  const renderCellInput = (cell: EditingCell) => (
    <input
      autoFocus
      value={cell.draft}
      onChange={event => setEditingCell({ ...cell, draft: event.target.value })}
      onKeyDown={event => {
        if (event.key === 'Enter') void commitCellEdit();
        if (event.key === 'Escape') cancelCellEdit();
      }}
      onBlur={() => void commitCellEdit()}
      disabled={savingCell}
      className="w-full min-w-[72px] border border-cyan-500 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
    />
  );

  const renderGroupedCell = (
    row: GroupedEquipment,
    field: GroupedField,
    display: string,
  ) => {
    const rowKey = getGroupRowKey(row);
    const isEditing =
      editingCell?.mode === 'grouped' &&
      editingCell.rowKey === rowKey &&
      editingCell.field === field;
    const wrapText = field === 'description';

    if (isEditing) {
      return renderCellInput(editingCell);
    }

    return (
      <button
        type="button"
        onClick={() => setEditingCell({ mode: 'grouped', rowKey, field, draft: display === '—' ? '' : display })}
        className={`w-full text-left px-1 py-0.5 rounded hover:bg-slate-100 ${
          wrapText ? 'whitespace-normal break-words' : 'truncate'
        }`}
        title="Click to edit"
      >
        {display || '—'}
      </button>
    );
  };

  const renderIndividualCell = (
    device: Device,
    field: IndividualField,
    display: string,
  ) => {
    const isEditing =
      editingCell?.mode === 'individual' &&
      editingCell.deviceId === device.id &&
      editingCell.field === field;
    const wrapText = field === 'description';

    if (isEditing) {
      return renderCellInput(editingCell);
    }

    return (
      <button
        type="button"
        onClick={() =>
          setEditingCell({
            mode: 'individual',
            deviceId: device.id,
            field,
            draft: display === '—' ? '' : display,
          })
        }
        className={`w-full text-left px-1 py-0.5 rounded hover:bg-slate-100 ${
          wrapText ? 'whitespace-normal break-words' : 'truncate'
        }`}
        title="Click to edit"
      >
        {display || '—'}
      </button>
    );
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
            {cellSaveError && (
              <div className="mx-4 mt-4 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {cellSaveError}
              </div>
            )}
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {([
                    ['description', 'Product Description', 'w-[11rem]'],
                    ['manufacturer', 'Manufacturer', 'w-[7rem]'],
                    ['model', 'Part Number', 'w-[7rem]'],
                    ['productCategory', 'Product Category', 'w-[8rem]'],
                    ['warranty', 'Warranty', 'w-[5rem]'],
                    ['quantity', 'Quantity', 'w-[5rem]'],
                    ['locations', 'Location', 'w-[12rem]'],
                  ] as const).map(([key, label, widthClass]) => (
                    <th key={key} className={`text-left px-4 py-3 ${widthClass}`}>
                      <button
                        type="button"
                        onClick={() => setGroupedSort(prev => cycleSort(prev, key))}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-cyan-700"
                      >
                        {label}
                        {sortIcon(groupedSort?.key === key, groupedSort?.key === key ? groupedSort.dir : null)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedEquipmentGroups.map(row => (
                  <tr key={getGroupRowKey(row)} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-600 align-top w-[11rem] max-w-[11rem]">
                      {renderGroupedCell(row, 'description', row.product_description ?? row.description ?? '')}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div className="flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                          {renderGroupedCell(row, 'manufacturer', row.manufacturer ?? '')}
                          {(() => {
                            const pending = getGroupPendingSuggestion(row);
                            if (!pending) return null;
                            return (
                              <p className="text-xs text-amber-600 mt-0.5" title={pending.reason}>
                                Suggested: {pending.manufacturer} ({Math.round(pending.confidence * 100)}%)
                              </p>
                            );
                          })()}
                        </div>
                        <ManufacturerSuggestHelper
                          context={{
                            description: row.description,
                            modelNumber: row.model_number,
                            deviceType: row.description,
                          }}
                          productModels={productModels}
                          currentManufacturer={row.manufacturer}
                          pendingSuggestion={getGroupPendingSuggestion(row)}
                          onAccept={(manufacturer, suggestion) =>
                            applyGroupedManufacturerSuggestion(row, manufacturer, suggestion)
                          }
                          onManualEdit={draft => beginGroupedManufacturerEdit(row, draft)}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {renderGroupedCell(row, 'model', row.part_number ?? row.model_number ?? '')}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.product_category || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatWarrantyYears(row.warranty_years)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {renderGroupedCell(row, 'quantity', String(row.quantity))}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[12rem] align-top">
                      {renderGroupedCell(row, 'location', primaryLocation(row.devices) || groupedLocations(row.devices))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {cellSaveError && (
              <div className="mx-4 mt-4 px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {cellSaveError}
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {([
                    ['label', 'Label', 'text-left px-5 py-3 w-32'],
                    ['description', 'Product Description', 'text-left px-4 py-3'],
                    ['manufacturer', 'Manufacturer', 'text-left px-4 py-3'],
                    ['model', 'Part Number', 'text-left px-4 py-3'],
                    ['productCategory', 'Product Category', 'text-left px-4 py-3'],
                    ['warranty', 'Warranty', 'text-left px-4 py-3 w-20'],
                    ['location', 'Location', 'text-left px-4 py-3'],
                    ['status', 'Status', 'text-left px-4 py-3'],
                  ] as const).map(([key, label, className]) => (
                    <th key={key} className={className}>
                      <button
                        type="button"
                        onClick={() => setIndividualSort(prev => cycleSort(prev, key))}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-cyan-700"
                      >
                        {label}
                        {sortIcon(individualSort?.key === key, individualSort?.key === key ? individualSort.dir : null)}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3 w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedSystemDevices.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs font-bold text-slate-700">{d.device_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 align-top max-w-[11rem]">
                      {getDeviceProductDescription(d) || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div className="flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                          {renderIndividualCell(d, 'manufacturer', d.manufacturer ?? '')}
                          {(() => {
                            const pending = getDevicePendingSuggestion(d);
                            if (!pending) return null;
                            return (
                              <p className="text-xs text-amber-600 mt-0.5" title={pending.reason}>
                                Suggested: {pending.manufacturer} ({Math.round(pending.confidence * 100)}%)
                              </p>
                            );
                          })()}
                        </div>
                        <ManufacturerSuggestHelper
                          context={{
                            description: getDeviceProductDescription(d),
                            modelNumber: d.model_number,
                            deviceType: d.device_type,
                          }}
                          productModels={productModels}
                          currentManufacturer={d.manufacturer}
                          pendingSuggestion={getDevicePendingSuggestion(d)}
                          onAccept={(manufacturer, suggestion) =>
                            applyIndividualManufacturerSuggestion(d, manufacturer, suggestion)
                          }
                          onManualEdit={draft => beginIndividualManufacturerEdit(d, draft)}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                      {renderIndividualCell(d, 'model', d.model_number ?? '')}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {extractProductCategoryFromNotes(d.notes) || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatWarrantyYears(extractWarrantyYearsFromNotes(d.notes))}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[180px]">
                      {renderIndividualCell(d, 'location', d.location ?? '')}
                    </td>
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
    </div>
  );
}
