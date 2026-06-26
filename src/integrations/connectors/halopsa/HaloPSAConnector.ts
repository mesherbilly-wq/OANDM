import { createPlannedConnector } from '../createPlannedConnector';

/** HaloPSA ticket/project import — adapter to be added in a later phase. */
export const haloPsaConnector = createPlannedConnector({
  id: 'halopsa',
  label: 'HaloPSA',
  description: 'Pull client, site, and asset data from HaloPSA.',
  supportsSearch: true,
});
