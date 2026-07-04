import type { ProductModel } from '../types';
import Papa from 'papaparse';
import {
  normalizePart,
  normalizeToken,
} from './equipmentMatchUtils';
import {
  collectProductPartFields,
  importPartNumbersMatch,
} from './productLookupIndex';

export const PRODUCT_DATABASE_CSV_HEADERS = [
  'System',
  'Product Category',
  'Product Description',
  'Brand',
  'Manufacturers Part Number',
  'Warranty',
] as const;

/** Optional import-only columns (not shown in the main table). */
export const PRODUCT_DATABASE_OPTIONAL_IMPORT_HEADERS = ['Product Family'] as const;

export const PRODUCT_DATABASE_IMPORT_HEADERS = [
  ...PRODUCT_DATABASE_CSV_HEADERS,
  ...PRODUCT_DATABASE_OPTIONAL_IMPORT_HEADERS,
] as const;

export const PRODUCT_DATABASE_REQUIRED_HEADERS = [
  'Product Description',
  'Brand',
  'Manufacturers Part Number',
  'Product Category',
] as const;

export const DEFAULT_PRODUCT_WARRANTY_YEARS = 1;

export type ProductDatabaseCsvHeader = (typeof PRODUCT_DATABASE_CSV_HEADERS)[number];
export type ProductDatabaseImportHeader = (typeof PRODUCT_DATABASE_IMPORT_HEADERS)[number];

const ALL_IMPORT_HEADERS: ProductDatabaseImportHeader[] = [...PRODUCT_DATABASE_IMPORT_HEADERS];

export type ProductDatabaseImportMode = 'replace' | 'merge';

export type ProductDatabaseMatchMethod =
  | 'exact_part_number'
  | 'manufacturer_and_part_number';

export type ProductDatabasePreviewCategory = 'new' | 'updated' | 'skipped' | 'duplicate' | 'incomplete';

export type ProductDatabaseRequiredCsvField =
  | 'productDescription'
  | 'brand'
  | 'partNumber'
  | 'productCategory';

export const PRODUCT_DATABASE_REQUIRED_CSV_FIELDS: ProductDatabaseRequiredCsvField[] = [
  'productDescription',
  'brand',
  'partNumber',
  'productCategory',
];

export const REQUIRED_CSV_FIELD_LABELS: Record<ProductDatabaseRequiredCsvField, ProductDatabaseImportHeader> = {
  productDescription: 'Product Description',
  brand: 'Brand',
  partNumber: 'Manufacturers Part Number',
  productCategory: 'Product Category',
};

export interface ProductDatabaseCsvRow {
  rowNumber: number;
  system: string;
  productCategory: string;
  productDescription: string;
  brand: string;
  partNumber: string;
  productFamily: string;
  warranty: string;
}

export interface ProductDatabaseMappedRow {
  rowNumber: number;
  device_type: string | null;
  category: string | null;
  manufacturer: string | null;
  model_number: string | null;
  model_name: string | null;
  product_family: string | null;
  warranty_years: number | null;
  csv: ProductDatabaseCsvRow;
}

export interface ProductDatabasePreviewRow {
  category: ProductDatabasePreviewCategory;
  rowNumber: number;
  csv: ProductDatabaseCsvRow;
  mapped: ProductDatabaseMappedRow;
  matchMethod?: ProductDatabaseMatchMethod;
  existingProduct?: Pick<ProductModel, 'id' | 'manufacturer' | 'model_number' | 'model_name' | 'category'>;
  reason?: string;
  missingRequiredFields?: ProductDatabaseRequiredCsvField[];
  autofillSources?: string[];
}

export interface ProductDatabaseHeaderCorrection {
  original: string;
  canonical: ProductDatabaseImportHeader;
}

export interface ProductDatabaseHeaderNormalization {
  corrections: ProductDatabaseHeaderCorrection[];
  warnings: string[];
  errors: string[];
  columnMap: Map<number, ProductDatabaseImportHeader>;
  detectedHeaders: string[];
  ignoredHeaders: string[];
}

export interface ProductDatabaseParseDiagnostics {
  detectedHeaders: string[];
  normalizedHeaders: ProductDatabaseImportHeader[];
  parsedRowCount: number;
  rejectedRowCount: number;
  rejectionReasons: Record<string, number>;
  headerErrors: string[];
  headerWarnings: string[];
}

/** User-selected mapping from canonical import header → raw CSV header name. */
export type ProductDatabaseColumnMapping = Partial<Record<ProductDatabaseImportHeader, string>>;

