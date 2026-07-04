import type { ImportEquipmentDraft, ImportReviewDraft, ImportReviewIssue } from '../integrations';
import { selectedSystems } from '../integrations/core/draftHelpers';
import type { ProductModel } from '../types';
import { normalizePart, normalizeToken, pickMetadataString } from './equipmentMatchUtils';
import {
  buildProductPartIndex,
  collectProductPartFields,
  extractPartLikeTokens,
  importPartNumbersExactMatch,
  type ProductLookupRecord,
  type ProductPartIndex,
} from './productLookupIndex';

export type RequiredEquipmentField = 'modelNumber' | 'modelName';

export const REQUIRED_EQUIPMENT_FIELD_LABELS: Record<RequiredEquipmentField, string> = {
  modelNumber: 'Part Number',
  modelName: 'Product Description',
};

export type ProductDatabaseLookupStatus =
  | 'matched_from_database'
  | 'ambiguous'
  | 'suggested'
  | 'dismissed'
  | 'unmatched';

export const MANUFACTURER_LOOKUP_STATUS_KEY = 'manufacturerLookupStatus';
export const MANUFACTURER_LOOKUP_MATCH_IDS_KEY = 'manufacturerLookupMatchIds';
export const MANUFACTURER_LOOKUP_PRODUCT_ID_KEY = 'manufacturerLookupProductId';
export const PRODUCT_DB_AUTOFILL_FIELDS_KEY = 'productDatabaseAutofillFields';

export interface ProductDatabaseEnrichmentSummary {
  equipmentLines: number;
  matchedLines: number;
  ambiguousLines: number;
  suggestedLines: number;
  unmatchedLines: number;
  filledFieldCount: number;
}

export interface ProductEnrichmentContext {
  products: ProductLookupRecord[];
  partIndex: ProductPartIndex;
}

export function createProductEnrichmentContext(products: ProductModel[]): ProductEnrichmentContext {
  const records = products as ProductLookupRecord[];
  return { products: records, partIndex: buildProductPartIndex(records) };
}

export function isImportReviewDraftEnrichedFromProductDatabase(draft: ImportReviewDraft): boolean {
  return draft.systems.some(system =>
    system.equipment.some(item => item.metadata?.[MANUFACTURER_LOOKUP_STATUS_KEY] != null),
  );
}

function equipmentRowLabel(item: ImportEquipmentDraft): string {
  return (
    item.modelName?.trim() ||
    item.deviceType?.trim() ||
    item.modelNumber?.trim() ||
    item.sourceLineRef ||
    item.draftId
  );
}

export function ensureProductDescriptionField(item: ImportEquipmentDraft): ImportEquipmentDraft {
  if (item.modelName?.trim()) return item;

  const costCentreDescription =
    typeof item.metadata?.simproCostCentreProductDescription === 'string'
      ? item.metadata.simproCostCentreProductDescription.trim()
      : '';
  if (costCentreDescription) {
    return { ...item, modelName: costCentreDescription };
  }

  const fallback = item.deviceType?.trim();
  if (!fallback) return item;
  return { ...item, modelName: fallback };
}

export function normalizeImportedEquipmentFields(item: ImportEquipmentDraft): ImportEquipmentDraft {
  return ensureProductDescriptionField(item);
}

function withDatabaseLookupMetadata(
  item: ImportEquipmentDraft,
  productId: number | null,
  status: ProductDatabaseLookupStatus,
  matchIds?: number[],
): ImportEquipmentDraft {
  const nextMetadata = { ...item.metadata, [MANUFACTURER_LOOKUP_STATUS_KEY]: status };

  if (productId != null) {
    nextMetadata[MANUFACTURER_LOOKUP_PRODUCT_ID_KEY] = productId;
  } else {
    delete nextMetadata[MANUFACTURER_LOOKUP_PRODUCT_ID_KEY];
  }

  if (matchIds?.length) {
    nextMetadata[MANUFACTURER_LOOKUP_MATCH_IDS_KEY] = matchIds;
  } else {
    delete nextMetadata[MANUFACTURER_LOOKUP_MATCH_IDS_KEY];
  }

  return { ...item, metadata: nextMetadata };
}

