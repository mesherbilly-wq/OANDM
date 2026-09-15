import schemaJson from './intruderAlarmFormSchema.json';

export type SchemaShowWhen = {
  anyWorkType?: string[];
  feature?: string;
} | null;

export interface SchemaField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
}

export interface SchemaSection {
  id: string;
  title: string;
  showWhen: SchemaShowWhen;
  repeatable: boolean;
  fields: SchemaField[];
}

export interface SchemaCatalogue {
  schemaVersion: string;
  status: string;
  title: string;
  sections: SchemaSection[];
}

export type FormAnswers = Record<string, unknown>;
export type FormRow = Record<string, unknown> & { _rowId: string };

export const INTRUDER_ALARM_FORM_KEY = 'intruder_alarm_master';
export const INTRUDER_ALARM_SCHEMA = schemaJson as SchemaCatalogue;

export const TEST_RESULT_OPTIONS = ['pass', 'fail', 'not_applicable', 'not_tested'] as const;

export const TRAINING_TOPIC_SEEDS = [
  'setting',
  'unsetting',
  'part setting',
  'reset',
  'faults',
  'omissions',
  'hold-up',
  'false alarms',
  'logbook',
  'support',
];

const WORK_TYPE_CONFLICTS = ['takeover', 'upgrade', 'extension'];

export function humanizeOption(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export function newRowId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyRow(section: SchemaSection): FormRow {
  const row: FormRow = { _rowId: newRowId() };
  for (const field of section.fields) {
    row[field.id] = defaultFieldValue(field);
  }
  return row;
}

export function defaultFieldValue(field: SchemaField): unknown {
  switch (field.type) {
    case 'multiselect':
    case 'document_reference_list':
    case 'issue_links':
    case 'asset_links':
    case 'test_links':
    case 'signal_test_list':
    case 'document_manifest':
      return [];
    case 'training_topic_list':
      return TRAINING_TOPIC_SEEDS.map(topic => ({
        topic,
        applicability: 'applicable',
        status: '',
        notes: '',
      }));
    case 'boolean':
    case 'checkbox':
      return false;
    case 'measurement':
      return { value: '', unit: '', conditions: '' };
    case 'signature':
      return { signerName: '', dataUrl: '', signedAt: '' };
    default:
      return '';
  }
}

export function projectRecord(answers: FormAnswers): Record<string, unknown> {
  const value = answers.project;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function workTypesOf(answers: FormAnswers): string[] {
  const value = projectRecord(answers).work_types;
  return Array.isArray(value) ? value.map(String) : [];
}

export function featuresOf(answers: FormAnswers): string[] {
  const value = projectRecord(answers).system_features;
  return Array.isArray(value) ? value.map(String) : [];
}

export function isSectionVisible(section: SchemaSection, answers: FormAnswers): boolean {
  const when = section.showWhen;
  if (!when) return true;
  if (when.anyWorkType?.length && !when.anyWorkType.some(type => workTypesOf(answers).includes(type))) {
    return false;
  }
  if (when.feature && !featuresOf(answers).includes(when.feature)) {
    return false;
  }
  return true;
}

export function visibleSections(schema: SchemaCatalogue, answers: FormAnswers): SchemaSection[] {
  return schema.sections.filter(section => isSectionVisible(section, answers));
}

export function constrainWorkTypes(next: string[]): string[] {
  const unique = [...new Set(next)];
  if (unique.includes('new_installation') && unique.some(type => WORK_TYPE_CONFLICTS.includes(type))) {
    return unique.includes('new_installation') && unique[unique.length - 1] === 'new_installation'
      ? ['new_installation']
      : unique.filter(type => type !== 'new_installation');
  }
  return unique;
}

export function applySchemaPrefill(prefill: Record<string, string>, companyName?: string | null): FormAnswers {
  const answers: FormAnswers = {};
  for (const section of INTRUDER_ALARM_SCHEMA.sections) {
    if (section.repeatable) {
      answers[section.id] = [emptyRow(section)];
      continue;
    }
    const record: Record<string, unknown> = {};
    for (const field of section.fields) {
      record[field.id] = defaultFieldValue(field);
    }
    answers[section.id] = record;
  }

  const project = projectRecord(answers);
  project.project_reference = prefill.job_number || prefill.project_reference || '';
  project.site_name = prefill.site_name || '';
  project.site_address = prefill.site_address || '';
  project.customer_name = prefill.client_name || prefill.customer_name || '';
  project.customer_representative = prefill.project_manager || prefill.customer_representative || '';
  project.scope = prefill.scope || '';
  project.engineer_name = prefill.engineer || prefill.engineer_name || '';
  project.company = companyName || prefill.company || '';
  project.contract_reference = prefill.quote_number || prefill.contract_reference || '';
  project.system_reference = prefill.job_number || '';
  answers.project = project;
  return answers;
}

export function mergeSavedAnswers(base: FormAnswers, saved: unknown): FormAnswers {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base;
  return { ...base, ...(saved as FormAnswers) };
}

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number') return false;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('dataUrl' in record) return !String(record.dataUrl ?? '').trim();
    if ('value' in record) return isBlank(record.value);
    return Object.values(record).every(isBlank);
  }
  return false;
}

