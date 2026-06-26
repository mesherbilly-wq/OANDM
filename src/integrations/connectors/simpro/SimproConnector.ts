import { createPlannedConnector } from '../createPlannedConnector';

/** Simpro job import — API adapter to be added in a later phase (jobs only; quotes convert to jobs in Simpro). */
export const simproConnector = createPlannedConnector({
  id: 'simpro',
  label: 'Simpro',
  description: 'Pull jobs by job number, cost centres, and catalog lines from Simpro.',
  supportsSearch: true,
});
