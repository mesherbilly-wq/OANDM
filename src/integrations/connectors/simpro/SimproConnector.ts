import { createPlannedConnector } from '../createPlannedConnector';

/** Simpro job/quote import — API adapter to be added in a later phase. */
export const simproConnector = createPlannedConnector({
  id: 'simpro',
  label: 'Simpro',
  description: 'Pull jobs, quotes, cost centres, and catalog lines from Simpro.',
  supportsSearch: true,
});