export interface ProductDatabaseImportPreview {
  headers: ProductDatabaseCsvHeader[];
  rows: ProductDatabasePreviewRow[];
  summary: Record<ProductDatabasePreviewCategory, number>;
  mode: ProductDatabaseImportMode;
  parseError: string | null;
  headerNormalization?: ProductDatabaseHeaderNormalization;
  autofillFieldCount?: number;
  parseDiagnostics?: ProductDatabaseParseDiagnostics;
  columnMapping?: ProductDatabaseColumnMapping;
}

export const PRODUCT_DATABASE_MAPPING_FIELDS: Array<{
  header: ProductDatabaseImportHeader;
  required: boolean;
}> = [
  { header: 'System', required: false },
  { header: 'Product Category', required: true },
  { header: 'Product Description', required: true },
  { header: 'Brand', required: true },
  { header: 'Manufacturers Part Number', required: true },
  { header: 'Warranty', required: false },
  { header: 'Product Family', required: false },
];

export const PRODUCT_DATABASE_PREVIEW_COLUMNS: Array<{
  header: ProductDatabaseCsvHeader;
  field: Exclude<keyof ProductDatabaseCsvRow, 'rowNumber' | 'productFamily'>;
  mono?: boolean;
}> = [
  { header: 'System', field: 'system' },
  { header: 'Product Category', field: 'productCategory' },
  { header: 'Product Description', field: 'productDescription' },
  { header: 'Brand', field: 'brand' },
  { header: 'Manufacturers Part Number', field: 'partNumber', mono: true },
  { header: 'Warranty', field: 'warranty' },
];

function escapeCsvCell(value: string): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildProductDatabaseCsv(products: ProductModel[]): string {
  const headerRow = PRODUCT_DATABASE_CSV_HEADERS.map(escapeCsvCell).join(',');
  const dataRows = products.map(product => {
    const cells: string[] = [
      product.device_type || '',
      product.category || '',
      product.model_name || '',
      product.manufacturer || '',
      product.model_number || product.part_number || '',
      String(product.warranty_years ?? DEFAULT_PRODUCT_WARRANTY_YEARS),
    ];
    return cells.map(escapeCsvCell).join(',');
  });
  return [headerRow, ...dataRows].join('\n');
}

export function validateProductDatabaseHeaders(headers: string[]): string | null {
  const result = normalizeProductDatabaseHeaders(headers);
  if (result.errors.length > 0) {
    return result.errors.join(' ');
  }
  return null;
}

const HEADER_ALIASES: Record<ProductDatabaseImportHeader, string[]> = {
  System: ['system', 'device type', 'equipment type', 'product type'],
  'Product Description': [
    'product description',
    'description',
    'model name',
    'product name',
    'model description',
  ],
  Brand: ['brand', 'manufacturer', 'manufacturers', 'mfr', 'make', 'vendor'],
  'Manufacturers Part Number': [
    'manufacturers part number',
    'manufacturer part number',
    'part number',
    'model number',
    'part no',
    'part #',
    'sku',
    'catalogue number',
    'catalog number',
    'mpn',
  ],
  'Product Category': ['product category', 'category', 'product type', 'device type', 'equipment type'],
  'Product Family': ['product family', 'family', 'product line', 'series', 'line'],
  Warranty: ['warranty', 'warranty years', 'warranty period', 'warranty yrs'],
};

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, '');
}

function logProductDatabaseCsvParse(diagnostics: ProductDatabaseParseDiagnostics): void {
  console.info('[product-database-import] CSV parse diagnostics', diagnostics);
}

function headerMatchScore(raw: string, canonical: ProductDatabaseImportHeader): number {
  const normalizedRaw = normalizeHeaderToken(raw);
  const normalizedCanonical = normalizeHeaderToken(canonical);
  if (!normalizedRaw) return 0;
  if (normalizedRaw === normalizedCanonical) return 1;

  const aliases = HEADER_ALIASES[canonical];
  if (aliases.some(alias => normalizedRaw === alias)) return 0.98;
  if (aliases.some(alias => normalizedRaw.includes(alias) || alias.includes(normalizedRaw))) return 0.92;

  const rawTokens = new Set(normalizedRaw.split(' ').filter(Boolean));
  const canonicalTokens = new Set(normalizedCanonical.split(' ').filter(Boolean));
  let overlap = 0;
  for (const token of rawTokens) {
    if (canonicalTokens.has(token)) overlap += 1;
  }
  if (overlap > 0) {
    return 0.75 + (overlap / Math.max(rawTokens.size, canonicalTokens.size)) * 0.15;
  }

  return 0;
}

