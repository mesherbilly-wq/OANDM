import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  loadDocumentProjectSystems,
  mergeDocumentSystemNames,
  systemAssignmentFields,
} from '../lib/documentProjectSystems';
import { getCategoryStyle, type ProjectSystem } from '../lib/systems';
import {
  Upload, Download, X, Check, Eye, EyeOff, Trash2, Settings2,
  GripVertical, CheckCircle, AlertCircle, Table2, FileText,
  Plus, Pencil, ExternalLink, ClipboardCopy,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import migration039Sql from '../../supabase/migrations/20260917120000_039_tech_doc_documents.sql?raw';

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
  document_id?: number | null;
}

interface TechDocDocument {
  id: number;
  title: string;
  document_type: string | null;
  notes: string | null;
  system_type: string | null;
  file_name: string | null;
  file_url: string | null;
  file_size: number | null;
  rows: TechDocRow[];
  colConfig: ColConfig[];
  configId: number | null;
}

interface PendingDescribe {
  file: File;
  title: string;
  document_type: string;
  system_name: string;
  notes: string;
}

const TECH_DOC_TYPES = [
  'Door Schedule',
  'Camera Schedule',
  'IP Address Schedule',
  'Port / Patch Schedule',
  'Cable Schedule',
  'Device Configuration',
  'Network Table',
  'Other',
];

const ic = 'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white text-slate-900';

function missingTable(error: { message?: string } | null | undefined): boolean {
  return /does not exist|schema cache|document_id/i.test(error?.message ?? '');
}

interface ExtractedTable {
  headers: string[];
  rows: Record<string, string>[];
  pageNum: number;
  label: string;
}

type ModalState =
  | { type: 'pdf_select'; system: string; file: File; tables: ExtractedTable[] }
  | { type: 'import'; system: string; rawHeaders: string[]; previewRows: Record<string, string>[]; file: File }
  | { type: 'columns'; system: string }
  | null;

// ── PDF table extraction ──────────────────────────────────────────────────────

interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

function filledCount(row: string[]): number {
  return row.filter(cell => cell.trim()).length;
}

function looksLikeDataValue(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value)) return true;
  if (/^([0-9a-f]{2}[:\-]){5}[0-9a-f]{2}$/i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(value)) return true;
  if (/^\d+([.,]\d+)?$/.test(value)) return true;
  return false;
}

function looksLikeHeaderRow(row: string[]): boolean {
  const filled = row.map(cell => cell.trim()).filter(Boolean);
  if (filled.length < 2) return false;
  const dataLike = filled.filter(looksLikeDataValue).length;
  if (dataLike >= Math.ceil(filled.length / 2)) return false;
  const long = filled.filter(cell => cell.length > 60).length;
  return long < filled.length / 2;
}

function uniquifyHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}

const HEADER_HINTS = /name|model|serial|mac|ip|camera|firmware|location|device|channel|status|manufacturer|part|host|address|description|type|\bid\b|qty|quantity/i;

function headerHintCount(row: string[]): number {
  return row.filter(cell => HEADER_HINTS.test(cell)).length;
}

function usedWidth(row: string[]): number {
  let width = row.length;
  while (width > 0 && !String(row[width - 1] ?? '').trim()) width--;
  return width;
}

function sameDocId(a: unknown, b: unknown): boolean {
  if (a == null || b == null || a === '') return false;
  return String(a) === String(b);
}

function tableScore(table: { headers: string[]; rows: Record<string, string>[] }, headerLike: boolean, hint: number): number {
  if (table.headers.length < 2 || table.rows.length === 0) return -1;
  return table.rows.length * table.headers.length + hint * 50 + (headerLike ? 20 : 0);
}

function gridFromUnknown(raw: unknown[][]): string[][] {
  return raw.map(row => (Array.isArray(row) ? row : [row]).map(cell => String(cell ?? '').trim()));
}

