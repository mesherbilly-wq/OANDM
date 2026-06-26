import type { SystemType } from '../../types';
import type { ImportEquipmentDraft, SystemTypeInferenceMethod } from './ImportEquipmentDraft';

/** System-type suggestion for a section / cost centre / install area. */
export interface SystemTypeInference {
  suggestedSystemType: SystemType | null;
  confirmedSystemType: SystemType | null;
  method: SystemTypeInferenceMethod;
  confidence: number;
}

/**
 * A logical install section — maps to an OANDM `system_type` tab once confirmed.
 * Simpro cost centres, HaloPSA sites/sections, CSV groupings, etc. all land here.
 */
export interface ImportSystemDraft {
  draftId: string;
  name: string;
  description: string | null;
  inference: SystemTypeInference;
  equipment: ImportEquipmentDraft[];
  selected: boolean;
  /** Opaque trace back to a source section (Simpro cost centre id, sheet name, etc.). */
  sourceSectionRef: string | null;
}

export function createSystemDraft(
  partial: Omit<ImportSystemDraft, 'inference' | 'equipment'> & {
    inference?: Partial<SystemTypeInference>;
    equipment?: ImportEquipmentDraft[];
  },
): ImportSystemDraft {
  return {
    equipment: [],
    selected: true,
    description: null,
    sourceSectionRef: null,
    ...partial,
    inference: {
      suggestedSystemType: null,
      confirmedSystemType: null,
      method: 'unresolved',
      confidence: 0,
      ...partial.inference,
    },
    equipment: partial.equipment ?? [],
  };
}
