import type { Datasheet, ProductModel } from '../types';
import {
  exactModelMatch,
  normalizedModelMatch,
  normalizeToken,
  equipmentIdentityKey,
  type EquipmentMatchInput,
} from './equipmentMatchUtils';
import {
  AUTO_MATCH_THRESHOLD,
  matchEquipmentInputToProduct,
  type ProductMatchMethod,
} from '../integrations/core/productMatching';
import type { DatasheetMatchOverrideState } from './datasheetMatchOverrides';

export type DatasheetLike = Pick<Datasheet, 'id' | 'manufacturer' | 'model_number' | 'datasheet_url'>;
export type ProductModelLike = Pick<
  ProductModel,
  'id' | 'manufacturer' | 'model_number' | 'model_name' | 'device_type' | 'part_number'
>;

export type DatasheetMatchMethod =
  | 'exact_device'
  | 'exact_model_number'
  | 'normalized_model'
  | 'manufacturer_model'
  | 'close_match'
  | 'description_similarity'
  | 'user_approved'
  | 'none';

export type DatasheetMatchStatus = 'matched' | 'needs_review' | 'unmatched';

export interface DatasheetMatchSuggestion {
  productId: number;
  datasheetId: number;
  confidence: number;
  method: DatasheetMatchMethod;
  label: string;
}

export interface EquipmentDatasheetMatch {
  rowKey: string;
  datasheet: DatasheetLike | null;
  matchedProduct: ProductModelLike | null;
  confidence: number | null;
  method: DatasheetMatchMethod;
  suggestions: DatasheetMatchSuggestion[];
  status: DatasheetMatchStatus;
}

function hasDatasheetUrl(datasheet: DatasheetLike | null | undefined): datasheet is DatasheetLike {
  return Boolean(datasheet?.datasheet_url?.trim());
}

function datasheetLabel(datasheet: DatasheetLike, product: ProductModelLike | null): string {
  const parts = [
    product?.manufacturer ?? datasheet.manufacturer,
    product?.model_number ?? datasheet.model_number,
    product?.model_name,
  ].filter(Boolean);
  return parts.join(' · ') || `Datasheet #${datasheet.id}`;
}

function findProductById(products: ProductModelLike[], productId: number): ProductModelLike | null {
  return products.find(product => product.id === productId) ?? null;
}

function mapProductMethod(method: ProductMatchMethod): DatasheetMatchMethod {
  switch (method) {
    case 'exact_model_number':
    case 'exact_part_number':
      return 'exact_model_number';
    case 'normalized_model':
      return 'normalized_model';
    case 'manufacturer_model':
    case 'catalogue_number':
    case 'stock_number':
      return 'manufacturer_model';
    case 'close_match':
      return 'close_match';
    case 'description_similarity':
      return 'description_similarity';
    default:
      return 'none';
  }
}

export function findDatasheetForProduct(
  product: ProductModelLike,
  datasheets: DatasheetLike[],
): DatasheetLike | null {
  const candidates = [
    { manufacturer: product.manufacturer, modelNumber: product.model_number },
    { manufacturer: product.manufacturer, modelNumber: product.part_number },
    { manufacturer: product.manufacturer, modelNumber: product.model_name },
  ];

  for (const candidate of candidates) {
    const direct = findDirectDatasheet(candidate, datasheets);
    if (direct) return direct.datasheet;
  }

  return null;
}

function findDirectDatasheet(
  item: EquipmentMatchInput,
  datasheets: DatasheetLike[],
): { datasheet: DatasheetLike; method: DatasheetMatchMethod; confidence: number } | null {
  const withUrl = datasheets.filter(hasDatasheetUrl);
  if (withUrl.length === 0) return null;

  for (const datasheet of withUrl) {
    if (
      exactModelMatch(item.modelNumber, datasheet.model_number) &&
      normalizeToken(item.manufacturer) === normalizeToken(datasheet.manufacturer)
    ) {
      return { datasheet, method: 'exact_device', confidence: 1 };
    }
  }

  for (const datasheet of withUrl) {
    if (
      normalizedModelMatch(item.modelNumber, datasheet.model_number) &&
      normalizeToken(item.manufacturer) === normalizeToken(datasheet.manufacturer)
    ) {
      return { datasheet, method: 'normalized_model', confidence: 0.98 };
    }
  }

  for (const datasheet of withUrl) {
    if (normalizedModelMatch(item.modelNumber, datasheet.model_number)) {
      return { datasheet, method: 'normalized_model', confidence: 0.9 };
    }
  }

  for (const datasheet of withUrl) {
    if (exactModelMatch(item.modelNumber, datasheet.model_number)) {
      return { datasheet, method: 'exact_model_number', confidence: 0.88 };
    }
  }

  return null;
}

function buildSuggestion(
  product: ProductModelLike,
  datasheet: DatasheetLike,
  confidence: number,
  method: DatasheetMatchMethod,
): DatasheetMatchSuggestion {
  return {
    productId: product.id,
    datasheetId: datasheet.id,
    confidence,
    method,
    label: datasheetLabel(datasheet, product),
  };
}

