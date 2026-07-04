import type { ProductModel } from '../types';
import {
  exactModelMatch,
  normalizeModelKey,
  normalizePart,
  normalizeToken,
  normalizedModelMatch,
} from './equipmentMatchUtils';

export type ProductLookupRecord = Pick<
  ProductModel,
  'id' | 'manufacturer' | 'model_number' | 'part_number' | 'model_name' | 'device_type' | 'category' | 'warranty_years'
>;

export interface ProductPartIndex {
  findByPartNumber(partNumber: string): ProductLookupRecord[];
  /** Closest / fuzzy matches — never returns exact part-number hits. */
  findSuggestedByPartNumber(partNumber: string): ProductLookupRecord[];
  /** @deprecated Use findByPartNumber + findSuggestedByPartNumber */
  findClosestByPartNumber(partNumber: string): ProductLookupRecord[];
}

const MIN_MATCH_KEY_LENGTH = 6;
const MAX_REVISION_SUFFIX = 5;

/** Part-like token in descriptions, e.g. QNV-6082R1, SPE-1630, GSC-5.13. */
const PARTLIKE_TOKEN =
  /\b([A-Z]{2,}(?:[-/][A-Z0-9][A-Z0-9./-]{0,})|[A-Z]{2,}\d{2,}[A-Z0-9-]*)\b/gi;

/** Strip Simpro variant suffixes: /VEX, -VEX, (notes), trailing dashes. */
export function stripSimproPartVariantSuffix(partNumber: string): string {
  let value = partNumber.trim().replace(/\([^)]*\)\s*$/g, '').trim();

  while (/\/[^/]+$/i.test(value)) {
    value = value.replace(/\/[^/]+$/i, '').trim();
  }

  const hyphenVariant = value.match(/^(.*)-([A-Z]{2,5})$/i);
  if (hyphenVariant && hyphenVariant[1].length >= MIN_MATCH_KEY_LENGTH && !/\d/.test(hyphenVariant[2])) {
    value = hyphenVariant[1].trim();
  }

  return value.replace(/-+$/, '').trim();
}

export function normalizeImportPartKey(value: string): string {
  return normalizeModelKey(stripSimproPartVariantSuffix(value));
}

export function extractPartLikeTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(PARTLIKE_TOKEN)) {
    const token = match[1]?.trim();
    if (token && normalizeImportPartKey(token).length >= MIN_MATCH_KEY_LENGTH) {
      tokens.push(token);
    }
  }
  return tokens;
}

function looksLikeStoredPartNumber(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < MIN_MATCH_KEY_LENGTH || trimmed.length > 40) return false;
  return /^[A-Z0-9][A-Z0-9\-/.]{2,}$/i.test(trimmed);
}

/** All part-bearing fields on a Product Database row. */
export function collectProductPartFields(product: ProductLookupRecord): string[] {
  const values: string[] = [];

  for (const field of [product.model_number, product.part_number]) {
    if (field?.trim()) values.push(field.trim());
  }

  const name = product.model_name?.trim();
  if (name) {
    if (looksLikeStoredPartNumber(name)) {
      values.push(name);
    } else {
      values.push(...extractPartLikeTokens(name));
    }
  }

  return values;
}

/** Raw + de-suffixed values to try for Simpro lookup. */
export function simproPartLookupVariants(partNumber: string): string[] {
  const trimmed = partNumber.trim();
  if (!trimmed) return [];

  const stripped = stripSimproPartVariantSuffix(trimmed);
  const variants = stripped !== trimmed ? [trimmed, stripped] : [trimmed];
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const variant of variants) {
    const key = normalizePart(variant);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(variant);
  }

  return unique;
}

function normalizedKeysCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const minLen = Math.min(a.length, b.length);
  if (minLen < MIN_MATCH_KEY_LENGTH) return false;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!longer.startsWith(shorter)) return false;

  const suffix = longer.slice(shorter.length);
  if (suffix.length === 0) return true;
  if (suffix.length > MAX_REVISION_SUFFIX) return false;
  if (!/^[A-Z0-9]+$/i.test(suffix)) return false;

  if (suffix.length >= 3 && longer.length / shorter.length > 1.12) return false;

  return true;
}

