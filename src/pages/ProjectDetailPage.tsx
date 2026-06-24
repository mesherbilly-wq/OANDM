import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Device, Project, ProductModel } from '../types';
import {
  ArrowLeft,
  Cpu,
  Search,
  CheckCircle,
  XCircle,
  ExternalLink,
  Plus,
  X,
  AlertCircle,
  Info,
  FolderOpen,
  Building,
  User,
  Calendar,
  Edit3,
  Trash2,
} from 'lucide-react';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [productModels, setProductModels] = useState<ProductModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [matchFilter, setMatchFilter] = useState('all');

  useEffect(() => {
    if (id) {
      fetchProject(parseInt(id));
      fetchDevices(parseInt(id));
      fetchProductModels();
    }
  }, [id]);

  const fetchProject = async (projectId: number) => {
    setLoading(true);
    const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
    if (error) {
      setError(`Failed to load project: ${error.message}`);
    } else {
      setProject(data);
    }
    setLoading(false);
  };

  const fetchDevices = async (projectId: number) => {
    setDevicesLoading(true);
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      setError(`Failed to load devices: ${error.message}`);
    } else {
      setDevices(data ?? []);
    }
    setDevicesLoading(false);
  };

  const fetchProductModels = async () => {
    const { data } = await supabase.from('product_models').select('*').order('manufacturer');
    if (data) setProductModels(data);
  };

  const handleAddDevice = async (deviceData: Partial<Device>): Promise<string | null> => {
    const { data, error } = await supabase
      .from('devices')
      .insert({ ...deviceData, project_id: parseInt(id!) })
      .select()
      .single();

    if (error) return `Failed to add device: ${error.message}`;
    if (data) setDevices([data, ...devices]);
    setShowAddModal(false);
    return null;
  };

  const handleDeleteDevice = async (deviceId: number) => {
    if (!confirm('Delete this device?')) return;
    const { error } = await supabase.from('devices').delete().eq('id', deviceId);
    if (!error) setDevices(devices.filter((d) => d.id !== deviceId));
  };

  const filteredDevices = devices.filter((d) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      d.device_name?.toLowerCase().includes(q) ||
      d.manufacturer?.toLowerCase().includes(q) ||
      d.model_number?.toLowerCase().includes(q) ||
      d.ip_address?.toLowerCase().includes(q) ||
      d.location?.toLowerCase().includes(q);
    const matchesType = typeFilter === 'all' || d.device_type === typeFilter;
    const matchesStatus =
      matchFilter === 'all' ||
      (matchFilter === 'matched' && d.matched) ||
      (matchFilter === 'unmatched' && !d.matched);
    return matchesSearch && matchesType && matchesStatus;
  });

  const deviceTypes = [...new Set(devices.map((d) => d.device_type).filter(Boolean))];
  const stats = {
    total: devices.length,
    matched: devices.filter((d) => d.matched).length,
    datasheets: devices.filter((d) => d.datasheet_found).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
          <AlertCircle className="w-5 h-5" />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Back + title */}
      <div className="mb-6">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-cyan-100 rounded-xl flex items-center justify-center">
              <FolderOpen className="w-6 h-6 text-cyan-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{project?.project_name || 'Untitled Project'}</h1>
              <p className="text-slate-500 mt-0.5">
                {[project?.client_name, project?.site_name].filter(Boolean).join(' — ') || 'No client / site'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Project info bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div className="flex items-center gap-2 text-slate-600">
          <Building className="w-4 h-4 text-slate-400" />
          <div>
            <p className="text-xs text-slate-400">Client</p>
            <p className="font-medium text-slate-900">{project?.client_name || '-'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <FolderOpen className="w-4 h-4 text-slate-400" />
          <div>
            <p className="text-xs text-slate-400">Site</p>
            <p className="font-medium text-slate-900">{project?.site_name || '-'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <User className="w-4 h-4 text-slate-400" />
          <div>
            <p className="text-xs text-slate-400">Project Manager</p>
            <p className="font-medium text-slate-900">{project?.project_manager || '-'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <Calendar className="w-4 h-4 text-slate-400" />
          <div>
            <p className="text-xs text-slate-400">Start Date</p>
            <p className="font-medium text-slate-900">
              {project?.start_date ? new Date(project.start_date).toLocaleDateString() : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-slate-200 px-5 py-4">
          <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
          <p className="text-sm text-slate-500 mt-0.5">Total Devices</p>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 px-5 py-4">
          <p className="text-2xl font-bold text-green-600">{stats.matched}</p>
          <p className="text-sm text-green-700 mt-0.5">Matched</p>
        </div>
        <div className="bg-blue-50 rounded-lg border border-blue-200 px-5 py-4">
          <p className="text-2xl font-bold text-blue-600">{stats.datasheets}</p>
          <p className="text-sm text-blue-700 mt-0.5">With Datasheet</p>
        </div>
      </div>

      {/* Devices section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-slate-400" />
          Devices
        </h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-lg hover:bg-cyan-700 transition-colors font-medium text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Device
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search devices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="all">All Types</option>
          {deviceTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={matchFilter}
          onChange={(e) => setMatchFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="all">All Status</option>
          <option value="matched">Matched</option>
          <option value="unmatched">Unmatched</option>
        </select>
      </div>

      {devicesLoading ? (
        <div className="text-center py-10">
          <div className="w-6 h-6 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading devices...</p>
        </div>
      ) : filteredDevices.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-xl border border-slate-200">
          <Cpu className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="font-medium text-slate-900 mb-1">
            {devices.length === 0 ? 'No devices yet' : 'No devices match your filters'}
          </h3>
          <p className="text-slate-500 text-sm mb-5">
            {devices.length === 0 ? 'Add your first device to this project' : 'Try adjusting your search or filters'}
          </p>
          {devices.length === 0 && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-lg hover:bg-cyan-700 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              Add Device
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Device</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Manufacturer / Model</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">IP</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDevices.map((device) => (
                  <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Cpu className="w-4 h-4 text-slate-500" />
                        </div>
                        <p className="font-medium text-slate-900 text-sm">{device.device_name || '-'}</p>
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
                            <CheckCircle className="w-3 h-3" />
                            Matched
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                            <XCircle className="w-3 h-3" />
                            Unmatched
                          </span>
                        )}
                        {device.datasheet_found && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                            <ExternalLink className="w-3 h-3" />
                            Datasheet
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleDeleteDevice(device.id)}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="Delete device"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-3 text-xs text-slate-400">
        {filteredDevices.length} of {devices.length} devices
      </div>

      {showAddModal && (
        <AddDeviceModal
          productModels={productModels}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddDevice}
        />
      )}
    </div>
  );
}

const OTHER_OPTION = '__OTHER__';

function AddDeviceModal({
  productModels,
  onClose,
  onAdd,
}: {
  productModels: ProductModel[];
  onClose: () => void;
  onAdd: (device: Partial<Device>) => Promise<string | null>;
}) {
  const [modelSearch, setModelSearch] = useState('');
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [isOther, setIsOther] = useState(false);

  const [deviceType, setDeviceType] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const DEVICE_TYPES = ['Camera', 'Door', 'Access Control', 'Recorder', 'Sensor', 'Intercom', 'Other'];

  const manufacturers = useMemo(
    () => [...new Set(productModels.map((m) => m.manufacturer).filter(Boolean))].sort() as string[],
    [productModels]
  );

  const filteredModels = useMemo(() => {
    const q = modelSearch.toLowerCase();
    return productModels.filter((m) => {
      const matchesMfr = !selectedManufacturer || m.manufacturer === selectedManufacturer;
      const matchesSearch =
        !q ||
        m.manufacturer?.toLowerCase().includes(q) ||
        m.model_number?.toLowerCase().includes(q) ||
        m.model_name?.toLowerCase().includes(q);
      return matchesMfr && matchesSearch;
    });
  }, [productModels, selectedManufacturer, modelSearch]);

  const selectedModel = productModels.find((m) => m.id === selectedModelId) ?? null;

  const handleModelSelect = (model: ProductModel) => {
    setSelectedModelId(model.id);
    setIsOther(false);
    setManufacturer(model.manufacturer ?? '');
    setModelNumber(model.model_number ?? '');
    setDeviceType(model.device_type ?? '');
    setSelectedManufacturer(model.manufacturer ?? '');
  };

  const handleOtherSelect = () => {
    setSelectedModelId(null);
    setIsOther(true);
    setManufacturer('');
    setModelNumber('');
    setDeviceType('');
  };

  const handleManufacturerChange = (mfr: string) => {
    setSelectedManufacturer(mfr);
    setSelectedModelId(null);
    setIsOther(false);
    setManufacturer(mfr !== OTHER_OPTION ? mfr : '');
    setModelNumber('');
    setDeviceType('');
    setModelSearch('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const err = await onAdd({
      device_name: deviceName || null,
      device_type: deviceType || null,
      manufacturer: manufacturer || null,
      model_number: modelNumber || null,
      serial_number: serialNumber || null,
      ip_address: ipAddress || null,
      location: location || null,
      notes: notes || null,
      matched: !!selectedModel,
      datasheet_found: false,
    });

    if (err) {
      setError(err);
      setSaving(false);
    }
  };

  const inputClass =
    'w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 bg-white';
  const modelSelected = selectedModelId !== null || isOther;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-xl font-semibold text-slate-900">Add Device</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 p-6 space-y-6">
            {error && (
              <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <section>
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">1. Select Product Model</h3>
              <div className="flex gap-3 mb-3">
                <select
                  value={selectedManufacturer}
                  onChange={(e) => handleManufacturerChange(e.target.value)}
                  className={inputClass}
                >
                  <option value="">All Manufacturers</option>
                  {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search model..."
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 bg-white"
                  />
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                  {filteredModels.map((model) => {
                    const isSelected = selectedModelId === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => handleModelSelect(model)}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                          isSelected ? 'bg-cyan-50 border-l-2 border-cyan-500' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-slate-900 text-sm">{model.model_name || model.model_number}</span>
                            <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{model.model_number}</span>
                            {model.device_type && (
                              <span className="text-xs text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded">{model.device_type}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{model.manufacturer}</p>
                        </div>
                        {isSelected && <CheckCircle className="w-4 h-4 text-cyan-600 flex-shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                  {filteredModels.length === 0 && (
                    <div className="px-4 py-4 text-center text-sm text-slate-400">No models match your search</div>
                  )}
                  <button
                    type="button"
                    onClick={handleOtherSelect}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                      isOther ? 'bg-amber-50 border-l-2 border-amber-400' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex-1">
                      <span className="font-medium text-slate-700 text-sm">Other / Not Listed</span>
                      <p className="text-xs text-slate-400">Enter manufacturer and model manually</p>
                    </div>
                    {isOther && <CheckCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                  </button>
                </div>
              </div>
            </section>

            {selectedModel && (
              <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Info className="w-4 h-4 text-cyan-600" />
                  <span className="text-sm font-semibold text-cyan-800">Selected Product</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div><span className="text-slate-500">Manufacturer</span><p className="font-medium text-slate-900">{selectedModel.manufacturer}</p></div>
                  <div><span className="text-slate-500">Model Number</span><p className="font-medium text-slate-900 font-mono">{selectedModel.model_number}</p></div>
                  <div><span className="text-slate-500">Model Name</span><p className="font-medium text-slate-900">{selectedModel.model_name || '-'}</p></div>
                  <div><span className="text-slate-500">Device Type</span><p className="font-medium text-slate-900">{selectedModel.device_type || '-'}</p></div>
                  {selectedModel.warranty_years && (
                    <div><span className="text-slate-500">Warranty</span><p className="font-medium text-slate-900">{selectedModel.warranty_years} years</p></div>
                  )}
                  {selectedModel.maintenance_notes && (
                    <div className="col-span-2"><span className="text-slate-500">Maintenance Notes</span><p className="text-slate-700 mt-0.5">{selectedModel.maintenance_notes}</p></div>
                  )}
                </div>
              </div>
            )}

            {isOther && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">Manual Entry — Not in Product Library</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Manufacturer</label>
                    <input type="text" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={inputClass} placeholder="e.g., Axis" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Model Number</label>
                    <input type="text" value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} className={inputClass} placeholder="e.g., P3245-V" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-2">Device Type</label>
                    <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className={inputClass}>
                      <option value="">Select type...</option>
                      {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {modelSelected && (
              <section>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">2. Device Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-2">Device Name</label>
                    <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className={inputClass} placeholder="e.g., Lobby Camera 01" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Serial Number</label>
                    <input type="text" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className={inputClass} placeholder="e.g., ACCC12345678" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">IP Address</label>
                    <input type="text" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} className={inputClass} placeholder="e.g., 192.168.1.100" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Location</label>
                    <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} placeholder="e.g., Level 1 — Main Lobby" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Notes</label>
                    <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Optional notes" />
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="px-6 py-4 bg-slate-50 rounded-b-2xl flex justify-between items-center border-t border-slate-200 flex-shrink-0">
            <p className="text-xs text-slate-400">
              {!modelSelected ? 'Select a product model to continue' : selectedModel ? `${selectedModel.manufacturer} — ${selectedModel.model_number}` : 'Manual entry'}
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors">Cancel</button>
              <button type="submit" disabled={saving || !modelSelected} className="px-5 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {saving ? 'Saving...' : 'Add Device'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