function normalizeHeaderToken(value: string): string {
  return stripBom(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeProductDatabaseHeaders(rawHeaders: string[]): ProductDatabaseHeaderNormalization {
  const detectedHeaders = rawHeaders.map(header => stripBom(header.trim()));
  const corrections: ProductDatabaseHeaderCorrection[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const ignoredHeaders: string[] = [];

  const nonEmptyCount = detectedHeaders.filter(header => header.length > 0).length;
  if (nonEmptyCount === 0) {
    errors.push('CSV has no column headers.');
    return { corrections, warnings, errors, columnMap: new Map(), detectedHeaders, ignoredHeaders };
  }

  const assignedCanonical = new Set<ProductDatabaseImportHeader>();
  const columnMap = new Map<number, ProductDatabaseImportHeader>();

  detectedHeaders.forEach((original, index) => {
    if (!original) {
      ignoredHeaders.push(`(empty column ${index + 1})`);
      return;
    }

    let bestHeader: ProductDatabaseImportHeader | null = null;
    let bestScore = 0;

    for (const canonical of ALL_IMPORT_HEADERS) {
      const score = headerMatchScore(original, canonical);
      if (score > bestScore) {
        bestScore = score;
        bestHeader = canonical;
      }
    }

    if (!bestHeader || bestScore < 0.72) {
      ignoredHeaders.push(original);
      warnings.push(`Ignored unrecognised column "${original}".`);
      return;
    }

    if (assignedCanonical.has(bestHeader)) {
      errors.push(`Column "${original}" maps to "${bestHeader}" which is already used by another column.`);
      return;
    }

    assignedCanonical.add(bestHeader);
    columnMap.set(index, bestHeader);

    if (original !== bestHeader) {
      corrections.push({ original, canonical: bestHeader });
      warnings.push(`Corrected column "${original}" → "${bestHeader}".`);
    }
  });

  for (const required of PRODUCT_DATABASE_REQUIRED_HEADERS) {
    if (!assignedCanonical.has(required)) {
      errors.push(`Missing required column "${required}".`);
    }
  }

  return { corrections, warnings, errors, columnMap, detectedHeaders, ignoredHeaders };
}

export function suggestColumnMapping(rawHeaders: string[]): {
  mapping: ProductDatabaseColumnMapping;
  detectedHeaders: string[];
} {
  const detectedHeaders = rawHeaders.map(header => stripBom(header.trim()));
  const usedIndices = new Set<number>();
  const mapping: ProductDatabaseColumnMapping = {};

  const assignOrder: ProductDatabaseImportHeader[] = [
    ...PRODUCT_DATABASE_REQUIRED_HEADERS,
    'System',
    'Product Family',
    'Warranty',
  ];

  for (const canonical of assignOrder) {
    let bestIndex = -1;
    let bestScore = 0;

    detectedHeaders.forEach((original, index) => {
      if (!original || usedIndices.has(index)) return;
      const score = headerMatchScore(original, canonical);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0 && bestScore >= 0.5) {
      mapping[canonical] = detectedHeaders[bestIndex];
      usedIndices.add(bestIndex);
    }
  }

  return { mapping, detectedHeaders };
}

export function columnMappingFromNormalization(
  normalization: ProductDatabaseHeaderNormalization,
): ProductDatabaseColumnMapping {
  const mapping: ProductDatabaseColumnMapping = {};
  normalization.columnMap.forEach((canonical, index) => {
    const raw = normalization.detectedHeaders[index];
    if (raw) mapping[canonical] = raw;
  });
  return mapping;
}

export function validateColumnMapping(mapping: ProductDatabaseColumnMapping): string[] {
  const errors: string[] = [];

  for (const required of PRODUCT_DATABASE_REQUIRED_HEADERS) {
    if (!mapping[required]?.trim()) {
      errors.push(`Select a column for "${required}".`);
    }
  }

  const usedRaw = new Map<string, ProductDatabaseImportHeader>();
  for (const [canonical, rawHeader] of Object.entries(mapping) as Array<
    [ProductDatabaseImportHeader, string | undefined]
  >) {
    if (!rawHeader?.trim()) continue;
    const existing = usedRaw.get(rawHeader);
    if (existing) {
      errors.push(`Column "${rawHeader}" is mapped to both "${existing}" and "${canonical}".`);
    } else {
      usedRaw.set(rawHeader, canonical);
    }
  }

  return errors;
}

export function buildHeaderNormalizationFromMapping(
  rawHeaders: string[],
  mapping: ProductDatabaseColumnMapping,
): ProductDatabaseHeaderNormalization {
  const detectedHeaders = rawHeaders.map(header => stripBom(header.trim()));
  const columnMap = new Map<number, ProductDatabaseImportHeader>();
  const corrections: ProductDatabaseHeaderCorrection[] = [];
  const warnings: string[] = [];
  const ignoredHeaders: string[] = [];

  for (const [canonical, rawHeader] of Object.entries(mapping) as Array<
    [ProductDatabaseImportHeader, string | undefined]
  >) {
    if (!rawHeader?.trim()) continue;
    const index = detectedHeaders.indexOf(rawHeader);
    if (index < 0) {
      warnings.push(`Mapped column "${rawHeader}" was not found in the CSV headers.`);
      continue;
    }
    columnMap.set(index, canonical);
    if (rawHeader !== canonical) {
      corrections.push({ original: rawHeader, canonical });
    }
  }

  detectedHeaders.forEach((header, index) => {
    if (header && !columnMap.has(index)) {
      ignoredHeaders.push(header);
    }
  });

  const errors = validateColumnMapping(mapping);

  return { corrections, warnings, errors, columnMap, detectedHeaders, ignoredHeaders };
}

export function remapCsvRecordsWithColumnMapping(
  records: Record<string, string>[],
  mapping: ProductDatabaseColumnMapping,
): Record<string, string>[] {
  return records.map(record => {
    const canonicalRecord: Record<string, string> = {};
    for (const header of ALL_IMPORT_HEADERS) {
      canonicalRecord[header] = '';
    }

    for (const canonical of ALL_IMPORT_HEADERS) {
      const rawHeader = mapping[canonical];
      if (!rawHeader) continue;
      canonicalRecord[canonical] = String(record[rawHeader] ?? '').trim();
    }

    return canonicalRecord;
  });
}

export function likelyWrongColumnMapping(preview: ProductDatabaseImportPreview): boolean {
  if (preview.rows.length === 0) return true;
  if (preview.summary.new + preview.summary.updated > 0) return false;

  const nonSkipped = preview.rows.filter(row => row.category !== 'skipped');
  if (nonSkipped.length === 0) return true;

  return preview.summary.incomplete / nonSkipped.length > 0.5;
}

export interface ParsedProductDatabaseCsv {
  records: Record<string, string>[];
  headers: string[];
  delimiter: string;
}

export function parseProductDatabaseCsvText(text: string): ParsedProductDatabaseCsv {
  const tryParse = (delimiter: string | undefined) =>
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      delimiter,
    });

  let parsed = tryParse('');
  let best = parsed;
  let bestFieldCount = parsed.meta.fields?.filter(Boolean).length ?? 0;

  for (const delimiter of ['\t', ',', ';', '|']) {
    const candidate = tryParse(delimiter);
    const fieldCount = candidate.meta.fields?.filter(Boolean).length ?? 0;
    if (fieldCount > bestFieldCount) {
      best = candidate;
      bestFieldCount = fieldCount;
    }
  }

  parsed = best;

  return {
    records: parsed.data ?? [],
    headers: parsed.meta.fields ?? [],
    delimiter: parsed.meta.delimiter ?? ',',
  };
}

export function prepareProductDatabaseImportRowsWithMapping(
  records: Record<string, string>[],
  rawHeaders: string[],
  mapping: ProductDatabaseColumnMapping,
  existingProducts: ProductModel[],
  startRowNumber = 2,
): {
  rows: ProductDatabaseCsvRow[];
  normalization: ProductDatabaseHeaderNormalization;
  autofillFieldCount: number;
  errors: string[];
  columnMapping: ProductDatabaseColumnMapping;
} {
  const mappingErrors = validateColumnMapping(mapping);
  const normalization = buildHeaderNormalizationFromMapping(rawHeaders, mapping);

  if (mappingErrors.length > 0) {
    return {
      rows: [],
      normalization,
      autofillFieldCount: 0,
      errors: mappingErrors,
      columnMapping: mapping,
    };
  }

  const canonicalRecords = remapCsvRecordsWithColumnMapping(records, mapping);
  const mappedRows = canonicalRecords.map((record, index) =>
    mapCsvRecordToRow(record, startRowNumber + index),
  );
  const { rows, filledFieldCount } = autofillCsvRowsFromDatabase(mappedRows, existingProducts);

  return {
    rows,
    normalization,
    autofillFieldCount: filledFieldCount,
    errors: [],
    columnMapping: mapping,
  };
}

export function remapCsvRecordsToCanonicalHeaders(
  records: Record<string, string>[],
  rawHeaders: string[],
): { records: Record<string, string>[]; normalization: ProductDatabaseHeaderNormalization } {
  const normalization = normalizeProductDatabaseHeaders(rawHeaders);

  if (normalization.errors.length > 0) {
    return { records: [], normalization };
  }

  const remapped = records.map(record => {
    const canonicalRecord: Record<string, string> = {};
    for (const header of ALL_IMPORT_HEADERS) {
      canonicalRecord[header] = '';
    }

    rawHeaders.forEach((rawHeader, index) => {
      const canonical = normalization.columnMap.get(index);
      if (!canonical) return;
      const value = String(record[rawHeader] ?? '').trim();
      if (!canonicalRecord[canonical] || value) {
        canonicalRecord[canonical] = value;
      }
    });

    return canonicalRecord;
  });

  return { records: remapped, normalization };
}

export function getRowMissingRequiredFields(row: ProductDatabaseCsvRow): ProductDatabaseRequiredCsvField[] {
  const missing: ProductDatabaseRequiredCsvField[] = [];
  if (!row.productDescription.trim()) missing.push('productDescription');
  if (!row.brand.trim()) missing.push('brand');
  if (!row.partNumber.trim()) missing.push('partNumber');
  if (!row.productCategory.trim()) missing.push('productCategory');
  return missing;
}

export function isCsvRowEmpty(row: ProductDatabaseCsvRow): boolean {
  return (
    !row.system.trim() &&
    !row.productDescription.trim() &&
    !row.brand.trim() &&
    !row.partNumber.trim() &&
    !row.productCategory.trim() &&
    !row.productFamily.trim() &&
    !row.warranty.trim()
  );
}

export function descriptionMatchScore(description: string, product: ProductModel): number {
  const left = normalizeToken(description);
  const right = normalizeToken(
    [product.model_name, product.model_number, product.category].filter(Boolean).join(' '),
  );
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.includes(left) || left.includes(right)) return 0.9;

  const leftTokens = new Set(left.split(' ').filter(token => token.length > 2));
  const rightTokens = new Set(right.split(' ').filter(token => token.length > 2));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function findAutofillProduct(
  row: ProductDatabaseCsvRow,
  products: ProductModel[],
): { product: ProductModel; reason: string } | null {
  if (row.partNumber.trim()) {
    const mapped = mapCsvRowToProductFields(row);
    const { matches, method } = findMergeMatches(mapped, products);
    if (matches.length === 1) {
      return {
        product: matches[0],
        reason: `Matched existing product #${matches[0].id} by ${method?.replace(/_/g, ' ') ?? 'part number'}.`,
      };
    }
  }

  if (row.brand.trim() && row.productDescription.trim()) {
    const candidates = products.filter(product => manufacturerMatches(product, row.brand));
    const scored = candidates
      .map(product => ({ product, score: descriptionMatchScore(row.productDescription, product) }))
      .filter(entry => entry.score >= 0.6)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) {
      return {
        product: scored[0].product,
        reason: `Matched existing product #${scored[0].product.id} by manufacturer and description.`,
      };
    }
  }

  if (row.productDescription.trim()) {
    const scored = products
      .map(product => ({ product, score: descriptionMatchScore(row.productDescription, product) }))
      .filter(entry => entry.score >= 0.85)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) {
      return {
        product: scored[0].product,
        reason: `Matched existing product #${scored[0].product.id} by description.`,
      };
    }
  }

  return null;
}

