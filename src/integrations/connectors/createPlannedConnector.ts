import type { IntegrationConnector } from '../core/IntegrationConnector';
import { createDraftId } from '../core/draftHelpers';
import {
  createImportReviewDraft,
  type ImportReviewDraft,
} from '../models';
import type {
  ConnectorAvailability,
  ConnectorContext,
  ConnectorId,
  ConnectorSearchResult,
} from '../types';

export interface PlannedConnectorConfig {
  id: ConnectorId;
  label: string;
  description: string;
  supportsSearch?: boolean;
}

/**
 * Factory for connectors that are registered but not yet implemented.
 * fetch/normalize throw until a real adapter is built.
 */
export function createPlannedConnector(
  config: PlannedConnectorConfig,
): IntegrationConnector<never, never> {
  const supportsSearch = config.supportsSearch ?? false;

  const notImplemented = (): never => {
    throw new Error(`Connector "${config.id}" is planned but not implemented yet.`);
  };

  return {
    id: config.id,
    label: config.label,
    description: config.description,
    availability: 'planned' satisfies ConnectorAvailability,
    supportsSearch,
    search: supportsSearch
      ? async (_query: string, _context?: ConnectorContext): Promise<ConnectorSearchResult[]> => notImplemented()
      : undefined,
    fetch: notImplemented,
    normalize: notImplemented,
  };
}

/** Shared helper for connectors that already have normalised review output. */
export function wrapNormalizedReview(
  connectorId: ConnectorId,
  displayReference: string | null,
  buildDraft: () => Omit<ImportReviewDraft, 'reviewId' | 'source' | 'totalEquipmentLines' | 'issues'>,
): ImportReviewDraft {
  return createImportReviewDraft({
    reviewId: createDraftId('review'),
    source: {
      connectorId,
      displayReference,
      fetchedAt: new Date().toISOString(),
      externalIds: {},
    },
    ...buildDraft(),
  });
}
