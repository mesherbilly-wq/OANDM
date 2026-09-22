import { useEffect, useState } from 'react';
import { PACIFIC_RED } from '../FormLetterhead';
import { defaultTemplateSchema } from '../../lib/completionFormsApi';
import { listTemplateVersions, publishDraftTemplate, saveDraftTemplate } from '../../lib/completionFormsApi';
import { CompletionFormRunner } from './CompletionFormRunner';
import { emptyAnswers } from '../../lib/completionFormEngine';
import type { CompletionField, CompletionSection, CompletionTemplateSchema } from '../../lib/completionFormTypes';

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'test_result', 'photo', 'note', 'declaration', 'signature'];

export function CompletionTemplateEditor() {
  const [schema, setSchema] = useState<CompletionTemplateSchema>(defaultTemplateSchema);
  const [versions, setVersions] = useState<Array<{ id: number; version: number; status: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [sectionId, setSectionId] = useState(schema.sections[0]?.id ?? '');

  useEffect(() => {
    void listTemplateVersions().then(setVersions).catch(err => setError(err instanceof Error ? err.message : 'Could not load templates.'));
  }, []);

  const section = schema.sections.find(item => item.id === sectionId) ?? schema.sections[0];

  const updateSection = (next: CompletionSection) => {
    setSchema(current => ({
      ...current,
      sections: current.sections.map(item => item.id === next.id ? next : item),
    }));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Template editor</h3>
        <p className="text-sm text-slate-500 mt-1">
          Edit a draft copy. Publishing creates a new version. Forms already issued keep the template version they were created with.
        </p>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm text-emerald-800">{notice}</p>}
      <p className="text-xs text-slate-500">
        Versions: {versions.length === 0 ? 'none in the database yet (v1 is built into the app).' : versions.map(item => `v${item.version} ${item.status}`).join(' · ')}
      </p>
      <div className="flex flex-wrap gap-2">
        {schema.sections.map(item => (
          <button key={item.id} type="button" onClick={() => setSectionId(item.id)} className={`px-3 py-2 rounded-lg text-sm ${item.id === section?.id ? 'text-white' : 'border border-slate-200'}`} style={item.id === section?.id ? { background: PACIFIC_RED } : undefined}>
            {item.title}
          </button>
        ))}
      </div>
      {section && (
        <div className="space-y-3">
          <label className="block text-sm">Section title
            <input value={section.title} onChange={event => updateSection({ ...section, title: event.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">Instructions
            <textarea value={section.summary} onChange={event => updateSection({ ...section, summary: event.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-20" />
          </label>
          {(section.fields ?? []).map((field, index) => (
            <div key={field.id} className="border border-slate-200 rounded-lg p-3 grid gap-2 sm:grid-cols-2">
              <input value={field.label} onChange={event => {
                const fields = [...(section.fields ?? [])];
                fields[index] = { ...field, label: event.target.value };
                updateSection({ ...section, fields });
              }} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              <select value={field.type} onChange={event => {
                const fields = [...(section.fields ?? [])];
                fields[index] = { ...field, type: event.target.value as CompletionField['type'] };
                updateSection({ ...section, fields });
              }} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
                {FIELD_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
          ))}
          <button
            type="button"
            className="text-sm font-medium"
            style={{ color: PACIFIC_RED }}
            onClick={() => updateSection({
              ...section,
              fields: [...(section.fields ?? []), { id: `field_${Date.now()}`, label: 'New question', type: 'text' }],
            })}
          >
            Add field
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" onClick={() => setPreview(true)}>Preview mobile form</button>
        <button type="button" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" onClick={async () => {
          try {
            await saveDraftTemplate(schema);
            setNotice('Draft template saved. Issued forms are unchanged.');
            setVersions(await listTemplateVersions());
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the draft.');
          }
        }}>Save draft</button>
        <button type="button" className="px-3 py-2 text-white rounded-lg text-sm" style={{ background: PACIFIC_RED }} onClick={async () => {
          try {
            await saveDraftTemplate(schema);
            await publishDraftTemplate();
            setNotice('Published. New issues will use this version. Old issued forms keep theirs.');
            setVersions(await listTemplateVersions());
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not publish.');
          }
        }}>Publish new version</button>
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
          <button type="button" className="m-4 text-sm font-medium" onClick={() => setPreview(false)}>Close preview</button>
          <CompletionFormRunner
            demo
            brand={{ company_name: 'Pacific' }}
            form={{
              token: 'demo-cctv',
              role: 'engineer',
              status: 'in_progress',
              title: schema.title,
              schema,
              answers: emptyAnswers(schema),
              photos: [],
              revisionNo: 1,
              revisionLocked: false,
              project: {
                jobNumber: 'DEMO-001',
                projectName: 'Demonstration CCTV handover',
                clientName: 'Demonstration client',
                siteName: 'Demonstration site',
                siteAddress: '1 Example Street',
                projectManager: 'Alex Manager',
                engineer: 'Sam Engineer',
              },
              companyName: 'Pacific',
              assignedName: 'Sam Engineer',
              expiresAt: null,
              reviewNote: 'Demonstration — not saved to a project.',
              outstandingHandoverAuthorised: false,
              offlineSupported: false,
              signatureNotice: 'Demonstration signature only.',
            }}
          />
        </div>
      )}
    </div>
  );
}