function tableFromHeader(grid: string[][], headerIdx: number): { headers: string[]; rows: Record<string, string>[] } {
  let width = 0;
  for (let i = headerIdx; i < grid.length; i++) width = Math.max(width, usedWidth(grid[i]));
  if (width < 2) return { headers: [], rows: [] };

  const headers = uniquifyHeaders(Array.from({ length: width }, (_, col) => grid[headerIdx][col] ?? ''));
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = headers.map((_, col) => grid[i][col] ?? '');
    if (cells.every(cell => !cell.trim())) continue;
    const filled = cells.filter(cell => cell.trim());
    if (filled.length === 1 && filled[0].length > 80) continue;
    if (looksLikeHeaderRow(cells) && headerHintCount(cells) >= 2) continue;
    const row: Record<string, string> = {};
    for (let col = 0; col < headers.length; col++) row[headers[col]] = cells[col];
    rows.push(row);
  }
  return { headers, rows };
}

/** Skip title/date rows and pick the table with the most real columns and rows. */
function extractTableFromGrid(raw: unknown[][]): { headers: string[]; rows: Record<string, string>[] } {
  const grid = gridFromUnknown(raw);
  let best: { headers: string[]; rows: Record<string, string>[] } = { headers: [], rows: [] };
  let bestScore = -1;
  const searchLimit = Math.min(grid.length - 1, 80);
  for (let i = 0; i <= searchLimit; i++) {
    if (filledCount(grid[i]) < 2) continue;
    const headerLike = looksLikeHeaderRow(grid[i]);
    const hint = headerHintCount(grid[i]);
    if (!headerLike && hint === 0) continue;
    const table = tableFromHeader(grid, i);
    const score = tableScore(table, headerLike, hint);
    if (score > bestScore) {
      bestScore = score;
      best = table;
    }
  }
  if (best.rows.length > 0) return best;
  const fallbackIdx = grid.findIndex(row => filledCount(row) >= 2);
  return fallbackIdx >= 0 ? tableFromHeader(grid, fallbackIdx) : { headers: [], rows: [] };
}

function columnsFromRows(rows: TechDocRow[], configured: ColConfig[]): ColConfig[] {
  const visible = (configured ?? []).filter(col => col.visible).sort((a, b) => a.order - b.order);
  if (visible.length > 0) return visible;
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.data ?? {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys.map((key, order) => ({ key, display_name: key, visible: true, order }));
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

  const table = extractTableFromGrid(grid);
  if (table.headers.length < 2 || table.rows.length === 0) return null;
  return table;
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

function parseCsvText(text: string, delimiter?: string): unknown[][] {
  const result = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: false,
    delimiter: delimiter || undefined,
  });
  return (result.data ?? []).map(row => (Array.isArray(row) ? row : [row]).map(cell => String(cell ?? '')));
}

function decodeSpreadsheetText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const utf16le = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE;
  const utf16be = bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF;
  const looksUtf16 = bytes.length > 4 && bytes[1] === 0 && bytes[3] === 0;
  const text = new TextDecoder(utf16le || looksUtf16 ? 'utf-16le' : utf16be ? 'utf-16be' : 'utf-8').decode(buf);
  return text.replace(/^\uFEFF/, '');
}

function bestTable(tables: { headers: string[]; rows: Record<string, string>[] }[]): { headers: string[]; rows: Record<string, string>[] } {
  let best = tables[0] ?? { headers: [], rows: [] };
  let bestScore = tableScore(best, true, headerHintCount(best.headers));
  for (const table of tables.slice(1)) {
    const score = tableScore(table, true, headerHintCount(table.headers));
    if (score > bestScore) {
      best = table;
      bestScore = score;
    }
  }
  return best;
}

