import { createPlannedConnector } from '../createPlannedConnector';

/**
 * AI document extraction import.
 * Will wrap existing `extract-project` output in a later phase without changing that flow today.
 */
export const aiDocumentsConnector = createPlannedConnector({
  id: 'ai_documents',
  label: 'AI Documents',
  description: 'Extract project and device data from quotes, proposals, and specifications.',
  supportsSearch: false,
});
