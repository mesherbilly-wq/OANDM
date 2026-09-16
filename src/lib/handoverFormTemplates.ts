import { INTRUDER_ALARM_FORM_KEY } from './schemaForm';
import { pacificCompletionTemplateList } from './pacificCompletionPacks';
import { sdpTemplateList } from './systemDesignProposal';
import { getPackFormSchema, isPackFormKey } from './packFormSchemas';

export type HandoverFormFieldType = 'text' | 'textarea' | 'date' | 'email' | 'select' | 'checkbox';

export type HandoverPrefillKey =
  | 'job_number'
  | 'project_name'
  | 'client_name'
  | 'site_name'
  | 'site_address'
  | 'project_manager'
  | 'document_title';

export interface HandoverFormField {
  key: string;
  label: string;
  type: HandoverFormFieldType;
  required?: boolean;
  options?: string[];
  prefillFrom?: HandoverPrefillKey;
}

export interface HandoverFormTemplate {
  key: string;
  name: string;
  description: string;
  fields: HandoverFormField[];
}

const COMMON_PROJECT_FIELDS: HandoverFormField[] = [
  { key: 'job_number', label: 'Job number', type: 'text', prefillFrom: 'job_number' },
  { key: 'project_name', label: 'Project name', type: 'text', required: true, prefillFrom: 'project_name' },
  { key: 'client_name', label: 'Client', type: 'text', required: true, prefillFrom: 'client_name' },
  { key: 'site_name', label: 'Site', type: 'text', prefillFrom: 'site_name' },
  { key: 'site_address', label: 'Site address', type: 'textarea', prefillFrom: 'site_address' },
];

const GENERIC_TEMPLATES: Record<string, HandoverFormTemplate> = {
  handover_certificate: {
    key: 'handover_certificate',
    name: 'Handover / acceptance certificate',
    description: 'Customer acceptance of the installed system, with signature.',
    fields: [
      ...COMMON_PROJECT_FIELDS,
      { key: 'document_title', label: 'Document', type: 'text', prefillFrom: 'document_title' },
      { key: 'system_description', label: 'System handed over', type: 'textarea', required: true },
      { key: 'completion_date', label: 'Completion date', type: 'date', required: true },
      {
        key: 'works_complete',
        label: 'Works are complete and the system has been demonstrated',
        type: 'checkbox',
        required: true,
      },
      {
        key: 'documentation_received',
        label: 'Relevant documentation, passwords and keys have been received',
        type: 'checkbox',
        required: true,
      },
      { key: 'signer_name', label: 'Customer / representative name', type: 'text', required: true },
      { key: 'signer_role', label: 'Position', type: 'text' },
      { key: 'signer_email', label: 'Email', type: 'email' },
      { key: 'comments', label: 'Comments', type: 'textarea' },
    ],
  },
  training_record: {
    key: 'training_record',
    name: 'Customer training record',
    description: 'Signed record that customer staff have been trained.',
    fields: [
      ...COMMON_PROJECT_FIELDS,
      { key: 'document_title', label: 'Document', type: 'text', prefillFrom: 'document_title' },
      { key: 'training_date', label: 'Training date', type: 'date', required: true },
      { key: 'trainer_name', label: 'Trainer name', type: 'text', required: true },
      { key: 'attendees', label: 'Attendees', type: 'textarea', required: true },
      { key: 'topics', label: 'Topics covered', type: 'textarea', required: true },
      {
        key: 'competent',
        label: 'Attendees are competent to operate the system as demonstrated',
        type: 'checkbox',
        required: true,
      },
      { key: 'signer_name', label: 'Customer / representative name', type: 'text', required: true },
      { key: 'signer_role', label: 'Position', type: 'text' },
      { key: 'comments', label: 'Comments', type: 'textarea' },
    ],
  },
  commissioning_sheet: {
    key: 'commissioning_sheet',
    name: 'Commissioning / system checks',
    description: 'Engineer commissioning checks.',
    fields: [
      ...COMMON_PROJECT_FIELDS,
      { key: 'document_title', label: 'Document', type: 'text', prefillFrom: 'document_title' },
      { key: 'engineer_name', label: 'Engineer name', type: 'text', required: true },
      { key: 'test_date', label: 'Test date', type: 'date', required: true },
      {
        key: 'result',
        label: 'Overall result',
        type: 'select',
        required: true,
        options: ['Pass', 'Pass with observations', 'Fail'],
      },
      { key: 'checks_completed', label: 'Checks completed', type: 'textarea', required: true },
      { key: 'observations', label: 'Observations / snags', type: 'textarea' },
      { key: 'signer_name', label: 'Engineer name', type: 'text', required: true },
      { key: 'signer_role', label: 'Position', type: 'text' },
      { key: 'comments', label: 'Comments', type: 'textarea' },
    ],
  },
  test_record: {
    key: 'test_record',
    name: 'Test record',
    description: 'Functional test sheet with engineer signature.',
    fields: [
      ...COMMON_PROJECT_FIELDS,
      { key: 'document_title', label: 'Document', type: 'text', prefillFrom: 'document_title' },
      { key: 'engineer_name', label: 'Engineer name', type: 'text', required: true },
      { key: 'test_date', label: 'Test date', type: 'date', required: true },
      { key: 'devices_tested', label: 'Devices / zones tested', type: 'textarea', required: true },
      {
        key: 'result',
        label: 'Result',
        type: 'select',
        required: true,
        options: ['Pass', 'Pass with observations', 'Fail'],
      },
      { key: 'defects', label: 'Defects', type: 'textarea' },
      { key: 'signer_name', label: 'Engineer name', type: 'text', required: true },
      { key: 'signer_role', label: 'Position', type: 'text' },
    ],
  },
  keyholder_confirmation: {
    key: 'keyholder_confirmation',
    name: 'Keyholder confirmation',
    description: 'Confirmed keyholder details and response plan.',
    fields: [
      ...COMMON_PROJECT_FIELDS,
      { key: 'document_title', label: 'Document', type: 'text', prefillFrom: 'document_title' },
      { key: 'keyholder_1_name', label: 'Keyholder 1 name', type: 'text', required: true },
      { key: 'keyholder_1_phone', label: 'Keyholder 1 telephone', type: 'text', required: true },
      { key: 'keyholder_2_name', label: 'Keyholder 2 name', type: 'text' },
      { key: 'keyholder_2_phone', label: 'Keyholder 2 telephone', type: 'text' },
      { key: 'response_plan', label: 'Response plan', type: 'textarea', required: true },
      { key: 'signer_name', label: 'Confirmed by', type: 'text', required: true },
      { key: 'signer_role', label: 'Position', type: 'text' },
      { key: 'completion_date', label: 'Date', type: 'date', required: true },
    ],
  },
};

