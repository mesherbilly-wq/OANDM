import {
  ACCESS_CONTROL_OM_TEMPLATE_KEY,
  COMPLETION_TEMPLATE_VERSION,
  type CompletionField,
  type CompletionGroup,
  type CompletionSection,
  type CompletionTemplateSchema,
} from './completionFormTypes';
import { standardJobCustomerSiteSection } from './standardJobSection';

const STATUS_NOTICE =
  'O and M Systems operational checks and handover for access control. This company form is not an official NSI certificate. Signatures captured here are drawn electronic signatures with an audit record, not certificate-backed digital signatures.';

const YES_NO = ['Yes', 'No'];
const YES_NO_NA = ['Yes', 'No', 'N/A'];
const NEW_EXISTING = ['New', 'Existing'];
const COMMS = ['RS485', 'IP', 'RS232'];
const LOCK_TYPES = ['Vortex', 'Monitored Mag', 'Un-Monitored Mag', 'Strike', 'Other'];
const FAIL_MODE = ['Fail Secure', 'Fail Unsecure', 'N/A'];
const RELEASE_TIMES = ['1 Sec', '5 Sec', '10 Sec', '60 Sec', '180 Sec'];
const TRAINING_ITEMS = [
  'System Logon & Logoff',
  'Viewing of Live events',
  'Reviewing Cardholder Reports',
  'Programming Cards/Fobs',
  'Creating Groups',
  'Software Feature/Functionality',
  'Alarm Management',
];

function field(partial: CompletionField): CompletionField {
  return partial;
}

const SERVER_FIELDS: CompletionField[] = [
  field({ id: 'software_make', label: 'System software make', type: 'text', source: 'PDF p4 System Software Make' }),
  field({ id: 'software_version', label: 'System software version', type: 'text', source: 'PDF p5 System Software Version' }),
  field({ id: 'software_patches', label: 'System software patches', type: 'text', source: 'PDF p5 System Software Patches' }),
  field({ id: 'software_username', label: 'Software username', type: 'text', sensitive: true, source: 'PDF p5 Software Username' }),
  field({ id: 'software_password', label: 'Software password', type: 'text', sensitive: true, source: 'PDF p6 Software Password' }),
  field({ id: 'name', label: 'Server / workstation name', type: 'text', required: true, source: 'PDF p6 Name' }),
  field({ id: 'type', label: 'Type (Client / Server)', type: 'text', source: 'PDF p6 Type (Client/Server)' }),
  field({ id: 'make', label: 'Make', type: 'text', source: 'PDF p7 Make' }),
  field({ id: 'model', label: 'Model', type: 'text', source: 'PDF p7 Model' }),
  field({ id: 'windows_username', label: 'Windows username', type: 'text', required: true, sensitive: true, source: 'PDF p7 Windows Username' }),
  field({ id: 'windows_password', label: 'Windows password', type: 'text', required: true, sensitive: true, source: 'PDF p8 Windows Password' }),
  field({ id: 'ip', label: 'IP address', type: 'text', source: 'PDF p8 IP' }),
  field({ id: 'mac_address', label: 'MAC address', type: 'text', source: 'PDF p8 MAC Address' }),
  field({ id: 'gateway', label: 'Gateway', type: 'text', source: 'PDF p9 Gateway' }),
  field({ id: 'subnet_mask', label: 'Subnet mask', type: 'text', source: 'PDF p9 Subnet Mask' }),
];

