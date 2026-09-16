import { Plus, Trash2 } from 'lucide-react';
import { SignaturePad } from './SignaturePad';
import {
  CHECK_CODES,
  defaultFieldValue,
  emptyRow,
  humanizeOption,
  isSectionVisible,
  constrainWorkTypes,
  TEST_RESULT_OPTIONS,
  type FormAnswers,
  type FormRow,
  type SchemaCatalogue,
  type SchemaField,
  type SchemaSection,
} from '../lib/schemaForm';

const inputClass = 'w-full border-0 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRows(value: unknown): FormRow[] {
  return Array.isArray(value) ? value as FormRow[] : [];
}

function FieldLabel({ field }: { field: SchemaField }) {
  return (
    <span className="block bg-[#D9D9D9] border-b border-[#404040] px-3 py-1 text-[11px] font-semibold text-[#404040]">
      {field.label}
      {field.required ? <span className="text-[#C00000]"> *</span> : null}
    </span>
  );
}

function ListEditor({
  items,
  onChange,
  keys,
  addLabel,
}: {
  items: Record<string, string>[];
  onChange: (next: Record<string, string>[]) => void;
  keys: { key: string; label: string }[];
  addLabel: string;
}) {
  return (
    <div className="mt-1 space-y-2">
      {items.map((item, index) => (
        <div key={index} className="border border-[#404040] p-3 space-y-2 bg-white">
          {keys.map(entry => (
            <label key={entry.key} className="block border border-[#404040]">
              <span className="block bg-[#D9D9D9] border-b border-[#404040] px-3 py-1 text-[11px] font-semibold text-[#404040]">{entry.label}</span>
              <input
                value={item[entry.key] ?? ''}
                onChange={event => {
                  const next = items.map((current, currentIndex) =>
                    currentIndex === index ? { ...current, [entry.key]: event.target.value } : current,
                  );
                  onChange(next);
                }}
                className={inputClass}
              />
            </label>
          ))}
          <button type="button" onClick={() => onChange(items.filter((_, currentIndex) => currentIndex !== index))} className="text-xs text-red-600">
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, Object.fromEntries(keys.map(entry => [entry.key, '']))])}
        className="text-xs font-semibold uppercase tracking-wide text-[#C00000]"
      >
        {addLabel}
      </button>
    </div>
  );
}

function checkResultValue(value: unknown): { result: string; reference: string } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return { result: String(record.result ?? ''), reference: String(record.reference ?? '') };
  }
  return { result: String(value ?? ''), reference: '' };
}

