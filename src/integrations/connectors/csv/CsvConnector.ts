import { createPlannedConnector } from '../createPlannedConnector';

/** CSV file import — parser to be added in a later phase. */
export const csvConnector = createPlannedConnector({
  id: 'csv',
  label: 'CSV',
  description: 'Import device lists from CSV files.',
  supportsSearch: false,
});
