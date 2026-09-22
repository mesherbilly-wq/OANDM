import { supabase } from './supabase';
import type { SimproConnectionSession } from './simproConnectionSession';

export interface SimproJobAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function normalizeSimproAttachment(raw: unknown): SimproJobAttachment | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = pickString(record.ID, record.Id, record.id);
  const filename = pickString(record.Filename, record.FileName, record.filename, record.Name);
  if (!id || !filename) return null;
  return {
    id,
    filename,
    mimeType: pickString(record.MimeType, record.mimeType, record.ContentType),
    sizeBytes: pickNumber(record.FileSizeBytes, record.SizeBytes, record.size, record.FileSize),
  };
}

function connectionBody(connection: SimproConnectionSession) {
  return {
    base_url: connection.baseUrl,
    company_id: connection.companyId,
    api_token: connection.apiToken,
  };
}

export async function listSimproJobAttachments(
  connection: SimproConnectionSession,
  jobId: string,
): Promise<{ attachments: SimproJobAttachment[]; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('simpro-proxy', {
    body: {
      action: 'list_job_attachments',
      job_id: jobId,
      ...connectionBody(connection),
    },
  });
  if (error) return { attachments: [], error: error.message };
  if (data?.error) return { attachments: [], error: String(data.error) };
  if (!data?.ok) return { attachments: [], error: 'Could not list Simpro job attachments.' };

  const attachments = (Array.isArray(data.attachments) ? data.attachments : [])
    .map(normalizeSimproAttachment)
    .filter((item): item is SimproJobAttachment => !!item);

  return { attachments, error: null };
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const cleaned = value.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function downloadSimproJobAttachment(
  connection: SimproConnectionSession,
  jobId: string,
  attachment: SimproJobAttachment,
): Promise<{ file: File; error: string | null }> {
  if (attachment.sizeBytes != null && attachment.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { file: new File([], attachment.filename), error: `${attachment.filename} is larger than 25 MB.` };
  }

  const { data, error } = await supabase.functions.invoke('simpro-proxy', {
    body: {
      action: 'get_job_attachment',
      job_id: jobId,
      file_id: attachment.id,
      ...connectionBody(connection),
    },
  });
  if (error) return { file: new File([], attachment.filename), error: error.message };
  if (data?.error) return { file: new File([], attachment.filename), error: String(data.error) };
  if (!data?.ok) return { file: new File([], attachment.filename), error: `Could not download ${attachment.filename}.` };

  const record = asRecord(data.file);
  const base64 = pickString(
    record?.Base64Data,
    record?.base64Data,
    record?.Base64,
    record?.Data,
    record?.File,
  );
  if (!base64) {
    return { file: new File([], attachment.filename), error: `${attachment.filename} did not include file data.` };
  }

  const bytes = decodeBase64ToBytes(base64);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return { file: new File([], attachment.filename), error: `${attachment.filename} is larger than 25 MB.` };
  }

  const filename = pickString(record?.Filename, record?.FileName, attachment.filename) || attachment.filename;
  const mime = pickString(record?.MimeType, attachment.mimeType) || 'application/octet-stream';
  return {
    file: new File([bytes], filename, { type: mime }),
    error: null,
  };
}
