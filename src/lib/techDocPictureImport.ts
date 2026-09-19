import { supabase } from './supabase';

export const TECH_DOC_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export interface TechDocExtractedTable {
  label: string;
  headers: string[];
  rows: Record<string, string>[];
}

export function isTechDocImageFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (ALLOWED_TYPES.has(file.type)) return true;
  return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp') || name.endsWith('.gif');
}

function mediaTypeForFile(file: File): string {
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fileToAiImagePayload(file: File): Promise<{ mediaType: string; imageBase64: string }> {
  const sourceType = mediaTypeForFile(file);
  if (!ALLOWED_TYPES.has(sourceType)) {
    throw new Error('Use a JPG, PNG or WebP picture of the schedule.');
  }

  const bitmap = await createImageBitmap(file);
  const maxEdge = 1800;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canSendOriginal = scale === 1 && file.size <= 3_500_000 && sourceType !== 'image/png';
  if (canSendOriginal) {
    return { mediaType: sourceType, imageBase64: arrayBufferToBase64(await file.arrayBuffer()) };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read that picture.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(next => next ? resolve(next) : reject(new Error('Could not prepare that picture.')), 'image/jpeg', 0.84);
  });
  return { mediaType: 'image/jpeg', imageBase64: arrayBufferToBase64(await blob.arrayBuffer()) };
}

export async function extractTechDocTableFromPicture(file: File): Promise<TechDocExtractedTable[]> {
  const { mediaType, imageBase64 } = await fileToAiImagePayload(file);
  const { data: { session } } = await supabase.auth.getSession();
  const authHeader = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};

  const { data, error } = await supabase.functions.invoke('extract-tech-doc-table', {
    body: { media_type: mediaType, image_base64: imageBase64 },
    headers: authHeader,
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));

  const tables = Array.isArray(data?.tables) ? data.tables : [data];
  const normalised = tables
    .map((table: { label?: string; headers?: string[]; rows?: Record<string, string>[] }, index: number) => ({
      label: table?.label?.trim() || `Table ${index + 1}`,
      headers: Array.isArray(table?.headers) ? table.headers : [],
      rows: Array.isArray(table?.rows) ? table.rows : [],
    }))
    .filter((table: TechDocExtractedTable) => table.headers.length > 0 && table.rows.length > 0);

  if (normalised.length === 0) {
    throw new Error('No table could be read from that picture. Try a clearer photo or upload a spreadsheet.');
  }
  return normalised;
}
