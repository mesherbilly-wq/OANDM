import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertCircle, Search, CheckCircle, Link as LinkIcon, Unlink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Device, ProductModel } from '../types';

const DEVICE_TYPES = ['Camera', 'Door', 'Door Controller', 'Access Reader', 'Recorder', 'Sensor', 'Intercom', 'Network Switch', 'Other'];

interface Props {
  device: Device;
  productModels: ProductModel[];
  projectSystemNames?: string[];
  onClose: () => void;
  onSave: (updated?: Device) => void;
}

export function EditDeviceModal({ device, productModels, projectSystemNames = [], onClose, onSave }: Props) {
  // Resolve initial linked product model
  const initialLinked = useMemo(() =>
    productModels.find(
      (pm) =>
        pm.manufacturer?.trim().toLowerCase() === device.manufacturer?.trim().toLowerCase() &&
        pm.model_number?.trim().toLowerCase() === device.model_number?.trim().toLowerCase()
    ) ?? null,
    []
  );

  const [linkedModel, setLinkedModel] = useState<ProductModel | null>(initialLinked);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [systemType, setSystemType] = useState<string>(device.system_type ?? '');
  const [deviceName, setDeviceName] = useState(device.device_name ?? '');
  const [deviceType, setDeviceType] = useState(device.device_type ?? '');
  const [manufacturer, setManufacturer] = useState(device.manufacturer ?? '');
  const [modelNumber, setModelNumber] = useState(device.model_number ?? '');
  const [modelName, setModelName] = useState(device.model_name ?? '');
  const [serialNumber, setSerialNumber] = useState(device.serial_number ?? '');
  const [ipAddress, setIpAddress] = useState(device.ip_address ?? '');
  const [location, setLocation] = useState(device.location ?? '');
  const [notes, setNotes] = useState(device.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pickerResults = useMemo(() => {
    const q = pickerSearch.toLowerCase();
    if (!q) return productModels.slice(0, 40);
    return productModels.filter(
      (pm) =>
        pm.manufacturer?.toLowerCase().includes(q) ||
        pm.model_number?.toLowerCase().includes(q) ||
        pm.model_name?.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [productModels, pickerSearch]);

  const handleLinkModel = (pm: ProductModel) => {
    setLinkedModel(pm);
    setManufacturer(pm.manufacturer ?? '');
    setModelNumber(pm.model_number ?? '');
    if (pm.device_type) setDeviceType(pm.device_type);
    setPickerOpen(false);
    setPickerSearch('');
  };

  const handleUnlink = () => {
    setLinkedModel(null);
  };

  const ic = 'w-full border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 bg-white text-sm';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const updates = {
      system_type: systemType.trim() || null,
      device_name: deviceName || null,
      device_type: deviceType || null,
      manufacturer: manufacturer || null,
      model_number: modelNumber || null,
      model_name: modelName || null,
      serial_number: serialNumber || null,
      ip_address: ipAddress || null,
      location: location || null,
      notes: notes || null,
      matched: linkedModel !== null,
    };

    const { data, error } = await supabase
      .from('devices')
      .update(updates)
      .eq('id', device.id)
      .select()
      .single();

    if (error) { setError(error.message); setSaving(false); return; }
    onSave(data);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Edit Device</h2>
            <p className="text-xs text-slate-400 mt-0.5">{device.device_name || 'Unnamed device'}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 p-5 space-y-5">
            {error && (
              <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {/* Product Library Linker */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Product Library Link</h3>
                {linkedModel && (
                  <button type="button" onClick={handleUnlink}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 transition-colors">
                    <Unlink className="w-3 h-3" />
                    Unlink
                  </button>
                )}
              </div>

              {linkedModel ? (
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-900">
                      {linkedModel.model_name || linkedModel.model_number}
                    </p>
                    <p className="text-xs text-green-700">
                      {linkedModel.manufacturer} · <span className="font-mono">{linkedModel.model_number}</span>
                      {linkedModel.warranty_years && ` · ${linkedModel.warranty_years}yr warranty`}
                    </p>
                  </div>
                  <button type="button" onClick={() => setPickerOpen(true)}
                    className="text-xs text-green-700 hover:text-green-900 underline underline-offset-2">
                    Change
                  </button>
                </div>
              ) : (
                <div ref={pickerRef} className="relative">
                  <div
                    onClick={() => setPickerOpen(true)}
                    className="flex items-center gap-2 border border-slate-300 rounded-lg px-3.5 py-2.5 cursor-text hover:border-cyan-400 transition-colors"
                  >
                    <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => { setPickerSearch(e.target.value); setPickerOpen(true); }}
                      onFocus={() => setPickerOpen(true)}
                      placeholder="Search product library to link..."
                      className="flex-1 text-sm outline-none bg-transparent text-slate-900 placeholder-slate-400"
                    />
                  </div>

                  {pickerOpen && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                      <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                        {pickerResults.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-4">No matches found</p>
                        ) : (
                          pickerResults.map((pm) => (
                            <button
                              key={pm.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleLinkModel(pm)}
                              className="w-full text-left px-4 py-2.5 hover:bg-cyan-50 transition-colors flex items-center gap-3"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-900">
                                    {pm.model_name || pm.model_number}
                                  </span>
                                  <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {pm.model_number}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {pm.manufacturer}
                                  {pm.device_type && <span className="ml-2 text-cyan-700">{pm.device_type}</span>}
                                </p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                      <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
                        <p className="text-xs text-slate-400">
                          {pickerResults.length} of {productModels.length} models
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <hr className="border-slate-100" />

            {/* Fields grid */}
            <section>
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Device Details</h3>
              <div className="grid grid-cols-2 gap-3.5">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Device Name</label>
                  <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)}
                    className={ic} placeholder="e.g. Lobby Camera 01" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">System</label>
                  <input
                    list="project-system-names"
                    value={systemType}
                    onChange={(e) => setSystemType(e.target.value)}
                    className={ic}
                    placeholder="e.g. Level 1 Access Control"
                  />
                  <datalist id="project-system-names">
                    {projectSystemNames.map(name => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Device Type</label>
                  <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className={ic}>
                    <option value="">Select type...</option>
                    {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Manufacturer</label>
                  <input value={manufacturer} onChange={(e) => { setManufacturer(e.target.value); setLinkedModel(null); }}
                    className={ic} placeholder="e.g. Axis" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Model Number</label>
                  <input value={modelNumber} onChange={(e) => { setModelNumber(e.target.value); setLinkedModel(null); }}
                    className={ic} placeholder="e.g. P3245-LVE" />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Model Name</label>
                  <input value={modelName} onChange={(e) => setModelName(e.target.value)}
                    className={ic} placeholder="Optional long description" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Serial Number</label>
                  <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)}
                    className={ic} placeholder="e.g. ACCC12345678" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">IP Address</label>
                  <input value={ipAddress} onChange={(e) => setIpAddress(e.target.value)}
                    className={ic} placeholder="e.g. 192.168.1.100" />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Location</label>
                  <input value={location} onChange={(e) => setLocation(e.target.value)}
                    className={ic} placeholder="e.g. Level 1 — Main Lobby" />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Notes</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                    rows={2} className={`${ic} resize-none`} placeholder="Optional notes" />
                </div>
              </div>
            </section>
          </div>

          <div className="px-5 py-4 bg-slate-50 rounded-b-2xl flex justify-between items-center border-t border-slate-200 flex-shrink-0">
            <div>
              {linkedModel ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded">
                  <LinkIcon className="w-3 h-3" />Linked to product library
                </span>
              ) : (
                <span className="text-xs text-slate-400">Not linked to product library</span>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="px-5 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
