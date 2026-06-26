import type { ImportEquipmentDraft, ImportReviewDraft } from '../models';
import type { ProductModel } from '../../types';
import {
  equipmentIdentityKey,
  normalizeModelKey,
  normalizePart,
  normalizeToken,
  normalizedModelMatch,
  exactModelMatch,
  pickMetadataString,
  tokenOverlapScore,
  type EquipmentMatchInput,
} from '../../lib/equipmentMatchUtils';

export type ProductModelLike = Pick<
  ProductModel,
  'id' | 'manufacturer' | 'model_number' | 'model_name' | 'device_type' | 'part_number'
>;

export type ProductMatchMethod =
  | 'exact_model_number'
  | 'normalized_model'
  | 'exact_part_number'
  | 'manufacturer_model'
  | 'catalogue_number'
  | 'stock_number'
  | 'close_match'
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
  matchedProduct: ProductModelLike | null;
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

export const AUTO_MATCH_THRESHOLD = 0.85;
const CLOSE_MATCH_THRESHOLD = 0.72;
const MAX_SUGGESTIONS = 5;

export function equipmentFromDraft(item: ImportEquipmentDraft): EquipmentMatchInput {
  return {
    manufacturer: item.manufacturer,
    modelNumber: item.modelNumber,
    modelName: item.modelName,
    deviceType: item.deviceType,
    metadata: item.metadata,
  };
}

function equipmentDescription(item: EquipmentMatchInput): string {
  return [item.modelName, item.deviceType, item.modelNumber].filter(Boolean).join(' ');
}

function productSearchText(product: ProductModelLike): string {
  return [product.model_name, product.device_type, product.model_number, product.part_number, product.manufacturer]
    .filter(Boolean)
    .join(' ');
}

function suggestionLabel(product: ProductModelLike): string {
  const parts = [product.manufacturer, product.model_number ?? product.part_number, product.model_name]
    .filter(Boolean);
  return parts.join(' · ') || `Product #${product.id}`;
}

function findProductById(products: ProductModelLike[], productId: number | null): ProductModelLike | null {
  if (productId == null) return null;
  return products.find(product => product.id === productId) ?? null;
}

function modelCandidates(item: EquipmentMatchInput): string[] {
  return [
    item.modelNumber,
    item.modelName,
    pickMetadataString(item.metadata, 'simproPartNo'),
  ].filter(Boolean) as string[];
}

function tryExactModelNumber(
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): { product: ProductModelLike; confidence: number; method: ProductMatchMethod } | null {
  for (const candidate of modelCandidates(item)) {
    const hit = products.find(product =>
      exactModelMatch(candidate, product.model_number) ||
      exactModelMatch(candidate, product.part_number),
    );
    if (hit) {
      return { product: hit, confidence: 1, method: 'exact_model_number' };
    }
  }
  return null;
}

function tryNormalizedModel(
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): { product: ProductModelLike; confidence: number; method: ProductMatchMethod } | null {
  for (const candidate of modelCandidates(item)) {
    const hit = products.find(product =>
      normalizedModelMatch(candidate, product.model_number) ||
      normalizedModelMatch(candidate, product.part_number) ||
      normalizedModelMatch(candidate, product.model_name),
    );
    if (hit) {
      return { product: hit, confidence: 0.98, method: 'normalized_model' };
    }
  }
  return null;
}

