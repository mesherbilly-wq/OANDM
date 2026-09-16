export type SchemaShowWhen = {
  anyWorkType?: string[];
  feature?: string;
  fieldEquals?: { section: string; field: string; values: string[] };
  checkboxTrue?: { section: string; field: string };
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
  note?: string;
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

export const TEST_RESULT_OPTIONS = ['pass', 'fail', 'not_applicable', 'not_tested'] as const;

export const CHECK_CODES = [
  { value: 'P', label: 'P pass' },
  { value: 'F', label: 'F fail' },
  { value: 'NT', label: 'NT not tested' },
  { value: 'NA', label: 'NA not applicable' },
] as const;

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
  if (/^[A-Z0-9]{1,3}$/.test(value)) return value;
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export function newRowId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyRow(section: SchemaSection): FormRow {
  const row: FormRow = { _rowId: newRowId() };
  for (const field of section.fields) {
    if (field.type === 'note') continue;
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
    case 'check_result':
      return { result: '', reference: '' };
    case 'note':
      return '';
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
  if (when.fieldEquals) {
    const record = sectionRecord(answers, when.fieldEquals.section);
    const value = String(record[when.fieldEquals.field] ?? '');
    if (!when.fieldEquals.values.includes(value)) return false;
  }
  if (when.checkboxTrue) {
    const record = sectionRecord(answers, when.checkboxTrue.section);
    if (record[when.checkboxTrue.field] !== true) return false;
  }
  return true;
}

function sectionRecord(answers: FormAnswers, sectionId: string): Record<string, unknown> {
  const value = answers[sectionId];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

const IA06_TOPIC_SEEDS = [
  'Protection, limitations and authorised use',
  'Setting, unsetting and part setting',
  'Alarm reset, faults and omitted zones',
  'Hold-up functions and confirmation where fitted',
  'False-alarm prevention and safe user checks',
  'Logbook, support and maintenance arrangements',
  'App / remote access and secure credential receipt',
];

const IA10_MANIFEST_SEEDS = [
  'As-fitted record and drawings',
  'Readings, calculations and test results',
  'Changes, defects and retest evidence',
  'Training and handover acceptance',
  'User instructions and logbook',
  'Maintenance / warranty information',
  'Takeover / upgrade / transfer records',
  'Official NSI certificate (number / date)',
];

const CV07_TOPIC_SEEDS = [
  'Live view, camera selection and PTZ',
  'Search and playback by camera / time',
  'Export and replay on another device',
  'Fault reporting and service arrangements',
  'Authorised accounts and secure access',
  'Privacy masks, audio and retention controls',
  'Monitoring / analytics operation where fitted',
];

const CV11_MANIFEST_SEEDS = [
  'Survey / risk / user needs / test plan',
  'As-fitted / image / infrastructure results',
  'Commissioning / recording / export results',
  'Monitoring results where applicable',
  'Training / customer test sign-off / handover',
  'User instructions / history / support',
  'Changes / takeover / upgrade records',
  'Official certificate where applicable',
];

export function emptyAnswers(schema: SchemaCatalogue): FormAnswers {
  const answers: FormAnswers = {};
  const isCctv = /\bCV\d{2}\b|CCTV/i.test(schema.title);
  for (const section of schema.sections) {
    if (section.repeatable) {
      if (section.id === 'topics') {
        const seeds = isCctv ? CV07_TOPIC_SEEDS : IA06_TOPIC_SEEDS;
        answers[section.id] = seeds.map(topic => ({ ...emptyRow(section), topic }));
      } else if (section.id === 'manifest') {
        const seeds = isCctv ? CV11_MANIFEST_SEEDS : IA10_MANIFEST_SEEDS;
        answers[section.id] = seeds.map(document_name => ({ ...emptyRow(section), document_name }));
      } else {
        answers[section.id] = [emptyRow(section)];
      }
      continue;
    }
    const record: Record<string, unknown> = {};
    for (const field of section.fields) {
      if (field.type === 'note') continue;
      record[field.id] = defaultFieldValue(field);
    }
    answers[section.id] = record;
  }
  return answers;
}

const PREFILL_FIELD_MAP: Record<string, string[]> = {
  site_building: ['site_name', 'project_name'],
  job_system_ref: ['job_number', 'project_reference'],
  site_name: ['site_name'],
  site_address: ['site_address'],
  installation_address: ['site_address'],
  customer_organisation: ['client_name', 'customer_name', 'customer_organisation'],
  customer_name: ['client_name', 'customer_name'],
  customer_name_role: ['client_name', 'customer_representative'],
  customer_representative: ['customer_representative', 'project_manager'],
  engineer_name: ['engineer', 'engineer_name'],
  engineer: ['engineer', 'engineer_name'],
  survey_engineer: ['engineer'],
  trainer_name: ['engineer'],
  company: ['company'],
  project_reference: ['job_number'],
  system_reference: ['job_number'],
  simpro_job_number: ['job_number'],
  project_title: ['project_name'],
  project_work_title: ['project_name'],
  project_manager: ['project_manager'],
  quote_reference: ['quote_number'],
  quote_id: ['quote_number'],
  quote_variation: ['quote_number'],
  contract_reference: ['quote_number'],
};

export function applySchemaPrefill(
  schema: SchemaCatalogue,
  prefill: Record<string, string>,
  companyName?: string | null,
): FormAnswers {
  const answers = emptyAnswers(schema);
  const source: Record<string, string> = {
    ...prefill,
    company: companyName || prefill.company || '',
  };

  for (const section of schema.sections) {
    if (section.repeatable) continue;
    const record = sectionRecord(answers, section.id);
    for (const field of section.fields) {
      if (field.id === 'quote_note') {
        record[field.id] = 'A quote is a proposed baseline. Confirm the actual installation before issuing the as-fitted record. Quoted quantity is not installed proof.';
        continue;
      }
      const keys = PREFILL_FIELD_MAP[field.id];
      if (!keys) continue;
      for (const key of keys) {
        if (source[key]) {
          record[field.id] = source[key];
          break;
        }
      }
    }
    answers[section.id] = record;
  }
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
        if (field.type === 'note') continue;
        const value = fieldValue(row, field);
        if (field.type === 'check_result' && field.required) {
          const check = value as { result?: string; reference?: string } | undefined;
          if (isBlank(check?.result)) {
            return `${section.title || field.label}: ${field.label} is required.`;
          }
          continue;
        }
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
        if (field.type === 'note') {
          lines.push({ label: field.label, value: '' });
          continue;
        }
        if (field.type === 'check_result') {
          const check = value as { result?: string; reference?: string } | undefined;
          lines.push({
            label: field.label,
            value: [check?.result, check?.reference].filter(item => String(item ?? '').trim()).join(' / ') || '—',
          });
          continue;
        }
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

export function findSignatures(schema: SchemaCatalogue, answers: FormAnswers): Array<{
  label: string;
  required: boolean;
  signerName: string;
  dataUrl: string;
}> {
  const found: Array<{ label: string; required: boolean; signerName: string; dataUrl: string }> = [];
  for (const section of visibleSections(schema, answers)) {
    const rows = section.repeatable
      ? (Array.isArray(answers[section.id]) ? answers[section.id] as FormRow[] : [])
      : [sectionRecord(answers, section.id)];
    for (const row of rows) {
      for (const field of section.fields) {
        if (field.type !== 'signature') continue;
        const signature = row[field.id] as { signerName?: string; dataUrl?: string } | undefined;
        found.push({
          label: field.label,
          required: Boolean(field.required),
          signerName: String(signature?.signerName ?? '').trim(),
          dataUrl: String(signature?.dataUrl ?? ''),
        });
      }
    }
  }
  return found;
}

export function primarySignerName(schema: SchemaCatalogue, answers: FormAnswers): string {
  const signatures = findSignatures(schema, answers);
  const named = signatures.find(item => item.signerName) || signatures[0];
  if (named?.signerName) return named.signerName;
  return String(sectionRecord(answers, 'header').job_system_ref ?? sectionRecord(answers, 'meta').engineer_name ?? '').trim();
}

export function primarySignatureDataUrl(schema: SchemaCatalogue, answers: FormAnswers): string {
  const signatures = findSignatures(schema, answers);
  return signatures.find(item => item.dataUrl)?.dataUrl || '';
}
