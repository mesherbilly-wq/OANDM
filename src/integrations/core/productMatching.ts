import type { ImportEquipmentDraft, ImportReviewDraft } from '../models';
import type { ProductModel } from '../../types';

export type ProductMatchMethod =
  | 'exact_part_number'
  | 'manufacturer_model'
  | 'catalogue_number'
  | 'stock_number'
  | 'description_similarity'
  | 'user_selected'
  | 'none';

export type EquipmentMatchResolution = 'pending' | 'accepted' | 'unmatched' | 'new_product_later';

export interface ProductMatchSuggestion {
  productId: number;
  confidence: number;
  method: ProductMatchMethod;
  label: string;
}

export interface EquipmentProductMatch {
  equipmentDraftId: string;
  equipment: ImportEquipmentDraft;
  systemName: string;
  matchedProduct: ProductModel | null;
  confidence: number | null;
  method: ProductMatchMethod;
  suggestions: ProductMatchSuggestion[];
  resolution: EquipmentMatchResolution;
}

export interface ProductMatchSummary {
  matched: number;
  needsReview: number;
  unmatched: number;
  total: number;
}

export interface SavedEquipmentProductMatch {
  resolution: EquipmentMatchResolution;
  matchedProductId: number | null;
  method: ProductMatchMethod | null;
  confidence: number | null;
}

const AUTO_MATCH_THRESHOLD = 0.85;
const MAX_SUGGESTIONS = 5;

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePart(value: string | null | undefined): string {
  return normalizeToken(value).replace(/[^a-z0-9]/g, '');
}

function pickMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function equipmentDescription(item: ImportEquipmentDraft): string {
  return [item.modelName, item.deviceType, item.modelNumber].filter(Boolean).join(' ');
}

function productSearchText(product: ProductModel): string {
  return [product.model_name, product.device_type, product.model_number, product.part_number, product.manufacturer]
    .filter(Boolean)
    .join(' ');
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2),
  );
}

function descriptionSimilarity(left: string, right: string): number {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size);
}

function findProductById(products: ProductModel[], productId: number | null): ProductModel | null {
  if (productId == null) return null;
  return products.find(product => product.id === productId) ?? null;
}

function suggestionLabel(product: ProductModel): string {
  const parts = [product.manufacturer, product.model_number ?? product.part_number, product.model_name]
    .filter(Boolean);
  return parts.join(' · ') || `Product #${product.id}`;
}