export function autofillCsvRowFromDatabase(
  row: ProductDatabaseCsvRow,
  products: ProductModel[],
): { row: ProductDatabaseCsvRow; filledFields: string[]; source?: string } {
  if (isCsvRowEmpty(row)) {
    return { row, filledFields: [] };
  }

  const match = findAutofillProduct(row, products);
  if (!match) {
    return { row, filledFields: [] };
  }

  const { product, reason } = match;
  const filledFields: string[] = [];
  const next: ProductDatabaseCsvRow = { ...row };

  const fill = (field: keyof ProductDatabaseCsvRow, label: string, value: string | null | undefined) => {
    if (next[field].trim() || !value?.trim()) return;
    next[field] = value.trim();
    filledFields.push(label);
  };

  fill('brand', 'Brand', product.manufacturer);
  fill('partNumber', 'Manufacturers Part Number', product.model_number ?? product.part_number);
  fill('productCategory', 'Product Category', product.category);
  fill('productDescription', 'Product Description', product.model_name);
  fill('system', 'System', product.device_type);
  if (!next.warranty.trim() && product.warranty_years != null) {
    next.warranty = String(product.warranty_years);
    filledFields.push('Warranty');
  }

  return {
    row: next,
    filledFields,
    source: filledFields.length > 0 ? reason : undefined,
  };
}

