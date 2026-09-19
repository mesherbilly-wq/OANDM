import { createPlannedConnector } from '../createPlannedConnector';

/**
 * AI document extraction import.
 * Create Project extracts with AI, then normalises into Import Review like Simpro.
 */
export const aiDocumentsConnector = createPlannedConnector({
  id: 'ai_documents',
  label: 'AI Documents',
  description: 'Extract project details, equipment and scope from quotes, proposals, and specifications (PDF or Word).',
  supportsSearch: false,
});
