import React, { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import { groupDevices } from '../lib/deviceGrouping';
import { fetchProjectDevices } from '../lib/fetchProjectDevices';
import { loadProjectSystemsForProject } from '../lib/projectSystemsDb';
import { deriveProjectSystems, getCategoryStyle } from '../lib/systems';
import { Device, ProjectSystemRecord } from '../types';
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
};

function systemBadgeClass(systemName: string | null): string {
  if (!systemName) return 'bg-slate-100 text-slate-700 border-slate-200';
  return SYSTEM_TYPE_COLORS[systemName] ?? 'bg-slate-100 text-slate-700 border-slate-200';
}

interface DeviceRow {
  device: Device;
  children: DeviceRow[];
  isExpanded?: boolean;
}

export default function DeviceSchedulePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const { project } = useProject();
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

  React.useEffect(() => {
    fetchDevices();
  }, [projectId]);

  const fetchDevices = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const projectIdNum = parseInt(projectId, 10);
      const data = await fetchProjectDevices(projectIdNum);
      const systems = await loadProjectSystemsForProject(projectIdNum, data);
      setDevices(data);
      setSystemRows(systems);
    } catch (error) {
      console.error('Failed to fetch devices:', error);
    } finally {
      setLoading(false);
    }
  };

  const projectSystems = useMemo(
    () => deriveProjectSystems(devices, systemRows),
    [devices, systemRows],
  );

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
      if (searchTerm && !device.device_name.toLowerCase().includes(searchTerm.toLowerCase())) {
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

  const handleApproveDevice = async (deviceId: string) => {
    try {
      const { error } = await supabase
        .from('devices')
        .update({ status: 'active' })
        .eq('id', deviceId);

      if (error) throw error;
      await fetchDevices();
    } catch (error) {
      console.error('Failed to approve device:', error);
    }
  };

  const handleRejectDevice = async (deviceId: string) => {
    try {
      const { error } = await supabase.from('devices').delete().eq('id', deviceId);

      if (error) throw error;
      await fetchDevices();
    } catch (error) {
      console.error('Failed to reject device:', error);
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    if (confirm('Are you sure you want to delete this device?')) {
      try {
        const { error } = await supabase.from('devices').delete().eq('id', deviceId);

        if (error) throw error;
        await fetchDevices();
      } catch (error) {
        console.error('Failed to delete device:', error);
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
        await fetchDevices();
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
              <span className={`text-xs px-2 py-1 rounded border ${systemBadgeClass(device.system_type)}`}>
                {device.system_type ?? 'Unnamed System'}
              </span>
              {isOrphan && (
                <AlertCircle size={16} className="text-yellow-500" title="Parent device not found" />
              )}
            </div>
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
                  {['System Type', 'Description', 'Manufacturer', 'Model', 'Quantity'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {equipmentGroups.map(row => (
                  <tr key={`${row.system_type}|${row.manufacturer}|${row.model_number}|${row.description}`} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {row.system_type ? (
                        <span className={`text-xs px-2 py-1 rounded border ${SYSTEM_TYPE_COLORS[row.system_type]}`}>
                          {row.system_type}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.description || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{row.manufacturer || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{row.model_number || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{row.quantity}</td>
                  </tr>
                ))}
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
    </div>
  );
}
