import type { SystemCategory } from '../../../types';
import type { ImportReviewIssue } from '../../models/ImportReviewDraft';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function pickString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function pickNestedName(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return pickString(value);
  return (
    pickString(record.Name) ??
    pickString(record.name) ??
    pickString(record.CompanyName) ??
    pickString(record.company_name)
  );
}

export function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

export function htmlToPlainText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = doc.body.textContent ?? '';
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

export function cleanTextField(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value);
  return looksLikeHtml(raw) ? htmlToPlainText(raw) : raw.trim();
}

/** User-facing job number — not the internal Simpro ID and not the job title. */
export function pickSimproJobNumber(record: Record<string, unknown>): string | null {
  for (const key of ['JobNo', 'OrderNo', 'RequestNo', 'Reference']) {
    const value = pickString(record[key]);
    if (value) return value;
  }
  return null;
}

export function pickSimproJobId(
  record: Record<string, unknown>,
  overrideId?: string | number | null,
): string | null {
  return (
    pickString(overrideId) ??
    pickString(record.ID) ??
    pickString(record.Id) ??
    pickString(record.id)
  );
}

/** Best project title from Simpro name/description — avoids using job numbers as the title. */
export function pickProjectName(record: Record<string, unknown>): string | null {
  const name = pickString(record.Name) ?? pickString(record.name);
  if (name) return name;

  const description = cleanTextField(record.Description);
  if (!description) return null;

  const firstLine = description.split('\n').map(line => line.trim()).find(Boolean);
  if (!firstLine) return null;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}

/** Scope of Works defaults to cleaned Simpro Description only. */
export function pickScopeOfWorks(record: Record<string, unknown>): string | null {
  return cleanTextField(record.Description);
}

export function pickRawDescriptionHtml(record: Record<string, unknown>): string | null {
  const raw = record.Description;
  if (raw == null) return null;
  const text = String(raw).trim();
  return text || null;
}

const CATEGORY_RULES: { category: SystemCategory; patterns: RegExp[] }[] = [
  {
    category: 'Security',
    patterns: [
      /\bcctv\b/i, /\bcamera/i, /\bnvr\b/i, /\bdvr\b/i, /\baccess control/i, /\bintruder/i,
      /\bintercom/i, /\banpr\b/i, /\bperimeter/i, /\bsecurity\b/i, /\balarm\b/i,
    ],
  },
  {
    category: 'Fire',
    patterns: [/\bfire alarm/i, /\bfire detect/i, /\bsprinkler/i, /\bfire panel/i],
  },
  {
    category: 'Electrical',
    patterns: [/\belectrical/i, /\blv switch/i, /\bdistribution board/i, /\bpower\b/i],
  },
  {
    category: 'Mechanical',
    patterns: [/\bmechanical/i, /\bpump\b/i, /\bplant room/i],
  },
  {
    category: 'HVAC',
    patterns: [/\bhvac\b/i, /\bair handling/i, /\bahu\b/i, /\bchiller/i, /\bventilation/i],
  },
  {
    category: 'Plumbing',
    patterns: [/\bplumb/i, /\bdomestic water/i, /\bdrainage/i],
  },
  {
    category: 'Audio Visual',
    patterns: [/\baudio visual/i, /\bav system/i, /\bdisplay\b/i, /\bprojector/i],
  },
  {
    category: 'IT',
    patterns: [/\bnetwork/i, /\bswitch\b/i, /\brouter\b/i, /\bdata cab/i, /\bstructured cabling/i, /\bserver/i],
  },
  {
    category: 'Building Fabric',
    patterns: [/\bbuilding fabric/i, /\bdoor hardware/i, /\bglazing/i],
  },
];

export function inferCategoryFromTexts(texts: (string | null | undefined)[]): {
  suggestedCategory: SystemCategory | null;
  confidence: number;
  method: 'keyword_rule' | 'unresolved';
} {
  const combined = texts.filter(Boolean).join(' ');
  if (!combined.trim()) {
    return { suggestedCategory: null, confidence: 0, method: 'unresolved' };
  }

  let bestCategory: SystemCategory | null = null;
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(combined)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }

  if (!bestCategory || bestScore === 0) {
    return { suggestedCategory: null, confidence: 0, method: 'unresolved' };
  }

  return {
    suggestedCategory: bestCategory,
    confidence: Math.min(0.95, 0.35 + bestScore * 0.12),
    method: 'keyword_rule',
  };
}

