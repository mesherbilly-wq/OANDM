export type {
  IntegrationConnector,
  AnyIntegrationConnector,
} from './IntegrationConnector';
export { assertConnectorAvailable, isConnectorAvailable } from './IntegrationConnector';

export { IntegrationRegistry } from './IntegrationRegistry';
export { IntegrationEngine, createIntegrationEngine } from './IntegrationEngine';

export {
  createDraftId,
  flattenEquipment,
  selectedEquipment,
  selectedSystems,
  selectedDeviceCount,
  resolvedSystemType,
  resolvedCategory,
  resolvedEquipmentSystemType,
  resolvedEquipmentCategory,
  allSelectedSystemsTyped,
  allSelectedSystemsCategorised,
  hasSelectedEquipment,
  equipmentLineSelectionSummary,
  importSelectionSummary,
} from './draftHelpers';

export { validateImportReviewDraft, assertReviewDraftReadyForPersist } from './draftValidation';

export {
  classifyImportReviewNote,
  partitionImportReviewNotes,
  getImportReviewBlockingIssues,
  getImportReviewCreateConfirmationIssues,
} from './importReviewNotes';
export type { ImportReviewNoteBucket, PartitionedImportReviewNotes } from './importReviewNotes';

export type {
  ProductMatchMethod,
  EquipmentMatchResolution,
  ProductMatchSuggestion,
  EquipmentProductMatch,
  ProductMatchSummary,
  SavedEquipmentProductMatch,
} from './productMatching';

export {
  matchEquipmentToProduct,
  buildEquipmentProductMatches,
  summarizeProductMatches,
  applyProductMatchesToDraft,
  savedMatchesFromEquipmentMatches,
} from './productMatching';
