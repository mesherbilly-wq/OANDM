import type { AnyIntegrationConnector } from './IntegrationConnector';
import type { ConnectorId } from '../types';

/** In-memory registry of connectors. UI and edge functions resolve connectors by id. */
export class IntegrationRegistry {
  private readonly connectors = new Map<ConnectorId, AnyIntegrationConnector>();

  register(connector: AnyIntegrationConnector): void {
    if (this.connectors.has(connector.id)) {
      throw new Error(`Connector "${connector.id}" is already registered.`);
    }
    this.connectors.set(connector.id, connector);
  }

  get(id: ConnectorId): AnyIntegrationConnector | undefined {
    return this.connectors.get(id);
  }

  getOrThrow(id: ConnectorId): AnyIntegrationConnector {
    const connector = this.get(id);
    if (!connector) {
      throw new Error(`Connector "${id}" is not registered.`);
    }
    return connector;
  }

  list(): AnyIntegrationConnector[] {
    return [...this.connectors.values()];
  }

  listAvailable(): AnyIntegrationConnector[] {
    return this.list().filter(c => c.availability === 'available');
  }
}
