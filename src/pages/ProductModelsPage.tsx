import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ProductModel } from '../types';
import { Box, Search, Filter, Calendar, Shield, Camera, DoorClosed, HardDrive, Activity } from 'lucide-react';

const deviceTypeIcons: Record<string, React.ElementType> = {
  Camera: Camera,
  Door: DoorClosed,
  'Access Control': Shield,
  Recorder: HardDrive,
  Sensor: Activity,
};

export function ProductModelsPage() {
  const [models, setModels] = useState<ProductModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [manufacturerFilter, setManufacturerFilter] = useState<string>('all');

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('product_models')
      .select('*')
      .order('manufacturer', { ascending: true });

    if (!error && data) {
      setModels(data);
    }
    setLoading(false);
  };

  const manufacturers = [...new Set(models.map((m) => m.manufacturer).filter(Boolean))].sort();
  const deviceTypes = [...new Set(models.map((m) => m.device_type).filter(Boolean))].sort();

  const filteredModels = models.filter((m) => {
    const matchesSearch =
      m.manufacturer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.model_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.model_name?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = typeFilter === 'all' || m.device_type === typeFilter;
    const matchesManufacturer = manufacturerFilter === 'all' || m.manufacturer === manufacturerFilter;

    return matchesSearch && matchesType && matchesManufacturer;
  });

  const getIcon = (deviceType: string | null) => {
    if (!deviceType) return Box;
    return deviceTypeIcons[deviceType] || Box;
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Product Models</h1>
        <p className="text-slate-500 mt-1">Database of supported product models</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={manufacturerFilter}
            onChange={(e) => setManufacturerFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="all">All Manufacturers</option>
            {manufacturers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="all">All Types</option>
            {deviceTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500">Loading product models...</p>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <Box className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No product models found</h3>
          <p className="text-slate-500">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Manufacturer
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Model Number
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Device Type
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Warranty
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredModels.map((model) => {
                  const Icon = getIcon(model.device_type);
                  return (
                    <tr key={model.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                            <Icon className="w-5 h-5 text-slate-600" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{model.model_name || '-'}</p>
                            <p className="text-xs text-slate-400">ID: {model.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 text-xs font-medium bg-cyan-50 text-cyan-700 rounded">
                          {model.manufacturer || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-mono text-sm">
                        {model.model_number || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded">
                          {model.device_type || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-slate-600">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <span>{model.warranty_years ? `${model.warranty_years} years` : '-'}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 text-sm text-slate-500">
        Showing {filteredModels.length} of {models.length} product models
      </div>
    </div>
  );
}