export function autofillCsvRowsFromDatabase(
  rows: ProductDatabaseCsvRow[],
  products: ProductModel[],
): { rows: ProductDatabaseCsvRow[]; filledFieldCount: number } {
  let filledFieldCount = 0;
  const nextRows = rows.map(row => {
    const result = autofillCsvRowFromDatabase(row, products);
    filledFieldCount += result.filledFields.length;
    return result.row;
  });
  return { rows: nextRows, filledFieldCount };
}

export function prepareProductDatabaseImportRows(
  records: Record<string, string>[],
  rawHeaders: string[],
  existingProducts: ProductModel[],
  startRowNumber = 2,
): {
  rows: ProductDatabaseCsvRow[];
  normalization: ProductDatabaseHeaderNormalization;
  autofillFieldCount: number;
  errors: string[];
  diagnostics?: ProductDatabaseParseDiagnostics;
} {
  const { records: canonicalRecords, normalization } = remapCsvRecordsToCanonicalHeaders(records, rawHeaders);
  if (normalization.errors.length > 0) {
    const diagnostics: ProductDatabaseParseDiagnostics = {
      detectedHeaders: normalization.detectedHeaders,
      normalizedHeaders: [...normalization.columnMap.values()],
      parsedRowCount: 0,
      rejectedRowCount: records.length,
      rejectionReasons: { header_error: records.length },
      headerErrors: normalization.errors,
      headerWarnings: [...normalization.warnings, ...normalization.ignoredHeaders.map(h => `ignored:${h}`)],
    };
    logProductDatabaseCsvParse(diagnostics);
    return {
      rows: [],
      normalization,
      autofillFieldCount: 0,
      errors: normalization.errors,
      diagnostics,
    };
  }

  const mappedRows = canonicalRecords.map((record, index) =>
    mapCsvRecordToRow(record, startRowNumber + index),
  );
  const { rows, filledFieldCount } = autofillCsvRowsFromDatabase(mappedRows, existingProducts);

  return {
    rows,
    normalization,
    autofillFieldCount: filledFieldCount,
    errors: [],
    diagnostics: undefined,
  };
}

