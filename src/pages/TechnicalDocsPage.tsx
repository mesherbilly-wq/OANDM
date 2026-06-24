import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { SystemType } from '../types';
import { SYSTEM_TYPES } from '../types';
import {
  Upload, Download, X, Check, Eye, EyeOff, Trash2, Settings2,
  GripVertical, CheckCircle, AlertCircle, Table2, FileText,
  Camera, Lock, ShieldAlert, PhoneCall, ScanLine, Radar, Network,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ColConfig {
  key: string;
  display_name: string;
  visible: boolean;
  order: number;
}

interface TechDocRow {
  id: number;
  row_index: number;
  data: Record<string, string>;
}

interface SystemState {
  rows: TechDocRow[];
  colConfig: ColConfig[];
  configId: number | null;
}

interface ExtractedTable {
  headers: string[];
  rows: Record<string, string>[];
  pageNum: number;
  label: string;
}

type ModalState =
  | { type: 'pdf_select'; system: SystemType; file: File; tables: ExtractedTable[] }
  | { type: 'import'; system: SystemType; rawHeaders: string[]; previewRows: Record<string, string>[]; file: File }
  | { type: 'columns'; system: SystemType }
  | null;

const SYS_ICONS: Record<SystemType, React.ElementType> = {
  'CCTV': Camera, 'Access Control': Lock, 'Intruder': ShieldAlert,
  'Intercom': PhoneCall, 'ANPR': ScanLine, 'Perimeter Detection': Radar, 'Networking': Network,
};

// ── PDF table extraction ──────────────────────────────────────────────────────

interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

function clusterXPositions(xValues: number[], tolerance: number): number[] {
  const sorted = [...xValues].sort((a, b) => a - b);
  const centers: number[] = [];
  for (const x of sorted) {
    const match = centers.find(c => Math.abs(c - x) <= tolerance);
    if (match === undefined) centers.push(x);
  }
  return centers.sort((a, b) => a - b);
}

function assignToColumn(x: number, colCenters: number[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < colCenters.length; i++) {
    const d = Math.abs(x - colCenters[i]);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function buildTableFromBlock(block: TextItem[][], pageWidth: number): { headers: string[]; rows: Record<string, string>[] } | null {
  if (block.length < 2) return null;

  // Collect all x positions
  const allX = block.flatMap(row => row.map(item => item.x));
  const tolerance = Math.max(pageWidth * 0.025, 8);
  const colCenters = clusterXPositions(allX, tolerance);

  if (colCenters.length < 2) return null;

  // Build grid
  const grid: string[][] = block.map(row => {
    const cells = new Array(colCenters.length).fill('');
    for (const item of row) {
      const col = assignToColumn(item.x, colCenters);
      cells[col] = cells[col] ? cells[col] + ' ' + item.text : item.text;
    }
    return cells;
  });

  // First row as headers; skip if it looks empty
  const headerRow = grid[0];
  const nonEmptyHeaders = headerRow.filter(h => h.trim());
  if (nonEmptyHeaders.length < 2) return null;

  // Ensure headers are unique
  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  const seen = new Map<string, number>();
  const uniqueHeaders = headers.map(h => {
    const count = seen.get(h) ?? 0;
    seen.set(h, count + 1);
    return count === 0 ? h : `${h} ${count + 1}`;
  });

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < grid.length; i++) {
    const row: Record<string, string> = {};
    for (let j = 0; j < uniqueHeaders.length; j++) {
      row[uniqueHeaders[j]] = grid[i][j] ?? '';
    }
    // Skip entirely blank rows
    if (Object.values(row).every(v => !v.trim())) continue;
    rows.push(row);
  }

  if (rows.length === 0) return null;
  return { headers: uniqueHeaders, rows };
}

async function extractTablesFromPDF(file: File): Promise<ExtractedTable[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const tables: ExtractedTable[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;

    const textContent = await page.getTextContent();

    // Collect items with positions
    const items: TextItem[] = (textContent.items as any[])
      .filter(item => item.str?.trim())
      .map(item => ({
        text: item.str.trim(),
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5] * 10) / 10,
        width: item.width ?? 0,
      }));

    if (items.length === 0) continue;

    // Sort by y descending (PDF y is bottom-up), then x ascending
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Group into rows by y proximity
    const yTolerance = 6;
    const lineGroups: TextItem[][] = [];
    let currentLine: TextItem[] = [];
    let lastY = items[0].y;

    for (const item of items) {
      if (Math.abs(item.y - lastY) <= yTolerance) {
        currentLine.push(item);
      } else {
        if (currentLine.length > 0) lineGroups.push(currentLine);
        currentLine = [item];
        lastY = item.y;
      }
    }
    if (currentLine.length > 0) lineGroups.push(currentLine);

    // Find table blocks: 3+ consecutive rows each with 2+ items
    // Use a sliding approach: start a block when we see multi-col rows
    let blockStart = -1;
    const blockRanges: [number, number][] = [];

    for (let i = 0; i < lineGroups.length; i++) {
      const isMultiCol = lineGroups[i].length >= 2;
      if (isMultiCol && blockStart < 0) {
        blockStart = i;
      } else if (!isMultiCol && blockStart >= 0) {
        if (i - blockStart >= 3) blockRanges.push([blockStart, i]);
        blockStart = -1;
      }
    }
    if (blockStart >= 0 && lineGroups.length - blockStart >= 3) {
      blockRanges.push([blockStart, lineGroups.length]);
    }

    for (const [start, end] of blockRanges) {
      const block = lineGroups.slice(start, end);
      const result = buildTableFromBlock(block, pageWidth);
      if (result) {
        const tableNum = tables.length + 1;
        tables.push({
          headers: result.headers,
          rows: result.rows,
          pageNum,
          label: `Table ${tableNum} (Page ${pageNum}, ${result.rows.length} rows)`,
        });
      }
    }
  }

  return tables;
}