function collectPrimaryPartCandidates(item: ImportEquipmentDraft): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = normalizePart(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };

  push(item.modelNumber);
  push(pickMetadataString(item.metadata, 'simproPartNo'));
  push(pickMetadataString(item.metadata, 'simproCatalogNo'));
  push(pickMetadataString(item.metadata, 'simproStockNo'));

  return candidates;
}

function collectPartNumberCandidates(item: ImportEquipmentDraft): string[] {
  const candidates = collectPrimaryPartCandidates(item);
  const seen = new Set(candidates.map(value => normalizePart(value)));

  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = normalizePart(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };

  for (const token of extractPartLikeTokens(item.modelName ?? '')) push(token);
  for (const token of extractPartLikeTokens(item.deviceType ?? '')) push(token);
  for (const token of extractPartLikeTokens(item.modelNumber ?? '')) push(token);

  return candidates;
}

function findExactProductsByCandidates(
  candidates: string[],
  partIndex: ProductPartIndex,
): ProductLookupRecord[] {
  const byId = new Map<number, ProductLookupRecord>();

  for (const candidate of candidates) {
    for (const product of partIndex.findByPartNumber(candidate)) {
      const isExact = collectProductPartFields(product).some(field =>
        importPartNumbersExactMatch(candidate, field),
      );
      if (isExact) byId.set(product.id, product);
    }
  }

  return [...byId.values()];
}

function findSuggestedProductsByCandidates(
  candidates: string[],
  partIndex: ProductPartIndex,
): ProductLookupRecord[] {
  const byId = new Map<number, ProductLookupRecord>();

  for (const candidate of candidates) {
    for (const product of partIndex.findSuggestedByPartNumber(candidate)) {
      byId.set(product.id, product);
    }
  }

  return [...byId.values()];
}

function resolveSingleExactMatch(
  item: ImportEquipmentDraft,
  matches: ProductLookupRecord[],
): { product: ProductLookupRecord | null; ambiguous: boolean } {
  if (matches.length === 0) return { product: null, ambiguous: false };
  if (matches.length === 1) return { product: matches[0], ambiguous: false };

  const manufacturer = item.manufacturer?.trim();
  if (manufacturer) {
    const narrowed = matches.filter(
      product => normalizeToken(product.manufacturer) === normalizeToken(manufacturer),
    );
    if (narrowed.length === 1) return { product: narrowed[0], ambiguous: false };
  }

  return { product: null, ambiguous: true };
}

function applyProductMatchFields(
  item: ImportEquipmentDraft,
  product: ProductLookupRecord,
): ImportEquipmentDraft {
  const next: ImportEquipmentDraft = { ...item };
  const filledFields: string[] = [];

  const fillString = (
    field: 'manufacturer' | 'modelName' | 'modelNumber' | 'deviceType' | 'productCategory',
    label: string,
    value: string | null | undefined,
  ) => {
    if (next[field]?.trim() || !value?.trim()) return;
    next[field] = value.trim();
    filledFields.push(label);
  };

  fillString('manufacturer', 'Manufacturer', product.manufacturer);
  fillString('modelName', 'Product Description', product.model_name);
  fillString('modelNumber', 'Part Number', product.model_number ?? product.part_number);
  fillString('deviceType', 'Device Type', product.device_type);
  fillString('productCategory', 'Product Category', product.category);

  if (next.warrantyYears == null && product.warranty_years != null) {
    next.warrantyYears = product.warranty_years;
    filledFields.push('Warranty');
  }

  if (filledFields.length === 0) return item;

  return {
    ...next,
    metadata: {
      ...next.metadata,
      [PRODUCT_DB_AUTOFILL_FIELDS_KEY]: filledFields,
    },
  };
}

function countAutofillFieldsOnItem(item: ImportEquipmentDraft): number {
  const filled = item.metadata?.[PRODUCT_DB_AUTOFILL_FIELDS_KEY];
  return Array.isArray(filled) ? filled.length : 0;
}

export function formatProductLookupLabel(product: ProductLookupRecord): string {
  const parts = [product.manufacturer, product.model_number ?? product.part_number, product.model_name]
    .filter(Boolean);
  return parts.join(' · ') || `Product #${product.id}`;
}

