import { createPlannedConnector } from '../createPlannedConnector';

/**
 * AI drawing extraction import.
 * Create Project extracts with AI, then normalises into Import Review like Simpro.
 */
export const aiDrawingsConnector = createPlannedConnector({
  id: 'ai_drawings',
  label: 'AI Drawings',
  description: 'Extract devices from floor plans, site plans, and drawing schedules into Import Review.',
  supportsSearch: false,
});
