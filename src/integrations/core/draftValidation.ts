import type { ImportReviewDraft, ImportReviewIssue } from '../models';
import { allSelectedSystemsCategorised, hasSelectedEquipment, resolvedCategory, selectedSystems } from './draftHelpers';

/**
 * Structural validation for {@link ImportReviewDraft}.
 * Does not hit the database or call external APIs.
 */
export function validateImportReviewDraft(draft: ImportReviewDraft): ImportReviewIssue[] {
  const issues: ImportReviewIssue[] = [];

  if (!draft.reviewId?.trim()) {
    issues.push({
      code: 'missing_review_id',
      message: 'Import review is missing a reviewId.',
      severity: 'error',
    });
  }

  if (!draft.source?.connectorId) {
    issues.push({
      code: 'missing_connector',
      message: 'Import review is missing source connector metadata.',
      severity: 'error',
    });
  }

  if (draft.systems.length === 0) {
    issues.push({
      code: 'no_systems',
      message: 'No systems were produced by this import.',
      severity: 'warning',
    });
  }

  for (const system of draft.systems) {
    if (system.selected && !system.name?.trim()) {
      issues.push({
        code: 'unnamed_system',
        message: 'A selected system has no name.',
        severity: 'error',
        draftId: system.draftId,
      });
    }

    if (system.selected && !resolvedCategory(system)) {
      issues.push({
        code: 'uncategorised_system',
        message: `System "${system.name}" has no category assigned.`,
        severity: 'warning',
        draftId: system.draftId,
      });
    }

    if (system.equipment.length === 0) {
      issues.push({
        code: 'empty_system',
        message: `System "${system.name}" contains no equipment lines.`,
        severity: 'info',
        draftId: system.draftId,
      });
    }
  }

  return issues;
}

/** Gate before a future persist layer writes to Supabase. */
export function assertReviewDraftReadyForPersist(draft: ImportReviewDraft): void {
  const issues = validateImportReviewDraft(draft);
  const errors = issues.filter(issue => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map(issue => issue.message).join(' '));
  }

  if (selectedSystems(draft).length === 0) {
    throw new Error('At least one system must be selected.');
  }

  if (!allSelectedSystemsCategorised(draft)) {
    throw new Error('Every selected system must have a category.');
  }

  if (!hasSelectedEquipment(draft)) {
    throw new Error('At least one equipment line must be selected.');
  }
}