export function getProductDatabaseLookupStatus(
  item: ImportEquipmentDraft,
): ProductDatabaseLookupStatus | null {
  const status = item.metadata?.[MANUFACTURER_LOOKUP_STATUS_KEY];
  if (typeof status !== 'string') return null;
  return status as ProductDatabaseLookupStatus;
}

export function getProductDatabaseSuggestionIds(item: ImportEquipmentDraft): number[] {
  const matchIds = item.metadata?.[MANUFACTURER_LOOKUP_MATCH_IDS_KEY];
  return Array.isArray(matchIds) ? matchIds.filter((id): id is number => typeof id === 'number') : [];
}

export function hasProductDatabaseSuggestion(item: ImportEquipmentDraft): boolean {
  return getProductDatabaseLookupStatus(item) === 'suggested';
}

export function applyProductDatabaseSelection(
  item: ImportEquipmentDraft,
  product: ProductLookupRecord,
): ImportEquipmentDraft {
  const enriched = applyProductMatchFields(item, product);
  return withDatabaseLookupMetadata(enriched, product.id, 'matched_from_database');
}

export function dismissProductDatabaseSuggestion(item: ImportEquipmentDraft): ImportEquipmentDraft {
  return withDatabaseLookupMetadata(item, null, 'dismissed');
}

export function enrichEquipmentFromProductDatabase(
  item: ImportEquipmentDraft,
  context: ProductEnrichmentContext,
  options?: { respectUserChoices?: boolean },
): ImportEquipmentDraft {
  const normalized = normalizeImportedEquipmentFields(item);
  if (context.products.length === 0) return normalized;

  const currentStatus = getProductDatabaseLookupStatus(normalized);
  if (
    options?.respectUserChoices &&
    (currentStatus === 'dismissed' || currentStatus === 'matched_from_database')
  ) {
    return normalized;
  }

  const primaryCandidates = collectPrimaryPartCandidates(normalized);
  const allCandidates = collectPartNumberCandidates(normalized);

  const exactMatches = findExactProductsByCandidates(primaryCandidates, context.partIndex);
  const exactResolution = resolveSingleExactMatch(normalized, exactMatches);

  if (exactResolution.product) {
    const enriched = applyProductMatchFields(normalized, exactResolution.product);
    return withDatabaseLookupMetadata(enriched, exactResolution.product.id, 'matched_from_database');
  }

  if (exactResolution.ambiguous) {
    return withDatabaseLookupMetadata(
      normalized,
      null,
      'ambiguous',
      exactMatches.map(product => product.id),
    );
  }

  const suggestedMatches = findSuggestedProductsByCandidates(allCandidates, context.partIndex);
  if (suggestedMatches.length > 0) {
    return withDatabaseLookupMetadata(
      normalized,
      null,
      'suggested',
      suggestedMatches.map(product => product.id),
    );
  }

  return withDatabaseLookupMetadata(normalized, null, 'unmatched');
}

/** @deprecated Use enrichEquipmentFromProductDatabase */
export const lookupManufacturerFromProductDatabase = enrichEquipmentFromProductDatabase;

export function countProductDatabaseAutofillFields(draft: ImportReviewDraft): number {
  let count = 0;
  for (const system of draft.systems) {
    for (const item of system.equipment) {
      count += countAutofillFieldsOnItem(item);
    }
  }
  return count;
}

export function summarizeProductDatabaseEnrichment(
  draft: ImportReviewDraft,
): ProductDatabaseEnrichmentSummary {
  let equipmentLines = 0;
  let matchedLines = 0;
  let ambiguousLines = 0;
  let suggestedLines = 0;
  let unmatchedLines = 0;
  let filledFieldCount = 0;

  for (const system of draft.systems) {
    for (const item of system.equipment) {
      equipmentLines += 1;
      filledFieldCount += countAutofillFieldsOnItem(item);

      const status = getProductDatabaseLookupStatus(item);
      if (status === 'matched_from_database') matchedLines += 1;
      else if (status === 'ambiguous') ambiguousLines += 1;
      else if (status === 'suggested') suggestedLines += 1;
      else if (status === 'unmatched') unmatchedLines += 1;
    }
  }

  return {
    equipmentLines,
    matchedLines,
    ambiguousLines,
    suggestedLines,
    unmatchedLines,
    filledFieldCount,
  };
}

