import type { ImportReviewDraft } from '../models';
import type { ConnectorContext, ConnectorId, ConnectorSearchResult } from '../types';
import {
  assertConnectorAvailable,
  type AnyIntegrationConnector,
} from './IntegrationConnector';
import { IntegrationRegistry } from './IntegrationRegistry';
import { validateImportReviewDraft } from './draftValidation';

/**
 * Orchestrates connector lookup and the fetch → normalize pipeline.
 * No API calls live here — connectors own source-specific I/O.
 */
export class IntegrationEngine {
  constructor(private readonly registry: IntegrationRegistry) {}

  listConnectors(): AnyIntegrationConnector[] {
    return this.registry.list();
  }

  listAvailableConnectors(): AnyIntegrationConnector[] {
    return this.registry.listAvailable();
  }

  getConnector(id: ConnectorId): AnyIntegrationConnector | undefined {
    return this.registry.get(id);
  }

  async search(
    connectorId: ConnectorId,
    query: string,
    context?: ConnectorContext,
  ): Promise<ConnectorSearchResult[]> {
    const connector = this.registry.getOrThrow(connectorId);
    assertConnectorAvailable(connector);
    if (!connector.supportsSearch || !connector.search) {
      throw new Error(`Connector "${connectorId}" does not support search.`);
    }
    return connector.search(query, context);
  }

  /**
   * Run a full import for one connector: fetch raw data, normalise to {@link ImportReviewDraft},
   * then validate. Persist layers consume the returned draft only.
   */
  async import<TInput>(
    connectorId: ConnectorId,
    input: TInput,
    context?: ConnectorContext,
  ): Promise<ImportReviewDraft> {
    const connector = this.registry.getOrThrow(connectorId);
    assertConnectorAvailable(connector);

    const raw = await connector.fetch(input, context);
    const draft = connector.normalize(raw, context);
    const validationIssues = validateImportReviewDraft(draft);

    if (validationIssues.some(issue => issue.severity === 'error')) {
      return {
        ...draft,
        issues: [...draft.issues, ...validationIssues],
      };
    }

    return {
      ...draft,
      issues: [...draft.issues, ...validationIssues],
    };
  }
}

export function createIntegrationEngine(registry: IntegrationRegistry): IntegrationEngine {
  return new IntegrationEngine(registry);
}
