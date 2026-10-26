import { supabase } from '../supabase';
import { reconcileDeviceLines, type ExtractedDeviceLine } from './reconcile';
import type { AiExtractPayload, AiExtractedDevice, AiSourcePage, EvidenceClass, QuantityBasis, ViewKind } from './types';
import { verifyExtractedEvidence } from './verifyEvidence';

function asBasis(value: string | null | undefined): QuantityBasis {
  if (value === 'stated' || value === 'counted') return value;
  return 'unknown';
}

function asClass(value: string | null | undefined): EvidenceClass {
  if (value === 'quoted' || value === 'proposed' || value === 'installed') return value;
  return 'unknown';
}

function asView(value: string | null | undefined): ViewKind {
  if (value === 'overview' || value === 'detail' || value === 'schedule' || value === 'legend' || value === 'revision') {
    return value;
  }
  return 'unknown';
}

function classFromLabel(label: string): EvidenceClass {
  if (/quote/i.test(label)) return 'quoted';
  if (/drawing|proposal|design|spec/i.test(label)) return 'proposed';
  return 'unknown';
}

function batches(pages: AiSourcePage[]): AiSourcePage[][] {
  const groups: AiSourcePage[][] = [];
  let current: AiSourcePage[] = [];
  let images = 0;
  let chars = 0;
  for (const page of pages) {
    const image = page.imageBase64 ? 1 : 0;
    const overflow = current.length > 0 && (images + image > 2 || current.length >= 4 || chars + page.text.length > 24000);
    if (overflow) {
      groups.push(current);
      current = [];
      images = 0;
      chars = 0;
    }
    current.push(page);
    images += image;
    chars += page.text.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function firstText(current: string | null | undefined, next: string | null | undefined): string | null {
  const left = current?.trim();
  if (left) return left;
  const right = next?.trim();
  return right || null;
}

function mergePayloads(parts: AiExtractPayload[]): AiExtractPayload {
  const merged: AiExtractPayload = { devices: [], sections: [], missing: [], warnings: [], drawing_references: [], system_types: [] };
  for (const part of parts) {
    merged.project_name = firstText(merged.project_name, part.project_name);
    merged.client_name = firstText(merged.client_name, part.client_name);
    merged.site_name = firstText(merged.site_name, part.site_name);
    merged.site_address = firstText(merged.site_address, part.site_address);
    merged.job_number = firstText(merged.job_number, part.job_number);
    merged.quote_number = firstText(merged.quote_number, part.quote_number);
    merged.project_number = firstText(merged.project_number, part.project_number);
    merged.project_manager = firstText(merged.project_manager, part.project_manager);
    merged.engineer = firstText(merged.engineer, part.engineer);
    merged.project_notes = firstText(merged.project_notes, part.project_notes);
    merged.scope_of_works = firstText(merged.scope_of_works, part.scope_of_works);
    merged.system_types = [...new Set([...(merged.system_types ?? []), ...(part.system_types ?? [])])];
    merged.drawing_references = [...new Set([...(merged.drawing_references ?? []), ...(part.drawing_references ?? [])])];
    merged.devices = [...(merged.devices ?? []), ...(part.devices ?? [])];
    merged.sections = [...(merged.sections ?? []), ...(part.sections ?? [])];
    merged.missing = [...new Set([...(merged.missing ?? []), ...(part.missing ?? [])])];
    merged.warnings = [...(merged.warnings ?? []), ...(part.warnings ?? [])];
  }
  return merged;
}

function toLine(device: AiExtractedDevice, page: AiSourcePage | undefined): ExtractedDeviceLine {
  const quantity = Number(device.quantity);
  let evidenceClass = asClass(device.evidence_class);
  if (evidenceClass === 'unknown') evidenceClass = classFromLabel(page?.label ?? device.source_file ?? '');
  if (evidenceClass === 'installed' && !/installed|as[- ]fitted/i.test(device.evidence_text ?? '')) {
    evidenceClass = 'proposed';
  }
  let basis = asBasis(device.quantity_basis);
  if (basis === 'unknown' && asView(device.view_kind) === 'schedule') basis = 'stated';
  return {
    systemType: device.system_type?.trim() || null,
    deviceType: device.device_type?.trim() || device.model_name?.trim() || null,
    manufacturer: device.manufacturer?.trim() || null,
    modelNumber: device.model_number?.trim() || null,
    modelName: device.model_name?.trim() || device.device_type?.trim() || null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
    location: device.location?.trim() || device.zone?.trim() || null,
    notes: device.notes?.trim() || null,
    quantityBasis: basis,
    evidenceClass,
    viewKind: asView(device.view_kind),
    sourceFile: device.source_file?.trim() || page?.fileName || null,
    sourcePage: device.source_page ?? page?.page ?? null,
    evidenceText: device.evidence_text?.trim() || null,
    confidence: typeof device.confidence === 'number' ? device.confidence : null,
  };
}

export async function extractAiPages(
  pages: AiSourcePage[],
  onProgress?: (message: string) => void,
): Promise<AiExtractPayload> {
  if (pages.length === 0) throw new Error('No pages could be read from the upload.');
  const { data: auth } = await supabase.auth.getSession();
  const token = auth.session?.access_token;
  if (!token) throw new Error('Sign in required.');

  const groups = batches(pages);
  const parts: AiExtractPayload[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const first = group[0];
    const last = group[group.length - 1];
    onProgress?.(`Extracting ${first.fileName}, pages ${first.page}–${last.page} (${index + 1} of ${groups.length})`);
    const { data, error } = await supabase.functions.invoke('extract-project', {
      body: {
        pages: group.map(page => ({
          file_name: page.fileName,
          label: page.label,
          page: page.page,
          text: page.text,
          image_base64: page.imageBase64,
          media_type: page.mediaType,
        })),
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) throw new Error(error.message);
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      throw new Error(String(data.error));
    }
    parts.push((data ?? {}) as AiExtractPayload);
  }

  const merged = mergePayloads(parts);
  const verified = verifyExtractedEvidence(merged, pages.map(page => page.text).join('\n'));
  const pageByKey = new Map(pages.map(page => [`${page.fileName}:${page.page}`, page]));
  const lines = (verified.devices ?? []).map(device => {
    const page = pageByKey.get(`${device.source_file ?? ''}:${device.source_page ?? ''}`);
    return toLine(device, page);
  });
  const reconciled = reconcileDeviceLines(lines);
  verified.devices = reconciled.devices.map(device => ({
    system_type: device.systemType,
    device_type: device.deviceType,
    manufacturer: device.manufacturer,
    model_number: device.modelNumber,
    model_name: device.modelName,
    quantity: device.quantity,
    location: device.location,
    notes: device.conflict ? [device.notes, device.conflict].filter(Boolean).join(' ') : device.notes,
    quantity_basis: device.quantityBasis,
    evidence_class: device.evidenceClass,
    view_kind: device.viewKind,
    source_file: device.sourceFile,
    source_page: device.sourcePage,
    evidence_text: device.evidenceText,
    confidence: device.confidence,
    conflict: device.conflict,
  }));
  verified.warnings = [...(verified.warnings ?? []), ...reconciled.issues];
  onProgress?.('Preparing the review');
  return verified;
}
