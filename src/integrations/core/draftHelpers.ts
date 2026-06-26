import type {
  ImportReviewDraft,
  ImportReviewIssue,
  ImportSystemDraft,
} from '../models';
import type { SystemType } from '../../types';

/** Collect all equipment lines across systems (respecting nested structure). */
export function flattenEquipment(draft: ImportReviewDraft) {
  return draft.systems.flatMap(system => system.equipment);
}

/** Equipment lines the user has selected for import. */
export function selectedEquipment(draft: ImportReviewDraft) {
  return flattenEquipment(draft).filter(item => item.selected);
}

/** Systems the user has selected for import. */
export function selectedSystems(draft: ImportReviewDraft): ImportSystemDraft[] {
  return draft.systems.filter(system => system.selected);
}

/** Resolved system type for a system draft (user confirmation wins). */
export function resolvedSystemType(system: ImportSystemDraft): SystemType | null {
  return system.inference.confirmedSystemType ?? system.inference.suggestedSystemType;
}

/** Sum of quantities for selected equipment lines. */
export function selectedDeviceCount(draft: ImportReviewDraft): number {
  return selectedEquipment(draft).reduce((sum, item) => sum + Math.max(1, item.quantity), 0);
}

/** Whether every selected system has a confirmed or suggested system type. */
export function allSelectedSystemsTyped(draft: ImportReviewDraft): boolean {
  return selectedSystems(draft).every(system => resolvedSystemType(system) !== null);
}

/** Whether the draft has at least one selected equipment line (manual projects may have none). */
export function hasSelectedEquipment(draft: ImportReviewDraft): boolean {
  return selectedEquipment(draft).length > 0;
}

export function createDraftId(prefix = 'draft'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