export function importPreviewHasBlockingIssues(preview: ProductDatabaseImportPreview): boolean {
  return preview.summary.incomplete > 0;
}

export function importPreviewCanApply(preview: ProductDatabaseImportPreview): boolean {
  return (
    !importPreviewHasBlockingIssues(preview) &&
    preview.summary.new + preview.summary.updated > 0
  );
}

function nullIfEmpty(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text || null;
}

function parseWarrantyYears(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_PRODUCT_WARRANTY_YEARS;
  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PRODUCT_WARRANTY_YEARS;
}

export function csvRowDisplayValues(row: ProductDatabaseCsvRow): string[] {
  return PRODUCT_DATABASE_PREVIEW_COLUMNS.map(column => {
    const value = row[column.field];
    if (column.field === 'warranty') {
      return value.trim() || String(DEFAULT_PRODUCT_WARRANTY_YEARS);
    }
    return value;
  });
}

export function mapCsvRecordToRow(
  record: Record<string, string>,
  rowNumber: number,
): ProductDatabaseCsvRow {
  return {
    rowNumber,
    system: String(record.System ?? '').trim(),
    productCategory: String(record['Product Category'] ?? '').trim(),
    productDescription: String(record['Product Description'] ?? '').trim(),
    brand: String(record.Brand ?? '').trim(),
    partNumber: String(record['Manufacturers Part Number'] ?? '').trim(),
    productFamily: String(record['Product Family'] ?? '').trim(),
    warranty: String(record.Warranty ?? '').trim(),
  };
}

export function mapCsvRowToProductFields(row: ProductDatabaseCsvRow): ProductDatabaseMappedRow {
  return {
    rowNumber: row.rowNumber,
    device_type: nullIfEmpty(row.system),
    category: nullIfEmpty(row.productCategory),
    manufacturer: nullIfEmpty(row.brand),
    model_number: nullIfEmpty(row.partNumber),
    model_name: nullIfEmpty(row.productDescription),
    product_family: nullIfEmpty(row.productFamily),
    warranty_years: parseWarrantyYears(row.warranty),
    csv: row,
  };
}

function partNumberMatches(product: ProductModel, partNumber: string): boolean {
  for (const field of collectProductPartFields(product)) {
    if (importPartNumbersMatch(partNumber, field)) return true;
  }
  return false;
}

function manufacturerMatches(product: ProductModel, manufacturer: string): boolean {
  return normalizeToken(product.manufacturer) === normalizeToken(manufacturer);
}

