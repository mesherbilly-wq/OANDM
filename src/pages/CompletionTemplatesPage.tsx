import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
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
  assignProjectCompletionDocument,
  createCompletionDocument,
  deleteCompletionTemplate,
  listCompletionDocuments,
  listProjectCompletionAssignments,
  listTemplateVersions,
  loadLatestTemplate,
  publishDraftTemplate,
  saveDraftTemplate,
  unassignProjectCompletionDocument,
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
  const [assignedKeys, setAssignedKeys] = useState<string[]>([]);
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
        const [docs, assigned] = await Promise.all([
          listCompletionDocuments(systemType),
          listProjectCompletionAssignments(pid, systemType),
        ]);
        if (cancelled) return;
        setDocuments(docs);
        setAssignedKeys(assigned);
        const nextKey = (assigned[0] && docs.some(doc => doc.template_key === assigned[0]) ? assigned[0] : null)
          ?? docs[0]?.template_key
          ?? '';
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

  const handleSelectDocument = (templateKey: string) => {
    setSelectedKey(templateKey);
  };

  const handleToggleAssigned = async (templateKey: string, assigned: boolean) => {
    setSavingType(true);
    setError(null);
    try {
      if (assigned) {
        await assignProjectCompletionDocument(pid, systemType, templateKey);
        setAssignedKeys(current => current.includes(templateKey) ? current : [...current, templateKey]);
        setNotice(`Added to ${systemType} on this project.`);
      } else {
        await unassignProjectCompletionDocument(pid, systemType, templateKey);
        setAssignedKeys(current => current.filter(key => key !== templateKey));
        setNotice(`Removed from ${systemType} on this project. The template itself is kept.`);
      }
      setSelectedKey(templateKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the documents for this system.');
    } finally {
      setSavingType(false);
    }
  };

  const handleDeleteTemplate = async (templateKey: string, title: string) => {
    if (!confirm(`Delete template "${title}"? Issued copies stay on Commissioning until you remove them. This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteCompletionTemplate(templateKey);
      const [docs, assigned] = await Promise.all([
        listCompletionDocuments(systemType),
        listProjectCompletionAssignments(pid, systemType),
      ]);
      setDocuments(docs);
      setAssignedKeys(assigned);
      const nextKey = selectedKey === templateKey ? (docs[0]?.template_key ?? '') : selectedKey;
      setSelectedKey(nextKey);
      if (!nextKey) {
        setSchema(null);
        setVersions([]);
        setSourceFileName(null);
      }
      setNotice('Template deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the template.');
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
      await handleToggleAssigned(created.key, true);
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
            Edit and AI-import web form layouts here. On Handover &amp; Commissioning → Config, pick Web form, SafetyCulture or Upload for each document. Branding follows Companies.
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

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Documents for {systemType}</p>
          <p className="text-xs text-slate-500 mt-1">
            Tick every form this system should use. Open a row to edit it. Commissioning can issue any ticked document.
          </p>
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-slate-500">No documents for {systemType} yet. Add one below.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {documents.map(doc => {
              const assigned = assignedKeys.includes(doc.template_key);
              const selected = selectedKey === doc.template_key;
              return (
                <li key={doc.template_key} className={`flex items-center gap-3 px-3 py-2.5 ${selected ? 'bg-slate-50' : 'bg-white'}`}>
                  <input
                    type="checkbox"
                    checked={assigned}
                    onChange={event => void handleToggleAssigned(doc.template_key, event.target.checked)}
                    className="h-4 w-4"
                    aria-label={`Assign ${doc.title} to ${systemType}`}
                  />
                  <button
                    type="button"
                    onClick={() => handleSelectDocument(doc.template_key)}
                    className="flex-1 text-left min-w-0"
                  >
                    <span className="block text-sm font-medium text-slate-900 truncate">{doc.title}</span>
                    <span className="block text-xs text-slate-500">
                      v{doc.latest_version} {doc.latest_status}
                      {assigned ? ' · assigned to this system' : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="min-h-10 min-w-10 inline-flex items-center justify-center text-red-600 hover:bg-red-50 rounded-lg"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => void handleDeleteTemplate(doc.template_key, doc.title)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
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
          {savingType && (
            <div className="flex items-center gap-2 text-xs text-slate-500 pb-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…
            </div>
          )}
        </div>
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
                await handleToggleAssigned(schema.key, true);
                setNotice('Published. New issues will use this version. Old issued forms keep theirs.');
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not publish.');
              }
            })();
          }}
          onDelete={() => void handleDeleteTemplate(schema.key, schema.title)}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-10 text-center text-sm text-slate-500">
          {error ?? `Add a document for ${systemType}, or upload an existing form after creating one.`}
        </div>
      )}
    </div>
  );
}
