import type { CompletionField, CompletionSection, CompletionTemplateSchema } from './completionFormTypes';

export const STANDARD_JOB_SECTION_ID = 'job';

export const STANDARD_JOB_FIELD_IDS = [
  'job_number',
  'site_address',
  'client',
  'job_title',
  'project_manager',
  'engineer',
  'date_of_install',
  'system_type',
  'scope_note',
] as const;

const STANDARD_JOB_FIELDS: CompletionField[] = [
  { id: 'job_number', label: 'Job number', type: 'text', required: true, customerVisible: true, source: 'PDF p2 Job Number (picker replaced with the project job number)' },
  { id: 'site_address', label: 'Site address', type: 'textarea', required: true, customerVisible: true, source: 'PDF p2 Site Address' },
  { id: 'client', label: 'Client', type: 'text', required: true, customerVisible: true, source: 'PDF p2 Client' },
  { id: 'job_title', label: 'Job title', type: 'text', customerVisible: true, source: 'PDF p3 Job Title' },
  { id: 'project_manager', label: 'Project manager', type: 'text', source: 'PDF p3 Project Manager' },
  { id: 'engineer', label: 'Engineer', type: 'text', required: true, source: 'PDF p3 Engineer' },
  { id: 'date_of_install', label: 'Date of install', type: 'date', required: true, customerVisible: true, source: 'PDF p4 Date of Install' },
  { id: 'system_type', label: 'System type (make / model)', type: 'text', required: true, customerVisible: true, source: 'PDF p4 System Type (Make/Model)' },
  {
    id: 'scope_note',
    label: 'Imported quote quantities are proposed scope only. Confirm what was actually installed and tested.',
    type: 'note',
    customerVisible: true,
  },
];

const STANDARD_JOB_SECTION: CompletionSection = {
  id: STANDARD_JOB_SECTION_ID,
  title: 'Job, customer and site',
  summary: 'Who the work is for and where it is.',
  customerVisible: true,
  source: 'Shared first page. Same fields as the CCTV completion form.',
  note: 'The source PDF listed live Simpro jobs from a SafetyCulture picker. This form uses the project job number instead of that account-specific list.',
  fields: STANDARD_JOB_FIELDS,
};

export function standardJobCustomerSiteSection(): CompletionSection {
  return structuredClone(STANDARD_JOB_SECTION);
}

export function isStandardJobSection(section: { id?: string; title?: string } | null | undefined): boolean {
  if (!section) return false;
  const id = String(section.id ?? '').toLowerCase();
  const title = String(section.title ?? '').toLowerCase();
  if (id === STANDARD_JOB_SECTION_ID) return true;
  return /job/.test(title) && /customer|site|client/.test(title);
}

export function isLockedJobField(fieldId: string): boolean {
  return (STANDARD_JOB_FIELD_IDS as readonly string[]).includes(fieldId);
}

function looksLikeDuplicateJobPage(section: CompletionSection): boolean {
  const ids = new Set((section.fields ?? []).map(field => field.id));
  const overlap = STANDARD_JOB_FIELD_IDS.filter(id => ids.has(id)).length;
  return overlap >= 5 && (section.groups?.length ?? 0) === 0;
}

export function withStandardJobFirst(sections: CompletionSection[]): CompletionSection[] {
  const rest = (sections ?? []).filter(section => !isStandardJobSection(section) && !looksLikeDuplicateJobPage(section));
  return [standardJobCustomerSiteSection(), ...rest];
}

export function pinStandardJobSection(schema: CompletionTemplateSchema): CompletionTemplateSchema {
  return {
    ...schema,
    sections: withStandardJobFirst(schema.sections ?? []),
  };
}
