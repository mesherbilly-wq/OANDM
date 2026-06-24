import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProject } from './ProjectLayout';
import { UploadDatasheetModal } from '../components/UploadDatasheetModal';
import type { Datasheet } from '../types';
import { BookOpen, Eye, Upload, AlertCircle, CheckCircle, Search } from 'lucide-react';

interface DatasheetRow {
  manufacturer: string;
  model_number: string;
  deviceCount: number;
  datasheet: Datasheet | null;
}

export function ProjectDatasheetsPage() {
  const { id } = useParams<{ id: string }>();
  const { datasheets, refreshDatasheets } = useProject();
  const [rows, setRows] = useState<DatasheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadFor, setUploadFor] = useState<{ manufacturer: string; modelNumber: string } | null>(null);

  useEffect(() => { rebuildRows(); }, [id, datasheets]);

  const rebuildRows = async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from('devices')
      .select('manufacturer, model_number')
      .eq('project_id', parseInt(id));

    if (!data) { setLoading(false); return; }

    const counts = new Map<string, { manufacturer: string; model_number: string; count: number }>();
    for (const d of data) {
      if (!d.manufacturer && !d.model_number) continue;
      const key = `${d.manufacturer ?? ''}::${d.model_number ?? ''}`;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { manufacturer: d.manufacturer ?? '', model_number: d.model_number ?? '', count: 1 });
    }

    const built: DatasheetRow[] = [...counts.values()].map(({ manufacturer, model_number, count }) => {
      const mfr = manufacturer.trim().toLowerCase();
      const mdl = model_number.trim().toLowerCase();
      const ds = datasheets.find(
        (d) => d.manufacturer?.trim().toLowerCase() === mfr &&
               d.model_number?.trim().toLowerCase() === mdl &&
               d.datasheet_url?.trim()
      ) ?? null;
      return { manufacturer, model_number, deviceCount: count, datasheet: ds };
    });

    built.sort((a, b) => {
      if (a.datasheet && !b.datasheet) return 1;
      if (!a.datasheet && b.datasheet) return -1;
      return a.manufacturer.localeCompare(b.manufacturer);
    });

    setRows(built);
    setLoading(false);
  };

  const handleUploaded = async (datasheet: Datasheet) => {
    await refreshDatasheets();
    setUploadFor(null);
  };

  const found = rows.filter((r) => r.datasheet).length;
  const missing = rows.filter((r) => !r.datasheet).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-slate-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Datasheets</h2>
          <p className="text-sm text-slate-500">Datasheets for all product models used in this project</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <p className="text-xl font-bold text-slate-900">{rows.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Unique Models</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <p className="text-xl font-bold text-green-600">{found}</p>
          <p className="text-xs text-green-700 mt-0.5">Datasheets Available</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-xl font-bold text-amber-600">{missing}</p>
          <p className="text-xs text-amber-700 mt-0.5">Missing</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-xl border border-slate-200">
          <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No devices with product models in this project yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Manufacturer</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Model Number</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Devices</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Datasheet</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-900">{row.manufacturer || '-'}</td>
                  <td className="px-5 py-3.5 font-mono text-sm text-slate-700">{row.model_number || '-'}</td>
                  <td className="px-5 py-3.5">
                    <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded">
                      {row.deviceCount} device{row.deviceCount !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {row.datasheet ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded">
                        <CheckCircle className="w-3 h-3" />Available
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded">
                        <AlertCircle className="w-3 h-3" />Not found
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {row.datasheet?.datasheet_url && (
                        <a href={row.datasheet.datasheet_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors">
                          <Eye className="w-3.5 h-3.5" />
                          View PDF
                        </a>
                      )}
                      {!row.datasheet && (
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(`${row.manufacturer} ${row.model_number} datasheet filetype:pdf`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 border border-slate-200 transition-colors"
                          title="Search Google for this datasheet PDF"
                        >
                          <Search className="w-3.5 h-3.5" />
                          Find on Web
                        </a>
                      )}
                      <button
                        onClick={() => setUploadFor({ manufacturer: row.manufacturer, modelNumber: row.model_number })}
                        title={row.datasheet ? 'Replace datasheet' : 'Upload or link a datasheet'}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          row.datasheet
                            ? 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                            : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                        }`}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {row.datasheet ? 'Replace' : 'Upload'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uploadFor && (
        <UploadDatasheetModal
          manufacturer={uploadFor.manufacturer}
          modelNumber={uploadFor.modelNumber}
          onClose={() => setUploadFor(null)}
          onUploaded={handleUploaded}
        />
      )}
    </div>
  );
}
