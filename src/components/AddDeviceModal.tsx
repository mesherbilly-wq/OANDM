import React, { useState, useMemo } from 'react';
import { Search, CheckCircle, X, AlertCircle, Info } from 'lucide-react';
import type { Device, ProductModel, SystemType } from '../types';

const DEVICE_TYPES = ['Camera', 'Door', 'Access Control', 'Recorder', 'Sensor', 'Intercom', 'Network Switch', 'Other'];

interface Props {
  productModels: ProductModel[];
  datasheets: Array<{ manufacturer: string | null; model_number: string | null; datasheet_url: string | null }>;
  defaultSystemType?: SystemType;
  onClose: () => void;
  onAdd: (device: Partial<Device>) => Promise<string | null>;
}

export function AddDeviceModal({ productModels, datasheets, defaultSystemType, onClose, onAdd }: Props) {
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

  const handleManufacturerChange = (mfr: string) => {
    setSelectedManufacturer(mfr);
    setSelectedModelId(null);
    setIsOther(false);
    setManufacturer(mfr);
    setModelNumber('');
    setDeviceType('');
    setModelSearch('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const mfr = (selectedModel?.manufacturer ?? manufacturer).trim().toLowerCase();
    const model = (selectedModel?.model_number ?? modelNumber).trim().toLowerCase();
    const hasDatasheet = datasheets.some(
      (ds) =>
        ds.manufacturer?.trim().toLowerCase() === mfr &&
        ds.model_number?.trim().toLowerCase() === model &&
        ds.datasheet_url?.trim()
    );

    const err = await onAdd({
      system_type: defaultSystemType ?? null,
      device_name: deviceName || null,
      device_type: deviceType || null,
      manufacturer: manufacturer || null,
      model_number: modelNumber || null,
      serial_number: serialNumber || null,
      ip_address: ipAddress || null,
      location: location || null,
      notes: notes || null,
      matched: !!selectedModel,
      datasheet_found: hasDatasheet,
    });

    if (err) { setError(err); setSaving(false); }
  };

  const ic = 'w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 bg-white';
  const modelSelected = selectedModelId !== null || isOther;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Add Device</h2>
            {defaultSystemType && (
              <p className="text-sm text-slate-400 mt-0.5">Adding to <span className="font-medium text-slate-600">{defaultSystemType}</span> system</p>
            )}
          </div>
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
                <select value={selectedManufacturer} onChange={(e) => handleManufacturerChange(e.target.value)} className={ic}>
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
                    const isSel = selectedModelId === model.id;
                    return (
                      <button key={model.id} type="button" onClick={() => handleModelSelect(model)}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${isSel ? 'bg-cyan-50 border-l-2 border-cyan-500' : 'hover:bg-slate-50'}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-slate-900 text-sm">{model.model_name || model.model_number}</span>
                            <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{model.model_number}</span>
                            {model.device_type && <span className="text-xs text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded">{model.device_type}</span>}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{model.manufacturer}</p>
                        </div>
                        {isSel && <CheckCircle className="w-4 h-4 text-cyan-600 flex-shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                  {filteredModels.length === 0 && (
                    <div className="px-4 py-4 text-center text-sm text-slate-400">No models match your search</div>
                  )}
                  <button type="button" onClick={() => { setSelectedModelId(null); setIsOther(true); setManufacturer(''); setModelNumber(''); setDeviceType(''); }}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${isOther ? 'bg-amber-50 border-l-2 border-amber-400' : 'hover:bg-slate-50'}`}>
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
              <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4 text-cyan-600" />
                  <span className="text-sm font-semibold text-cyan-800">Selected Product</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div><span className="text-slate-500">Manufacturer</span><p className="font-medium text-slate-900">{selectedModel.manufacturer}</p></div>
                  <div><span className="text-slate-500">Model Number</span><p className="font-medium text-slate-900 font-mono">{selectedModel.model_number}</p></div>
                  <div><span className="text-slate-500">Model Name</span><p className="font-medium text-slate-900">{selectedModel.model_name || '-'}</p></div>
                  <div><span className="text-slate-500">Device Type</span><p className="font-medium text-slate-900">{selectedModel.device_type || '-'}</p></div>
                  {selectedModel.warranty_years && <div><span className="text-slate-500">Warranty</span><p className="font-medium text-slate-900">{selectedModel.warranty_years} years</p></div>}
                  {selectedModel.maintenance_notes && <div className="col-span-2"><span className="text-slate-500">Maintenance Notes</span><p className="text-slate-700 mt-0.5">{selectedModel.maintenance_notes}</p></div>}
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
                    <input type="text" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={ic} placeholder="e.g., Axis" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Model Number</label>
                    <input type="text" value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} className={ic} placeholder="e.g., P3245-V" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-2">Device Type</label>
                    <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className={ic}>
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
                    <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className={ic} placeholder="e.g., Lobby Camera 01" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Serial Number</label>
                    <input type="text" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className={ic} placeholder="e.g., ACCC12345678" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">IP Address</label>
                    <input type="text" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} className={ic} placeholder="e.g., 192.168.1.100" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Location</label>
                    <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={ic} placeholder="e.g., Level 1 — Main Lobby" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Notes</label>
                    <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={ic} placeholder="Optional notes" />
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="px-6 py-4 bg-slate-50 rounded-b-2xl flex justify-between items-center border-t border-slate-200 flex-shrink-0">
            <p className="text-xs text-slate-400">
              {!modelSelected ? 'Select a product model to continue'
                : selectedModel ? `${selectedModel.manufacturer} — ${selectedModel.model_number}`
                : 'Manual entry'}
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors">Cancel</button>
              <button type="submit" disabled={saving || !modelSelected}
                className="px-5 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {saving ? 'Saving...' : 'Add Device'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
