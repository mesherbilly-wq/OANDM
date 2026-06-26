import React, { useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle, Loader2, Plug, Save, Unplug,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  getSimproConnectionSession,
  isSimproJobDiscoveryEnabled,
  setSimproConnectionSession,
} from '../../lib/simproConnectionSession';
import { SimproJobDiscoveryDebug } from './SimproJobDiscoveryDebug';

const inputClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent';

interface TestResult {
  companyName: string | null;
  apiVersion: string | null;
  lastTested: string;
  status: string;
}

export function SimproConnectionSetup({
  onSessionConnectedChange,
}: {
  onSessionConnectedChange?: (connected: boolean) => void;
} = {}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const showJobDiscovery = isSimproJobDiscoveryEnabled();

  useEffect(() => {
    const stored = getSimproConnectionSession();
    if (!stored) return;
    setBaseUrl(stored.baseUrl);
    setCompanyId(stored.companyId);
    setApiToken(stored.apiToken);
    setTestResult({
      companyName: stored.companyName,
      apiVersion: stored.apiVersion,
      lastTested: stored.connectedAt,
      status: 'connected',
    });
    onSessionConnectedChange?.(true);
  }, [onSessionConnectedChange]);

  const runTestConnection = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    onSessionConnectedChange?.(false);

    try {
      const { data, error } = await supabase.functions.invoke('simpro-proxy', {
        body: {
          action: 'test_connection',
          base_url: baseUrl.trim(),
          company_id: companyId.trim(),
          api_token: apiToken.trim(),
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      if (!data?.ok) throw new Error('Connection test failed');

      const result: TestResult = {
        companyName: data.company_name ?? null,
        apiVersion: data.api_version ?? null,
        lastTested: new Date().toLocaleString(),
        status: data.status ?? 'connected',
      };
      setTestResult(result);

      setSimproConnectionSession({
        baseUrl: baseUrl.trim(),
        companyId: companyId.trim(),
        apiToken: apiToken.trim(),
        connectedAt: new Date().toISOString(),
        companyName: result.companyName,
        apiVersion: result.apiVersion,
      });
      onSessionConnectedChange?.(true);
    } catch (e: unknown) {
      setTestError(e instanceof Error ? e.message : 'Connection test failed');
      onSessionConnectedChange?.(false);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-5">
      <p className="text-xs text-slate-500">
        Configure one Simpro company connection for this workspace. Import runs from Create Project — this page is setup only.
        Credentials stay in this browser session until server-side save is enabled.
      </p>

      <div className="grid grid-cols-1 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700 mb-1 block">Base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://your-company.simprosuite.com/api"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700 mb-1 block">Company ID</span>
          <input
            type="text"
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            placeholder="e.g. 0"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700 mb-1 block">API Token</span>
          <input
            type="password"
            value={apiToken}
            onChange={e => setApiToken(e.target.value)}
            placeholder="Paste your Simpro API token"
            className={inputClass}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runTestConnection}
          disabled={testing || !baseUrl.trim() || !companyId.trim() || !apiToken.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 text-white hover:bg-cyan-700 transition-colors disabled:opacity-50"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          {testing ? 'Testing…' : 'Test Connection'}
        </button>

        <button
          type="button"
          disabled
          title="Server-side credential storage coming soon"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-slate-400 cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          Save Connection
        </button>
        <span className="text-[11px] text-slate-400">Server-side save coming soon</span>
      </div>

      {testError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{testError}</span>
        </div>
      )}

      {testResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-3">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
            <CheckCircle className="w-4 h-4" />
            Connected
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-emerald-700/80 font-medium">Company Name</dt>
              <dd className="text-slate-800">{testResult.companyName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-emerald-700/80 font-medium">API Version</dt>
              <dd className="text-slate-800">{testResult.apiVersion ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-emerald-700/80 font-medium">Last Tested</dt>
              <dd className="text-slate-800">{testResult.lastTested}</dd>
            </div>
            <div>
              <dt className="text-xs text-emerald-700/80 font-medium">Status</dt>
              <dd className="text-slate-800 capitalize">{testResult.status}</dd>
            </div>
          </dl>
        </div>
      )}

      {!testResult && !testError && (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-700">
          <Unplug className="w-3.5 h-3.5" />
          Not connected — run a test to verify
        </span>
      )}

      {showJobDiscovery && testResult && (
        <SimproJobDiscoveryDebug
          baseUrl={baseUrl.trim()}
          companyId={companyId.trim()}
          apiToken={apiToken.trim()}
        />
      )}
    </div>
  );
}
