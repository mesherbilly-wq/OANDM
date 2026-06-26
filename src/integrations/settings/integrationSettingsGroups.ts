import type { AnyIntegrationConnector } from '../core/IntegrationConnector';
import type { ConnectorAvailability, ConnectorId } from '../types';

export type IntegrationSettingsGroupId =
  | 'simpro'
  | 'halopsa'
  | 'bigchange'
  | 'csv_excel'
  | 'ai_documents'
  | 'ai_drawings'
  | 'manual';

export type IntegrationSettingsStatus =
  | 'not_connected'
  | 'coming_soon'
  | 'planned'
  | 'existing'
  | 'available';

export interface IntegrationSettingsGroupView {
  id: IntegrationSettingsGroupId;
  label: string;
  description: string;
  connectorIds: ConnectorId[];
  registryAvailability: ConnectorAvailability;
  settingsStatus: IntegrationSettingsStatus;
  showSimproConfig: boolean;
}

const GROUP_DEFINITIONS: {
  id: IntegrationSettingsGroupId;
  connectorIds: ConnectorId[];
  label?: string;
  showSimproConfig?: boolean;
}[] = [
  { id: 'simpro', connectorIds: ['simpro'], showSimproConfig: true },
  { id: 'halopsa', connectorIds: ['halopsa'] },
  { id: 'bigchange', connectorIds: ['bigchange'] },
  { id: 'csv_excel', connectorIds: ['csv', 'excel'], label: 'CSV / Excel' },
  { id: 'ai_documents', connectorIds: ['ai_documents'] },
  { id: 'ai_drawings', connectorIds: ['ai_drawings'] },
  { id: 'manual', connectorIds: ['manual'] },
];

function resolveSettingsStatus(
  groupId: IntegrationSettingsGroupId,
  availability: ConnectorAvailability,
): IntegrationSettingsStatus {
  if (groupId === 'simpro') return 'not_connected';
  if (groupId === 'ai_documents' || groupId === 'ai_drawings') return 'existing';
  if (groupId === 'manual' && availability === 'available') return 'available';
  if (groupId === 'halopsa' || groupId === 'bigchange' || groupId === 'csv_excel') return 'coming_soon';
  return availability === 'planned' ? 'planned' : 'coming_soon';
}

function joinDescriptions(connectors: AnyIntegrationConnector[]): string {
  return connectors.map(c => c.description).filter(Boolean).join(' · ');
}

/** Build settings cards from the live connector registry (no credentials or API calls). */
export function buildIntegrationSettingsGroups(
  connectors: AnyIntegrationConnector[],
): IntegrationSettingsGroupView[] {
  const byId = new Map(connectors.map(c => [c.id, c]));

  return GROUP_DEFINITIONS.map(def => {
    const matched = def.connectorIds
      .map(id => byId.get(id))
      .filter((c): c is AnyIntegrationConnector => !!c);

    const primary = matched[0];
    if (!primary) {
      throw new Error(`Integration settings group "${def.id}" references unknown connectors.`);
    }

    const label =
      def.label ??
      (matched.length === 1 ? primary.label : matched.map(c => c.label).join(' / '));

    const registryAvailability = matched.every(c => c.availability === 'available')
      ? 'available'
      : 'planned';

    return {
      id: def.id,
      label,
      description: joinDescriptions(matched),
      connectorIds: def.connectorIds,
      registryAvailability,
      settingsStatus: resolveSettingsStatus(def.id, primary.availability),
      showSimproConfig: !!def.showSimproConfig,
    };
  });
}

export const INTEGRATION_SETTINGS_STATUS_LABELS: Record<IntegrationSettingsStatus, string> = {
  not_connected: 'Not Connected',
  coming_soon: 'Coming Soon',
  planned: 'Planned',
  existing: 'Built-in',
  available: 'Available',
};

export const INTEGRATION_SETTINGS_STATUS_STYLES: Record<IntegrationSettingsStatus, string> = {
  not_connected: 'text-amber-700 bg-amber-50 border-amber-200',
  coming_soon: 'text-slate-500 bg-slate-100 border-slate-200',
  planned: 'text-slate-500 bg-slate-100 border-slate-200',
  existing: 'text-cyan-700 bg-cyan-50 border-cyan-200',
  available: 'text-emerald-700 bg-emerald-50 border-emerald-200',
};
