import { supabase } from './supabase';
import {
  buildProductDatabaseCsv,
  previewRowToInsertPayload,
  previewRowToUpdatePayload,
  type ProductDatabaseImportPreview,
  type ProductDatabasePreviewRow,
} from './productDatabaseCsv';
import type { ProductModel } from '../types';

const INSERT_BATCH = 100;
const PAGE_SIZE = 1000;

const PRODUCT_LOOKUP_COLUMNS =
  'id, manufacturer, model_number, part_number, model_name, device_type, category, warranty_years';

let cachedProducts: ProductModel[] | null = null;
let cachePromise: Promise<{ products: ProductModel[]; error: string | null }> | null = null;

export function invalidateProductModelsCache(): void {
  cachedProducts = null;
  cachePromise = null;
}

async function fetchAllProductModelsUncached(): Promise<{ products: ProductModel[]; error: string | null }> {
  const products: ProductModel[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('product_models')
      .select(PRODUCT_LOOKUP_COLUMNS)
      .order('manufacturer', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) return { products: [], error: error.message };

    const page = (data ?? []) as ProductModel[];
    products.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { products, error: null };
}

/** Load all product_models rows (PostgREST default max is 1000 per request). Cached for the session. */
export async function fetchAllProductModels(): Promise<{ products: ProductModel[]; error: string | null }> {
  if (cachedProducts) {
    return { products: cachedProducts, error: null };
  }

  if (cachePromise) {
    return cachePromise;
  }

  cachePromise = fetchAllProductModelsUncached().then(result => {
    cachePromise = null;
    if (!result.error) {
      cachedProducts = result.products;
    }
    return result;
  });

  return cachePromise;
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportProductDatabaseBackup(): Promise<{ error: string | null }> {
  const { products, error } = await fetchAllProductModels();
  if (error) return { error };

  const stamp = new Date().toISOString().slice(0, 10);
  const csv = buildProductDatabaseCsv(products);
  downloadCsv(csv, `product-database-backup-${stamp}.csv`);
  console.info('[product-database] Exported backup', { rowCount: products.length });
  return { error: null };
}

/** Deletes all product_models rows only — datasheets, manuals, and devices are untouched. */
export async function wipeProductDatabase(): Promise<{ error: string | null; deletedCount: number | null }> {
  const { count, error: countError } = await supabase
    .from('product_models')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    return { error: countError.message, deletedCount: null };
  }

  const { error } = await supabase.from('product_models').delete().gte('id', 0);
  if (error) {
    return { error: error.message, deletedCount: null };
  }

  console.info('[product-database] Wiped Product Database', { deletedCount: count ?? 0 });
  invalidateProductModelsCache();
  return { error: null, deletedCount: count ?? 0 };
}

function actionableRows(preview: ProductDatabaseImportPreview): ProductDatabasePreviewRow[] {
  return preview.rows.filter(row => row.category === 'new' || row.category === 'updated');
}

export async function applyProductDatabaseImport(
  preview: ProductDatabaseImportPreview,
): Promise<{ error: string | null; inserted: number; updated: number }> {
  const rows = actionableRows(preview);
  let inserted = 0;
  let updated = 0;

  if (preview.mode === 'replace') {
    const wipeResult = await wipeProductDatabase();
    if (wipeResult.error) {
      return { error: wipeResult.error, inserted: 0, updated: 0 };
    }

    const insertRows = rows
      .filter(row => row.category === 'new')
      .map(row => previewRowToInsertPayload(row.mapped));

    for (let offset = 0; offset < insertRows.length; offset += INSERT_BATCH) {
      const batch = insertRows.slice(offset, offset + INSERT_BATCH);
      const { error } = await supabase.from('product_models').insert(batch);
      if (error) {
        return { error: error.message, inserted, updated };
      }
      inserted += batch.length;
    }

    console.info('[product-database] Replace import complete', {
      inserted,
      skipped: preview.summary.skipped,
      duplicate: preview.summary.duplicate,
    });
    invalidateProductModelsCache();
    return { error: null, inserted, updated: 0 };
  }

  const toInsert = rows.filter(row => row.category === 'new').map(row => previewRowToInsertPayload(row.mapped));
  for (let offset = 0; offset < toInsert.length; offset += INSERT_BATCH) {
    const batch = toInsert.slice(offset, offset + INSERT_BATCH);
    const { error } = await supabase.from('product_models').insert(batch);
    if (error) {
      return { error: error.message, inserted, updated };
    }
    inserted += batch.length;
  }

  for (const row of rows.filter(entry => entry.category === 'updated')) {
    if (!row.existingProduct?.id) continue;
    const { error } = await supabase
      .from('product_models')
      .update(previewRowToUpdatePayload(row.mapped, row.existingProduct))
      .eq('id', row.existingProduct.id);
    if (error) {
      return { error: error.message, inserted, updated };
    }
    updated += 1;
  }

  console.info('[product-database] Merge import complete', {
    inserted,
    updated,
    skipped: preview.summary.skipped,
    duplicate: preview.summary.duplicate,
  });

  invalidateProductModelsCache();
  return { error: null, inserted, updated };
}
