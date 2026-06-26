import React, { useState } from 'react';
import {
  CheckCircle, AlertCircle, Loader2, ChevronRight, ChevronLeft, Plug, Unplug,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type WizardStep = 1 | 2 | 3 | 4;

interface TestResult {
  companyName: string | null;
  apiVersion: string | null;
  lastTested: string;
  status: string;
}

const STEP_LABELS = ['Base URL', 'Company ID', 'API Token', 'Test Connection'];

const activeInputClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent';

export function SimproConnectionWizard() {
  const [step, setStep] = useState<WizardStep>(1);
  const [baseUrl, setBaseUrl] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const canContinue = () => {
    if (step === 1) return baseUrl.trim().length > 0;
    if (step === 2) return companyId.trim().length > 0;
    if (step === 3) return apiToken.trim().length > 0;
    return true;
  };

  const runTestConnection = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);

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

      if (!data?.ok) {
        throw new Error('Connection test failed');
      }

      setTestResult({
        companyName: data.company_name ?? null,
        apiVersion: data.api_version ?? null,
        lastTested: new Date().toLocaleString(),
        status: data.status ?? 'connected',
      });
    } catch (e: unknown) {
      setTestError(e instanceof Error ? e.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-5">
      <p className="text-xs text-slate-500">
        One Simpro company connection per workspace. Import will use <strong className="font-medium text-slate-600">job numbers</strong> only
        (Simpro quotes become jobs before OANDM imports them). Credentials stay in this session only — nothing is saved yet.
      </p>

      {/* Step indicator */}
      <div className="flex flex-wrap gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as WizardStep;
          const active = step === n;
          const done = step > n;
          return (
            <div
              key={label}
              className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
                active
                  ? 'border-cyan-600 text-cyan-700 bg-cyan-50'
                  : done
                    ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                    : 'border-slate-200 text-slate-400 bg-white'
              }`}
            >
              {done ? <CheckCircle className="w-3 h-3" /> : <span>{n}</span>}
              {label}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <label className="block">
          <span className="text-sm font-medium text-slate-700 mb-1 block">Step 1 — Base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://your-company.simprosuite.com/api"
            className={activeInputClass}
          />
          <p className="text-xs text-slate-400 mt-1">Your Simpro API base URL for this workspace.</p>
        </label>
      )}

      {step === 2 && (
        <label className="block">
          <span className="text-sm font-medium text-slate-700 mb-1 block">Step 2 — Company ID</span>
          <input
            type="text"
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            placeholder="e.g. 0"
            className={activeInputClass}
          />
          <p className="text-xs text-slate-400 mt-1">The Simpro company ID for this workspace (one company only).</p>
        </label>
      )}

      {step === 3 && (
        <label className="block">
          <span className="text-sm font-medium text-slate-700 mb-1 block">Step 3 — API Token</span>
          <input
            type="password"
            value={apiToken}
            onChange={e => setApiToken(e.target.value)}
            placeholder="Paste your Simpro API token"
            className={activeInputClass}
            autoComplete="off"
          />
          <p className="text-xs text-slate-400 mt-1">Sent to the server only for this test — not stored.</p>
        </label>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div>
            <span className="text-sm font-medium text-slate-700 mb-2 block">Step 4 — Test Connection</span>
            <p className="text-xs text-slate-500 mb-3">
              Verify access to Simpro using the details entered above.
            </p>
            <button
              type="button"
              onClick={runTestConnection}
              disabled={testing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 text-white hover:bg-cyan-700 transition-colors disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
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
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => setStep(s => (s > 1 ? ((s - 1) as WizardStep) : s))}
          disabled={step === 1}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        {step < 4 && (
          <button
            type="button"
            onClick={() => {
              setStep(s => (s < 4 ? ((s + 1) as WizardStep) : s));
              if (step === 3) {
                setTestError(null);
                setTestResult(null);
              }
            }}
            disabled={!canContinue()}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
