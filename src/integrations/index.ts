/**
 * Integration Centre — long-term import foundation for OANDM.
 *
 * All external sources (Simpro, HaloPSA, files, AI, manual entry) normalise to
 * {@link ImportReviewDraft}. Downstream pages must only consume draft models.
 */

export type {
  ConnectorId,
  ConnectorAvailability,
  ConnectorContext,
  ConnectorSearchResult,
} from './types';
export { CONNECTOR_IDS } from './types';

export type {
  ImportEquipmentDraft,
  ImportSystemDraft,
  ImportProjectDraft,
  ImportReviewDraft,
  ImportReviewIssue,
  ImportSourceMeta,
  SystemTypeInference,
  SystemTypeInferenceMethod,
} from './models';

export {
  createEquipmentDraft,
  createSystemDraft,
  createEmptyProjectDraft,
  createImportReviewDraft,
} from './models';

export type {
  IntegrationConnector,
  AnyIntegrationConnector,
} from './core';

export {
  IntegrationRegistry,
  IntegrationEngine,
  createIntegrationEngine,
  validateImportReviewDraft,
  assertReviewDraftReadyForPersist,
  flattenEquipment,
  selectedEquipment,
  selectedSystems,
  selectedDeviceCount,
  resolvedSystemType,
  createDraftId,
} from './core';

export {
  createIntegrationCentreRegistry,
  registerAllConnectors,
  createManualReviewDraft,
  simproConnector,
  haloPsaConnector,
  bigChangeConnector,
  csvConnector,
  excelConnector,
  aiDocumentsConnector,
  aiDrawingsConnector,
  manualConnector,
} from './connectors';

import { createIntegrationEngine } from './core/IntegrationEngine';
import { createIntegrationCentreRegistry } from './connectors';

/** Pre-wired Integration Centre: registry + engine with all connectors registered. */
export function createIntegrationCentre(): IntegrationEngine {
  return createIntegrationEngine(createIntegrationCentreRegistry());
}
