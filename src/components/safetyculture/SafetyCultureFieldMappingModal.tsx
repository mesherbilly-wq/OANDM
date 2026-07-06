import React, { useEffect, useState } from 'react';
import {
  AlertCircle, Check, ChevronRight, Loader2, Search, X, CheckCircle,
} from 'lucide-react';
import { invokeSafetyCulture } from '../../lib/safetyCultureApi';
import type { SCTemplateItem, SCTableItem } from '../../types';
import { ALL_MAPPABLE_FIELDS, DEVICE_FIELDS, SC_DEFAULT_AUDIT_TITLE_ITEM_ID } from './safetyCultureFields';

export interface SafetyCultureFieldMappingResult {
  field_mappings: Record<string, string>;
  table_column_mappings: Record<string, string>;
}

interface Props {
  templateId: string;
  templateName: string;
  initialFieldMappings: Record<string, string>;
  initialTableMappings?: Record<string, string>;
  onSave: (result: SafetyCultureFieldMappingResult) => void | Promise<void>;
  onClose: () => void;
}

export function SafetyCultureFieldMappingModal({
  templateId,
  templateName,
  initialFieldMappings,
  initialTableMappings = {},
  onSave,
  onClose,
}: Props) {
  const [templateItems, setTemplateItems] = useState<SCTemplateItem[]>([]);
  const [tableItems, setTableItems] = useState<SCTableItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [diagResults, setDiagResults] = useState<any[] | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>(initialFieldMappings);
  const [tableMappings, setTableMappings] = useState<Record<string, string>>(initialTableMappings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFieldMappings(initialFieldMappings);
    setTableMappings(initialTableMappings);
  }, [initialFieldMappings, initialTableMappings, templateId]);

  useEffect(() => {
    let cancelled = false;
    setItemsLoading(true);
    setTemplateItems([]);
    setTableItems([]);
    setDiagResults(null);

    invokeSafetyCulture('get_template_definition', { template_id: templateId })
      .then(data => {
        if (cancelled) return;
        const loadedItems: SCTemplateItem[] = data.items ?? [];
        setTemplateItems(loadedItems);
        setTableItems(data.tableItems ?? []);
        const auditTitleItem = loadedItems.find(
          item => item.item_id === SC_DEFAULT_AUDIT_TITLE_ITEM_ID
            || /audit\s*title/i.test(item.label),
        );
        if (auditTitleItem) {
          setFieldMappings(prev => (
            prev.inspection_title
              ? prev
              : { ...prev, inspection_title: auditTitleItem.item_id }
          ));
        }
      })
      .catch(() => { /* fall through to diagnostic UI */ })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });

    return () => { cancelled = true; };
  }, [templateId]);

  const runDiagnostic = async () => {
    setDiagLoading(true);
    setDiagResults(null);
    try {
      const data = await invokeSafetyCulture('diagnose_template', { template_id: templateId });
      setDiagResults(data.results ?? []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Diagnostic failed';
      setDiagResults([{
        label: 'Error calling diagnostic',
        url: '',
        status: null,
        ok: false,
        error: message,
        raw_body: null,
        top_keys: [],
        item_count: 0,
      }]);
    } finally {
      setDiagLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ field_mappings: fieldMappings, table_column_mappings: tableMappings });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Field linking</h3>
            <p className="text-xs text-slate-500 mt-0.5">{templateName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {itemsLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading template fields…</span>
            </div>
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
                    <span className="text-xs text-amber-600 font-mono bg-amber-100 px-2 py-0.5 rounded">
                      Template ID: {templateId}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void runDiagnostic()}
                disabled={diagLoading}
                className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-3 text-sm font-medium text-slate-600 hover:border-cyan-400 hover:text-cyan-700 hover:bg-cyan-50 transition-all disabled:opacity-50"
              >
                {diagLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Running diagnostic…</>
                ) : (
                  <><Search className="w-4 h-4" />Run API diagnostic</>
                )}
              </button>
              {diagResults && (
                <div className="space-y-2">
                  {diagResults.map((r: any, i: number) => (
                    <div
                      key={i}
                      className={`rounded-xl border p-4 ${r.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {r.ok ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <X className="w-4 h-4 text-red-500" />}
                        <span className={`text-xs font-semibold ${r.ok ? 'text-emerald-800' : 'text-red-800'}`}>{r.label}</span>
                        {r.status != null && (
                          <span className={`ml-auto text-xs font-mono font-bold px-2 py-0.5 rounded-full ${r.ok ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'}`}>
                            HTTP {r.status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-slate-500 break-all">{r.url}</p>
                      {r.item_count > 0 && <p className="text-xs text-emerald-700 font-medium mt-1">Items found: {r.item_count}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="bg-cyan-50 border border-cyan-200 rounded-lg px-4 py-3 text-xs text-cyan-900">
                <p className="font-semibold">Audit Title / inspection name</p>
                <p className="mt-1 text-cyan-800">
                  Set automatically when creating inspections (e.g. <em>Project name - Document title</em>).
                  Map <strong>Audit Title</strong> below only if your template uses a renamed title field.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Project &amp; device fields</p>
                <p className="text-xs text-slate-400 mb-4">
                  Map each OANDM field to the matching SafetyCulture template field.
                </p>
                <div className="space-y-2">
                  {ALL_MAPPABLE_FIELDS.map(f => (
                    <div
                      key={f.key}
                      className={`flex items-center gap-3 ${f.key === 'inspection_title' ? 'bg-slate-50 border border-slate-200 rounded-lg px-3 py-2' : ''}`}
                    >
                      <div className="w-40 text-xs font-medium text-slate-700 flex-shrink-0">{f.label}</div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                      <select
                        value={fieldMappings[f.key] ?? ''}
                        onChange={e => setFieldMappings(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        <option value="">— not mapped —</option>
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
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Table column mapping</p>
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
                              <option value="">— not mapped —</option>
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
          <p className="text-xs text-slate-400">Saved on this document definition; also updates the template default.</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || templateItems.length === 0}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-40"
            >
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : <><Check className="w-3.5 h-3.5" />Apply linking</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
