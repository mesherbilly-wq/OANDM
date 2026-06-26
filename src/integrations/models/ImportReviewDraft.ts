import type { ConnectorId } from '../types';
import type { ImportProjectDraft } from './ImportProjectDraft';
import type { ImportSystemDraft } from './ImportSystemDraft';

export type ImportReviewIssueSeverity = 'info' | 'warning' | 'error';

/** Normalised issue surfaced during fetch, normalisation, or validation. */
export interface ImportReviewIssue {
  code: string;
  message: string;
  severity: ImportReviewIssueSeverity;
  draftId?: string;
}

/** Provenance for an import session — consumers use connectorId only, not raw payloads. */
export interface ImportSourceMeta {
  connectorId: ConnectorId;
  displayReference: string | null;
  fetchedAt: string;
  externalIds: Record<string, string | number>;
}

/**
 * Top-level import package consumed by Create Project, review UI, and future persist layer.
 * Every connector must produce this shape; OANDM never branches on connector-specific types.
 */
export interface ImportReviewDraft {
  reviewId: string;
  source: ImportSourceMeta;
  project: ImportProjectDraft;
  systems: ImportSystemDraft[];
  issues: ImportReviewIssue[];
  totalEquipmentLines: number;
}

export function createImportReviewDraft(
  partial: Omit<ImportReviewDraft, 'totalEquipmentLines' | 'issues'> & {
    issues?: ImportReviewIssue[];
  },
): ImportReviewDraft {
  const systems = partial.systems ?? [];
  const totalEquipmentLines = systems.reduce((sum, sys) => sum + sys.equipment.length, 0);
  return {
    issues: [],
    ...partial,
    systems,
    issues: partial.issues ?? [],
    totalEquipmentLines,
  };
}
