import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import { getCategoryStyle, type ProjectSystem } from '../lib/systems';
import type { Device } from '../types';
import {
  PROJECT_WIDE_SYSTEM_KEY,
  PROJECT_WIDE_SYSTEM_LABEL,
  loadDocumentProjectSystems,
} from '../lib/documentProjectSystems';
import { fetchContractorForProject, resolveOmBrand, type ContractorBrand } from '../lib/contractorBrand';
import { COMPLETION_TEMPLATE_KEY } from '../lib/completionFormTypes';
import { defaultTemplateSchema } from '../lib/completionFormsApi';
import {
  createCompletionDocument,
  ensurePublishedTemplate,
  getProjectCompletionAssignment,
  listCompletionDocuments,
  listTemplateVersions,
  loadLatestTemplate,
  publishDraftTemplate,
  saveDraftTemplate,
  saveProjectCompletionAssignment,
} from '../lib/completionFormsApi';
import { applyExtractedTemplate, extractCompletionTemplateFromFile } from '../lib/extractFormTemplate';
import { CompletionTemplateEditor } from '../components/completion/CompletionTemplateEditor';
import type { CompletionTemplateSchema } from '../lib/completionFormTypes';

export default function CompletionTemplatesPage() {
  const { project } = useProject();
  const pid = project.id;
  const [brand, setBrand] = useState<ContractorBrand | null>(null);
  const [projectSystems, setProjectSystems] = useState<ProjectSystem[]>([]);
  const [activeSystemKey, setActiveSystemKey] = useState(PROJECT_WIDE_SYSTEM_KEY);
  const [documents, setDocuments] = useState<Array<{ template_key: string; title: string; latest_version: number; latest_status: string }>>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [schema, setSchema] = useState<CompletionTemplateSchema | null>(null);
  const [versions, setVersions] = useState<Array<{ id: number; version: number; status: string; title: string }>>([]);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [savingType, setSavingType] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const theme = resolveOmBrand(brand);
  const systemType = activeSystemKey === PROJECT_WIDE_SYSTEM_KEY ? PROJECT_WIDE_SYSTEM_LABEL : activeSystemKey;
  const tabs = useMemo(
    () => [{ key: PROJECT_WIDE_SYSTEM_KEY, name: PROJECT_WIDE_SYSTEM_LABEL, category: null as ProjectSystem['category'] }, ...projectSystems.map(system => ({ key: system.name, name: system.name, category: system.category }))],
    [projectSystems],
  );

  useEffect(() => {
    void fetchContractorForProject({ projectId: pid, contractorProfileId: project.contractor_profile_id })
      .then(setBrand)
      .catch(() => undefined);
  }, [pid, project.contractor_profile_id]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      supabase.from('devices').select('system_type, system_category, project_system_id').eq('project_id', pid),
    ]).then(async ([devicesRes]) => {
      const systems = await loadDocumentProjectSystems(pid, (devicesRes.data ?? []) as Device[]);
      if (cancelled) return;
      setProjectSystems(systems);
    });
    return () => {
      cancelled = true;
    };
  }, [pid]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      try {
        if (systemType === 'CCTV') {
          await ensurePublishedTemplate(COMPLETION_TEMPLATE_KEY).catch(() => undefined);
        }
        const docs = await listCompletionDocuments(systemType);
        if (cancelled) return;
        setDocuments(docs);
        const assigned = await getProjectCompletionAssignment(pid, systemType);
        const nextKey = assigned && docs.some(doc => doc.template_key === assigned)
          ? assigned
          : docs[0]?.template_key ?? '';
        setSelectedKey(nextKey);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load templates.');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [pid, systemType]);

  useEffect(() => {
    if (!selectedKey) {
      setSchema(null);
      setVersions([]);
      setSourceFileName(null);
      return;
    }
    let cancelled = false;
    void Promise.all([loadLatestTemplate(selectedKey), listTemplateVersions(selectedKey)]).then(([row, nextVersions]) => {
      if (cancelled) return;
      setVersions(nextVersions);
      setSourceFileName(row?.source_file_name ?? null);
      if (row?.schema) setSchema(row.schema);
      else if (selectedKey === COMPLETION_TEMPLATE_KEY) setSchema(defaultTemplateSchema());
    }).catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open that document.');
    });
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  const handleDocumentChange = async (templateKey: string) => {
    setSelectedKey(templateKey);
    if (!templateKey) return;
    setSavingType(true);
    try {
      await saveProjectCompletionAssignment(pid, systemType, templateKey);
      setNotice(`This ${systemType} system will use that document.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the document for this system.');
    } finally {
      setSavingType(false);
    }
  };

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) {
      setError('Enter a document name first.');
      return;
    }
    setError(null);
    try {
      const created = await createCompletionDocument({ systemType, title });
      setNewTitle('');
      const docs = await listCompletionDocuments(systemType);
      setDocuments(docs);
      await handleDocumentChange(created.key);
      setSchema(created);
      setNotice('New document created as a draft. Upload an existing form or add questions.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the document.');
    }
  };

  const handleImport = async (file: File) => {
    if (!schema) {
      setError('Create or select a document first, then upload the existing form onto it.');
      return;
    }
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const extracted = await extractCompletionTemplateFromFile({
        file,
        systemType,
        existingTitle: schema.title,
      });
      const next = applyExtractedTemplate(schema, extracted);
      setSchema(next);
      setSourceFileName(file.name);
      await saveDraftTemplate(next, { systemType, sourceFileName: file.name });
      setVersions(await listTemplateVersions(next.key));
      setNotice(`Template drafted from ${file.name}. Headers, footer and colours stay as set in Companies.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that form.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">Templates</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Pick a system, choose its completion document, then edit or AI-import the form. Branding follows Companies.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
        {tabs.map(tab => {
          const Icon = tab.key === PROJECT_WIDE_SYSTEM_KEY ? null : getCategoryStyle(tab.category).icon;
          const selected = activeSystemKey === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSystemKey(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selected ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              style={selected ? { background: theme.primary } : undefined}
            >
              {Icon ? <Icon className="w-3.5 h-3.5 flex-shrink-0" /> : null}
              {tab.name}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 flex flex-wrap items-end gap-4">
        <div className="min-w-[16rem] flex-1">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            System document
          </label>
          <select
            value={selectedKey}
            onChange={event => void handleDocumentChange(event.target.value)}
            className="w-full max-w-md text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 disabled:opacity-50"
            style={{ outlineColor: theme.primary }}
          >
            {documents.length === 0 && <option value="">No documents for {systemType} yet</option>}
            {documents.map(doc => (
              <option key={doc.template_key} value={doc.template_key}>
                {doc.title} (v{doc.latest_version} {doc.latest_status})
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1.5">
            {activeSystemKey === PROJECT_WIDE_SYSTEM_KEY
              ? 'Project-wide completion document for this job.'
              : `Document used when issuing a completion form for ${systemType}. Saved per system.`}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="block text-sm">
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">New document</span>
            <input
              value={newTitle}
              onChange={event => setNewTitle(event.target.value)}
              placeholder={`${systemType} completion`}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2.5 min-w-[12rem]"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-white text-sm font-medium"
            style={{ background: theme.primary }}
          >
            <Plus className="w-4 h-4" />Add
          </button>
        </div>
        {savingType && (
          <div className="flex items-center gap-2 text-xs text-slate-500 pb-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…
          </div>
        )}
      </div>

      {schema ? (
        <CompletionTemplateEditor
          schema={schema}
          onChange={setSchema}
          versions={versions}
          brand={brand}
          sourceFileName={sourceFileName}
          importing={importing}
          onImportFile={file => void handleImport(file)}
          error={error}
          notice={notice}
          onSaveDraft={() => {
            void (async () => {
              try {
                await saveDraftTemplate(schema, { systemType, sourceFileName });
                setVersions(await listTemplateVersions(schema.key));
                setNotice('Draft template saved. Issued forms are unchanged.');
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not save the draft.');
              }
            })();
          }}
          onPublish={() => {
            void (async () => {
              try {
                await saveDraftTemplate(schema, { systemType, sourceFileName });
                await publishDraftTemplate(schema.key);
                setVersions(await listTemplateVersions(schema.key));
                await handleDocumentChange(schema.key);
                setNotice('Published. New issues will use this version. Old issued forms keep theirs.');
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not publish.');
              }
            })();
          }}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-500">
          {error ?? `Add a document for ${systemType}, or upload an existing form after creating one.`}
        </div>
      )}
    </div>
  );
}
