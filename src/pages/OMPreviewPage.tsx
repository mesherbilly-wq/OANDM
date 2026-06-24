import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Project, Device, ProductModel, Datasheet } from '../types';
import {
  FileText,
  CheckCircle,
  XCircle,
  AlertCircle,
  ExternalLink,
  Search,
  FolderOpen,
  Cpu,
  Eye,
} from 'lucide-react';

interface DeviceWithMatch extends Device {
  productModel: ProductModel | null;
  datasheet: Datasheet | null;
}

export function OMPreviewPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [devices, setDevices] = useState<DeviceWithMatch[]>([]);
  const [productModels, setProductModels] = useState<ProductModel[]>([]);
  const [datasheets, setDatasheets] = useState<Datasheet[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchProjects();
    fetchProductModels();
    fetchDatasheets();
  }, []);

  useEffect(() => {
    if (selectedProjectId && productModels.length >= 0 && datasheets.length >= 0) {
      fetchDevicesForProject();
    }
  }, [selectedProjectId, productModels, datasheets]);

  const fetchProjects = async () => {
    const { data, error } = await supabase.from('projects').select('*').order('project_name');
    if (error) {
      setLoadError(`Failed to load projects: ${error.message}`);
    } else if (data) {
      setProjects(data);
    }
  };

  const fetchProductModels = async () => {
    const { data, error } = await supabase.from('product_models').select('*');
    if (!error && data) setProductModels(data);
  };

  const fetchDatasheets = async () => {
    const { data, error } = await supabase.from('datasheets').select('*');
    if (!error && data) setDatasheets(data);
  };

  const fetchDevicesForProject = async () => {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('project_id', parseInt(selectedProjectId))
      .order('device_name');

    if (error) {
      setLoadError(`Failed to load devices: ${error.message}`);
      setDevices([]);
      setLoading(false);
      return;
    }

    const devicesWithMatches: DeviceWithMatch[] = (data || []).map((device) => {
      const mfr = device.manufacturer?.trim().toLowerCase();
      const model = device.model_number?.trim().toLowerCase();

      const productModel =
        productModels.find(
          (pm) =>
            pm.manufacturer?.trim().toLowerCase() === mfr &&
            pm.model_number?.trim().toLowerCase() === model
        ) ?? null;

      // Only match datasheets that have a non-empty datasheet_url
      const datasheet =
        datasheets.find(
          (ds) =>
            ds.manufacturer?.trim().toLowerCase() === mfr &&
            ds.model_number?.trim().toLowerCase() === model &&
            ds.datasheet_url?.trim()
        ) ?? null;

      return { ...device, productModel, datasheet };
    });

    setDevices(devicesWithMatches);
    setLoading(false);
  };

  const selectedProject = projects.find((p) => p.id === parseInt(selectedProjectId));

  const filteredDevices = devices.filter(
    (d) =>
      d.device_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.manufacturer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.model_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.location?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const summaryStats = {
    total: devices.length,
    matched: devices.filter((d) => d.productModel && d.datasheet).length,
    modelOnly: devices.filter((d) => d.productModel && !d.datasheet).length,
    datasheetOnly: devices.filter((d) => !d.productModel && d.datasheet).length,
    noMatch: devices.filter((d) => !d.productModel && !d.datasheet).length,
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">O&M Preview</h1>
        <p className="text-slate-500 mt-1">
          Select a project to preview device matching and datasheet availability
        </p>
      </div>

      {loadError && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{loadError}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-2">Select Project</label>
            <div className="relative">
              <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg pl-11 pr-8 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="">Choose a project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_name}{p.client_name ? ` — ${p.client_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedProject && (
            <div className="text-sm text-slate-500 space-y-1">
              {selectedProject.client_name && (
                <p><span className="font-medium text-slate-700">Client:</span> {selectedProject.client_name}</p>
              )}
              {selectedProject.site_name && (
                <p><span className="font-medium text-slate-700">Site:</span> {selectedProject.site_name}</p>
              )}
              {selectedProject.project_manager && (
                <p><span className="font-medium text-slate-700">PM:</span> {selectedProject.project_manager}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {!selectedProjectId ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">Select a Project</h3>
          <p className="text-slate-500">Choose a project from the dropdown above to preview devices</p>
        </div>
      ) : loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500">Loading devices...</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-2xl font-bold text-slate-900">{summaryStats.total}</p>
              <p className="text-slate-500 text-sm mt-1">Total Devices</p>
            </div>
            <div className="bg-green-50 rounded-lg border border-green-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <p className="text-2xl font-bold text-green-600">{summaryStats.matched}</p>
              </div>
              <p className="text-green-700 text-sm">Model + Datasheet</p>
            </div>
            <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <p className="text-2xl font-bold text-amber-600">{summaryStats.modelOnly}</p>
              </div>
              <p className="text-amber-700 text-sm">Model, No Datasheet</p>
            </div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-red-600" />
                <p className="text-2xl font-bold text-red-600">{summaryStats.noMatch}</p>
              </div>
              <p className="text-red-700 text-sm">No Match</p>
            </div>
          </div>

          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search devices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>

          {filteredDevices.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <Cpu className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600">No devices found for this project</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Device</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Manufacturer / Model</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Product Match</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Datasheet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDevices.map((device) => (
                      <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium text-slate-900">{device.device_name || '-'}</p>
                            <p className="text-xs text-slate-400 font-mono">{device.ip_address || 'No IP'}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded">
                            {device.device_type || '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-slate-900">{device.manufacturer || '-'}</p>
                          <p className="text-xs text-slate-500 font-mono">{device.model_number || '-'}</p>
                        </td>
                        <td className="px-6 py-4 text-slate-600">{device.location || '-'}</td>
                        <td className="px-6 py-4">
                          {device.productModel ? (
                            <div className="flex items-start gap-2">
                              <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="text-sm text-slate-900 leading-tight">{device.productModel.model_name}</p>
                                {device.productModel.warranty_years && (
                                  <p className="text-xs text-slate-500">{device.productModel.warranty_years}yr warranty</p>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-amber-600">
                              <AlertCircle className="w-4 h-4" />
                              <span className="text-sm">No match</span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {device.datasheet ? (
                            <a
                              href={device.datasheet.datasheet_url!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                              View Datasheet
                            </a>
                          ) : (
                            <div className="flex items-center gap-2 text-slate-400">
                              <XCircle className="w-4 h-4" />
                              <span className="text-sm">No datasheet</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4 text-sm text-slate-500">
            Showing {filteredDevices.length} of {devices.length} devices
          </div>
        </>
      )}
    </div>
  );
}
