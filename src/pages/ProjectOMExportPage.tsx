import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { groupDevices } from '../lib/deviceGrouping';
import { deriveProjectSystems, deviceBelongsToSystem, getCategoryStyle, populatedProjectSystems, type ProjectSystem } from '../lib/systems';
import {
  documentBelongsToProjectSystems,
  groupRecordsByProjectSystems,
} from '../lib/documentProjectSystems';
import { fetchProjectSystems } from '../lib/projectSystemsDb';
import { findLibraryDatasheetForDevice } from '../lib/datasheetMatching';
import { selectProductPageIndexes } from '../lib/datasheetLookup';
import { forgetDatasheet } from '../lib/datasheetLookup';
import { FALLBACK_DOCUMENT_DEFINITIONS, titleForLegacyDocumentId } from '../lib/handoverDocumentConfig';
import {
  DEFAULT_PRODUCT_WARRANTY_YEARS,
  resolveWarrantyYearsForPartNumber,
} from '../lib/productWarranty';
import { useProject } from './ProjectLayout';
import type { Device, CommissioningRecord, HandoverDocument, Datasheet, ProjectSystemRecord } from '../types';
import { canAccessDocumentManagement, isEndUser } from '../lib/appRoles';
import { displayProjectJobNumber } from '../lib/projectJobNumber';
import { useUserAccess } from '../lib/userAccess';
import { OmClientInvitePanel } from '../components/OmClientInvitePanel';
import { MarkdownDocEditor, documentPreviewClassName, renderDocumentHtml, usesSimproLayout } from '../components/MarkdownDocEditor';
import { MaintenancePlanSection, PrintMaintenancePlan } from '../components/MaintenancePlanSection';
import { PACIFIC_LABEL_GREY } from '../components/FormLetterhead';
import {
  fetchContractorForProject,
  imageUrlToDataUrl,
  resolveOmBrand,
} from '../lib/contractorBrand';
import {
  createDefaultMaintenancePlan,
  hydrateStoredMaintenancePlan,
  maintenancePlanHasContent,
  serializeMaintenancePlan,
  type MaintenancePlanDoc,
} from '../lib/maintenancePlanDefaults';
import {
  Printer, BookOpen, FileText, ClipboardCheck, Award,
  Upload, X, CheckCircle, AlertCircle, ExternalLink, ChevronRight,
  Camera, Lock, ShieldAlert, PhoneCall, ScanLine, Radar, Network,
  Building2, Calendar, User, Tag, CalendarCheck, Loader2, Layers,
  ListOrdered, Wifi, BookMarked, Plus, Search, Trash2, Download,
  ClipboardList, Eye,
} from 'lucide-react';
import { humanizeOption } from '../lib/schemaForm';
import { openProtectedTechDoc, PROTECTED_DOC_NOTICE, TECH_DOC_DOCUMENT_SELECT, TECH_DOC_DOCUMENT_SELECT_BASE } from '../lib/techDocProtected';
import {
  ProtectedTechDocPasswordPrompt,
  ProtectedTechDocViewer,
} from '../components/ProtectedTechDocAccess';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OmUpload {
  id: number;
  section: string;
  system_type: string | null;
  project_system_id: number | null;
  file_name: string;
  file_url: string;
}

interface ProjectDoc {
  id: number;
  document_type: string;
  title: string;
  content: string | null;
  status: string;
  generated_by: string | null;
}

interface AsBuiltDrawing {
  id: number;
  title: string;
  drawing_number: string | null;
  revision: string | null;
  system_type: string | null;
  project_system_id: number | null;
  file_name: string;
  file_url: string;
}

interface AsFittedItemRow {
  id: string;
  quoted_description: string | null;
  quoted_quantity: number | null;
  installed_description: string | null;
  actual_installed_quantity: number | null;
  reconciliation_status: string;
  change_reason: string | null;
}

type TocHotspot = {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  destPage: number;
};

// ─── PDF page renderer ────────────────────────────────────────────────────────
// Renders all pages of a PDF URL into base64 image data URLs using pdfjs-dist.
// Returns an array of data URL strings (one per page), or null on error.

type PdfRenderState = { pages: string[]; loading: boolean; failed: boolean };

async function fetchPdfBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

async function mergeNativePdfPages(
  jsPdfBytes: ArrayBuffer | null,
  nativeInserts: { index: number; bytes: Uint8Array }[],
) {
  const { PDFDocument } = await import('pdf-lib');
  const out = jsPdfBytes
    ? await PDFDocument.load(jsPdfBytes)
    : await PDFDocument.create();
  let offset = 0;
  for (const insert of nativeInserts) {
    const src = await PDFDocument.load(insert.bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    let at = Math.min(insert.index + offset, out.getPageCount());
    for (const page of copied) {
      out.insertPage(at, page);
      at += 1;
    }
    offset += copied.length;
  }
  return out;
}

async function addOmPdfNavigation(
  doc: Awaited<ReturnType<typeof mergeNativePdfPages>>,
  sectionPageMap: Record<string, number>,
  anchorLabels: Record<string, string>,
  tocPageNum: number | undefined,
  hotspots: TocHotspot[],
) {
  const { PDFName, PDFHexString } = await import('pdf-lib');
  const pages = doc.getPages();
  const context = doc.context;

  const outlineItems = Object.entries(sectionPageMap)
    .map(([anchorId, pageNum]) => ({
      title: anchorLabels[anchorId] ?? anchorId.replace(/^print-section-/, '').replace(/_/g, ' '),
      pageIndex: pageNum - 1,
    }))
    .filter(item => item.pageIndex >= 0 && item.pageIndex < pages.length);

  if (outlineItems.length > 0) {
    const outlinesRef = context.nextRef();
    const itemRefs = outlineItems.map(() => context.nextRef());
    outlineItems.forEach((item, i) => {
      context.assign(itemRefs[i], context.obj({
        Title: PDFHexString.fromText(item.title),
        Parent: outlinesRef,
        Dest: [pages[item.pageIndex].ref, PDFName.of('Fit')],
        ...(i > 0 ? { Prev: itemRefs[i - 1] } : {}),
        ...(i < outlineItems.length - 1 ? { Next: itemRefs[i + 1] } : {}),
      }));
    });
    context.assign(outlinesRef, context.obj({
      Type: PDFName.of('Outlines'),
      First: itemRefs[0],
      Last: itemRefs[itemRefs.length - 1],
      Count: outlineItems.length,
    }));
    doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  }

  if (!tocPageNum || hotspots.length === 0) return;
  const tocPage = pages[tocPageNum - 1];
  if (!tocPage) return;
  const { height } = tocPage.getSize();
  const mmToPt = 72 / 25.4;
  for (const spot of hotspots) {
    const dest = pages[spot.destPage - 1];
    if (!dest) continue;
    const x = spot.xMm * mmToPt;
    const w = spot.wMm * mmToPt;
    const h = spot.hMm * mmToPt;
    const y = height - (spot.yMm + spot.hMm) * mmToPt;
    const annot = context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: [x, y, x + w, y + h],
      Border: [0, 0, 0],
      Dest: [dest.ref, PDFName.of('Fit')],
    });
    tocPage.node.addAnnot(context.register(annot));
  }
}

async function pageTextFromPdf(page: { getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }): Promise<string> {
  const content = await page.getTextContent();
  return content.items.map(item => item.str ?? '').join(' ');
}

async function renderPdfToImages(
  url: string,
  product?: { manufacturer: string; model: string },
): Promise<string[] | null> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;

    let data: ArrayBuffer | null = null;
    try {
      const res = await fetch(url);
      if (res.ok) data = await res.arrayBuffer();
    } catch {
      data = null;
    }

    const pdf = data
      ? await pdfjsLib.getDocument({ data }).promise
      : await pdfjsLib.getDocument({ url, withCredentials: false }).promise;
    let pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
    if (product?.manufacturer && product.model) {
      const texts: string[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        texts.push(await pageTextFromPdf(page));
        if (pageNum < pdf.numPages) await new Promise(resolve => window.setTimeout(resolve, 0));
      }
      pageNumbers = selectProductPageIndexes(texts, product.manufacturer, product.model).map(index => index + 1);
    }
    const pages: string[] = [];
    const renderPages = pageNumbers.slice(0, 12);
    for (let i = 0; i < renderPages.length; i++) {
      const page = await pdf.getPage(renderPages[i]);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await (page.render as (params: Record<string, unknown>) => { promise: Promise<void> })({
        canvas,
        canvasContext: ctx,
        viewport,
      }).promise;
      pages.push(canvas.toDataURL('image/jpeg', 0.88));
      if (i < renderPages.length - 1) await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    return pages;
  } catch {
    return null;
  }
}

interface OtherHandoverDoc {
  id: number;
  title: string;
  description: string | null;
  system_type: string | null;
  project_system_id: number | null;
  file_name: string | null;
  file_url: string | null;
  link_url: string | null;
}

interface DeviceWithDatasheet extends Device {
  datasheet: Datasheet | null;
  warrantyYears: number | null;
  maintenanceNotes: string | null;
}

type Section = 'index' | 'cover' | 'contractor' | 'scope' | 'as_fitted' | 'schedule' | 'technical_docs' | 'maintenance_plan' | 'commissioning' | 'handover' | 'as_fitted_drawings' | 'datasheets' | 'user_manuals';

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'index',              label: 'Table of Contents',    icon: ListOrdered },
  { id: 'cover',              label: 'Cover Page',           icon: BookOpen },
  { id: 'contractor',         label: 'Contractor Information', icon: Building2 },
  { id: 'scope',              label: 'Scope of Works',       icon: FileText },
  { id: 'as_fitted',          label: 'As Fitted',            icon: ClipboardList },
  { id: 'schedule',           label: 'Device Schedule and Warranties',      icon: ClipboardCheck },
  { id: 'technical_docs',     label: 'Technical Docs',       icon: Wifi },
  { id: 'maintenance_plan',   label: 'Maintenance Plan',     icon: CalendarCheck },
  { id: 'commissioning',      label: 'Commissioning Pack',   icon: CheckCircle },
  { id: 'handover',           label: 'Handover Certificate', icon: Award },
  { id: 'as_fitted_drawings', label: 'As Fitted Drawings',   icon: Layers },
  { id: 'datasheets',         label: 'Datasheet Index',      icon: ExternalLink },
  { id: 'user_manuals',       label: 'User Manuals',         icon: BookMarked },
];

const PRINT_SECTION_ANCHOR: Record<Section, string> = {
  index: 'print-section-toc',
  cover: 'print-section-cover',
  contractor: 'print-section-contractor',
  scope: 'print-section-scope',
  as_fitted: 'print-section-as_fitted',
  schedule: 'print-section-schedule',
  technical_docs: 'print-section-technical_docs',
  maintenance_plan: 'print-section-maintenance_plan',
  commissioning: 'print-section-commissioning',
  handover: 'print-section-handover',
  as_fitted_drawings: 'print-section-as_fitted_drawings',
  datasheets: 'print-section-datasheets',
  user_manuals: 'print-section-user_manuals',
};

const SYS_ICONS: Partial<Record<SystemType, React.ElementType>> = {
  'CCTV': Camera, 'Access Control': Lock, 'Intruder': ShieldAlert,
  'Intercom': PhoneCall, 'ANPR': ScanLine, 'Perimeter Detection': Radar, 'Networking': Network,
};

// All upload sections that belong to the Handover pack
const HANDOVER_SECTION_LABELS: Record<string, string> = Object.fromEntries(
  FALLBACK_DOCUMENT_DEFINITIONS.map(def => [def.document_id, def.title]),
);

function handoverSectionLabel(section: string): string {
  return HANDOVER_SECTION_LABELS[section] ?? titleForLegacyDocumentId(section);
}

const HANDOVER_SECTIONS = new Set([...Object.keys(HANDOVER_SECTION_LABELS), 'handover']);

function systemsWithTechImport(
  documentSystems: ReturnType<typeof deriveProjectSystems>,
  techDocState: Partial<Record<string, { rows: { length: number }[] }>>,
): string[] {
  return documentSystems
    .map(system => system.name)
    .filter(name => (techDocState[name]?.rows.length ?? 0) > 0)
    .sort((a, b) => a.localeCompare(b));
}

type TechDocColumn = { key: string; display_name: string; visible: boolean; order: number };
type TechDocPrintRow = { id: number; row_index: number; data: Record<string, string> };
type TechDocBundle = {
  key: string;
  id?: number;
  title: string;
  system: string;
  rows: TechDocPrintRow[];
  colConfig: TechDocColumn[];
  isProtected?: boolean;
  includeInOm?: boolean;
  visibleInPortal?: boolean;
  hasFilePassword?: boolean;
  fileName?: string | null;
};

const OmBrandContext = React.createContext(resolveOmBrand(null));
function useOmBrand() {
  return React.useContext(OmBrandContext);
}

const PACIFIC_MUTED_RGB: [number, number, number] = [120, 120, 120];
const TECH_DOC_PRINT_ROWS = 18;
const TECH_DOC_PRINT_ROWS_LANDSCAPE = 12;
const PRINT_LANDSCAPE_COL_THRESHOLD = 6;

async function loadBrandLogoDataUrl(src: string): Promise<string | null> {
  return imageUrlToDataUrl(src);
}

function sameSystemName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

function asTechDocData(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return asTechDocData(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    raw.forEach((value, index) => {
      out[String(index)] = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
    return out;
  }
  if (typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) out[key] = '';
    else if (typeof value === 'object') out[key] = JSON.stringify(value);
    else out[key] = String(value);
  }
  return out;
}

function normalizeTechDocKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function techDocCell(data: Record<string, string> | null | undefined, col: Pick<TechDocColumn, 'key' | 'display_name' | 'order'>): string {
  if (!data) return '';
  for (const candidate of [col.key, col.display_name]) {
    const direct = data[candidate];
    if (direct != null && String(direct).trim()) return String(direct);
  }
  const wanted = new Set([col.key, col.display_name].map(normalizeTechDocKey).filter(Boolean));
  for (const [key, value] of Object.entries(data)) {
    if (wanted.has(normalizeTechDocKey(key)) && String(value ?? '').trim()) return String(value);
  }
  const byIndex = data[String(col.order)];
  if (byIndex != null && String(byIndex).trim()) return String(byIndex);
  return '';
}

function columnsFromRowData(rows: TechDocPrintRow[]): TechDocColumn[] {
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

function resolveTechDocColumns(colConfig: TechDocColumn[] | undefined, rows: TechDocPrintRow[]): TechDocColumn[] {
  const configured = (colConfig ?? []).filter(col => col.visible).sort((a, b) => a.order - b.order);
  const sample = rows.slice(0, 30);
  if (configured.length === 0) return columnsFromRowData(rows);
  const matched = configured.filter(col => sample.some(row => techDocCell(row.data, col).trim())).length;
  if (sample.length > 0 && matched < Math.max(1, Math.ceil(configured.length * 0.3))) {
    const fromData = columnsFromRowData(rows);
    return fromData.map((col, i) => ({
      ...col,
      display_name: configured[i]?.display_name || col.display_name,
    }));
  }
  return configured;
}

function printTableNeedsLandscape(columnCount: number): boolean {
  return columnCount > PRINT_LANDSCAPE_COL_THRESHOLD;
}

function chunkTechDocRows<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

const HTML2CANVAS_MAX_H = 1400;

function canvasIsMostlyBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width < 2 || canvas.height < 2) return true;
  const sampleW = Math.min(canvas.width, 240);
  const sampleH = Math.min(canvas.height, 240);
  const { data } = ctx.getImageData(0, 0, sampleW, sampleH);
  let ink = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248) ink++;
  }
  return ink < 12;
}

function preparePrintClone(clonedDoc: Document, sourceEl: HTMLElement, clonedEl?: HTMLElement, renderW?: number) {
  const root = clonedDoc.getElementById('om-print-root');
  if (root) {
    root.classList.remove('hidden');
    root.style.cssText = `display:block!important;position:static;left:0;top:0;width:${renderW ? `${renderW}px` : 'auto'};height:auto;overflow:visible;background:white;visibility:visible;opacity:1;`;
  }
  const node = clonedEl instanceof HTMLElement
    ? clonedEl
    : (sourceEl.id ? clonedDoc.getElementById(sourceEl.id) : null);
  if (node instanceof HTMLElement) {
    node.style.overflow = 'visible';
    node.style.height = 'auto';
    node.style.maxHeight = 'none';
    node.style.transform = 'none';
    node.style.position = 'relative';
    node.style.left = '0';
    node.style.top = '0';
    if (renderW) node.style.width = `${renderW}px`;
  }
}

