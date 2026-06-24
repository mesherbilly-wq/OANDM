import React, { useCallback, useEffect, useState } from 'react';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import type { SCTemplateItem, SCTableItem, SCTemplateMapping } from '../types';
import {
  Shield, Key, CheckCircle, AlertCircle, Loader2, RefreshCw,
  ChevronRight, ExternalLink, X, Check, Search, Unplug,
  Settings, FileText,
} from 'lucide-react';

const PROJECT_FIELDS = [
  { key: 'job_number',      label: 'Job Number' },
  { key: 'project_name',    label: 'Project Name' },
  { key: 'client_name',     label: 'Client Name' },
  { key: 'site_name',       label: 'Site Name' },
  { key: 'site_address',    label: 'Site Address' },
  { key: 'project_manager', label: 'Project Manager' },
] as const;

const DEVICE_FIELDS = [
  { key: 'device_name',   label: 'Device Name' },
  { key: 'location',      label: 'Location' },
  { key: 'manufacturer',  label: 'Manufacturer' },
  { key: 'model_number',  label: 'Model Number' },
  { key: 'serial_number', label: 'Serial Number' },
  { key: 'ip_address',    label: 'IP Address' },
  { key: 'device_type',   label: 'Device Type' },
  { key: 'system_type',   label: 'System Type' },
] as const;

const ALL_MAPPABLE_FIELDS = [...PROJECT_FIELDS, ...DEVICE_FIELDS];

