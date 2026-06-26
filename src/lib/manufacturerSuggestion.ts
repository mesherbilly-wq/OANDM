import { matchEquipmentInputToProduct, type ProductModelLike } from '../integrations/core/productMatching';
import { supabase } from './supabase';

export const MODEL_REQUIRED_MESSAGE = 'Model/part number required for AI manufacturer lookup.';

export interface ManufacturerResolverInput {
  description: string | null;
  modelNumber: string | null;
  deviceType: string | null;
}

export type ManufacturerSuggestionSource = 'product_database' | 'ai';

export interface ManufacturerSuggestion {
  manufacturer: string;
  source: ManufacturerSuggestionSource;
  confidence: number | null;
  reason: string;
  productId: number | null;
}

function toMatchInput(input: ManufacturerResolverInput) {
  return {
    manufacturer: null,
    modelNumber: input.modelNumber,
    modelName: null,
    deviceType: input.deviceType ?? input.description,
  };
}

function hasModelNumber(input: ManufacturerResolverInput): boolean {
  return Boolean(input.modelNumber?.trim());
}

/** Step 1: saved product_models match by model/part (no manufacturer required). */
export function resolveManufacturerFromProductDatabase(
  input: ManufacturerResolverInput,
  products: ProductModelLike[],
): ManufacturerSuggestion | null {
  if (!hasModelNumber(input)) return null;

  const match = matchEquipmentInputToProduct(toMatchInput(input), products);

  if (match.matchedProduct?.manufacturer?.trim()) {
    const label = match.suggestions[0]?.label ?? match.matchedProduct.model_number ?? 'product record';
    return {
      manufacturer: match.matchedProduct.manufacturer.trim(),
      source: 'product_database',
      confidence: match.confidence,
      reason: `Matched ${label} in the product database.`,
      productId: match.matchedProduct.id,
    };
  }

  const topSuggestion = match.suggestions.find(suggestion => {
    const product = products.find(entry => entry.id === suggestion.productId);
    return Boolean(product?.manufacturer?.trim());
  });

  if (topSuggestion) {
    const product = products.find(entry => entry.id === topSuggestion.productId);
    if (product?.manufacturer?.trim()) {
      return {
        manufacturer: product.manufacturer.trim(),
        source: 'product_database',
        confidence: topSuggestion.confidence,
        reason: `Similar product in database: ${topSuggestion.label}.`,
        productId: product.id,
      };
    }
  }

  return null;
}

function formatInvokeError(message: string): string {
  if (message.includes('Failed to send a request to the Edge Function')) {
    return (
      'Manufacturer AI is not available. Deploy the suggest-manufacturer Edge Function in Supabase ' +
      '(Dashboard → Edge Functions → suggest-manufacturer).'
    );
  }
  return message;
}

/** Step 2: AI resolver via dedicated suggest-manufacturer Edge Function. */
export async function resolveManufacturerFromAi(
  input: ManufacturerResolverInput,
): Promise<ManufacturerSuggestion | { error: string }> {
  if (!hasModelNumber(input)) {
    return { error: MODEL_REQUIRED_MESSAGE };
  }

  const { data, error } = await supabase.functions.invoke('suggest-manufacturer', {
    body: {
      description: input.description ?? '',
      model: input.modelNumber ?? '',
      deviceType: input.deviceType ?? '',
    },
  });

  if (error) {
    return { error: formatInvokeError(error.message) };
  }

  if (data?.error) {
    return { error: String(data.error) };
  }

  const manufacturer = String(data?.manufacturer ?? '').trim();
  if (!manufacturer) {
    return { error: 'AI could not identify a manufacturer for this model and description.' };
  }

  const confidence = Number(data?.confidence);
  const reason = String(data?.reason ?? '').trim() || 'AI matched manufacturer from model and description.';

  return {
    manufacturer,
    source: 'ai',
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason,
    productId: null,
  };
}

/**
 * Manufacturer resolver flow for Systems page:
 * 1) product database by model/part
 * 2) suggest-manufacturer Edge Function (never find-datasheet)
 */
export async function resolveManufacturerSuggestion(
  input: ManufacturerResolverInput,
  products: ProductModelLike[],
): Promise<ManufacturerSuggestion | { error: string }> {
  if (!hasModelNumber(input)) {
    return { error: MODEL_REQUIRED_MESSAGE };
  }

  const fromDatabase = resolveManufacturerFromProductDatabase(input, products);
  if (fromDatabase) return fromDatabase;

  return resolveManufacturerFromAi(input);
}

/** @deprecated use ManufacturerResolverInput */
export type ManufacturerSuggestionContext = ManufacturerResolverInput;

/** @deprecated use resolveManufacturerFromProductDatabase */
export const findManufacturerFromProductDatabase = resolveManufacturerFromProductDatabase;
