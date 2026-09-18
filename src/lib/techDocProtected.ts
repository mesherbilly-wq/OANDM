import { supabase } from './supabase';

export const TECH_DOCS_PRIVATE_BUCKET = 'tech-docs-private';

export const PROTECTED_DOC_NOTICE =
  'This document contains protected information and is available securely via your Client Portal. Please contact Pacific if you are unable to access the document.';

export function missingProtectedColumns(error?: { message?: string } | null): boolean {
  return /is_protected|visible_in_portal|include_in_om|storage_path|storage_bucket|tech-docs-private/i.test(error?.message ?? '');
}

export function omUploadsPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/object\/(?:public|sign)\/om-uploads\/(.+?)(?:\?|$)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function uploadProtectedTechDoc(
  projectId: number,
  file: File,
): Promise<{ storage_path: string; file_name: string; file_size: number }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${projectId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from(TECH_DOCS_PRIVATE_BUCKET).upload(path, file, {
    upsert: false,
  });
  if (error) throw error;
  return { storage_path: path, file_name: file.name, file_size: file.size };
}

export async function signedTechDocUrl(
  storagePath: string,
  downloadName?: string | null,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(TECH_DOCS_PRIVATE_BUCKET).createSignedUrl(
    storagePath,
    60,
    downloadName ? { download: downloadName } : undefined,
  );
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function downloadProtectedTechDocBlob(storagePath: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(TECH_DOCS_PRIVATE_BUCKET).download(storagePath);
  if (error || !data) return null;
  return data;
}

export async function removeProtectedTechDoc(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return;
  await supabase.storage.from(TECH_DOCS_PRIVATE_BUCKET).remove([storagePath]);
}

export async function openProtectedTechDoc(opts: {
  id: number;
  storagePath?: string | null;
  fileName?: string | null;
}): Promise<string | null> {
  let path = opts.storagePath ?? null;
  let fileName = opts.fileName ?? null;
  if (!path) {
    const { data, error } = await supabase
      .from('tech_doc_documents')
      .select('storage_path, file_name')
      .eq('id', opts.id)
      .maybeSingle();
    if (error || !data?.storage_path) return null;
    path = data.storage_path;
    fileName = fileName || data.file_name;
  }
  const url = await signedTechDocUrl(path, fileName);
  if (!url) return null;
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.download = fileName || 'document';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return url;
}

export async function movePublicTechDocToPrivate(opts: {
  projectId: number;
  fileUrl: string | null;
  fileName: string | null;
}): Promise<{ storage_path: string; file_name: string; file_size: number } | null> {
  if (!opts.fileUrl) return null;
  const publicPath = omUploadsPath(opts.fileUrl);
  let blob: Blob | null = null;
  if (publicPath) {
    const { data } = await supabase.storage.from('om-uploads').download(publicPath);
    blob = data ?? null;
  }
  if (!blob) {
    try {
      const res = await fetch(opts.fileUrl);
      if (res.ok) blob = await res.blob();
    } catch {
      blob = null;
    }
  }
  if (!blob) return null;
  const stored = await uploadProtectedTechDoc(
    opts.projectId,
    new File([blob], opts.fileName || 'document'),
  );
  if (publicPath) await supabase.storage.from('om-uploads').remove([publicPath]);
  return stored;
}
