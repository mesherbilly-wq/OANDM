import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCopy, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

import migration024Sql from '../../supabase/migrations/20260626150000_024_handover_document_config.sql?raw';
import migration025Sql from '../../supabase/migrations/20260915120000_025_handover_web_forms.sql?raw';
import migration026Sql from '../../supabase/migrations/20260916120000_026_intruder_master_form.sql?raw';

import {
  DEFAULT_SC_FIELD_MAPPINGS,
  fetchHandoverDocumentDefinitions,
  fetchHandoverDocumentTypes,
  upsertHandoverDocumentDefinition,
  upsertHandoverDocumentType,
  deleteHandoverDocumentDefinition,
  isHandoverConfigLocalOnly,
  uniqueHandoverDocumentId,
  type HandoverDocumentDefinition,
  type HandoverDocumentType,
} from '../lib/handoverDocumentConfig';
import {
  HANDOVER_FORM_TEMPLATE_LIST,
  formTemplateKeyForDefinition,
  inferFormTemplateKey,
} from '../lib/handoverFormTemplates';

export default function HandoverConfigPage() {
  const [types, setTypes] = useState<HandoverDocumentType[]>([]);
  const [definitions, setDefinitions] = useState<HandoverDocumentDefinition[]>([]);
  const [selectedTypeKey, setSelectedTypeKey] = useState<string>('cctv');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingDefId, setEditingDefId] = useState<number | 'new' | null>(null);
  const [documentIdTouched, setDocumentIdTouched] = useState(false);
  const [localConfigOnly, setLocalConfigOnly] = useState(false);
  const [formsMigrationNeeded, setFormsMigrationNeeded] = useState(false);
  const [migrationCopied, setMigrationCopied] = useState(false);

  const [draftDef, setDraftDef] = useState<Partial<HandoverDocumentDefinition>>({});

  const pendingMigrationSql = localConfigOnly
    ? `${migration024Sql}\n\n${migration025Sql}\n\n${migration026Sql}`
    : `${migration025Sql}\n\n${migration026Sql}`;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [typeRows, defRows] = await Promise.all([
      fetchHandoverDocumentTypes(),
      fetchHandoverDocumentDefinitions(),
    ]);

    setTypes(typeRows.filter(type => type.key !== 'project_wide'));
    setDefinitions(defRows);

    const { error: formsTableError } = await supabase.from('handover_form_invites').select('id').limit(1);
    setFormsMigrationNeeded(Boolean(formsTableError && /does not exist|schema cache/i.test(formsTableError.message)));

    if (!silent) setLoading(false);
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
    setError(null);
    setEditingDefId('new');
    setDocumentIdTouched(false);
    setDraftDef({
      document_id: uniqueHandoverDocumentId(selectedTypeKey, 'document', definitions.map(def => def.document_id)),
      type_key: selectedTypeKey,
      title: '',
      description: '',
      icon_key: 'file',
      sc_enabled: true,
      sc_template_id: inferFormTemplateKey(''),
      field_mappings: { ...DEFAULT_SC_FIELD_MAPPINGS },
      required: false,
      upload_only: false,
      multi: false,
      display_order: (typeDefinitions[typeDefinitions.length - 1]?.display_order ?? 0) + 10,
      is_active: true,
    });
  };

  const beginEditDefinition = (def: HandoverDocumentDefinition) => {
    setError(null);
    setEditingDefId(def.id);
    setDocumentIdTouched(true);
    setDraftDef({
      ...def,
      type_key: selectedTypeKey,
      field_mappings: { ...DEFAULT_SC_FIELD_MAPPINGS, ...def.field_mappings },
      sc_template_id: formTemplateKeyForDefinition(def),
    });
  };

  const saveDefinition = async () => {
    const title = draftDef.title?.trim() ?? '';
    if (!title) {
      setError('Enter a title before saving this document.');
      return;
    }

    const existingIds = definitions
      .filter(def => editingDefId === 'new' || def.id !== editingDefId)
      .map(def => def.document_id);
    let documentId = draftDef.document_id?.trim() || uniqueHandoverDocumentId(selectedTypeKey, title, existingIds);

    setSaving(true);
    setError(null);

    const payload = {
      id: editingDefId === 'new' ? undefined : (editingDefId as number),
      document_id: documentId,
      type_key: selectedTypeKey,
      title,
      description: draftDef.description ?? null,
      icon_key: draftDef.icon_key ?? 'file',
      sc_enabled: draftDef.sc_enabled ?? false,
      sc_template_id: draftDef.sc_enabled ? (draftDef.sc_template_id ?? inferFormTemplateKey(title)) : null,
      field_mappings: draftDef.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
      required: draftDef.required ?? false,
      upload_only: draftDef.upload_only ?? false,
      multi: draftDef.multi ?? false,
      display_order: draftDef.display_order ?? 0,
      is_active: draftDef.is_active ?? true,
    };

    let saveError = await upsertHandoverDocumentDefinition(payload);
    if (saveError && editingDefId === 'new' && /already exists/i.test(saveError)) {
      documentId = uniqueHandoverDocumentId(selectedTypeKey, title, [...existingIds, documentId]);
      saveError = await upsertHandoverDocumentDefinition({ ...payload, document_id: documentId });
    }

    setSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }

    setDefinitions(current => {
      const next = [...current];
      const matchIndex = next.findIndex(def =>
        editingDefId !== 'new' ? def.id === editingDefId : def.document_id === documentId,
      );
      const row: HandoverDocumentDefinition = {
        id: editingDefId === 'new' ? Date.now() : (editingDefId as number),
        document_id: documentId,
        type_key: selectedTypeKey,
        title,
        description: payload.description,
        icon_key: payload.icon_key,
        sc_enabled: payload.sc_enabled,
        sc_template_id: payload.sc_template_id,
        field_mappings: payload.field_mappings,
        required: payload.required,
        upload_only: payload.upload_only,
        multi: payload.multi,
        display_order: payload.display_order,
        is_active: payload.is_active,
      };
      if (matchIndex >= 0) next[matchIndex] = { ...next[matchIndex], ...row };
      else next.push(row);
      return next;
    });

    setEditingDefId(null);
    setDraftDef({});
    await load(true);
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

  const copyMigrationSql = async () => {
    try {
      await navigator.clipboard.writeText(pendingMigrationSql);
      setMigrationCopied(true);
      window.setTimeout(() => setMigrationCopied(false), 2500);
    } catch {
      setError('Clipboard is blocked. Select the SQL in the box below, copy it, then paste it in Supabase.');
    }
  };

  const downloadMigrationSql = () => {
    const blob = new Blob([pendingMigrationSql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = localConfigOnly ? 'handover-024-025-026.sql' : 'handover-025-026.sql';
    link.click();
    URL.revokeObjectURL(url);
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
          Configure which document cards appear for each system document type. Link a browser form to each
          certificate or record so it can be emailed, filled online, signed, and saved into Documents.
        </p>
        {(localConfigOnly || formsMigrationNeeded) && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 mt-3 space-y-2">
            <p className="font-semibold">
              {localConfigOnly
                ? 'Handover config is saved in this browser only'
                : 'Browser forms are not enabled in the database yet'}
            </p>
            <p>
              {localConfigOnly
                ? 'Run migrations 024, 025 and 026 in Supabase so template links, emailed forms and as-fitted quote lines are shared for all users.'
                : '024 is already in place. Run 025_handover_web_forms and 026_intruder_master_form in the SQL Editor, then refresh this page.'}
            </p>
            <ol className="list-decimal list-inside space-y-1 text-amber-900/90">
              <li>Open <strong>Supabase Dashboard → SQL Editor → New query</strong></li>
              <li>Copy or download the SQL below and paste it into the editor</li>
              <li>Click <strong>Run</strong>, then hard-refresh OANDM</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyMigrationSql()}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 transition-colors"
              >
                {migrationCopied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                {migrationCopied ? 'Copied — paste in Supabase SQL Editor' : (localConfigOnly ? 'Copy 024–026 SQL' : 'Copy 025 + 026 SQL')}
              </button>
              <button
                type="button"
                onClick={downloadMigrationSql}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 transition-colors"
              >
                Download SQL file
              </button>
            </div>
            <textarea
              readOnly
              value={pendingMigrationSql}
              className="w-full h-40 font-mono text-[10px] bg-white border border-amber-200 rounded-lg p-2 text-slate-700"
            />
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
              onClick={() => {
                setSelectedTypeKey(type.key);
                setEditingDefId(null);
                setDraftDef({});
                setError(null);
              }}
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
            {typeDefinitions.length === 0 && (
              <p className="text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl px-4 py-8 text-center">
                No documents in this type yet. Add a certificate, training record or upload.
              </p>
            )}
            {typeDefinitions.map(def => (
              <div key={def.document_id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${def.is_active ? 'border-slate-200' : 'border-slate-100 opacity-70'}`}>
                <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{def.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{def.description}</p>
                    <p className="text-[11px] text-slate-400 font-mono mt-1">{def.document_id}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {def.required && <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Required</span>}
                    {def.sc_enabled && <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-full">Web form</span>}
                    {def.upload_only && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">Upload</span>}
                    <button type="button" onClick={() => beginEditDefinition(def)} className="text-xs text-cyan-700 hover:underline">Edit</button>
                    <button type="button" onClick={() => void removeDefinition(def)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="px-4 py-2 text-xs text-slate-500 flex flex-wrap gap-3">
                  <span>Order: {def.display_order}</span>
                  {def.sc_enabled && (
                    <span>
                      Form: {HANDOVER_FORM_TEMPLATE_LIST.find(t => t.key === formTemplateKeyForDefinition(def))?.name ?? 'Browser form'}
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
                    onChange={e => {
                      setDocumentIdTouched(true);
                      setDraftDef(current => ({ ...current, document_id: e.target.value }));
                    }}
                    disabled={editingDefId !== 'new'}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono disabled:bg-slate-50"
                  />
                  {editingDefId === 'new' && (
                    <p className="text-[11px] text-slate-500 mt-1">Generated from the title. Change it only if you need a specific ID.</p>
                  )}
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
                  onChange={e => {
                    const title = e.target.value;
                    setDraftDef(current => ({
                      ...current,
                      title,
                      document_id: editingDefId === 'new' && !documentIdTouched
                        ? uniqueHandoverDocumentId(selectedTypeKey, title || 'document', definitions.map(def => def.document_id))
                        : current.document_id,
                    }));
                  }}
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
                  <input
                    type="checkbox"
                    checked={draftDef.sc_enabled ?? false}
                    onChange={e => setDraftDef(current => ({
                      ...current,
                      sc_enabled: e.target.checked,
                      sc_template_id: e.target.checked
                        ? (current.sc_template_id || inferFormTemplateKey(current.title ?? ''))
                        : current.sc_template_id,
                    }))}
                  />
                  Web form
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
                      Email this form from the Documents tab. The recipient fills it in the browser, signs it,
                      and the signed PDF is saved against this document type automatically.
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">Form template</label>
                    <select
                      value={draftDef.sc_template_id ?? inferFormTemplateKey(draftDef.title ?? '')}
                      onChange={e => setDraftDef(current => ({ ...current, sc_template_id: e.target.value || null }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                    >
                      {HANDOVER_FORM_TEMPLATE_LIST.map(template => (
                        <option key={template.key} value={template.key}>{template.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">
                      {HANDOVER_FORM_TEMPLATE_LIST.find(t => t.key === (draftDef.sc_template_id ?? inferFormTemplateKey(draftDef.title ?? '')))?.description}
                    </p>
                  </div>
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