async function capturePrintElement(
  el: HTMLElement,
  html2canvas: (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>,
  renderW: number,
): Promise<HTMLCanvasElement> {
  const width = Math.max(renderW, el.scrollWidth, el.offsetWidth, 1);
  const height = Math.max(el.scrollHeight, el.offsetHeight, 1);
  const scale = width * height * 4 > 24_000_000 ? 1 : 2;

  const run = (opts: Record<string, unknown>) => html2canvas(el, {
    scale,
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 15000,
    ...opts,
    onclone: (clonedDoc: Document, clonedEl?: HTMLElement) => {
      preparePrintClone(clonedDoc, el, clonedEl, width);
    },
  });

  const captureFull = async (useScale: number) => run({
    scale: useScale,
    width,
    windowWidth: width,
    windowHeight: Math.max(height, 1),
    scrollX: 0,
    scrollY: 0,
  });

  if (height <= HTML2CANVAS_MAX_H) {
    const canvas = await captureFull(scale);
    if (!canvasIsMostlyBlank(canvas)) return canvas;
    return captureFull(1);
  }

  const captureSlice = async (y: number, sliceH: number) => {
    const canvas = await run({
      width,
      height: sliceH,
      windowWidth: width,
      windowHeight: Math.max(sliceH, 1),
      x: 0,
      y,
      scrollX: 0,
      scrollY: 0,
    });
    if (!canvasIsMostlyBlank(canvas)) return canvas;
    return run({
      scale: 1,
      width,
      height: sliceH,
      windowWidth: width,
      windowHeight: Math.max(sliceH, 1),
      x: 0,
      y,
      scrollX: 0,
      scrollY: 0,
    });
  };

  const out = document.createElement('canvas');
  out.width = Math.ceil(width * scale);
  out.height = Math.ceil(height * scale);
  const ctx = out.getContext('2d');
  if (!ctx) return captureSlice(0, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);

  for (let y = 0; y < height; y += HTML2CANVAS_MAX_H) {
    const sliceH = Math.min(HTML2CANVAS_MAX_H, height - y);
    const tile = await captureSlice(y, sliceH);
    ctx.drawImage(tile, 0, Math.round(y * (out.height / height)));
  }
  return out;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProjectOMExportPage() {
  const { id } = useParams<{ id: string }>();
  const { project, productModels, datasheets, refreshDatasheets } = useProject();
  const { role } = useUserAccess();
  const packReadOnly = isEndUser(role);
  const [selectedSections, setSelectedSections] = useState<Section[]>(() => SECTIONS.map(s => s.id));

  const [activeSection, setActiveSection] = useState<Section>('cover');
  const [devices, setDevices] = useState<DeviceWithDatasheet[]>([]);
  const [systemRows, setSystemRows] = useState<ProjectSystemRecord[]>([]);
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
  const [commRecords, setCommRecords] = useState<CommissioningRecord[]>([]);
  const [handoverDocs, setHandoverDocs] = useState<HandoverDocument[]>([]);
  const [omUploads, setOmUploads] = useState<OmUpload[]>([]);
  const [asFittedDrawings, setAsFittedDrawings] = useState<AsBuiltDrawing[]>([]);
  const [asFittedItems, setAsFittedItems] = useState<AsFittedItemRow[]>([]);
  const [asFittedContent, setAsFittedContent] = useState('');
  const [asFittedSaving, setAsFittedSaving] = useState(false);
  const [scHandoverDocs, setScHandoverDocs] = useState<{ id?: number; document_type: string; title: string; status: string; file_url: string | null; file_name: string | null; sc_inspection_id: string | null; sc_result: string | null; system_type?: string | null; project_system_id?: number | null }[]>([]);
  const [otherHandoverDocs, setOtherHandoverDocs] = useState<OtherHandoverDoc[]>([]);
  const [projectManuals, setProjectManuals] = useState<{ id: number; manual_id: number; manual: { title: string; description: string | null; manufacturer: string | null; model_number: string | null; file_name: string; file_url: string } }[]>([]);
  const [contractorProfile, setContractorProfile] = useState<any>(null);
  const [docAuthority, setDocAuthority] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRemoveDatasheetKey, setConfirmRemoveDatasheetKey] = useState<string | null>(null);
  const [removingDatasheet, setRemovingDatasheet] = useState(false);

  // Tech doc imported data: { rows, colConfig } per system
  const [techDocState, setTechDocState] = useState<Partial<Record<string, { rows: { id: number; row_index: number; data: Record<string, string> }[]; colConfig: { key: string; display_name: string; visible: boolean; order: number }[] }>>>({});
  const [techDocBundles, setTechDocBundles] = useState<TechDocBundle[]>([]);

  const [pdfPageImages, setPdfPageImages] = useState<Record<string, PdfRenderState>>({});
  const pdfRenderStarted = useRef(new Set<string>());
  const pdfQueue = useRef<string[]>([]);
  const pdfQueueRunning = useRef(false);
  const pdfProductFilter = useRef(new Map<string, { manufacturer: string; model: string }>());

  // Scope of works edit state
  const [scopeContent, setScopeContent] = useState('');
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeRegenerating, setScopeRegenerating] = useState(false);
  const [activeSystems, setActiveSystems] = useState<string[]>([]);

  // Maintenance plan per-system edit state: Record<systemType, content>
  const [maintPlans, setMaintPlans] = useState<Record<string, MaintenancePlanDoc>>({});
  const [maintPlanSaving, setMaintPlanSaving] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSectionRef = useRef<string>('');

  const pid = id ? parseInt(id) : null;

  // ── Load data ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    const [
      { data: devData },
      { data: docData },
      { data: commData },
      { data: handData },
      { data: uplData },
      { data: afdData },
      contrData,
      { data: authData },
      { data: scHandData },
      { data: otherHandData },
      { data: manualData },
      { data: techRowData },
      { data: techCfgData },
      { data: systemData },
      techDocDocsRes,
      asFittedItemsRes,
    ] = await Promise.all([
      supabase.from('devices').select('*').eq('project_id', pid).neq('status', 'pending_review').order('system_type').order('device_name'),
      supabase.from('project_documents').select('*').eq('project_id', pid),
      supabase.from('commissioning_records').select('*').eq('project_id', pid).order('system_type').order('sort_order'),
      supabase.from('handover_documents').select('*').eq('project_id', pid),
      supabase.from('om_pack_uploads').select('*').eq('project_id', pid),
      supabase.from('as_fitted_drawings').select('*').eq('project_id', pid).order('created_at'),
      fetchContractorForProject({ projectId: pid, contractorProfileId: project?.contractor_profile_id }),
      supabase.from('document_authority').select('*').eq('project_id', pid).maybeSingle(),
      supabase.from('project_handover_docs').select('id,document_type,title,status,file_url,file_name,sc_inspection_id,sc_result,system_type,project_system_id').eq('project_id', pid).in('status', ['completed', 'imported', 'uploaded']),
      supabase.from('handover_other_docs').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('project_user_manuals').select('id, manual_id, manual:user_manuals(title,description,manufacturer,model_number,file_name,file_url,link_url)').eq('project_id', pid),
      supabase.from('tech_doc_rows').select('*').eq('project_id', pid).order('system_type').order('row_index'),
      supabase.from('tech_doc_column_configs').select('*').eq('project_id', pid),
      fetchProjectSystems(pid).catch(() => [] as ProjectSystemRecord[]),
      supabase.from('tech_doc_documents').select(TECH_DOC_DOCUMENT_SELECT).eq('project_id', pid).order('created_at', { ascending: true }),
      supabase.from('as_fitted_items').select('id,quoted_description,quoted_quantity,installed_description,actual_installed_quantity,reconciliation_status,change_reason').eq('project_id', pid).order('created_at'),
    ]);

    let namedTechDocsRes = techDocDocsRes;
    if (namedTechDocsRes.error && /has_file_password/i.test(namedTechDocsRes.error.message ?? '')) {
      namedTechDocsRes = await supabase.from('tech_doc_documents').select(TECH_DOC_DOCUMENT_SELECT_BASE).eq('project_id', pid).order('created_at', { ascending: true });
    }

    const enriched: DeviceWithDatasheet[] = (devData ?? []).map(d => {
      const ds = findLibraryDatasheetForDevice(d.manufacturer, d.model_number, datasheets);
      return {
        ...d,
        datasheet: ds ?? null,
        warrantyYears: resolveWarrantyYearsForPartNumber(d.model_number, productModels),
        maintenanceNotes: null,
      };
    });

    setDevices(enriched);
    setSystemRows(systemData ?? []);
    setProjectDocs(docData ?? []);
    setCommRecords(commData ?? []);
    setHandoverDocs(handData ?? []);
    setOmUploads(uplData ?? []);
    setAsFittedDrawings(afdData ?? []);
    setAsFittedItems((asFittedItemsRes.error ? [] : asFittedItemsRes.data ?? []) as AsFittedItemRow[]);
    setScHandoverDocs(scHandData ?? []);
    setOtherHandoverDocs((otherHandData ?? []) as OtherHandoverDoc[]);
    setProjectManuals((manualData ?? []) as any);
    setContractorProfile(contrData ?? null);
    setDocAuthority(authData ?? null);

    // Build techDocState per project system / cost centre
    const baseSystems = populatedProjectSystems(deriveProjectSystems(enriched, systemData ?? []));
    const documentSystems = baseSystems;
    const namedDocs = namedTechDocsRes.data ?? [];
    const protectedDocIds = new Set(
      namedDocs.filter((doc: { is_protected?: boolean; id: number }) => doc.is_protected).map((doc: { id: number }) => doc.id),
    );
    const tdState: typeof techDocState = {};
    const mappedRows = (techRowData ?? []).map((r: { id: number; row_index: number; data: unknown; system_type: string; document_id?: number | null }) => ({
      id: r.id,
      row_index: r.row_index,
      system_type: r.system_type,
      document_id: r.document_id ?? null,
      data: asTechDocData(r.data),
    }));
    for (const system of documentSystems) {
      const rows = mappedRows
        .filter(r => sameSystemName(r.system_type, system.name) && (r.document_id == null || !protectedDocIds.has(r.document_id)))
        .sort((a, b) => a.row_index - b.row_index);
      const cfg = (techCfgData ?? []).find((c: { system_type: string }) => sameSystemName(c.system_type, system.name));
      tdState[system.name] = { rows, colConfig: (cfg?.columns ?? []) };
    }
    setTechDocState(tdState);

    const bundles: TechDocBundle[] = [];
    if (namedDocs.length > 0) {
      for (const doc of namedDocs) {
        const rows = mappedRows.filter(r => r.document_id === doc.id).sort((a, b) => a.row_index - b.row_index);
        const cfg = (techCfgData ?? []).find((c: { document_id?: number | null }) => c.document_id === doc.id)
          ?? (techCfgData ?? []).find((c: { system_type: string; document_id?: number | null }) => !c.document_id && sameSystemName(c.system_type, doc.system_type));
        bundles.push({
          key: `doc-${doc.id}`,
          id: Number(doc.id),
          title: doc.title || doc.file_name || `${doc.system_type || 'Technical'} table`,
          system: doc.system_type || '',
          rows: doc.is_protected ? [] : rows,
          colConfig: (cfg?.columns ?? []) as TechDocColumn[],
          isProtected: !!doc.is_protected,
          includeInOm: doc.include_in_om !== false,
          visibleInPortal: doc.visible_in_portal !== false,
          hasFilePassword: !!doc.has_file_password,
          fileName: doc.file_name ?? null,
        });
      }
      const orphanRows = mappedRows.filter(r => !r.document_id || !namedDocs.some((d: { id: number }) => d.id === r.document_id));
      const bySystem = new Map<string, typeof orphanRows>();
      for (const row of orphanRows) {
        const key = row.system_type || 'Technical Documentation';
        const bucket = bySystem.get(key) ?? [];
        bucket.push(row);
        bySystem.set(key, bucket);
      }
      for (const [system, rows] of bySystem) {
        const cfg = (techCfgData ?? []).find((c: { system_type: string; document_id?: number | null }) => !c.document_id && sameSystemName(c.system_type, system));
        bundles.push({
          key: `legacy-${system}`,
          title: `${system} table`,
          system,
          rows,
          colConfig: (cfg?.columns ?? []) as TechDocColumn[],
        });
      }
    } else {
      for (const [system, state] of Object.entries(tdState)) {
        if ((state?.rows.length ?? 0) === 0) continue;
        bundles.push({
          key: `system-${system}`,
          title: `${system} — Technical Documentation`,
          system,
          rows: state!.rows,
          colConfig: state!.colConfig,
        });
      }
    }
    setTechDocBundles(bundles);

    // Build per-system maintenance plans from project_documents
    const planMap: Record<string, MaintenancePlanDoc> = {};
    const selectedSystems = deriveProjectSystems(devData ?? [], systemData ?? [])
      .filter(system => system.deviceCount > 0)
      .map(system => system.name);
    const docs = [...(docData ?? [])] as ProjectDoc[];

    const persistPlan = async (
      systemName: string,
      plan: MaintenancePlanDoc,
      existingId?: number,
      generatedBy: 'auto' | 'manual' = 'auto',
    ): Promise<ProjectDoc | null> => {
      const payload = {
        project_id: pid,
        document_type: `maintenance_plan_${systemName}`,
        title: `${systemName} Maintenance Plan`,
        content: serializeMaintenancePlan(plan),
        status: 'draft' as const,
        generated_by: generatedBy,
      };
      if (existingId) {
        await supabase.from('project_documents').update({
          content: payload.content,
          title: payload.title,
        }).eq('id', existingId);
        return { id: existingId, document_type: payload.document_type, title: payload.title, content: payload.content, status: payload.status, generated_by: generatedBy };
      }
      const { data: existingRows } = await supabase
        .from('project_documents')
        .select('id, document_type, title, content, status, generated_by')
        .eq('project_id', pid)
        .eq('document_type', payload.document_type)
        .limit(1);
      if (existingRows?.[0]) {
        await supabase.from('project_documents').update({
          content: payload.content,
          title: payload.title,
        }).eq('id', existingRows[0].id);
        return { ...existingRows[0], content: payload.content, title: payload.title };
      }
      const { data } = await supabase.from('project_documents').insert(payload).select('id, document_type, title, content, status, generated_by').single();
      return data ?? null;
    };

    for (const systemName of selectedSystems) {
      const existing = docs.find(d => d.document_type === `maintenance_plan_${systemName}`);
      if (!existing) {
        const plan = createDefaultMaintenancePlan(systemName);
        planMap[systemName] = plan;
        if (!packReadOnly && plan.tasks.length > 0) {
          const row = await persistPlan(systemName, plan);
          if (row) docs.push(row);
        }
        continue;
      }
      const { plan, converted } = hydrateStoredMaintenancePlan(systemName, existing.content, existing.generated_by);
      planMap[systemName] = plan;
      if (converted && !packReadOnly) {
        await persistPlan(systemName, plan, existing.id, existing.generated_by === 'manual' ? 'manual' : 'auto');
        const idx = docs.findIndex(d => d.id === existing.id);
        if (idx >= 0) {
          docs[idx] = {
            ...docs[idx],
            content: serializeMaintenancePlan(plan),
            title: `${systemName} Maintenance Plan`,
          };
        }
      }
    }

    setProjectDocs(docs);
    setMaintPlans(planMap);
    setActiveSystems(selectedSystems);

    // Auto-generate scope when there is no existing content — use Claude if possible
    const existingScope = (docData ?? []).find(d => d.document_type === 'scope_of_works');
    if ((!existingScope || !existingScope.content?.trim()) && selectedSystems.length > 0 && !packReadOnly) {
      setScopeContent('');
      setScopeRegenerating(true);
      // Fire-and-forget so the rest of the page loads immediately
      (async () => {
        const { data: srcDocs } = await supabase.from('project_source_docs').select('*').eq('project_id', pid!);
        const generated = await callGenerateScope(project, srcDocs ?? [], devData ?? []);
        const finalScope = generated ?? buildAutoScope(
          selectedSystems.map(sys => ({
            system: sys as string,
            devices: (devData ?? []).filter(d => d.system_type === sys) as any[],
          })),
          project?.site_name,
          project?.client_name
        );
        setScopeContent(finalScope);
        setScopeRegenerating(false);
        if (existingScope) {
          await supabase.from('project_documents').update({ content: finalScope, generated_by: 'auto' }).eq('id', existingScope.id);
        } else {
          await supabase.from('project_documents').insert({
            project_id: pid,
            document_type: 'scope_of_works',
            title: 'Scope of Works',
            content: finalScope,
            status: 'draft',
            generated_by: 'auto',
          });
        }
      })();
    } else {
      setScopeContent(existingScope?.content ?? '');
    }
    setAsFittedContent((docData ?? []).find(d => d.document_type === 'as_fitted_scope')?.content ?? '');

    setLoading(false);
  }, [pid, productModels, datasheets, project, packReadOnly]);

  useEffect(() => { load(); }, [load]);

  const omBrand = useMemo(() => resolveOmBrand(contractorProfile), [contractorProfile]);

  const packPdfUrls = useMemo(() => {
    const urls: string[] = [];
    const add = (url?: string | null) => {
      if (url && !urls.includes(url)) urls.push(url);
    };
    for (const upload of omUploads) add(upload.file_url);
    for (const doc of scHandoverDocs) add(doc.file_url);
    for (const doc of otherHandoverDocs) add(doc.file_url);
    for (const drawing of asFittedDrawings) add(drawing.file_url);
    for (const device of devices) add(device.datasheet?.datasheet_url ?? null);
    for (const manual of projectManuals) add(manual.manual.file_url);
    return urls;
  }, [omUploads, scHandoverDocs, otherHandoverDocs, asFittedDrawings, devices, projectManuals]);

  const eagerPdfUrls = useMemo(() => {
    const urls: string[] = [];
    const add = (url?: string | null) => {
      if (url && !urls.includes(url)) urls.push(url);
    };
    for (const upload of omUploads) add(upload.file_url);
    for (const doc of scHandoverDocs) add(doc.file_url);
    for (const doc of otherHandoverDocs) add(doc.file_url);
    for (const drawing of asFittedDrawings) add(drawing.file_url);
    return urls;
  }, [omUploads, scHandoverDocs, otherHandoverDocs, asFittedDrawings]);

  const lazyPdfUrls = useMemo(() => {
    const eager = new Set(eagerPdfUrls);
    return packPdfUrls.filter(url => !eager.has(url));
  }, [packPdfUrls, eagerPdfUrls]);

  useEffect(() => {
    const next = new Map<string, { manufacturer: string; model: string }>();
    for (const device of devices) {
      const url = device.datasheet?.datasheet_url;
      if (!url || !device.manufacturer?.trim() || !device.model_number?.trim() || next.has(url)) continue;
      next.set(url, { manufacturer: device.manufacturer.trim(), model: device.model_number.trim() });
    }
    pdfProductFilter.current = next;
  }, [devices]);

  const pumpPdfQueue = useCallback(async () => {
    if (pdfQueueRunning.current) return;
    pdfQueueRunning.current = true;
    while (pdfQueue.current.length > 0) {
      const url = pdfQueue.current.shift();
      if (!url || pdfRenderStarted.current.has(url)) continue;
      pdfRenderStarted.current.add(url);
      setPdfPageImages(prev => ({ ...prev, [url]: { pages: [], loading: true, failed: false } }));
      const pages = await renderPdfToImages(url, pdfProductFilter.current.get(url));
      setPdfPageImages(prev => ({
        ...prev,
        [url]: { pages: pages ?? [], loading: false, failed: pages === null },
      }));
      await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    pdfQueueRunning.current = false;
  }, []);

  const enqueuePdfRender = useCallback((urls: string[]) => {
    for (const url of urls) {
      if (!url || pdfRenderStarted.current.has(url) || pdfQueue.current.includes(url)) continue;
      pdfQueue.current.push(url);
    }
    void pumpPdfQueue();
  }, [pumpPdfQueue]);

  useEffect(() => {
    enqueuePdfRender(eagerPdfUrls);
  }, [eagerPdfUrls, enqueuePdfRender]);

  useEffect(() => {
    const timer = window.setTimeout(() => enqueuePdfRender(lazyPdfUrls), 1600);
    return () => window.clearTimeout(timer);
  }, [lazyPdfUrls, enqueuePdfRender]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const projectSystems = populatedProjectSystems(deriveProjectSystems(devices, systemRows));
  const documentSystems = projectSystems;
  const includedSystemNames = new Set(projectSystems.map(system => system.name));
  const importedTechSystems = systemsWithTechImport(documentSystems, techDocState);
  const namedTechBundles = techDocBundles.filter(bundle =>
    bundle.includeInOm !== false
    && (!bundle.system || includedSystemNames.has(bundle.system))
    && (bundle.isProtected || bundle.rows.length > 0),
  );
  const builderTechBundles = techDocBundles.filter(bundle =>
    (!bundle.system || includedSystemNames.has(bundle.system))
    && (
      packReadOnly
        ? bundle.visibleInPortal !== false && (bundle.isProtected || bundle.rows.length > 0)
        : bundle.isProtected || bundle.rows.length > 0
    ),
  );

  const includedHandoverUploads = omUploads.filter(upload =>
    HANDOVER_SECTIONS.has(upload.section) && documentBelongsToProjectSystems(upload, documentSystems),
  );
  const includedScHandoverDocs = scHandoverDocs.filter(doc => documentBelongsToProjectSystems(doc, documentSystems));
  const includedOtherHandoverDocs = otherHandoverDocs.filter(doc => documentBelongsToProjectSystems(doc, documentSystems));
  const includedAsFittedDrawings = asFittedDrawings.filter(drawing => documentBelongsToProjectSystems(drawing, documentSystems));
  const includedCommRecords = commRecords.filter(record => !record.system_type || includedSystemNames.has(record.system_type));

  const systemGroups = projectSystems.map(system => ({
    system: system.name,
    category: system.category,
    devices: devices.filter(device =>
      deviceBelongsToSystem(device, { id: system.id, name: system.name }),
    ),
  }));

  const getUpload = (section: string) => omUploads.find(u => u.section === section);

  const sectionStatus = (s: Section): 'complete' | 'partial' | 'empty' => {
    if (s === 'index') return 'complete';
    if (s === 'cover') return 'complete';
    if (s === 'contractor') return contractorHasInfo(contractorProfile) ? 'complete' : 'empty';
    if (s === 'scope') return scopeContent ? 'complete' : 'empty';
    if (s === 'schedule') return devices.length > 0 ? 'complete' : 'empty';
    if (s === 'technical_docs') {
      const hasTechData = namedTechBundles.length > 0 || importedTechSystems.length > 0;
      const techDevices = devices.filter(d =>
        d.ip_address || d.mac_address || d.firmware_version || d.username_hint || d.password_hint || d.controller_address || d.vlan || d.network_zone
      );
      return hasTechData || techDevices.length > 0 ? 'complete' : 'empty';
    }
    if (s === 'maintenance_plan') return systemGroups.some(g => g.devices.length > 0 && maintenancePlanHasContent(maintPlans[g.system])) ? 'complete' : 'empty';
    if (s === 'commissioning') return getUpload('commissioning') ? 'complete' : includedCommRecords.length > 0 ? 'partial' : 'empty';
    if (s === 'handover') {
      const scReady = includedScHandoverDocs.some(doc => doc.file_url);
      const otherReady = includedOtherHandoverDocs.some(doc => doc.file_url);
      return includedHandoverUploads.length > 0 || scReady || otherReady ? 'complete' : handoverDocs.length > 0 || includedScHandoverDocs.length > 0 ? 'partial' : 'empty';
    }
    if (s === 'as_fitted') return asFittedContent.trim() || asFittedItems.length > 0 ? 'complete' : 'empty';
    if (s === 'as_fitted_drawings') return includedAsFittedDrawings.length > 0 ? 'complete' : 'empty';
    if (s === 'datasheets') return devices.some(d => d.datasheet) ? 'complete' : 'empty';
    if (s === 'user_manuals') return projectManuals.length > 0 ? 'complete' : 'empty';
    return 'empty';
  };

  // ── Scope save ───────────────────────────────────────────────────────────────

  const handleSaveScope = async () => {
    if (!pid) return;
    setScopeSaving(true);
    const existing = projectDocs.find(d => d.document_type === 'scope_of_works');
    if (existing) {
      await supabase.from('project_documents').update({ content: scopeContent, status: 'final' }).eq('id', existing.id);
    } else {
      await supabase.from('project_documents').insert({ project_id: pid, document_type: 'scope_of_works', title: 'Scope of Works', content: scopeContent, status: 'final', generated_by: 'manual' });
    }
    setScopeSaving(false);
    load();
  };

  const handleSaveAsFitted = async () => {
    if (!pid) return;
    setAsFittedSaving(true);
    const existing = projectDocs.find(d => d.document_type === 'as_fitted_scope');
    if (existing) {
      await supabase.from('project_documents').update({ content: asFittedContent, status: 'final' }).eq('id', existing.id);
    } else {
      await supabase.from('project_documents').insert({ project_id: pid, document_type: 'as_fitted_scope', title: 'As Fitted', content: asFittedContent, status: 'final', generated_by: 'manual' });
    }
    setAsFittedSaving(false);
    load();
  };

  const handleRegenerateScope = async () => {
    if (!pid) return;
    setScopeRegenerating(true);
    try {
      const { data: sourceDocs } = await supabase
        .from('project_source_docs')
        .select('*')
        .eq('project_id', pid)
        .order('created_at', { ascending: true });

      const generated = await callGenerateScope(project, sourceDocs ?? [], devices);
      const newScope = generated ?? buildAutoScope(systemGroups, project?.site_name, project?.client_name);

      setScopeContent(newScope);
      setScopeSaving(true);
      const existing = projectDocs.find(d => d.document_type === 'scope_of_works');
      if (existing) {
        await supabase.from('project_documents').update({ content: newScope, generated_by: 'auto', status: 'draft' }).eq('id', existing.id);
      } else {
        await supabase.from('project_documents').insert({
          project_id: pid, document_type: 'scope_of_works', title: 'Scope of Works',
          content: newScope, status: 'draft', generated_by: 'auto',
        });
      }
      setScopeSaving(false);
    } finally {
      setScopeRegenerating(false);
    }
    load();
  };

  // ── Maintenance Plan save ─────────────────────────────────────────────────────

  const handleSaveMaintPlan = async (system: string) => {
    if (!pid) return;
    setMaintPlanSaving(system);
    const plan = maintPlans[system] ?? createDefaultMaintenancePlan(system);
    const content = serializeMaintenancePlan(plan);
    const docType = `maintenance_plan_${system}`;
    const { data: rows } = await supabase
      .from('project_documents')
      .select('id')
      .eq('project_id', pid)
      .eq('document_type', docType)
      .limit(1);
    const existingId = rows?.[0]?.id ?? projectDocs.find(d => d.document_type === docType)?.id;
    if (existingId) {
      await supabase.from('project_documents').update({ content, status: 'final', generated_by: 'manual' }).eq('id', existingId);
      setProjectDocs(prev => prev.map(doc => (
        doc.id === existingId
          ? { ...doc, content, status: 'final', generated_by: 'manual', title: `${system} Maintenance Plan` }
          : doc
      )));
    } else {
      const { data } = await supabase.from('project_documents').insert({
        project_id: pid,
        document_type: docType,
        title: `${system} Maintenance Plan`,
        content,
        status: 'final',
        generated_by: 'manual',
      }).select('id, document_type, title, content, status, generated_by').single();
      if (data) setProjectDocs(prev => [...prev, data]);
    }
    setMaintPlanSaving(null);
  };

  // ── PDF Upload ────────────────────────────────────────────────────────────────

  const triggerUpload = (section: string) => {
    uploadSectionRef.current = section;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pid) return;
    const section = uploadSectionRef.current;
    setUploading(section);

    const path = `${pid}/${section}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('om-uploads').upload(path, file, { upsert: true });
    if (upErr) { alert('Upload failed: ' + upErr.message); setUploading(null); return; }

    const { data: { publicUrl } } = supabase.storage.from('om-uploads').getPublicUrl(path);

    // Remove any previous upload for this section
    const existing = getUpload(section);
    if (existing) await supabase.from('om_pack_uploads').delete().eq('id', existing.id);

    await supabase.from('om_pack_uploads').insert({ project_id: pid, section, file_name: file.name, file_url: publicUrl });
    setUploading(null);
    e.target.value = '';
    load();
  };

  const handleRemoveUpload = async (upload: OmUpload) => {
    if (!confirm(`Remove "${upload.file_name}"?`)) return;
    await supabase.from('om_pack_uploads').delete().eq('id', upload.id);
    load();
  };

  const handleRemoveDatasheet = async (device: DeviceWithDatasheet) => {
    if (!device.datasheet || packReadOnly) return;
    const key = datasheetRemoveKey(device);
    if (confirmRemoveDatasheetKey !== key) {
      setConfirmRemoveDatasheetKey(key);
      return;
    }
    setRemovingDatasheet(true);
    try {
      await forgetDatasheet(device.datasheet, {
        manufacturer: device.manufacturer ?? '',
        modelNumber: device.model_number ?? '',
      });
      setConfirmRemoveDatasheetKey(null);
      await refreshDatasheets();
    } catch (error: any) {
      alert(error?.message ?? 'Could not remove that datasheet');
    } finally {
      setRemovingDatasheet(false);
    }
  };

  // ── Print ─────────────────────────────────────────────────────────────────────

  const hUploads = includedHandoverUploads;
  const handoverPackPdfs = useMemo(() => {
    const docs: { key: string; title: string; file_name: string | null; file_url: string }[] = [];
    const seen = new Set<string>();
    const add = (key: string, title: string, file_name: string | null | undefined, file_url: string | null | undefined) => {
      if (!file_url || seen.has(file_url)) return;
      seen.add(file_url);
      docs.push({ key, title, file_name: file_name ?? null, file_url });
    };
    for (const upload of hUploads) add(`upload-${upload.id}`, handoverSectionLabel(upload.section), upload.file_name, upload.file_url);
    for (const doc of includedScHandoverDocs) add(`sc-${doc.id ?? doc.document_type}`, doc.title, doc.file_name, doc.file_url);
    for (const doc of includedOtherHandoverDocs) add(`other-${doc.id}`, doc.title, doc.file_name, doc.file_url);
    return docs;
  }, [hUploads, includedScHandoverDocs, includedOtherHandoverDocs]);
  const printRendering = packPdfUrls.some(url => pdfPageImages[url]?.loading);

  const handlePrint = () => window.print();

  const [generatingPdf, setGeneratingPdf] = useState(false);

  const handleDownloadPdf = async (only?: Section[]) => {
    if (generatingPdf || printRendering) return;
    setGeneratingPdf(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: html2canvas } = await import('html2canvas');

      const printRoot = document.getElementById('om-print-root');
      if (!printRoot) return;

      // ── PDF page constants (mm) ───────────────────────────────────────────
      const pageMetrics = (landscape: boolean) => {
        const pageW = landscape ? 297 : 210;
        const pageH = landscape ? 210 : 297;
        const mTop = landscape ? 20 : 24;
        const mBottom = landscape ? 14 : 18;
        const mLeft = landscape ? 12 : 15;
        const mRight = landscape ? 12 : 15;
        return {
          pageW,
          pageH,
          mTop,
          mBottom,
          mLeft,
          mRight,
          contentW: pageW - mLeft - mRight,
          contentH: pageH - mTop - mBottom,
          footerY: pageH - 8,
        };
      };
      const PORTRAIT = pageMetrics(false);
      const RENDER_W_PX = Math.round(PORTRAIT.contentW * 4.5);
      const LANDSCAPE_RENDER_W_PX = Math.round(pageMetrics(true).contentW * 4.5);
      const sectionIsLandscape = (el: HTMLElement) =>
        el.classList.contains('om-print-landscape') || el.getAttribute('data-print-orientation') === 'landscape';

      // ── Setup off-screen render ───────────────────────────────────────────
      const savedStyles = printRoot.style.cssText;
      const applyPrintRootWidth = (widthPx: number) => {
        printRoot.style.cssText = `
          display: block !important;
          position: absolute;
          top: 0; left: -10000px;
          width: ${widthPx}px;
          height: auto;
          overflow: visible;
          z-index: -9999;
          background: white;
          visibility: visible;
        `;
      };
      applyPrintRootWidth(RENDER_W_PX);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // ── Collect sections (skip page-break divs) ───────────────────────────
      const allowedAnchors = only && only.length > 0
        ? new Set(only.map(sectionId => PRINT_SECTION_ANCHOR[sectionId]))
        : null;

      const pageEls = (Array.from(printRoot.children) as HTMLElement[]).filter(el => {
        if (el.classList.contains('page-break')) return false;
        if (!allowedAnchors) return true;
        const anchorId = el.id || el.querySelector('[id]')?.id || '';
        const sectionKey = el.getAttribute('data-print-section');
        return allowedAnchors.has(anchorId) || (sectionKey != null && allowedAnchors.has(`print-section-${sectionKey}`));
      });

      if (pageEls.length === 0) {
        printRoot.style.cssText = savedStyles;
        alert('Select at least one section to download.');
        return;
      }

      // ── PASS 1: Render all sections, calculate real page numbers ──────────
      type RenderedSection = {
        kind: 'canvas' | 'native-pdf';
        canvas?: HTMLCanvasElement;
        nativePdf?: Uint8Array;
        nativePageCount?: number;
        anchorId: string | null;
        isCover: boolean;
        landscape: boolean;
      };

      const renderedSections: RenderedSection[] = [];
      for (let i = 0; i < pageEls.length; i++) {
        const el = pageEls[i];
        const landscape = i !== 0 && sectionIsLandscape(el);
        const renderW = landscape ? LANDSCAPE_RENDER_W_PX : RENDER_W_PX;
        const anchorIdRaw = el.id || el.querySelector('[id]')?.id || null;
        const anchorId = anchorIdRaw?.startsWith('print-section-') ? anchorIdRaw : null;
        const sourcePdf = el.getAttribute('data-om-source-pdf');

        if (sourcePdf) {
          const bytes = await fetchPdfBytes(sourcePdf);
          if (bytes && bytes.length > 0) {
            renderedSections.push({
              kind: 'native-pdf',
              nativePdf: bytes,
              nativePageCount: await pdfPageCount(bytes),
              anchorId,
              isCover: false,
              landscape: false,
            });
            continue;
          }
        }

        applyPrintRootWidth(renderW);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const canvas = await capturePrintElement(el, html2canvas as (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>, renderW);
        renderedSections.push({
          kind: 'canvas',
          canvas,
          anchorId,
          isCover: i === 0,
          landscape,
        });
      }

      // Calculate page numbers for each section in a dry run
      const sectionPageMap: Record<string, number> = {};
      let dryPage = 1;
      for (const section of renderedSections) {
        if (section.anchorId) {
          sectionPageMap[section.anchorId] = dryPage;
        }
        if (section.kind === 'native-pdf') {
          dryPage += Math.max(1, section.nativePageCount ?? 1);
        } else if (section.isCover) {
          dryPage++;
        } else if (section.canvas) {
          const metrics = pageMetrics(section.landscape);
          const contentH_mm = (section.canvas.height / section.canvas.width) * metrics.contentW;
          const pagesNeeded = Math.max(1, Math.ceil(contentH_mm / metrics.contentH));
          dryPage += pagesNeeded;
        }
      }

      // ── PASS 2: Update ToC with real page numbers then re-render ToC ──────
      const tocEl = printRoot.querySelector('#print-section-toc');
      if (tocEl) {
        const tocPageLinks = tocEl.querySelectorAll('.toc-page-link');
        tocPageLinks.forEach(link => {
          const targetId = (link as HTMLElement).dataset.tocAnchor
            || (link.closest('[data-toc-anchor]') as HTMLElement | null)?.dataset.tocAnchor
            || (link.getAttribute('href') ?? '').replace('#', '');
          const pageNum = targetId ? sectionPageMap[targetId] : undefined;
          if (pageNum) (link as HTMLElement).textContent = String(pageNum);
        });
        // Re-render the ToC section canvas
        const tocSectionIdx = renderedSections.findIndex(s => s.anchorId === 'print-section-toc');
        if (tocSectionIdx >= 0) {
          applyPrintRootWidth(RENDER_W_PX);
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const tocCanvas = await html2canvas(tocEl as HTMLElement, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#ffffff',
            width: RENDER_W_PX,
            windowWidth: RENDER_W_PX,
            scrollX: 0, scrollY: 0,
            logging: false,
          });
          renderedSections[tocSectionIdx].canvas = tocCanvas;
        }
      }

      // ── PASS 3: Build the actual PDF ──────────────────────────────────────
      const ANCHOR_LABELS: Record<string, string> = {
        'print-section-toc':              'Table of Contents',
        'print-section-cover':            'Cover Page',
        'print-section-contractor':       'Contractor Information',
        'print-section-scope':            'Scope of Works',
        'print-section-schedule':         'Device Schedule and Warranties',
        'print-section-technical_docs':   'Technical Documentation',
        'print-section-maintenance_plan': 'Maintenance Plan',
        'print-section-commissioning':    'Commissioning Pack',
        'print-section-handover':         'Handover Documents',
        'print-section-as_fitted':        'As Fitted',
        'print-section-as_fitted_drawings': 'As Fitted Drawings',
        'print-section-datasheets':       'Datasheets',
        'print-section-user_manuals':     'User Manuals',
      };

      const logoDataUrl = await loadBrandLogoDataUrl(omBrand.logoSrc);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      let currentPage = 0;
      let runningTitle = 'Operations & Maintenance Manual';

      const newPage = (landscape: boolean) => {
        if (currentPage > 0) pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
        currentPage++;
      };

      const drawFooter = (pageNum: number, metrics: ReturnType<typeof pageMetrics>) => {
        pdf.setDrawColor(...omBrand.primaryRgb);
        pdf.setLineWidth(0.35);
        pdf.line(metrics.mLeft, metrics.pageH - 12, metrics.pageW - metrics.mRight, metrics.pageH - 12);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...PACIFIC_MUTED_RGB);
        pdf.text(omBrand.name, metrics.mLeft, metrics.footerY);
        pdf.setTextColor(...omBrand.primaryRgb);
        pdf.text(`Page ${pageNum}`, metrics.pageW / 2, metrics.footerY, { align: 'center' });
        pdf.setTextColor(...PACIFIC_MUTED_RGB);
        pdf.text(
          project?.project_name || 'O&M Pack',
          metrics.pageW - metrics.mRight, metrics.footerY,
          { align: 'right' }
        );
      };

      const drawPageHeader = (metrics: ReturnType<typeof pageMetrics>, title: string) => {
        pdf.setFillColor(...omBrand.primaryRgb);
        pdf.rect(0, 0, metrics.pageW, 3.2, 'F');
        if (logoDataUrl) {
          try {
            pdf.addImage(logoDataUrl, /image\/jpe?g/i.test(logoDataUrl) ? 'JPEG' : 'PNG', metrics.mLeft, 5.2, 42, 11);
          } catch {
            // Logo is optional if the PNG cannot be embedded.
          }
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(...omBrand.primaryRgb);
        pdf.text(title.toUpperCase(), metrics.pageW - metrics.mRight, 12, { align: 'right' });
        pdf.setDrawColor(...omBrand.primaryRgb);
        pdf.setLineWidth(0.45);
        pdf.line(metrics.mLeft, metrics.mTop - 3, metrics.pageW - metrics.mRight, metrics.mTop - 3);
      };

      const nativeInserts: { index: number; bytes: Uint8Array }[] = [];

      for (const section of renderedSections) {
        const { isCover, landscape, anchorId } = section;
        if (anchorId && ANCHOR_LABELS[anchorId]) runningTitle = ANCHOR_LABELS[anchorId];
        else if (anchorId?.startsWith('print-section-technical_docs')) runningTitle = 'Technical Documentation';

        if (section.kind === 'native-pdf' && section.nativePdf) {
          nativeInserts.push({ index: currentPage, bytes: section.nativePdf });
          continue;
        }

        const canvas = section.canvas;
        if (!canvas) continue;
        const metrics = pageMetrics(landscape);
        const contentH_mm = (canvas.height / canvas.width) * metrics.contentW;
        const pxPerMm = canvas.width / metrics.contentW;

        if (isCover) {
          newPage(false);
          const coverH = (canvas.height / canvas.width) * PORTRAIT.pageW;
          const imgData = canvas.toDataURL('image/jpeg', 0.94);
          pdf.addImage(imgData, 'JPEG', 0, 0, PORTRAIT.pageW, Math.min(coverH, PORTRAIT.pageH));
          continue;
        }

        let srcY_px = 0;
        let remainingH_mm = contentH_mm;

        while (remainingH_mm > 0.5) {
          newPage(landscape);
          drawPageHeader(metrics, runningTitle);

          const sliceH_mm = Math.min(remainingH_mm, metrics.contentH);
          const sliceH_px = Math.round(sliceH_mm * pxPerMm);

          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.min(sliceH_px, canvas.height - srcY_px);
          const ctx = sliceCanvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0, srcY_px,
            canvas.width, sliceCanvas.height,
            0, 0,
            canvas.width, sliceCanvas.height
          );

          const actualSliceH_mm = (sliceCanvas.height / sliceCanvas.width) * metrics.contentW;
          const imgData = sliceCanvas.toDataURL('image/jpeg', 0.94);
          pdf.addImage(imgData, 'JPEG', metrics.mLeft, metrics.mTop, metrics.contentW, actualSliceH_mm);
          drawFooter(currentPage, metrics);

          srcY_px += sliceH_px;
          remainingH_mm -= sliceH_mm;
        }
      }

      const tocPageNum = sectionPageMap['print-section-toc'];
      const tocNode = tocEl as HTMLElement | null;
      const tocHotspots: TocHotspot[] = [];
      if (tocNode && tocNode.offsetWidth > 0) {
        const cssToMm = PORTRAIT.contentW / tocNode.offsetWidth;
        const tocBox = tocNode.getBoundingClientRect();
        tocNode.querySelectorAll<HTMLElement>('.toc-entry-row').forEach(row => {
          const targetId = row.dataset.tocAnchor || (row.getAttribute('href') ?? '').replace('#', '');
          const targetPage = targetId ? sectionPageMap[targetId] : undefined;
          if (!targetPage) return;
          const box = row.getBoundingClientRect();
          tocHotspots.push({
            xMm: PORTRAIT.mLeft + (box.left - tocBox.left) * cssToMm,
            yMm: PORTRAIT.mTop + (box.top - tocBox.top) * cssToMm,
            wMm: Math.max(box.width * cssToMm, 20),
            hMm: Math.max(box.height * cssToMm, 8),
            destPage: targetPage,
          });
        });
      }

      // ── Restore DOM ───────────────────────────────────────────────────────
      printRoot.style.cssText = savedStyles;

      const filename = `OM-Pack-${(project?.project_name || project?.site_name || 'document').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.pdf`;
      const out = await mergeNativePdfPages(
        currentPage > 0 ? pdf.output('arraybuffer') : null,
        nativeInserts,
      );
      await addOmPdfNavigation(out, sectionPageMap, ANCHOR_LABELS, tocPageNum, tocHotspots);
      const merged = await out.save();
      const blob = new Blob([merged], { type: 'application/pdf' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed. Please use the Print button and save as PDF from the print dialog.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const completeSections = SECTIONS.filter(s => sectionStatus(s.id) === 'complete').length;

  return (
    <OmBrandContext.Provider value={omBrand}>
    <div className="print:p-0">
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />

      {/* ── Screen toolbar ── */}
      <div className="flex items-center justify-between mb-5 print:hidden">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{packReadOnly ? 'O&M Pack' : 'O&M Pack Builder'}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {packReadOnly
              ? 'Read only. Tick sections, then download the full pack or the selected pages.'
              : `${completeSections}/${SECTIONS.length} sections complete · Ready to print and send to customer`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {printRendering && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />Preparing PDFs for print…
            </span>
          )}
          {!packReadOnly && (
            <button onClick={handlePrint} disabled={printRendering}
              className="inline-flex items-center gap-2 bg-slate-700 text-white px-4 py-2.5 rounded-xl hover:bg-slate-600 transition-colors font-medium text-sm shadow-sm disabled:opacity-50 disabled:cursor-wait">
              <Printer className="w-4 h-4" />Print
            </button>
          )}
          <button onClick={() => void handleDownloadPdf()} disabled={printRendering || generatingPdf}
            className="inline-flex items-center gap-2 bg-cyan-600 text-white px-5 py-2.5 rounded-xl hover:bg-cyan-700 transition-colors font-medium text-sm shadow-sm disabled:opacity-50 disabled:cursor-wait">
            {generatingPdf
              ? <><Loader2 className="w-4 h-4 animate-spin" />Generating PDF…</>
              : <><Download className="w-4 h-4" />{packReadOnly ? 'Download full PDF' : 'Download PDF'}</>
            }
          </button>
          {packReadOnly && (
            <button
              onClick={() => void handleDownloadPdf(selectedSections)}
              disabled={printRendering || generatingPdf || selectedSections.length === 0}
              className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors font-medium text-sm shadow-sm disabled:opacity-50"
            >
              <Download className="w-4 h-4" />Download selected
            </button>
          )}
        </div>
      </div>

      {!packReadOnly && pid ? (
        <div className="mb-5 print:hidden">
          <OmClientInvitePanel projectId={pid} />
        </div>
      ) : null}

      {/* ── Layout: sidebar + content ── */}
      <div className="flex gap-5 print:hidden">
        {/* Sidebar nav */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {SECTIONS.map((s, i) => {
              const st = sectionStatus(s.id);
              const isActive = activeSection === s.id;
              return (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors text-sm ${
                    i > 0 ? 'border-t border-slate-100' : ''
                  } ${isActive ? 'bg-cyan-50 text-cyan-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {packReadOnly && (
                    <input
                      type="checkbox"
                      checked={selectedSections.includes(s.id)}
                      onClick={event => event.stopPropagation()}
                      onChange={event => {
                        setSelectedSections(current =>
                          event.target.checked
                            ? [...current, s.id]
                            : current.filter(id => id !== s.id),
                        );
                      }}
                      className="rounded border-slate-300"
                    />
                  )}
                  <s.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-cyan-600' : 'text-slate-400'}`} />
                  <span className="flex-1 font-medium leading-snug">{s.label}</span>
                  {st === 'complete' && <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />}
                  {st === 'partial' && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />}
                  {st === 'empty' && <span className="w-2 h-2 rounded-full bg-slate-200 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="mt-3 px-1">
            <p className="text-xs text-slate-400">
              {packReadOnly ? 'Tick sections to include in Download selected.' : 'Green = ready · Amber = partial · Grey = missing'}
            </p>
          </div>
        </div>

        {/* Section content */}
        <div className="flex-1 min-w-0">
          {activeSection === 'index' && (() => {
            const contentSections = SECTIONS.filter(s => s.id !== 'index');
            const sectionDetails: Record<string, string> = {
              cover: project?.project_name ? `${project.project_name}${project.client_name ? ' — ' + project.client_name : ''}` : 'Project overview and system summary',
              contractor: contractorHasInfo(contractorProfile)
                ? [contractorProfile?.company_name, contractorProfile?.telephone, contractorProfile?.email].filter(Boolean).join(' · ')
                : 'Fill in Document Management',
              scope: scopeContent ? 'Scope of works document ready' : 'Not yet generated',
              schedule: devices.length > 0 ? `${devices.length} device${devices.length !== 1 ? 's' : ''} across ${systemGroups.length} system${systemGroups.length !== 1 ? 's' : ''}` : 'No devices added',
              technical_docs: (() => {
                if (namedTechBundles.length > 0) return namedTechBundles.map(b => b.title).join(', ');
                const imported = importedTechSystems;
                if (imported.length > 0) return `Imported data for: ${imported.join(', ')}`;
                const n = devices.filter(d => d.ip_address || d.mac_address || d.firmware_version || d.username_hint || d.password_hint).length;
                return n > 0 ? `${n} device${n !== 1 ? 's' : ''} with technical info` : 'No technical data entered';
              })(),
              maintenance_plan: systemGroups.filter(g => g.devices.length > 0 && maintenancePlanHasContent(maintPlans[g.system])).length > 0
                ? `Plans for ${systemGroups.filter(g => g.devices.length > 0 && maintenancePlanHasContent(maintPlans[g.system])).map(g => g.system).join(', ')}`
                : 'Not yet created',
              commissioning: getUpload('commissioning') ? 'PDF uploaded' : includedCommRecords.length > 0 ? `${includedCommRecords.length} test records in database` : 'Not yet uploaded',
              handover: (() => {
                const total = hUploads.length + includedScHandoverDocs.filter(d => d.file_url).length + includedOtherHandoverDocs.filter(d => d.file_url).length;
                return total > 0 ? `${total} document${total !== 1 ? 's' : ''} ready` : handoverDocs.length > 0 || includedScHandoverDocs.length > 0 ? 'Handover data available' : 'Not yet uploaded';
              })(),
              as_fitted: asFittedContent.trim() || asFittedItems.length > 0
                ? [asFittedContent.trim() ? 'As-fitted record ready' : null, asFittedItems.length > 0 ? `${asFittedItems.length} installed line${asFittedItems.length !== 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')
                : 'No as-fitted record yet',
              as_fitted_drawings: includedAsFittedDrawings.length > 0 ? `${includedAsFittedDrawings.length} drawing${includedAsFittedDrawings.length !== 1 ? 's' : ''} uploaded` : 'No drawings uploaded',
              datasheets: (() => { const found = devices.filter(d => d.datasheet).length; return found > 0 ? `${found} of ${devices.length} devices have datasheets` : 'No datasheets found'; })(),
              user_manuals: projectManuals.length > 0 ? `${projectManuals.length} manual${projectManuals.length !== 1 ? 's' : ''} attached` : 'No manuals attached',
            };
            const complete = contentSections.filter(s => sectionStatus(s.id) === 'complete').length;
            const tocEntries = contentSections.map((s, i) => ({
              ...s,
              number: i + 1,
              status: sectionStatus(s.id),
              detail: sectionDetails[s.id],
            }));
            return (
              <div className="space-y-4">
                {/* Stats card */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                        <ListOrdered className="w-5 h-5 text-slate-600" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">Table of Contents</h2>
                        <p className="text-xs text-slate-500 mt-0.5">Auto-generated · updates as sections are completed</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-slate-900">{complete}<span className="text-slate-300">/{contentSections.length}</span></p>
                      <p className="text-xs text-slate-500">sections ready</p>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${(complete / contentSections.length) * 100}%` }} />
                  </div>
                </div>

                {/* ToC document-style list */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {project?.project_name || project?.site_name || 'Project'} — O&amp;M Pack Contents
                    </p>
                  </div>
                  <div className="px-6 py-3 divide-y divide-slate-50">
                    {tocEntries.map(entry => {
                      const st = entry.status;
                      return (
                        <button
                          key={entry.id}
                          onClick={() => setActiveSection(entry.id)}
                          className="w-full flex items-center gap-3 py-3.5 hover:bg-slate-50 -mx-6 px-6 transition-colors text-left group"
                        >
                          {/* Number */}
                          <span className="w-7 text-right text-sm font-bold text-slate-300 flex-shrink-0 tabular-nums">
                            {entry.number}
                          </span>
                          {/* Status dot */}
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            st === 'complete' ? 'bg-emerald-400' :
                            st === 'partial'  ? 'bg-amber-400' : 'bg-slate-200'
                          }`} />
                          {/* Title */}
                          <span className="text-sm font-semibold text-slate-900 flex-shrink-0">{entry.label}</span>
                          {/* Dotted leader */}
                          <span className="flex-1 border-b-2 border-dotted border-slate-200 mx-2 mb-0.5" />
                          {/* Status badge */}
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mr-2 ${
                            st === 'complete' ? 'bg-emerald-100 text-emerald-700' :
                            st === 'partial'  ? 'bg-amber-100 text-amber-700' :
                                               'bg-slate-100 text-slate-400'
                          }`}>
                            {st === 'complete' ? 'Ready' : st === 'partial' ? 'Partial' : 'Missing'}
                          </span>
                          {/* Detail */}
                          <span className="text-xs text-slate-400 hidden lg:block truncate max-w-[200px] flex-shrink-0">
                            {entry.detail}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-cyan-500 transition-colors flex-shrink-0 ml-1" />
                        </button>
                      );
                    })}
                  </div>
                  {complete === contentSections.length && (
                    <div className="px-6 py-4 bg-emerald-50 border-t border-emerald-100 flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                      <p className="text-sm font-semibold text-emerald-800">All sections complete — your O&amp;M pack is ready to print.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {activeSection === 'cover' && <CoverSection project={project} devices={devices} systemGroups={systemGroups} contractor={contractorProfile} authority={docAuthority} />}
          {activeSection === 'contractor' && <ContractorSection contractor={contractorProfile} />}
          {activeSection === 'scope' && (
            <MarkdownDocEditor
              title="Scope of Works"
              content={scopeContent}
              onChange={setScopeContent}
              onSave={handleSaveScope}
              saving={scopeSaving}
              placeholder="Enter Scope of Works here (supports Markdown formatting)..."
              emptyHint="No Scope of Works found. It is filled from Simpro on import, or paste a quote on the Scope of Works page."
              isAiGenerated={!!projectDocs.find(d => d.document_type === 'scope_of_works' && d.generated_by === 'ai')}
              onRegenerate={handleRegenerateScope}
              regenerating={scopeRegenerating}
              missingSystems={activeSystems}
              readOnly={packReadOnly}
            />
          )}
          {activeSection === 'as_fitted' && (
            <AsFittedRecordSection
              content={asFittedContent}
              onChange={setAsFittedContent}
              onSave={handleSaveAsFitted}
              saving={asFittedSaving}
              items={asFittedItems}
              readOnly={packReadOnly}
            />
          )}
          {activeSection === 'schedule' && <ScheduleSection systemGroups={systemGroups} />}
          {activeSection === 'technical_docs' && (
            <TechnicalDocsSection devices={devices} techDocState={techDocState} techDocBundles={builderTechBundles} documentSystems={documentSystems} packReadOnly={packReadOnly} />
          )}
          {activeSection === 'maintenance_plan' && (
            <MaintenancePlanSection
              systemNames={systemGroups.filter(g => g.devices.length > 0).map(g => g.system)}
              plans={maintPlans}
              onChange={(sys, plan) => setMaintPlans(prev => ({ ...prev, [sys]: plan }))}
              onSave={handleSaveMaintPlan}
              savingSystem={maintPlanSaving}
              readOnly={packReadOnly}
            />
          )}
          {activeSection === 'commissioning' && (
            <UploadSection
              sectionId="commissioning"
              title="Commissioning Pack"
              description="Upload your completed commissioning sign-off document (PDF). This can be the commissioning pack that was filled in and signed on site."
              upload={getUpload('commissioning')}
              uploading={uploading === 'commissioning'}
              onUpload={() => triggerUpload('commissioning')}
              onRemove={handleRemoveUpload}
              fallbackContent={includedCommRecords.length > 0 ? <CommSummary records={includedCommRecords} /> : null}
              fallbackLabel={`${includedCommRecords.length} commissioning test records in database`}
              readOnly={packReadOnly}
            />
          )}
          {activeSection === 'handover' && (
            <HandoverPackSection
              uploads={includedHandoverUploads}
              onRemove={handleRemoveUpload}
              handoverDocs={handoverDocs}
              scHandoverDocs={includedScHandoverDocs}
              otherHandoverDocs={includedOtherHandoverDocs}
              documentSystems={documentSystems}
              readOnly={packReadOnly}
            />
          )}
          {activeSection === 'as_fitted_drawings' && (
            <AsFittedDrawingsSection
              drawings={includedAsFittedDrawings}
              pageImages={pdfPageImages}
              documentSystems={documentSystems}
            />
          )}
          {activeSection === 'datasheets' && (
            <DatasheetsSection
              systemGroups={systemGroups}
              readOnly={packReadOnly}
              onRemoveDatasheet={handleRemoveDatasheet}
              confirmRemoveKey={confirmRemoveDatasheetKey}
              removing={removingDatasheet}
            />
          )}
          {activeSection === 'user_manuals' && (
            <UserManualsSection
              pid={pid!}
              projectManuals={projectManuals}
              onRefresh={load}
              readOnly={packReadOnly}
            />
          )}
        </div>
      </div>

      {/* ══ PRINT VIEW — all sections rendered sequentially ══ */}
      <div id="om-print-root" className="hidden print:block">
        {/* Cover page — page 1, @page :first suppresses footer */}
        <div id="print-section-cover">
          <PrintCoverPage project={project} devices={devices} systemGroups={systemGroups} contractor={contractorProfile} authority={docAuthority} />
        </div>
        <div className="page-break" />

        {/* Table of Contents */}
        <PrintTableOfContents
          project={project}
          hasContractor={contractorHasInfo(contractorProfile)}
          hasScope={!!scopeContent}
          hasSchedule={devices.length > 0}
          hasTechDocs={namedTechBundles.length > 0 || importedTechSystems.length > 0 || devices.some(d => d.ip_address || d.mac_address || d.firmware_version || d.username_hint || d.password_hint || d.controller_address || d.vlan || d.network_zone)}
          hasMaintPlan={systemGroups.some(g => g.devices.length > 0 && maintenancePlanHasContent(maintPlans[g.system]))}
          hasCommissioning={!!(getUpload('commissioning') || includedCommRecords.length > 0)}
          hasHandover={handoverPackPdfs.length > 0 || handoverDocs.length > 0 || includedScHandoverDocs.length > 0}
          hasAsFitted={!!asFittedContent.trim() || asFittedItems.length > 0}
          hasAsFittedDrawings={includedAsFittedDrawings.length > 0}
          hasDatasheets={devices.some(d => d.datasheet)}
          hasUserManuals={projectManuals.length > 0}
        />
        <div className="page-break" />

        {contractorHasInfo(contractorProfile) && (
          <>
            <PrintSection title="Contractor Information" anchorId="print-section-contractor">
              <PrintContractorInformation contractor={contractorProfile} />
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {scopeContent && (
          <>
            <PrintSection title="Scope of Works" anchorId="print-section-scope">
              <div className={usesSimproLayout(scopeContent) ? 'simpro-html' : undefined} dangerouslySetInnerHTML={{ __html: renderDocumentHtml(scopeContent) }} />
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {(asFittedContent.trim() || asFittedItems.length > 0) && (
          <>
            <PrintSection title="As Fitted" anchorId="print-section-as_fitted">
              {asFittedItems.length > 0 && <PrintAsFittedItems items={asFittedItems} />}
              {asFittedContent.trim() ? (
                <div className={usesSimproLayout(asFittedContent) ? 'simpro-html' : undefined} dangerouslySetInnerHTML={{ __html: renderDocumentHtml(asFittedContent) }} />
              ) : null}
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {devices.length > 0 && (
          <>
            <PrintSection title="Device Schedule and Warranties" anchorId="print-section-schedule">
              {systemGroups.map(g => <PrintDeviceTable key={g.system} system={g.system} devices={g.devices} />)}
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {(() => {
          const hasTechImport = namedTechBundles.length > 0 || importedTechSystems.length > 0;
          const techDevices = devices.filter(d => d.ip_address || d.mac_address || d.firmware_version || d.username_hint || d.password_hint || d.controller_address || d.vlan || d.network_zone);
          const legacyTechCols = 1 + ([
            'ip_address', 'mac_address', 'firmware_version', 'username_hint',
            'password_hint', 'controller_address', 'vlan', 'network_zone',
          ] as const).filter(key => techDevices.some(device => device[key])).length;
          if (!hasTechImport && techDevices.length === 0) return null;
          if (namedTechBundles.length > 0) {
            let firstSection = true;
            return (
              <>
                {namedTechBundles.flatMap(bundle => {
                  if (bundle.isProtected) {
                    const isFirst = firstSection;
                    firstSection = false;
                    return [(
                      <PrintSection
                        key={bundle.key}
                        title="Technical Documentation"
                        subtitle={[bundle.system, bundle.title].filter(Boolean).join(' — ') || undefined}
                        anchorId={isFirst ? 'print-section-technical_docs' : undefined}
                        forcePageBreak={!isFirst}
                      >
                        <PrintProtectedTechDocNotice title={bundle.title} hasFilePassword={bundle.hasFilePassword} />
                      </PrintSection>
                    )];
                  }
                  const columns = resolveTechDocColumns(bundle.colConfig, bundle.rows);
                  const landscape = printTableNeedsLandscape(columns.length);
                  const rowChunks = chunkTechDocRows(bundle.rows, landscape ? TECH_DOC_PRINT_ROWS_LANDSCAPE : TECH_DOC_PRINT_ROWS);
                  return rowChunks.map((rows, rowIdx) => {
                    const isFirst = firstSection;
                    firstSection = false;
                    const title = rowIdx > 0 ? 'Technical Documentation (continued)' : 'Technical Documentation';
                    const subtitle = [bundle.system, bundle.title].filter(Boolean).join(' — ') || undefined;
                    return (
                      <PrintSection
                        key={`${bundle.key}-${rowIdx}`}
                        title={title}
                        subtitle={subtitle}
                        anchorId={isFirst ? 'print-section-technical_docs' : undefined}
                        forcePageBreak={!isFirst}
                        landscape={landscape}
                      >
                        <PrintTechnicalDocsTable columns={columns} rows={rows} compact={landscape} />
                      </PrintSection>
                    );
                  });
                })}
                <div className="page-break" />
              </>
            );
          }
          if (hasTechImport) {
            const systemsWithData = importedTechSystems;
            let firstSection = true;
            return (
              <>
                {systemsWithData.flatMap(sys => {
                  const state = techDocState[sys]!;
                  const columns = resolveTechDocColumns(state.colConfig, state.rows);
                  const landscape = printTableNeedsLandscape(columns.length);
                  const rowChunks = chunkTechDocRows(state.rows, landscape ? TECH_DOC_PRINT_ROWS_LANDSCAPE : TECH_DOC_PRINT_ROWS);
                  return rowChunks.map((rows, rowIdx) => {
                    const isFirst = firstSection;
                    firstSection = false;
                    const slug = sys.toLowerCase().replace(/\s+/g, '_');
                    const title = rowIdx > 0
                      ? 'Technical Documentation (continued)'
                      : 'Technical Documentation';
                    return (
                      <PrintSection
                        key={`${sys}-${rowIdx}`}
                        title={title}
                        subtitle={sys}
                        anchorId={isFirst ? 'print-section-technical_docs' : rowIdx === 0 ? `print-section-technical_docs_${slug}` : undefined}
                        forcePageBreak={!isFirst}
                        landscape={landscape}
                      >
                        <PrintTechnicalDocsTable columns={columns} rows={rows} compact={landscape} />
                      </PrintSection>
                    );
                  });
                })}
                <div className="page-break" />
              </>
            );
          }
          return (
            <>
              <PrintSection
                title="Technical Documentation"
                anchorId="print-section-technical_docs"
                landscape={printTableNeedsLandscape(legacyTechCols)}
              >
                <PrintTechnicalDocsLegacy devices={techDevices} />
              </PrintSection>
              <div className="page-break" />
            </>
          );
        })()}

        {systemGroups.some(g => g.devices.length > 0 && maintenancePlanHasContent(maintPlans[g.system])) && (
          <>
            <PrintSection title="Maintenance Plan" anchorId="print-section-maintenance_plan">
              <PrintMaintenancePlan
                systemNames={systemGroups.filter(g => g.devices.length > 0).map(g => g.system)}
                plans={maintPlans}
              />
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {getUpload('commissioning') ? (
          <>
            <PrintSection title="Commissioning Pack" anchorId="print-section-commissioning">
              <PrintPdfPages
                title="Commissioning Pack"
                fileName={getUpload('commissioning')!.file_name}
                url={getUpload('commissioning')!.file_url}
                pageImages={pdfPageImages}
              />
            </PrintSection>
            <div className="page-break" />
          </>
        ) : includedCommRecords.length > 0 && (
          <>
            <PrintSection title="Commissioning Records" anchorId="print-section-commissioning">
              <CommSummary records={includedCommRecords} />
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {(() => {
          if (handoverPackPdfs.length > 0) return (
            <>
              <PrintSection title="Handover Documents" anchorId="print-section-handover">
                {handoverPackPdfs.map(doc => (
                  <PrintPdfPages
                    key={doc.key}
                    title={doc.title}
                    fileName={doc.file_name}
                    url={doc.file_url}
                    pageImages={pdfPageImages}
                  />
                ))}
              </PrintSection>
              <div className="page-break" />
            </>
          );
          if (handoverDocs.length > 0) return (
            <>
              <PrintSection title="Handover Documents" anchorId="print-section-handover">
                <HandoverSummary docs={handoverDocs} />
              </PrintSection>
              <div className="page-break" />
            </>
          );
          return null;
        })()}

        {includedAsFittedDrawings.length > 0 && (
          <>
            <PrintAsFittedDrawings drawings={includedAsFittedDrawings} pageImages={pdfPageImages} documentSystems={documentSystems} />
            <div className="page-break" />
          </>
        )}

        {devices.some(d => d.datasheet) && (
          <>
            <PrintSection title="Datasheets" anchorId="print-section-datasheets">
              <PrintDatasheets groups={systemGroups} pageImages={pdfPageImages} />
            </PrintSection>
            <div className="page-break" />
          </>
        )}

        {projectManuals.length > 0 && (
          <>
            <PrintSection title="User Manuals" anchorId="print-section-user_manuals">
              <div className="space-y-8">
                {projectManuals.map(pm => (
                  pm.manual.file_url ? (
                    <PrintPdfPages
                      key={pm.id}
                      title={pm.manual.title}
                      fileName={pm.manual.file_name}
                      url={pm.manual.file_url}
                      pageImages={pdfPageImages}
                    />
                  ) : (
                    <div key={pm.id} className="border border-slate-200 rounded p-4">
                      <p className="text-sm font-semibold text-slate-800">{pm.manual.title}</p>
                      {pm.manual.description && <p className="text-xs text-slate-500 mt-0.5">{pm.manual.description}</p>}
                      {pm.manual.link_url && (
                        <p className="text-xs text-slate-400 mt-1 break-all">Linked document: {pm.manual.link_url}</p>
                      )}
                    </div>
                  )
                ))}
              </div>
            </PrintSection>
          </>
        )}
      </div>

      <style>{`
        /* ── O&M Print Styles ───────────────────────────────────────────── */
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-family: system-ui, -apple-system, sans-serif;
          }

          /* Page breaks */
          .page-break { page-break-after: always; break-after: page; }
          .om-cover-page { page-break-after: always; break-after: page; }

          /* Default page — A4 with 20mm header/footer reserved */
          @page {
            size: A4 portrait;
            margin: 20mm 15mm 20mm 15mm;
            @bottom-center {
              content: "Page " counter(page) " of " counter(pages);
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 8pt;
              color: #C00000;
            }
            @bottom-right {
              content: string(section-title);
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 7pt;
              color: #404040;
            }
          }

          @page om-landscape {
            size: A4 landscape;
            margin: 15mm 12mm 15mm 12mm;
            @bottom-center {
              content: "Page " counter(page) " of " counter(pages);
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 8pt;
              color: #C00000;
            }
            @bottom-right {
              content: string(section-title);
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 7pt;
              color: #404040;
            }
          }

          /* Cover page (first) — no margins, no footer */
          @page :first {
            margin: 0;
            @bottom-center { content: none; }
            @bottom-right { content: none; }
          }

          .om-print-landscape {
            page: om-landscape;
          }

          /* ToC page number links via CSS target-counter (Chromium print engine) */
          .toc-page-link::after {
            content: target-counter(attr(href url), page);
            font-size: 0.85rem;
            font-weight: 800;
            color: #0f172a;
          }

          /* Running section title — picked up from h2 inside om-section */
          .om-section h2 {
            string-set: section-title content();
          }

          /* Prevent orphaned headings */
          h2, h3 { page-break-after: avoid; break-after: avoid; }

          /* Tables keep every column on the same page; rows may continue */
          table {
            border-collapse: collapse;
            width: 100% !important;
            max-width: 100% !important;
            table-layout: fixed;
          }
          thead { display: table-header-group; }
          tbody tr { page-break-inside: avoid; break-inside: avoid; }
          th, td { word-break: break-word; overflow-wrap: anywhere; }

          .om-maint-table {
            font-size: 9pt;
          }
          .om-maint-table th,
          .om-maint-table td {
            font-size: 9pt;
            line-height: 1.35;
          }

          img { page-break-inside: avoid; break-inside: avoid; }

          .simpro-html {
            font-family: Calibri, 'Segoe UI', Arial, sans-serif !important;
            font-size: 11pt;
            line-height: 1.35;
            color: #111827;
          }
          .simpro-html p { margin: 0 0 8pt; }
          .simpro-html ul, .simpro-html ol { margin: 4pt 0 8pt 22pt; padding: 0; }
          .simpro-html ul { list-style-type: disc; }
          .simpro-html ol { list-style-type: decimal; }
        }
      `}</style>
    </div>
    </OmBrandContext.Provider>
  );
}

// ─── Screen sections ──────────────────────────────────────────────────────────

// ─── Screen sections ──────────────────────────────────────────────────────────

// ─── Technical Docs Section ───────────────────────────────────────────────────

function TechnicalDocsSection({ devices, techDocState, techDocBundles, documentSystems, packReadOnly }: {
  devices: DeviceWithDatasheet[];
  techDocState: Partial<Record<string, { rows: { id: number; row_index: number; data: Record<string, string> }[]; colConfig: { key: string; display_name: string; visible: boolean; order: number }[] }>>;
  techDocBundles?: TechDocBundle[];
  documentSystems: ProjectSystem[];
  packReadOnly?: boolean;
}) {
  const brand = useOmBrand();
  const [passwordPrompt, setPasswordPrompt] = useState<{
    id: number;
    title: string;
    password: string;
    error: string | null;
    busy: boolean;
    mode: 'view' | 'download';
  } | null>(null);
  const [fileViewer, setFileViewer] = useState<{ url: string; title: string; fileName?: string | null } | null>(null);
  const [unlockedPasswords, setUnlockedPasswords] = useState<Record<number, string>>({});
  const named = (techDocBundles ?? []).filter(bundle => bundle.isProtected || bundle.rows.length > 0);

  const accessProtected = async (bundle: TechDocBundle, mode: 'view' | 'download', typed?: string) => {
    if (!bundle.id) return;
    const cached = unlockedPasswords[bundle.id];
    if (bundle.hasFilePassword && typed == null && !cached) {
      setPasswordPrompt({ id: bundle.id, title: bundle.title, password: '', error: null, busy: false, mode });
      return;
    }
    const password = typed ?? cached ?? null;
    try {
      if (passwordPrompt) setPasswordPrompt({ ...passwordPrompt, busy: true, error: null });
      const url = await openProtectedTechDoc({
        id: bundle.id,
        hasFilePassword: !!bundle.hasFilePassword,
        password,
        mode,
      });
      if (bundle.hasFilePassword && password) {
        setUnlockedPasswords(prev => ({ ...prev, [bundle.id!]: password }));
      }
      setPasswordPrompt(null);
      if (mode === 'view') {
        if (!url) throw new Error('Could not open the document');
        setFileViewer({ url, title: bundle.title, fileName: bundle.fileName });
      }
    } catch (err: any) {
      const message = err?.message ?? (mode === 'view' ? 'Could not open' : 'Could not download');
      if (bundle.hasFilePassword) {
        setPasswordPrompt({
          id: bundle.id,
          title: bundle.title,
          password: typed ?? '',
          error: message,
          busy: false,
          mode,
        });
      } else {
        alert(message);
      }
    }
  };

  if (named.length > 0) {
    return (
      <>
      <div className="space-y-6">
        {named.map(bundle => {
          if (bundle.isProtected) {
            return (
              <div key={bundle.key} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 bg-slate-50">
                  <Lock className="w-4 h-4 text-amber-700" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-800 truncate">{bundle.title}</h3>
                    <p className="text-xs text-amber-800 font-semibold mt-0.5">
                      {bundle.hasFilePassword ? 'Protected Document · Password required' : 'Protected Document · Client Portal Access'}
                    </p>
                  </div>
                  {bundle.system && <span className="text-xs text-slate-500">{bundle.system}</span>}
                  {bundle.id && (!packReadOnly || bundle.visibleInPortal !== false) && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void accessProtected(bundle, 'view')}
                        className="text-xs px-2 py-1 border border-slate-200 text-slate-600 rounded-lg hover:bg-white inline-flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" />View
                      </button>
                      <button
                        type="button"
                        onClick={() => void accessProtected(bundle, 'download')}
                        className="text-xs px-2 py-1 border border-slate-200 text-slate-600 rounded-lg hover:bg-white inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />Download
                      </button>
                    </div>
                  )}
                </div>
                <div className="px-6 py-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Password Protected</p>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {bundle.hasFilePassword
                      ? `This document is password-protected. Enter the password issued by ${brand.name} to view or download it. Please contact ${brand.name} if you are unable to access the document.`
                      : PROTECTED_DOC_NOTICE}
                  </p>
                  {bundle.includeInOm === false && !packReadOnly && (
                    <p className="text-xs text-slate-400 mt-3">This document is hidden from the generated O&amp;M pack.</p>
                  )}
                </div>
              </div>
            );
          }
          const visibleCols = resolveTechDocColumns(bundle.colConfig, bundle.rows);
          return (
            <div key={bundle.key} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200 bg-slate-50">
                <Wifi className="w-4 h-4 text-slate-400" />
                <h3 className="font-semibold text-slate-800">{bundle.title}</h3>
                {bundle.system && <span className="text-xs text-slate-500">{bundle.system}</span>}
                <span className="text-xs text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full ml-1">{bundle.rows.length} rows</span>
              </div>
              {visibleCols.length === 0 ? (
                <p className="text-sm text-slate-400 px-6 py-4">No columns configured. Go to Technical Docs to configure columns.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {visibleCols.map(col => (
                          <th key={col.key} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{col.display_name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bundle.rows.map(row => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          {visibleCols.map(col => (
                            <td key={col.key} className="px-4 py-2.5 font-mono text-xs text-slate-700">{techDocCell(row.data, col) || <span className="text-slate-300">-</span>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
        {passwordPrompt && (
          <ProtectedTechDocPasswordPrompt
            title={passwordPrompt.title}
            actionLabel={passwordPrompt.mode === 'view' ? 'View' : 'Download'}
            password={passwordPrompt.password}
            error={passwordPrompt.error}
            busy={passwordPrompt.busy}
            onPasswordChange={password => setPasswordPrompt({ ...passwordPrompt, password, error: null })}
            onCancel={() => setPasswordPrompt(null)}
            onConfirm={() => {
              const bundle = named.find(item => item.id === passwordPrompt.id);
              if (bundle) void accessProtected(bundle, passwordPrompt.mode, passwordPrompt.password);
            }}
          />
        )}
        {fileViewer && (
          <ProtectedTechDocViewer
            url={fileViewer.url}
            title={fileViewer.title}
            fileName={fileViewer.fileName}
            onClose={() => setFileViewer(null)}
          />
        )}
      </>
    );
  }

  const systemsWithImport = systemsWithTechImport(documentSystems, techDocState);

  if (systemsWithImport.length > 0) {
    return (
      <div className="space-y-6">
        {systemsWithImport.map(sys => {
          const state = techDocState[sys]!;
          const visibleCols = resolveTechDocColumns(state.colConfig, state.rows);
          return (
            <div key={sys} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200 bg-slate-50">
                <Wifi className="w-4 h-4 text-slate-400" />
                <h3 className="font-semibold text-slate-800">{sys}</h3>
                <span className="text-xs text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full ml-1">{state.rows.length} rows</span>
              </div>
              {visibleCols.length === 0 ? (
                <p className="text-sm text-slate-400 px-6 py-4">No columns configured. Go to Technical Docs to configure columns.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {visibleCols.map(col => (
                          <th key={col.key} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{col.display_name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {state.rows.map(row => (
                        <tr key={row.id} className="hover:bg-slate-50">
                          {visibleCols.map(col => (
                            <td key={col.key} className="px-4 py-2.5 font-mono text-xs text-slate-700">{techDocCell(row.data, col) || <span className="text-slate-300">-</span>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Fallback to device schedule data
  const techDevices = devices.filter(d =>
    d.ip_address || d.mac_address || d.firmware_version ||
    d.username_hint || d.password_hint || d.controller_address || d.vlan || d.network_zone
  );

  if (techDevices.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <Wifi className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-medium">No technical data yet</p>
        <p className="text-sm text-slate-400 mt-1">Import CSV/Excel files in the Technical Docs page to populate this section.</p>
      </div>
    );
  }

  const fields: { key: keyof DeviceWithDatasheet; label: string }[] = [
    { key: 'ip_address',        label: 'IP Address' },
    { key: 'mac_address',       label: 'MAC Address' },
    { key: 'firmware_version',  label: 'Firmware' },
    { key: 'username_hint',     label: 'Username' },
    { key: 'password_hint',     label: 'Password' },
    { key: 'controller_address',label: 'Controller' },
    { key: 'vlan',              label: 'VLAN' },
    { key: 'network_zone',      label: 'Network Zone' },
  ];
  const usedFields = fields.filter(f => techDevices.some(d => d[f.key]));

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200">
        <Wifi className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Technical Documentation</h3>
        <span className="ml-auto text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{techDevices.length} devices with technical info</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Device</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">System</th>
              {usedFields.map(f => (
                <th key={f.key} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {techDevices.map(d => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{d.device_name || '-'}</p>
                  {d.location && <p className="text-xs text-slate-400">{d.location}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{d.system_type || '-'}</span>
                </td>
                {usedFields.map(f => (
                  <td key={f.key} className="px-4 py-3 font-mono text-xs text-slate-700">{String(d[f.key] ?? '') || <span className="text-slate-300">-</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── User Manuals Section ─────────────────────────────────────────────────────

interface ProjectManual {
  id: number;
  manual_id: number;
  manual: { title: string; description: string | null; manufacturer: string | null; model_number: string | null; file_name: string | null; file_url: string | null; link_url: string | null };
}

function UserManualsSection({ pid, projectManuals, onRefresh, readOnly }: {
  pid: number;
  projectManuals: ProjectManual[];
  onRefresh: () => void;
  readOnly?: boolean;
}) {
  const [allManuals, setAllManuals] = useState<(ProjectManual['manual'] & { id: number })[]>([]);
  const [search, setSearch] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<'upload' | 'link'>('upload');
  const [form, setForm] = useState({ title: '', description: '', manufacturer: '', model_number: '', link_url: '' });
  const [linkVerified, setLinkVerified] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const refreshLibrary = () =>
    supabase.from('user_manuals').select('*').order('title').then(({ data }) => setAllManuals(data ?? []));

  useEffect(() => { refreshLibrary(); }, [projectManuals]);

  const linkedIds = new Set(projectManuals.map(pm => pm.manual_id));

  const filteredLibrary = allManuals.filter(m =>
    !linkedIds.has(m.id) &&
    (search === '' || [m.title, m.description, m.manufacturer, m.model_number].some(v => v?.toLowerCase().includes(search.toLowerCase())))
  );

  const handleAddFromLibrary = async (manualId: number) => {
    await supabase.from('project_user_manuals').insert({ project_id: pid, manual_id: manualId });
    onRefresh();
  };

  const handleRemove = async (pmId: number) => {
    if (!confirm('Remove this manual from the project?')) return;
    await supabase.from('project_user_manuals').delete().eq('id', pmId);
    onRefresh();
  };

  const handleVerifyLink = async () => {
    const url = form.link_url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) { setLinkVerified('fail'); return; }
    setLinkVerified('checking');
    try {
      const r = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
      setLinkVerified(r.type === 'opaque' || r.ok ? 'ok' : 'fail');
    } catch { setLinkVerified('fail'); }
  };

  const resetForm = () => {
    setForm({ title: '', description: '', manufacturer: '', model_number: '', link_url: '' });
    setPendingFile(null);
    setLinkVerified('idle');
    setShowAdd(false);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    if (addMode === 'upload' && !pendingFile) return;
    if (addMode === 'link' && !form.link_url.trim()) return;
    setSaving(true);
    try {
      let file_url: string | null = null;
      let file_name: string | null = null;
      if (addMode === 'upload' && pendingFile) {
        const path = `manuals/${Date.now()}_${pendingFile.name}`;
        const { error: upErr } = await supabase.storage.from('om-uploads').upload(path, pendingFile, { upsert: false });
        if (upErr) throw new Error(upErr.message);
        ({ data: { publicUrl: file_url } } = supabase.storage.from('om-uploads').getPublicUrl(path));
        file_name = pendingFile.name;
      }
      const { data: manual, error: insErr } = await supabase.from('user_manuals').insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        model_number: form.model_number.trim() || null,
        file_name, file_url,
        link_url: addMode === 'link' ? form.link_url.trim() : null,
      }).select().single();
      if (insErr || !manual) throw new Error(insErr?.message ?? 'Insert failed');
      await supabase.from('project_user_manuals').insert({ project_id: pid, manual_id: manual.id });
      resetForm();
      onRefresh();
      refreshLibrary();
    } catch (e: any) { alert('Save failed: ' + e.message); }
    finally { setSaving(false); }
  };

  const manualHref = (m: ProjectManual['manual']) => m.link_url ?? m.file_url ?? '#';
  const isLinkManual = (m: ProjectManual['manual']) => !!m.link_url && !m.file_url;

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
        onChange={e => { setPendingFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200">
          <BookMarked className="w-4 h-4 text-slate-400" />
          <h3 className="font-semibold text-slate-800">User Manuals</h3>
          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full ml-1">{projectManuals.length}</span>
          {!readOnly && (
          <div className="ml-auto flex gap-2">
            <button onClick={() => { setShowLibrary(l => !l); setShowAdd(false); }}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
              <Search className="w-3.5 h-3.5" />Library
            </button>
            <button onClick={() => { setShowAdd(a => !a); setShowLibrary(false); }}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors">
              <Plus className="w-3.5 h-3.5" />Add Manual
            </button>
          </div>
          )}
        </div>

        {/* Add form */}
        {/* Add form */}
        {!readOnly && showAdd && (
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Add Manual</p>
              <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                <button onClick={() => { setAddMode('upload'); setLinkVerified('idle'); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${addMode === 'upload' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  Upload PDF
                </button>
                <button onClick={() => { setAddMode('link'); setPendingFile(null); }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${addMode === 'link' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  Paste Link
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-700 mb-1 block">Title <span className="text-red-500">*</span></label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Genetec Security Center Administration Guide"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-700 mb-1 block">Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of the manual contents"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">Manufacturer</label>
                <input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))}
                  placeholder="e.g. Genetec"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">Model / Product</label>
                <input value={form.model_number} onChange={e => setForm(f => ({ ...f, model_number: e.target.value }))}
                  placeholder="e.g. Security Center 5.12"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
              </div>
            </div>

            {addMode === 'upload' ? (
              <button onClick={() => fileRef.current?.click()}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg text-sm font-medium transition-all ${pendingFile ? 'border-emerald-400 text-emerald-700 bg-emerald-50' : 'border-slate-300 text-slate-500 hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50'}`}>
                <FileText className="w-4 h-4" />
                {pendingFile ? pendingFile.name : 'Select PDF file (any size)'}
              </button>
            ) : (
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">URL <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input value={form.link_url} onChange={e => { setForm(f => ({ ...f, link_url: e.target.value })); setLinkVerified('idle'); }}
                    placeholder="https://..."
                    className={`flex-1 text-sm border rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 ${linkVerified === 'ok' ? 'border-emerald-400 bg-emerald-50' : linkVerified === 'fail' ? 'border-red-300 bg-red-50' : 'border-slate-200'}`} />
                  <button onClick={handleVerifyLink} disabled={!form.link_url.trim() || linkVerified === 'checking'}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 whitespace-nowrap ${linkVerified === 'ok' ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : linkVerified === 'fail' ? 'bg-red-50 border-red-300 text-red-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {linkVerified === 'checking' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : linkVerified === 'ok' ? '✓ Verified' : linkVerified === 'fail' ? '✗ Failed' : 'Verify'}
                  </button>
                </div>
                {linkVerified === 'fail' && <p className="text-xs text-amber-600 mt-1">Could not verify the URL — you can still save it.</p>}
                {linkVerified === 'ok' && <p className="text-xs text-emerald-600 mt-1">URL is reachable.</p>}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSave}
                disabled={!form.title.trim() || (addMode === 'upload' ? !pendingFile : !form.link_url.trim()) || saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white text-sm font-medium rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Save & Attach
              </button>
            </div>
          </div>
        )}

        {/* Library search */}
        {!readOnly && showLibrary && (
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">Manual Library</p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title, manufacturer, or model..."
                className="w-full text-sm border border-slate-200 rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500" />
            </div>
            {filteredLibrary.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">{allManuals.length === 0 ? 'No manuals in library yet. Add one above.' : 'No unattached manuals match your search.'}</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredLibrary.map(m => (
                  <div key={m.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
                    {m.link_url && !m.file_url ? <ExternalLink className="w-4 h-4 text-blue-400 flex-shrink-0" /> : <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{m.title}</p>
                      {m.description && <p className="text-xs text-slate-500 truncate">{m.description}</p>}
                      <p className="text-xs text-slate-400">{[m.manufacturer, m.model_number].filter(Boolean).join(' · ')}{m.link_url && !m.file_url ? ' · Link' : ' · PDF'}</p>
                    </div>
                    <button onClick={() => handleAddFromLibrary(m.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors">
                      <Plus className="w-3 h-3" />Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Project manuals list */}
        <div className="divide-y divide-slate-100">
          {projectManuals.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <BookMarked className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No manuals attached to this project.</p>
              <p className="text-xs text-slate-400 mt-1">Upload a PDF or paste a link to add one, or search the library.</p>
            </div>
          ) : (
            projectManuals.map(pm => {
              const isExpanded = expandedId === pm.id;
              return (
              <div key={pm.id}>
              <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isLinkManual(pm.manual) ? 'bg-blue-50' : 'bg-slate-100'}`}>
                  {isLinkManual(pm.manual) ? <ExternalLink className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-slate-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{pm.manual.title}</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isLinkManual(pm.manual) ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                      {isLinkManual(pm.manual) ? 'LINK' : 'PDF'}
                    </span>
                  </div>
                  {pm.manual.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{pm.manual.description}</p>}
                  {(pm.manual.manufacturer || pm.manual.model_number) && (
                    <p className="text-xs text-slate-400 mt-0.5">{[pm.manual.manufacturer, pm.manual.model_number].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a href={manualHref(pm.manual)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                    <ExternalLink className="w-3 h-3" />{isLinkManual(pm.manual) ? 'Open' : 'View'}
                  </a>
                  {pm.manual.file_url && (
                    <button onClick={() => setExpandedId(isExpanded ? null : pm.id)}
                      className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${isExpanded ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                      {isExpanded ? <X className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      {isExpanded ? 'Close' : 'View PDF'}
                    </button>
                  )}
                  {!readOnly && (
                  <button onClick={() => handleRemove(pm.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  )}
                </div>
              </div>
              {isExpanded && pm.manual.file_url && (
                <div className="bg-slate-100 px-6 py-4">
                  <iframe src={pm.manual.file_url} title={pm.manual.title}
                    className="w-full rounded-lg shadow-sm border border-slate-200" style={{ height: '1050px' }} />
                </div>
              )}
              </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function CoverSection({ project, devices, systemGroups, contractor, authority }: {
  project: any; devices: DeviceWithDatasheet[]; systemGroups: any[]; contractor: any; authority: any;
}) {
  const { role } = useUserAccess();
  const brand = resolveOmBrand(contractor);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Cover Page Preview</h3>
        <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">Auto-populated</span>
      </div>

      <div className="border-2 rounded-lg overflow-hidden relative" style={{ borderColor: brand.primary }}>
        <div className="absolute right-0 top-0 bottom-0 w-3" style={{ background: brand.primary }} aria-hidden />
        <div className="bg-white px-8 py-8 pr-10 border-b-2" style={{ borderColor: brand.primary }}>
          <img
            src={brand.logoSrc}
            alt={brand.name}
            className="h-12 object-contain mb-3"
          />
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] mb-4" style={{ color: brand.primary }}>
            {brand.tagline}
          </p>
          {contractor?.company_name && (
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: brand.ink }}>{contractor.company_name}</p>
          )}
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: brand.primary }}>Operations & Maintenance Manual</p>
          <h1 className="text-2xl font-bold leading-tight" style={{ color: brand.ink }}>{project.project_name || 'Untitled Project'}</h1>
          {project.site_name && <p className="text-[#58595B] mt-2 text-sm">{project.site_name}</p>}
          {project.site_address && <p className="text-[#737373] mt-0.5 text-xs">{project.site_address}</p>}
        </div>

        {/* Project info grid */}
        <div className="bg-white px-8 py-6 grid grid-cols-2 gap-4">
          <InfoRow icon={Building2} label="Client" value={project.client_name} />
          <InfoRow icon={User} label="Project Manager" value={project.project_manager} />
          {project.engineer && <InfoRow icon={User} label="Engineer" value={project.engineer} />}
          <InfoRow icon={Tag} label="Job Number" value={displayProjectJobNumber(project.job_number, project.project_number)} />
          {project.quote_number && <InfoRow icon={Tag} label="Quote Ref" value={project.quote_number} />}
          {project.main_contractor && <InfoRow icon={Building2} label="Main Contractor" value={project.main_contractor} />}
          <InfoRow icon={Calendar} label="Date" value={new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} />
          {project.completion_date && <InfoRow icon={Calendar} label="Completion Date" value={new Date(project.completion_date).toLocaleDateString('en-GB')} />}
        </div>

        {/* Stats bar */}
        <div className="bg-slate-50 border-t border-slate-200 px-8 py-3 flex gap-6">
          <div className="text-sm"><span className="font-semibold text-slate-900">{devices.length}</span> <span className="text-slate-500">Devices</span></div>
          <div className="text-sm"><span className="font-semibold text-slate-900">{systemGroups.length}</span> <span className="text-slate-500">Systems</span></div>
        </div>

        {/* Document authority strip */}
        {(authority?.prepared_by || authority?.checked_by || authority?.approved_by) && (
          <div className="bg-white border-t border-slate-200 px-8 py-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Document Authority</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { role: 'Prepared By', name: authority.prepared_by, date: authority.prepared_date, sig: authority.prepared_signature_url },
                { role: 'Checked By',  name: authority.checked_by,  date: authority.checked_date,  sig: authority.checked_signature_url },
                { role: 'Approved By', name: authority.approved_by, date: authority.approved_date, sig: authority.approved_signature_url },
              ].filter(r => r.name).map(r => (
                <div key={r.role} className="border border-slate-200 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{r.role}</p>
                  {r.sig && <img src={r.sig} alt={r.role} className="h-8 object-contain" />}
                  <p className="text-xs font-semibold text-slate-800">{r.name}</p>
                  {r.date && <p className="text-[10px] text-slate-400">{new Date(r.date).toLocaleDateString('en-GB')}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contractor footer */}
        {contractor && (contractor.company_name || contractor.telephone || contractor.email) && (
          <div className="bg-[#C00000] text-white px-8 py-3 flex flex-wrap gap-4 text-xs">
            {contractor.company_name && <span className="font-semibold">{contractor.company_name}</span>}
            {contractor.telephone && <span className="text-white/80">{contractor.telephone}</span>}
            {contractor.email && <span className="text-white/80">{contractor.email}</span>}
            {contractor.website && <span className="text-white/80">{contractor.website}</span>}
            {contractor.nsi_number && <span>NSI: {contractor.nsi_number}</span>}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">
        {canAccessDocumentManagement(role)
          ? <>Cover page pulls from Document Management — fill in <strong>Contractor Information</strong>, <strong>Document Authority</strong> and <strong>Project Information</strong> to complete it.</>
          : <>Cover page pulls from Document Management. Ask an admin to fill Contractor Information, Document Authority and Project Information.</>}
      </p>
    </div>
  );
}

function contractorHasInfo(contractor: any): boolean {
  if (!contractor) return false;
  return [
    contractor.company_name,
    contractor.address_line1,
    contractor.address_line2,
    contractor.city,
    contractor.postcode,
    contractor.telephone,
    contractor.email,
    contractor.website,
    contractor.company_reg_number,
    contractor.vat_number,
    contractor.nsi_number,
    contractor.ssaib_number,
    contractor.other_certifications,
  ].some(value => typeof value === 'string' && value.trim());
}

function contractorAddressLines(contractor: any): string[] {
  return [
    contractor?.address_line1,
    contractor?.address_line2,
    [contractor?.city, contractor?.postcode].filter(Boolean).join(' '),
  ].map(value => (typeof value === 'string' ? value.trim() : '')).filter(Boolean);
}

function ContractorSection({ contractor }: { contractor: any }) {
  const { role } = useUserAccess();
  const brand = resolveOmBrand(contractor);
  const address = contractorAddressLines(contractor);
  const filled = contractorHasInfo(contractor);
  const details: { label: string; value?: string | null }[] = [
    { label: 'Company', value: contractor?.company_name },
    { label: 'Address', value: address.join('\n') || null },
    { label: 'Telephone', value: contractor?.telephone },
    { label: 'Email', value: contractor?.email },
    { label: 'Website', value: contractor?.website },
    { label: 'Companies House', value: contractor?.company_reg_number },
    { label: 'VAT Number', value: contractor?.vat_number },
    { label: 'NSI', value: contractor?.nsi_number },
    { label: 'SSAIB', value: contractor?.ssaib_number },
    { label: 'Other certifications', value: contractor?.other_certifications },
  ].filter(row => row.value);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Contractor Information</h3>
        <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">Auto-populated</span>
      </div>

      {filled ? (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="text-white px-6 py-4 flex items-center gap-4" style={{ background: brand.primary }}>
            {contractor?.logo_url ? (
              <img src={contractor.logo_url} alt="" className="h-10 object-contain bg-white rounded px-2 py-1" />
            ) : (
              <img src={brand.logoSrc} alt="" className="h-10 object-contain bg-white rounded px-2 py-1" />
            )}
            <div>
              <p className="text-lg font-semibold leading-tight">{contractor?.company_name || 'Contractor'}</p>
              {contractor?.website && <p className="text-xs text-white/80 mt-0.5">{contractor.website}</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-6">
            {details.map(row => (
              <div key={row.label} className={row.label === 'Address' || row.label === 'Other certifications' ? 'sm:col-span-2' : ''}>
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">{row.label}</p>
                <p className="text-sm font-semibold text-slate-800 whitespace-pre-line mt-0.5">{row.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-slate-300 rounded-lg px-6 py-10 text-center text-sm text-slate-500">
          No contractor details yet.
        </div>
      )}

      <p className="text-xs text-slate-400">
        {canAccessDocumentManagement(role)
          ? <>This page pulls from the company assigned to the project. Manage logos and colours on <strong>Companies</strong>, or pick another company in Document Management.</>
          : <>This page pulls from the company assigned to the project. Ask an admin to set the company.</>}
      </p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        <p className="text-sm font-semibold text-slate-800">{value || '—'}</p>
      </div>
    </div>
  );
}

function scheduleGroupKey(row: { manufacturer: string | null; model_number: string | null; description: string | null }) {
  return [row.manufacturer ?? '', row.model_number ?? '', row.description ?? ''].join('|');
}

function groupedScheduleLocation(devices: DeviceWithDatasheet[]): string {
  const locs = [...new Set(devices.map(d => d.location?.trim()).filter(Boolean))] as string[];
  if (locs.length === 0) return '—';
  if (locs.length === 1) return locs[0];
  return locs.slice(0, 3).join(', ') + (locs.length > 3 ? ` +${locs.length - 3}` : '');
}

function groupedScheduleWarranty(devices: DeviceWithDatasheet[]): string {
  const years = devices.find(d => d.warrantyYears != null)?.warrantyYears ?? DEFAULT_PRODUCT_WARRANTY_YEARS;
  return `${years}yr`;
}

function ScheduleSection({ systemGroups }: { systemGroups: { system: SystemType; devices: DeviceWithDatasheet[] }[] }) {
  return (
    <div className="space-y-4">
      {systemGroups.length === 0 ? (
        <EmptyState icon={ClipboardCheck} message="No devices in this project yet." />
      ) : (
        systemGroups.map(g => {
          const equipmentGroups = groupDevices(g.devices);
          return (
            <div key={g.system} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <SystemHeader system={g.system} count={g.devices.length} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    {['Description', 'Manufacturer', 'Model', 'Qty', 'Location', 'Warranty'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {equipmentGroups.map(row => (
                      <tr key={scheduleGroupKey(row)} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-600">{row.description || '—'}</td>
                        <td className="px-4 py-2.5 text-slate-700">{row.manufacturer || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{row.model_number || '—'}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-800">{row.quantity}</td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate">{groupedScheduleLocation(row.devices as DeviceWithDatasheet[])}</td>
                        <td className="px-4 py-2.5 text-slate-600">{groupedScheduleWarranty(row.devices as DeviceWithDatasheet[])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

type ScopeDevice = { device_type?: string | null; manufacturer?: string | null; location?: string | null };

async function callGenerateScope(
  project: any,
  sourceDocs: any[],
  deviceList: any[]
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('generate-scope', {
    body: {
      project: {
        project_name: project?.project_name ?? 'Security Project',
        client_name: project?.client_name ?? null,
        site_name: project?.site_name ?? null,
        project_manager: project?.project_manager ?? null,
      },
      sources: sourceDocs.map(d => ({
        system_type: d.system_type,
        file_name: d.file_name,
        file_url: d.file_url,
        media_type: d.media_type,
      })),
      devices: deviceList.map(d => ({
        system_type: d.system_type,
        device_type: d.device_type,
        manufacturer: d.manufacturer,
        model_number: d.model_number,
        location: d.location,
        notes: d.notes,
      })),
    },
  });
  return (!error && data?.scope?.trim()) ? data.scope : null;
}

function buildAutoScope(
  sysGroups: { system: string; devices: ScopeDevice[] }[],
  siteName?: string | null,
  clientName?: string | null
): string {
  const site = siteName || 'the above premises';
  const client = clientName ? ` for ${clientName}` : '';
  const plural = sysGroups.length > 1 ? 's' : '';

  let doc = `## Overview\n\nThis Operations & Maintenance manual covers the security system${plural} installed at ${site}${client}.\n\n`;

  sysGroups.forEach(g => {
    const count = g.devices.length;
    const types = [...new Set(g.devices.map(d => d.device_type).filter(Boolean) as string[])];
    const mfrs = [...new Set(g.devices.map(d => d.manufacturer).filter(Boolean) as string[])];
    const locs = [...new Set(g.devices.map(d => d.location).filter(Boolean) as string[])];

    doc += `## ${g.system}\n\n`;
    let line = `${count} device${count !== 1 ? 's' : ''} installed`;
    if (types.length > 0) line += ` comprising ${types.slice(0, 4).join(', ')}`;
    if (mfrs.length > 0) line += ` (${mfrs.slice(0, 3).join(' / ')})`;
    if (locs.length > 0) {
      const shown = locs.slice(0, 4);
      line += `, covering ${shown.join(', ')}`;
      if (locs.length > 4) line += ` and ${locs.length - 4} other area${locs.length - 4 !== 1 ? 's' : ''}`;
    }
    doc += line + '.\n\n';
  });

  const systems = sysGroups.map(g => g.system);
  doc += `## Deliverables\n\nThis manual provides:\n\n`;
  doc += `- Device schedule for all installed equipment\n`;
  doc += `- Maintenance requirements for each system\n`;
  doc += `- Commissioning test records and verification\n`;
  doc += `- Handover documentation and certification\n`;
  doc += `- Technical datasheets for installed equipment\n`;
  doc += `- As fitted installation drawings\n`;

  doc += `\n## Standards & Compliance\n\n`;
  if (systems.includes('CCTV'))              doc += `- CCTV: BS EN 50132, BS 8418 (where monitored)\n`;
  if (systems.includes('Intruder'))          doc += `- Intruder Alarm: BS EN 50131, BS 8243\n`;
  if (systems.includes('Access Control'))    doc += `- Access Control: BS EN 50133, PD 6662\n`;
  if (systems.includes('Intercom'))          doc += `- Intercom: BS EN 50133 (door entry provisions)\n`;
  if (systems.includes('Networking'))        doc += `- Networking: BS EN 50173, BS 6701\n`;
  if (systems.includes('Perimeter Detection')) doc += `- Perimeter Detection: BS EN 50131 Grade 3 as applicable\n`;

  doc += `\n## Warranty & Support\n\nAll equipment is covered by manufacturer warranty as detailed in the datasheets in this manual. For service and support contact the installing contractor using the details on the cover page.\n`;

  return doc;
}

// ─── Handover Pack Section (screen) ──────────────────────────────────────────

function HandoverPackSection({ uploads, onRemove, handoverDocs, scHandoverDocs, otherHandoverDocs, documentSystems, readOnly }: {
  uploads: OmUpload[];
  onRemove: (u: OmUpload) => void;
  handoverDocs: HandoverDocument[];
  scHandoverDocs: {
    id?: number;
    document_type: string;
    title: string;
    status: string;
    file_url: string | null;
    file_name: string | null;
    sc_inspection_id: string | null;
    sc_result: string | null;
    system_type?: string | null;
    project_system_id?: number | null;
  }[];
  otherHandoverDocs: OtherHandoverDoc[];
  documentSystems: ProjectSystem[];
  readOnly?: boolean;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (uploads.length === 0 && scHandoverDocs.length === 0 && otherHandoverDocs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-slate-800">Handover Documents</h3>
          <p className="text-sm text-slate-500 mt-1">
            No handover documents uploaded yet. Go to the{' '}
            <strong>Handover</strong> section to send a SafetyCulture inspection or upload a signed PDF.
          </p>
        </div>
        {handoverDocs.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              <p className="text-xs text-amber-700 font-medium">Database records found (no PDFs uploaded):</p>
            </div>
            <HandoverSummary docs={handoverDocs} />
          </div>
        )}
      </div>
    );
  }

  const uploadGroups = groupRecordsByProjectSystems(documentSystems, uploads);
  const scGroups = groupRecordsByProjectSystems(documentSystems, scHandoverDocs);
  const otherGroups = groupRecordsByProjectSystems(documentSystems, otherHandoverDocs);
  const sectionLabels = [...new Set([...uploadGroups, ...scGroups, ...otherGroups].map(group => group.label))];

  return (
    <div className="space-y-6">
      {sectionLabels.map(label => {
        const uploadGroup = uploadGroups.find(group => group.label === label);
        const scGroup = scGroups.find(group => group.label === label);
        const otherGroup = otherGroups.find(group => group.label === label);
        const system = uploadGroup?.system ?? scGroup?.system ?? otherGroup?.system ?? null;
        const groupUploads = uploadGroup?.records ?? [];
        const groupScDocs = scGroup?.records ?? [];
        const groupOtherDocs = otherGroup?.records ?? [];

        const grouped: { section: string; label: string; items: OmUpload[] }[] = [];
        const seenSections = new Set<string>();
        for (const upload of groupUploads) {
          if (!seenSections.has(upload.section)) {
            seenSections.add(upload.section);
            grouped.push({
              section: upload.section,
              label: handoverSectionLabel(upload.section),
              items: groupUploads.filter(item => item.section === upload.section),
            });
          }
        }

        return (
          <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100 bg-slate-50">
              {system ? (
                React.createElement(getCategoryStyle(system.category).icon, { className: 'w-4 h-4 text-slate-400' })
              ) : (
                <Award className="w-4 h-4 text-slate-400" />
              )}
              <h3 className="font-semibold text-slate-800">{label}</h3>
              <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                {groupUploads.length + groupScDocs.length + groupOtherDocs.length} document{(groupUploads.length + groupScDocs.length + groupOtherDocs.length) !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {grouped.flatMap(({ label: docLabel, items }) =>
                items.map((upload, idx) => {
                  const displayLabel = items.length > 1 ? `${docLabel} (${idx + 1})` : docLabel;
                  const isExpanded = expandedKey === `upload-${upload.id}`;
                  return (
                    <div key={upload.id}>
                      <div className={`flex items-center gap-3 px-6 py-4 transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                        <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4 text-red-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{displayLabel}</p>
                          <p className="text-xs text-slate-400 truncate mt-0.5">{upload.file_name}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <a href={upload.file_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" />Open
                          </a>
                          <button onClick={() => setExpandedKey(isExpanded ? null : `upload-${upload.id}`)}
                            className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${isExpanded ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                            {isExpanded ? <X className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {isExpanded ? 'Close' : 'View PDF'}
                          </button>
                          {!readOnly && (
                          <button onClick={() => onRemove(upload)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                          )}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-100 px-6 py-4">
                          <iframe src={upload.file_url} title={displayLabel}
                            className="w-full rounded-lg shadow-sm border border-slate-200" style={{ height: '1050px' }} />
                        </div>
                      )}
                    </div>
                  );
                }),
              )}
            </div>

            {groupScDocs.length > 0 && (
              <div className="border-t border-slate-200 px-6 py-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Imported handover documents</p>
                {groupScDocs.map(doc => {
                  const key = `sc-${doc.id ?? doc.document_type}`;
                  const isExpanded = expandedKey === key;
                  return (
                    <div key={key} className="border border-blue-200 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-3 bg-blue-50 px-4 py-3">
                        <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-blue-900">{doc.title}</p>
                          <p className="text-xs text-blue-600 mt-0.5">
                            {doc.file_name ?? (doc.status === 'uploaded' ? 'PDF uploaded' : 'Completed in SafetyCulture')}
                            {doc.sc_result && <span className="ml-2 font-medium">{doc.sc_result === 'pass' ? 'PASS' : 'FAIL'}</span>}
                          </p>
                        </div>
                        {doc.file_url && (
                          <>
                            <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline flex items-center gap-1 flex-shrink-0">
                              <ExternalLink className="w-3 h-3" />Open
                            </a>
                            <button onClick={() => setExpandedKey(isExpanded ? null : key)}
                              className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${isExpanded ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-blue-200 text-blue-700 hover:bg-blue-100'}`}>
                              {isExpanded ? <X className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              {isExpanded ? 'Close' : 'View PDF'}
                            </button>
                          </>
                        )}
                      </div>
                      {isExpanded && doc.file_url && (
                        <div className="bg-slate-100 px-4 py-4">
                          <iframe src={doc.file_url} title={doc.title}
                            className="w-full rounded-lg shadow-sm border border-slate-200" style={{ height: '1050px' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {groupOtherDocs.length > 0 && (
              <div className="border-t border-slate-200 px-6 py-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Other documents</p>
                {groupOtherDocs.map(doc => {
                  const key = `other-${doc.id}`;
                  const isExpanded = expandedKey === key;
                  const href = doc.file_url ?? doc.link_url;
                  return (
                    <div key={key} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3">
                        <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800">{doc.title}</p>
                          {doc.description && <p className="text-xs text-slate-500 mt-0.5">{doc.description}</p>}
                        </div>
                        {href && (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-600 hover:underline flex items-center gap-1 flex-shrink-0">
                            <ExternalLink className="w-3 h-3" />Open
                          </a>
                        )}
                        {doc.file_url && (
                          <button onClick={() => setExpandedKey(isExpanded ? null : key)}
                            className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${isExpanded ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                            {isExpanded ? <X className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {isExpanded ? 'Close' : 'View PDF'}
                          </button>
                        )}
                      </div>
                      {isExpanded && doc.file_url && (
                        <div className="bg-slate-100 px-4 py-4">
                          <iframe src={doc.file_url} title={doc.title}
                            className="w-full rounded-lg shadow-sm border border-slate-200" style={{ height: '1050px' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PrintPdfPages({ title, fileName, url, pageImages }: {
  title: string;
  fileName?: string | null;
  url: string;
  pageImages: Record<string, PdfRenderState>;
}) {
  const rendered = pageImages[url];
  return (
    <div className="mb-8">
      <h3 className="text-base font-bold text-slate-800 mb-4 pb-2 border-b border-slate-300">{title}</h3>
      {rendered?.failed ? (
        <div className="border border-slate-200 rounded p-6 text-center text-slate-500 text-sm">
          <p className="font-medium mb-1">Could not render PDF for print</p>
          <p className="text-xs text-slate-400">{fileName ?? url}</p>
        </div>
      ) : rendered?.pages.length ? (
        <div className="space-y-2">
          {rendered.pages.map((src, pageIdx) => (
            <img
              key={pageIdx}
              src={src}
              alt={`${title} — page ${pageIdx + 1}`}
              className="w-full"
              style={{ pageBreakInside: 'avoid' }}
            />
          ))}
        </div>
      ) : (
        <div className="border border-slate-200 rounded p-6 text-center text-slate-500 text-sm">
          <p>PDF not yet rendered — wait for “Preparing PDFs for print” to finish</p>
          <p className="text-xs mt-1 text-slate-400">{fileName ?? url}</p>
        </div>
      )}
    </div>
  );
}

function UploadSection({ sectionId, title, description, upload, uploading, onUpload, onRemove, fallbackContent, fallbackLabel, readOnly }: {
  onUpload: () => void; onRemove: (u: OmUpload) => void;
  fallbackContent: React.ReactNode; fallbackLabel: string;
  readOnly?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-semibold text-slate-800">{title}</h3>
      </div>
      <p className="text-sm text-slate-500 mb-5">{description}</p>

      {/* Upload area */}
      {upload ? (
        <div className="flex items-center gap-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl mb-5">
          <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-900">{upload.file_name}</p>
            <p className="text-xs text-emerald-700 mt-0.5">PDF uploaded and will be included in the pack</p>
          </div>
          <a href={upload.file_url} target="_blank" rel="noopener noreferrer"
            className="text-xs font-medium text-emerald-700 hover:underline flex items-center gap-1">
            <ExternalLink className="w-3 h-3" />View
          </a>
          {!readOnly && (
          <button onClick={() => onRemove(upload)} className="p-1.5 text-emerald-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
          )}
        </div>
      ) : readOnly ? (
        fallbackContent ? (
          <div className="mb-5">{fallbackContent}</div>
        ) : (
          <div className="text-center py-4 text-slate-400 text-sm mb-5">No commissioning PDF in this pack yet.</div>
        )
      ) : (
        <div onClick={onUpload}
          className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-cyan-400 hover:bg-cyan-50 transition-colors mb-5 group">
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-cyan-600">
              <div className="w-5 h-5 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Uploading…</span>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-slate-300 group-hover:text-cyan-400 mx-auto mb-2 transition-colors" />
              <p className="text-sm font-medium text-slate-500 group-hover:text-cyan-600">Click to upload PDF</p>
              <p className="text-xs text-slate-400 mt-1">PDF files only · Max 50 MB</p>
            </>
          )}
        </div>
      )}

      {/* Fallback: show DB data if no PDF uploaded */}
      {!readOnly && !upload && fallbackContent && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs text-amber-700 font-medium">No PDF uploaded — showing {fallbackLabel}:</p>
          </div>
          {fallbackContent}
        </div>
      )}
      {!readOnly && !upload && !fallbackContent && (
        <div className="text-center py-4 text-slate-400 text-sm">No data found in database either. Upload a PDF or complete this section in the platform first.</div>
      )}
    </div>
  );
}

// ─── As Fitted record — screen view ───────────────────────────────────────────

function AsFittedRecordSection({
  content, onChange, onSave, saving, items, readOnly,
}: {
  content: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  items: AsFittedItemRow[];
  readOnly: boolean;
}) {
  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h3 className="text-sm font-semibold text-slate-800">Quoted vs as-fitted equipment</h3>
            <p className="text-xs text-slate-500 mt-0.5">Installed quantities and statuses from the As Fitted page.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-6 py-2.5 font-semibold">Description</th>
                  <th className="px-4 py-2.5 font-semibold">Quoted</th>
                  <th className="px-4 py-2.5 font-semibold">Installed</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-6 py-2.5 font-semibold">Change reason</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-6 py-3 text-slate-800">{item.installed_description || item.quoted_description || 'Untitled line'}</td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">{item.quoted_quantity ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-800 tabular-nums font-medium">{item.actual_installed_quantity ?? item.quoted_quantity ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{humanizeOption(item.reconciliation_status)}</td>
                    <td className="px-6 py-3 text-slate-500">{item.change_reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <MarkdownDocEditor
        title="As Fitted"
        content={content}
        onChange={onChange}
        onSave={onSave}
        saving={saving}
        placeholder="Enter as-fitted works here (supports Markdown formatting)..."
        emptyHint="No as-fitted record yet. It copies the Scope of Works on the As Fitted page, or you can type it here."
        readOnly={readOnly}
      />
    </div>
  );
}

function PrintAsFittedItems({ items }: { items: AsFittedItemRow[] }) {
  const brand = useOmBrand();
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.25rem', fontSize: '0.78rem' }}>
      <thead>
        <tr style={{ background: PACIFIC_LABEL_GREY }}>
          {['Description', 'Quoted', 'Installed', 'Status', 'Change reason'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '0.45rem 0.55rem', fontSize: '0.62rem', fontWeight: 700, color: brand.ink, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `2px solid ${brand.primary}` }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id}>
            <td style={{ padding: '0.4rem 0.55rem', borderBottom: '1px solid #ececec' }}>{item.installed_description || item.quoted_description || 'Untitled line'}</td>
            <td style={{ padding: '0.4rem 0.55rem', borderBottom: '1px solid #ececec' }}>{item.quoted_quantity ?? '—'}</td>
            <td style={{ padding: '0.4rem 0.55rem', borderBottom: '1px solid #ececec' }}>{item.actual_installed_quantity ?? item.quoted_quantity ?? '—'}</td>
            <td style={{ padding: '0.4rem 0.55rem', borderBottom: '1px solid #ececec' }}>{humanizeOption(item.reconciliation_status)}</td>
            <td style={{ padding: '0.4rem 0.55rem', borderBottom: '1px solid #ececec' }}>{item.change_reason || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── As Fitted Drawings — screen view ────────────────────────────────────────

function AsFittedDrawingsSection({ drawings, pageImages, documentSystems }: {
  drawings: AsBuiltDrawing[];
  pageImages: Record<string, PdfRenderState>;
  documentSystems: ProjectSystem[];
}) {
  const [previewId, setPreviewId] = useState<number | null>(null);
  if (drawings.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <Layers className="w-10 h-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500">No as-fitted drawings uploaded</p>
        <p className="text-xs text-slate-400 mt-1">
          Upload drawings in <strong>As Fitted Drawings</strong> — they will appear here full-size in the O&M pack.
        </p>
      </div>
    );
  }

  const drawingGroups = groupRecordsByProjectSystems(documentSystems, drawings);

  return (
    <div className="space-y-6">
      {drawingGroups.map(group => (
        <div key={group.label} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100 bg-slate-50">
            {group.system ? (
              React.createElement(getCategoryStyle(group.system.category).icon, { className: 'w-4 h-4 text-slate-400' })
            ) : (
              <Layers className="w-4 h-4 text-slate-400" />
            )}
            <h3 className="font-semibold text-slate-800">{group.label}</h3>
            <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
              {group.records.length} drawing{group.records.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {group.records.map(d => {
              const rendered = pageImages[d.file_url];
              const isOpen = previewId === d.id;
              return (
                <div key={d.id}>
                  <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{d.title || d.file_name}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                        {d.drawing_number && <span>#{d.drawing_number}</span>}
                        {d.revision && <span>{d.revision}</span>}
                        <span className="truncate">{d.file_name}</span>
                        {rendered?.loading && <span className="text-amber-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Preparing…</span>}
                        {!rendered?.loading && rendered?.pages.length ? <span className="text-emerald-600">{rendered.pages.length} page{rendered.pages.length !== 1 ? 's' : ''} ready</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2 py-1 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />Open
                      </a>
                      <button onClick={() => setPreviewId(isOpen ? null : d.id)}
                        className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${isOpen ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                        {isOpen ? <X className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        {isOpen ? 'Close' : 'Preview'}
                      </button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-100 px-6 py-4">
                      <iframe src={d.file_url} title={d.title || d.file_name}
                        className="w-full rounded-lg shadow border border-slate-200" style={{ height: '1050px' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── As Fitted Drawings — print view ─────────────────────────────────────────

function PrintAsFittedDrawings({ drawings, pageImages, documentSystems, skipAnchor }: {
  drawings: AsBuiltDrawing[];
  pageImages: Record<string, PdfRenderState>;
  documentSystems: ProjectSystem[];
  skipAnchor?: boolean;
}) {
  const drawingGroups = groupRecordsByProjectSystems(documentSystems, drawings);
  let anchorAssigned = !!skipAnchor;

  return (
    <>
      {drawingGroups.flatMap(group =>
        group.records.map(d => {
          const rendered = pageImages[d.file_url];
          const anchorId = !anchorAssigned ? 'print-section-as_fitted_drawings' : undefined;
          if (!anchorAssigned) anchorAssigned = true;
          return (
            <div
              key={d.id}
              id={anchorId}
              data-om-source-pdf={d.file_url}
              data-om-source-title={`${group.label} — ${d.title || d.file_name}`}
              data-print-section="as_fitted_drawings"
            >
              <PrintSection
                title={`${group.label} — ${d.title || d.file_name}`}
                subtitle={[d.drawing_number && `#${d.drawing_number}`, d.revision].filter(Boolean).join(' · ') || undefined}
              >
              {rendered?.failed ? (
                <div className="border border-slate-200 rounded p-6 text-center text-slate-500 text-sm">
                  <p className="font-medium mb-1">Could not render PDF</p>
                  <p className="text-xs text-slate-400">{d.file_name}</p>
                </div>
              ) : rendered?.pages.length ? (
                <div className="space-y-1">
                  {rendered.pages.map((src, i) => (
                    <img key={i} src={src} alt={`${d.title} page ${i + 1}`} className="w-full" style={{ pageBreakInside: 'avoid' }} />
                  ))}
                </div>
              ) : (
                <div className="border border-slate-200 rounded p-6 text-center text-slate-500 text-sm">
                  <p>Drawing not yet rendered — open the O&M Builder to prepare for print</p>
                  <p className="text-xs mt-1 text-slate-400">{d.file_name}</p>
                </div>
              )}
            </PrintSection>
            <div className="page-break" />
          </div>
          );
        }),
      )}
    </>
  );
}

function datasheetRemoveKey(device: DeviceWithDatasheet): string {
  return `${device.datasheet?.id ?? 'none'}|${device.manufacturer?.trim().toLowerCase() ?? ''}|${device.model_number?.trim().toLowerCase() ?? ''}`;
}

function DatasheetsSection({
  systemGroups,
  readOnly,
  onRemoveDatasheet,
  confirmRemoveKey,
  removing,
}: {
  systemGroups: { system: SystemType; devices: DeviceWithDatasheet[] }[];
  readOnly: boolean;
  onRemoveDatasheet: (device: DeviceWithDatasheet) => void;
  confirmRemoveKey: string | null;
  removing: boolean;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const withDS = systemGroups.map(g => {
    const seen = new Set<string>();
    const unique = g.devices.filter(d => {
      if (!d.datasheet) return false;
      const key = `${d.manufacturer?.trim().toLowerCase()}|${d.model_number?.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...g, devices: unique };
  }).filter(g => g.devices.length > 0);

  if (withDS.length === 0) {
    return <EmptyState icon={ExternalLink} message="No datasheets linked to devices. Match products in the Product Database and upload datasheets." />;
  }
  return (
    <div className="space-y-4">
      {!readOnly && (
        <p className="text-sm text-slate-500">
          Remove takes the datasheet out of this O&amp;M and deletes it from the library.
        </p>
      )}
      {withDS.map(g => (
        <div key={g.system} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <SystemHeader system={g.system} count={g.devices.length} />
          <div className="divide-y divide-slate-100">
            {g.devices.map(d => {
              const url = d.datasheet?.datasheet_url;
              const key = `${g.system}-${d.id}`;
              const removeKey = datasheetRemoveKey(d);
              const isExpanded = expandedKey === key;
              const confirmRemove = confirmRemoveKey === removeKey;
              return (
                <div key={d.id}>
                  <div className="flex items-center gap-4 px-5 py-3">
                    <span className="text-sm text-slate-700 flex-1">{[d.manufacturer, d.model_number].filter(Boolean).join(' ')}</span>
                    {url && (
                      <>
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                          <ExternalLink className="w-3 h-3" />Open
                        </a>
                        <button onClick={() => setExpandedKey(isExpanded ? null : key)}
                          className={`text-xs px-2 py-1 border rounded-lg transition-colors flex items-center gap-1 ${isExpanded ? 'bg-cyan-50 border-cyan-300 text-cyan-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                          {isExpanded ? <X className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          {isExpanded ? 'Close' : 'View PDF'}
                        </button>
                        {!readOnly && (
                          <button
                            type="button"
                            disabled={removing}
                            onClick={() => onRemoveDatasheet(d)}
                            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                              confirmRemove
                                ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
                                : 'border-red-200 text-red-700 hover:bg-red-50'
                            }`}
                          >
                            {removing && confirmRemove ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            {confirmRemove ? 'Confirm remove' : 'Remove'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {isExpanded && url && (
                    <div className="bg-slate-100 px-5 py-4">
                      <iframe src={url} title={[d.manufacturer, d.model_number].filter(Boolean).join(' ')}
                        className="w-full rounded-lg shadow-sm border border-slate-200" style={{ height: '1050px' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Comm / Handover summaries (used in both screen and print) ────────────────

function CommSummary({ records }: { records: CommissioningRecord[] }) {
  const systems = [...new Set(records.map(r => r.system_type))];
  return (
    <div className="space-y-3">
      {systems.map(sys => {
        const recs = records.filter(r => r.system_type === sys);
        const passed = recs.filter(r => r.pass === true).length;
        const failed = recs.filter(r => r.pass === false).length;
        return (
          <div key={sys} className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-2 flex items-center justify-between border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-800">{sys}</span>
              <div className="flex gap-3 text-xs">
                <span className="text-emerald-600 font-medium">{passed} pass</span>
                {failed > 0 && <span className="text-red-600 font-medium">{failed} fail</span>}
                <span className="text-slate-400">{recs.length - passed - failed} pending</span>
              </div>
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {recs.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-700 w-8">
                      {r.pass === true ? <span className="text-emerald-600">✓</span> : r.pass === false ? <span className="text-red-500">✗</span> : <span className="text-slate-300">○</span>}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{r.test_description}</td>
                    <td className="px-2 py-2 text-slate-500 max-w-[160px] truncate">{r.actual_result || '—'}</td>
                    <td className="px-2 py-2 text-slate-400">{r.engineer_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function HandoverSummary({ docs }: { docs: HandoverDocument[] }) {
  return (
    <div className="space-y-2">
      {docs.map(d => (
        <div key={d.id} className="flex items-center justify-between px-4 py-3 border border-slate-200 rounded-lg">
          <div>
            <p className="text-sm font-medium text-slate-800">{d.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{d.document_type} · {d.status}</p>
          </div>
          {d.signed_by && (
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
              Signed: {d.signed_by}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SystemHeader({ system, count }: { system: SystemType; count: number }) {
  const Icon = SYS_ICONS[system] ?? BookOpen;
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 bg-slate-50 border-b border-slate-100">
      <Icon className="w-4 h-4 text-slate-500" />
      <span className="text-sm font-semibold text-slate-800">{system}</span>
      <span className="text-xs text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full">{count}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm text-center py-16 px-8">
      <Icon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}

// ─── Print components ─────────────────────────────────────────────────────────

// ─── Print Table of Contents ──────────────────────────────────────────────────

interface TocEntry {
  label: string;
  anchorId: string;
  number: number;
}

function PrintTableOfContents({
  project,
  hasContractor, hasScope, hasAsFitted, hasSchedule, hasTechDocs, hasMaintPlan,
  hasCommissioning, hasHandover, hasAsFittedDrawings, hasDatasheets, hasUserManuals,
}: {
  project: any;
  hasContractor: boolean;
  hasScope: boolean; hasAsFitted: boolean; hasSchedule: boolean; hasTechDocs: boolean; hasMaintPlan: boolean;
  hasCommissioning: boolean; hasHandover: boolean; hasAsFittedDrawings: boolean;
  hasDatasheets: boolean; hasUserManuals: boolean;
}) {
  const brand = useOmBrand();
  const entries: TocEntry[] = [];
  let num = 1;

  if (hasContractor) entries.push({ label: 'Contractor Information', anchorId: 'print-section-contractor', number: num++ });
  if (hasScope) entries.push({ label: 'Scope of Works', anchorId: 'print-section-scope', number: num++ });
  if (hasAsFitted) entries.push({ label: 'As Fitted', anchorId: 'print-section-as_fitted', number: num++ });
  if (hasSchedule) entries.push({ label: 'Device Schedule and Warranties', anchorId: 'print-section-schedule', number: num++ });
  if (hasTechDocs) entries.push({ label: 'Technical Documentation', anchorId: 'print-section-technical_docs', number: num++ });
  if (hasMaintPlan) entries.push({ label: 'Maintenance Plan', anchorId: 'print-section-maintenance_plan', number: num++ });
  if (hasCommissioning) entries.push({ label: 'Commissioning Pack', anchorId: 'print-section-commissioning', number: num++ });
  if (hasHandover) entries.push({ label: 'Handover Documents', anchorId: 'print-section-handover', number: num++ });
  if (hasAsFittedDrawings) entries.push({ label: 'As Fitted Drawings', anchorId: 'print-section-as_fitted_drawings', number: num++ });
  if (hasDatasheets) entries.push({ label: 'Datasheets', anchorId: 'print-section-datasheets', number: num++ });
  if (hasUserManuals) entries.push({ label: 'User Manuals', anchorId: 'print-section-user_manuals', number: num++ });

  return (
    <div id="print-section-toc" style={{ padding: '3.5rem 3.5rem 3rem', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ flex: '0 0 auto' }}>
        <p style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', color: brand.primary, textTransform: 'uppercase', margin: '0 0 0.75rem', textAlign: 'right' }}>
          {[project?.client_name, project?.site_name || project?.project_name].filter(Boolean).join(' — ') || 'O&M Pack'}
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `3px solid ${brand.primary}`, paddingBottom: '1rem', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, color: brand.ink, margin: 0, letterSpacing: '-0.02em' }}>
            Table of Contents
          </h1>
          <span style={{ fontSize: '0.7rem', color: '#737373', fontWeight: 400 }}>
            {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <p style={{ fontSize: '0.65rem', color: brand.primary, margin: '0 0 2.5rem', textAlign: 'right', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Operations &amp; Maintenance Manual</p>
      </div>

      {/* Entries */}
      <div style={{ flex: '1 1 auto' }}>
        {entries.map((entry, i) => (
          <div
            key={entry.anchorId}
            className="toc-entry-row"
            data-toc-anchor={entry.anchorId}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0.8rem 0',
              borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none',
            }}
          >
            {/* Number badge */}
            <span style={{
              width: '1.75rem', height: '1.75rem', borderRadius: '50%',
              background: brand.primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', fontWeight: 800, color: 'white', flexShrink: 0, marginRight: '0.75rem',
            }}>
              {entry.number}
            </span>
            <a
              href={`#${entry.anchorId}`}
              style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b', textDecoration: 'none', flex: '0 0 auto' }}
            >
              {entry.label}
            </a>
            <span style={{ flex: 1, borderBottom: '1.5px dotted #cbd5e1', margin: '0 0.75rem 0.2rem' }} />
            <a
              href={`#${entry.anchorId}`}
              className="toc-page-link"
              data-toc-anchor={entry.anchorId}
              style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a', textDecoration: 'none', minWidth: '2rem', textAlign: 'right', flexShrink: 0 }}
            >
            </a>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ flex: '0 0 auto', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem', marginTop: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: '0.65rem', color: '#737373', margin: 0 }}>
          This document has been automatically generated. All information should be verified against site records.
        </p>
        <p style={{ fontSize: '0.65rem', color: brand.primary, margin: 0, fontWeight: 700 }}>{brand.name}</p>
      </div>
    </div>
  );
}

function PrintContractorInformation({ contractor }: { contractor: any }) {
  const brand = resolveOmBrand(contractor);
  const address = contractorAddressLines(contractor);
  const rows: [string, string][] = [];
  if (contractor?.company_name) rows.push(['Company', contractor.company_name]);
  if (address.length) rows.push(['Address', address.join('\n')]);
  if (contractor?.telephone) rows.push(['Telephone', contractor.telephone]);
  if (contractor?.email) rows.push(['Email', contractor.email]);
  if (contractor?.website) rows.push(['Website', contractor.website]);
  if (contractor?.company_reg_number) rows.push(['Companies House', contractor.company_reg_number]);
  if (contractor?.vat_number) rows.push(['VAT Number', contractor.vat_number]);
  if (contractor?.nsi_number) rows.push(['NSI', contractor.nsi_number]);
  if (contractor?.ssaib_number) rows.push(['SSAIB', contractor.ssaib_number]);
  if (contractor?.other_certifications) rows.push(['Other certifications', contractor.other_certifications]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        {contractor?.logo_url ? (
          <img src={contractor.logo_url} alt="" style={{ height: '3rem', objectFit: 'contain' }} />
        ) : (
          <img src={brand.logoSrc} alt="" style={{ height: '3rem', objectFit: 'contain' }} />
        )}
        <div>
          <p style={{ fontSize: '1.15rem', fontWeight: 800, color: brand.ink, margin: 0 }}>
            {contractor?.company_name || 'Contractor'}
          </p>
          {contractor?.website ? (
            <p style={{ fontSize: '0.8rem', color: '#58595B', margin: '0.25rem 0 0' }}>{contractor.website}</p>
          ) : null}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem 2rem' }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ gridColumn: label === 'Address' || label === 'Other certifications' ? '1 / -1' : undefined }}>
            <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.2rem' }}>{label}</p>
            <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b', margin: 0, whiteSpace: 'pre-line' }}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrintCoverPage({ project, devices, systemGroups, contractor, authority }: {
  project: any; devices: any[]; systemGroups: any[]; contractor: any; authority: any;
}) {
  const brand = resolveOmBrand(contractor);
  return (
    <div className="om-cover-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif', position: 'relative', color: brand.ink }}>
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '14px', background: brand.primary }} aria-hidden />
      <div style={{ padding: '2.75rem 3.5rem 1.75rem', borderBottom: `3px solid ${brand.primary}`, flex: '0 0 auto', paddingRight: '4rem' }}>
        <img
          src={brand.logoSrc}
          alt={brand.name}
          style={{ height: '3.25rem', objectFit: 'contain', marginBottom: '0.85rem' }}
        />
        <p style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: brand.primary, margin: 0 }}>
          {brand.tagline}
        </p>
        {contractor?.company_name && (
          <p style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: brand.ink, margin: '0.85rem 0 0' }}>
            {contractor.company_name}
          </p>
        )}
      </div>

      <div style={{ background: 'white', padding: '2rem 3.5rem', flex: '1 1 auto', paddingRight: '4rem' }}>
        <p style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: brand.primary, margin: '0 0 0.6rem' }}>
          Operations &amp; Maintenance Manual
        </p>
        <h1 style={{ fontSize: '2.25rem', fontWeight: 800, lineHeight: 1.2, color: brand.ink, margin: '0 0 0.75rem' }}>
          {project?.project_name || 'Untitled Project'}
        </h1>
        {project?.site_name && (
          <p style={{ fontSize: '1rem', color: '#58595B', margin: '0 0 0.25rem' }}>{project.site_name}</p>
        )}
        {project?.site_address && (
          <p style={{ fontSize: '0.8rem', color: '#737373', margin: 0 }}>{project.site_address}</p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem 3rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1.75rem', marginTop: '1.75rem', marginBottom: '1.75rem' }}>
          {[
            ['Client', project?.client_name],
            ['Project Manager', project?.project_manager],
            project?.engineer && ['Engineer', project.engineer],
            ['Reference', project?.project_number || project?.quote_number],
            project?.main_contractor && ['Main Contractor', project.main_contractor],
            ['Document Date', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })],
            project?.completion_date && ['Completion Date', new Date(project.completion_date).toLocaleDateString('en-GB')],
          ].filter(Boolean).map(([lbl, value]: any) => (
            <div key={String(lbl)}>
              <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.2rem' }}>{lbl}</p>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b', margin: 0 }}>{value || '—'}</p>
            </div>
          ))}
        </div>

        {/* Systems installed */}
        <div style={{ marginBottom: '1.75rem' }}>
          <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.75rem' }}>
            Systems Installed
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {systemGroups.map((g: any) => (
              <span key={g.system} style={{
                background: '#f7f7f7', border: `1px solid ${brand.primary}`,
                borderRadius: '0.375rem', padding: '0.25rem 0.75rem',
                fontSize: '0.75rem', fontWeight: 600, color: brand.ink,
              }}>
                {g.system}
              </span>
            ))}
          </div>
        </div>

        {/* Document authority */}
        {(authority?.prepared_by || authority?.checked_by || authority?.approved_by) && (
          <div>
            <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.75rem' }}>
              Document Authority
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              {[
                { role: 'Prepared By', name: authority.prepared_by, date: authority.prepared_date, sig: authority.prepared_signature_url },
                { role: 'Checked By',  name: authority.checked_by,  date: authority.checked_date,  sig: authority.checked_signature_url },
                { role: 'Approved By', name: authority.approved_by, date: authority.approved_date, sig: authority.approved_signature_url },
              ].filter(r => r.name).map(r => (
                <div key={r.role} style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <p style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8', margin: '0 0 0.5rem' }}>{r.role}</p>
                  {r.sig && <img src={r.sig} alt={r.role} style={{ height: '2rem', objectFit: 'contain', marginBottom: '0.5rem', display: 'block' }} />}
                  <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.15rem' }}>{r.name}</p>
                  {r.date && <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0 }}>{new Date(r.date).toLocaleDateString('en-GB')}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dark contractor footer */}
      {contractor && (contractor.company_name || contractor.telephone || contractor.email) && (
        <div style={{ background: brand.primary, padding: '0.9rem 3.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center', flex: '0 0 auto', paddingRight: '4rem' }}>
          {contractor.company_name && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'white' }}>{contractor.company_name}</span>}
          {contractor.address_line1 && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>{[contractor.address_line1, contractor.city, contractor.postcode].filter(Boolean).join(', ')}</span>}
          {contractor.telephone && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>Tel: {contractor.telephone}</span>}
          {contractor.email && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>{contractor.email}</span>}
          {contractor.nsi_number && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>NSI: {contractor.nsi_number}</span>}
          {contractor.ssaib_number && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>SSAIB: {contractor.ssaib_number}</span>}
          {contractor.company_reg_number && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.85)' }}>Reg: {contractor.company_reg_number}</span>}
        </div>
      )}
    </div>
  );
}

function PrintTechnicalDocsTable({ columns, rows, compact }: {
  columns: TechDocColumn[];
  rows: TechDocPrintRow[];
  compact?: boolean;
}) {
  const brand = useOmBrand();
  if (columns.length === 0) {
    return <p style={{ color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>No columns configured.</p>;
  }
  if (rows.length === 0) {
    return <p style={{ color: '#94a3b8', fontSize: '0.85rem', fontStyle: 'italic' }}>No technical documentation rows for this system.</p>;
  }
  const fontSize = compact ? '0.52rem' : '0.58rem';
  const headSize = compact ? '0.46rem' : '0.52rem';
  const pad = compact ? '0.28rem 0.32rem' : '0.32rem 0.4rem';
  return (
    <table style={{ width: '100%', tableLayout: 'fixed', fontSize, borderCollapse: 'collapse', border: '1px solid #d4d4d4' }}>
      <thead>
        <tr style={{ background: PACIFIC_LABEL_GREY }}>
          {columns.map(col => (
            <th key={col.key} style={{ textAlign: 'left', padding: pad, fontSize: headSize, fontWeight: 700, color: brand.ink, textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: `2px solid ${brand.primary}`, borderRight: '1px solid #ececec', wordBreak: 'break-word' }}>
              {col.display_name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
            {columns.map(col => (
              <td key={col.key} style={{ padding: pad, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                {techDocCell(row.data, col) || '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrintTechnicalDocs({ techDocState }: {
  techDocState: Partial<Record<string, { rows: { id: number; row_index: number; data: Record<string, string> }[]; colConfig: { key: string; display_name: string; visible: boolean; order: number }[] }>>;
}) {
  const brand = useOmBrand();
  const systemsWithData = Object.keys(techDocState)
    .filter(name => (techDocState[name]?.rows.length ?? 0) > 0)
    .sort((a, b) => a.localeCompare(b));
  return (
    <div>
      {systemsWithData.map(sys => {
        const state = techDocState[sys]!;
        const visibleCols = state.colConfig.filter(c => c.visible).sort((a, b) => a.order - b.order);
        if (visibleCols.length === 0) return null;
        return (
          <div key={sys} style={{ marginBottom: '2rem' }}>
            <div style={{ background: brand.primary, padding: '0.5rem 0.75rem', borderRadius: '0.375rem 0.375rem 0 0' }}>
              <h3 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'white', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                {sys}
              </h3>
            </div>
            <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', border: '1px solid #e2e8f0' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {visibleCols.map(col => (
                    <th key={col.key} style={{ textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid #e2e8f0', borderRight: '1px solid #f1f5f9' }}>
                      {col.display_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row, i) => (
                  <tr key={row.id} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                    {visibleCols.map(col => (
                      <td key={col.key} style={{ padding: '0.45rem 0.6rem', fontFamily: 'monospace', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>
                        {row.data[col.key] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function PrintTechnicalDocsLegacy({ devices }: { devices: DeviceWithDatasheet[] }) {
  const fields: { key: keyof DeviceWithDatasheet; label: string }[] = [
    { key: 'ip_address',        label: 'IP Address' },
    { key: 'mac_address',       label: 'MAC Address' },
    { key: 'firmware_version',  label: 'Firmware' },
    { key: 'username_hint',     label: 'Username' },
    { key: 'password_hint',     label: 'Password' },
    { key: 'controller_address',label: 'Controller' },
    { key: 'vlan',              label: 'VLAN' },
    { key: 'network_zone',      label: 'Network Zone' },
  ];
  const usedFields = fields.filter(f => devices.some(d => d[f.key]));
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr>
          <th className="text-left py-2 pr-4 border-b border-slate-300 font-semibold text-slate-800">Device</th>
          {usedFields.map(f => (
            <th key={f.key} className="text-left py-2 pr-4 border-b border-slate-300 font-semibold text-slate-800">{f.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {devices.map(d => (
          <tr key={d.id} className="border-b border-slate-100">
            <td className="py-2 pr-4 font-medium text-slate-900">{d.device_name || '-'}</td>
            {usedFields.map(f => (
              <td key={f.key} className="py-2 pr-4 font-mono text-xs text-slate-700">{String(d[f.key] ?? '') || '-'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PrintProtectedTechDocNotice({ title, hasFilePassword }: { title: string; hasFilePassword?: boolean }) {
  const brand = useOmBrand();
  return (
    <div style={{ border: `1px solid ${PACIFIC_LABEL_GREY}`, borderRadius: '0.5rem', padding: '1.1rem 1.2rem' }}>
      <p style={{ fontSize: '1rem', fontWeight: 700, color: brand.ink, margin: '0 0 0.35rem' }}>{title}</p>
      <p style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: brand.primary, margin: '0 0 0.85rem' }}>
        Password Protected
      </p>
      <p style={{ fontSize: '0.9rem', color: '#58595B', lineHeight: 1.55, margin: 0 }}>
        {hasFilePassword
          ? `This document is password-protected. Enter the password issued by ${brand.name} to view or download it from the Client Portal. Please contact ${brand.name} if you are unable to access the document.`
          : PROTECTED_DOC_NOTICE}
      </p>
    </div>
  );
}

function PrintSection({ title, subtitle, anchorId, forcePageBreak, landscape, children }: {
  title: string;
  subtitle?: string;
  anchorId?: string;
  forcePageBreak?: boolean;
  landscape?: boolean;
  children: React.ReactNode;
}) {
  const brand = useOmBrand();
  const breakBefore = (anchorId || forcePageBreak) ? 'always' : 'auto';
  return (
    <div
      className={`om-section${landscape ? ' om-print-landscape' : ''}`}
      id={anchorId}
      data-print-orientation={landscape ? 'landscape' : 'portrait'}
      style={{
        padding: landscape ? '1.5rem 1.35rem 1.1rem' : '2.25rem 3rem 2rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        pageBreakBefore: breakBefore,
        breakBefore,
        color: brand.ink,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.35rem' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: brand.primary }}>
          {brand.name}
        </span>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#737373', textAlign: 'right' }}>
          Operations &amp; Maintenance Manual
        </span>
      </div>
      <div style={{ borderBottom: `3px solid ${brand.primary}`, marginBottom: landscape ? '0.9rem' : '1.35rem', paddingBottom: '0.55rem' }}>
        <h2 style={{ fontSize: landscape ? '1.15rem' : '1.45rem', fontWeight: 800, color: brand.ink, margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: '0.8rem', color: '#58595B', margin: '0.3rem 0 0' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function PrintDeviceTable({ system, devices }: { system: SystemType; devices: DeviceWithDatasheet[] }) {
  const equipmentGroups = groupDevices(devices);
  const brand = useOmBrand();
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ background: brand.primary, padding: '0.5rem 0.75rem', borderRadius: '0.375rem 0.375rem 0 0', marginBottom: 0 }}>
        <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'white', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
          {system} <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 400 }}>— {devices.length} device{devices.length !== 1 ? 's' : ''}</span>
        </h3>
      </div>
      <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse', border: '1px solid #e2e8f0' }}>
        <thead>
          <tr style={{ background: PACIFIC_LABEL_GREY }}>
            {['Description', 'Manufacturer', 'Model', 'Qty', 'Location', 'Warranty'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.6rem', fontWeight: 700, color: brand.ink, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `2px solid ${brand.primary}`, borderRight: '1px solid #f1f5f9' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {equipmentGroups.map((row, i) => (
            <tr key={scheduleGroupKey(row)} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc', pageBreakInside: 'avoid' }}>
              <td style={{ padding: '0.45rem 0.6rem', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{row.description || '—'}</td>
              <td style={{ padding: '0.45rem 0.6rem', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{row.manufacturer || '—'}</td>
              <td style={{ padding: '0.45rem 0.6rem', fontFamily: 'monospace', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{row.model_number || '—'}</td>
              <td style={{ padding: '0.45rem 0.6rem', fontWeight: 700, color: '#0f172a', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{row.quantity}</td>
              <td style={{ padding: '0.45rem 0.6rem', color: '#334155', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>{groupedScheduleLocation(row.devices as DeviceWithDatasheet[])}</td>
              <td style={{ padding: '0.45rem 0.6rem', color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{groupedScheduleWarranty(row.devices as DeviceWithDatasheet[])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrintDatasheets({ groups, pageImages }: {
  groups: { system: SystemType; devices: DeviceWithDatasheet[] }[];
  pageImages: Record<string, PdfRenderState>;
}) {
  const seen = new Set<string>();
  const unique: { system: SystemType; d: DeviceWithDatasheet }[] = [];
  for (const g of groups) {
    for (const d of g.devices) {
      if (!d.datasheet?.datasheet_url) continue;
      const key = `${d.manufacturer?.trim().toLowerCase()}|${d.model_number?.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ system: g.system, d });
    }
  }

  return (
    <div>
      {unique.map(({ system, d }) => {
        const url = d.datasheet!.datasheet_url;
        const rendered = pageImages[url];
        const label = [d.manufacturer, d.model_number].filter(Boolean).join(' ');
        return (
          <div key={`${system}-${url}`} style={{ marginBottom: '2rem' }}>
            <div style={{ background: '#0f172a', padding: '0.4rem 0.75rem', borderRadius: '0.375rem 0.375rem 0 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <p style={{ fontWeight: 700, color: 'white', margin: 0, fontSize: '0.75rem' }}>{label || d.file_name}</p>
              <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 400 }}>{system}</span>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', padding: '0.5rem' }}>
              {rendered?.failed ? (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '1rem', textAlign: 'center' as const, color: '#64748b', fontSize: '0.8rem' }}>
                  <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Could not render datasheet PDF</p>
                  <p style={{ fontSize: '0.7rem', color: '#94a3b8', wordBreak: 'break-all' as const }}>{url}</p>
                </div>
              ) : rendered?.pages.length ? (
                <div>
                  {rendered.pages.map((src, i) => (
                    <img key={i} src={src} alt={`${label} page ${i + 1}`} style={{ width: '100%', display: 'block', pageBreakInside: 'avoid' }} />
                  ))}
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '1rem', textAlign: 'center' as const, color: '#64748b', fontSize: '0.8rem' }}>
                  <p>Datasheet not yet rendered — wait for “Preparing PDFs for print” to finish</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
