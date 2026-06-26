/** Identifiers for all supported import connectors in the Integration Centre. */
export type ConnectorId =
  | 'simpro'
  | 'halopsa'
  | 'bigchange'
  | 'csv'
  | 'excel'
  | 'ai_documents'
  | 'ai_drawings'
  | 'manual';

export const CONNECTOR_IDS: ConnectorId[] = [
  'simpro',
  'halopsa',
  'bigchange',
  'csv',
  'excel',
  'ai_documents',
  'ai_drawings',
  'manual',
];

export type ConnectorAvailability = 'available' | 'planned';

/** Optional context passed through fetch/normalise — never contains connector secrets. */
export interface ConnectorContext {
  companyId?: string;
  existingProjectId?: number;
}

/** Search hit returned before a full fetch (jobs, quotes, tickets, files, etc.). */
export interface ConnectorSearchResult {
  id: string;
  label: string;
  subtitle: string | null;
  externalIds: Record<string, string | number>;
}
