import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle, ExternalLink, Loader2, Plug, RefreshCw, Unplug,
} from 'lucide-react';
import { formatSafetyCultureError, normalizeSafetyCultureToken } from '../../lib/safetyCultureToken';
import { invokeSafetyCulture } from '../../lib/safetyCultureApi';
import { supabase } from '../../lib/supabase';

const inputClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono';

export function SafetyCultureConnectionSetup({
  onConnectionChange,
}: {
  onConnectionChange?: (connected: boolean) => void;
} = {}) {
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setConnectionStatus('unknown');
    setConnectionError(null);
    onConnectionChange?.(false);
    try {
      await invokeSafetyCulture('test_connection');
      setConnectionStatus('ok');
      onConnectionChange?.(true);
    } catch (e: unknown) {
      setConnectionStatus('error');
      const message = e instanceof Error ? e.message : 'Connection failed';
      setConnectionError(formatSafetyCultureError(message));
      onConnectionChange?.(false);
    } finally {
      setTesting(false);
    }
  }, [onConnectionChange]);

  useEffect(() => {
    supabase
      .from('integration_settings')
      .select('value')
      .eq('key', 'safetyculture_api_token')
      .maybeSingle()
      .then(({ data }) => {
        const saved = !!data?.value;
        setTokenSaved(saved);
        setTokenLoading(false);
        if (saved) void testConnection();
        else onConnectionChange?.(false);
      });
  }, [onConnectionChange, testConnection]);

  const saveToken = async () => {
    const normalized = normalizeSafetyCultureToken(tokenInput);
    if (!normalized) return;
    setConnectionError(null);
    setConnectionStatus('unknown');
    try {
      await invokeSafetyCulture('save_token', { token: normalized });
      setTokenSaved(true);
      setTokenInput('');
      await testConnection();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Connection failed';
      setConnectionError(formatSafetyCultureError(message));
      onConnectionChange?.(false);
    }
  };

  const disconnectToken = async () => {
    await invokeSafetyCulture('delete_token');
    setTokenSaved(false);
    setConnectionStatus('unknown');
    setConnectionError(null);
    onConnectionChange?.(false);
  };

  if (tokenLoading) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking connection…
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-5">
      <p className="text-xs text-slate-500">
        Connect your SafetyCulture API token for handover and commissioning inspections.
        Link templates to documents and configure field mapping on the Handover Config tab.
      </p>

      {!tokenSaved ? (
        <div className="space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800 mb-1">How to get your API token</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>
                Log in to{' '}
                <a
                  href="https://app.safetyculture.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-600 hover:underline inline-flex items-center gap-1"
                >
                  SafetyCulture <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>Open <strong>My Profile → Settings → API tokens</strong></li>
              <li>
                Generate a token (starts with <code className="font-mono text-[11px]">scapi_</code>) and paste below
              </li>
            </ol>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700 mb-1 block">API Token</span>
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void saveToken()}
              placeholder="Paste your SafetyCulture API token…"
              className={inputClass}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveToken()}
              disabled={!tokenInput.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 text-white hover:bg-cyan-700 transition-colors disabled:opacity-50"
            >
              <Plug className="w-4 h-4" />
              Connect
            </button>
          </div>
          {connectionError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{connectionError}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void testConnection()}
              disabled={testing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 text-white hover:bg-cyan-700 transition-colors disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              type="button"
              onClick={() => void disconnectToken()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
            >
              <Unplug className="w-4 h-4" />
              Disconnect
            </button>
            <button
              type="button"
              onClick={() => void testConnection()}
              disabled={testing}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${testing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {connectionError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{connectionError}</span>
            </div>
          )}

          {connectionStatus === 'ok' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                <CheckCircle className="w-4 h-4" />
                Connected
              </div>
              <p className="text-xs text-emerald-700 mt-1">
                API token verified. Configure templates and field linking per document on Handover → Handover Config.
              </p>
            </div>
          )}

          {connectionStatus === 'unknown' && testing && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Verifying…
            </span>
          )}

          {connectionStatus === 'unknown' && !testing && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700">
              <Unplug className="w-3.5 h-3.5" />
              Not verified — run a test to confirm
            </span>
          )}
        </>
      )}
    </div>
  );
}
