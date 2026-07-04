import {
  resolveManufacturerFromProductDatabase,
  resolveManufacturerFromAi,
  type ManufacturerResolverInput,
  type ManufacturerSuggestion,
} from './manufacturerSuggestion';
import type { ProductModelLike } from '../integrations/core/productMatching';
import type { ProductModel } from '../types';
import { normalizePart, normalizeToken } from './equipmentMatchUtils';
import { saveProductModelPairIfNew } from './productModelPairing';

export const AUTO_MANUFACTURER_THRESHOLD = 0.8;

const PENDING_TAG = '[oandm:mfr-pending:';
const AUTO_TAG = '[oandm:mfr-auto:';

export interface PendingManufacturerSuggestion {
  manufacturer: string;
  confidence: number;
  reason: string;
  source: 'product_database' | 'ai';
}

export interface DeviceRowForManufacturerLookup {
  manufacturer?: string | null;
  model_number?: string | null;
  model_name?: string | null;
  device_type?: string | null;
  notes?: string | null;
  ai_confidence?: number | null;
  matched?: boolean;
  part_number?: string | null;
  source_document?: string | null;
}

export interface ManufacturerLookupLogEntry {
  action: 'applied' | 'pending' | 'skipped';
  groupKey: string;
  modelNumber: string | null;
  manufacturer: string | null;
  confidence: number | null;
  reason: string;
  source: 'product_database' | 'ai' | 'none';
  rowCount: number;
  context?: string;
}

function encodeTagPayload(payload: PendingManufacturerSuggestion): string {
  return encodeURIComponent(JSON.stringify(payload));
}

function decodeTagPayload(encoded: string): PendingManufacturerSuggestion | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as PendingManufacturerSuggestion;
    if (!parsed?.manufacturer?.trim()) return null;
    return {
      manufacturer: parsed.manufacturer.trim(),
      confidence: Number(parsed.confidence) || 0,
      reason: String(parsed.reason ?? ''),
      source: parsed.source === 'ai' ? 'ai' : 'product_database',
    };
  } catch {
    return null;
  }
}

export function stripManufacturerLookupNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const cleaned = notes
    .replace(/\[oandm:mfr-pending:[^\]]+\]/g, '')
    .replace(/\[oandm:mfr-auto:[^\]]+\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || null;
}

export function extractPendingManufacturerSuggestion(
  notes: string | null | undefined,
): PendingManufacturerSuggestion | null {
  if (!notes) return null;
  const start = notes.indexOf(PENDING_TAG);
  if (start < 0) return null;
  const from = start + PENDING_TAG.length;
  const end = notes.indexOf(']', from);
  if (end < 0) return null;
  return decodeTagPayload(notes.slice(from, end));
}

function appendAutoManufacturerNote(
  notes: string | null | undefined,
  payload: PendingManufacturerSuggestion,
): string {
  const cleaned = stripManufacturerLookupNotes(notes);
  const tag = `${AUTO_TAG}${encodeTagPayload(payload)}]`;
  return cleaned ? `${cleaned} ${tag}` : tag;
}

function appendPendingManufacturerNote(
  notes: string | null | undefined,
  payload: PendingManufacturerSuggestion,
): string {
  const cleaned = stripManufacturerLookupNotes(notes);
  const tag = `${PENDING_TAG}${encodeTagPayload(payload)}]`;
  return cleaned ? `${cleaned} ${tag}` : tag;
}

/** Normalized model/part key — identical models share one lookup result. */
export function buildManufacturerGroupKey(row: DeviceRowForManufacturerLookup): string {
  const model =
    normalizePart(row.model_number) ||
    normalizePart(row.model_name) ||
    normalizePart(row.part_number);
  return model || '';
}

export function toManufacturerResolverInput(row: DeviceRowForManufacturerLookup): ManufacturerResolverInput {
  const descriptionParts = [
    row.device_type,
    row.model_name,
    row.source_document,
    row.notes ? stripManufacturerLookupNotes(row.notes) : null,
  ].filter(Boolean);

  return {
    description: descriptionParts.join(' · ') || null,
    modelNumber: row.model_number ?? row.model_name ?? row.part_number ?? null,
    deviceType: row.device_type ?? null,
  };
}