function statusFromMatch(
  datasheet: DatasheetLike | null,
  confidence: number | null,
  suggestions: DatasheetMatchSuggestion[],
): DatasheetMatchStatus {
  if (datasheet && hasDatasheetUrl(datasheet)) {
    if (confidence != null && confidence >= AUTO_MATCH_THRESHOLD) return 'matched';
    if (suggestions.length === 0) return 'matched';
  }
  if (suggestions.length > 0) return 'needs_review';
  return 'unmatched';
}

export function resolveEquipmentDatasheet(
  item: EquipmentMatchInput,
  products: ProductModelLike[],
  datasheets: DatasheetLike[],
  overrides?: DatasheetMatchOverrideState,
): EquipmentDatasheetMatch {
  const rowKey = equipmentIdentityKey(item.manufacturer, item.modelNumber);

  const direct = findDirectDatasheet(item, datasheets);
  if (direct) {
    return {
      rowKey,
      datasheet: direct.datasheet,
      matchedProduct: null,
      confidence: direct.confidence,
      method: direct.method,
      suggestions: [],
      status: 'matched',
    };
  }

  const approved = overrides?.approved[rowKey];
  if (approved) {
    const datasheet = datasheets.find(entry => entry.id === approved.datasheetId) ?? null;
    if (hasDatasheetUrl(datasheet)) {
      return {
        rowKey,
        datasheet,
        matchedProduct: approved.productId != null
          ? findProductById(products, approved.productId)
          : null,
        confidence: 1,
        method: 'user_approved',
        suggestions: [],
        status: 'matched',
      };
    }
  }

  if (overrides?.dismissed.includes(rowKey)) {
    return {
      rowKey,
      datasheet: null,
      matchedProduct: null,
      confidence: null,
      method: 'none',
      suggestions: [],
      status: 'unmatched',
    };
  }

  const productMatch = matchEquipmentInputToProduct(item, products);
  const suggestions: DatasheetMatchSuggestion[] = [];

  for (const suggestion of productMatch.suggestions) {
    const product = findProductById(products, suggestion.productId);
    if (!product) continue;
    const datasheet = findDatasheetForProduct(product, datasheets);
    if (!hasDatasheetUrl(datasheet)) continue;
    suggestions.push(buildSuggestion(
      product,
      datasheet,
      suggestion.confidence,
      mapProductMethod(suggestion.method),
    ));
  }

  if (
    productMatch.matchedProduct &&
    (productMatch.confidence ?? 0) >= AUTO_MATCH_THRESHOLD
  ) {
    const confidentSuggestions = suggestions.filter(
      entry => entry.confidence >= AUTO_MATCH_THRESHOLD,
    );
    if (confidentSuggestions.length === 1) {
      const only = confidentSuggestions[0];
      const datasheet = datasheets.find(entry => entry.id === only.datasheetId) ?? null;
      if (hasDatasheetUrl(datasheet)) {
        return {
          rowKey,
          datasheet,
          matchedProduct: productMatch.matchedProduct,
          confidence: only.confidence,
          method: only.method,
          suggestions,
          status: 'matched',
        };
      }
    }
  }

  if (suggestions.length === 1 && suggestions[0].confidence >= AUTO_MATCH_THRESHOLD) {
    const only = suggestions[0];
    const datasheet = datasheets.find(entry => entry.id === only.datasheetId) ?? null;
    if (hasDatasheetUrl(datasheet)) {
      return {
        rowKey,
        datasheet,
        matchedProduct: findProductById(products, only.productId),
        confidence: only.confidence,
        method: only.method,
        suggestions,
        status: 'matched',
      };
    }
  }

  return {
    rowKey,
    datasheet: null,
    matchedProduct: productMatch.matchedProduct,
    confidence: productMatch.confidence,
    method: suggestions.length > 0 ? suggestions[0].method : 'none',
    suggestions,
    status: statusFromMatch(null, productMatch.confidence, suggestions),
  };
}

export function hasAutoLinkedDatasheet(match: EquipmentDatasheetMatch): boolean {
  return match.status === 'matched' && hasDatasheetUrl(match.datasheet);
}

export function findDatasheetForDeviceFields(
  manufacturer: string | null | undefined,
  modelNumber: string | null | undefined,
  products: ProductModelLike[],
  datasheets: DatasheetLike[],
): DatasheetLike | null {
  const result = resolveEquipmentDatasheet(
    { manufacturer: manufacturer ?? null, modelNumber: modelNumber ?? null },
    products,
    datasheets,
  );
  return result.datasheet;
}

export function equipmentHasDatasheet(
  manufacturer: string | null | undefined,
  modelNumber: string | null | undefined,
  products: ProductModelLike[],
  datasheets: DatasheetLike[],
): boolean {
  return hasAutoLinkedDatasheet(
    resolveEquipmentDatasheet(
      { manufacturer: manufacturer ?? null, modelNumber: modelNumber ?? null },
      products,
      datasheets,
    ),
  );
}
