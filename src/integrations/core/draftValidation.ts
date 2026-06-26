import type { ImportReviewDraft, ImportReviewIssue } from '../models';
import { allSelectedSystemsTyped, hasSelectedEquipment, selectedSystems } from './draftHelpers';

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
      message: 'No install sections were produced by this import.',
      severity: 'warning',
    });
  }

  for (const system of draft.systems) {
    if (system.selected && !system.inference.confirmedSystemType && !system.inference.suggestedSystemType) {
      issues.push({
        code: 'untyped_system',
        message: `Section "${system.name}" has no system type assigned.`,
        severity: 'warning',
        draftId: system.draftId,
      });
    }

    if (system.equipment.length === 0) {
      issues.push({
        code: 'empty_system',
        message: `Section "${system.name}" contains no equipment lines.`,
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
    throw new Error('At least one install section must be selected.');
  }

  if (!allSelectedSystemsTyped(draft)) {
    throw new Error('Every selected section must have a system type.');
  }

  if (!hasSelectedEquipment(draft)) {
    throw new Error('At least one equipment line must be selected.');
  }
}
