import type {
  ImportEquipmentDraft,
  ImportReviewDraft,
  ImportSystemDraft,
} from '../models';
import { resolvedSystemCategory } from '../models/ImportSystemDraft';
import type { SystemCategory } from '../../types';
import { clampLineQuantity } from '../../lib/devicePersistConstants';

/** Collect all equipment lines across systems (respecting nested structure). */
export function flattenEquipment(draft: ImportReviewDraft) {
  return draft.systems.flatMap(system => system.equipment);
}

/** Equipment lines the user has selected for import. */
export function selectedEquipment(draft: ImportReviewDraft) {
  return draft.systems
    .filter(system => system.selected)
    .flatMap(system => system.equipment.filter(item => item.selected));
}

/** Systems the user has selected for import. */
export function selectedSystems(draft: ImportReviewDraft): ImportSystemDraft[] {
  return draft.systems.filter(system => system.selected);
}

/** Resolved category for a system draft (user confirmation wins). */
export function resolvedCategory(system: ImportSystemDraft): SystemCategory | null {
  return resolvedSystemCategory(system);
}

/** Resolved category for an equipment line (line override, then system). */
export function resolvedEquipmentCategory(
  system: ImportSystemDraft,
  item: ImportEquipmentDraft,
): SystemCategory | null {
  return item.category ?? resolvedSystemCategory(system);
}

/** @deprecated Use resolvedCategory */
export function resolvedSystemType(system: ImportSystemDraft): SystemCategory | null {
  return resolvedCategory(system);
}

/** @deprecated Use resolvedEquipmentCategory */
export function resolvedEquipmentSystemType(
  system: ImportSystemDraft,
  item: ImportEquipmentDraft,
): SystemCategory | null {
  return resolvedEquipmentCategory(system, item);
}

/** Sum of quantities for selected equipment lines. */
export function selectedDeviceCount(draft: ImportReviewDraft): number {
  return selectedEquipment(draft).reduce((sum, item) => sum + clampLineQuantity(item.quantity), 0);
}

/** Count selected vs total equipment lines (respecting system selection). */
export function equipmentLineSelectionSummary(
  draft: ImportReviewDraft,
): { selectedLines: number; totalLines: number } {
  let selectedLines = 0;
  let totalLines = 0;

  for (const system of draft.systems) {
    for (const item of system.equipment) {
      totalLines += 1;
      if (item.selected && system.selected) {
        selectedLines += 1;
      }
    }
  }

  return { selectedLines, totalLines };
}

/** Selected systems, equipment lines, and device unit totals for Import Review. */
export function importSelectionSummary(draft: ImportReviewDraft): {
  selectedSystems: number;
  totalSystems: number;
  selectedLines: number;
  totalLines: number;
  deviceUnits: number;
} {
  const { selectedLines, totalLines } = equipmentLineSelectionSummary(draft);
  return {
    selectedSystems: draft.systems.filter(system => system.selected).length,
    totalSystems: draft.systems.length,
    selectedLines,
    totalLines,
    deviceUnits: selectedDeviceCount(draft),
  };
}

/** Whether every selected system has a confirmed or suggested category. */
export function allSelectedSystemsCategorised(draft: ImportReviewDraft): boolean {
  return selectedSystems(draft).every(system => resolvedCategory(system) !== null);
}

/** @deprecated Use allSelectedSystemsCategorised */
export function allSelectedSystemsTyped(draft: ImportReviewDraft): boolean {
  return allSelectedSystemsCategorised(draft);
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
