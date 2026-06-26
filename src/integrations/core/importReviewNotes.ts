import type { ImportReviewDraft, ImportReviewIssue } from '../models';
import { selectedSystems } from './draftHelpers';
import { validateImportReviewDraft } from './draftValidation';

export type ImportReviewNoteBucket = 'info' | 'warning' | 'blocking';

const INFO_ISSUE_CODES = new Set([
  'simpro.excluded_commercial_line',
  'simpro.excluded_non_product_lines',
  'simpro.missing_job_number',
  'simpro.section_without_cost_centres',
  'simpro.empty_cost_centre',
  'empty_system',
]);

const WARNING_ISSUE_CODES = new Set([
  'simpro.missing_manufacturer',
  'simpro.missing_model_number',
  'simpro.missing_equipment_description',
  'simpro.ambiguous_equipment_label',
  'simpro.missing_quantity',
  'simpro.unresolved_category',
  'simpro.prebuild_without_children',
  'simpro.missing_scope',
  'simpro.missing_project_name',
  'simpro.missing_job_id',
  'simpro.no_sections',
  'simpro.no_systems',
  'uncategorised_system',
  'no_systems',
  'persist.no_equipment',
]);

const BLOCKING_ISSUE_CODES = new Set([
  'missing_review_id',
  'missing_connector',
  'persist.no_systems',
]);

/** Classify a normalised import issue for Import Review display and create-project gating. */
export function classifyImportReviewNote(issue: ImportReviewIssue): ImportReviewNoteBucket {
  if (issue.severity === 'error' || BLOCKING_ISSUE_CODES.has(issue.code)) {
    return 'blocking';
  }

  if (INFO_ISSUE_CODES.has(issue.code) || issue.code.startsWith('simpro.excluded_')) {
    return 'info';
  }

  if (WARNING_ISSUE_CODES.has(issue.code) || issue.severity === 'warning') {
    return 'warning';
  }

  return issue.severity === 'info' ? 'info' : 'warning';
}

export interface PartitionedImportReviewNotes {
  info: ImportReviewIssue[];
  warnings: ImportReviewIssue[];
  blocking: ImportReviewIssue[];
}

export function partitionImportReviewNotes(draft: ImportReviewDraft): PartitionedImportReviewNotes {
  const info: ImportReviewIssue[] = [];
  const warnings: ImportReviewIssue[] = [];
  const blocking: ImportReviewIssue[] = [];

  const add = (issue: ImportReviewIssue) => {
    const bucket = classifyImportReviewNote(issue);
    if (bucket === 'info') info.push(issue);
    else if (bucket === 'blocking') blocking.push(issue);
    else warnings.push(issue);
  };

  for (const issue of draft.issues) {
    add(issue);
  }

  for (const issue of validateImportReviewDraft(draft)) {
    add(issue);
  }

  return { info, warnings, blocking };
}

/** Issues that prevent creating a project until resolved. */
export function getImportReviewBlockingIssues(draft: ImportReviewDraft): ImportReviewIssue[] {
  const blocking: ImportReviewIssue[] = [];
  const seen = new Set<string>();

  const add = (issue: ImportReviewIssue) => {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocking.push(issue);
  };

  for (const issue of partitionImportReviewNotes(draft).blocking) {
    add(issue);
  }

  if (selectedSystems(draft).length === 0) {
    add({
      code: 'persist.no_systems',
      message: 'Select at least one cost centre/system to import.',
      severity: 'error',
    });
  }

  if (!draft.project.projectName?.trim()) {
    add({
      code: 'persist.missing_project_name',
      message: 'Project name is empty — add a name in Simpro or edit before creating.',
      severity: 'error',
    });
  }

  return blocking;
}

const CREATE_CONFIRMATION_ISSUE_CODES = new Set([
  'persist.no_equipment',
  'uncategorised_system',
  'simpro.unresolved_category',
  'simpro.prebuild_without_children',
  'simpro.missing_scope',
  'simpro.missing_job_id',
  'simpro.no_sections',
  'simpro.no_systems',
  'no_systems',
]);

/** Issues that should trigger a confirmation dialog before creating (excludes expected exclusions). */
export function getImportReviewCreateConfirmationIssues(draft: ImportReviewDraft): ImportReviewIssue[] {
  const confirm: ImportReviewIssue[] = [];
  const seen = new Set<string>();

  const add = (issue: ImportReviewIssue) => {
    if (!CREATE_CONFIRMATION_ISSUE_CODES.has(issue.code)) return;
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    confirm.push(issue);
  };

  for (const issue of draft.issues) {
    add(issue);
  }

  for (const issue of validateImportReviewDraft(draft)) {
    add(issue);
  }

  if (!hasImportableEquipmentSelected(draft)) {
    add({
      code: 'persist.no_equipment',
      message: 'No equipment lines are selected — the project will be created without devices.',
      severity: 'warning',
    });
  }

  return confirm;
}

function hasImportableEquipmentSelected(draft: ImportReviewDraft): boolean {
  for (const system of selectedSystems(draft)) {
    if (system.equipment.some(item => item.selected)) {
      return true;
    }
  }
  return false;
}