export function enrichImportReviewDraftFromProductDatabase(
  draft: ImportReviewDraft,
  products: ProductModel[],
): ImportReviewDraft {
  const context = createProductEnrichmentContext(products);

  return {
    ...draft,
    systems: draft.systems.map(system => ({
      ...system,
      equipment: system.equipment.map(item => {
        if (context.products.length === 0) return normalizeImportedEquipmentFields(item);
        return enrichEquipmentFromProductDatabase(item, context, { respectUserChoices: true });
      }),
    })),
  };
}

export function isAmbiguousManufacturerLookup(item: ImportEquipmentDraft): boolean {
  return getProductDatabaseLookupStatus(item) === 'ambiguous';
}

export function buildImportEquipmentManufacturerReviewIssues(
  draft: ImportReviewDraft,
): ImportReviewIssue[] {
  const issues: ImportReviewIssue[] = [];

  for (const system of selectedSystems(draft)) {
    for (const item of system.equipment) {
      if (!item.selected) continue;

      const status = getProductDatabaseLookupStatus(item);
      const matchIds = getProductDatabaseSuggestionIds(item);
      const matchCount = matchIds.length;
      const label = equipmentRowLabel(item);

      if (status === 'ambiguous') {
        issues.push({
          code: 'import.ambiguous_manufacturer_lookup',
          message: `${system.name}: "${label}" — Part Number "${item.modelNumber ?? ''}" matches ${matchCount || 'multiple'} products exactly in the Product Database. Select the correct row manually.`,
          severity: 'warning',
          draftId: item.draftId,
        });
      }

      if (status === 'suggested') {
        issues.push({
          code: 'import.suggested_product_database_match',
          message: `${system.name}: "${label}" — closest Product Database match for Part Number "${item.modelNumber ?? ''}" (not exact). Review and use or skip the suggestion on the Systems tab.`,
          severity: 'warning',
          draftId: item.draftId,
        });
      }
    }
  }

  return issues;
}

export function getEquipmentMissingRequiredFields(item: ImportEquipmentDraft): RequiredEquipmentField[] {
  const missing: RequiredEquipmentField[] = [];
  if (!item.modelNumber?.trim()) missing.push('modelNumber');
  if (!item.modelName?.trim()) missing.push('modelName');
  return missing;
}

export interface IncompleteEquipmentRow {
  systemName: string;
  equipment: ImportEquipmentDraft;
  missingFields: RequiredEquipmentField[];
  rowLabel: string;
}

export function listIncompleteSelectedEquipment(draft: ImportReviewDraft): IncompleteEquipmentRow[] {
  const incomplete: IncompleteEquipmentRow[] = [];

  for (const system of selectedSystems(draft)) {
    for (const item of system.equipment) {
      if (!item.selected) continue;
      const missingFields = getEquipmentMissingRequiredFields(item);
      if (missingFields.length === 0) continue;

      incomplete.push({
        systemName: system.name,
        equipment: item,
        missingFields,
        rowLabel: equipmentRowLabel(item),
      });
    }
  }

  return incomplete;
}

export function buildImportEquipmentRequiredFieldIssues(draft: ImportReviewDraft): ImportReviewIssue[] {
  const incomplete = listIncompleteSelectedEquipment(draft);
  if (incomplete.length === 0) return [];

  const issues: ImportReviewIssue[] = [
    {
      code: 'import.incomplete_equipment_summary',
      message: `${incomplete.length} selected equipment line${incomplete.length !== 1 ? 's' : ''} still missing Product Description or Part Number. Complete the highlighted fields in Systems before creating the project.`,
      severity: 'error',
    },
  ];

  for (const row of incomplete) {
    const fieldLabels = row.missingFields.map(field => REQUIRED_EQUIPMENT_FIELD_LABELS[field]);
    issues.push({
      code: 'import.missing_required_equipment_fields',
      message: `${row.systemName}: "${row.rowLabel}" — missing ${fieldLabels.join(' and ')}.`,
      severity: 'error',
      draftId: row.equipment.draftId,
    });
  }

  return issues;
}
