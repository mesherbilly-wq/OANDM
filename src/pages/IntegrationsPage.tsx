import React, { useMemo, useState } from 'react';
import {
  Building, Briefcase, Truck, FileText, FileSpreadsheet, ImageIcon, PenLine, Plug, Shield,
} from 'lucide-react';
import { createIntegrationCentre } from '../integrations';
import {
  buildIntegrationSettingsGroups,
  INTEGRATION_SETTINGS_STATUS_LABELS,
  INTEGRATION_SETTINGS_STATUS_STYLES,
  type IntegrationSettingsGroupView,
} from '../integrations/settings/integrationSettingsGroups';
import { SimproConnectionSetup } from '../components/simpro/SimproConnectionSetup';
import { SafetyCultureConnectionSetup } from '../components/safetyculture/SafetyCultureConnectionSetup';

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  simpro: Building,
  safetyculture: Shield,
  halopsa: Briefcase,
  bigchange: Truck,
  csv_excel: FileSpreadsheet,
  ai_documents: FileText,
  ai_drawings: ImageIcon,
  manual: PenLine,
};

function IntegrationSettingsCard({ group }: { group: IntegrationSettingsGroupView }) {
  const Icon = GROUP_ICONS[group.id] ?? Plug;
  const [simproSessionConnected, setSimproSessionConnected] = useState(false);
  const [safetyCultureConnected, setSafetyCultureConnected] = useState(false);
  const statusLabel =
    group.id === 'simpro' && simproSessionConnected
      ? 'Connected'
      : group.id === 'safetyculture' && safetyCultureConnected
        ? 'Connected'
        : INTEGRATION_SETTINGS_STATUS_LABELS[group.settingsStatus];
  const statusStyle =
    group.id === 'simpro' && simproSessionConnected
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : group.id === 'safetyculture' && safetyCultureConnected
        ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
        : INTEGRATION_SETTINGS_STATUS_STYLES[group.settingsStatus];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-slate-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h2 className="text-base font-semibold text-slate-900">{group.label}</h2>
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${statusStyle}`}>
              {statusLabel}
            </span>
          </div>
          <p className="text-sm text-slate-500">{group.description}</p>
          {!group.standalone && (
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Connectors: {group.connectorIds.join(', ')}
            </p>
          )}
        </div>
      </div>

      {group.showSimproConfig && (
        <SimproConnectionSetup onSessionConnectedChange={setSimproSessionConnected} />
      )}

      {group.showSafetyCultureConfig && (
        <SafetyCultureConnectionSetup onConnectionChange={setSafetyCultureConnected} />
      )}

      {!group.showSimproConfig && !group.showSafetyCultureConfig && group.settingsStatus !== 'existing' && group.settingsStatus !== 'available' && (
        <p className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-400">
          Configuration for this integration is planned. No connection settings are available yet.
        </p>
      )}

      {group.settingsStatus === 'existing' && (
        <p className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500">
          Uses the built-in Create Project flow — no external account connection required.
        </p>
      )}

      {group.settingsStatus === 'available' && group.id === 'manual' && (
        <p className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500">
          Manual project entry — no external connection required. Blank project creation coming soon.
        </p>
      )}
    </div>
  );
}

export function IntegrationsPage() {
  const groups = useMemo(() => {
    const connectors = createIntegrationCentre().listConnectors();
    return buildIntegrationSettingsGroups(connectors);
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-md">
            <Plug className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
        </div>
        <p className="text-slate-500 ml-[52px]">
          Manage connections to external business systems. Simpro and SafetyCulture API tokens are configured here.
          Link SafetyCulture templates to handover documents on Handover → Handover Config.
        </p>
      </div>

      <div className="space-y-4">
        {groups.map(group => (
          <IntegrationSettingsCard key={group.id} group={group} />
        ))}
      </div>
    </div>
  );
}