async function parseNonPdfFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = decodeSpreadsheetText(await file.arrayBuffer());
    return bestTable([
      extractTableFromGrid(parseCsvText(text)),
      extractTableFromGrid(parseCsvText(text, ',')),
      extractTableFromGrid(parseCsvText(text, ';')),
      extractTableFromGrid(parseCsvText(text, '\t')),
      extractTableFromGrid(parseCsvText(text, '|')),
    ]);
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    try {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const tables = wb.SheetNames.map(sheetName => {
        const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
          header: 1,
          raw: false,
          defval: '',
          blankrows: true,
        }) as unknown[][];
        return extractTableFromGrid(data);
      });
      const fromSheets = bestTable(tables);
      if (fromSheets.rows.length > 0) return fromSheets;
    } catch { /* fall through to text parse */ }
    const text = decodeSpreadsheetText(buf);
    return bestTable([
      extractTableFromGrid(parseCsvText(text)),
      extractTableFromGrid(parseCsvText(text, ',')),
      extractTableFromGrid(parseCsvText(text, ';')),
      extractTableFromGrid(parseCsvText(text, '\t')),
    ]);
  }

  throw new Error('Unsupported file type. Please use CSV, TXT, Excel, or PDF files.');
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TechnicalDocsPage() {
  const { id } = useParams<{ id: string }>();
  const pid = id ? parseInt(id) : null;

  const [projectSystems, setProjectSystems] = useState<ProjectSystem[]>([]);
  const [activeSystem, setActiveSystem] = useState<string>('');
  const [documents, setDocuments] = useState<TechDocDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [migrationCopied, setMigrationCopied] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<PendingDescribe[]>([]);
  const [pendingIndex, setPendingIndex] = useState(0);

  // Import wizard state
  const [importColCfg, setImportColCfg] = useState<ColConfig[]>([]);
  const [importing, setImporting] = useState(false);
  const [pendingMeta, setPendingMeta] = useState<PendingDescribe | null>(null);

  // Cell editing
  const [editingCell, setEditingCell] = useState<{ rowId: number; key: string } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [savedCell, setSavedCell] = useState<{ rowId: number; key: string } | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<number | null>(null);
  const [editingDoc, setEditingDoc] = useState<TechDocDocument | null>(null);

  // Column config editing
  const [editingColCfg, setEditingColCfg] = useState<ColConfig[]>([]);
  const [savingCols, setSavingCols] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const visibleDocuments = useMemo(
    () => documents.filter(doc => !activeSystem || doc.system_type === activeSystem),
    [documents, activeSystem],
  );

  const currentPending = pendingQueue[pendingIndex] ?? null;

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    const [{ data: rowData, error: rowErr }, { data: cfgData }, { data: devData }, docsRes] = await Promise.all([
      supabase.from('tech_doc_rows').select('*').eq('project_id', pid).order('system_type').order('row_index'),
      supabase.from('tech_doc_column_configs').select('*').eq('project_id', pid),
      supabase.from('devices').select('id, project_id, system_type, system_category, project_system_id').eq('project_id', pid),
      supabase.from('tech_doc_documents').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
    ]);

    const devices = devData ?? [];
    const baseSystems = await loadDocumentProjectSystems(pid, devices);
    const extraNames = [
      ...new Set([
        ...(rowData ?? []).map((row: { system_type: string }) => row.system_type),
        ...(cfgData ?? []).map((cfg: { system_type: string }) => cfg.system_type),
        ...(docsRes.data ?? []).map((doc: { system_type: string | null }) => doc.system_type),
      ].filter(Boolean)),
    ] as string[];
    const systems = mergeDocumentSystemNames(baseSystems, extraNames);
    setProjectSystems(systems);

    if (docsRes.error && missingTable(docsRes.error)) {
      setNeedsMigration(true);
    } else {
      setNeedsMigration(false);
    }

    const rows = (rowData ?? []) as Array<TechDocRow & { system_type: string; document_id?: number | null }>;
    const cfgs = cfgData ?? [];
    const rawDocs = docsRes.data ?? [];

    const built: TechDocDocument[] = rawDocs.map((doc: any) => {
      const docRows = rows.filter(row => sameDocId(row.document_id, doc.id));
      const cfg = cfgs.find((c: { document_id?: number | null }) => sameDocId(c.document_id, doc.id))
        ?? (docRows.length === 0 ? cfgs.find((c: { system_type: string; document_id?: number | null }) => c.system_type === doc.system_type && !c.document_id) : undefined);
      return {
        id: Number(doc.id),
        title: doc.title || doc.file_name || 'Technical document',
        document_type: doc.document_type ?? null,
        notes: doc.notes ?? null,
        system_type: doc.system_type ?? null,
        file_name: doc.file_name ?? null,
        file_url: doc.file_url ?? null,
        file_size: doc.file_size ?? null,
        rows: docRows,
        colConfig: (cfg?.columns as ColConfig[]) ?? [],
        configId: cfg?.id ?? null,
      };
    });

    const claimed = new Set(built.flatMap(doc => doc.rows.map(row => String(row.id))));
    const orphanRows = rows.filter(row => !claimed.has(String(row.id)));
    const emptyNamedBySystem = new Map<string, TechDocDocument[]>();
    for (const doc of built) {
      if (doc.rows.length > 0 || !doc.system_type) continue;
      const bucket = emptyNamedBySystem.get(doc.system_type) ?? [];
      bucket.push(doc);
      emptyNamedBySystem.set(doc.system_type, bucket);
    }
    const stillOrphan: typeof orphanRows = [];
    const orphansBySystem = new Map<string, typeof orphanRows>();
    for (const row of orphanRows) {
      const key = row.system_type || 'Technical Documentation';
      const bucket = orphansBySystem.get(key) ?? [];
      bucket.push(row);
      orphansBySystem.set(key, bucket);
    }
    for (const [system, sysRows] of orphansBySystem) {
      const emptyNamed = emptyNamedBySystem.get(system);
      if (emptyNamed?.length === 1) {
        emptyNamed[0].rows = sysRows;
        continue;
      }
      stillOrphan.push(...sysRows);
    }
    if (stillOrphan.length > 0) {
      const bySystem = new Map<string, typeof stillOrphan>();
      for (const row of stillOrphan) {
        const key = row.system_type || 'Technical Documentation';
        const bucket = bySystem.get(key) ?? [];
        bucket.push(row);
        bySystem.set(key, bucket);
      }
      for (const [system, sysRows] of bySystem) {
        const cfg = cfgs.find((c: { system_type: string; document_id?: number | null }) => c.system_type === system && !c.document_id);
        built.push({
          id: -Math.abs(sysRows[0]?.id ?? Date.now()),
          title: `${system} table`,
          document_type: 'Imported table',
          notes: needsMigration ? 'Paste 039 SQL to keep multiple named spreadsheets.' : null,
          system_type: system,
          file_name: null,
          file_url: null,
          file_size: null,
          rows: sysRows,
          colConfig: (cfg?.columns as ColConfig[]) ?? [],
          configId: cfg?.id ?? null,
        });
      }
    }

    setDocuments(built);
    setLoading(false);
    void rowErr;
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  // ── File pick handler ────────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const queued: PendingDescribe[] = files.map(file => ({
      file,
      title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '),
      document_type: '',
      system_name: activeSystem || projectSystems[0]?.name || '',
      notes: '',
    }));
    setPdfError(null);
    setPendingQueue(queued);
    setPendingIndex(0);
  };

  const updateCurrentPending = (patch: Partial<PendingDescribe>) => {
    setPendingQueue(prev => prev.map((item, i) => i === pendingIndex ? { ...item, ...patch } : item));
  };

  const startParseFromDescribe = async () => {
    const pending = pendingQueue[pendingIndex];
    if (!pending) return;
    const file = pending.file;
    setPendingMeta(pending);
    setPdfError(null);
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      setPdfParsing(true);
      try {
        const tables = await extractTablesFromPDF(file);
        if (tables.length === 0) {
          setPdfError('Could not read table automatically. Please upload CSV/Excel or copy and paste the table.');
        } else if (tables.length === 1) {
          const table = tables[0];
          setImportColCfg(table.headers.map((h, i) => ({ key: h, display_name: h, visible: true, order: i })));
          setModal({ type: 'import', system: pending.system_name, rawHeaders: table.headers, previewRows: table.rows, file });
        } else {
          setModal({ type: 'pdf_select', system: pending.system_name, file, tables });
        }
      } catch {
        setPdfError('Could not read table automatically. Please upload CSV/Excel or copy and paste the table.');
      } finally {
        setPdfParsing(false);
      }
    } else {
      try {
        const { headers, rows } = await parseNonPdfFile(file);
        if (headers.length === 0 || rows.length === 0) {
          alert('Could not find a table of rows in that file. Axis hardware inventory exports often put the camera list on a later sheet — try Excel/CSV and import again.');
          return;
        }
        setImportColCfg(headers.map((h, i) => ({ key: h, display_name: h, visible: true, order: i })));
        setModal({ type: 'import', system: pending.system_name, rawHeaders: headers, previewRows: rows, file });
      } catch (err: any) {
        alert(err.message ?? 'Failed to parse file.');
      }
    }
  };

  const advanceQueue = () => {
    if (pendingIndex + 1 < pendingQueue.length) {
      setPendingIndex(i => i + 1);
      setModal(null);
      setPendingMeta(null);
    } else {
      setPendingQueue([]);
      setPendingIndex(0);
      setPendingMeta(null);
      setModal(null);
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

  const uploadOriginalFile = async (file: File): Promise<{ file_name: string; file_url: string; file_size: number } | null> => {
    if (!pid) return null;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `tech-docs/${pid}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage.from('om-uploads').upload(path, file, { upsert: false });
    if (error) return { file_name: file.name, file_url: '', file_size: file.size };
    const { data: { publicUrl } } = supabase.storage.from('om-uploads').getPublicUrl(path);
    return { file_name: file.name, file_url: publicUrl, file_size: file.size };
  };

  // ── Import confirm ───────────────────────────────────────────────────────────

  const confirmImport = async () => {
    if (modal?.type !== 'import' || !pid) return;
    const meta = pendingMeta ?? currentPending;
    const { system, previewRows, file } = modal;
    const systemName = meta?.system_name || system;
    const selectedSystem = projectSystems.find(s => s.name === systemName) ?? null;
    setImporting(true);
    try {
      const stored = await uploadOriginalFile(file);
      const docPayload = {
        project_id: pid,
        title: (meta?.title || file.name).trim(),
        document_type: meta?.document_type || null,
        notes: meta?.notes?.trim() || null,
        file_name: stored?.file_name ?? file.name,
        file_url: stored?.file_url || null,
        file_size: stored?.file_size ?? file.size,
        ...systemAssignmentFields(selectedSystem ?? { name: systemName, id: undefined }),
      };
      const { data: inserted, error: docErr } = await supabase.from('tech_doc_documents').insert(docPayload).select('id').single();
      if (docErr) {
        if (missingTable(docErr)) {
          setNeedsMigration(true);
          throw new Error('Paste 039 SQL in Supabase, then import again so each spreadsheet can be named and kept.');
        }
        throw docErr;
      }
      const documentId = Number(inserted?.id);
      if (!documentId) throw new Error('Document was created without an id.');
      if (previewRows.length === 0) {
        await supabase.from('tech_doc_documents').delete().eq('id', documentId);
        throw new Error('Could not find any data rows in that spreadsheet.');
      }
      const withDocId = previewRows.map((data, i) => ({
        project_id: pid, system_type: systemName, row_index: i, data, document_id: documentId,
      }));
      let { error } = await supabase.from('tech_doc_rows').insert(withDocId);
      if (error && missingTable(error)) {
        setNeedsMigration(true);
        const withoutDocId = withDocId.map(({ document_id: _documentId, ...rest }) => rest);
        const retry = await supabase.from('tech_doc_rows').insert(withoutDocId);
        error = retry.error;
      }
      if (error) {
        await supabase.from('tech_doc_documents').delete().eq('id', documentId);
        throw error;
      }
      const colData = {
        project_id: pid,
        system_type: systemName,
        columns: importColCfg,
        document_id: documentId,
        updated_at: new Date().toISOString(),
      };
      const { error: cfgErr } = await supabase.from('tech_doc_column_configs').insert(colData);
      if (cfgErr && missingTable(cfgErr)) {
        setNeedsMigration(true);
        await supabase.from('tech_doc_column_configs').upsert({
          project_id: pid,
          system_type: systemName,
          columns: importColCfg,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'project_id,system_type' });
      } else if (cfgErr) {
        throw cfgErr;
      }
      await load();
      setExpandedDocId(documentId);
      advanceQueue();
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
    const row = documents.flatMap(doc => doc.rows).find(r => r.id === rowId);
    if (!row) { setEditingCell(null); return; }
    const newData = { ...row.data, [key]: cellValue };
    const { error } = await supabase.from('tech_doc_rows').update({ data: newData }).eq('id', rowId);
    if (error) { alert('Save failed: ' + error.message); return; }
    setDocuments(prev => prev.map(doc => ({
      ...doc,
      rows: doc.rows.map(r => r.id === rowId ? { ...r, data: newData } : r),
    })));
    setSavedCell(editingCell);
    setTimeout(() => setSavedCell(null), 2000);
    setEditingCell(null);
  };

  const handleCellKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveCell();
    else if (e.key === 'Escape') setEditingCell(null);
  };

  // ── Delete row / document ────────────────────────────────────────────────────

  const deleteRow = async (rowId: number) => {
    if (!confirm('Delete this row?')) return;
    await supabase.from('tech_doc_rows').delete().eq('id', rowId);
    setDocuments(prev => prev.map(doc => ({ ...doc, rows: doc.rows.filter(r => r.id !== rowId) })));
  };

  const deleteDocument = async (doc: TechDocDocument) => {
    if (!confirm(`Delete "${doc.title}"?`)) return;
    if (doc.id > 0) {
      await supabase.from('tech_doc_rows').delete().eq('document_id', doc.id);
      await supabase.from('tech_doc_column_configs').delete().eq('document_id', doc.id);
      await supabase.from('tech_doc_documents').delete().eq('id', doc.id);
      if (doc.file_url) {
        try {
          const url = new URL(doc.file_url);
          const storagePath = decodeURIComponent(url.pathname).split('/om-uploads/')[1];
          if (storagePath) await supabase.storage.from('om-uploads').remove([storagePath]);
        } catch { /* ignore */ }
      }
    } else if (doc.system_type && pid) {
      await supabase.from('tech_doc_rows').delete().eq('project_id', pid).eq('system_type', doc.system_type);
    }
    await load();
  };

  const saveDocumentMeta = async () => {
    if (!editingDoc || editingDoc.id <= 0) return;
    const selectedSystem = projectSystems.find(s => s.name === editingDoc.system_type) ?? null;
    const fields = systemAssignmentFields(selectedSystem ?? (editingDoc.system_type ? { name: editingDoc.system_type, id: undefined } : null));
    await supabase.from('tech_doc_documents').update({
      title: editingDoc.title,
      document_type: editingDoc.document_type,
      notes: editingDoc.notes,
      ...fields,
    }).eq('id', editingDoc.id);
    if (fields.system_type) {
      await supabase.from('tech_doc_rows').update({ system_type: fields.system_type }).eq('document_id', editingDoc.id);
    }
    setEditingDoc(null);
    await load();
  };

  // ── Column config ────────────────────────────────────────────────────────────

  const openColConfig = (doc: TechDocDocument) => {
    setEditingColCfg(columnsFromRows(doc.rows, doc.colConfig).map((col, order) => ({ ...col, order })));
    setModal({ type: 'columns', system: String(doc.id) });
  };

  const saveColConfig = async () => {
    if (modal?.type !== 'columns' || !pid) return;
    const doc = documents.find(d => String(d.id) === modal.system);
    if (!doc) return;
    setSavingCols(true);
    try {
      const payload = {
        project_id: pid,
        system_type: doc.system_type,
        columns: editingColCfg,
        document_id: doc.id > 0 ? doc.id : null,
        updated_at: new Date().toISOString(),
      };
      if (doc.configId) {
        await supabase.from('tech_doc_column_configs').update(payload).eq('id', doc.configId);
      } else {
        await supabase.from('tech_doc_column_configs').insert(payload);
      }
      setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, colConfig: editingColCfg } : d));
      setModal(null);
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally { setSavingCols(false); }
  };

  // ── Export CSV ────────────────────────────────────────────────────────────────

  const exportCSV = (doc: TechDocDocument) => {
    if (doc.rows.length === 0) return;
    const cols = columnsFromRows(doc.rows, doc.colConfig);
    if (cols.length === 0) return;
    const csv = [cols.map(c => c.display_name), ...doc.rows.map(r => cols.map(c => r.data[c.key] ?? ''))].map(row =>
      row.map(c => { const s = String(c); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')
    ).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${(doc.title || 'tech-doc').toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
  };

  const copyMigration = async () => {
    try {
      await navigator.clipboard.writeText(migration039Sql);
      setMigrationCopied(true);
      window.setTimeout(() => setMigrationCopied(false), 2500);
    } catch {
      alert('Clipboard is blocked. Copy supabase/migrations/20260917120000_039_tech_doc_documents.sql manually.');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

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
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Technical Documentation</h2>
            <p className="text-xs text-slate-500 mt-0.5">Upload spreadsheets, name what each document is, and keep more than one per system.</p>
          </div>
          <button
            type="button"
            onClick={() => { setPdfError(null); fileInputRef.current?.click(); }}
            disabled={pdfParsing}
            className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-xl hover:bg-cyan-700 text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />Add spreadsheet
          </button>
        </div>
      </div>

      {needsMigration && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
          <p className="font-semibold">Paste 039 in Supabase to keep multiple named technical documents.</p>
          <button type="button" onClick={() => void copyMigration()} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700">
            {migrationCopied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
            {migrationCopied ? 'Copied 039 — paste in Supabase' : 'Copy 039 SQL'}
          </button>
        </div>
      )}

      {pdfError && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-800 flex-1">{pdfError}</p>
          <button onClick={() => setPdfError(null)} className="text-amber-400 hover:text-amber-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {pdfParsing && (
        <div className="flex items-center gap-3 bg-cyan-50 border border-cyan-200 rounded-xl px-4 py-3">
          <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm font-medium text-cyan-800">Scanning PDF for tables…</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
        {projectSystems.length === 0 ? (
          <p className="text-sm text-slate-500 py-1">No systems yet — import devices or create systems first.</p>
        ) : (
          <>
            <button type="button" onClick={() => setActiveSystem('')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                !activeSystem ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All
              {documents.length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${!activeSystem ? 'bg-cyan-500 text-white' : 'bg-slate-300 text-slate-700'}`}>
                  {documents.length}
                </span>
              )}
            </button>
            {projectSystems.map(system => {
          const Icon = getCategoryStyle(system.category).icon;
          const count = documents.filter(doc => doc.system_type === system.name).length;
          return (
            <button key={system.name} onClick={() => setActiveSystem(system.name)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeSystem === system.name ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              {system.name}
              {count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${activeSystem === system.name ? 'bg-cyan-500 text-white' : 'bg-slate-300 text-slate-700'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
          </>
        )}
      </div>

      {visibleDocuments.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Table2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No technical documents{activeSystem ? ` for ${activeSystem}` : ''} yet</p>
          <p className="text-xs text-slate-400 mt-1">Upload a spreadsheet and describe what it is — door schedule, IP table, and so on.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleDocuments.map(doc => {
            const visibleCols = columnsFromRows(doc.rows, doc.colConfig);
            const expanded = expandedDocId === doc.id;
            return (
              <div key={doc.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-9 h-9 bg-cyan-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-cyan-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{doc.title}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs text-slate-500">
                      {doc.document_type && <span className="bg-slate-100 px-1.5 py-0.5 rounded">{doc.document_type}</span>}
                      {doc.system_type && <span>{doc.system_type}</span>}
                      <span>{doc.rows.length} rows</span>
                      {doc.file_name && <span className="truncate max-w-xs">{doc.file_name}</span>}
                      {doc.notes && <span className="truncate max-w-xs">{doc.notes}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100 inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />File
                      </a>
                    )}
                    <button type="button" onClick={() => setExpandedDocId(expanded ? null : doc.id)} className={`text-xs px-2 py-1 border rounded-lg ${expanded ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                      {expanded ? 'Hide table' : 'View table'}
                    </button>
                    <button type="button" onClick={() => openColConfig(doc)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Settings2 className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => exportCSV(doc)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Download className="w-3.5 h-3.5" /></button>
                    {doc.id > 0 && <button type="button" onClick={() => setEditingDoc(doc)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Pencil className="w-3.5 h-3.5" /></button>}
                    <button type="button" onClick={() => void deleteDocument(doc)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {expanded && (
                  visibleCols.length === 0 ? (
                    <p className="px-5 pb-4 text-sm text-slate-400">No columns configured.</p>
                  ) : (
                    <div className="overflow-x-auto border-t border-slate-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                            {visibleCols.map(col => (
                              <th key={col.key} className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{col.display_name}</th>
                            ))}
                            <th className="w-8 px-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {doc.rows.map((row, idx) => (
                            <tr key={row.id} className="hover:bg-slate-50/70 transition-colors group">
                              <td className="px-4 py-1.5 text-xs text-slate-400 font-mono">{idx + 1}</td>
                              {visibleCols.map(col => {
                                const isEditing = editingCell?.rowId === row.id && editingCell?.key === col.key;
                                const isSaved = savedCell?.rowId === row.id && savedCell?.key === col.key;
                                const val = row.data[col.key] ?? '';
                                return (
                                  <td key={col.key} className="px-2 py-1 min-w-[100px] max-w-[240px]">
                                    {isEditing ? (
                                      <input autoFocus type="text" value={cellValue} onChange={e => setCellValue(e.target.value)} onBlur={saveCell} onKeyDown={handleCellKey} className="w-full px-2 py-1 border border-cyan-500 rounded bg-cyan-50 text-sm font-mono focus:outline-none" />
                                    ) : (
                                      <div onClick={() => startEdit(row.id, col.key, val)} className={`px-2 py-1.5 cursor-pointer rounded text-sm font-mono hover:bg-slate-100 relative ${isSaved ? 'bg-emerald-50' : ''}`}>
                                        {val || <span className="text-slate-300">—</span>}
                                        {isSaved && <Check className="w-3 h-3 absolute right-1 top-2 text-emerald-500" />}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-2 py-1 text-right">
                                <button onClick={() => deleteRow(row.id)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 rounded"><X className="w-3.5 h-3.5" /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {currentPending && !modal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Describe document</h2>
                <p className="text-xs text-slate-400 mt-0.5">File {pendingIndex + 1} of {pendingQueue.length} · {currentPending.file.name}</p>
              </div>
              <button onClick={() => { setPendingQueue([]); setPendingIndex(0); }} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Document title <span className="text-red-500">*</span></label>
                <input value={currentPending.title} onChange={e => updateCurrentPending({ title: e.target.value })} className={ic} placeholder="e.g. Ground floor door schedule" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">What is this document?</label>
                <select value={currentPending.document_type} onChange={e => updateCurrentPending({ document_type: e.target.value })} className={ic}>
                  <option value="">Select type…</option>
                  {TECH_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">System</label>
                <select value={currentPending.system_name} onChange={e => updateCurrentPending({ system_name: e.target.value })} className={ic}>
                  {projectSystems.map(system => <option key={system.name} value={system.name}>{system.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notes</label>
                <textarea value={currentPending.notes} onChange={e => updateCurrentPending({ notes: e.target.value })} rows={2} className={`${ic} resize-none`} placeholder="Optional description" />
              </div>
            </div>
            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => { setPendingQueue([]); setPendingIndex(0); }} className="px-4 py-2 text-slate-600 font-medium text-sm">Cancel</button>
              <button onClick={() => void startParseFromDescribe()} disabled={!currentPending.title.trim() || pdfParsing} className="inline-flex items-center gap-2 px-5 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm disabled:opacity-40">
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {editingDoc && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Edit document</h2>
            <input value={editingDoc.title} onChange={e => setEditingDoc({ ...editingDoc, title: e.target.value })} className={ic} />
            <select value={editingDoc.document_type ?? ''} onChange={e => setEditingDoc({ ...editingDoc, document_type: e.target.value })} className={ic}>
              <option value="">Select type…</option>
              {TECH_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={editingDoc.system_type ?? ''} onChange={e => setEditingDoc({ ...editingDoc, system_type: e.target.value })} className={ic}>
              {projectSystems.map(system => <option key={system.name} value={system.name}>{system.name}</option>)}
            </select>
            <textarea value={editingDoc.notes ?? ''} onChange={e => setEditingDoc({ ...editingDoc, notes: e.target.value })} rows={2} className={`${ic} resize-none`} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingDoc(null)} className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg">Cancel</button>
              <button onClick={() => void saveDocumentMeta()} className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-lg">Save</button>
            </div>
          </div>
        </div>
      )}

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
                <h3 className="text-base font-semibold text-slate-900">Import — {pendingMeta?.title || modal.file.name}</h3>
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
                disabled={importing || importColCfg.filter(c => c.visible).length === 0 || modal.previewRows.length === 0}
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
                <h3 className="text-base font-semibold text-slate-900">Columns — {documents.find(d => String(d.id) === modal.system)?.title ?? 'Document'}</h3>
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
