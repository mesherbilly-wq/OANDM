import type { AiExtractPayload } from './types';

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mentioned(haystack: string, needle: string | null | undefined): boolean {
  const token = compact(needle ?? '');
  if (token.length < 3) return false;
  return compact(haystack).includes(token);
}

/** Drop part numbers and manufacturers that are not in the readable text. Image-only pages are left for review. */
export function verifyExtractedEvidence(payload: AiExtractPayload, pageText: string): AiExtractPayload {
  const readable = pageText.trim();
  const imageOnly = readable.length < 40;
  const warnings = [...(payload.warnings ?? [])];
  const devices = (payload.devices ?? []).map(device => {
    const next = { ...device };
    if (imageOnly) {
      if (next.model_number || next.manufacturer) {
        const note = 'Read from the drawing image. Confirm the part number before treating it as fact.';
        next.notes = next.notes ? `${next.notes} ${note}` : note;
      }
      return next;
    }
    if (next.model_number && !mentioned(readable, next.model_number)) {
      warnings.push(`Part number "${next.model_number}" was not in the readable text, so it was left blank.`);
      next.model_number = null;
    }
    if (next.manufacturer && !mentioned(readable, next.manufacturer)) {
      warnings.push(`Manufacturer "${next.manufacturer}" was not in the readable text, so it was left blank.`);
      next.manufacturer = null;
    }
    return next;
  });
  return { ...payload, devices, warnings };
}