export const HANDOVER_FORM_TEMPLATES: Record<string, HandoverFormTemplate> = {
  ...GENERIC_TEMPLATES,
  ...Object.fromEntries(sdpTemplateList().map(item => [item.key, item])),
  ...Object.fromEntries(pacificCompletionTemplateList().map(item => [item.key, item])),
};

export const HANDOVER_FORM_TEMPLATE_LIST = [
  ...sdpTemplateList(),
  ...pacificCompletionTemplateList(),
  ...Object.values(GENERIC_TEMPLATES),
];

export function isHandoverFormTemplateKey(key: string | null | undefined): key is string {
  return Boolean(key && (HANDOVER_FORM_TEMPLATES[key] || isPackFormKey(key)));
}

export function inferFormTemplateKey(title: string): string {
  const value = title.toLowerCase();
  if (/\bsdp\b|system design proposal/.test(value)) return 'sdp';
  if (/\bcc01\b|cctv completion/.test(value) || (/cctv/.test(value) && /handover|completion/.test(value))) return 'cc01_completion';
  if (/\bac01\b|access control completion/.test(value) || (/access/.test(value) && /handover|completion/.test(value))) return 'ac01_completion';
  if (/\bia01\b|intruder alarm completion/.test(value) || (/intruder/.test(value) && /handover|completion/.test(value))) return 'ia01_completion';
  if (/\bcv01\b/.test(value) || (/cctv/.test(value) && /as-fitted|as fitted|camera schedule/.test(value))) return 'cc01_completion';
  if (/\bcv02\b/.test(value) || (/cctv/.test(value) && /camera and infrastructure|image and infrastructure/.test(value))) return 'cv02_cameras';
  if (/\bcv03\b/.test(value) || (/cctv/.test(value) && /commissioning/.test(value))) return 'cv03_commissioning';
  if (/\bcv04\b/.test(value) || (/cctv/.test(value) && /recording|export|nvr|dvr/.test(value))) return 'cv04_recording';
  if (/\bcv05\b/.test(value) || (/cctv/.test(value) && /remote monitoring|detector-activated|bs 8418/.test(value))) return 'cv05_monitoring';
  if (/\bcv06\b/.test(value) || (/cctv/.test(value) && /remedial|design change/.test(value))) return 'cv06_changes';
  if (/\bcv07\b/.test(value) || (/cctv/.test(value) && /demonstration|training/.test(value))) return 'cv07_training';
  if (/\bcv08\b/.test(value) || (/cctv/.test(value) && /handover acceptance|completion/.test(value))) return 'cv08_handover';
  if (/\bcv09\b/.test(value) || (/cctv/.test(value) && /event log|system history/.test(value))) return 'cv09_log';
  if (/\bcv10\b/.test(value) || (/cctv/.test(value) && /support information/.test(value))) return 'cv10_support';
  if (/\bcv11\b/.test(value) || (/cctv/.test(value) && /technical release|o&m index/.test(value))) return 'cv11_release';
  if (/\bcv12\b/.test(value) || (/cctv/.test(value) && /takeover/.test(value))) return 'cv12_takeover';
  if (/\bcv13\b/.test(value) || (/cctv/.test(value) && /upgrade/.test(value))) return 'cv13_upgrade';
  if (/\bcv14\b/.test(value) || (/cctv/.test(value) && /corrective work|maintenance and corrective/.test(value))) return 'cv14_maintenance';
  if (/\bcv15\b/.test(value) || (/cctv/.test(value) && /customer acceptance of change|limitation/.test(value))) return 'cv15_acceptance';
  if (/\bcv16\b/.test(value) || (/cctv/.test(value) && /survey and test plan/.test(value))) return 'cv16_survey';
  if (/cctv/.test(value) && /certificate|handover/.test(value)) return 'cv08_handover';
  if (/\bia01\b/.test(value) || (/as-fitted|as fitted/.test(value) && !/cctv/.test(value))) return 'ia01_as_fitted';
  if (/\bia02\b|electrical reading|parameters/.test(value)) return 'ia02_readings';
  if (/\bia03\b|commissioning and verification/.test(value)) return 'ia03_commissioning';
  if (/\bia04\b|arc signalling|signalling/.test(value)) return 'ia04_arc';
  if (/\bia05\b|remedial|design change/.test(value)) return 'ia05_changes';
  if (/\bia06\b|demonstration/.test(value)) return 'ia06_training';
  if (/\bia07\b|handover acceptance/.test(value)) return 'ia07_handover';
  if (/\bia08\b|event log|system history/.test(value)) return 'ia08_log';
  if (/\bia09\b|support information/.test(value)) return 'ia09_support';
  if (/\bia10\b|technical release|o&m index/.test(value)) return 'ia10_release';
  if (/\bia11\b|takeover survey/.test(value)) return 'ia11_takeover';
  if (/\bia12\b|upgrade and extension/.test(value)) return 'ia12_upgrade';
  if (/\bia13\b|monitoring transfer/.test(value)) return 'ia13_transfer';
  if (/\bia14\b|corrective work/.test(value)) return 'ia14_maintenance';
  if (/\bia15\b|conditional customer acceptance/.test(value) && !/cctv/.test(value)) return 'ia15_acceptance';
  if (/intruder/.test(value) && /completion|certificate|master|handover/.test(value)) return 'ia07_handover';
  if (/train/.test(value)) return 'training_record';
  if (/keyholder/.test(value)) return 'keyholder_confirmation';
  if (/commissioning sheet|record of system checks/.test(value)) return 'commissioning_sheet';
  if (/test sheet|test record|detector test|reader test|bell\/strobe/.test(value)) return 'test_record';
  return 'handover_certificate';
}

export function formTemplateKeyForDefinition(def: {
  sc_enabled?: boolean;
  upload_only?: boolean;
  sc_template_id?: string | null;
  title: string;
}): string | null {
  if (!def.sc_enabled || def.upload_only) return null;
  if (isHandoverFormTemplateKey(def.sc_template_id)) return def.sc_template_id;
  return inferFormTemplateKey(def.title);
}

export function getHandoverFormTemplate(key: string | null | undefined): HandoverFormTemplate {
  if (key && HANDOVER_FORM_TEMPLATES[key]) return HANDOVER_FORM_TEMPLATES[key];
  const schema = getPackFormSchema(key);
  if (schema) {
    return { key: key || schema.title, name: schema.title, description: schema.status, fields: [] };
  }
  return HANDOVER_FORM_TEMPLATES.handover_certificate;
}

export { INTRUDER_ALARM_FORM_KEY };
