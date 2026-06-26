import type { IntegrationConnector } from '../../core/IntegrationConnector';
import {
  createEmptyProjectDraft,
  type ImportReviewDraft,
} from '../../models';
import type { ConnectorContext } from '../../types';
import { wrapNormalizedReview } from '../createPlannedConnector';

export interface ManualConnectorInput {
  projectName?: string | null;
}

/**
 * Manual project creation — produces an empty review draft the user fills in.
 * This is the only non-planned connector in the foundation phase.
 */
export const manualConnector: IntegrationConnector<ManualConnectorInput, ManualConnectorInput> = {
  id: 'manual',
  label: 'Manual',
  description: 'Start with a blank project and add details yourself.',
  availability: 'available',
  supportsSearch: false,

  async fetch(input: ManualConnectorInput, _context?: ConnectorContext): Promise<ManualConnectorInput> {
    return input;
  },

  normalize(input: ManualConnectorInput, _context?: ConnectorContext): ImportReviewDraft {
    const project = createEmptyProjectDraft();
    if (input.projectName) {
      project.projectName = input.projectName;
    }

    return wrapNormalizedReview('manual', 'Manual entry', () => ({
      project,
      systems: [],
    }));
  },
};

/** Convenience helper for UI layers that start a blank manual draft. */
export function createManualReviewDraft(projectName?: string | null): ImportReviewDraft {
  return manualConnector.normalize({ projectName }, undefined);
}