function suggestionToPending(suggestion: ManufacturerSuggestion): PendingManufacturerSuggestion {
  return {
    manufacturer: suggestion.manufacturer,
    confidence: suggestion.confidence ?? 0,
    reason: suggestion.reason,
    source: suggestion.source,
  };
}

function manufacturersMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left?.trim().toLowerCase() ?? '') === (right?.trim().toLowerCase() ?? '');
}

function logManufacturerLookup(entry: ManufacturerLookupLogEntry): void {
  console.info('[auto-manufacturer]', entry);
}

interface ProductPairingCandidate {
  manufacturer: string;
  modelNumber: string;
  deviceType: string | null;
}

function productPairingKey(manufacturer: string, modelNumber: string): string {
  return `${normalizeToken(manufacturer)}::${normalizePart(modelNumber)}`;
}

function pickPartNumberForProductDatabase(row: DeviceRowForManufacturerLookup): string | null {
  return row.model_number?.trim() || row.part_number?.trim() || null;
}

/** Persist manufacturer + part number pairs to product_models for future imports. */
export async function persistManufacturerPairingsToProductDatabase(
  candidates: ProductPairingCandidate[],
  existingProducts: ProductModel[],
): Promise<number> {
  const seen = new Set<string>();
  let catalog = [...existingProducts];
  let created = 0;

  for (const candidate of candidates) {
    const manufacturer = candidate.manufacturer.trim();
    const modelNumber = candidate.modelNumber.trim();
    if (!manufacturer || !modelNumber) continue;

    const key = productPairingKey(manufacturer, modelNumber);
    if (seen.has(key)) continue;
    seen.add(key);

    const result = await saveProductModelPairIfNew(
      manufacturer,
      modelNumber,
      candidate.deviceType,
      catalog,
    );
    if ('error' in result) {
      console.warn('[auto-manufacturer] Product Database save failed:', result.error);
      continue;
    }
    if (result.created) {
      created += 1;
      catalog.push(result.product);
    }
  }

  if (created > 0) {
    console.info('[auto-manufacturer] Saved new Product Database pairings', { created });
  }

  return created;
}

async function lookupManufacturerForGroup(
  input: ManufacturerResolverInput,
  products: ProductModelLike[],
  useAi: boolean,
): Promise<ManufacturerSuggestion | null> {
  const fromDatabase = resolveManufacturerFromProductDatabase(input, products);
  if (fromDatabase && (fromDatabase.confidence ?? 0) >= AUTO_MANUFACTURER_THRESHOLD) {
    return fromDatabase;
  }

  if (fromDatabase && !useAi) return fromDatabase;

  if (!useAi) return fromDatabase;

  if (!input.modelNumber?.trim()) return fromDatabase;

  const aiResult = await resolveManufacturerFromAi(input);
  if ('error' in aiResult) {
    console.warn('[auto-manufacturer] AI lookup failed:', aiResult.error);
    return fromDatabase;
  }

  if ((fromDatabase?.confidence ?? 0) >= (aiResult.confidence ?? 0)) {
    return fromDatabase;
  }

  return aiResult;
}

function applySuggestionToRows(
  groupRows: DeviceRowForManufacturerLookup[],
  suggestion: ManufacturerSuggestion,
): { applied: number; pending: number; skipped: number } {
  const confidence = suggestion.confidence ?? 0;
  const pendingPayload = suggestionToPending(suggestion);
  let applied = 0;
  let pending = 0;
  let skipped = 0;

  for (const row of groupRows) {
    const existing = row.manufacturer?.trim() ?? '';
    const sameAsSuggestion = manufacturersMatch(existing, suggestion.manufacturer);

    if (confidence >= AUTO_MANUFACTURER_THRESHOLD && (!existing || !sameAsSuggestion)) {
      row.manufacturer = suggestion.manufacturer;
      row.ai_confidence = confidence;
      if (suggestion.productId != null) row.matched = true;
      row.notes = appendAutoManufacturerNote(row.notes, pendingPayload);
      applied += 1;
      continue;
    }

    if (
      confidence > 0 &&
      confidence < AUTO_MANUFACTURER_THRESHOLD &&
      (!existing || !sameAsSuggestion)
    ) {
      row.notes = appendPendingManufacturerNote(row.notes, pendingPayload);
      pending += 1;
      continue;
    }

    skipped += 1;
  }

  return { applied, pending, skipped };
}