function SchemaFieldControl({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (field.type === 'note') {
    return <p className="px-3 py-2 text-sm text-[#404040] leading-relaxed whitespace-pre-wrap">{field.label}</p>;
  }
  if (field.type === 'check_result') {
    const current = checkResultValue(value);
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <label className="border-r border-[#404040] max-sm:border-r-0 max-sm:border-b">
          <span className="block bg-[#D9D9D9] border-b border-[#404040] px-3 py-1 text-[11px] font-semibold text-[#404040]">Result</span>
          <select
            value={current.result}
            onChange={event => onChange({ ...current, result: event.target.value })}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {CHECK_CODES.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="block bg-[#D9D9D9] border-b border-[#404040] px-3 py-1 text-[11px] font-semibold text-[#404040]">Reference</span>
          <input
            value={current.reference}
            onChange={event => onChange({ ...current, reference: event.target.value })}
            className={inputClass}
          />
        </label>
      </div>
    );
  }
  if (field.type === 'textarea') {
    return <textarea value={String(value ?? '')} onChange={event => onChange(event.target.value)} rows={3} className={inputClass} />;
  }
  if (field.type === 'select' || field.type === 'test_result') {
    const options = field.type === 'test_result' ? [...TEST_RESULT_OPTIONS] : (field.options ?? []);
    return (
      <select value={String(value ?? '')} onChange={event => onChange(event.target.value)} className={inputClass}>
        <option value="">Choose…</option>
        {options.map(option => (
          <option key={option} value={option}>{humanizeOption(option)}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="mt-1 flex flex-wrap gap-2">
        {(field.options ?? []).map(option => {
          const checked = selected.includes(option);
          return (
            <label key={option} className={`text-xs px-2.5 py-1.5 border cursor-pointer ${checked ? 'bg-[#C00000] text-white border-[#C00000]' : 'bg-white text-[#404040] border-[#404040]'}`}>
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => onChange(checked ? selected.filter(item => item !== option) : [...selected, option])}
              />
              {humanizeOption(option)}
            </label>
          );
        })}
      </div>
    );
  }
  if (field.type === 'boolean' || field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-700 px-3 py-2">
        <input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />
        Yes
      </label>
    );
  }
  if (field.type === 'measurement') {
    const measurement = asRecord(value);
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#404040]">
        <input placeholder="Value" value={String(measurement.value ?? '')} onChange={event => onChange({ ...measurement, value: event.target.value })} className={inputClass} />
        <input placeholder="Unit" value={String(measurement.unit ?? '')} onChange={event => onChange({ ...measurement, unit: event.target.value })} className={inputClass} />
        <input placeholder="Conditions / instrument" value={String(measurement.conditions ?? '')} onChange={event => onChange({ ...measurement, conditions: event.target.value })} className={inputClass} />
      </div>
    );
  }
  if (field.type === 'signature') {
    const signature = asRecord(value);
    return (
      <div className="space-y-2 px-3 py-2">
        <input
          placeholder="Signer name"
          value={String(signature.signerName ?? '')}
          onChange={event => onChange({ ...signature, signerName: event.target.value, signedAt: new Date().toISOString() })}
          className={inputClass}
        />
        <SignaturePad
          value={String(signature.dataUrl ?? '')}
          onChange={dataUrl => onChange({ ...signature, dataUrl, signedAt: new Date().toISOString() })}
        />
      </div>
    );
  }
  if (field.type === 'document_reference_list' || field.type === 'document_manifest' || field.type === 'standards_register') {
    return (
      <ListEditor
        items={Array.isArray(value) ? value as Record<string, string>[] : []}
        onChange={onChange}
        addLabel="Add document reference"
        keys={[
          { key: 'id', label: 'ID' },
          { key: 'title', label: 'Title' },
          { key: 'revision', label: 'Revision / edition' },
          { key: 'date', label: 'Date' },
          { key: 'clause', label: 'Clause / notes' },
        ]}
      />
    );
  }
  if (field.type === 'signal_test_list') {
    return (
      <ListEditor
        items={Array.isArray(value) ? value as Record<string, string>[] : []}
        onChange={onChange}
        addLabel="Add signal test"
        keys={[
          { key: 'name', label: 'Signal' },
          { key: 'trigger', label: 'Trigger' },
          { key: 'expected', label: 'Expected result' },
          { key: 'sent', label: 'Sent time' },
          { key: 'received', label: 'Received time' },
          { key: 'acknowledgement', label: 'ARC acknowledgement' },
          { key: 'outcome', label: 'Outcome' },
        ]}
      />
    );
  }
  if (field.type === 'training_topic_list') {
    return (
      <ListEditor
        items={Array.isArray(value) ? value as Record<string, string>[] : []}
        onChange={onChange}
        addLabel="Add topic"
        keys={[
          { key: 'topic', label: 'Topic' },
          { key: 'applicability', label: 'Applicability' },
          { key: 'status', label: 'Demonstrated / explained / practised' },
          { key: 'notes', label: 'Notes' },
        ]}
      />
    );
  }
  if (field.type === 'issue_links' || field.type === 'asset_links' || field.type === 'test_links') {
    const items = Array.isArray(value) ? value.map(String) : [];
    return (
      <input
        value={items.join(', ')}
        onChange={event => onChange(event.target.value.split(',').map(item => item.trim()).filter(Boolean))}
        placeholder="IDs, comma separated"
        className={inputClass}
      />
    );
  }
  if (field.type === 'file') {
    return (
      <input
        value={String(value ?? '')}
        onChange={event => onChange(event.target.value)}
        placeholder="Attachment reference or filename"
        className={inputClass}
      />
    );
  }
  const inputType = field.type === 'integer' || field.type === 'decimal' ? 'number' : field.type === 'datetime' ? 'datetime-local' : field.type === 'date' ? 'date' : 'text';
  return (
    <input
      type={inputType}
      value={String(value ?? '')}
      onChange={event => onChange(event.target.value)}
      className={inputClass}
      step={field.type === 'decimal' ? 'any' : undefined}
    />
  );
}

function SectionFields({
  section,
  record,
  onChange,
}: {
  section: SchemaSection;
  record: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      {section.fields.map(field => {
        if (field.type === 'note') {
          return (
            <div key={field.id} className="border border-[#404040] bg-[#F7F7F7]">
              <SchemaFieldControl field={field} value="" onChange={() => undefined} />
            </div>
          );
        }
        return (
          <label key={field.id} className="block border border-[#404040]">
            <FieldLabel field={field} />
            <SchemaFieldControl
              field={field}
              value={record[field.id] ?? defaultFieldValue(field)}
              onChange={next => onChange({ ...record, [field.id]: next })}
            />
          </label>
        );
      })}
    </div>
  );
}

export function SchemaForm({
  schema,
  answers,
  onChange,
}: {
  schema: SchemaCatalogue;
  answers: FormAnswers;
  onChange: (next: FormAnswers) => void;
}) {
  const visible = schema.sections.filter(section => isSectionVisible(section, answers));

  return (
    <div className="space-y-4">
      {visible.map(section => {
        const heading = (
          <div className="flex items-center justify-between gap-2 bg-[#C00000] text-white px-3 py-2">
            <h2 className="text-xs font-bold tracking-wider">{section.title}</h2>
            {section.repeatable ? (
              <button
                type="button"
                onClick={() => onChange({ ...answers, [section.id]: [...asRows(answers[section.id]), emptyRow(section)] })}
                className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-white/90 hover:text-white"
              >
                <Plus className="w-3.5 h-3.5" />Add record
              </button>
            ) : null}
          </div>
        );

        if (section.repeatable) {
          const rows = asRows(answers[section.id]);
          return (
            <section key={section.id} className="border border-[#404040] overflow-hidden">
              {heading}
              {section.note ? <p className="px-3 py-2 text-sm text-[#404040] leading-relaxed bg-[#F7F7F7] border-b border-[#404040] whitespace-pre-wrap">{section.note}</p> : null}
              <div className="p-3 space-y-3 bg-white">
              {rows.map((row, index) => (
                <div key={row._rowId || index} className="border border-[#404040] p-3 space-y-3 bg-slate-50">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-500">Record {index + 1}</p>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onChange({ ...answers, [section.id]: rows.filter((_, current) => current !== index) })}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <SectionFields
                    section={section}
                    record={row}
                    onChange={next => onChange({
                      ...answers,
                      [section.id]: rows.map((current, currentIndex) => currentIndex === index ? { ...current, ...next, _rowId: current._rowId } : current),
                    })}
                  />
                </div>
              ))}
              </div>
            </section>
          );
        }

        return (
          <section key={section.id} className="border border-[#404040] overflow-hidden">
            {section.title ? heading : null}
            {section.note ? <p className="px-3 py-2 text-sm text-[#404040] leading-relaxed bg-[#F7F7F7] border-b border-[#404040] whitespace-pre-wrap">{section.note}</p> : null}
            <div className="p-3 bg-white space-y-3">
            <SectionFields
              section={section}
              record={asRecord(answers[section.id])}
            onChange={next => {
              const record = next.work_types
                ? { ...next, work_types: constrainWorkTypes((next.work_types as string[]) ?? []) }
                : next;
              onChange({ ...answers, [section.id]: record });
            }}
            />
            </div>
          </section>
        );
      })}
    </div>
  );
}