function tryExactPartNumber(
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): { product: ProductModelLike; confidence: number; method: ProductMatchMethod } | null {
  for (const candidate of modelCandidates(item)) {
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
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): { product: ProductModelLike; confidence: number; method: ProductMatchMethod } | null {
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
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): { product: ProductModelLike; confidence: number; method: ProductMatchMethod } | null {
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
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): { product: ProductModelLike; confidence: number; method: ProductMatchMethod } | null {
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

function closeMatchScore(item: EquipmentMatchInput, product: ProductModelLike): number {
  const scores: number[] = [];
  const eqModel = item.modelNumber;
  const eqName = item.modelName ?? item.deviceType;
  const eqMfr = item.manufacturer;

  if (eqModel) {
    for (const field of [product.model_number, product.part_number, product.model_name]) {
      if (!field) continue;
      if (exactModelMatch(eqModel, field)) {
        scores.push(1);
        continue;
      }
      if (normalizedModelMatch(eqModel, field)) {
        scores.push(0.92);
        continue;
      }
      const a = normalizeModelKey(eqModel);
      const b = normalizeModelKey(field);
      if (a && b && (a.includes(b) || b.includes(a))) {
        scores.push(0.82);
      }
    }
  }

  if (eqName) {
    if (product.model_name) {
      scores.push(tokenOverlapScore(eqName, product.model_name));
    }
    if (product.device_type) {
      scores.push(tokenOverlapScore(eqName, product.device_type));
    }
    if (product.model_number) {
      scores.push(tokenOverlapScore(eqName, product.model_number));
    }
  }

  if (eqMfr && eqModel) {
    const combo = normalizeModelKey(`${eqMfr}${eqModel}`);
    const productCombo = normalizeModelKey(`${product.manufacturer ?? ''}${product.model_number ?? ''}`);
    if (combo && productCombo && combo === productCombo) {
      scores.push(0.96);
    }
  }

  return scores.length ? Math.max(...scores) : 0;
}

function buildCloseMatchSuggestions(
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): ProductMatchSuggestion[] {
  const scored = products
    .map(product => ({
      product,
      score: closeMatchScore(item, product),
    }))
    .filter(entry => entry.score >= CLOSE_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  return scored.map(entry => ({
    productId: entry.product.id,
    confidence: Math.min(0.84, entry.score),
    method: 'close_match' as const,
    label: suggestionLabel(entry.product),
  }));
}

function buildDescriptionSuggestions(
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): ProductMatchSuggestion[] {
  const description = equipmentDescription(item);
  if (!description.trim()) return [];

  const scored = products
    .map(product => ({
      product,
      score: tokenOverlapScore(description, productSearchText(product)),
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

export function matchEquipmentInputToProduct(
  item: EquipmentMatchInput,
  products: ProductModelLike[],
): Omit<EquipmentProductMatch, 'equipmentDraftId' | 'equipment' | 'systemName'> {
  const ordered = [
    tryExactModelNumber(item, products),
    tryNormalizedModel(item, products),
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

  const closeSuggestions = buildCloseMatchSuggestions(item, products);
  const descriptionSuggestions = buildDescriptionSuggestions(item, products);
  const suggestions = mergeSuggestions(closeSuggestions, descriptionSuggestions);

  if (suggestions.length === 0) {
    return {
      matchedProduct: null,
      confidence: null,
      method: 'none',
      suggestions: [],
      resolution: 'pending',
    };
  }

  const topScore = suggestions[0].confidence;
  const confidentHits = suggestions.filter(s => s.confidence >= AUTO_MATCH_THRESHOLD);
  if (confidentHits.length === 1) {
    const product = findProductById(products, confidentHits[0].productId);
    if (product) {
      return {
        matchedProduct: product,
        confidence: confidentHits[0].confidence,
        method: confidentHits[0].method,
        suggestions,
        resolution: 'pending',
      };
    }
  }

  if (topScore >= AUTO_MATCH_THRESHOLD && suggestions.length === 1) {
    const product = findProductById(products, suggestions[0].productId);
    if (product) {
      return {
        matchedProduct: product,
        confidence: suggestions[0].confidence,
        method: suggestions[0].method,
        suggestions,
        resolution: 'pending',
      };
    }
  }

  return {
    matchedProduct: null,
    confidence: null,
    method: 'none',
    suggestions,
    resolution: 'pending',
  };
}

function mergeSuggestions(
  primary: ProductMatchSuggestion[],
  secondary: ProductMatchSuggestion[],
): ProductMatchSuggestion[] {
  const seen = new Set<number>();
  const merged: ProductMatchSuggestion[] = [];
  for (const suggestion of [...primary, ...secondary]) {
    if (seen.has(suggestion.productId)) continue;
    seen.add(suggestion.productId);
    merged.push(suggestion);
    if (merged.length >= MAX_SUGGESTIONS) break;
  }
  return merged;
}

export function matchEquipmentToProduct(
  item: ImportEquipmentDraft,
  products: ProductModelLike[],
): Omit<EquipmentProductMatch, 'equipmentDraftId' | 'equipment' | 'systemName'> {
  return matchEquipmentInputToProduct(equipmentFromDraft(item), products);
}

export function buildEquipmentProductMatches(
  draft: ImportReviewDraft,
  products: ProductModelLike[],
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

export function productMatchRowKey(item: EquipmentMatchInput): string {
  return equipmentIdentityKey(item.manufacturer, item.modelNumber);
}
