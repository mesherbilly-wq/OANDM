import React, { useMemo } from 'react';
import {
  Building, Briefcase, Truck, FileText, FileSpreadsheet, ImageIcon, PenLine, Sparkles,
} from 'lucide-react';
import {
  createIntegrationCentre,
  type AnyIntegrationConnector,
  type ConnectorId,
} from '../integrations';

type ConnectorUiStatus = 'available' | 'existing' | 'planned' | 'coming_soon';

const CONNECTOR_ICONS: Record<ConnectorId, React.ComponentType<{ className?: string }>> = {
  simpro: Building,
  halopsa: Briefcase,
  bigchange: Truck,
  csv: FileText,
  excel: FileSpreadsheet,
  ai_documents: FileText,
  ai_drawings: ImageIcon,
  manual: PenLine,
};

const STATUS_LABELS: Record<ConnectorUiStatus, string> = {
  available: 'Available',
  existing: 'Existing',
  planned: 'Planned',
  coming_soon: 'Coming Soon',
};

const STATUS_STYLES: Record<ConnectorUiStatus, string> = {
  available: 'text-emerald-700 bg-emerald-50',
  existing: 'text-cyan-700 bg-cyan-50',
  planned: 'text-slate-500 bg-slate-100',
  coming_soon: 'text-slate-400 bg-slate-100',
};


function getConnectorUiStatus(connector: AnyIntegrationConnector): ConnectorUiStatus {
  if (connector.id === 'ai_documents' || connector.id === 'ai_drawings') return 'existing';
  if (connector.id === 'simpro') return 'available';
  if (connector.availability === 'available') return 'available';
  return 'planned';
}

function isConnectorSelectable(status: ConnectorUiStatus): boolean {
  return status === 'existing' || status === 'available';
}

function connectorFootnote(connector: AnyIntegrationConnector, status: ConnectorUiStatus): string | null {
  if (connector.id === 'simpro' && status === 'available') {
    return 'Configure connection in Integrations first';
  }
  if (connector.id === 'manual' && status === 'available') {
    return 'Start blank project coming soon';
  }
  return null;
}

export function ImportSourceSelector({
  onSelect,
}: {
  onSelect: (connectorId: ConnectorId) => void;
}) {
  const connectors = useMemo(() => createIntegrationCentre().listConnectors(), []);

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">Integration Centre</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Import sources registered in OANDM — connectors normalise to a shared project model.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {connectors.map(connector => {
          const Icon = CONNECTOR_ICONS[connector.id];
          const status = getConnectorUiStatus(connector);
          const selectable = isConnectorSelectable(status);
          const footnote = connectorFootnote(connector, status);

          return (
            <button
              key={connector.id}
              type="button"
              disabled={!selectable}
              onClick={() => selectable && onSelect(connector.id)}
              className={`relative text-left bg-white border rounded-xl p-5 transition-all ${
                selectable
                  ? 'border-slate-200 hover:border-cyan-400 hover:shadow-md cursor-pointer'
                  : 'border-slate-100 opacity-70 cursor-not-allowed'
              }`}
            >
              <span
                className={`absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_STYLES[status]}`}
              >
                {STATUS_LABELS[status]}
              </span>

              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                  selectable ? 'bg-cyan-50' : 'bg-slate-100'
                }`}
              >
                <Icon className={`w-5 h-5 ${selectable ? 'text-cyan-600' : 'text-slate-400'}`} />
              </div>

              <div className="flex items-center gap-1.5 mb-1 pr-16">
                <h3 className="text-sm font-semibold text-slate-900">{connector.label}</h3>
                {status === 'existing' && (
                  <Sparkles className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                )}
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">{connector.description}</p>

              {footnote && (
                <p className="text-[11px] text-amber-700 mt-2 font-medium">{footnote}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
