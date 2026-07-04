import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ProductModel } from '../types';
import {
  Box,
  Search,
  Download,
  Upload,
  Trash2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { ProductDatabaseImportModal } from '../components/ProductDatabaseImportModal';
import { exportProductDatabaseBackup, fetchAllProductModels, wipeProductDatabase } from '../lib/productDatabaseDb';
import {
  DEFAULT_PRODUCT_WARRANTY_YEARS,
  PRODUCT_DATABASE_CSV_HEADERS,
} from '../lib/productDatabaseCsv';
import { formatWarrantyYears } from '../lib/deviceProductFields';

type ProductField = 'device_type' | 'category' | 'model_name' | 'manufacturer' | 'model_number' | 'warranty_years';

type EditingCell = { id: number; field: ProductField; draft: string } | null;

export function ProductModelsPage() {
  const [models, setModels] = useState<ProductModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [savingCell, setSavingCell] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    const { products, error } = await fetchAllProductModels();
    if (!error) setModels(products);
    setLoading(false);
  };

  useEffect(() => {
    void fetchModels();
  }, []);

  const filteredModels = models.filter(model => {
    const q = searchQuery.toLowerCase();
    return (
      model.manufacturer?.toLowerCase().includes(q) ||
      model.model_number?.toLowerCase().includes(q) ||
      model.model_name?.toLowerCase().includes(q) ||
      model.category?.toLowerCase().includes(q) ||
      model.device_type?.toLowerCase().includes(q)
    );
  });

  const handleExport = async () => {
    setExporting(true);
    setActionError(null);
    const { error } = await exportProductDatabaseBackup();
    if (error) setActionError(error);
    setExporting(false);
  };

  const handleWipe = async () => {
    if (
      !window.confirm(
        'Wipe the entire Product Database?\n\nThis deletes all product records. Datasheets, manuals, and project devices are not affected.',
      )
    ) {
      return;
    }
    setWiping(true);
    setActionError(null);
    const { error } = await wipeProductDatabase();
    if (error) {
      setActionError(error);
    } else {
      await fetchModels();
    }
    setWiping(false);
  };

  const beginEdit = (id: number, field: ProductField, current: string | number | null | undefined) => {
    setEditingCell({
      id,
      field,
      draft:
        field === 'warranty_years'
          ? String(current ?? DEFAULT_PRODUCT_WARRANTY_YEARS)
          : String(current ?? ''),
    });
  };

  const cancelEdit = () => setEditingCell(null);

  const saveEdit = async () => {
    if (!editingCell) return;
    const model = models.find(entry => entry.id === editingCell.id);
    if (!model) return;

    setSavingCell(true);
    setActionError(null);

    const payload: Record<string, unknown> = {};
    const trimmed = editingCell.draft.trim();

    if (editingCell.field === 'model_name') {
      if (!trimmed) {
        setActionError('Product Description is required.');
        setSavingCell(false);
        return;
      }
      payload.model_name = trimmed;
    } else if (editingCell.field === 'manufacturer') {
      payload.manufacturer = trimmed || null;
    } else if (editingCell.field === 'model_number') {
      if (!trimmed) {
        setActionError('Manufacturers Part Number is required.');
        setSavingCell(false);
        return;
      }
      payload.model_number = trimmed;
      payload.part_number = trimmed;
    } else if (editingCell.field === 'category') {
      payload.category = trimmed || null;
    } else if (editingCell.field === 'device_type') {
      payload.device_type = trimmed || null;
    } else if (editingCell.field === 'warranty_years') {
      const parsed = parseInt(trimmed, 10);
      payload.warranty_years = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PRODUCT_WARRANTY_YEARS;
    }

    const { error } = await supabase.from('product_models').update(payload).eq('id', editingCell.id);
    if (error) {
      setActionError(error.message);
    } else {
      setEditingCell(null);
      await fetchModels();
    }
    setSavingCell(false);
  };

  const renderCell = (model: ProductModel, field: ProductField, display: string) => {
    const isEditing = editingCell?.id === model.id && editingCell.field === field;
    if (isEditing) {
      return (
        <input
          autoFocus
          value={editingCell.draft}
          onChange={event => setEditingCell({ ...editingCell, draft: event.target.value })}
          onKeyDown={event => {
            if (event.key === 'Enter') void saveEdit();
            if (event.key === 'Escape') cancelEdit();
          }}
          onBlur={() => void saveEdit()}
          disabled={savingCell}
          className="w-full rounded border border-cyan-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
      );
    }

    return (
      <button
        type="button"
        onClick={() => beginEdit(model.id, field, model[field])}
        className="w-full text-left rounded px-1 py-0.5 hover:bg-slate-100"
        title="Click to edit"
      >
        {display || '—'}
      </button>
    );
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Product Database</h1>
          <p className="text-slate-500 mt-1">
            Standard fields: {PRODUCT_DATABASE_CSV_HEADERS.join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || models.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export backup
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-600 text-sm font-medium text-white hover:bg-cyan-700"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => void handleWipe()}
            disabled={wiping || models.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {wiping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Wipe database
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          {actionError}
        </div>
      )}

      <div className="relative mb-6 max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          placeholder="Search products..."
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          className="w-full bg-white border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {PRODUCT_DATABASE_CSV_HEADERS.map(header => (
                  <th
                    key={header}
                    className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={PRODUCT_DATABASE_CSV_HEADERS.length} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading products…
                  </td>
                </tr>
              ) : filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={PRODUCT_DATABASE_CSV_HEADERS.length} className="px-4 py-16 text-center">
                    <Box className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="font-medium text-slate-900">No products yet</p>
                    <p className="text-slate-500 text-sm mt-1 mb-4">Import a CSV to populate the Product Database.</p>
                    <button
                      type="button"
                      onClick={() => setShowImport(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700"
                    >
                      <Upload className="w-4 h-4" />
                      Import CSV
                    </button>
                  </td>
                </tr>
              ) : (
                filteredModels.map(model => (
                  <tr key={model.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">
                      {renderCell(model, 'device_type', model.device_type || '')}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {renderCell(model, 'category', model.category || '')}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      {renderCell(model, 'model_name', model.model_name || '')}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {renderCell(model, 'manufacturer', model.manufacturer || '')}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {renderCell(model, 'model_number', model.model_number || model.part_number || '')}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {renderCell(
                        model,
                        'warranty_years',
                        formatWarrantyYears(model.warranty_years ?? DEFAULT_PRODUCT_WARRANTY_YEARS),
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-500">
        Showing {filteredModels.length} of {models.length} products
      </p>

      {showImport && (
        <ProductDatabaseImportModal
          products={models}
          onClose={() => setShowImport(false)}
          onComplete={() => {
            setShowImport(false);
            void fetchModels();
          }}
        />
      )}
    </div>
  );
}