const READER_FIELDS: CompletionField[] = [
  field({ id: 'location', label: 'Reader location / door number', type: 'text', required: true, source: 'PDF p15 Reader Location / Door Number' }),
  field({ id: 'read_in_read_out', label: 'Read-in / read-out', type: 'select', options: YES_NO, source: 'PDF p16 Read-in Read-out' }),
  field({ id: 'cable_resistance', label: 'Cable resistance at card reader', type: 'text', source: 'PDF p16 Cable Resistance At Card Reader' }),
  field({ id: 'reader_operating', label: 'Reader operating correctly', type: 'select', required: true, options: YES_NO_NA, source: 'PDF p16 Reader Opperating Correctly' }),
  field({ id: 'door_releases_rte', label: 'Door releases via request to exit', type: 'select', required: true, options: YES_NO_NA, source: 'PDF p16 Door Releases Via Request To Exit Function' }),
  field({
    id: 'lock_type',
    label: 'Lock type',
    type: 'select',
    required: true,
    options: LOCK_TYPES,
    source: 'PDF p16–17 Lock Type',
  }),
  field({ id: 'fail_mode', label: 'Fail secure or unsecure', type: 'select', required: true, options: FAIL_MODE, source: 'PDF p17 Fail Secure or Un-secure' }),
  field({ id: 'door_release_time', label: 'Door release time', type: 'select', options: RELEASE_TIMES, source: 'PDF p17 Door Release Time' }),
  field({ id: 'door_alignment', label: 'Door alignment correct', type: 'select', required: true, options: YES_NO_NA, source: 'PDF p17 Door Alignment Correct' }),
  field({ id: 'door_held_alarm', label: 'Door held monitoring / local alarm functioning', type: 'select', required: true, options: YES_NO_NA, source: 'PDF p17 Door Held Monitoring / local Alarm Functioning' }),
  field({ id: 'break_glass', label: 'Emergency break glass operating / local alarm functioning', type: 'select', required: true, options: YES_NO_NA, source: 'PDF p17 Emergancy Break Glass' }),
  field({ id: 'fire_alarm_release', label: 'Releasing on fire alarm activation', type: 'select', required: true, options: YES_NO_NA, source: 'PDF p18 Releasing on Fire Alarm activation' }),
  field({
    id: 'door_additional_check',
    label: 'Additional door operational check',
    type: 'select',
    options: YES_NO_NA,
    help: 'The source PDF had an unlabeled Yes / No / N/A after fire-alarm release. Record the site check here.',
    source: 'PDF p18 unlabeled Select one after fire alarm',
  }),
];

export const ACCESS_CONTROL_OM_GROUPS: Record<string, CompletionGroup> = {
  servers: {
    id: 'servers',
    title: 'Servers and workstations',
    addLabel: 'Add server / workstation',
    nameTemplate: '{name} — {type}',
    identityFields: ['name', 'type', 'make', 'model'],
    showWhen: [{ field: 'system_new_or_existing', op: 'eq', values: ['New'] }],
    source: 'PDF p4–9 Workstation/Server Repeat section (shown when system is New)',
    fields: SERVER_FIELDS,
  },
  workstations: {
    id: 'workstations',
    title: 'Workstation PCs',
    addLabel: 'Add workstation PC',
    nameTemplate: '{name}',
    identityFields: ['name', 'make', 'model'],
    showWhen: [{ field: 'system_new_or_existing', op: 'eq', values: ['New'] }],
    source: 'PDF p9–13 Workstation/PCs Repeat section',
    fields: [
      field({
        id: 'software_same_as_server',
        label: 'Is the software make, version, etc the same as the server',
        type: 'select',
        required: true,
        options: YES_NO,
        source: 'PDF p9',
      }),
      field({
        id: 'software_make',
        label: 'System software make',
        type: 'text',
        showWhen: [{ field: 'software_same_as_server', op: 'eq', values: ['No'] }],
        source: 'PDF p9 1.1',
      }),
      field({
        id: 'software_version',
        label: 'System software version',
        type: 'text',
        showWhen: [{ field: 'software_same_as_server', op: 'eq', values: ['No'] }],
        source: 'PDF p10 1.2',
      }),
      field({
        id: 'software_patches',
        label: 'System software patches',
        type: 'text',
        showWhen: [{ field: 'software_same_as_server', op: 'eq', values: ['No'] }],
        source: 'PDF p10 1.3',
      }),
      field({
        id: 'workstation_number',
        label: 'Workstation number / identifier',
        type: 'text',
        source: 'PDF p10 1.4 (listed in skip logic; confirm from page picture)',
      }),
      field({ id: 'name', label: 'Workstation name', type: 'text', required: true, source: 'PDF p10 1.5 System Workstation Name' }),
      field({ id: 'make', label: 'Workstation make', type: 'text', source: 'PDF p11 1.6' }),
      field({ id: 'model', label: 'Workstation model', type: 'text', source: 'PDF p11 1.7' }),
      field({ id: 'username', label: 'Workstation username', type: 'text', required: true, sensitive: true, source: 'PDF p11 1.8' }),
      field({ id: 'password', label: 'Workstation password', type: 'text', required: true, sensitive: true, source: 'PDF p12 1.9' }),
      field({ id: 'ip', label: 'IP address', type: 'text', source: 'PDF p12 IP' }),
      field({ id: 'mac_address', label: 'MAC address', type: 'text', source: 'PDF p12 MAC Address' }),
      field({ id: 'gateway', label: 'Gateway', type: 'text', source: 'PDF p13 Gateway' }),
      field({ id: 'subnet_mask', label: 'Subnet mask', type: 'text', source: 'PDF p13 Subnet Mask' }),
    ],
  },
  controllers: {
    id: 'controllers',
    title: 'Controllers',
    addLabel: 'Add controller',
    nameTemplate: '{location} — {make_model}',
    identityFields: ['location', 'make_model'],
    source: 'PDF p13–14 Controller Repeat; 1.0.0 add new controller when existing system has additions',
    fields: [
      field({ id: 'location', label: 'Controller location', type: 'text', required: true, source: 'PDF p14 Controller Location' }),
      field({ id: 'make_model', label: 'Controller make and model', type: 'text', required: true, source: 'PDF p14 Controller Make and Model' }),
      field({ id: 'comms', label: 'Controller comms', type: 'select', options: COMMS, source: 'PDF p14 Controller Comms' }),
      field({ id: 'mac_address', label: 'MAC address', type: 'text', source: 'PDF p14 Mac Address' }),
      field({ id: 'ip', label: 'IP address', type: 'text', source: 'PDF p15 IP' }),
      field({ id: 'gateway', label: 'Gateway', type: 'text', source: 'PDF p15 Gateway' }),
      field({ id: 'subnet_mask', label: 'Subnet mask', type: 'text', source: 'PDF p15 Subnet Mask' }),
    ],
    nested: [
      {
        id: 'readers',
        title: 'Readers and door checks',
        addLabel: 'Add reader / door',
        nameTemplate: '{location}',
        identityFields: ['location'],
        source: 'PDF p15–18 Reader Repeat + Door Information checklist',
        fields: READER_FIELDS,
      },
    ],
  },
  trainees: {
    id: 'trainees',
    title: 'People trained',
    addLabel: 'Add trainee',
    nameTemplate: '{name}',
    identityFields: ['name'],
    showWhen: [{ field: 'training_given', op: 'eq', values: ['Yes'] }],
    source: 'PDF p20 Trainee Repeat section',
    fields: [
      field({ id: 'name', label: 'Name of trainee', type: 'text', required: true, customerVisible: true, source: 'PDF p20 Name and signature of trainee' }),
      field({ id: 'signature', label: 'Trainee signature', type: 'signature', required: true, customerVisible: true, source: 'PDF p20 Signature' }),
      field({ id: 'trained_on', label: 'Date of training', type: 'date', required: true, customerVisible: true, source: 'PDF p20 Date of training' }),
    ],
  },
};