async function processManufacturerGroup(
  groupKey: string,
  groupRows: DeviceRowForManufacturerLookup[],
  products: ProductModelLike[],
  useAi: boolean,
  context: string | undefined,
  pairingCandidates: ProductPairingCandidate[],
): Promise<void> {
  const representative = groupRows[0];
  const input = toManufacturerResolverInput(representative);
  const suggestion = await lookupManufacturerForGroup(input, products, useAi);

  if (!suggestion) {
    logManufacturerLookup({
      action: 'skipped',
      groupKey,
      modelNumber: input.modelNumber,
      manufacturer: null,
      confidence: null,
      reason: 'No manufacturer match found.',
      source: 'none',
      rowCount: groupRows.length,
      context,
    });
    return;
  }

  const { applied, pending, skipped } = applySuggestionToRows(groupRows, suggestion);
  const action = applied > 0 ? 'applied' : pending > 0 ? 'pending' : 'skipped';

  logManufacturerLookup({
    action,
    groupKey,
    modelNumber: input.modelNumber,
    manufacturer: suggestion.manufacturer,
    confidence: suggestion.confidence,
    reason:
      action === 'applied'
        ? `Auto-applied at ${Math.round((suggestion.confidence ?? 0) * 100)}% confidence: ${suggestion.reason}`
        : action === 'pending'
          ? `Below ${Math.round(AUTO_MANUFACTURER_THRESHOLD * 100)}% threshold (${Math.round((suggestion.confidence ?? 0) * 100)}%): ${suggestion.reason}`
          : suggestion.reason,
    source: suggestion.source,
    rowCount: groupRows.length,
    context,
  });

  if (import.meta.env.DEV && skipped > 0) {
    console.info('[auto-manufacturer] rows unchanged in group', {
      groupKey,
      skipped,
      applied,
      pending,
    });
  }

  if (applied > 0) {
    const modelNumber = pickPartNumberForProductDatabase(representative);
    if (modelNumber) {
      pairingCandidates.push({
        manufacturer: suggestion.manufacturer,
        modelNumber,
        deviceType: representative.device_type ?? null,
      });
    }
  }
}

const GROUP_LOOKUP_CONCURRENCY = 5;

/**
 * Resolve manufacturer once per identical model key and apply to all matching rows.
 * Auto-applies when confidence >= 80%; otherwise stores a pending suggestion in notes.
 */
export async function enrichDeviceRowsWithAutoManufacturer(
  rows: DeviceRowForManufacturerLookup[],
  products: ProductModelLike[],
  options?: { useAi?: boolean; context?: string },
): Promise<void> {
  const useAi = options?.useAi ?? true;
  const context = options?.context;
  const groups = new Map<string, DeviceRowForManufacturerLookup[]>();
  const pairingCandidates: ProductPairingCandidate[] = [];

  for (const row of rows) {
    const key = buildManufacturerGroupKey(row);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const groupEntries = [...groups.entries()];
  for (let offset = 0; offset < groupEntries.length; offset += GROUP_LOOKUP_CONCURRENCY) {
    const batch = groupEntries.slice(offset, offset + GROUP_LOOKUP_CONCURRENCY);
    await Promise.all(
      batch.map(([groupKey, groupRows]) =>
        processManufacturerGroup(
          groupKey,
          groupRows,
          products,
          useAi,
          context,
          pairingCandidates,
        ),
      ),
    );
  }

  if (pairingCandidates.length > 0) {
    await persistManufacturerPairingsToProductDatabase(
      pairingCandidates,
      products as ProductModel[],
    );
  }
}

/** Single-row helper for manual add flows. */
export async function enrichDeviceWithAutoManufacturer(
  row: DeviceRowForManufacturerLookup,
  products: ProductModelLike[],
  options?: { useAi?: boolean; context?: string },
): Promise<void> {
  await enrichDeviceRowsWithAutoManufacturer([row], products, options);
}
