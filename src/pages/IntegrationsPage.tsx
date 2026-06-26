import React, { useMemo } from 'react';
import {
  Building, Briefcase, Truck, FileText, FileSpreadsheet, ImageIcon, PenLine, Plug, Unplug,
} from 'lucide-react';
import { createIntegrationCentre } from '../integrations';
import {
  buildIntegrationSettingsGroups,
  INTEGRATION_SETTINGS_STATUS_LABELS,
  INTEGRATION_SETTINGS_STATUS_STYLES,
  type IntegrationSettingsGroupView,
} from '../integrations/settings/integrationSettingsGroups';

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  simpro: Building,
  halopsa: Briefcase,
  bigchange: Truck,
  csv_excel: FileSpreadsheet,
  ai_documents: FileText,
  ai_drawings: ImageIcon,
  manual: PenLine,
};

const inputClass =
  'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-400 bg-slate-50 cursor-not-allowed';

function SimproConfigShell() {
  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
      <p className="text-xs text-slate-500">
        Connection settings will be saved securely server-side in a future release. No credentials are stored yet.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 mb-1 block">Base URL</span>
          <input
            type="text"
            disabled
            placeholder="https://your-company.simprosuite.com"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 mb-1 block">Company ID</span>
          <input type="text" disabled placeholder="e.g. 0" className={inputClass} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 mb-1 block">API token / OAuth</span>
          <input type="text" disabled value="Not configured" readOnly className={inputClass} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 mb-1 block">Last sync</span>
          <input type="text" disabled value="Never" readOnly className={inputClass} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled
          title="Simpro connection will be enabled in a future release"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-200 text-slate-500 cursor-not-allowed"
        >
          <Plug className="w-4 h-4" />
          Connect
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-700">
          <Unplug className="w-3.5 h-3.5" />
          Status: Not Connected
        </span>
      </div>
    </div>
  );
}

function IntegrationSettingsCard({ group }: { group: IntegrationSettingsGroupView }) {
  const Icon = GROUP_ICONS[group.id] ?? Plug;
  const statusLabel = INTEGRATION_SETTINGS_STATUS_LABELS[group.settingsStatus];
  const statusStyle = INTEGRATION_SETTINGS_STATUS_STYLES[group.settingsStatus];

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
          <p className="text-[11px] text-slate-400 mt-1 font-mono">
            Connectors: {group.connectorIds.join(', ')}
          </p>
        </div>
      </div>

      {group.showSimproConfig && <SimproConfigShell />}

      {!group.showSimproConfig && group.settingsStatus !== 'existing' && group.settingsStatus !== 'available' && (
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
          Manage connections to external business systems. Credentials will be stored server-side only when enabled.
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