export default function SafetyCulturePage() {
  const { project } = useProject();

  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  const [mappingTemplate, setMappingTemplate] = useState<any | null>(null);
  const [templateItems, setTemplateItems] = useState<SCTemplateItem[]>([]);
  const [tableItems, setTableItems] = useState<SCTableItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [diagResults, setDiagResults] = useState<any[] | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});
  const [tableMappings, setTableMappings] = useState<Record<string, string>>({});
  const [mappingSaving, setMappingSaving] = useState(false);
  const [savedMappings, setSavedMappings] = useState<Record<string, SCTemplateMapping>>({});

  useEffect(() => {
    Promise.all([
      supabase.from('integration_settings').select('value').eq('key', 'safetyculture_api_token').maybeSingle(),
      supabase.from('sc_template_mappings').select('*'),
    ]).then(([{ data: tok }, { data: maps }]) => {
      setTokenSaved(!!tok?.value);
      setTokenLoading(false);
      const byTmpl: Record<string, SCTemplateMapping> = {};
      for (const m of maps ?? []) byTmpl[m.template_id] = m;
      setSavedMappings(byTmpl);
    });
  }, []);

  const invoke = async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('safetyculture-proxy', { body: { action, ...extra } });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const saveToken = async () => {
    if (!tokenInput.trim()) return;
    setConnectionError(null);
    setConnectionStatus('unknown');
    try {
      await invoke('save_token', { token: tokenInput.trim() });
      setTokenSaved(true);
      setTokenInput('');
      await testConnection();
    } catch (e: any) { setConnectionError(e.message); }
  };

  const disconnectToken = async () => {
    await invoke('delete_token');
    setTokenSaved(false);
    setConnectionStatus('unknown');
    setTemplates([]);
  };

  const testConnection = useCallback(async () => {
    setConnectionStatus('unknown');
    setConnectionError(null);
    try {
      await invoke('test_connection');
      setConnectionStatus('ok');
      fetchTemplates();
    } catch (e: any) {
      setConnectionStatus('error');
      setConnectionError(e.message);
    }
  }, []);

  useEffect(() => { if (tokenSaved && !tokenLoading) testConnection(); }, [tokenSaved, tokenLoading]);

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const data = await invoke('list_templates');
      setTemplates(data.templates ?? []);
    } catch { /* silent */ } finally { setTemplatesLoading(false); }
  };

  const openMapping = async (tmpl: any) => {
    setMappingTemplate(tmpl);
    setTemplateItems([]);
    setTableItems([]);
    setDiagResults(null);
    setItemsLoading(true);
    const saved = savedMappings[tmpl.template_id ?? tmpl.id];
    setFieldMappings(saved?.field_mappings ?? {});
    setTableMappings(saved?.table_column_mappings ?? {});
    try {
      const d = await invoke('get_template_definition', { template_id: tmpl.template_id ?? tmpl.id });
      setTemplateItems(d.items ?? []);
      setTableItems(d.tableItems ?? []);
    } catch { /* fall through */ }
    finally { setItemsLoading(false); }
  };

  const runDiagnostic = async () => {
    if (!mappingTemplate) return;
    setDiagLoading(true);
    setDiagResults(null);
    try {
      const d = await invoke('diagnose_template', { template_id: mappingTemplate.template_id ?? mappingTemplate.id });
      setDiagResults(d.results ?? []);
    } catch (e: any) {
      setDiagResults([{ label: 'Error calling diagnostic', url: '', status: null, ok: false, error: e.message, raw_body: null, top_keys: [], item_count: 0 }]);
    } finally { setDiagLoading(false); }
  };

  const saveMapping = async () => {
    if (!mappingTemplate) return;
    setMappingSaving(true);
    const tid = mappingTemplate.template_id ?? mappingTemplate.id;
    await supabase.from('sc_template_mappings').upsert({
      template_id: tid,
      template_name: mappingTemplate.name,
      field_mappings: fieldMappings,
      table_column_mappings: tableMappings,
    }, { onConflict: 'template_id' });
    const { data: updated } = await supabase.from('sc_template_mappings').select('*').eq('template_id', tid).single();
    if (updated) setSavedMappings(prev => ({ ...prev, [tid]: updated }));
    setMappingSaving(false);
    setMappingTemplate(null);
  };

  const filteredTemplates = templates.filter(t =>
    (t.name ?? '').toLowerCase().includes(templateSearch.toLowerCase())
  );

  if (tokenLoading) {
    return <div className="flex items-center justify-center min-h-64"><div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-md shadow-emerald-200 flex-shrink-0">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">SafetyCulture Integration</h2>
          <p className="text-sm text-slate-500 mt-0.5">Connect your API token, map templates to project fields, and configure integration settings.</p>
        </div>
      </div>

      {/* API Connection */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50">
          <Key className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">API Connection</span>
          {connectionStatus === 'ok' && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Connected
            </span>
          )}
          {connectionStatus === 'error' && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />Connection failed
            </span>
          )}
        </div>
        <div className="p-6">
          {!tokenSaved ? (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600">
                <p className="font-medium text-slate-800 mb-1">How to get your API token</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Log in to <a href="https://app.safetyculture.com" target="_blank" rel="noopener noreferrer" className="text-cyan-600 hover:underline inline-flex items-center gap-1">SafetyCulture <ExternalLink className="w-3 h-3" /></a></li>
                  <li>Go to <strong>Account Settings &gt; API Tokens</strong></li>
                  <li>Click <strong>Generate API token</strong> and copy it</li>
                </ol>
              </div>
              <div className="flex gap-3">
                <input type="password" value={tokenInput} onChange={e => setTokenInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveToken()} placeholder="Paste your SafetyCulture API token..." className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono" />
                <button onClick={saveToken} disabled={!tokenInput.trim()} className="bg-cyan-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-cyan-700 transition-colors disabled:opacity-40">Connect</button>
              </div>
              {connectionError && <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{connectionError}</div>}
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex-1 text-sm text-slate-600">
                {connectionStatus === 'ok' && 'Token verified. Templates are listed below \u2014 click a template to configure field mapping.'}
                {connectionStatus === 'error' && <span className="text-red-600">{connectionError}</span>}
                {connectionStatus === 'unknown' && <span className="text-slate-400">Verifying...</span>}
              </div>
              <button onClick={testConnection} className="flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"><RefreshCw className="w-3 h-3" />Test</button>
              <button onClick={disconnectToken} className="flex items-center gap-1.5 text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"><Unplug className="w-3 h-3" />Disconnect</button>
            </div>
          )}
        </div>
      </div>

      {/* Templates with mapping */}
      {connectionStatus === 'ok' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50">
            <FileText className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">Template Mapping</span>
            {templates.length > 0 && <span className="text-xs text-slate-400">{templates.length} found</span>}
            <div className="ml-auto flex items-center gap-2">
              {templates.length > 5 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={templateSearch} onChange={e => setTemplateSearch(e.target.value)} placeholder="Search..." className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                </div>
              )}
              <button onClick={fetchTemplates} className="text-slate-400 hover:text-slate-600 transition-colors"><RefreshCw className={`w-3.5 h-3.5 ${templatesLoading ? 'animate-spin' : ''}`} /></button>
            </div>
          </div>
          {templatesLoading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading templates...</span></div>
          ) : filteredTemplates.length === 0 ? (
            <div className="text-center py-10 text-sm text-slate-400">{templates.length === 0 ? 'No templates found' : 'No templates match'}</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredTemplates.map(t => {
                const tid = t.template_id ?? t.id;
                const isMapped = !!savedMappings[tid];
                const mappedCount = isMapped ? Object.keys(savedMappings[tid].field_mappings).length : 0;
                return (
                  <div key={tid} className="flex items-center gap-4 px-6 py-4">
                    <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{t.name ?? 'Unnamed'}</p>
                      {isMapped ? (
                        <p className="text-xs text-emerald-600 mt-0.5">{mappedCount} field{mappedCount !== 1 ? 's' : ''} mapped</p>
                      ) : (
                        <p className="text-xs text-amber-600 mt-0.5">No field mapping configured</p>
                      )}
                    </div>
                    <button
                      onClick={() => openMapping(t)}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${isMapped ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-cyan-600 text-white hover:bg-cyan-700'}`}
                    >
                      <Settings className="w-3.5 h-3.5" />{isMapped ? 'Edit Mapping' : 'Map Fields'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Integration info */}
      {connectionStatus === 'ok' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">How it works</h3>
          <ul className="text-xs text-slate-500 space-y-1.5 list-disc list-inside">
            <li>Map your SafetyCulture template fields to project data (job number, client name, etc.)</li>
            <li>From the <strong>Handover</strong> or <strong>Commissioning</strong> pages, create inspections for each document</li>
            <li>Inspections are auto-named using your project name and document type</li>
            <li>Import results back when the inspection is completed in SafetyCulture</li>
          </ul>
        </div>
      )}

      {/* Field Mapping Modal */}
      {mappingTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Field Mapping</h3>
                <p className="text-xs text-slate-500 mt-0.5">{mappingTemplate.name}</p>
              </div>
              <button onClick={() => setMappingTemplate(null)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {itemsLoading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading template fields...</span></div>
              ) : templateItems.length === 0 ? (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-2">
                        <p className="text-sm font-semibold text-amber-900">Template fields could not be loaded.</p>
                        <p className="text-xs text-amber-700">
                          Run the diagnostic below to check which endpoints were tried and what was returned.
                        </p>
                        <span className="text-xs text-amber-600 font-mono bg-amber-100 px-2 py-0.5 rounded">Template ID: {mappingTemplate?.template_id ?? mappingTemplate?.id}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={runDiagnostic} disabled={diagLoading} className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-3 text-sm font-medium text-slate-600 hover:border-cyan-400 hover:text-cyan-700 hover:bg-cyan-50 transition-all disabled:opacity-50">
                    {diagLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Running diagnostic...</> : <><Search className="w-4 h-4" />Run API Diagnostic</>}
                  </button>
                  {diagResults && (
                    <div className="space-y-2">
                      {diagResults.map((r: any, i: number) => (
                        <div key={i} className={`rounded-xl border p-4 ${r.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            {r.ok ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <X className="w-4 h-4 text-red-500" />}
                            <span className={`text-xs font-semibold ${r.ok ? 'text-emerald-800' : 'text-red-800'}`}>{r.label}</span>
                            {r.status != null && <span className={`ml-auto text-xs font-mono font-bold px-2 py-0.5 rounded-full ${r.ok ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'}`}>HTTP {r.status}</span>}
                          </div>
                          <p className="text-xs font-mono text-slate-500 break-all">{r.url}</p>
                          {r.item_count > 0 && <p className="text-xs text-emerald-700 font-medium mt-1">Items found: {r.item_count}</p>}
                          {r.raw_body && (
                            <details className="mt-2">
                              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">View raw response</summary>
                              <pre className="mt-1 text-xs bg-white/60 text-slate-700 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-48">{r.raw_body}</pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Field Mapping</p>
                    <p className="text-xs text-slate-400 mb-4">
                      For each project field, select the matching field from your SafetyCulture template.
                    </p>
                    <div className="space-y-2">
                      {[...ALL_MAPPABLE_FIELDS, { key: 'commissioning_date', label: 'Commissioning Date' } as const].map(f => (
                        <div key={f.key} className="flex items-center gap-3">
                          <div className="w-40 text-xs font-medium text-slate-700 flex-shrink-0">{f.label}</div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                          <select
                            value={fieldMappings[f.key] ?? ''}
                            onChange={e => setFieldMappings(prev => ({ ...prev, [f.key]: e.target.value }))}
                            className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          >
                            <option value="">-- not mapped --</option>
                            {templateItems.map(i => (
                              <option key={i.item_id} value={i.item_id}>{i.label} ({i.type})</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {tableItems.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Table Column Mapping</p>
                      {tableItems.map(tbl => (
                        <div key={tbl.item_id} className="mb-4 border border-slate-200 rounded-xl overflow-hidden">
                          <div className="bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">{tbl.label}</div>
                          <div className="p-3 space-y-2">
                            {tbl.columns.map(col => (
                              <div key={col.field_id} className="flex items-center gap-3">
                                <div className="w-40 text-xs font-medium text-slate-700 flex-shrink-0">{col.label}</div>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                                <select
                                  value={tableMappings[col.field_id] ?? ''}
                                  onChange={e => setTableMappings(prev => ({ ...prev, [col.field_id]: e.target.value }))}
                                  className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                >
                                  <option value="">-- not mapped --</option>
                                  {DEVICE_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-400">Mappings are reused across all documents using this template.</p>
              <div className="flex gap-3">
                <button onClick={() => setMappingTemplate(null)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
                <button
                  onClick={saveMapping}
                  disabled={mappingSaving || templateItems.length === 0}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40"
                >
                  {mappingSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving...</> : <><Check className="w-3.5 h-3.5" />Save Mapping</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
