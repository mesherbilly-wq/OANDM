/** Shared normalisation for product / datasheet matching across imports and project views. */

export function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Uppercase, trim, strip hyphens/spaces/punctuation for model keys. */
export function normalizeModelKey(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.,/\\():+#]+/g, '')
    .replace(/[^\w]/g, '');
}

/** Legacy alias used by import product matching — lowercase alphanumeric only. */
export function normalizePart(value: string | null | undefined): string {
  return normalizeToken(value).replace(/[^a-z0-9]/g, '');
}

export function exactModelMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  return Boolean(a && b && a === b);
}

export function normalizedModelMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeModelKey(left);
  const b = normalizeModelKey(right);
  return Boolean(a && b && a === b);
}

export function equipmentIdentityKey(
  manufacturer: string | null | undefined,
  modelNumber: string | null | undefined,
): string {
  return `${normalizeToken(manufacturer)}::${normalizeToken(modelNumber)}`;
}

export function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2),
  );
}

export function tokenOverlapScore(left: string, right: string): number {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size);
}

export interface EquipmentMatchInput {
  manufacturer: string | null;
  modelNumber: string | null;
  modelName?: string | null;
  deviceType?: string | null;
  metadata?: Record<string, unknown>;
}

export function pickMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!metadata) return null;
  const value = metadata[key];
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}
