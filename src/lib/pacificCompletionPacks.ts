import type { SchemaCatalogue, SchemaField, SchemaSection } from './schemaForm';

export const PACIFIC_PACK_STATUS = 'DRAFT — NOT VALIDATED FOR NSI COMPLIANCE. This company form is not an NSI certificate.';
const WORK_TYPES = ['New installation', 'Takeover', 'Upgrade / extension', 'Maintenance', 'Other'];
const SYSTEM_STATE = ['Operational', 'Limited', 'Not live', 'Fault found'];
const RESULT_CHECK = ['P', 'F', 'NT', 'NA'];

function form(title: string, sections: SchemaSection[]): SchemaCatalogue {
  return { schemaVersion: '1.0.0', status: PACIFIC_PACK_STATUS, title, sections };
}

function section(id: string, title: string, fields: SchemaField[], extras: Partial<SchemaSection> = {}): SchemaSection {
  return {
    id,
    title,
    showWhen: extras.showWhen ?? null,
    repeatable: extras.repeatable ?? false,
    fields,
    note: extras.note,
  };
}

function text(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'text', required };
}
function area(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'textarea', required };
}
function date(id: string, label: string): SchemaField {
  return { id, label, type: 'date' };
}
function select(id: string, label: string, options: string[]): SchemaField {
  return { id, label, type: 'select', options };
}
function check(id: string, label: string): SchemaField {
  return { id, label, type: 'check_result' };
}
function note(id: string, label: string): SchemaField {
  return { id, label, type: 'note' };
}
function signature(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'signature', required };
}

function identityFields(): SchemaField[] {
  return [
    text('customer_organisation', 'Customer organisation', true),
    text('customer_representative', 'Customer representative'),
    area('site_address', 'Site address', true),
    text('simpro_job_number', 'Simpro job number', true),
    text('project_work_title', 'Project / work title'),
    text('engineer_survey_date', 'Engineer / survey date'),
    select('work_type', 'Work type', WORK_TYPES),
    select('system_state_at_visit', 'System state at visit', SYSTEM_STATE),
  ];
}

const CHECK_NOTE = 'Select the result for each applicable check. If a check fails or is not tested, record the reason and action below. Codes: P pass, F fail, NT not tested, NA not applicable.';

