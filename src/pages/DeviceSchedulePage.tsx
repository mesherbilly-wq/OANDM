import React, { useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import { groupDevices, getGroupRowKey, type GroupedEquipment } from '../lib/deviceGrouping';
import { fetchProjectDevices } from '../lib/fetchProjectDevices';
import { assignDevicesToNamedSystem, fetchProjectSystems, loadProjectSystemsForProject } from '../lib/projectSystemsDb';
import { getDeviceProductDescription } from '../lib/deviceProductFields';
import {
  inferSystemTypeName,
  shouldAutoAssignSystemType,
  textsForDeviceSystemInference,
} from '../lib/inferSystemType';
import {
  deriveProjectSystems,
  getCategoryStyle,
  LEGACY_SYSTEM_TYPE_NAMES,
  notifyProjectDevicesChanged,
} from '../lib/systems';
import { buildPrefixCounters, updateEquipmentGroup } from '../lib/deviceProjectEdits';
import { MAX_DEVICES_PER_LINE } from '../lib/devicePersistConstants';
import { Device, ProjectSystemRecord } from '../types';
import { EditEquipmentGroupModal } from '../components/EditEquipmentGroupModal';
import { EditDeviceModal } from '../components/EditDeviceModal';
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Check,
  X,
  AlertCircle,
} from 'lucide-react';

const SYSTEM_TYPE_COLORS: Record<string, string> = {
  'CCTV': 'bg-blue-100 text-blue-800 border-blue-300',
  'Access Control': 'bg-emerald-100 text-emerald-800 border-emerald-300',
  'Intruder': 'bg-red-100 text-red-800 border-red-300',
  'Intercom': 'bg-purple-100 text-purple-800 border-purple-300',
  'ANPR': 'bg-orange-100 text-orange-800 border-orange-300',
  'Perimeter Detection': 'bg-teal-100 text-teal-800 border-teal-300',
  'Networking': 'bg-amber-100 text-amber-800 border-amber-300',
  'Fire': 'bg-rose-100 text-rose-800 border-rose-300',
};

function systemBadgeClass(systemName: string | null): string {
  if (!systemName) return 'bg-slate-100 text-slate-700 border-slate-200';
  return SYSTEM_TYPE_COLORS[systemName] ?? 'bg-slate-100 text-slate-700 border-slate-200';
}

function SystemTypeSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string | null;
  options: string[];
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const names = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      className={`text-xs font-medium px-2 py-1.5 rounded-lg border w-full min-w-[9rem] ${systemBadgeClass(value)}`}
      value={value ?? ''}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
    >
      {!(value ?? '') && <option value="">Unnamed System</option>}
      {names.map(name => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  );
}

interface DeviceRow {
  device: Device;
  children: DeviceRow[];
  isExpanded?: boolean;
}

