import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from './supabase';
import {
  accessControlOmSchemaFor,
  looksLikeOmAccessControlForm,
} from './accessControlOmHandover';
import type { CompletionReviewFlag, CompletionSection, CompletionTemplateSchema } from './completionFormTypes';

type PageImage = { media_type: string; data: string };

function isZipDocx(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isLegacyDoc(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function isWordFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.docx')
    || name.endsWith('.doc')
    || file.type.includes('wordprocessingml')
    || file.type === 'application/msword';
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

async function extractPdf(file: File): Promise<{ text: string; images: PageImage[]; pageCount: number }> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const parts: string[] = [];
  const images: PageImage[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const rows = content.items
      .filter((item): item is { str: string; transform: number[] } => typeof item === 'object' && item !== null && 'str' in item)
      .map(item => ({
        str: String(item.str ?? ''),
        x: Number(item.transform?.[4] ?? 0),
        y: Number(item.transform?.[5] ?? 0),
      }))
      .filter(item => item.str.trim());
    rows.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lines: string[] = [];
    let line: string[] = [];
    let lastY: number | null = null;
    for (const row of rows) {
      if (lastY != null && Math.abs(lastY - row.y) > 5) {
        lines.push(line.join(' ').trim());
        line = [];
      }
      line.push(row.str);
      lastY = row.y;
    }
    if (line.length) lines.push(line.join(' ').trim());
    parts.push(`--- Page ${i} of ${pdf.numPages} ---\n${lines.filter(Boolean).join('\n')}`);
  }
  const text = parts.join('\n\n');
  const sparse = text.replace(/--- Page \d+ of \d+ ---/g, '').replace(/\s+/g, '').length < 800;
  if (sparse) {
    const imageLimit = Math.min(pdf.numPages, 16);
    for (let i = 1; i <= imageLimit; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.05 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.62);
      const data = dataUrl.split(',')[1];
      if (data) images.push({ media_type: 'image/jpeg', data });
    }
  }
  return { text, images, pageCount: pdf.numPages };
}

async function extractWordText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if ((file.name.toLowerCase().endsWith('.doc') || file.type === 'application/msword') && !isZipDocx(bytes) && isLegacyDoc(bytes)) {
    throw new Error('Older Word .doc files are not supported. Save as .docx or PDF and try again.');
  }
  const mammothModule = await import('mammoth') as unknown as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    default?: { extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
  };
  const mammoth = mammothModule.default ?? mammothModule;
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value?.trim() ?? '';
}

async function fileToImage(file: File): Promise<PageImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('That picture could not be read.');
  return { media_type: match[1], data: match[2] };
}

export async function extractCompletionTemplateFromFile(opts: {
  file: File;
  systemType: string;
  existingTitle?: string;
  existingKey?: string;
}): Promise<{ title: string; statusNotice: string; sections: CompletionSection[]; reviewFlags: CompletionReviewFlag[] }> {
  let text = '';
  let images: PageImage[] = [];
  let pageCount = 0;
  if (isPdfFile(opts.file)) {
    const extracted = await extractPdf(opts.file);
    text = extracted.text;
    images = extracted.images;
    pageCount = extracted.pageCount;
  } else if (isWordFile(opts.file)) {
    text = await extractWordText(opts.file);
  } else if (isImageFile(opts.file)) {
    images = [await fileToImage(opts.file)];
  } else {
    throw new Error('Upload a PDF, Word (.docx) file or a picture of the form.');
  }
  if (!text.trim() && images.length === 0) {
    throw new Error('No readable content was found in that file.');
  }

  if (looksLikeOmAccessControlForm(opts.file.name, text)) {
    const builtIn = accessControlOmSchemaFor(opts.existingKey || 'access_control_om_handover', opts.existingTitle);
    return {
      title: builtIn.title,
      statusNotice: builtIn.statusNotice,
      sections: builtIn.sections,
      reviewFlags: builtIn.reviewFlags,
    };
  }

  const { data, error } = await supabase.functions.invoke('extract-form-template', {
    body: {
      text,
      file_name: opts.file.name,
      system_type: opts.systemType,
      existing_title: opts.existingTitle ?? '',
      page_count: pageCount || undefined,
      images,
    },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));
  if (!Array.isArray(data?.sections) || data.sections.length === 0) {
    throw new Error('The AI could not read a usable form from that file.');
  }
  const extracted = {
    title: String(data.title ?? opts.existingTitle ?? opts.file.name),
    statusNotice: String(data.statusNotice ?? 'Company form. This is not an official certificate.'),
    sections: data.sections as CompletionSection[],
    reviewFlags: Array.isArray(data.reviewFlags) ? data.reviewFlags as CompletionReviewFlag[] : [],
  };
  return extracted;
}

export function applyExtractedTemplate(
  current: CompletionTemplateSchema,
  extracted: { title: string; statusNotice: string; sections: CompletionSection[]; reviewFlags: CompletionReviewFlag[] },
): CompletionTemplateSchema {
  return {
    ...current,
    title: extracted.title || current.title,
    statusNotice: extracted.statusNotice || current.statusNotice,
    sections: extracted.sections,
    reviewFlags: extracted.reviewFlags ?? [],
  };
}
