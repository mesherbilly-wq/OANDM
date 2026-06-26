import type { SystemType } from '../../../types';
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

const SYSTEM_TYPE_RULES: { type: SystemType; patterns: RegExp[] }[] = [
  {
    type: 'CCTV',
    patterns: [/\bcctv\b/i, /\bcamera/i, /\bnvr\b/i, /\bdvr\b/i, /\bvideo\b/i, /\brecorder/i],
  },
  {
    type: 'Access Control',
    patterns: [/\baccess control/i, /\bdoor controller/i, /\bcard reader/i, /\breader\b/i, /\bmaglock/i, /\belectric strike/i],
  },
  {
    type: 'Intruder',
    patterns: [/\bintruder/i, /\balarm panel/i, /\bdetector/i, /\bpir\b/i, /\bpanic/i],
  },
  {
    type: 'Intercom',
    patterns: [/\bintercom/i, /\bdoor entry/i, /\bvideo door/i, /\bdoor station/i],
  },
  {
    type: 'ANPR',
    patterns: [/\banpr\b/i, /\blpr\b/i, /\blicen[cs]e plate/i, /\bnumber plate/i],
  },
  {
    type: 'Perimeter Detection',
    patterns: [/\bperimeter/i, /\bfence/i, /\bbeam\b/i, /\binfrared barrier/i],
  },
  {
    type: 'Networking',
    patterns: [/\bnetwork/i, /\bswitch\b/i, /\brouter\b/i, /\bpatch panel/i, /\bdata cab/i, /\bstructured cabling/i],
  },
];

export function inferSystemTypeFromTexts(texts: (string | null | undefined)[]): {
  suggestedSystemType: SystemType | null;
  confidence: number;
  method: 'keyword_rule' | 'unresolved';
} {
  const combined = texts.filter(Boolean).join(' ');
  if (!combined.trim()) {
    return { suggestedSystemType: null, confidence: 0, method: 'unresolved' };
  }

  let bestType: SystemType | null = null;
  let bestScore = 0;

  for (const rule of SYSTEM_TYPE_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(combined)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = rule.type;
    }
  }

  if (!bestType || bestScore === 0) {
    return { suggestedSystemType: null, confidence: 0, method: 'unresolved' };
  }

  return {
    suggestedSystemType: bestType,
    confidence: Math.min(0.95, 0.35 + bestScore * 0.12),
    method: 'keyword_rule',
  };
}

function mergeCatalogFields(line: Record<string, unknown>): Record<string, unknown> {
  const catalog = asRecord(line.Catalog ?? line.Catalogue ?? line.catalog);
  if (!catalog) return line;
  return { ...catalog, ...line };
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

function hasQuantityField(record: Record<string, unknown>): boolean {
  for (const key of ['Qty', 'Quantity', 'quantity', 'TotalQty']) {
    if (record[key] != null && String(record[key]).trim() !== '') return true;
  }
  return false;
}

function pickLineQuantity(record: Record<string, unknown>): number | null {
  for (const key of ['Qty', 'Quantity', 'quantity', 'TotalQty']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (value != null) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

export interface MappedSimproEquipmentLine {
  deviceType: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  modelName: string | null;
  quantity: number;
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
  const modelNumber = pickLineText(merged, ['PartNo', 'PartNumber', 'Model', 'CatalogNo', 'StockNo', 'SKU']);
  const quantityRaw = pickLineQuantity(merged);

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
      severity: 'info',
    });
  }

  if (!modelNumber) {
    issues.push({
      code: 'simpro.missing_model_number',
      message: `No model/part number on catalogue line${name ? ` "${name}"` : ''}.`,
      severity: 'info',
    });
  }

  if (name && description && name !== description) {
    issues.push({
      code: 'simpro.ambiguous_equipment_label',
      message: `Catalogue line has both Name ("${name}") and Description — review the mapped fields.`,
      severity: 'info',
    });
  }

  if (!hasQuantityField(merged)) {
    issues.push({
      code: 'simpro.missing_quantity',
      message: `Quantity not provided for catalogue line${name ? ` "${name}"` : ''}; defaulting to 1 for review.`,
      severity: 'info',
    });
  }

  return {
    deviceType,
    manufacturer,
    modelNumber,
    modelName,
    quantity: quantityRaw ?? 1,
    notes: itemGroup,
    sourceLineRef: pickString(line.ID ?? line.Id ?? line.id),
    issues,
  };
}
