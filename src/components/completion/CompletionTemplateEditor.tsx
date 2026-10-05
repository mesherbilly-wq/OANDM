import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { FormLetterhead } from '../FormLetterhead';
import { resolveOmBrand, type ContractorBrand } from '../../lib/contractorBrand';
import { CompletionFormRunner } from './CompletionFormRunner';
import { emptyAnswers } from '../../lib/completionFormEngine';
import type { CompletionField, CompletionSection, CompletionTemplateSchema } from '../../lib/completionFormTypes';

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'test_result', 'photo', 'note', 'declaration', 'signature'];

export function CompletionTemplateEditor({
  schema,
  onChange,
  versions,
  brand,
  sourceFileName,
  importing,
  onImportFile,
  onSaveDraft,
  onPublish,
  error,
  notice,
}: {
  schema: CompletionTemplateSchema;
  onChange: (schema: CompletionTemplateSchema) => void;
  versions: Array<{ id: number; version: number; status: string; title: string }>;
  brand: ContractorBrand | null;
  sourceFileName?: string | null;
  importing?: boolean;
  onImportFile: (file: File) => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  error: string | null;
  notice: string | null;
}) {
  const theme = resolveOmBrand(brand);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [sectionId, setSectionId] = useState(schema.sections[0]?.id ?? '');

  useEffect(() => {
    if (!schema.sections.some(item => item.id === sectionId)) {
      setSectionId(schema.sections[0]?.id ?? '');
    }
  }, [schema.sections, sectionId]);

  const section = schema.sections.find(item => item.id === sectionId) ?? schema.sections[0];

  const updateSection = (next: CompletionSection) => {
    onChange({
      ...schema,
      sections: schema.sections.map(item => item.id === next.id ? next : item),
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <FormLetterhead
        brand={brand}
        title={schema.title || 'Completion template'}
        subtitle="Template editor — headers, footer colour and logo follow Companies"
      />
      <div className="p-5 space-y-4">
        <p className="text-sm text-slate-500">
          Upload an existing PDF, Word file or picture onto this document. AI reads the questions and builds the template.
          Publishing creates a new version. Forms already issued keep the version they were created with.
        </p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {notice && <p className="text-sm text-emerald-800">{notice}</p>}
        <p className="text-xs text-slate-500">
          Versions: {versions.length === 0 ? 'none in the database yet.' : versions.map(item => `v${item.version} ${item.status}`).join(' · ')}
          {sourceFileName ? ` · Source: ${sourceFileName}` : ''}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm min-w-[16rem] flex-1">Document title
            <input
              value={schema.title}
              onChange={event => onChange({ ...schema, title: event.target.value })}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,image/*"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onImportFile(file);
            }}
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 min-h-11 px-4 rounded-lg text-white text-sm font-medium disabled:opacity-50"
            style={{ background: theme.primary }}
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? 'Reading form…' : 'AI upload existing form'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {schema.sections.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSectionId(item.id)}
              className={`px-3 py-2 rounded-lg text-sm ${item.id === section?.id ? 'text-white' : 'border border-slate-200'}`}
              style={item.id === section?.id ? { background: theme.primary } : undefined}
            >
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
              style={{ color: theme.primary }}
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
          <button type="button" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" onClick={onSaveDraft}>Save draft</button>
          <button type="button" className="px-3 py-2 text-white rounded-lg text-sm" style={{ background: theme.primary }} onClick={onPublish}>Publish new version</button>
        </div>
      </div>
      <footer className="border-t px-6 py-3 flex items-center justify-between" style={{ borderColor: theme.primary }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: theme.primary }}>{theme.name}</p>
        <p className="text-[10px]" style={{ color: theme.ink }}>{theme.tagline}</p>
      </footer>
      {preview && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
          <button type="button" className="m-4 text-sm font-medium" onClick={() => setPreview(false)}>Close preview</button>
          <CompletionFormRunner
            demo
            brand={brand}
            form={{
              token: 'demo-template',
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
                projectName: 'Demonstration handover',
                clientName: 'Demonstration client',
                siteName: 'Demonstration site',
                siteAddress: '1 Example Street',
                projectManager: 'Alex Manager',
                engineer: 'Sam Engineer',
              },
              companyName: theme.name,
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