function fieldValue(container: Record<string, unknown>, field: SchemaField): unknown {
  return container[field.id];
}

export function validateSchemaAnswers(schema: SchemaCatalogue, answers: FormAnswers): string | null {
  const types = workTypesOf(answers);
  if (types.includes('new_installation') && types.some(type => WORK_TYPE_CONFLICTS.includes(type))) {
    return 'New installation cannot be combined with takeover, upgrade or extension on the same system record.';
  }

  for (const section of visibleSections(schema, answers)) {
    const rows = section.repeatable
      ? (Array.isArray(answers[section.id]) ? answers[section.id] as FormRow[] : [])
      : [((answers[section.id] as Record<string, unknown> | undefined) ?? {})];

    if (section.repeatable && rows.length === 0) {
      return `${section.title} needs at least one record, or mark the section not applicable in issues.`;
    }

    for (const row of rows) {
      for (const field of section.fields) {
        const value = fieldValue(row, field);
        if (field.id === 'na_reason' && row.test_outcome === 'not_applicable' && isBlank(value)) {
          return 'Give a reason when a test is not applicable.';
        }
        if (field.id === 'not_tested_reason' && row.test_outcome === 'not_tested' && isBlank(value)) {
          return 'Give a reason when a test is not tested.';
        }
        if (field.id === 'issue_reference' && row.test_outcome === 'fail' && isBlank(value)) {
          return 'A failed test must link to an issue.';
        }
        if (field.id === 'response_evidence' && row.police_response_status === 'confirmed_documented' && isBlank(value)) {
          return 'Police response evidence is required when response is confirmed.';
        }
        if (field.id === 'existing_stated_grade' && !types.includes('takeover') && !types.includes('upgrade') && !types.includes('extension')) {
          continue;
        }
        if (field.type === 'signature' && field.required) {
          const signature = value as { signerName?: string; dataUrl?: string } | undefined;
          if (!signature?.dataUrl || !signature.signerName?.trim()) {
            return `${field.label} needs a name and signature.`;
          }
          continue;
        }
        if (field.required && isBlank(value)) {
          return `${section.title}: ${field.label} is required.`;
        }
      }
    }
  }
  return null;
}

export function flattenAnswersForPdf(schema: SchemaCatalogue, answers: FormAnswers): { label: string; value: string; image?: string }[] {
  const lines: { label: string; value: string; image?: string }[] = [];
  for (const section of visibleSections(schema, answers)) {
    lines.push({ label: section.title, value: '' });
    const rows = section.repeatable
      ? (Array.isArray(answers[section.id]) ? answers[section.id] as FormRow[] : [])
      : [((answers[section.id] as Record<string, unknown> | undefined) ?? {})];

    rows.forEach((row, index) => {
      if (section.repeatable) {
        lines.push({ label: `${section.title} ${index + 1}`, value: String(row._rowId ?? '') });
      }
      for (const field of section.fields) {
        const value = fieldValue(row, field);
        if (field.type === 'signature') {
          const signature = value as { signerName?: string; dataUrl?: string } | undefined;
          lines.push({
            label: field.label,
            value: signature?.signerName || '—',
            image: signature?.dataUrl || undefined,
          });
          continue;
        }
        lines.push({ label: field.label, value: formatValue(value) });
      }
    });
  }
  return lines;
}

function formatValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (value.every(item => typeof item === 'string')) return value.map(item => humanizeOption(String(item))).join(', ');
    return value.map(item => formatValue(item)).join(' | ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.entries(record)
      .filter(([key, item]) => key !== 'dataUrl' && !isBlank(item))
      .map(([key, item]) => `${humanizeOption(key)}: ${formatValue(item)}`)
      .join('; ') || '—';
  }
  return String(value);
}

export function primarySignerName(answers: FormAnswers): string {
  const release = answers.release as Record<string, unknown> | undefined;
  const declaration = release?.engineer_declaration as { signerName?: string } | undefined;
  if (declaration?.signerName?.trim()) return declaration.signerName.trim();
  const training = Array.isArray(answers.training) ? answers.training[0] as Record<string, unknown> | undefined : undefined;
  const engineerSig = training?.engineer_signature as { signerName?: string } | undefined;
  if (engineerSig?.signerName?.trim()) return engineerSig.signerName.trim();
  return String(projectRecord(answers).engineer_name ?? '').trim();
}

export function primarySignatureDataUrl(answers: FormAnswers): string {
  const release = answers.release as Record<string, unknown> | undefined;
  const declaration = release?.engineer_declaration as { dataUrl?: string } | undefined;
  if (declaration?.dataUrl) return declaration.dataUrl;
  const training = Array.isArray(answers.training) ? answers.training[0] as Record<string, unknown> | undefined : undefined;
  const engineerSig = training?.engineer_signature as { dataUrl?: string } | undefined;
  return engineerSig?.dataUrl || '';
}