// ── File parsing ──────────────────────────────────────────────────────────────

async function parseNonPdfFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          const headers = result.meta.fields ?? [];
          const rows = (result.data as Record<string, string>[]).map(r => {
            const clean: Record<string, string> = {};
            for (const h of headers) clean[h] = String(r[h] ?? '');
            return clean;
          });
          resolve({ headers, rows });
        },
        error: reject,
      });
    });
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false }) as unknown[][];
    if (data.length === 0) return { headers: [], rows: [] };
    const headers = (data[0] as unknown[]).map(h => String(h ?? '')).filter(Boolean);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < data.length; i++) {
      const raw = data[i] as unknown[];
      if (!raw || raw.every(c => !c)) continue;
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) row[headers[j]] = String(raw[j] ?? '');
      rows.push(row);
    }
    return { headers, rows };
  }

  throw new Error('Unsupported file type. Please use CSV, TXT, Excel, or PDF files.');
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TechnicalDocsPage() {
  const { id } = useParams<{ id: string }>();
  const pid = id ? parseInt(id) : null;

  const [activeSystem, setActiveSystem] = useState<SystemType>(SYSTEM_TYPES[0]);
  const [systemState, setSystemState] = useState<Partial<Record<SystemType, SystemState>>>({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfParsing, setPdfParsing] = useState(false);

  // Import wizard state
  const [importColCfg, setImportColCfg] = useState<ColConfig[]>([]);
  const [importing, setImporting] = useState(false);

  // Cell editing
  const [editingCell, setEditingCell] = useState<{ rowId: number; key: string } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [savedCell, setSavedCell] = useState<{ rowId: number; key: string } | null>(null);

  // Column config editing
  const [editingColCfg, setEditingColCfg] = useState<ColConfig[]>([]);
  const [savingCols, setSavingCols] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importSystemRef = useRef<SystemType>(SYSTEM_TYPES[0]);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    const [{ data: rowData }, { data: cfgData }] = await Promise.all([
      supabase.from('tech_doc_rows').select('*').eq('project_id', pid).order('system_type').order('row_index'),
      supabase.from('tech_doc_column_configs').select('*').eq('project_id', pid),
    ]);
    const state: Partial<Record<SystemType, SystemState>> = {};
    for (const sys of SYSTEM_TYPES) {
      const rows = (rowData ?? []).filter((r: any) => r.system_type === sys) as TechDocRow[];
      const cfg = (cfgData ?? []).find((c: any) => c.system_type === sys);
      state[sys] = { rows, colConfig: (cfg?.columns as ColConfig[]) ?? [], configId: cfg?.id ?? null };
    }
    setSystemState(state);
    setLoading(false);
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  // ── File pick handler ────────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPdfError(null);
    const isPdf = file.name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      setPdfParsing(true);
      try {
        const tables = await extractTablesFromPDF(file);
        if (tables.length === 0) {
          setPdfError(
            'Could not read table automatically. Please upload CSV/Excel or manually copy and paste the table.'
          );
        } else if (tables.length === 1) {
          // Go straight to import wizard
          const table = tables[0];
          const colCfg: ColConfig[] = table.headers.map((h, i) => ({
            key: h, display_name: h, visible: true, order: i,
          }));
          setImportColCfg(colCfg);
          setModal({ type: 'import', system: importSystemRef.current, rawHeaders: table.headers, previewRows: table.rows, file });
        } else {
          setModal({ type: 'pdf_select', system: importSystemRef.current, file, tables });
        }
      } catch (err: any) {
        setPdfError('Could not read table automatically. Please upload CSV/Excel or manually copy and paste the table.');
      } finally {
        setPdfParsing(false);
      }
    } else {
      try {
        const { headers, rows } = await parseNonPdfFile(file);
        if (headers.length === 0) { alert('No columns found in file.'); return; }
        const colCfg: ColConfig[] = headers.map((h, i) => ({
          key: h, display_name: h, visible: true, order: i,
        }));
        setImportColCfg(colCfg);
        setModal({ type: 'import', system: importSystemRef.current, rawHeaders: headers, previewRows: rows, file });
      } catch (err: any) {
        alert(err.message ?? 'Failed to parse file.');
      }
    }
  };

  // ── Select PDF table ─────────────────────────────────────────────────────────

  const selectPdfTable = (table: ExtractedTable) => {
    const colCfg: ColConfig[] = table.headers.map((h, i) => ({
      key: h, display_name: h, visible: true, order: i,
    }));
    setImportColCfg(colCfg);
    if (modal?.type === 'pdf_select') {
      setModal({ type: 'import', system: modal.system, rawHeaders: table.headers, previewRows: table.rows, file: modal.file });
    }
  };

  // ── Import confirm ───────────────────────────────────────────────────────────

  const confirmImport = async () => {
    if (modal?.type !== 'import' || !pid) return;
    const { system, previewRows } = modal;
    setImporting(true);
    try {
      await supabase.from('tech_doc_rows').delete().eq('project_id', pid).eq('system_type', system);

      if (previewRows.length > 0) {
        const inserts = previewRows.map((data, i) => ({
          project_id: pid, system_type: system, row_index: i, data,
        }));
        const { error } = await supabase.from('tech_doc_rows').insert(inserts);
        if (error) throw error;
      }

      const existingCfgId = systemState[system]?.configId;
      const colData = { project_id: pid, system_type: system, columns: importColCfg, updated_at: new Date().toISOString() };
      if (existingCfgId) {
        await supabase.from('tech_doc_column_configs').update(colData).eq('id', existingCfgId);
      } else {
        await supabase.from('tech_doc_column_configs').insert(colData);
      }

      setModal(null);
      await load();
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    } finally { setImporting(false); }
  };

  // ── Cell editing ─────────────────────────────────────────────────────────────

  const startEdit = (rowId: number, key: string, value: string) => {
    setEditingCell({ rowId, key });
    setCellValue(value);
  };

  const saveCell = async () => {
    if (!editingCell) return;
    const { rowId, key } = editingCell;
    const row = systemState[activeSystem]?.rows.find(r => r.id === rowId);
    if (!row) { setEditingCell(null); return; }
    const newData = { ...row.data, [key]: cellValue };
    const { error } = await supabase.from('tech_doc_rows').update({ data: newData }).eq('id', rowId);
    if (error) { alert('Save failed: ' + error.message); return; }
    setSystemState(prev => {
      const sys = prev[activeSystem];
      if (!sys) return prev;
      return { ...prev, [activeSystem]: { ...sys, rows: sys.rows.map(r => r.id === rowId ? { ...r, data: newData } : r) } };
    });
    setSavedCell(editingCell);
    setTimeout(() => setSavedCell(null), 2000);
    setEditingCell(null);
  };

  const handleCellKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveCell();
    else if (e.key === 'Escape') setEditingCell(null);
  };

  // ── Delete row ───────────────────────────────────────────────────────────────

  const deleteRow = async (rowId: number) => {
    if (!confirm('Delete this row?')) return;
    await supabase.from('tech_doc_rows').delete().eq('id', rowId);
    setSystemState(prev => {
      const sys = prev[activeSystem];
      if (!sys) return prev;
      return { ...prev, [activeSystem]: { ...sys, rows: sys.rows.filter(r => r.id !== rowId) } };
    });
  };

  // ── Clear system ─────────────────────────────────────────────────────────────

  const clearSystem = async (system: SystemType) => {
    if (!pid || !confirm(`Clear all imported data for ${system}?`)) return;
    await supabase.from('tech_doc_rows').delete().eq('project_id', pid).eq('system_type', system);
    setSystemState(prev => ({ ...prev, [system]: { ...prev[system]!, rows: [] } }));
  };

  // ── Column config ────────────────────────────────────────────────────────────

  const openColConfig = (system: SystemType) => {
    setEditingColCfg([...( systemState[system]?.colConfig ?? [])]);
    setModal({ type: 'columns', system });
  };

  const saveColConfig = async () => {
    if (modal?.type !== 'columns' || !pid) return;
    const { system } = modal;
    setSavingCols(true);
    try {
      const cfgId = systemState[system]?.configId;
      const payload = { project_id: pid, system_type: system, columns: editingColCfg, updated_at: new Date().toISOString() };
      if (cfgId) {
        await supabase.from('tech_doc_column_configs').update(payload).eq('id', cfgId);
      } else {
        await supabase.from('tech_doc_column_configs').insert(payload);
      }
      setSystemState(prev => ({ ...prev, [system]: { ...prev[system]!, colConfig: editingColCfg } }));
      setModal(null);
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally { setSavingCols(false); }
  };

  // ── Export CSV ────────────────────────────────────────────────────────────────

  const exportCSV = (system: SystemType) => {
    const state = systemState[system];
    if (!state || state.rows.length === 0) return;
    const cols = state.colConfig.filter(c => c.visible).sort((a, b) => a.order - b.order);
    if (cols.length === 0) return;
    const csv = [cols.map(c => c.display_name), ...state.rows.map(r => cols.map(c => r.data[c.key] ?? ''))].map(row =>
      row.map(c => { const s = String(c); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')
    ).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `tech-docs-${system.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const current = systemState[activeSystem];
  const visibleCols = (current?.colConfig ?? []).filter(c => c.visible).sort((a, b) => a.order - b.order);
  const hasData = (current?.rows.length ?? 0) > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.xlsx,.xls,.pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Technical Documentation</h2>
            <p className="text-xs text-slate-500 mt-0.5">Import PDF, CSV, Excel, or TXT files per system — select and rename columns.</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Table2 className="w-3.5 h-3.5" />
            {SYSTEM_TYPES.filter(s => (systemState[s]?.rows.length ?? 0) > 0).length} systems with data
          </div>
        </div>
      </div>

      {/* PDF error banner */}
      {pdfError && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">{pdfError}</p>
          </div>
          <button onClick={() => setPdfError(null)} className="text-amber-400 hover:text-amber-600 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* PDF parsing overlay */}
      {pdfParsing && (
        <div className="flex items-center gap-3 bg-cyan-50 border border-cyan-200 rounded-xl px-4 py-3">
          <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm font-medium text-cyan-800">Scanning PDF for tables…</p>
        </div>
      )}

      {/* System tabs */}
      <div className="flex flex-wrap gap-1.5 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
        {SYSTEM_TYPES.map(s => {
          const Icon = SYS_ICONS[s];
          const count = systemState[s]?.rows.length ?? 0;
          return (
            <button key={s} onClick={() => setActiveSystem(s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeSystem === s ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              {s}
              {count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${activeSystem === s ? 'bg-cyan-500 text-white' : 'bg-slate-300 text-slate-700'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* System panel */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            {React.createElement(SYS_ICONS[activeSystem], { className: 'w-4 h-4 text-slate-600' })}
            <span className="text-sm font-semibold text-slate-800">{activeSystem}</span>
            {hasData && (
              <span className="text-xs text-slate-500">{current!.rows.length} rows · {visibleCols.length} columns shown</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasData && (
              <>
                <button onClick={() => openColConfig(activeSystem)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors">
                  <Settings2 className="w-3.5 h-3.5" />Columns
                </button>
                <button onClick={() => exportCSV(activeSystem)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors">
                  <Download className="w-3.5 h-3.5" />Export
                </button>
                <button onClick={() => clearSystem(activeSystem)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />Clear
                </button>
              </>
            )}
            <button
              onClick={() => { importSystemRef.current = activeSystem; setPdfError(null); fileInputRef.current?.click(); }}
              disabled={pdfParsing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />{hasData ? 'Re-import' : 'Import File'}
            </button>
          </div>
        </div>

        {/* Content */}
        {!hasData ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center">
              <Upload className="w-6 h-6 text-slate-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-700">No data imported for {activeSystem}</p>
              <p className="text-xs text-slate-400 mt-1">Supports PDF, CSV, Excel (.xlsx), and TXT files</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { importSystemRef.current = activeSystem; setPdfError(null); fileInputRef.current?.click(); }}
                disabled={pdfParsing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white text-sm font-medium rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />Import File
              </button>
            </div>
            <p className="text-xs text-slate-400">PDF · CSV · Excel · TXT</p>
          </div>
        ) : visibleCols.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
            <EyeOff className="w-6 h-6 text-slate-300" />
            <p className="text-sm">All columns are hidden.</p>
            <button onClick={() => openColConfig(activeSystem)} className="text-xs text-cyan-600 hover:underline">Configure columns</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                  {visibleCols.map(col => (
                    <th key={col.key} className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {col.display_name}
                    </th>
                  ))}
                  <th className="w-8 px-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {current!.rows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors group">
                    <td className="px-4 py-1.5 text-xs text-slate-400 font-mono">{idx + 1}</td>
                    {visibleCols.map(col => {
                      const isEditing = editingCell?.rowId === row.id && editingCell?.key === col.key;
                      const isSaved = savedCell?.rowId === row.id && savedCell?.key === col.key;
                      const val = row.data[col.key] ?? '';
                      return (
                        <td key={col.key} className="px-2 py-1 min-w-[100px] max-w-[240px]">
                          {isEditing ? (
                            <input
                              autoFocus type="text" value={cellValue}
                              onChange={e => setCellValue(e.target.value)}
                              onBlur={saveCell} onKeyDown={handleCellKey}
                              className="w-full px-2 py-1 border border-cyan-500 rounded bg-cyan-50 text-sm font-mono focus:outline-none"
                            />
                          ) : (
                            <div
                              onClick={() => startEdit(row.id, col.key, val)}
                              className={`px-2 py-1.5 cursor-pointer rounded text-sm font-mono hover:bg-slate-100 relative transition-colors ${isSaved ? 'bg-emerald-50' : ''}`}
                            >
                              {val || <span className="text-slate-300">—</span>}
                              {isSaved && <Check className="w-3 h-3 absolute right-1 top-2 text-emerald-500" />}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-right">
                      <button onClick={() => deleteRow(row.id)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 rounded transition-all">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 px-4 py-2 border-t border-slate-100">
              Click any cell to edit &middot; Enter to save &middot; Esc to cancel
            </p>
          </div>
        )}
      </div>

      {/* ── PDF Table Selector Modal ──────────────────────────────────────────── */}
      {modal?.type === 'pdf_select' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Multiple tables found — {modal.system}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {modal.tables.length} tables detected in {modal.file.name}. Select the one to import.
                </p>
              </div>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {modal.tables.map((table, i) => (
                <div key={i} className="border border-slate-200 rounded-xl overflow-hidden hover:border-cyan-300 hover:shadow-md transition-all">
                  <div className="flex items-center justify-between bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{table.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{table.headers.length} columns · {table.rows.length} rows</p>
                    </div>
                    <button
                      onClick={() => selectPdfTable(table)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />Select this table
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          {table.headers.map(h => (
                            <th key={h} className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {table.rows.slice(0, 4).map((row, ri) => (
                          <tr key={ri} className="hover:bg-slate-50">
                            {table.headers.map(h => (
                              <td key={h} className="px-3 py-1.5 font-mono text-slate-700 whitespace-nowrap max-w-[160px] truncate">
                                {row[h] || <span className="text-slate-300">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {table.rows.length > 4 && (
                      <p className="text-xs text-slate-400 px-3 py-2 border-t border-slate-100">
                        +{table.rows.length - 4} more rows
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0">
              <button onClick={() => setModal(null)} className="px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import Wizard Modal ───────────────────────────────────────────────── */}
      {modal?.type === 'import' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Import — {modal.system}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {modal.file.name} · {modal.previewRows.length} rows · {modal.rawHeaders.length} columns detected
                </p>
              </div>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Column selector */}
              <div className="w-72 border-r border-slate-200 overflow-y-auto flex-shrink-0">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Column Settings</p>
                  <p className="text-xs text-slate-400 mt-0.5">Toggle visibility · rename headings</p>
                </div>
                <div className="p-3 space-y-1.5">
                  {importColCfg.map((col, idx) => (
                    <div key={col.key} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 truncate flex-1" title={col.key}>{col.key}</span>
                        <button
                          onClick={() => setImportColCfg(prev => prev.map((c, i) => i === idx ? { ...c, visible: !c.visible } : c))}
                          className={`flex-shrink-0 p-0.5 rounded transition-colors ${col.visible ? 'text-cyan-600' : 'text-slate-300'}`}
                        >
                          {col.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                      </div>
                      {col.visible && (
                        <input
                          type="text" value={col.display_name}
                          onChange={e => setImportColCfg(prev => prev.map((c, i) => i === idx ? { ...c, display_name: e.target.value } : c))}
                          placeholder="Column heading…"
                          className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 bg-white"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview table */}
              <div className="flex-1 overflow-auto">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Preview</p>
                  <p className="text-xs text-slate-400 mt-0.5">First 10 rows with selected columns</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {importColCfg.filter(c => c.visible).map(col => (
                          <th key={col.key} className="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                            {col.display_name || col.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {modal.previewRows.slice(0, 10).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          {importColCfg.filter(c => c.visible).map(col => (
                            <td key={col.key} className="px-3 py-2 font-mono text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                              {row[col.key] || <span className="text-slate-300">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {modal.previewRows.length > 10 && (
                    <p className="text-xs text-slate-400 px-4 py-2 border-t border-slate-100">
                      +{modal.previewRows.length - 10} more rows will be imported
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0">
              {/* Back button for PDF multi-table flow */}
              <button onClick={() => setModal(null)} className="px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">
                Cancel
              </button>
              <div className="flex-1" />
              <span className="text-xs text-slate-500">
                {importColCfg.filter(c => c.visible).length} of {importColCfg.length} columns selected
              </span>
              <button
                onClick={confirmImport}
                disabled={importing || importColCfg.filter(c => c.visible).length === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40"
              >
                {importing
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Importing…</>
                  : <><CheckCircle className="w-4 h-4" />Import {modal.previewRows.length} rows</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Column Config Modal ───────────────────────────────────────────────── */}
      {modal?.type === 'columns' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 flex-shrink-0">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Columns — {modal.system}</h3>
                <p className="text-xs text-slate-500 mt-0.5">Toggle visibility and rename headings</p>
              </div>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {editingColCfg.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No columns configured. Import a file first.</p>
              ) : editingColCfg.sort((a, b) => a.order - b.order).map((col, idx) => (
                <div key={col.key} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
                    <span className="text-xs text-slate-500 truncate flex-1" title={col.key}>{col.key}</span>
                    <button
                      onClick={() => setEditingColCfg(prev => prev.map((c, i) => i === idx ? { ...c, visible: !c.visible } : c))}
                      className={`flex-shrink-0 p-0.5 rounded transition-colors ${col.visible ? 'text-cyan-600' : 'text-slate-300'}`}
                    >
                      {col.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                  {col.visible && (
                    <input
                      type="text" value={col.display_name}
                      onChange={e => setEditingColCfg(prev => prev.map((c, i) => i === idx ? { ...c, display_name: e.target.value } : c))}
                      className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 bg-white"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0">
              <button onClick={() => setModal(null)} className="flex-1 px-4 py-2.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
              <button
                onClick={saveColConfig}
                disabled={savingCols}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40"
              >
                {savingCols ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
