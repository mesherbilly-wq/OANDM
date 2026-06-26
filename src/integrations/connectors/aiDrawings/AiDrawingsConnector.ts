import { createPlannedConnector } from '../createPlannedConnector';

/**
 * AI drawing extraction import.
 * Will wrap existing `extract-drawing` output in a later phase without changing that flow today.
 */
export const aiDrawingsConnector = createPlannedConnector({
  id: 'ai_drawings',
  label: 'AI Drawings',
  description: 'Extract devices from floor plans, site plans, and drawing schedules.',
  supportsSearch: false,
});
