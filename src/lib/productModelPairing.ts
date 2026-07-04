import type { ProductModel } from '../types';
import { normalizePart, normalizeToken } from './equipmentMatchUtils';
import { invalidateProductModelsCache } from './productDatabaseDb';
import { supabase } from './supabase';

export function findExistingProductModel(
  manufacturer: string,
  modelNumber: string,
  products: ProductModel[],
): ProductModel | null {
  const manufacturerKey = normalizeToken(manufacturer);
  const modelKey = normalizePart(modelNumber);
  if (!manufacturerKey || !modelKey) return null;

  return (
    products.find(product => {
      if (normalizeToken(product.manufacturer) !== manufacturerKey) return false;
      const numbers = [product.model_number, product.part_number].map(value => normalizePart(value));
      return numbers.some(value => value === modelKey);
    }) ?? null
  );
}

/** Insert product_models row only when manufacturer+model pair is not already present. */
export async function saveProductModelPairIfNew(
  manufacturer: string,
  modelNumber: string,
  deviceType: string | null,
  existingProducts: ProductModel[],
): Promise<{ product: ProductModel; created: boolean } | { error: string }> {
  const trimmedManufacturer = manufacturer.trim();
  const trimmedModel = modelNumber.trim();
  if (!trimmedManufacturer || !trimmedModel) {
    return { error: 'Manufacturer and model are required to save a product pairing.' };
  }

  const existing = findExistingProductModel(trimmedManufacturer, trimmedModel, existingProducts);
  if (existing) return { product: existing, created: false };

  const { data, error } = await supabase
    .from('product_models')
    .insert({
      manufacturer: trimmedManufacturer,
      model_number: trimmedModel,
      device_type: deviceType?.trim() || null,
    })
    .select('*')
    .single();

  if (error) {
    const { data: retry } = await supabase.from('product_models').select('*').order('manufacturer');
    const fallback = findExistingProductModel(trimmedManufacturer, trimmedModel, retry ?? []);
    if (fallback) return { product: fallback, created: false };
    return { error: error.message };
  }

  invalidateProductModelsCache();
  return { product: data as ProductModel, created: true };
}
