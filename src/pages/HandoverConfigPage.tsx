import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCopy, Loader2, Plus, Save, Settings, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import migration024Sql from '../../supabase/migrations/20260626150000_024_handover_document_config.sql?raw';

import {
  DEFAULT_SC_FIELD_MAPPINGS,
  fetchHandoverDocumentDefinitions,
  fetchHandoverDocumentTypes,
  upsertHandoverDocumentDefinition,
  upsertHandoverDocumentType,
  deleteHandoverDocumentDefinition,
  isHandoverConfigLocalOnly,
  type HandoverDocumentDefinition,
  type HandoverDocumentType,
} from '../lib/handoverDocumentConfig';
import { invokeSafetyCulture } from '../lib/safetyCultureApi';
import { supabase } from '../lib/supabase';
import type { SCTemplateMapping } from '../types';
import {
  SafetyCultureFieldMappingModal,
  type SafetyCultureFieldMappingResult,
} from '../components/safetyculture/SafetyCultureFieldMappingModal';

const ICON_OPTIONS = [
  'file', 'camera', 'lock', 'shield_alert', 'clipboard', 'car', 'phone',
  'network', 'graduation', 'award', 'shield', 'hardhat',
];

export default function HandoverConfigPage() {
  const [types, setTypes] = useState<HandoverDocumentType[]>([]);
  const [definitions, setDefinitions] = useState<HandoverDocumentDefinition[]>([]);
  const [selectedTypeKey, setSelectedTypeKey] = useState<string>('cctv');
  const [templates, setTemplates] = useState<any[]>([]);
  const [savedMappings, setSavedMappings] = useState<Record<string, SCTemplateMapping>>({});
  const [scConnected, setScConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingDefId, setEditingDefId] = useState<number | 'new' | null>(null);
  const [fieldMappingOpen, setFieldMappingOpen] = useState(false);
  const [localConfigOnly, setLocalConfigOnly] = useState(false);
  const [migrationCopied, setMigrationCopied] = useState(false);

  const [draftDef, setDraftDef] = useState<Partial<HandoverDocumentDefinition>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [typeRows, defRows, { data: maps }, tok] = await Promise.all([
      fetchHandoverDocumentTypes(),
      fetchHandoverDocumentDefinitions(),
      supabase.from('sc_template_mappings').select('*'),
      supabase.from('integration_settings').select('value').eq('key', 'safetyculture_api_token').maybeSingle(),
    ]);

    setTypes(typeRows.filter(type => type.key !== 'project_wide'));
    setDefinitions(defRows);
    const byTmpl: Record<string, SCTemplateMapping> = {};
    for (const m of maps ?? []) byTmpl[m.template_id] = m;
    setSavedMappings(byTmpl);

    if (tok.data?.value) {
      setScConnected(true);
      try {
        const data = await invokeSafetyCulture('list_templates');
        setTemplates(data.templates ?? []);
      } catch {
        setScConnected(false);
      }
    } else {
      setScConnected(false);
    }

    setLoading(false);
    setLocalConfigOnly(isHandoverConfigLocalOnly());
  }, []);

  useEffect(() => { void load(); }, [load]);

  const typeDefinitions = useMemo(
    () => definitions
      .filter(def => def.type_key === selectedTypeKey)
      .sort((a, b) => a.display_order - b.display_order || a.title.localeCompare(b.title)),
    [definitions, selectedTypeKey],
  );

  const beginNewDefinition = () => {
    setEditingDefId('new');
    setDraftDef({
      document_id: '',
      type_key: selectedTypeKey,
      title: '',
      description: '',
      icon_key: 'file',
      sc_enabled: true,
      sc_template_id: null,
      field_mappings: { ...DEFAULT_SC_FIELD_MAPPINGS },
      required: false,
      upload_only: false,
      multi: false,
      display_order: (typeDefinitions.at(-1)?.display_order ?? 0) + 10,
      is_active: true,
    });
  };

  const beginEditDefinition = (def: HandoverDocumentDefinition) => {
    setEditingDefId(def.id);
    setDraftDef({ ...def, field_mappings: { ...DEFAULT_SC_FIELD_MAPPINGS, ...def.field_mappings } });
  };

  const saveDefinition = async () => {
    if (!draftDef.document_id?.trim() || !draftDef.title?.trim() || !draftDef.type_key) return;
    setSaving(true);
    setError(null);

    const saveError = await upsertHandoverDocumentDefinition({
      id: editingDefId === 'new' ? undefined : (editingDefId as number),
      document_id: draftDef.document_id,
      type_key: draftDef.type_key,
      title: draftDef.title,
      description: draftDef.description ?? null,
      icon_key: draftDef.icon_key ?? 'file',
      sc_enabled: draftDef.sc_enabled ?? false,
      sc_template_id: draftDef.sc_template_id ?? null,
      field_mappings: draftDef.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
      required: draftDef.required ?? false,
      upload_only: draftDef.upload_only ?? false,
      multi: draftDef.multi ?? false,
      display_order: draftDef.display_order ?? 0,
      is_active: draftDef.is_active ?? true,
    });

    setSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }

    setEditingDefId(null);
    setDraftDef({});
    await load();
    setLocalConfigOnly(isHandoverConfigLocalOnly());
  };

  const removeDefinition = async (def: HandoverDocumentDefinition) => {
    if (!confirm(`Remove "${def.title}" from the template set? Existing saved project documents are not deleted.`)) return;
    setSaving(true);
    const removeError = await deleteHandoverDocumentDefinition(def.id);
    setSaving(false);
    if (removeError) {
      setError(removeError);
      return;
    }
    await load();
  };

  const toggleTypeActive = async (type: HandoverDocumentType) => {
    setSaving(true);
    const saveError = await upsertHandoverDocumentType({ ...type, is_active: !type.is_active });
    setSaving(false);
    if (saveError) setError(saveError);
    else await load();
  };

  const selectedTemplateName = useMemo(() => {
    const tid = draftDef.sc_template_id;
    if (!tid) return '';
    const tmpl = templates.find(t => (t.template_id ?? t.id) === tid);
    return tmpl?.name ?? savedMappings[tid]?.template_name ?? tid;
  }, [draftDef.sc_template_id, templates, savedMappings]);

  const applyTemplateSelection = (templateId: string | null) => {
    const global = templateId ? savedMappings[templateId]?.field_mappings : undefined;
    setDraftDef(current => ({
      ...current,
      sc_template_id: templateId,
      field_mappings: {
        ...DEFAULT_SC_FIELD_MAPPINGS,
        ...global,
      },
    }));
  };

  const handleFieldMappingSave = async (result: SafetyCultureFieldMappingResult) => {
    const tid = draftDef.sc_template_id;
    if (!tid) return;

    setDraftDef(current => ({
      ...current,
      field_mappings: { ...DEFAULT_SC_FIELD_MAPPINGS, ...result.field_mappings },
    }));

    await supabase.from('sc_template_mappings').upsert({
      template_id: tid,
      template_name: selectedTemplateName || null,
      field_mappings: result.field_mappings,
      table_column_mappings: result.table_column_mappings,
    }, { onConflict: 'template_id' });

    const { data: updated } = await supabase
      .from('sc_template_mappings')
      .select('*')
      .eq('template_id', tid)
      .maybeSingle();
    if (updated) {
      setSavedMappings(prev => ({ ...prev, [tid]: updated }));
    }
  };

  const mappedFieldCount = (def: HandoverDocumentDefinition) => {
    const global = def.sc_template_id ? savedMappings[def.sc_template_id]?.field_mappings : undefined;
    const merged = { ...global, ...def.field_mappings };
    return Object.values(merged).filter(Boolean).length;
  };

  const copyMigrationSql = async () => {
    try {
      await navigator.clipboard.writeText(migration024Sql);
      setMigrationCopied(true);
      window.setTimeout(() => setMigrationCopied(false), 2500);
    } catch {
      setError('Could not copy SQL — open supabase/migrations/20260626150000_024_handover_document_config.sql manually.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-48">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <h2 className="font-semibold text-slate-900">Handover document template sets</h2>
        <p className="text-sm text-slate-500 mt-1">
          Configure which document cards appear for each system document type. Link SafetyCulture templates to each
          document and configure field linking here. Connect the API on{' '}
          <Link to="/integrations" className="text-cyan-600 hover:underline">Integrations</Link>.
        </p>
        {!scConnected && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            SafetyCulture is not connected — template lists and field linking require an API token on Integrations.
          </p>
        )}
        {localConfigOnly && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 mt-3 space-y-2">
            <p className="font-semibold">Handover config is saved in this browser only</p>
            <p>
              Run migration <code className="font-mono text-[11px]">024_handover_document_config</code> in Supabase
              so template links are shared for all users. After you run it, refresh this page — any config saved here
              will upload automatically.
            </p>
            <ol className="list-decimal list-inside space-y-1 text-amber-900/90">
              <li>Open <strong>Supabase Dashboard → SQL Editor → New query</strong></li>
              <li>Click <strong>Copy migration SQL</strong> below and paste into the editor</li>
              <li>Click <strong>Run</strong>, then hard-refresh OANDM</li>
            </ol>
            <button
              type="button"
              onClick={() => void copyMigrationSql()}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 transition-colors"
            >
              {migrationCopied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
              {migrationCopied ? 'Copied — paste in Supabase SQL Editor' : 'Copy migration SQL'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-2 py-1">Document types</p>
          {types.map(type => (
            <button
              key={type.key}
              type="button"
              onClick={() => setSelectedTypeKey(type.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedTypeKey === type.key ? 'bg-cyan-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span>{type.label}</span>
                {!type.is_active && <span className="text-[10px] opacity-70">off</span>}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-slate-900">
                {types.find(type => type.key === selectedTypeKey)?.label ?? selectedTypeKey}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">{typeDefinitions.length} document{typeDefinitions.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              type="button"
              onClick={beginNewDefinition}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700"
            >
              <Plus className="w-4 h-4" />Add document
            </button>
          </div>

          <div className="space-y-3">
            {typeDefinitions.map(def => (
              <div key={def.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${def.is_active ? 'border-slate-200' : 'border-slate-100 opacity-70'}`}>
                <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{def.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{def.description}</p>
                    <p className="text-[11px] text-slate-400 font-mono mt-1">{def.document_id}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {def.required && <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Required</span>}
                    {def.sc_enabled && <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-full">SC</span>}
                    {def.upload_only && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">Upload</span>}
                    <button type="button" onClick={() => beginEditDefinition(def)} className="text-xs text-cyan-700 hover:underline">Edit</button>
                    <button type="button" onClick={() => void removeDefinition(def)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="px-4 py-2 text-xs text-slate-500 flex flex-wrap gap-3">
                  <span>Order: {def.display_order}</span>
                  {def.sc_template_id && (
                    <span>
                      Template: {savedMappings[def.sc_template_id]?.template_name ?? def.sc_template_id}
                    </span>
                  )}
                  {def.sc_enabled && def.sc_template_id && (
                    <span className={mappedFieldCount(def) > 0 ? 'text-emerald-600' : 'text-amber-600'}>
                      {mappedFieldCount(def) > 0
                        ? `${mappedFieldCount(def)} field${mappedFieldCount(def) !== 1 ? 's' : ''} linked`
                        : 'No field linking'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingDefId != null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                {editingDefId === 'new' ? 'Add handover document' : 'Edit handover document'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-1 block">Document ID</label>
                  <input
                    value={draftDef.document_id ?? ''}
                    onChange={e => setDraftDef(current => ({ ...current, document_id: e.target.value }))}
                    disabled={editingDefId !== 'new'}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-1 block">Display order</label>
                  <input
                    type="number"
                    value={draftDef.display_order ?? 0}
                    onChange={e => setDraftDef(current => ({ ...current, display_order: Number(e.target.value) }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">Title</label>
                <input
                  value={draftDef.title ?? ''}
                  onChange={e => setDraftDef(current => ({ ...current, title: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">Description</label>
                <input
                  value={draftDef.description ?? ''}
                  onChange={e => setDraftDef(current => ({ ...current, description: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draftDef.sc_enabled ?? false} onChange={e => setDraftDef(current => ({ ...current, sc_enabled: e.target.checked }))} />
                  SafetyCulture enabled
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draftDef.upload_only ?? false} onChange={e => setDraftDef(current => ({ ...current, upload_only: e.target.checked, sc_enabled: e.target.checked ? false : current.sc_enabled }))} />
                  Upload only
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draftDef.required ?? false} onChange={e => setDraftDef(current => ({ ...current, required: e.target.checked }))} />
                  Required
                </label>
              </div>
                  {draftDef.sc_enabled && (
                <div className="space-y-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-slate-600">
                    <p>
                      <strong>Inspection name</strong> is set automatically as{' '}
                      <span className="font-mono text-slate-700">Project name - Document title</span> when you click
                      Create from SafetyCulture. Use <strong>Configure field linking</strong> to map project/site fields;
                      Audit Title is at the top of that list (optional for custom templates).
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">SafetyCulture template</label>
                    <select
                      value={draftDef.sc_template_id ?? ''}
                      onChange={e => applyTemplateSelection(e.target.value || null)}
                      disabled={!scConnected}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">Choose template…</option>
                      {templates.map(t => {
                        const tid = t.template_id ?? t.id;
                        return <option key={tid} value={tid}>{t.name}</option>;
                      })}
                    </select>
                  </div>
                  {draftDef.sc_template_id && scConnected && (
                    <button
                      type="button"
                      onClick={() => setFieldMappingOpen(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-cyan-200 text-cyan-700 bg-cyan-50 hover:bg-cyan-100 transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Configure field linking
                      {Object.values(draftDef.field_mappings ?? {}).filter(Boolean).length > 0 && (
                        <span className="text-emerald-600">
                          ({Object.values(draftDef.field_mappings ?? {}).filter(Boolean).length} linked)
                        </span>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button type="button" onClick={() => { setEditingDefId(null); setDraftDef({}); }} className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={() => void saveDefinition()} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {fieldMappingOpen && draftDef.sc_template_id && (
        <SafetyCultureFieldMappingModal
          templateId={draftDef.sc_template_id}
          templateName={selectedTemplateName}
          initialFieldMappings={{
            ...DEFAULT_SC_FIELD_MAPPINGS,
            ...savedMappings[draftDef.sc_template_id]?.field_mappings,
            ...draftDef.field_mappings,
          }}
          initialTableMappings={savedMappings[draftDef.sc_template_id]?.table_column_mappings ?? {}}
          onSave={handleFieldMappingSave}
          onClose={() => setFieldMappingOpen(false)}
        />
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-500">
        Toggle document types off to hide them from the system document type dropdown on the Documents tab.
        <div className="flex flex-wrap gap-2 mt-2">
          {types.map(type => (
            <button
              key={type.key}
              type="button"
              onClick={() => void toggleTypeActive(type)}
              className={`px-2 py-1 rounded-md border text-xs ${type.is_active ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-500 bg-white'}`}
            >
              {type.is_active ? <Check className="w-3 h-3 inline mr-1" /> : null}
              {type.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