export default function DeviceSchedulePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { productModels } = useProject();
  const [devices, setDevices] = useState<Device[]>([]);
  const [systemRows, setSystemRows] = useState<ProjectSystemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grouped' | 'individual'>('grouped');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSystemType, setSelectedSystemType] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<'All' | 'Active' | 'Pending Review'>('All');
  const [showComponents, setShowComponents] = useState(true);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());
  const [editGroup, setEditGroup] = useState<GroupedEquipment | null>(null);
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [descDrafts, setDescDrafts] = useState<Record<string, string>>({});
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const autoAssigningRef = useRef(false);
  const autoAssignedIdsRef = useRef(new Set<number>());

  React.useEffect(() => {
    void fetchDevices();
  }, [projectId]);

  const fetchDevices = async (options?: { silent?: boolean }) => {
    if (!projectId) return;
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const projectIdNum = parseInt(projectId, 10);
      const data = await fetchProjectDevices(projectIdNum);
      const systems = await loadProjectSystemsForProject(projectIdNum, data);
      setDevices(data);
      setSystemRows(systems);
    } catch (error) {
      console.error('Failed to fetch devices:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const applyDevicePatch = (ids: number[], patch: Partial<Device>) => {
    const idSet = new Set(ids);
    setDevices(current => current.map(device => (idSet.has(device.id) ? { ...device, ...patch } : device)));
  };

  const projectSystems = useMemo(
    () => deriveProjectSystems(devices, systemRows),
    [devices, systemRows],
  );

  const systemTypeOptions = useMemo(() => {
    const names = new Set<string>([...LEGACY_SYSTEM_TYPE_NAMES, 'Fire']);
    for (const system of projectSystems) {
      const name = system.name.trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [projectSystems]);

  const pendingCount = useMemo(() => {
    return devices.filter((d) => d.status === 'pending_review').length;
  }, [devices]);

  const buildHierarchy = (allDevices: Device[]): DeviceRow[] => {
    const deviceMap = new Map<string, Device>();
    const childrenMap = new Map<string, Device[]>();

    allDevices.forEach((device) => {
      deviceMap.set(device.id, device);
      if (!childrenMap.has(device.id)) {
        childrenMap.set(device.id, []);
      }
      if (device.parent_device_id) {
        if (!childrenMap.has(device.parent_device_id)) {
          childrenMap.set(device.parent_device_id, []);
        }
        childrenMap.get(device.parent_device_id)!.push(device);
      }
    });

    const roots: DeviceRow[] = [];

    allDevices.forEach((device) => {
      if (!device.parent_device_id && !device.is_component) {
        roots.push({
          device,
          children: buildChildRows(device.id, childrenMap, deviceMap),
        });
      } else if (!device.parent_device_id && device.is_component) {
        roots.push({
          device,
          children: buildChildRows(device.id, childrenMap, deviceMap),
        });
      }
    });

    // Add orphaned components (parent not found)
    const parentIds = new Set(allDevices.map((d) => d.parent_device_id).filter(Boolean));
    allDevices.forEach((device) => {
      if (device.parent_device_id && !deviceMap.has(device.parent_device_id)) {
        if (!roots.some((r) => r.device.id === device.id)) {
          roots.push({
            device,
            children: [],
          });
        }
      }
    });

    return roots;
  };

  const buildChildRows = (
    parentId: string,
    childrenMap: Map<string, Device[]>,
    deviceMap: Map<string, Device>
  ): DeviceRow[] => {
    const children = childrenMap.get(parentId) || [];
    return children.map((child) => ({
      device: child,
      children: buildChildRows(child.id, childrenMap, deviceMap),
    }));
  };

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      if (searchTerm && !(device.device_name ?? '').toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      if (selectedSystemType !== 'All' && device.system_type !== selectedSystemType) {
        return false;
      }
      if (selectedStatus === 'Active' && device.status !== 'active') {
        return false;
      }
      if (selectedStatus === 'Pending Review' && device.status !== 'pending_review') {
        return false;
      }
      if (!showComponents && (device.is_component || device.parent_device_id)) {
        return false;
      }
      return true;
    });
  }, [devices, searchTerm, selectedSystemType, selectedStatus, showComponents]);

  const hierarchyTree = useMemo(() => {
    return buildHierarchy(filteredDevices);
  }, [filteredDevices]);

  const equipmentGroups = useMemo(() => groupDevices(filteredDevices), [filteredDevices]);
  const prefixCounters = useMemo(() => buildPrefixCounters(devices), [devices]);
  const projectIdNum = projectId ? parseInt(projectId, 10) : null;

  const refreshSystemRows = async () => {
    if (!projectIdNum) return;
    setSystemRows(await fetchProjectSystems(projectIdNum));
  };

  React.useEffect(() => {
    autoAssignedIdsRef.current = new Set();
  }, [projectIdNum]);

  React.useEffect(() => {
    if (!projectIdNum || loading || autoAssigningRef.current) return;

    const batches = new Map<string, number[]>();
    for (const group of groupDevices(devices)) {
      if (!shouldAutoAssignSystemType(group.system_type)) continue;
      const inferred = inferSystemTypeName([
        group.description,
        group.manufacturer,
        group.model_number,
        ...group.devices.flatMap(textsForDeviceSystemInference),
      ]);
      if (!inferred || inferred === group.system_type) continue;
      const ids = group.devices
        .map(device => device.id)
        .filter(id => !autoAssignedIdsRef.current.has(id));
      if (ids.length === 0) continue;
      const current = batches.get(inferred) ?? [];
      current.push(...ids);
      batches.set(inferred, current);
    }
    if (batches.size === 0) return;

    autoAssigningRef.current = true;
    void (async () => {
      try {
        for (const [name, ids] of batches) {
          ids.forEach(id => autoAssignedIdsRef.current.add(id));
          const { assignment, error } = await assignDevicesToNamedSystem(projectIdNum, ids, name);
          if (error) {
            setSaveError(error);
            continue;
          }
          applyDevicePatch(ids, assignment);
        }
        await refreshSystemRows();
      } finally {
        autoAssigningRef.current = false;
      }
    })();
  }, [projectIdNum, devices, loading]);

  const handleApproveDevice = async (deviceId: number) => {
    try {
      const { error } = await supabase
        .from('devices')
        .update({ status: 'active' })
        .eq('id', deviceId);

      if (error) throw error;
      notifyProjectDevicesChanged();
      applyDevicePatch([deviceId], { status: 'active' });
    } catch (error) {
      console.error('Failed to approve device:', error);
    }
  };

  const handleRejectDevice = async (deviceId: number) => {
    try {
      const { error } = await supabase.from('devices').delete().eq('id', deviceId);

      if (error) throw error;
      notifyProjectDevicesChanged();
      setDevices(current => current.filter(device => device.id !== deviceId));
    } catch (error) {
      console.error('Failed to reject device:', error);
    }
  };

  const handleDeleteDevice = async (deviceId: number) => {
    if (confirm('Are you sure you want to delete this device?')) {
      try {
        const { error } = await supabase.from('devices').delete().eq('id', deviceId);

        if (error) throw error;
        notifyProjectDevicesChanged();
        setDevices(current => current.filter(device => device.id !== deviceId));
      } catch (error) {
        console.error('Failed to delete device:', error);
      }
    }
  };

  const handleDeleteGroup = async (group: GroupedEquipment) => {
    const label = group.description || group.model_number || 'this line';
    if (!confirm(`Delete ${group.quantity} unit${group.quantity === 1 ? '' : 's'} of ${label}?`)) return;
    const { error } = await supabase.from('devices').delete().in('id', group.devices.map(device => device.id));
    if (error) {
      setSaveError(error.message);
      return;
    }
    notifyProjectDevicesChanged();
    const removed = new Set(group.devices.map(device => device.id));
    setDevices(current => current.filter(device => !removed.has(device.id)));
  };

  const commitGroupQuantity = async (group: GroupedEquipment) => {
    if (!projectIdNum) return;
    const key = getGroupRowKey(group);
    const raw = qtyDrafts[key];
    if (raw === undefined) return;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setQtyDrafts(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    if (parsed === group.quantity) {
      setQtyDrafts(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    setSavingRowKey(key);
    setSaveError(null);
    const error = await updateEquipmentGroup(projectIdNum, group, { quantity: parsed }, { ...prefixCounters });
    setSavingRowKey(null);
    if (error) {
      setSaveError(error);
      return;
    }
    setQtyDrafts(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    await fetchDevices({ silent: true });
  };

  const clearDraft = (setter: React.Dispatch<React.SetStateAction<Record<string, string>>>, key: string) => {
    setter(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const commitGroupSystemType = async (group: GroupedEquipment, nextName: string) => {
    if (!projectIdNum) return;
    if ((group.system_type ?? '') === nextName) return;
    const key = getGroupRowKey(group);
    setSavingRowKey(key);
    setSaveError(null);
    const { assignment, error } = await assignDevicesToNamedSystem(
      projectIdNum,
      group.devices.map(device => device.id),
      nextName,
    );
    setSavingRowKey(null);
    if (error) {
      setSaveError(error);
      return;
    }
    applyDevicePatch(group.devices.map(device => device.id), assignment);
    await refreshSystemRows();
  };

  const commitGroupDescription = async (group: GroupedEquipment) => {
    if (!projectIdNum) return;
    const key = getGroupRowKey(group);
    const raw = descDrafts[key];
    if (raw === undefined) return;
    const next = raw.trim();
    const current = group.description?.trim() ?? '';
    if (next === current) {
      clearDraft(setDescDrafts, key);
      return;
    }
    setSavingRowKey(key);
    setSaveError(null);
    const error = await updateEquipmentGroup(
      projectIdNum,
      group,
      { model_name: next || null },
      { ...prefixCounters },
    );
    setSavingRowKey(null);
    if (error) {
      setSaveError(error);
      return;
    }
    clearDraft(setDescDrafts, key);
    applyDevicePatch(group.devices.map(device => device.id), { model_name: next || null });

    if (shouldAutoAssignSystemType(group.system_type)) {
      const inferred = inferSystemTypeName([
        next,
        group.manufacturer,
        group.model_number,
        ...group.devices.flatMap(textsForDeviceSystemInference),
      ]);
      if (inferred) {
        const { assignment, error: assignError } = await assignDevicesToNamedSystem(
          projectIdNum,
          group.devices.map(device => device.id),
          inferred,
        );
        if (assignError) setSaveError(assignError);
        else {
          applyDevicePatch(group.devices.map(device => device.id), assignment);
          await refreshSystemRows();
        }
      }
    }
  };

  const commitDeviceSystemType = async (device: Device, nextName: string) => {
    if (!projectIdNum) return;
    if ((device.system_type ?? '') === nextName) return;
    const key = `device:${device.id}`;
    setSavingRowKey(key);
    setSaveError(null);
    const { assignment, error } = await assignDevicesToNamedSystem(projectIdNum, [device.id], nextName);
    setSavingRowKey(null);
    if (error) {
      setSaveError(error);
      return;
    }
    applyDevicePatch([device.id], assignment);
    await refreshSystemRows();
  };

  const commitDeviceDescription = async (device: Device) => {
    const key = `device:${device.id}`;
    const raw = descDrafts[key];
    if (raw === undefined) return;
    const next = raw.trim();
    const current = getDeviceProductDescription(device)?.trim() ?? '';
    if (next === current) {
      clearDraft(setDescDrafts, key);
      return;
    }
    setSavingRowKey(key);
    setSaveError(null);
    const { error } = await supabase
      .from('devices')
      .update({ model_name: next || null })
      .eq('id', device.id);
    setSavingRowKey(null);
    if (error) {
      setSaveError(error.message);
      return;
    }
    clearDraft(setDescDrafts, key);
    notifyProjectDevicesChanged();
    applyDevicePatch([device.id], { model_name: next || null });

    if (projectIdNum && shouldAutoAssignSystemType(device.system_type)) {
      const inferred = inferSystemTypeName([
        next,
        device.manufacturer,
        device.model_number,
        ...textsForDeviceSystemInference({ ...device, model_name: next || null }),
      ]);
      if (inferred) {
        const { assignment, error: assignError } = await assignDevicesToNamedSystem(projectIdNum, [device.id], inferred);
        if (assignError) setSaveError(assignError);
        else {
          applyDevicePatch([device.id], assignment);
          await refreshSystemRows();
        }
      }
    }
  };

  const handleBulkApproveAll = async () => {
    if (confirm('Approve all pending devices?')) {
      try {
        const { error } = await supabase
          .from('devices')
          .update({ status: 'active' })
          .eq('project_id', projectId)
          .eq('status', 'pending_review');

        if (error) throw error;
        notifyProjectDevicesChanged();
        setDevices(current => current.map(device => (
          device.status === 'pending_review' ? { ...device, status: 'active' } : device
        )));
      } catch (error) {
        console.error('Failed to bulk approve devices:', error);
      }
    }
  };

  const toggleParentExpand = (deviceId: string) => {
    const newExpanded = new Set(expandedParents);
    if (newExpanded.has(deviceId)) {
      newExpanded.delete(deviceId);
    } else {
      newExpanded.add(deviceId);
    }
    setExpandedParents(newExpanded);
  };

  const renderDeviceRow = (row: DeviceRow, depth: number = 0) => {
    const { device, children } = row;
    const isExpanded = expandedParents.has(device.id);
    const isOrphan = device.parent_device_id && !devices.some((d) => d.id === device.parent_device_id);
    const hasChildren = children.length > 0;

    return (
      <React.Fragment key={device.id}>
        <tr className="border-b border-gray-200 hover:bg-gray-50">
          <td className="px-4 py-3">
            <div style={{ marginLeft: `${depth * 24}px` }} className="flex items-center gap-2">
              {hasChildren && (
                <button
                  onClick={() => toggleParentExpand(device.id)}
                  className="flex-shrink-0 w-5 h-5 flex items-center justify-center hover:bg-gray-200 rounded"
                >
                  {isExpanded ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </button>
              )}
              {!hasChildren && <div className="w-5" />}
              {depth > 0 && (
                <div className="absolute left-0 border-l-2 border-t-2 border-gray-300" style={{
                  width: `${depth * 24 - 12}px`,
                  height: '24px',
                  marginLeft: `-${depth * 24 - 12}px`,
                  marginTop: '12px',
                }} />
              )}
              <span className="font-semibold text-gray-900">{device.device_name}</span>
              <SystemTypeSelect
                value={device.system_type}
                options={systemTypeOptions}
                disabled={savingRowKey === `device:${device.id}`}
                onChange={next => void commitDeviceSystemType(device, next)}
              />
              {isOrphan && (
                <AlertCircle size={16} className="text-yellow-500" title="Parent device not found" />
              )}
            </div>
          </td>
          <td className="px-4 py-3">
            <input
              type="text"
              placeholder="Description"
              className="w-full min-w-[10rem] border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900"
              value={descDrafts[`device:${device.id}`] ?? getDeviceProductDescription(device) ?? ''}
              disabled={savingRowKey === `device:${device.id}`}
              onChange={event => setDescDrafts(current => ({ ...current, [`device:${device.id}`]: event.target.value }))}
              onBlur={() => void commitDeviceDescription(device)}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </td>
          <td className="px-4 py-3 text-gray-700">{device.component_type || '-'}</td>
          <td className="px-4 py-3 text-gray-700">{device.mac_address || '-'}</td>
          <td className="px-4 py-3 text-gray-700">{device.model_number || '-'}</td>
          <td className="px-4 py-3">
            <span className={`text-xs px-2 py-1 rounded-full ${
              device.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}>
              {device.status === 'active' ? 'Active' : 'Pending Review'}
            </span>
          </td>
          <td className="px-4 py-3">
            <div className="flex items-center gap-2">
              {device.status === 'pending_review' && (
                <>
                  <button
                    onClick={() => handleApproveDevice(device.id)}
                    className="p-1 hover:bg-green-100 rounded text-green-600"
                    title="Approve"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    onClick={() => handleRejectDevice(device.id)}
                    className="p-1 hover:bg-red-100 rounded text-red-600"
                    title="Reject"
                  >
                    <X size={16} />
                  </button>
                </>
              )}
              <button
                onClick={() => setEditDevice(device)}
                className="p-1 hover:bg-cyan-100 rounded text-cyan-600"
                title="Rename / edit"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => handleDeleteDevice(device.id)}
                className="p-1 hover:bg-red-100 rounded text-red-600"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </td>
        </tr>
        {isExpanded && children.map((child) => renderDeviceRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading devices...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Summary Stats */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-lg border border-gray-200">
        {projectSystems.map((system) => {
          const style = getCategoryStyle(system.category);
          return (
            <div key={system.slug} className={`text-sm font-medium px-3 py-1 rounded-full border ${style.badgeClass}`}>
              {system.name}: {system.deviceCount}
            </div>
          );
        })}
        {pendingCount > 0 && (
          <div className="ml-auto text-sm font-medium px-3 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
            Pending Review: {pendingCount}
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg border border-gray-200">
        <input
          type="text"
          placeholder="Search devices..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg flex-1 min-w-[200px]"
        />
        <select
          value={selectedSystemType}
          onChange={(e) => setSelectedSystemType(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="All">All Systems</option>
          {projectSystems.map((system) => (
            <option key={system.slug} value={system.name}>
              {system.name}
            </option>
          ))}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value as 'All' | 'Active' | 'Pending Review')}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Pending Review">Pending Review</option>
        </select>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showComponents}
            onChange={(e) => setShowComponents(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm">Show Components</span>
        </label>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setViewMode('grouped')}
            className={`px-3 py-2 transition-colors ${viewMode === 'grouped' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Grouped View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('individual')}
            className={`px-3 py-2 border-l border-gray-300 transition-colors ${viewMode === 'individual' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Individual View
          </button>
        </div>
      </div>

      {/* Bulk Actions */}
      {viewMode === 'individual' && pendingCount > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleBulkApproveAll}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Bulk Approve All Pending ({pendingCount})
          </button>
        </div>
      )}

      {saveError && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {saveError}
        </div>
      )}

      {/* Device Table */}
      {viewMode === 'grouped' ? (
        equipmentGroups.length === 0 ? (
          <div className="p-8 text-center text-gray-500 bg-white rounded-lg border border-gray-200">
            No devices found matching the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200">
                  {['System Type', 'Description', 'Manufacturer', 'Model', 'Quantity', ''].map(h => (
                    <th key={h || 'actions'} className="px-4 py-3 text-left font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {equipmentGroups.map(row => {
                  const rowKey = getGroupRowKey(row);
                  const stableKey = row.devices.map(device => device.id).join('-');
                  return (
                    <tr key={stableKey} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <SystemTypeSelect
                          value={row.system_type}
                          options={systemTypeOptions}
                          disabled={savingRowKey === rowKey}
                          onChange={next => void commitGroupSystemType(row, next)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          placeholder="Description"
                          className="w-full min-w-[10rem] border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900"
                          value={descDrafts[rowKey] ?? row.description ?? ''}
                          disabled={savingRowKey === rowKey}
                          onChange={event => setDescDrafts(current => ({ ...current, [rowKey]: event.target.value }))}
                          onBlur={() => void commitGroupDescription(row)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-700">{row.manufacturer || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{row.model_number || '—'}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={1}
                          max={MAX_DEVICES_PER_LINE}
                          className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-semibold text-gray-900"
                          value={qtyDrafts[rowKey] ?? String(row.quantity)}
                          disabled={savingRowKey === rowKey}
                          onChange={event => setQtyDrafts(current => ({ ...current, [rowKey]: event.target.value }))}
                          onBlur={() => void commitGroupQuantity(row)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditGroup(row)}
                            className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg"
                            title="Rename / edit line"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteGroup(row)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Delete line"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : hierarchyTree.length === 0 ? (
        <div className="p-8 text-center text-gray-500 bg-white rounded-lg border border-gray-200">
          No devices found matching the selected filters.
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-semibold text-gray-900">Device Name</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">Description</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">Type</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">Manufacturer</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">Model</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody>
              {hierarchyTree.map((row) => renderDeviceRow(row))}
            </tbody>
          </table>
        </div>
      )}
      {projectIdNum && editGroup && (
        <EditEquipmentGroupModal
          projectId={projectIdNum}
          group={editGroup}
          prefixCounters={prefixCounters}
          projectSystems={projectSystems}
          onClose={() => setEditGroup(null)}
          onSaved={() => { setEditGroup(null); void fetchDevices({ silent: true }); }}
        />
      )}
      {editDevice && (
        <EditDeviceModal
          device={editDevice}
          productModels={productModels}
          projectSystemNames={projectSystems.map(system => system.name)}
          projectSystems={projectSystems}
          onClose={() => setEditDevice(null)}
          onSave={updated => {
            setEditDevice(null);
            if (updated) applyDevicePatch([updated.id], updated);
            else void fetchDevices({ silent: true });
          }}
        />
      )}
    </div>
  );
}