/** @deprecated Use inferCategoryFromTexts */
export function inferSystemTypeFromTexts(texts: (string | null | undefined)[]) {
  const result = inferCategoryFromTexts(texts);
  return {
    suggestedSystemType: null,
    confidence: result.confidence,
    method: result.method,
  };
}

function mergeCatalogFields(line: Record<string, unknown>): Record<string, unknown> {
  const catalog = asRecord(line.Catalog ?? line.Catalogue ?? line.catalog);
  if (!catalog) return line;
  return { ...catalog, ...line };
}

/** Authoritative Simpro quantity fields only — never IDs, refs, or unit-of-measure codes. */
const SIMPRO_QUANTITY_KEYS = [
  'Qty',
  'Quantity',
  'quantity',
  'BillableQty',
  'SellQty',
  'OrderQty',
  'Count',
] as const;

const QUANTITY_KEY_BLOCKLIST = new Set([
  'id',
  'itemid',
  'catalogid',
  'catalogueid',
  'sourceref',
  'sectionid',
  'displayorder',
  'units',
  'unitqty',
  'totalqty',
  'orderedqty',
  'noofunits',
]);

const COMMERCIAL_ITEM_GROUP_KEYS = new Set([
  'labors',
  'labor',
  'labour',
  'labours',
  'servicefees',
  'servicefee',
  'service fees',
]);

const SKIP_COLLECTION_GROUP_KEYS = new Set([
  'labors',
  'labor',
  'labour',
  'labours',
  'servicefees',
  'servicefee',
  'service fees',
]);

const COMMERCIAL_LINE_PATTERNS: RegExp[] = [
  /\blabou?r day rate\b/i,
  /\blabou?r\b/i,
  /\bcommissioning engineer\b/i,
  /\bcommissioning\b/i,
  /\bproject manager day rate\b/i,
  /\bproject management\b/i,
  /\badministration\b/i,
  /\bfreight\b/i,
  /\bdelivery\b/i,
  /\bcarriage\b/i,
  /\bcontingency\b/i,
  /\bprelims?\b/i,
  /\bpreliminaries\b/i,
  /\bsundries\b/i,
  /\bservice charge\b/i,
  /\bservice fee\b/i,
  /\bcall[\s-]?out charge\b/i,
  /\bextra charge\b/i,
  /\bextra\b/i,
];

const PREBUILD_CHILD_COLLECTION_KEYS = [
  'Catalogs',
  'Catalogues',
  'catalogs',
  'Stock',
  'CatalogItems',
  'Components',
  'Lines',
] as const;

function normalizeItemGroupKey(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isBlockedQuantityKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (QUANTITY_KEY_BLOCKLIST.has(normalized)) return true;
  if (normalized.endsWith('id')) return true;
  if (normalized.includes('ref')) return true;
  return false;
}

function pickScalarQuantity(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (value != null && typeof value === 'object') {
    const record = asRecord(value);
    if (record) {
      for (const key of ['Qty', 'Quantity', 'quantity']) {
        const nested = pickScalarQuantity(record[key]);
        if (nested != null) return nested;
      }
    }
    return null;
  }

  if (value == null) return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function pickQuantityFromFieldRecord(
  record: Record<string, unknown>,
  sourcePrefix: string,
): { quantity: number; source: string } | null {
  for (const key of SIMPRO_QUANTITY_KEYS) {
    if (isBlockedQuantityKey(key)) continue;
    const parsed = pickScalarQuantity(record[key]);
    if (parsed != null) {
      return { quantity: parsed, source: `${sourcePrefix}.${key}` };
    }
  }
  return null;
}

export function resolveSimproLineQuantity(line: Record<string, unknown>): {
  quantity: number | null;
  source: string | null;
} {
  const total = asRecord(line.Total ?? line.total);
  if (total) {
    const fromTotal = pickQuantityFromFieldRecord(total, 'Total');
    if (fromTotal) {
      return { quantity: fromTotal.quantity, source: fromTotal.source };
    }
  }

  for (const key of SIMPRO_QUANTITY_KEYS) {
    if (isBlockedQuantityKey(key)) continue;
    const parsed = pickScalarQuantity(line[key]);
    if (parsed != null) {
      return { quantity: parsed, source: key };
    }
  }

  return { quantity: null, source: null };
}

function pickLineQuantity(line: Record<string, unknown>): number | null {
  return resolveSimproLineQuantity(line).quantity;
}

function pickLineText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = cleanTextField(record[key]);
    if (direct) return direct;
    const nested = pickNestedName(record[key]);
    if (nested) return nested;
  }
  return null;
}