/** Match Product Database rows by Part Number (exact, then Manufacturer + Part Number). */
export function findProductsByPartNumber(
  partNumber: string,
  products: ProductModel[],
): { matches: ProductModel[]; method: ProductDatabaseMatchMethod | null } {
  const trimmed = partNumber.trim();
  if (!trimmed) return { matches: [], method: null };

  return findMergeMatches(
    {
      rowNumber: 0,
      device_type: null,
      category: null,
      manufacturer: null,
      model_number: trimmed,
      model_name: null,
      product_family: null,
      warranty_years: null,
      csv: {
        rowNumber: 0,
        system: '',
        productDescription: '',
        brand: '',
        partNumber: trimmed,
        productCategory: '',
        productFamily: '',
        warranty: '',
      },
    },
    products,
  );
}

/** @deprecated Use findProductsByPartNumber */
export const findProductsByManufacturersPartNumber = findProductsByPartNumber;

function findMergeMatches(
  mapped: ProductDatabaseMappedRow,
  products: ProductModel[],
): { matches: ProductModel[]; method: ProductDatabaseMatchMethod | null } {
  const partNumber = mapped.model_number;
  const manufacturer = mapped.manufacturer;
  if (!partNumber) return { matches: [], method: null };

  const exact = products.filter(product => partNumberMatches(product, partNumber));
  if (exact.length === 1) {
    return { matches: exact, method: 'exact_part_number' };
  }

  if (manufacturer && exact.length > 1) {
    const narrowed = exact.filter(product => manufacturerMatches(product, manufacturer));
    if (narrowed.length >= 1) {
      return { matches: narrowed, method: 'manufacturer_and_part_number' };
    }
  }

  if (exact.length > 1) {
    return { matches: exact, method: 'exact_part_number' };
  }

  if (manufacturer) {
    const manufacturerAndPart = products.filter(
      product => manufacturerMatches(product, manufacturer) && partNumberMatches(product, partNumber),
    );
    if (manufacturerAndPart.length >= 1) {
      return { matches: manufacturerAndPart, method: 'manufacturer_and_part_number' };
    }
  }

  return { matches: [], method: null };
}

function buildSummary(rows: ProductDatabasePreviewRow[]): Record<ProductDatabasePreviewCategory, number> {
  return rows.reduce(
    (counts, row) => {
      counts[row.category] += 1;
      return counts;
    },
    { new: 0, updated: 0, skipped: 0, duplicate: 0, incomplete: 0 },
  );
}

