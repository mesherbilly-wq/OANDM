import type { PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { countCameraSymbols } from './countSymbols';
import { transcriptFromPdf, type PdfAnnotation, type PdfTextItem } from './resolveDrawing';
import type { AiSourcePage } from './types';

const SPARSE_TEXT = 80;

function isWordFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type;
  return name.endsWith('.docx')
    || name.endsWith('.doc')
    || type.includes('wordprocessingml')
    || type === 'application/msword';
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
}

async function fileToDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const mediaType = file.type || 'image/jpeg';
  return `data:${mediaType};base64,${btoa(binary)}`;
}

function jpegFromCanvas(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.62).replace(/^data:image\/jpeg;base64,/, '');
}

async function renderPdfPage(page: PDFPageProxy): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined;
  const canvas = await renderViewport(page, 1400);
  return canvas ? jpegFromCanvas(canvas) : undefined;
}

async function renderViewport(page: PDFPageProxy, longEdge: number): Promise<HTMLCanvasElement | null> {
  if (typeof document === 'undefined') return null;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.8, longEdge / Math.max(base.width, base.height, 1));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return canvas;
}

function cropCanvas(source: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): string | null {
  const sx = Math.round(x0 * source.width);
  const sy = Math.round(y0 * source.height);
  const sw = Math.max(1, Math.round((x1 - x0) * source.width));
  const sh = Math.max(1, Math.round((y1 - y0) * source.height));
  const tile = document.createElement('canvas');
  const fitted = Math.min(1, 1100 / Math.max(sw, sh));
  tile.width = Math.max(1, Math.round(sw * fitted));
  tile.height = Math.max(1, Math.round(sh * fitted));
  const context = tile.getContext('2d');
  if (!context) return null;
  context.drawImage(source, sx, sy, sw, sh, 0, 0, tile.width, tile.height);
  return jpegFromCanvas(tile);
}

/** Legend crop plus overlapping plan tiles. Coverage cones and the legend are still excluded by the symbol count. */
async function renderPlanCrops(page: PDFPageProxy): Promise<string[]> {
  const canvas = await renderViewport(page, 1800);
  if (!canvas) return [];
  const regions: [number, number, number, number][] = [
    [0.76, 0.32, 1, 0.84],
    [0.01, 0.05, 0.55, 0.52],
    [0.28, 0.22, 0.8, 0.68],
    [0.01, 0.42, 0.8, 0.82],
  ];
  return regions
    .map(region => cropCanvas(canvas, region[0], region[1], region[2], region[3]))
    .filter((crop): crop is string => Boolean(crop));
}

export async function readDocumentPages(
  file: File,
  label: string,
  onPage?: (message: string) => void,
): Promise<AiSourcePage[]> {
  if (isPdf(file)) return readPdfPages(file, label, onPage);
  if (isImage(file)) {
    onPage?.(`Reading image ${file.name}`);
    const dataUrl = await fileToDataUrl(file);
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    return [{
      fileName: file.name,
      label,
      page: 1,
      text: '',
      imageBase64: base64,
      mediaType: file.type || 'image/jpeg',
    }];
  }
  if (isWordFile(file)) {
    onPage?.(`Reading ${file.name}`);
    const text = await extractWordText(file);
    return [{ fileName: file.name, label, page: 1, text }];
  }
  onPage?.(`Reading ${file.name}`);
  return [{ fileName: file.name, label, page: 1, text: await file.text() }];
}

async function readPdfPages(
  file: File,
  label: string,
  onPage?: (message: string) => void,
): Promise<AiSourcePage[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: AiSourcePage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onPage?.(`Reading ${file.name}, page ${pageNumber} of ${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const annotations = await page.getAnnotations() as PdfAnnotation[];
    const text = transcriptFromPdf(content.items as PdfTextItem[], annotations);
    let symbolCount: AiSourcePage['symbolCount'] = null;
    try {
      symbolCount = await countCameraSymbols(page);
    } catch {
      symbolCount = null;
    }
    let imageBase64: string | undefined;
    let imageCrops: string[] | undefined;
    try {
      if (text.length < SPARSE_TEXT) imageBase64 = await renderPdfPage(page);
      const crops = await renderPlanCrops(page);
      imageCrops = crops.length > 0 ? crops : undefined;
    } catch {
      imageCrops = undefined;
    }
    pages.push({
      fileName: file.name,
      label,
      page: pageNumber,
      text,
      imageBase64,
      imageCrops,
      mediaType: imageBase64 || imageCrops ? 'image/jpeg' : undefined,
      symbolCount,
    });
  }
  return pages;
}

async function extractWordText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const legacyDoc = bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  const zip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if ((file.name.toLowerCase().endsWith('.doc') || file.type === 'application/msword') && legacyDoc && !zip) {
    throw new Error('Older Word .doc files are not supported. Save as .docx or PDF and import again.');
  }
  const mammothModule = await import('mammoth') as unknown as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    default?: { extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
  };
  const mammoth = mammothModule.default ?? mammothModule;
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = result.value?.trim() ?? '';
  if (!text) throw new Error(`No text could be read from ${file.name}.`);
  return text;
}
