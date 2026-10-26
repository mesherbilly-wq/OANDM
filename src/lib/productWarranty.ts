import type { ProductModel } from '../types';
import { DEFAULT_PRODUCT_WARRANTY_YEARS } from './productDatabaseCsv';
import { invalidateProductModelsCache } from './productDatabaseDb';
import { buildProductPartIndex, type ProductPartIndex } from './productLookupIndex';
import { supabase } from './supabase';

export { DEFAULT_PRODUCT_WARRANTY_YEARS };

let partIndexProducts: ProductModel[] | null = null;
let partIndex: ProductPartIndex | null = null;

function partIndexFor(products: ProductModel[], index?: ProductPartIndex): ProductPartIndex {
  if (index) return index;
  if (partIndex && partIndexProducts === products) return partIndex;
  partIndex = buildProductPartIndex(products);
  partIndexProducts = products;
  return partIndex;
}

export function resolveWarrantyYearsForPartNumber(
  partNumber: string | null | undefined,
  products: ProductModel[],
  index?: ProductPartIndex,
): number {
  const part = partNumber?.trim();
  if (!part) return DEFAULT_PRODUCT_WARRANTY_YEARS;
  const match = partIndexFor(products, index).findByPartNumber(part)[0];
  return match?.warranty_years ?? DEFAULT_PRODUCT_WARRANTY_YEARS;
}

export function resolveWarrantyYearsForDevice(
  device: {
    manufacturer?: string | null;
    model_number?: string | null;
    model_name?: string | null;
    device_type?: string | null;
  },
  products: ProductModel[],
  index?: ProductPartIndex,
): number {
  return resolveWarrantyYearsForPartNumber(device.model_number, products, index);
}

/** Persist warranty against the Product Database row for this part number. */
export async function saveWarrantyYearsForPartNumber(args: {
  partNumber: string | null | undefined;
  warrantyYears: number;
  manufacturer?: string | null;
  modelName?: string | null;
  deviceType?: string | null;
  existingProducts: ProductModel[];
}): Promise<string | null> {
  const part = args.partNumber?.trim();
  if (!part) return 'Set a part number first so warranty can be stored on that product.';

  const years = Number.isFinite(args.warrantyYears) && args.warrantyYears >= 0
    ? Math.round(args.warrantyYears)
    : DEFAULT_PRODUCT_WARRANTY_YEARS;

  const matches = buildProductPartIndex(args.existingProducts).findByPartNumber(part);
  if (matches.length > 0) {
    const { error } = await supabase
      .from('product_models')
      .update({ warranty_years: years })
      .in('id', matches.map(product => product.id));
    if (error) return error.message;
    invalidateProductModelsCache();
    return null;
  }

  const { error } = await supabase.from('product_models').insert({
    manufacturer: args.manufacturer?.trim() || null,
    model_number: part,
    part_number: part,
    model_name: args.modelName?.trim() || null,
    device_type: args.deviceType?.trim() || null,
    warranty_years: years,
  });
  if (error) return error.message;
  invalidateProductModelsCache();
  return null;
}
