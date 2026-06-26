import { createPlannedConnector } from '../createPlannedConnector';

/** BigChange job import — adapter to be added in a later phase. */
export const bigChangeConnector = createPlannedConnector({
  id: 'bigchange',
  label: 'BigChange',
  description: 'Pull job, site, and worksheet data from BigChange.',
  supportsSearch: true,
});