/** Simpro value contains the complete DB part before a /VEX-style suffix. */
export function simproPartContainsCompleteDbPart(simproPart: string, dbPart: string): boolean {
  for (const simpro of simproPartLookupVariants(simproPart)) {
    for (const db of simproPartLookupVariants(dbPart)) {
      if (!simpro.toLowerCase().startsWith(db.toLowerCase())) continue;
      const next = simpro[db.length];
      if (next == null || next === '/' || next === '-' || next === ' ') {
        return true;
      }
    }
  }
  return false;
}

/** True only for exact / normalized-equal part numbers (no /VEX strip, revision tails, or prefix rules). */
export function importPartNumbersExactMatch(simproPart: string, dbPart: string): boolean {
  const simpro = simproPart.trim();
  const db = dbPart.trim();
  if (!simpro || !db) return false;
  return exactModelMatch(simpro, db) || normalizedModelMatch(simpro, db);
}

/** True when Simpro and DB part numbers match exactly, by normalized key, revision tail, or prefix. */
export function importPartNumbersMatch(simproPart: string, dbPart: string): boolean {
  if (importPartNumbersExactMatch(simproPart, dbPart)) return true;

  for (const simpro of simproPartLookupVariants(simproPart)) {
    for (const db of simproPartLookupVariants(dbPart)) {
      if (normalizedKeysCompatible(normalizeModelKey(simpro), normalizeModelKey(db))) return true;
      if (simproPartContainsCompleteDbPart(simpro, db)) return true;
      if (simproPartContainsCompleteDbPart(db, simpro)) return true;
    }
  }
  return false;
}

function scoreSuggestedMatch(simproInput: string, dbField: string): number {
  return normalizeImportPartKey(dbField).length;
}

/** Closest matches only — excludes exact part-number pairs (those autofill without prompting). */
export function findSuggestedPartMatches(
  simproInput: string,
  products: ProductLookupRecord[],
): ProductLookupRecord[] {
  const simproVariants = simproPartLookupVariants(simproInput);
  if (simproVariants.length === 0) return [];

  let bestScore = 0;
  const matches = new Map<number, ProductLookupRecord>();

  for (const simpro of simproVariants) {
    for (const product of products) {
      for (const dbField of collectProductPartFields(product)) {
        if (importPartNumbersExactMatch(simpro, dbField)) continue;
        if (!importPartNumbersMatch(simpro, dbField)) continue;

        const score = scoreSuggestedMatch(simpro, dbField);
        if (score < bestScore) continue;

        if (score > bestScore) {
          matches.clear();
          bestScore = score;
        }

        matches.set(product.id, product);
      }
    }
  }

  return [...matches.values()];
}

/** O(1) part-number lookup index — build once per product list, reuse for every equipment line. */
export function buildProductPartIndex(products: ProductLookupRecord[]): ProductPartIndex {
  const buckets = new Map<string, ProductLookupRecord[]>();

  const addProduct = (key: string, product: ProductLookupRecord) => {
    if (!key) return;
    const list = buckets.get(key);
    if (list) {
      if (!list.some(entry => entry.id === product.id)) list.push(product);
    } else {
      buckets.set(key, [product]);
    }
  };

  for (const product of products) {
    for (const field of collectProductPartFields(product)) {
      addProduct(normalizeToken(field), product);
      addProduct(normalizePart(field), product);
      addProduct(normalizeModelKey(field), product);
      addProduct(normalizeImportPartKey(field), product);
    }
  }

  const lookupExact = (partNumber: string): ProductLookupRecord[] => {
    const trimmed = partNumber.trim();
    if (!trimmed) return [];

    const keys = [
      normalizeToken(trimmed),
      normalizePart(trimmed),
      normalizeModelKey(trimmed),
      normalizeImportPartKey(trimmed),
    ].filter(Boolean);

    const byId = new Map<number, ProductLookupRecord>();

    for (const key of keys) {
      for (const product of buckets.get(key) ?? []) {
        byId.set(product.id, product);
      }
    }

    return [...byId.values()];
  };

  return {
    findByPartNumber: lookupExact,

    findSuggestedByPartNumber(partNumber: string) {
      return findSuggestedPartMatches(partNumber, products);
    },

    findClosestByPartNumber(partNumber: string) {
      const exact = lookupExact(partNumber);
      if (exact.length > 0) return exact;
      return findSuggestedPartMatches(partNumber, products);
    },
  };
}