const SECTIONS: CompletionSection[] = [
  standardJobCustomerSiteSection(),
  {
    id: 'system',
    title: 'System, servers, workstations and controllers',
    summary: 'Whether the system is new, then each server, workstation PC, controller and door checklist.',
    source: 'PDF p3–18 System Information through door checks',
    fields: [
      field({
        id: 'system_new_or_existing',
        label: 'Is the system new or existing',
        type: 'select',
        required: true,
        options: NEW_EXISTING,
        source: 'PDF p3 Is the system new or existing',
      }),
      field({
        id: 'existing_controllers_added',
        label: 'Has this existing system had any controllers or workstations / client machines added to it?',
        type: 'select',
        required: true,
        options: YES_NO,
        showWhen: [{ field: 'system_new_or_existing', op: 'eq', values: ['Existing'] }],
        source: 'PDF p3 1.0',
      }),
      field({
        id: 'add_controller_note',
        label: 'Add each new controller below when the existing system has had controllers or workstations added.',
        type: 'note',
        showWhen: [{ field: 'existing_controllers_added', op: 'eq', values: ['Yes'] }],
        source: 'PDF p3 1.0.0',
      }),
    ],
    groups: [
      ACCESS_CONTROL_OM_GROUPS.servers,
      ACCESS_CONTROL_OM_GROUPS.workstations,
      {
        ...ACCESS_CONTROL_OM_GROUPS.controllers,
        id: 'controllers_new',
        showWhen: [{ field: 'system_new_or_existing', op: 'eq', values: ['New'] }],
        source: 'PDF p13–18 Controller Repeat on a new system',
      },
      {
        ...ACCESS_CONTROL_OM_GROUPS.controllers,
        id: 'controllers_added',
        title: 'New controllers on existing system',
        addLabel: 'Add new controller',
        showWhen: [{ field: 'existing_controllers_added', op: 'eq', values: ['Yes'] }],
        source: 'PDF p3 1.0.0 and p13–18 when existing system has additions',
      },
    ],
  },
  {
    id: 'training',
    title: 'Customer training',
    summary: 'What the end user was trained on, or confirm that training is not required.',
    customerVisible: true,
    source: 'PDF p18–20 Customer Training & Sign Off',
    fields: [
      field({
        id: 'training_given',
        label: 'Has any training been given?',
        type: 'select',
        required: true,
        options: ['Yes', 'Not Required'],
        customerVisible: true,
        source: 'PDF p19 Has any training been given?',
      }),
      field({
        id: 'trained_on',
        label: 'Items the end user has been trained on',
        type: 'multiselect',
        required: true,
        options: TRAINING_ITEMS,
        customerVisible: true,
        showWhen: [{ field: 'training_given', op: 'eq', values: ['Yes'] }],
        source: 'PDF p19 1.0',
      }),
      field({
        id: 'additional_training',
        label: 'Additional training given',
        type: 'textarea',
        customerVisible: true,
        showWhen: [{ field: 'training_given', op: 'eq', values: ['Yes'] }],
        source: 'PDF p19 1.1',
      }),
      field({
        id: 'other_training',
        label: 'Other additional training if required',
        type: 'textarea',
        customerVisible: true,
        showWhen: [{ field: 'training_given', op: 'eq', values: ['Yes'] }],
        source: 'PDF p20 1.2',
      }),
      field({
        id: 'training_not_required',
        label: 'Confirm that training is not required',
        type: 'declaration',
        required: true,
        customerVisible: true,
        showWhen: [{ field: 'training_given', op: 'eq', values: ['Not Required'] }],
        source: 'PDF p20 1.5',
      }),
    ],
    groups: [ACCESS_CONTROL_OM_GROUPS.trainees],
  },
  {
    id: 'handover',
    title: 'Customer sign-off and handover',
    summary: 'Customer, engineer and project manager sign that the access control system is handed over.',
    customerVisible: true,
    source: 'PDF p20–22 System/Camera Handover (access control wording)',
    fields: [
      field({
        id: 'handover_received',
        label: 'I confirm that the access control system has been installed to my satisfaction, the premises have been left tidy, and I have received: 1. security codes, key fobs/cards and keys (as applicable); 2. training in the operation and features of the access control system; 3. a record book (system log book); 4. comprehensive written operating instructions; 5. details of the procedure for summoning assistance if the system malfunctions; 6. 24hr callout numbers put on all access control equipment.',
        type: 'declaration',
        required: true,
        customerVisible: true,
        source: 'PDF p21 handover list 1–6',
      }),
      field({ id: 'client_signature', label: 'Client name and signature', type: 'signature', required: true, customerVisible: true, source: 'PDF p21 Client name and signature' }),
      field({ id: 'client_sign_date', label: 'Client signature date', type: 'date', required: true, customerVisible: true, source: 'PDF p21 Date under client signature' }),
      field({ id: 'engineer_signature', label: 'Engineer name and signature', type: 'signature', required: true, source: 'PDF p21 Engineer name and signature' }),
      field({ id: 'engineer_sign_date', label: 'Engineer signature date', type: 'date', required: true, source: 'PDF p21 Date under engineer signature' }),
      field({ id: 'project_manager_signature', label: 'Project manager name and signature', type: 'signature', required: true, source: 'PDF p21 Project Manager and signature' }),
      field({ id: 'project_manager_sign_date', label: 'Project manager signature date', type: 'date', required: true, source: 'PDF p21 Date under project manager signature' }),
      field({ id: 'handover_datetime', label: 'Handover date', type: 'date', required: true, customerVisible: true, source: 'PDF p21–22 Handover Date and Time' }),
      field({ id: 'handover_time', label: 'Handover time', type: 'text', customerVisible: true, help: 'Include AM or PM as on the source form.', source: 'PDF p22 AM / PM' }),
    ],
  },
];

