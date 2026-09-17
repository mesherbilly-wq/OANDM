import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

interface PdfRun {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isZipDocx(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isLegacyDoc(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function styledParagraph(text: string, fontSize: number, bold: boolean): string {
  const size = Math.max(8, Math.round(fontSize));
  const heading = bold && text.length <= 80 && !/[.!?]$/.test(text);
  const weight = bold || heading ? 700 : 400;
  const tag = heading && size >= 16 ? 'h2' : heading && size >= 13 ? 'h3' : 'p';
  return `<${tag} style="font-size:${size}pt;font-weight:${weight}">${escapeHtml(text)}</${tag}>`;
}

function groupPdfLines(runs: PdfRun[]): PdfRun[][] {
  if (runs.length === 0) return [];
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfRun[][] = [];
  let current: PdfRun[] = [sorted[0]];
  let lastY = sorted[0].y;

  for (const run of sorted.slice(1)) {
    const tolerance = Math.max(3, Math.min(run.fontSize, current[0].fontSize) * 0.45);
    if (Math.abs(run.y - lastY) <= tolerance) {
      current.push(run);
    } else {
      lines.push(current.sort((a, b) => a.x - b.x));
      current = [run];
      lastY = run.y;
    }
  }
  lines.push(current.sort((a, b) => a.x - b.x));
  return lines;
}

function mergeLineText(line: PdfRun[]): string {
  return line
    .map(run => run.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineCells(line: PdfRun[]): string[] {
  if (line.length === 0) return [];
  const cells: string[] = [];
  let current = line[0].text;
  let prev = line[0];

  for (const run of line.slice(1)) {
    const gap = run.x - (prev.x + prev.width);
    if (gap > Math.max(14, prev.fontSize * 1.4)) {
      cells.push(current.replace(/\s+/g, ' ').trim());
      current = run.text;
    } else {
      const space = gap > prev.fontSize * 0.15 ? ' ' : '';
      current += space + run.text;
    }
    prev = run;
  }
  cells.push(current.replace(/\s+/g, ' ').trim());
  return cells.filter(Boolean);
}

function lineToHtml(line: PdfRun[]): string {
  const cells = lineCells(line);
  if (cells.length >= 3) {
    const cellsHtml = cells.map(cell => `<td>${escapeHtml(cell)}</td>`).join('');
    return `<tr>${cellsHtml}</tr>`;
  }
  const text = mergeLineText(line);
  if (!text) return '';
  const fontSize = line.reduce((max, run) => Math.max(max, run.fontSize), 11);
  const bold = line.some(run => run.bold) || (fontSize >= 13 && text.length <= 80);
  return styledParagraph(text, fontSize, bold);
}

function wrapPdfTables(htmlParts: string[]): string {
  const out: string[] = [];
  let tableRows: string[] = [];

  const flush = () => {
    if (tableRows.length === 0) return;
    out.push(`<table>${tableRows.join('')}</table>`);
    tableRows = [];
  };

  for (const part of htmlParts) {
    if (part.startsWith('<tr>')) {
      tableRows.push(part);
    } else {
      flush();
      if (part) out.push(part);
    }
  }
  flush();
  return out.join('');
}

async function pdfFileToHtml(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const runs: PdfRun[] = [];

    for (const raw of content.items) {
      const item = raw as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
        fontName?: string;
      };
      const text = item.str?.replace(/\s+/g, ' ').trim();
      if (!text || !item.transform) continue;
      const fontSize = Math.abs(item.transform[3] || item.transform[0] || 11);
      runs.push({
        text,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: item.width ?? text.length * fontSize * 0.5,
        fontSize,
        bold: /bold|black|heavy|semibold/i.test(item.fontName ?? ''),
      });
    }

    const lineHtml = groupPdfLines(runs).map(lineToHtml).filter(Boolean);
    const pageHtml = wrapPdfTables(lineHtml);
    if (pageHtml) pages.push(pageHtml);
  }

  if (pages.length === 0) {
    throw new Error('No text could be read from that PDF.');
  }
  return pages.join('');
}

async function docxFileToHtml(buffer: ArrayBuffer): Promise<string> {
  const mammothModule = await import('mammoth') as unknown as {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    default?: { convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
  };
  const mammoth = mammothModule.default ?? mammothModule;
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  const html = result.value?.trim() ?? '';
  if (!html) {
    throw new Error('No text could be read from that Word document.');
  }
  return html;
}

export async function htmlFromScopeImportFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const type = file.type;

  if (name.endsWith('.pdf') || type === 'application/pdf') {
    return pdfFileToHtml(file);
  }

  if (name.endsWith('.docx') || type.includes('wordprocessingml') || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return docxFileToHtml(await file.arrayBuffer());
  }

  if (name.endsWith('.doc') || type === 'application/msword') {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (isZipDocx(bytes)) return docxFileToHtml(buffer);
    if (isLegacyDoc(bytes)) {
      throw new Error('Older Word .doc files are not supported. Save as .docx or PDF and import again.');
    }
    return new TextDecoder().decode(buffer);
  }

  if (name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.txt') || type.startsWith('text/')) {
    return file.text();
  }

  throw new Error('Use a PDF, Word (.docx), or HTML file.');
}