function hasProductIdentity(record: Record<string, unknown>): boolean {
  const merged = mergeCatalogFields(record);
  return Boolean(
    pickLineText(merged, ['Name', 'ItemName', 'Description', 'ItemDescription', 'LongDescription']) ||
    pickLineText(merged, ['PartNo', 'PartNumber', 'Model', 'CatalogNo', 'StockNo', 'SKU']),
  );
}

function isPrebuildLine(line: Record<string, unknown>, itemGroup: string | null): boolean {
  const normalizedGroup = normalizeItemGroupKey(itemGroup ?? pickString(line._itemGroup));
  if (normalizedGroup === 'prebuilds' || normalizedGroup === 'prebuild') return true;
  return Boolean(line.Prebuild ?? line.prebuild ?? line.PrebuildID ?? line.PrebuildId);
}

function isActualPrebuildParentLine(line: Record<string, unknown>): boolean {
  return Boolean(line.Prebuild ?? line.prebuild ?? line.PrebuildID ?? line.PrebuildId);
}

function pickExcludedLineName(line: Record<string, unknown>): string {
  const merged = mergeCatalogFields(line);
  return (
    pickLineText(merged, ['Name', 'ItemName', 'Description', 'ItemDescription']) ??
    pickNestedName(line.Prebuild ?? line.prebuild) ??
    pickNestedName(line.LaborType ?? line.laborType) ??
    pickNestedName(line.ServiceFee ?? line.serviceFee) ??
    'Unknown line'
  );
}

function pushCommercialExclusionWarning(
  warnings: ImportReviewIssue[],
  line: Record<string, unknown>,
): void {
  warnings.push({
    code: 'simpro.excluded_commercial_line',
    message: `Excluded commercial/service line '${pickExcludedLineName(line)}'.`,
    severity: 'info',
    draftId: pickString(line.ID ?? line.Id ?? line.id) ?? undefined,
  });
}

function collectNestedCatalogCandidates(source: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  const items = asRecord(source.Items ?? source.items);
  if (items) {
    for (const key of PREBUILD_CHILD_COLLECTION_KEYS) {
      for (const item of normalizeArray(items[key])) {
        const record = asRecord(item);
        if (record) candidates.push(record);
      }
    }
  }
  for (const key of PREBUILD_CHILD_COLLECTION_KEYS) {
    for (const item of normalizeArray(source[key])) {
      const record = asRecord(item);
      if (record) candidates.push(record);
    }
  }
  return candidates;
}

function extractPrebuildChildLines(line: Record<string, unknown>): Record<string, unknown>[] {
  const parentQty = pickLineQuantity(line) ?? 1;
  const parentId = pickString(line.ID ?? line.Id ?? line.id);
  const children: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  const sources = [line, ...([line.Prebuild, line.prebuild].map(asRecord).filter(Boolean) as Record<string, unknown>[])];
  for (const source of sources) {
    for (const candidate of collectNestedCatalogCandidates(source)) {
      if (!hasProductIdentity(candidate)) continue;
      const childId = pickString(candidate.ID ?? candidate.Id ?? candidate.id);
      const dedupeKey = childId ?? JSON.stringify(candidate);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const childQty = pickLineQuantity(candidate) ?? 1;
      const effectiveQty = Math.round(childQty * parentQty);
      children.push({
        ...candidate,
        _itemGroup: 'Prebuilds',
        _prebuildParentId: parentId,
        Qty: effectiveQty,
        Quantity: effectiveQty,
        Total: {
          ...(asRecord(candidate.Total) ?? {}),
          Qty: effectiveQty,
          Quantity: effectiveQty,
        },
      });
    }
  }

  return children;
}