export function buildProductDatabaseImportPreview(
  csvRows: ProductDatabaseCsvRow[],
  existingProducts: ProductModel[],
  mode: ProductDatabaseImportMode,
  meta?: Pick<ProductDatabaseImportPreview, 'headerNormalization' | 'autofillFieldCount'>,
): ProductDatabaseImportPreview {
  const previewRows: ProductDatabasePreviewRow[] = [];
  const seenPartKeys = new Map<string, number>();
  const claimedProductIds = new Set<number>();

  const rejectionReasons: Record<string, number> = {};

  for (const csvRow of csvRows) {
    const mapped = mapCsvRowToProductFields(csvRow);
    const missingRequiredFields = getRowMissingRequiredFields(csvRow);

    if (isCsvRowEmpty(csvRow)) {
      rejectionReasons.skipped_empty = (rejectionReasons.skipped_empty ?? 0) + 1;
      previewRows.push({
        category: 'skipped',
        rowNumber: csvRow.rowNumber,
        csv: csvRow,
        mapped,
        reason: 'Empty row.',
      });
      continue;
    }

    if (missingRequiredFields.length > 0) {
      rejectionReasons.incomplete = (rejectionReasons.incomplete ?? 0) + 1;
      previewRows.push({
        category: 'incomplete',
        rowNumber: csvRow.rowNumber,
        csv: csvRow,
        mapped,
        missingRequiredFields,
        reason: `Missing required field${missingRequiredFields.length === 1 ? '' : 's'}: ${missingRequiredFields
          .map(field => REQUIRED_CSV_FIELD_LABELS[field])
          .join(', ')}.`,
      });
      continue;
    }

    const partKey = normalizePart(mapped.model_number);
    if (partKey) {
      const firstRow = seenPartKeys.get(partKey);
      if (firstRow != null) {
        rejectionReasons.duplicate_in_csv = (rejectionReasons.duplicate_in_csv ?? 0) + 1;
        previewRows.push({
          category: 'duplicate',
          rowNumber: csvRow.rowNumber,
          csv: csvRow,
          mapped,
          reason: `Duplicate Part Number (same as row ${firstRow}).`,
        });
        continue;
      }
      seenPartKeys.set(partKey, csvRow.rowNumber);
    }

    if (mode === 'replace') {
      previewRows.push({
        category: 'new',
        rowNumber: csvRow.rowNumber,
        csv: csvRow,
        mapped,
        reason: 'Will be inserted after replacing the Product Database.',
      });
      continue;
    }

    const { matches, method } = findMergeMatches(mapped, existingProducts);
    if (matches.length > 1) {
      rejectionReasons.duplicate_existing = (rejectionReasons.duplicate_existing ?? 0) + 1;
      previewRows.push({
        category: 'duplicate',
        rowNumber: csvRow.rowNumber,
        csv: csvRow,
        mapped,
        matchMethod: method ?? undefined,
        reason: `Multiple existing products match (${matches.map(product => `#${product.id}`).join(', ')}).`,
      });
      continue;
    }

    if (matches.length === 1) {
      const existing = matches[0];
      if (claimedProductIds.has(existing.id)) {
        rejectionReasons.duplicate_claimed = (rejectionReasons.duplicate_claimed ?? 0) + 1;
        previewRows.push({
          category: 'duplicate',
          rowNumber: csvRow.rowNumber,
          csv: csvRow,
          mapped,
          matchMethod: method ?? undefined,
          existingProduct: existing,
          reason: `Existing product #${existing.id} is already matched by another CSV row.`,
        });
        continue;
      }

      claimedProductIds.add(existing.id);
      previewRows.push({
        category: 'updated',
        rowNumber: csvRow.rowNumber,
        csv: csvRow,
        mapped,
        matchMethod: method ?? undefined,
        existingProduct: existing,
        reason: `Matched existing product #${existing.id} via ${method?.replace(/_/g, ' ') ?? 'lookup'}.`,
      });
      continue;
    }

    previewRows.push({
      category: 'new',
      rowNumber: csvRow.rowNumber,
      csv: csvRow,
      mapped,
      reason: 'No existing product match — will be inserted.',
    });
  }

  const summary = buildSummary(previewRows);
  const importableCount = summary.new + summary.updated;
  const rejectedRowCount =
    summary.skipped + summary.duplicate + summary.incomplete;

  const parseDiagnostics: ProductDatabaseParseDiagnostics = {
    detectedHeaders: meta?.headerNormalization?.detectedHeaders ?? [],
    normalizedHeaders: meta?.headerNormalization
      ? [...meta.headerNormalization.columnMap.values()]
      : [],
    parsedRowCount: csvRows.length,
    rejectedRowCount,
    rejectionReasons,
    headerErrors: meta?.headerNormalization?.errors ?? [],
    headerWarnings: meta?.headerNormalization?.warnings ?? [],
  };

  logProductDatabaseCsvParse({
    ...parseDiagnostics,
    importableRowCount: importableCount,
    previewCounts: summary,
  } as ProductDatabaseParseDiagnostics & { importableRowCount: number; previewCounts: typeof summary });

  return {
    headers: [...PRODUCT_DATABASE_CSV_HEADERS],
    rows: previewRows,
    summary,
    mode,
    parseError: null,
    headerNormalization: meta?.headerNormalization,
    autofillFieldCount: meta?.autofillFieldCount,
    parseDiagnostics,
  };
}

export function updateImportCsvRowField(
  rows: ProductDatabaseCsvRow[],
  rowNumber: number,
  field: Exclude<keyof ProductDatabaseCsvRow, 'rowNumber'>,
  value: string,
): ProductDatabaseCsvRow[] {
  return rows.map(row => (row.rowNumber === rowNumber ? { ...row, [field]: value } : row));
}

export const CSV_FIELD_TO_HEADER: Record<Exclude<keyof ProductDatabaseCsvRow, 'rowNumber'>, ProductDatabaseImportHeader> = {
  system: 'System',
  productCategory: 'Product Category',
  productDescription: 'Product Description',
  brand: 'Brand',
  partNumber: 'Manufacturers Part Number',
  productFamily: 'Product Family',
  warranty: 'Warranty',
};

export function previewRowToInsertPayload(row: ProductDatabaseMappedRow): Record<string, unknown> {
  return {
    manufacturer: row.manufacturer,
    model_number: row.model_number,
    part_number: row.model_number,
    model_name: row.model_name,
    category: row.category,
    device_type: row.device_type,
    product_family: row.product_family,
    warranty_years: row.warranty_years ?? DEFAULT_PRODUCT_WARRANTY_YEARS,
  };
}

export function previewRowToUpdatePayload(
  row: ProductDatabaseMappedRow,
  existing?: Pick<ProductModel, 'warranty_years'> | null,
): Record<string, unknown> {
  return {
    ...previewRowToInsertPayload(row),
    warranty_years: row.warranty_years ?? existing?.warranty_years ?? DEFAULT_PRODUCT_WARRANTY_YEARS,
  };
}
