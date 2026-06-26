import { createPlannedConnector } from '../createPlannedConnector';

/** Excel workbook import — parser to be added in a later phase. */
export const excelConnector = createPlannedConnector({
  id: 'excel',
  label: 'Excel',
  description: 'Import device lists from Excel workbooks.',
  supportsSearch: false,
});