export interface ResolvedSimproCatalogLine {
  line: Record<string, unknown>;
  itemGroup: string | null;
}

export interface ResolveSimproCatalogLinesResult {
  importLines: ResolvedSimproCatalogLine[];
  excludedCount: number;
  warnings: ImportReviewIssue[];
}

/** Expand/filter raw Simpro cost-centre lines into importable product rows. */
export function resolveSimproCatalogLines(
  rawLines: Record<string, unknown>[],
): ResolveSimproCatalogLinesResult {
  const importLines: ResolvedSimproCatalogLine[] = [];
  const warnings: ImportReviewIssue[] = [];
  let excludedCount = 0;

  for (const line of rawLines) {
    const itemGroup = pickString(line._itemGroup);

    if (isSimproCommercialLine(line, itemGroup)) {
      excludedCount += 1;
      pushCommercialExclusionWarning(warnings, line);
      continue;
    }

    if (isPrebuildLine(line, itemGroup)) {
      const childLines = extractPrebuildChildLines(line);
      if (childLines.length > 0) {
        for (const childLine of childLines) {
          if (isSimproCommercialLine(childLine, 'Prebuilds')) {
            excludedCount += 1;
            pushCommercialExclusionWarning(warnings, childLine);
            continue;
          }
          importLines.push({ line: childLine, itemGroup: 'Prebuilds' });
        }
        excludedCount += 1;
        continue;
      }

      excludedCount += 1;
      if (isActualPrebuildParentLine(line)) {
        const prebuildName = pickExcludedLineName(line);
        warnings.push({
          code: 'simpro.prebuild_without_children',
          message: `Excluded prebuild "${prebuildName}" — no child catalogue items were returned in the job JSON.`,
          severity: 'warning',
          draftId: pickString(line.ID ?? line.Id ?? line.id) ?? undefined,
        });
      }
      continue;
    }

    if (!hasProductIdentity(line)) {
      excludedCount += 1;
      continue;
    }

    importLines.push({ line, itemGroup });
  }

  return { importLines, excludedCount, warnings };
}

function normalizeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function collectCommercialFilterText(
  line: Record<string, unknown>,
  itemGroup: string | null,
): string {
  const merged = mergeCatalogFields(line);
  return [
    itemGroup,
    pickString(line._itemGroup),
    pickNestedName(line.Prebuild ?? line.prebuild),
    pickNestedName(line.LaborType ?? line.laborType),
    pickNestedName(line.ServiceFee ?? line.serviceFee),
    pickLineText(merged, ['Name', 'ItemName', 'Description', 'ItemDescription', 'LongDescription']),
    pickLineText(merged, ['Type', 'ItemType', 'CatalogType', 'Category', 'Group', 'ItemGroup']),
  ]
    .filter(Boolean)
    .join(' ');
}

/** True when a Simpro catalogue line is commercial/service work, not physical equipment. */
export function isSimproCommercialLine(
  line: Record<string, unknown>,
  itemGroup: string | null,
): boolean {
  const normalizedGroup = normalizeItemGroupKey(itemGroup ?? pickString(line._itemGroup));
  if (normalizedGroup && COMMERCIAL_ITEM_GROUP_KEYS.has(normalizedGroup)) {
    return true;
  }

  const filterText = collectCommercialFilterText(line, itemGroup);
  if (!filterText.trim()) return false;

  return COMMERCIAL_LINE_PATTERNS.some(pattern => pattern.test(filterText));
}

