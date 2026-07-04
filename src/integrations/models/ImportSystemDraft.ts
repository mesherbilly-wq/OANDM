import type { SystemCategory } from '../../types';
import type { ImportEquipmentDraft, CategoryInferenceMethod } from './ImportEquipmentDraft';

/** Category suggestion for a cost centre / install section (styling only). */
export interface CategoryInference {
  suggestedCategory: SystemCategory | null;
  confirmedCategory: SystemCategory | null;
  method: CategoryInferenceMethod;
  confidence: number;
}

/**
 * A project System — one install section / cost centre / AI-detected area.
 * The name is the hierarchy; category is lightweight metadata only.
 */
export interface ImportSystemDraft {
  draftId: string;
  name: string;
  description: string | null;
  category: CategoryInference;
  equipment: ImportEquipmentDraft[];
  selected: boolean;
  /** Opaque trace back to a source section (Simpro cost centre id, sheet name, etc.). */
  sourceSectionRef: string | null;
  /** Simpro location/section header (physical area), separate from cost centre name. */
  sourceLocationName: string | null;
  /** Imported Simpro cost centre name — default for {@link name}, editable in review. */
  sourceCostCentreName: string | null;
  /** Human-readable Simpro cost centre label(s), e.g. Equipment/Materials (#403768-38147). */
  sourceCostCentreLabel: string | null;
}

export function createSystemDraft(
  partial: Omit<ImportSystemDraft, 'category' | 'equipment'> & {
    category?: Partial<CategoryInference>;
    equipment?: ImportEquipmentDraft[];
  },
): ImportSystemDraft {
  return {
    selected: true,
    description: null,
    sourceSectionRef: null,
    sourceLocationName: null,
    sourceCostCentreName: null,
    sourceCostCentreLabel: null,
    ...partial,
    category: {
      suggestedCategory: null,
      confirmedCategory: null,
      method: 'unresolved',
      confidence: 0,
      ...partial.category,
    },
    equipment: partial.equipment ?? [],
  };
}

/** @deprecated Use CategoryInference */
export type SystemTypeInference = CategoryInference;

/** Resolved category for a system draft (user confirmation wins). */
export function resolvedSystemCategory(system: ImportSystemDraft): SystemCategory | null {
  return system.category.confirmedCategory ?? system.category.suggestedCategory;
}
