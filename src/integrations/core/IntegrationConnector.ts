import type { ImportReviewDraft } from '../models';
import type {
  ConnectorAvailability,
  ConnectorContext,
  ConnectorId,
  ConnectorSearchResult,
} from '../types';

/**
 * Contract every Integration Centre connector must implement.
 *
 * Flow: search (optional) → fetch (raw source payload) → normalize → ImportReviewDraft.
 * Downstream OANDM code only ever sees {@link ImportReviewDraft}.
 */
export interface IntegrationConnector<TFetchInput = unknown, TRawPayload = unknown> {
  readonly id: ConnectorId;
  readonly label: string;
  readonly description: string;
  readonly availability: ConnectorAvailability;
  readonly supportsSearch: boolean;

  search?(query: string, context?: ConnectorContext): Promise<ConnectorSearchResult[]>;
  fetch(input: TFetchInput, context?: ConnectorContext): Promise<TRawPayload>;
  normalize(raw: TRawPayload, context?: ConnectorContext): ImportReviewDraft;
}

export type AnyIntegrationConnector = IntegrationConnector<unknown, unknown>;

export function isConnectorAvailable(connector: AnyIntegrationConnector): boolean {
  return connector.availability === 'available';
}

export function assertConnectorAvailable(connector: AnyIntegrationConnector): void {
  if (!isConnectorAvailable(connector)) {
    throw new Error(`Connector "${connector.id}" is not yet available.`);
  }
}