export function pickSimproCostCentreCatalogLines(centreRecord: Record<string, unknown>): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  const pushLine = (item: unknown, itemGroup: string) => {
    const itemRecord = asRecord(item);
    if (!itemRecord) return;
    const normalizedGroup = normalizeItemGroupKey(itemGroup);
    if (normalizedGroup && SKIP_COLLECTION_GROUP_KEYS.has(normalizedGroup)) return;

    const lineId = pickString(itemRecord.ID ?? itemRecord.Id ?? itemRecord.id);
    const dedupeKey = `${normalizedGroup ?? itemGroup}:${lineId ?? JSON.stringify(itemRecord)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    lines.push({ ...itemRecord, _itemGroup: itemGroup });
  };

  const itemsRoot = asRecord(centreRecord.Items ?? centreRecord.items);
  if (itemsRoot) {
    for (const [groupName, groupItems] of Object.entries(itemsRoot)) {
      for (const item of normalizeArray(groupItems)) {
        pushLine(item, groupName);
      }
    }
  }

  for (const key of ['Catalogs', 'Catalogues', 'catalogs', 'Prebuilds', 'Stock', 'OneOffs']) {
    for (const item of normalizeArray(centreRecord[key])) {
      pushLine(item, key);
    }
  }

  return lines;
}

export interface MappedSimproEquipmentLine {
  deviceType: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  modelName: string | null;
  partNumber: string | null;
  catalogNumber: string | null;
  stockNumber: string | null;
  quantity: number;
  quantitySource: string | null;
  notes: string | null;
  sourceLineRef: string | null;
  issues: ImportReviewIssue[];
}

export function mapSimproCatalogLine(
  line: Record<string, unknown>,
  itemGroup: string | null,
): MappedSimproEquipmentLine {
  const merged = mergeCatalogFields(line);
  const issues: ImportReviewIssue[] = [];

  const description = pickLineText(merged, ['Description', 'ItemDescription', 'LongDescription']);
  const name = pickLineText(merged, ['Name', 'ItemName']);
  const manufacturer = pickLineText(merged, ['Manufacturer', 'Brand', 'Make']);
  const partNumber = pickLineText(merged, ['PartNo', 'PartNumber', 'SKU']);
  const catalogNumber = pickLineText(merged, ['CatalogNo', 'CatalogNumber', 'CatalogueNo']);
  const stockNumber = pickLineText(merged, ['StockNo', 'StockNumber']);
  const modelNumber = partNumber ?? pickLineText(merged, ['Model']) ?? catalogNumber ?? stockNumber;
  const { quantity: quantityRaw, source: quantitySource } = resolveSimproLineQuantity(line);

  const deviceType = name ?? description;
  const modelName = description && description !== deviceType ? description : name && name !== deviceType ? name : null;

  if (!deviceType && !modelName) {
    issues.push({
      code: 'simpro.missing_equipment_description',
      message: 'Catalogue line has no Name or Description — equipment label could not be determined.',
      severity: 'warning',
    });
  }

  if (!manufacturer) {
    issues.push({
      code: 'simpro.missing_manufacturer',
      message: `No manufacturer on catalogue line${name ? ` "${name}"` : ''}.`,
      severity: 'warning',
    });
  }

  if (!modelNumber) {
    issues.push({
      code: 'simpro.missing_model_number',
      message: `No model/part number on catalogue line${name ? ` "${name}"` : ''}.`,
      severity: 'warning',
    });
  }

  if (name && description && name !== description) {
    issues.push({
      code: 'simpro.ambiguous_equipment_label',
      message: `Catalogue line has both Name ("${name}") and Description — review the mapped fields.`,
      severity: 'info',
    });
  }

  if (quantityRaw == null) {
    issues.push({
      code: 'simpro.missing_quantity',
      message: `No Simpro quantity field (Total.Qty, Qty, Quantity, BillableQty, SellQty, OrderQty, Count) on catalogue line${name ? ` "${name}"` : ''}; defaulting to 1 for review.`,
      severity: 'warning',
    });
  }

  return {
    deviceType,
    manufacturer,
    modelNumber,
    modelName,
    partNumber,
    catalogNumber,
    stockNumber,
    quantity: quantityRaw != null ? Math.round(quantityRaw) : 1,
    quantitySource,
    notes: itemGroup,
    sourceLineRef: pickString(line.ID ?? line.Id ?? line.id),
    issues,
  };
}