function tryExactPartNumber(
  item: ImportEquipmentDraft,
  products: ProductModel[],
): { product: ProductModel; confidence: number; method: ProductMatchMethod } | null {
  const candidates = [
    item.modelNumber,
    pickMetadataString(item.metadata, 'simproPartNo'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const needle = normalizePart(candidate);
    if (!needle) continue;
    const hit = products.find(product => {
      const model = normalizePart(product.model_number);
      const part = normalizePart(product.part_number);
      return (model && model === needle) || (part && part === needle);
    });
    if (hit) {
      return { product: hit, confidence: 1, method: 'exact_part_number' };
    }
  }
  return null;
}

function tryManufacturerModel(
  item: ImportEquipmentDraft,
  products: ProductModel[],
): { product: ProductModel; confidence: number; method: ProductMatchMethod } | null {
  const manufacturer = normalizeToken(item.manufacturer);
  const modelNeedle = normalizePart(item.modelNumber) || normalizePart(item.modelName);
  if (!manufacturer || !modelNeedle) return null;

  const hit = products.find(product => {
    if (normalizeToken(product.manufacturer) !== manufacturer) return false;
    const model = normalizePart(product.model_number);
    const part = normalizePart(product.part_number);
    const name = normalizePart(product.model_name);
    return model === modelNeedle || part === modelNeedle || name === modelNeedle;
  });

  if (!hit) return null;
  return { product: hit, confidence: 0.95, method: 'manufacturer_model' };
}

function tryCatalogueNumber(
  item: ImportEquipmentDraft,
  products: ProductModel[],
): { product: ProductModel; confidence: number; method: ProductMatchMethod } | null {
  const catalogue = pickMetadataString(item.metadata, 'simproCatalogNo');
  const needle = normalizePart(catalogue);
  if (!needle) return null;

  const hit = products.find(product => {
    const part = normalizePart(product.part_number);
    const model = normalizePart(product.model_number);
    return (part && part === needle) || (model && model === needle);
  });

  if (!hit) return null;
  return { product: hit, confidence: 0.9, method: 'catalogue_number' };
}

function tryStockNumber(
  item: ImportEquipmentDraft,
  products: ProductModel[],
): { product: ProductModel; confidence: number; method: ProductMatchMethod } | null {
  const stock = pickMetadataString(item.metadata, 'simproStockNo');
  const needle = normalizePart(stock);
  if (!needle) return null;

  const hit = products.find(product => {
    const part = normalizePart(product.part_number);
    const model = normalizePart(product.model_number);
    return (part && part === needle) || (model && model === needle);
  });

  if (!hit) return null;
  return { product: hit, confidence: 0.88, method: 'stock_number' };
}

function buildDescriptionSuggestions(
  item: ImportEquipmentDraft,
  products: ProductModel[],
): ProductMatchSuggestion[] {
  const description = equipmentDescription(item);
  if (!description.trim()) return [];

  const scored = products
    .map(product => ({
      product,
      score: descriptionSimilarity(description, productSearchText(product)),
    }))
    .filter(entry => entry.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  return scored.map(entry => ({
    productId: entry.product.id,
    confidence: Math.min(0.75, entry.score),
    method: 'description_similarity' as const,
    label: suggestionLabel(entry.product),
  }));
}

export function matchEquipmentToProduct(
  item: ImportEquipmentDraft,
  products: ProductModel[],
): Omit<EquipmentProductMatch, 'equipmentDraftId' | 'equipment' | 'systemName'> {
  const ordered = [
    tryExactPartNumber(item, products),
    tryManufacturerModel(item, products),
    tryCatalogueNumber(item, products),
    tryStockNumber(item, products),
  ];

  for (const hit of ordered) {
    if (!hit) continue;
    return {
      matchedProduct: hit.product,
      confidence: hit.confidence,
      method: hit.method,
      suggestions: [{
        productId: hit.product.id,
        confidence: hit.confidence,
        method: hit.method,
        label: suggestionLabel(hit.product),
      }],
      resolution: 'pending',
    };
  }

  const suggestions = buildDescriptionSuggestions(item, products);

  if (suggestions.length === 0) {
    return {
      matchedProduct: null,
      confidence: null,
      method: 'none',
      suggestions: [],
      resolution: 'pending',
    };
  }

  const best = suggestions[0];
  const bestProduct = findProductById(products, best.productId);
  if (best.confidence >= AUTO_MATCH_THRESHOLD && bestProduct) {
    return {
      matchedProduct: bestProduct,
      confidence: best.confidence,
      method: best.method,
      suggestions,
      resolution: 'pending',
    };
  }

  return {
    matchedProduct: null,
    confidence: null,
    method: 'none',
    suggestions,
    resolution: 'pending',
  };
}

export function buildEquipmentProductMatches(
  draft: ImportReviewDraft,
  products: ProductModel[],
  saved: Record<string, SavedEquipmentProductMatch> = {},
): EquipmentProductMatch[] {
  const matches: EquipmentProductMatch[] = [];

  for (const system of draft.systems) {
    for (const item of system.equipment) {
      const auto = matchEquipmentToProduct(item, products);
      const savedState = saved[item.draftId];
      let matchedProduct = auto.matchedProduct;
      let confidence = auto.confidence;
      let method = auto.method;
      let resolution = auto.resolution;
      let suggestions = auto.suggestions;

      if (savedState) {
        resolution = savedState.resolution;
        method = savedState.method ?? method;
        confidence = savedState.confidence ?? confidence;
        matchedProduct = findProductById(products, savedState.matchedProductId);

        if (savedState.resolution === 'unmatched' || savedState.resolution === 'new_product_later') {
          matchedProduct = null;
          confidence = null;
          method = savedState.method ?? 'none';
        }

        if (savedState.resolution === 'accepted' && savedState.matchedProductId != null) {
          matchedProduct = findProductById(products, savedState.matchedProductId);
          method = savedState.method ?? 'user_selected';
          confidence = savedState.confidence ?? confidence;
        }
      }

      if (matchedProduct && suggestions.every(s => s.productId !== matchedProduct!.id)) {
        suggestions = [{
          productId: matchedProduct.id,
          confidence: confidence ?? 0,
          method,
          label: suggestionLabel(matchedProduct),
        }, ...suggestions];
      }

      matches.push({
        equipmentDraftId: item.draftId,
        equipment: item,
        systemName: system.name,
        matchedProduct,
        confidence,
        method,
        suggestions,
        resolution,
      });
    }
  }

  return matches;
}

export function summarizeProductMatches(matches: EquipmentProductMatch[]): ProductMatchSummary {
  let matched = 0;
  let needsReview = 0;
  let unmatched = 0;

  for (const entry of matches) {
    if (entry.resolution === 'unmatched') {
      unmatched += 1;
      continue;
    }

    if (entry.resolution === 'new_product_later') {
      needsReview += 1;
      continue;
    }

    if (entry.matchedProduct && (entry.resolution === 'accepted' || (entry.confidence ?? 0) >= AUTO_MATCH_THRESHOLD)) {
      matched += 1;
      continue;
    }

    if (entry.matchedProduct && (entry.confidence ?? 0) < AUTO_MATCH_THRESHOLD) {
      needsReview += 1;
      continue;
    }

    if (entry.suggestions.length > 0) {
      needsReview += 1;
      continue;
    }

    unmatched += 1;
  }

  return {
    matched,
    needsReview,
    unmatched,
    total: matches.length,
  };
}

export function applyProductMatchesToDraft(
  draft: ImportReviewDraft,
  matches: EquipmentProductMatch[],
): ImportReviewDraft {
  const byDraftId = new Map(matches.map(match => [match.equipmentDraftId, match]));

  return {
    ...draft,
    systems: draft.systems.map(system => ({
      ...system,
      equipment: system.equipment.map(item => {
        const match = byDraftId.get(item.draftId);
        if (!match) return item;

        const linked = match.matchedProduct && match.resolution !== 'unmatched' && match.resolution !== 'new_product_later';

        return {
          ...item,
          matched: Boolean(linked),
          matchedProductId: linked ? match.matchedProduct!.id : null,
          confidence: match.confidence,
        };
      }),
    })),
  };
}

export function savedMatchesFromEquipmentMatches(
  matches: EquipmentProductMatch[],
): Record<string, SavedEquipmentProductMatch> {
  const saved: Record<string, SavedEquipmentProductMatch> = {};
  for (const match of matches) {
    saved[match.equipmentDraftId] = {
      resolution: match.resolution,
      matchedProductId: match.matchedProduct?.id ?? null,
      method: match.method,
      confidence: match.confidence,
    };
  }
  return saved;
}
