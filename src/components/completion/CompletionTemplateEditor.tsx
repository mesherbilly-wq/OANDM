import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { FormLetterhead } from '../FormLetterhead';
import { resolveOmBrand, type ContractorBrand } from '../../lib/contractorBrand';
import { CompletionFormRunner } from './CompletionFormRunner';
import { emptyAnswers } from '../../lib/completionFormEngine';
import type {
  CompletionField,
  CompletionFieldType,
  CompletionGroup,
  CompletionSection,
  CompletionTemplateSchema,
} from '../../lib/completionFormTypes';

const FIELD_TYPES: CompletionFieldType[] = [
  'text', 'textarea', 'number', 'date', 'tel', 'email', 'select', 'multiselect',
  'test_result', 'photo', 'note', 'declaration', 'signature',
];

function newField(label = 'New question'): CompletionField {
  return { id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, label, type: 'text' };
}

function newGroup(): CompletionGroup {
  return {
    id: `group_${Date.now()}`,
    title: 'Repeatable items',
    addLabel: 'Add item',
    nameTemplate: 'Item {location}',
    identityFields: [],
    fields: [newField('Item name')],
  };
}

function FieldEditor({
  field,
  onChange,
  onRemove,
}: {
  field: CompletionField;
  onChange: (field: CompletionField) => void;
  onRemove: () => void;
}) {
  const needsOptions = field.type === 'select' || field.type === 'multiselect';
  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">Label
          <input value={field.label} onChange={event => onChange({ ...field, label: event.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600">Type
          <select value={field.type} onChange={event => onChange({ ...field, type: event.target.value as CompletionFieldType })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {FIELD_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Help text
          <input value={field.help ?? ''} onChange={event => onChange({ ...field, help: event.target.value || undefined })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-600">Unit
          <input value={field.unit ?? ''} onChange={event => onChange({ ...field, unit: event.target.value || undefined })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="fps, Mpx, V" />
        </label>
        {needsOptions && (
          <label className="text-xs text-slate-600 sm:col-span-2">Choices (comma separated)
            <input
              value={(field.options ?? []).join(', ')}
              onChange={event => onChange({
                ...field,
                options: event.target.value.split(',').map(item => item.trim()).filter(Boolean),
              })}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={Boolean(field.required)} onChange={event => onChange({ ...field, required: event.target.checked })} />
          Required
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={Boolean(field.customerVisible)} onChange={event => onChange({ ...field, customerVisible: event.target.checked })} />
          Customer can see
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={Boolean(field.sensitive)} onChange={event => onChange({ ...field, sensitive: event.target.checked })} />
          Hide from PDF
        </label>
        <button type="button" onClick={onRemove} className="ml-auto text-xs text-red-700 inline-flex items-center gap-1">
          <Trash2 className="w-3.5 h-3.5" />Remove field
        </button>
      </div>
      {(field.showWhen?.length ?? 0) > 0 && (
        <p className="text-[11px] text-slate-500">
          Shown when {(field.showWhen ?? []).map(rule => `${rule.field} ${rule.op} ${rule.values.join(' / ')}`).join(' and ')}
        </p>
      )}
    </div>
  );
}

function GroupEditor({
  group,
  onChange,
  onRemove,
}: {
  group: CompletionGroup;
  onChange: (group: CompletionGroup) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-slate-300 rounded-xl p-4 space-y-3 bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">
          Repeatable group
          <span className="ml-2 font-normal text-slate-500">
            {group.fields.length} field{group.fields.length === 1 ? '' : 's'}
          </span>
        </p>
        <button type="button" onClick={onRemove} className="text-xs text-red-700 inline-flex items-center gap-1">
          <Trash2 className="w-3.5 h-3.5" />Remove group
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-600">Group title
          <input value={group.title} onChange={event => onChange({ ...group, title: event.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" />
        </label>
        <label className="text-xs text-slate-600">Add button label
          <input value={group.addLabel} onChange={event => onChange({ ...group, addLabel: event.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" placeholder="Add camera" />
        </label>
        <label className="text-xs text-slate-600 sm:col-span-2">Row title template
          <input value={group.nameTemplate} onChange={event => onChange({ ...group, nameTemplate: event.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" placeholder="Camera {camera_number} — {location}" />
        </label>
      </div>
      {(group.showWhen?.length ?? 0) > 0 && (
        <p className="text-[11px] text-slate-500">
          Shown when {(group.showWhen ?? []).map(rule => `${rule.field} ${rule.op} ${rule.values.join(' / ')}`).join(' and ')}
        </p>
      )}
      <p className="text-xs font-medium text-slate-600">Fields in each item</p>
      <div className="space-y-2">
        {group.fields.map((field, index) => (
          <FieldEditor
            key={field.id}
            field={field}
            onChange={next => {
              const fields = [...group.fields];
              fields[index] = next;
              onChange({ ...group, fields });
            }}
            onRemove={() => onChange({ ...group, fields: group.fields.filter((_, i) => i !== index) })}
          />
        ))}
      </div>
      <button
        type="button"
        className="text-sm font-medium inline-flex items-center gap-1"
        onClick={() => onChange({ ...group, fields: [...group.fields, newField()] })}
      >
        <Plus className="w-4 h-4" />Add field to this group
      </button>
      {(group.nested ?? []).map((nested, index) => (
        <GroupEditor
          key={nested.id}
          group={nested}
          onChange={next => {
            const nestedGroups = [...(group.nested ?? [])];
            nestedGroups[index] = next;
            onChange({ ...group, nested: nestedGroups });
          }}
          onRemove={() => onChange({ ...group, nested: (group.nested ?? []).filter((_, i) => i !== index) })}
        />
      ))}
      <button
        type="button"
        className="text-sm font-medium inline-flex items-center gap-1"
        onClick={() => onChange({ ...group, nested: [...(group.nested ?? []), newGroup()] })}
      >
        <Plus className="w-4 h-4" />Add nested group
      </button>
    </div>
  );
}

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
  onDelete,
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
  onDelete?: () => void;
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
              {(item.groups?.length ?? 0) > 0 ? ` (${item.groups?.length} group${item.groups?.length === 1 ? '' : 's'})` : ''}
            </button>
          ))}
          <button
            type="button"
            className="px-3 py-2 rounded-lg text-sm border border-dashed border-slate-300 text-slate-600 inline-flex items-center gap-1"
            onClick={() => {
              const id = `section_${Date.now()}`;
              onChange({
                ...schema,
                sections: [...schema.sections, { id, title: 'New section', summary: '', fields: [] }],
              });
              setSectionId(id);
            }}
          >
            <Plus className="w-3.5 h-3.5" />Add section
          </button>
        </div>
        {section && (
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <label className="block text-sm flex-1">Section title
                <input value={section.title} onChange={event => updateSection({ ...section, title: event.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </label>
              {schema.sections.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-red-700 inline-flex items-center gap-1 pb-2"
                  onClick={() => {
                    const next = schema.sections.filter(item => item.id !== section.id);
                    onChange({ ...schema, sections: next });
                    setSectionId(next[0]?.id ?? '');
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />Remove section
                </button>
              )}
            </div>
            <label className="block text-sm">Instructions
              <textarea value={section.summary} onChange={event => updateSection({ ...section, summary: event.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-20" />
            </label>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-800">Questions</p>
              {(section.fields ?? []).map((field, index) => (
                <FieldEditor
                  key={field.id}
                  field={field}
                  onChange={next => {
                    const fields = [...(section.fields ?? [])];
                    fields[index] = next;
                    updateSection({ ...section, fields });
                  }}
                  onRemove={() => updateSection({ ...section, fields: (section.fields ?? []).filter((_, i) => i !== index) })}
                />
              ))}
              <button
                type="button"
                className="text-sm font-medium inline-flex items-center gap-1"
                style={{ color: theme.primary }}
                onClick={() => updateSection({
                  ...section,
                  fields: [...(section.fields ?? []), newField()],
                })}
              >
                <Plus className="w-4 h-4" />Add field
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-800">Repeatable items</p>
              <p className="text-xs text-slate-500">
                Use these for cameras, recorders, power supplies and anything the engineer can add more than once. Each item can have fields such as IP address, model and location.
              </p>
              {(section.groups ?? []).map((group, index) => (
                <GroupEditor
                  key={group.id}
                  group={group}
                  onChange={next => {
                    const groups = [...(section.groups ?? [])];
                    groups[index] = next;
                    updateSection({ ...section, groups });
                  }}
                  onRemove={() => updateSection({ ...section, groups: (section.groups ?? []).filter((_, i) => i !== index) })}
                />
              ))}
              <button
                type="button"
                className="text-sm font-medium inline-flex items-center gap-1"
                style={{ color: theme.primary }}
                onClick={() => updateSection({
                  ...section,
                  groups: [...(section.groups ?? []), newGroup()],
                })}
              >
                <Plus className="w-4 h-4" />Add repeatable group
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" onClick={() => setPreview(true)}>Preview mobile form</button>
          <button type="button" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" onClick={onSaveDraft}>Save draft</button>
          <button type="button" className="px-3 py-2 text-white rounded-lg text-sm" style={{ background: theme.primary }} onClick={onPublish}>Publish new version</button>
          {onDelete && (
            <button type="button" className="px-3 py-2 border border-red-200 text-red-700 rounded-lg text-sm" onClick={onDelete}>Delete template</button>
          )}
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
