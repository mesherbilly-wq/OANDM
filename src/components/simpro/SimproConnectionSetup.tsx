import React, { useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle, Loader2, Plug, Unplug,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  loadSimproConnection,
  saveSimproConnection,
  unlinkSimproConnection,
  isSimproJobDiscoveryEnabled,
} from '../../lib/simproConnectionSession';
import { SimproJobDiscoveryDebug } from './SimproJobDiscoveryDebug';
import migration028Sql from '../../../supabase/migrations/20260916140000_028_app_roles_and_simpro.sql?raw';

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
  const [unlinking, setUnlinking] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [sqlCopied, setSqlCopied] = useState(false);
  const showJobDiscovery = isSimproJobDiscoveryEnabled();

  useEffect(() => {
    let cancelled = false;
    loadSimproConnection().then(({ connection, needsMigration: missingTable }) => {
      if (cancelled) return;
      setNeedsMigration(missingTable);
      if (connection) {
        setBaseUrl(connection.baseUrl);
        setCompanyId(connection.companyId);
        setApiToken(connection.apiToken);
        setTestResult({
          companyName: connection.companyName,
          apiVersion: connection.apiVersion,
          lastTested: new Date(connection.connectedAt).toLocaleString(),
          status: 'connected',
        });
        onSessionConnectedChange?.(true);
      } else {
        onSessionConnectedChange?.(false);
      }
      setLoadingSaved(false);
    });
    return () => {
      cancelled = true;
    };
  }, [onSessionConnectedChange]);

  const copyMigrationSql = async () => {
    try {
      await navigator.clipboard.writeText(migration028Sql);
      setSqlCopied(true);
      window.setTimeout(() => setSqlCopied(false), 2500);
    } catch {
      setTestError('Clipboard is blocked. Copy the SQL from the Users page or the supabase/migrations folder.');
    }
  };

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

      const connectedAt = new Date().toISOString();
      const result: TestResult = {
        companyName: data.company_name ?? null,
        apiVersion: data.api_version ?? null,
        lastTested: new Date(connectedAt).toLocaleString(),
        status: data.status ?? 'connected',
      };

      const saved = await saveSimproConnection({
        baseUrl: baseUrl.trim(),
        companyId: companyId.trim(),
        apiToken: apiToken.trim(),
        connectedAt,
        companyName: result.companyName,
        apiVersion: result.apiVersion,
      });

      if (saved.error) {
        setNeedsMigration(saved.needsMigration);
        throw new Error(saved.needsMigration
          ? 'Connection tested, but it could not be saved. Paste 028 in the Supabase SQL Editor, then test again.'
          : `Connection tested, but it could not be saved: ${saved.error}`);
      }

      setNeedsMigration(false);
      setTestResult(result);
      onSessionConnectedChange?.(true);
    } catch (e: unknown) {
      setTestError(e instanceof Error ? e.message : 'Connection test failed');
      onSessionConnectedChange?.(false);
    } finally {
      setTesting(false);
    }
  };

  const runUnlink = async () => {
    if (!confirm('Unlink Simpro? Imports will stop until you connect again.')) return;
    setUnlinking(true);
    setTestError(null);
    const result = await unlinkSimproConnection();
    setUnlinking(false);
    if (result.error) {
      setNeedsMigration(result.needsMigration);
      setTestError(result.error);
      return;
    }
    setTestResult(null);
    setApiToken('');
    onSessionConnectedChange?.(false);
  };

  if (loadingSaved) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading saved connection…
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-5">
      <p className="text-xs text-slate-500">
        Configure one Simpro company connection for this workspace. A successful test saves the connection in the database
        so it stays after a deployment. Unlink only when you want to remove it.
      </p>

      {needsMigration && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
          <p className="text-xs text-amber-900 font-semibold">Run 028 in the Supabase SQL Editor so the connection can be saved.</p>
          <button
            type="button"
            onClick={() => void copyMigrationSql()}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            {sqlCopied ? 'Copied 028 — paste in Supabase' : 'Copy 028 SQL'}
          </button>
        </div>
      )}

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
          onClick={() => void runTestConnection()}
          disabled={testing || unlinking || !baseUrl.trim() || !companyId.trim() || !apiToken.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 text-white hover:bg-cyan-700 transition-colors disabled:opacity-50"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          {testing ? 'Testing…' : 'Test and save'}
        </button>

        {testResult && (
          <button
            type="button"
            onClick={() => void runUnlink()}
            disabled={testing || unlinking}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {unlinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
            Unlink
          </button>
        )}
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
            Connected — saved until you unlink
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
          Not connected — test and save to keep it after deployments
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
