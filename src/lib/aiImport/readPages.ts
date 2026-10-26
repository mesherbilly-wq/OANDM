import type { PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
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
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.4, 1400 / Math.max(base.width, 1));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return jpegFromCanvas(canvas);
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
    const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
    let imageBase64: string | undefined;
    if (text.length < SPARSE_TEXT) {
      try {
        imageBase64 = await renderPdfPage(page);
      } catch {
        imageBase64 = undefined;
      }
    }
    pages.push({
      fileName: file.name,
      label,
      page: pageNumber,
      text,
      imageBase64,
      mediaType: imageBase64 ? 'image/jpeg' : undefined,
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
