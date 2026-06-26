/** Max device rows expanded from one import / equipment line (Simpro, AI, manual). */
export const MAX_DEVICES_PER_LINE = 999;

export function clampLineQuantity(quantity: unknown): number {
  const parsed = typeof quantity === 'number'
    ? quantity
    : parseInt(String(quantity ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_DEVICES_PER_LINE);
}