export const IA01_COMPLETION = form('IA01 Intruder alarm completion and handover', [
  section('identity', 'JOB AND SYSTEM IDENTITY', identityFields()),
  section('design', 'DESIGN, GRADE AND SIGNALLING', [
    text('alarm_grade', 'Alarm grade / class'),
    text('signalling_category', 'Signalling category / route'),
    text('police_requirement', 'Police / NPCC / Police Scotland requirement'),
    text('design_risk_ref', 'Design / risk assessment reference'),
    area('protected_areas', 'Protected areas, user requirements, setting / unsetting arrangements, exclusions and agreed scope'),
    area('applicable_standards', 'Applicable standards and editions: NCP 120, PD 6662, BS 8243, BS 9263, BS 7671 and product requirements'),
    area('quote_vs_installed', 'Simpro accepted quote baseline and installed versus quoted summary'),
  ]),
  section('as_fitted', 'AS-FITTED OVERVIEW', [
    text('panel_make_model', 'Panel / control equipment make and model'),
    text('panel_location', 'Panel location / asset reference'),
    text('firmware', 'Software / firmware version'),
    text('as_fitted_revision', 'As-fitted record / revision'),
  ]),
  section('devices', 'DETECTION AND DEVICE SCHEDULE', [
    text('zone_device', 'Zone / device'),
    text('location_area', 'Location / area'),
    text('type_make_model', 'Type / make / model'),
    select('wired_wireless', 'Wired / wireless', ['wired', 'wireless', 'NA']),
    text('reading_signal', 'Reading / signal'),
    text('asset_ref', 'Asset / ref'),
  ], {
    repeatable: true,
    note: 'Record actual installed devices and circuit or wireless information. Use Add record for continuation rows. Never enter user or engineer codes in this record.',
  }),
  section('control', 'CONTROL EQUIPMENT AND WARNING DEVICES', [
    area('expanders', 'Expanders / keypads / readers'),
    area('warning_devices', 'Warning devices / locations'),
    text('psu_battery', 'PSU / battery make, model and capacity'),
    text('battery_date', 'Battery date / replacement due'),
    area('interfaces', 'Interfaces: ARC, fire alarm, CCTV, lighting, smoke control, hold-up or other connected equipment'),
    area('quantities_changes', 'Installed quantities, serial references and changes from the accepted quote'),
  ]),
  section('readings_meta', 'ELECTRICAL READINGS AND PROGRAMMED PARAMETERS', [
    text('psu_test_date_engineer', 'Panel / PSU test date and engineer'),
    text('instrument_id', 'Instrument ID / calibration reference'),
  ]),
  section('supplies', '', [
    text('supply_asset', 'Supply / asset'),
    text('charging_vdc', 'Charging V DC'),
    text('standby_ma', 'Standby mA'),
    text('alarm_ma', 'Alarm mA'),
    text('battery_ah', 'Battery Ah / calculation'),
    text('evidence_ref', 'Evidence ref'),
  ], { repeatable: true }),
  section('circuit_readings', '', [
    area('circuit_readings', 'Circuit resistance, tamper resistance, device voltage, wireless strength and test conditions'),
  ]),
  section('settings', 'SETTINGS AND RESPONSE', [
    text('exit_time', 'Exit time (seconds)'),
    text('entry_time', 'Entry time (seconds)'),
    text('sounder_duration', 'Sounder duration / delay'),
    text('confirmation', 'Confirmation method / timing'),
    text('reset_method', 'Reset method'),
    text('fault_tamper', 'Fault / tamper response'),
    text('mains_battery_duty', 'Mains / battery duty required'),
    text('calculated_capacity', 'Calculated / approved capacity'),
    area('battery_calc', 'Battery calculation method, standby period, alarm duration, manufacturer limits and applicable evidence'),
    area('programmed_areas', 'Programmed areas, event types, ARC account / test reference and signalling path notes. Do not enter signalling secrets.'),
  ]),
  section('checks', 'COMMISSIONING AND COMPLIANCE CHECKS', [
    check('grade_match', 'Installed components match the agreed grade and applicable system specification'),
    check('compatibility', 'Detection, control, warning and signalling equipment is compatible and correctly installed'),
    check('cabling', 'Cabling, supports, labels, segregation and electrical supply evidence are complete'),
    check('zones_operate', 'All detection zones and devices operate, identify correctly and restore correctly'),
    check('tampers', 'Device, enclosure, back-tamper and wireless supervision functions are tested where applicable'),
    check('walk_test', 'Walk test covers all circuits and areas; masking is tested where specified or required'),
    check('setting', 'Setting, exit completion, entry, unsetting, reset, inhibit and fault indications operate correctly'),
    check('warning', 'Warning devices operate and final exit tones / indications are satisfactory'),
    check('mains_battery', 'Mains failure, battery operation, supply faults and restoration are verified'),
    check('arc_paths', 'Required ARC signals and transmission paths are triggered, received and acknowledged'),
    check('required_signals', 'Hold-up, confirmation, tamper, fault, set / unset and other required signals are tested'),
    check('grade_wireless', 'Grade-specific and wireless requirements are checked and recorded'),
    check('final_status', 'Final keypad / panel status is normal and test modes or temporary isolations are cleared'),
    check('training_issued', 'User training, logbook, operating instructions and support arrangements are issued'),
  ], { note: CHECK_NOTE }),
  section('findings', 'COMMISSIONING FINDINGS AND TRANSFER EVIDENCE', [
    text('arc_test_ref', 'ARC / monitoring test reference'),
    text('police_status', 'Police / response status'),
    area('failures', 'Failures, deviations, untested items, restricted access and corrective actions'),
  ]),
  section('takeover', 'TAKEOVER AND UPGRADE EVIDENCE', [
    text('existing_provider', 'Existing provider / system age'),
    text('records_available', 'Records / certificate available'),
    area('takeover_condition', 'Takeover condition, compatibility, missing records, protected areas not verified and maintenance transfer actions'),
    area('upgrade_work', 'Upgrade or corrective work: quoted scope, actual work, retained equipment and regression tests'),
  ]),
  section('handover', 'COMPLETION AND HANDOVER', [
    note('handover_note', 'This standalone record covers the stated scope and event. The customer acknowledgement covers receipt and demonstration; it does not certify measurements, resolve a failure or replace the separately issued certificate where applicable.'),
    text('handover_reference', 'Handover reference / revision'),
    text('handover_datetime', 'Handover date / time'),
    select('system_status_handover', 'System status at handover', SYSTEM_STATE),
    select('signalling_status', 'Signalling / monitoring status', ['live', 'pending', 'NA', 'restricted']),
  ]),
  section('documents', 'DOCUMENTS AND TRAINING', [
    text('as_fitted_record', 'As-fitted record'),
    text('zone_drawing', 'Zone / drawing schedule'),
    text('user_instructions', 'User instructions'),
    text('logbook', 'Logbook'),
    text('maintenance_details', 'Maintenance details'),
    text('certificate_separate', 'Certificate recorded separately'),
    text('training_status', 'Training status'),
    text('training_date', 'Training date / attendance record'),
    area('topics', 'Topics demonstrated: setting / unsetting, alarms, faults, hold-up, false alarm prevention, logbook and support'),
    area('keys_fobs', 'Keys, fobs, reset arrangements and operating information handed over. Do not enter codes or passwords in this record.'),
    area('changes_restrictions', 'Changes, restrictions, disconnections, incomplete work and customer agreement details'),
  ]),
  section('signoff', 'SIGN-OFF', [
    note('engineer_decl', 'Engineer: I confirm that the recorded work and test results reflect the stated scope. Any limitations, failures or departures are recorded above.'),
    text('engineer_name', 'Engineer name'),
    date('engineer_datetime', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed record reference'),
    text('reviewer_date', 'Technical reviewer / date'),
    note('customer_decl', "Customer acknowledgement: I confirm receipt of the stated handover information and demonstration for this event. The customer does not certify the engineer's technical measurements or waive an unresolved failure."),
    text('customer_name_role', 'Customer name / authorised role'),
    signature('customer_signature', 'Customer signature / date'),
    note('extra_decl', 'Complete this additional acceptance only when a specific change, restriction, disconnection or incomplete item requires customer agreement.'),
    area('specific_change', 'Specific change or limitation accepted'),
    signature('customer_acceptance_signature', 'Customer acceptance signature / date', false),
    note('nsi_note', 'NCP 120 Issue 1 requires controlled completion evidence, recording of deviations and uncompleted tests, transfer arrangements where maintenance changes, and appropriate customer communication. Use the applicable current standards, police requirements and company procedure. This company form is not an NSI certificate.'),
  ]),
]);

export const CC01_COMPLETION = form('CC01 CCTV completion and handover', [
  section('identity', 'JOB AND SYSTEM IDENTITY', identityFields()),
  section('design', 'DESIGN, RISK AND USER REQUIREMENTS', [
    text('risk_user_req', 'Risk / user requirements reference'),
    text('design_variation', 'Design / variation reference'),
    text('cctv_route', 'CCTV route'),
    text('monitoring_recording', 'Monitoring / recording arrangement'),
    area('purpose', 'Purpose, incidents / threats, areas, camera tasks, target activity and operational hours'),
    area('constraints', 'Lighting, glare, weather, obstructions, network / power / recording constraints and limitations'),
    area('privacy', 'Privacy, audio, signage, masks, access roles, retention / export decisions and approved customer requirements'),
    area('quote_vs_installed', 'Simpro accepted quote baseline and installed versus quoted summary'),
  ]),
  section('cameras', 'CAMERA AND VIEW SCHEDULE', [
    text('camera_location', 'Camera / location'),
    text('make_model_lens', 'Make / model / lens'),
    text('task_target', 'Task / target'),
    text('power_network', 'Power / network'),
    text('day_night_ref', 'Day / night / image ref'),
    select('result', 'Result', RESULT_CHECK),
  ], {
    repeatable: true,
    note: 'Record actual installed cameras and their operational task. Reference images should show representative lighting and the agreed view. Add record for continuation pages.',
  }),
  section('recording', 'RECORDING EQUIPMENT AND INFRASTRUCTURE', [
    text('recorder_vms', 'Recorder / VMS make and model'),
    text('firmware', 'Firmware / software version'),
    text('storage', 'Storage installed / usable'),
    text('retention', 'Required retention / actual result'),
    area('network_poe', 'Network / PoE / switch arrangement'),
    area('ups', 'UPS / power resilience'),
    area('as_fitted_qty', 'As-fitted quantities, serial references, drawings and quote changes'),
    area('coverage_evidence', 'Camera coverage, focus, image task, lighting conditions and reference-image evidence'),
  ]),
  section('checks', 'RECORDING, SECURITY AND SERVICE CHECKS', [
    check('live_view', 'All cameras show the correct location, view and image task in live view'),
    check('day_night', 'Day and night images are usable for the agreed task under representative conditions'),
    check('focus_ptz', 'Focus, field of view, PTZ and motorised functions operate where fitted'),
    check('recording_match', 'All cameras record correctly and the recorded view matches the live view'),
    check('playback_export', 'Search, playback and export work by camera and time using an independent playback method'),
    check('retention_calc', 'Retention is calculated against usable storage and the stated recording settings'),
    check('timestamps', 'System time, time zone, DST / NTP and exported timestamps are correct'),
    check('power_recovery', 'Mains failure, UPS / PoE recovery and recording restoration are verified where specified'),
    check('cabling', 'Network cabling, terminations, segregation and labels are tested and recorded'),
    check('roles_privacy', 'User roles, remote access, privacy masks, audio and account responsibilities are agreed'),
    check('export_custody', 'Recording access, export custody and personal-data handling instructions are issued'),
    check('interfaces', 'Analytics, motion, access-control, intruder, intercom or monitoring interfaces work where included'),
    check('signage', 'CCTV in operation / warning signs and movable-camera warnings are provided where required'),
    text('instrument_ref', 'Test instrument / reference'),
    text('storage_export_ref', 'Storage / export evidence reference'),
    area('expected_actual', 'Expected criteria, actual results, conditions and linked images / test records'),
    area('failures', 'Failed, inaccessible, untested or restricted items and corrective actions'),
  ], { note: CHECK_NOTE }),
  section('takeover', 'TAKEOVER, UPGRADE AND MAINTENANCE RECORD', [
    text('existing_provider', 'Existing provider / system age'),
    text('previous_records', 'Previous records / footage available'),
    text('vms_support', 'VMS / recorder compatibility and support'),
    text('licence_custody', 'Account / licence custody arranged'),
    area('takeover_condition', 'Takeover condition, missing records, inaccessible assets and limits of verification'),
    area('upgrade_work', 'Upgrade or corrective work: quoted scope, actual work, retained equipment and regression tests'),
    select('final_state', 'Final system state', SYSTEM_STATE),
    text('outstanding', 'Outstanding action owner / due date'),
  ]),
  section('training', 'TRAINING AND DOCUMENTS', [
    text('as_fitted_record', 'As-fitted record'),
    text('camera_drawings', 'Camera / drawing schedule'),
    text('user_instructions', 'User instructions'),
    text('export_procedure', 'Export procedure'),
    text('maintenance_details', 'Maintenance details'),
    text('certificate_separate', 'Certificate recorded separately'),
    text('training_status', 'Training status'),
    text('training_date', 'Training date / attendance record'),
    area('topics', 'Topics demonstrated: live view, playback, export, faults, privacy, secure access and support'),
  ]),
  section('handover', 'COMPLETION AND HANDOVER', [
    note('handover_note', 'This standalone record covers the stated scope and event. The customer acknowledgement covers receipt, demonstration, operating information and the stated system condition; it does not certify technical measurements or override a failed test.'),
    text('handover_reference', 'Handover reference / revision'),
    text('handover_datetime', 'Handover date / time'),
    select('system_status_handover', 'System status at handover', SYSTEM_STATE),
    select('monitoring_status', 'Monitoring / recording status', ['live', 'pending', 'NA', 'restricted']),
    area('documents_access', 'Documents, access arrangements and export instructions handed over; changes, restrictions, privacy decisions, disconnections and incomplete work. Do not enter passwords in this record.'),
  ]),
  section('signoff', 'SIGN-OFF', [
    note('engineer_decl', 'Engineer: I confirm that the recorded work and test results reflect the stated scope. Any limitations, failures or departures are recorded above.'),
    text('engineer_name', 'Engineer name'),
    date('engineer_datetime', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed record reference'),
    text('reviewer_date', 'Technical reviewer / date'),
    note('customer_decl', "Customer acknowledgement: I confirm receipt of the stated handover information and demonstration for this event. The customer does not certify the engineer's technical measurements or waive an unresolved failure."),
    text('customer_name_role', 'Customer name / authorised role'),
    signature('customer_signature', 'Customer signature / date'),
    note('extra_decl', 'Complete this additional acceptance only when a specific change, restriction, disconnection or incomplete item requires customer agreement.'),
    area('specific_change', 'Specific change or limitation accepted'),
    signature('customer_acceptance_signature', 'Customer acceptance signature / date', false),
    note('nsi_note', 'Use with the controlled NCP 104 Issue 3 procedure and any applicable BS 8418:2021 route. This company form is not an NSI certificate.'),
  ]),
]);

export const AC01_COMPLETION = form('AC01 Access control completion and handover', [
  section('identity', 'JOB AND SYSTEM IDENTITY', identityFields()),
  section('design', 'DESIGN AND RISK BASIS', [
    text('security_risk_ref', 'Security risk / user requirements reference'),
    text('design_variation', 'Design / variation reference'),
    text('existing_cert', 'Existing system / certification information'),
    area('fire_strategy', 'Fire strategy / responsible person / BS 7273-4 evidence'),
    area('agreed_scope', 'Agreed scope, areas, exclusions and protection objectives'),
    area('quote_vs_installed', 'Simpro accepted quote baseline and installed versus quoted summary'),
  ]),
  section('egress', 'SAFE EGRESS AND DOOR CLASSIFICATION', [
    note('egress_note', 'Assess each access-controlled door individually. Record escape route, fire compartment and occupancy considerations. Do not allow access security to compromise emergency egress.'),
    text('door_population', 'Door population / schedule reference'),
    select('risk_assessment', 'Risk assessment completed', ['yes', 'no', 'NA']),
    select('escape_considered', 'Escape route considered', ['yes', 'no', 'NA']),
    select('fire_strategy_considered', 'Fire strategy considered', ['yes', 'no', 'NA']),
    select('accessibility', 'Visitor / accessibility needs considered', ['yes', 'no', 'NA']),
    select('responsible_consulted', 'Responsible person consulted', ['yes', 'no', 'NA']),
    text('escape_hardware', 'Applicable escape hardware basis'),
    text('design_decision', 'Design decision / evidence reference'),
    area('classification', 'Door classification, egress method, fail-safe / fail-secure rationale and product certification limitations'),
  ]),
  section('doors', 'ACCESS POINT SCHEDULE', [
    text('door_area', 'Door / area'),
    text('purpose_escape', 'Door purpose / escape'),
    text('reader_credential', 'Reader / credential'),
    text('lock_release', 'Lock / release'),
    text('fire_egress_basis', 'Fire / egress basis'),
    text('asset_ref', 'Asset / ref'),
  ], {
    repeatable: true,
    note: 'Record actual installed doors and hardware. Use the result and evidence fields on the following page for functional tests. Add record when the schedule is longer than the rows provided.',
  }),
  section('controller', 'CONTROLLER, READER AND RELEASE OVERVIEW', [
    text('controller_model', 'Controller / panel make and model'),
    text('controller_location', 'Location / asset reference'),
    text('firmware', 'Software / firmware version'),
    text('communications', 'Network / communications method'),
    text('recognition', 'Recognition technology'),
    text('credential_issue', 'Credential type and issue method'),
    area('interfaces', 'Interface details: fire alarm, break-glass, request-to-exit, door-held, intercom, lift or other systems'),
    area('quantities_changes', 'Installed quantities, serial references and differences from the accepted quote'),
  ]),
  section('checks', 'OPERATIONAL AND LIFE-SAFETY CHECKS', [
    check('wiring', 'Wiring is correctly terminated, supported and labelled at equipment and door endpoints'),
    check('readings', 'Voltage and resistance readings are recorded for appropriate points and are within the approved limits'),
    check('credentials', 'Each reader accepts an authorised credential and rejects an unauthorised credential'),
    check('door_align', 'Each controlled door opens, closes, latches and aligns correctly'),
    check('rex', 'Request-to-exit operation releases the door without creating an unsafe condition'),
    check('emergency_release', 'Emergency release / break-glass devices operate and are restored correctly'),
    check('door_held', 'Door-held monitoring and local indication operate where specified'),
    check('fire_release', 'Power failure and fire alarm release operate as designed for the door and fire strategy'),
    check('single_action', 'Escape remains single-action and immediate where BS EN 179 / 1125 / 13637 applies'),
    check('controller_audit', 'Controller, software, time, permissions and audit events operate within the agreed scope'),
    check('standby', 'Standby power operates for the specified duty and recovery after mains restoration is verified'),
    check('interfaces', 'CCTV, intercom, lift, intruder or other interfaces operate end to end where included'),
    text('instrument_ref', 'Test instrument / reference'),
    text('electrical_edition', 'Applicable electrical edition / evidence'),
    area('recorded_readings', 'Recorded readings, expected limits, test conditions and linked evidence'),
    area('failures', 'Failures, inaccessible points, departures, untested items and corrective actions'),
  ], { note: CHECK_NOTE }),
  section('takeover', 'TAKEOVER, UPGRADE AND MAINTENANCE RECORD', [
    text('existing_provider', 'Existing provider / system age'),
    text('previous_records', 'Previous certificate / records available'),
    text('support_licence', 'Compatibility / support / licence position'),
    text('credential_custody', 'Account and credential custody arranged'),
    area('takeover_condition', 'Takeover condition, missing records, inaccessible equipment and limits of verification'),
    area('upgrade_work', 'Upgrade or corrective work: quoted scope, actual work, retained equipment and regression tests'),
    select('final_state', 'Final operational state', SYSTEM_STATE),
    text('outstanding', 'Outstanding action owner / due date'),
  ]),
  section('documents', 'DOCUMENTS AND USER INFORMATION', [
    text('as_fitted_record', 'As-fitted record'),
    text('door_schedule', 'Door schedule / drawings'),
    text('user_instructions', 'User instructions'),
    text('logbook', 'Logbook'),
    text('maintenance_details', 'Maintenance details'),
    text('certificate_separate', 'Certificate recorded separately'),
    text('training_status', 'Training status'),
    text('training_date', 'Training date / attendance record'),
    area('training_topics', 'Training topics, support procedure, emergency release precautions and information supplied'),
  ]),
  section('handover', 'COMPLETION AND HANDOVER', [
    note('handover_note', 'This standalone record covers the stated scope and event. The customer acknowledgement is for receipt and demonstration; technical responsibility remains with the installer and technical reviewer.'),
    text('handover_reference', 'Handover reference / revision'),
    text('handover_datetime', 'Handover date / time'),
    select('system_status_handover', 'System status at handover', SYSTEM_STATE),
    select('support_status', 'Monitoring / support status', ['live', 'pending', 'NA', 'restricted']),
    area('documents_keys', 'Documents, keys, credentials and instructions handed over; changes, restrictions, disconnections, incomplete work and customer agreement details. Do not enter passwords or PINs in this record.'),
  ]),
  section('signoff', 'SIGN-OFF', [
    note('engineer_decl', 'Engineer: I confirm that the recorded work and test results reflect the stated scope. Any limitations, failures or departures are recorded above.'),
    text('engineer_name', 'Engineer name'),
    date('engineer_datetime', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed record reference'),
    text('reviewer_date', 'Technical reviewer / date'),
    note('customer_decl', "Customer acknowledgement: I confirm receipt of the stated handover information and demonstration for this event. The customer does not certify the engineer's technical measurements or waive an unresolved failure."),
    text('customer_name_role', 'Customer name / authorised role'),
    signature('customer_signature', 'Customer signature / date'),
    note('extra_decl', 'Complete this additional acceptance only when a specific change, restriction, disconnection or incomplete item requires customer agreement.'),
    area('specific_change', 'Specific change or limitation accepted'),
    signature('customer_acceptance_signature', 'Customer acceptance signature / date', false),
    note('nsi_note', 'Use with the controlled NCP 109 Issue 4 procedure, fire strategy, BS 7273-4 and building requirements. This company form is not an NSI certificate.'),
  ]),
]);

export interface PacificCompletionForm {
  key: string;
  code: string;
  name: string;
  description: string;
  schema: SchemaCatalogue;
  documentId: string;
  typeKey: string;
  iconKey: string;
  required?: boolean;
  displayOrder: number;
}

export const PACIFIC_COMPLETION_FORMS: PacificCompletionForm[] = [
  {
    key: 'ia01_completion',
    code: 'IA01',
    name: 'IA01 Intruder alarm completion and handover',
    description: 'One standalone NCP 120 record. Engineer and customer sign on this sheet only.',
    schema: IA01_COMPLETION,
    documentId: 'ia01_completion',
    typeKey: 'intruder_alarm',
    iconKey: 'clipboard',
    required: true,
    displayOrder: 20,
  },
  {
    key: 'cc01_completion',
    code: 'CC01',
    name: 'CC01 CCTV completion and handover',
    description: 'One standalone NCP 104 record. Engineer and customer sign on this sheet only.',
    schema: CC01_COMPLETION,
    documentId: 'cc01_completion',
    typeKey: 'cctv',
    iconKey: 'clipboard',
    required: true,
    displayOrder: 20,
  },
  {
    key: 'ac01_completion',
    code: 'AC01',
    name: 'AC01 Access control completion and handover',
    description: 'One standalone NCP 109 record. Engineer and customer sign on this sheet only.',
    schema: AC01_COMPLETION,
    documentId: 'ac01_completion',
    typeKey: 'access_control',
    iconKey: 'clipboard',
    required: true,
    displayOrder: 20,
  },
];

const SCHEMA_BY_KEY: Record<string, SchemaCatalogue> = Object.fromEntries(
  PACIFIC_COMPLETION_FORMS.map(item => [item.key, item.schema]),
);

const ALIASES: Record<string, string> = {
  ia01_as_fitted: 'ia01_completion',
  ia07_handover: 'ia01_completion',
  intruder_alarm_master: 'ia01_completion',
  cv01_as_fitted: 'cc01_completion',
  cv08_handover: 'cc01_completion',
  handover_cctv: 'cc01_completion',
  handover_ac: 'ac01_completion',
};

export function resolvePacificCompletionKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (SCHEMA_BY_KEY[key]) return key;
  return ALIASES[key] ?? null;
}

export function getPacificCompletionSchema(key: string | null | undefined): SchemaCatalogue | null {
  const resolved = resolvePacificCompletionKey(key);
  return resolved ? SCHEMA_BY_KEY[resolved] : null;
}

export function isPacificCompletionKey(key: string | null | undefined): boolean {
  return Boolean(resolvePacificCompletionKey(key));
}

export function pacificCompletionTemplateList(): Array<{ key: string; name: string; description: string; fields: [] }> {
  return PACIFIC_COMPLETION_FORMS.map(item => ({
    key: item.key,
    name: item.name,
    description: item.description,
    fields: [],
  }));
}
