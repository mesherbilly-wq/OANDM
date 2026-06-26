import type { SystemType } from '../../types';

/** How a system type was inferred for a line or parent system. */
export type SystemTypeInferenceMethod =
  | 'source_label'
  | 'product_match'
  | 'keyword_rule'
  | 'user'
  | 'unresolved';

/**
 * One importable equipment line before it becomes a `devices` row.
 * Connectors map catalog items, spreadsheet rows, or AI extractions here.
 */
export interface ImportEquipmentDraft {
  /** Stable id within a review session (not a database id). */
  draftId: string;
  /** Parent {@link ImportSystemDraft.draftId}. */
  systemDraftId: string;
  deviceType: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  modelName: string | null;
  quantity: number;
  location: string | null;
  notes: string | null;
  /** Per-line system override when a mixed section is split. */
  systemType: SystemType | null;
  matchedProductId: number | null;
  matched: boolean;
  /** Normalised 0–1 confidence from extraction or matching. */
  confidence: number | null;
  selected: boolean;
  /** Opaque trace back to a source line (Simpro catalog id, CSV row, etc.). */
  sourceLineRef: string | null;
  /** Connector-specific payload — consumers must not depend on this. */
  metadata: Record<string, unknown>;
}

export function createEquipmentDraft(
  partial: Omit<ImportEquipmentDraft, 'metadata'> & { metadata?: Record<string, unknown> },
): ImportEquipmentDraft {
  return {
    metadata: {},
    matched: false,
    matchedProductId: null,
    confidence: null,
    selected: true,
    quantity: 1,
    ...partial,
    metadata: partial.metadata ?? {},
  };
}