export const ACCESS_CONTROL_OM_SCHEMA: CompletionTemplateSchema = {
  key: ACCESS_CONTROL_OM_TEMPLATE_KEY,
  version: COMPLETION_TEMPLATE_VERSION,
  title: 'Access control operational checks and handover',
  statusNotice: STATUS_NOTICE,
  sections: SECTIONS,
  reviewFlags: [
    {
      id: 'not_nsi_certificate',
      source: 'PDF p1 NSI Access Control Commissioning and handover',
      wording: 'NSI Access Control Commissioning and handover.',
      reason: 'Company form title only. This record is not an official NSI certificate.',
    },
  ],
};

export function looksLikeOmAccessControlForm(fileName: string, text: string): boolean {
  const hay = `${fileName} ${text}`.toLowerCase();
  if (/operational checks/.test(hay) && /access control/.test(hay)) return true;
  return /customer training/.test(hay)
    && /client name and signature/.test(hay)
    && /controller/.test(hay)
    && /access control/.test(hay);
}

export function accessControlOmSchemaFor(key: string, title?: string): CompletionTemplateSchema {
  return {
    ...structuredClone(ACCESS_CONTROL_OM_SCHEMA),
    key,
    title: title?.trim() || ACCESS_CONTROL_OM_SCHEMA.title,
  };
}

export function isAccessControlSystemType(systemType: string): boolean {
  return /access.?control|\bac\b/i.test(systemType);
}
