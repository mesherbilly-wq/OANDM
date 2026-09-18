import type { ProductModel } from '../types';
import { matchEquipmentInputToProduct } from '../integrations/core/productMatching';
import { DEFAULT_PRODUCT_WARRANTY_YEARS } from './productDatabaseCsv';
import { invalidateProductModelsCache } from './productDatabaseDb';
import { buildProductPartIndex } from './productLookupIndex';
import { supabase } from './supabase';

export { DEFAULT_PRODUCT_WARRANTY_YEARS };

export function resolveWarrantyYearsForPartNumber(
  partNumber: string | null | undefined,
  products: ProductModel[],
): number {
  const part = partNumber?.trim();
  if (!part) return DEFAULT_PRODUCT_WARRANTY_YEARS;
  const match = buildProductPartIndex(products).findByPartNumber(part)[0];
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
): number {
  const part = device.model_number?.trim();
  if (part) {
    const match = buildProductPartIndex(products).findByPartNumber(part)[0];
    if (match) return match.warranty_years ?? DEFAULT_PRODUCT_WARRANTY_YEARS;
  }

  const matched = matchEquipmentInputToProduct(
    {
      manufacturer: device.manufacturer,
      modelNumber: device.model_number,
      modelName: device.model_name,
      deviceType: device.device_type,
    },
    products,
  ).matchedProduct;

  return matched?.warranty_years ?? DEFAULT_PRODUCT_WARRANTY_YEARS;
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
