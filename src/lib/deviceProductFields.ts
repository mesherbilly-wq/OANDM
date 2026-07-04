/** Structured product fields stored in device notes (no devices-table migration). */

export const PRODUCT_CATEGORY_NOTE_TAG = '[oandm:product_category:';
export const WARRANTY_YEARS_NOTE_TAG = '[oandm:warranty_years:';

function readTaggedValue(notes: string | null | undefined, tag: string): string | null {
  if (!notes) return null;
  const start = notes.indexOf(tag);
  if (start < 0) return null;
  const from = start + tag.length;
  const end = notes.indexOf(']', from);
  if (end < 0) return null;
  const value = notes.slice(from, end).trim();
  return value || null;
}

function stripTaggedValues(notes: string | null | undefined, tags: string[]): string {
  if (!notes) return '';
  let next = notes;
  for (const tag of tags) {
    let start = next.indexOf(tag);
    while (start >= 0) {
      const end = next.indexOf(']', start);
      if (end < 0) break;
      next = `${next.slice(0, start)}${next.slice(end + 1)}`.replace(/\s{2,}/g, ' ').trim();
      start = next.indexOf(tag);
    }
  }
  return next.trim();
}

export function extractProductCategoryFromNotes(notes: string | null | undefined): string | null {
  return readTaggedValue(notes, PRODUCT_CATEGORY_NOTE_TAG);
}

export function extractWarrantyYearsFromNotes(notes: string | null | undefined): number | null {
  const raw = readTaggedValue(notes, WARRANTY_YEARS_NOTE_TAG);
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function formatWarrantyYears(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value} year${value === 1 ? '' : 's'}`;
}

export function appendProductFieldNotes(
  notes: string | null | undefined,
  productCategory: string | null | undefined,
  warrantyYears: number | null | undefined,
): string {
  const base = stripTaggedValues(notes, [PRODUCT_CATEGORY_NOTE_TAG, WARRANTY_YEARS_NOTE_TAG]);
  const tags: string[] = [];

  const category = productCategory?.trim();
  if (category) tags.push(`${PRODUCT_CATEGORY_NOTE_TAG}${category}]`);

  if (warrantyYears != null && Number.isFinite(warrantyYears) && warrantyYears >= 0) {
    tags.push(`${WARRANTY_YEARS_NOTE_TAG}${Math.round(warrantyYears)}]`);
  }

  if (tags.length === 0) return base;
  return base ? `${base} ${tags.join(' ')}` : tags.join(' ');
}

export function getDeviceProductDescription(device: {
  model_name?: string | null;
  device_type?: string | null;
}): string | null {
  return device.model_name?.trim() || device.device_type?.trim() || null;
}
