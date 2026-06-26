import { IntegrationRegistry } from '../core/IntegrationRegistry';
import type { IntegrationRegistry as IntegrationRegistryType } from '../core/IntegrationRegistry';
import { aiDocumentsConnector } from './aiDocuments/AiDocumentsConnector';
import { aiDrawingsConnector } from './aiDrawings/AiDrawingsConnector';
import { bigChangeConnector } from './bigchange/BigChangeConnector';
import { csvConnector } from './csv/CsvConnector';
import { excelConnector } from './excel/ExcelConnector';
import { haloPsaConnector } from './halopsa/HaloPSAConnector';
import { manualConnector } from './manual/ManualConnector';
import { simproConnector } from './simpro/SimproConnector';

export { simproConnector } from './simpro/SimproConnector';
export { haloPsaConnector } from './halopsa/HaloPSAConnector';
export { bigChangeConnector } from './bigchange/BigChangeConnector';
export { csvConnector } from './csv/CsvConnector';
export { excelConnector } from './excel/ExcelConnector';
export { aiDocumentsConnector } from './aiDocuments/AiDocumentsConnector';
export { aiDrawingsConnector } from './aiDrawings/AiDrawingsConnector';
export { manualConnector, createManualReviewDraft } from './manual/ManualConnector';
export { createPlannedConnector } from './createPlannedConnector';

const ALL_CONNECTORS = [
  simproConnector,
  haloPsaConnector,
  bigChangeConnector,
  csvConnector,
  excelConnector,
  aiDocumentsConnector,
  aiDrawingsConnector,
  manualConnector,
] as const;

/** Register every connector with a registry instance. */
export function registerAllConnectors(registry: IntegrationRegistryType): void {
  for (const connector of ALL_CONNECTORS) {
    registry.register(connector);
  }
}

/** Registry pre-loaded with all Integration Centre connectors. */
export function createIntegrationCentreRegistry(): IntegrationRegistryType {
  const registry = new IntegrationRegistry();
  registerAllConnectors(registry);
  return registry;
}
