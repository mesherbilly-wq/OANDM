import { matchEquipmentInputToProduct } from '../integrations/core/productMatching';
import type { ProductModel } from '../types';
import { DEFAULT_PRODUCT_WARRANTY_YEARS } from './productDatabaseCsv';
import { tokenOverlapScore } from './equipmentMatchUtils';
import { invalidateProductModelsCache } from './productDatabaseDb';
import { buildProductPartIndex } from './productLookupIndex';
import { supabase } from './supabase';

const MAX_SUGGESTIONS = 12;

export interface ScheduleProductInput {
  manufacturer?: string | null;
  modelNumber?: string | null;
  modelName?: string | null;
  deviceType?: string | null;
  query?: string | null;
}

export interface AppliedScheduleProduct {
  manufacturer: string | null;
  modelNumber: string | null;
  modelName: string | null;
  deviceType: string | null;
  warrantyYears: number | null;
  matched: boolean;
  created: boolean;
}

function productSearchText(product: ProductModel): string {
  return [product.manufacturer, product.model_number, product.part_number, product.model_name, product.device_type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function formatScheduleProductLabel(product: ProductModel): string {
  return [product.manufacturer, product.model_number ?? product.part_number, product.model_name]
    .filter(Boolean)
    .join(' · ') || `Product #${product.id}`;
}

export function listClosestScheduleProducts(
  input: ScheduleProductInput,
  products: ProductModel[],
  limit = MAX_SUGGESTIONS,
): ProductModel[] {
  const match = matchEquipmentInputToProduct(
    {
      manufacturer: input.manufacturer,
      modelNumber: input.modelNumber,
      modelName: input.modelName,
      deviceType: input.deviceType,
    },
    products,
  );

  const ranked: ProductModel[] = [];
  if (match.matchedProduct) ranked.push(match.matchedProduct as ProductModel);
  for (const suggestion of match.suggestions) {
    const product = products.find(item => item.id === suggestion.productId);
    if (product) ranked.push(product);
  }

  const query = input.query?.trim().toLowerCase() ?? '';
  const brand = (input.manufacturer ?? '').trim().toLowerCase();
  const context = [input.manufacturer, input.modelNumber, input.modelName, input.deviceType]
    .filter(Boolean)
    .join(' ');

  const pool = query
    ? products.filter(product => productSearchText(product).includes(query)).slice(0, 80)
    : brand
      ? products.filter(product => (product.manufacturer ?? '').toLowerCase() === brand).slice(0, 40)
      : [];

  const scored = pool
    .map(product => {
      const hay = productSearchText(product);
      let score = 0;
      if (query && (product.manufacturer ?? '').toLowerCase().startsWith(query)) score += 3;
      if (query && (product.model_number ?? '').toLowerCase().includes(query)) score += 3;
      if (query && (product.part_number ?? '').toLowerCase().includes(query)) score += 3;
      if (context) score += tokenOverlapScore(context, hay) * 2;
      return { product, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.product);

  const seen = new Set<number>();
  const out: ProductModel[] = [];
  for (const product of [...ranked, ...scored]) {
    if (!product || seen.has(product.id)) continue;
    seen.add(product.id);
    out.push(product);
    if (out.length >= limit) break;
  }
  return out;
}

export function appliedProductFromModel(product: ProductModel): AppliedScheduleProduct {
  const modelNumber = product.model_number?.trim() || product.part_number?.trim() || null;
  return {
    manufacturer: product.manufacturer?.trim() || null,
    modelNumber,
    modelName: product.model_name?.trim() || null,
    deviceType: product.device_type?.trim() || null,
    warrantyYears: product.warranty_years,
    matched: true,
    created: false,
  };
}

export async function ensureManualProductInDatabase(args: {
  manufacturer: string | null;
  modelNumber: string | null;
  modelName?: string | null;
  deviceType?: string | null;
  warrantyYears?: number | null;
  existingProducts: ProductModel[];
}): Promise<{ applied: AppliedScheduleProduct; error: string | null }> {
  const manufacturer = args.manufacturer?.trim() || null;
  const modelNumber = args.modelNumber?.trim() || null;
  const modelName = args.modelName?.trim() || null;
  const deviceType = args.deviceType?.trim() || null;
  const warrantyYears = args.warrantyYears ?? DEFAULT_PRODUCT_WARRANTY_YEARS;

  const empty: AppliedScheduleProduct = {
    manufacturer,
    modelNumber,
    modelName,
    deviceType,
    warrantyYears,
    matched: false,
    created: false,
  };

  if (!modelNumber) {
    return { applied: empty, error: null };
  }

  const partHits = buildProductPartIndex(args.existingProducts).findByPartNumber(modelNumber);
  const sameManufacturer = partHits.find(product => {
    const brand = product.manufacturer?.trim().toLowerCase() ?? '';
    return !manufacturer || !brand || brand === manufacturer.toLowerCase();
  }) ?? partHits[0];
  if (sameManufacturer) {
    return {
      applied: {
        ...appliedProductFromModel(sameManufacturer as ProductModel),
        manufacturer: manufacturer ?? (sameManufacturer.manufacturer?.trim() || null),
        modelNumber,
        modelName: modelName ?? (sameManufacturer.model_name?.trim() || null),
        created: false,
      },
      error: null,
    };
  }

  const { data, error } = await supabase
    .from('product_models')
    .insert({
      manufacturer,
      model_number: modelNumber,
      part_number: modelNumber,
      model_name: modelName,
      device_type: deviceType,
      warranty_years: warrantyYears,
    })
    .select('*')
    .single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return { applied: { ...empty, matched: true }, error: null };
    }
    return { applied: empty, error: error.message };
  }

  invalidateProductModelsCache();
  return {
    applied: {
      ...appliedProductFromModel(data as ProductModel),
      created: true,
    },
    error: null,
  };
}
