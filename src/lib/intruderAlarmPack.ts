import type { SchemaCatalogue, SchemaField, SchemaSection, SchemaShowWhen } from './schemaForm';

export const INTRUDER_PACK_STATUS = 'DRAFT — NOT VALIDATED FOR NSI COMPLIANCE';
export const INTRUDER_PACK_REVISION = '01';

function form(title: string, sections: SchemaSection[]): SchemaCatalogue {
  return {
    schemaVersion: '1.0.0',
    status: INTRUDER_PACK_STATUS,
    title,
    sections,
  };
}

function section(id: string, title: string, fields: SchemaField[], extras: Partial<SchemaSection> = {}): SchemaSection {
  return {
    id,
    title,
    showWhen: extras.showWhen ?? null,
    repeatable: extras.repeatable ?? false,
    fields,
  };
}

function text(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'text', required };
}

function area(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'textarea', required };
}

function date(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'date', required };
}

function select(id: string, label: string, options: string[], required = false): SchemaField {
  return { id, label, type: 'select', options, required };
}

function check(id: string, label: string, required = true): SchemaField[] {
  return [
    { id, label, type: 'test_result', required },
    { id: `${id}_ref`, label: `${label} — reference`, type: 'text' },
  ];
}

function signature(id: string, label: string, required = true): SchemaField {
  return { id, label, type: 'signature', required };
}

function header(): SchemaSection {
  return section('header', 'Job identity', [
    text('site_building', 'Site / building', true),
    text('job_system_ref', 'Job / system ref', true),
  ]);
}

function engineerSignOff(title: string, declaration: string): SchemaSection {
  return section('engineer_signoff', title, [
    area('declaration', declaration),
    signature('engineer_signature', 'Engineer name and signature', true),
    date('signed_at', 'Date', true),
  ]);
}

function reviewerSignOff(title = 'Technical reviewer sign-off'): SchemaSection {
  return section('reviewer_signoff', title, [
    area('review_notes', 'Review notes, conditions and standards register reference'),
    signature('reviewer_signature', 'Technical reviewer name and signature', true),
    date('reviewed_at', 'Review date', true),
  ]);
}

function whenField(sectionId: string, field: string, values: string[]): SchemaShowWhen {
  return { fieldEquals: { section: sectionId, field, values } };
}

function whenChecked(sectionId: string, field: string): SchemaShowWhen {
  return { checkboxTrue: { section: sectionId, field } };
}

export const IA01_AS_FITTED = form('IA01 As-fitted system record and equipment schedule', [
  header(),
  section('customer', 'Customer and premises', [
    text('customer_organisation', 'Customer organisation', true),
    text('customer_representative', 'Customer representative'),
    area('installation_address', 'Installation address (site address, not billing)', true),
    text('simpro_job_id', 'Simpro company / job ID'),
    text('quote_id', 'Quote ID / baseline snapshot'),
    text('as_fitted_reference', 'As-fitted reference / revision', true),
    date('final_verification_date', 'Date of final verification', true),
  ]),
  section('basis', 'Work and design basis', [
    select('work_type', 'Work type', ['new_installation', 'takeover', 'upgrade', 'extension'], true),
    text('design_risk_reference', 'Design / risk assessment reference'),
    text('existing_stated_grade', 'Existing stated grade / unknown'),
    text('verified_grade', 'Verified grade / evidence reference'),
    area('applicable_standards', 'Applicable standards, editions, amendments and environmental classifications', true),
    area('agreed_scope', 'Agreed scope, protected areas, exclusions and source quote sections', true),
    area('quote_note', 'Quote / quantity note', false),
  ]),
  section('devices', 'Device schedule', [
    text('schedule_reference', 'Schedule reference / continuation number'),
    text('linked_quote', 'Linked quote / agreed variation'),
    area('firmware_drawing_refs', 'Firmware, connection type, serial-number schedule or drawing references'),
  ], { repeatable: false }),
  section('device_rows', 'Installed equipment and zone schedule', [
    text('asset_zone', 'Asset / zone', true),
    text('location', 'Location / area', true),
    text('type_make_model', 'Type / make / model', true),
    text('grade_class', 'Grade / class'),
    text('qty_serial', 'Actual qty / serial ref', true),
    text('quoted_qty', 'Quoted qty (baseline only — not installed proof)'),
    area('notes', 'Notes / old equipment removed or replaced'),
  ], { repeatable: true }),
  section('arrangements', 'Actual system arrangements', [
    text('panel_model', 'Panel / control equipment model', true),
    text('panel_location', 'Panel location / asset reference', true),
    area('setting_unsetting', 'Areas / partitions, setting and unsetting methods, entry / exit routes', true),
    area('confirmation_monitoring', 'Alarm confirmation, monitoring, hold-up and interface arrangements'),
    text('power_record_ref', 'Power / battery record reference (IA02)'),
    text('signalling_record_ref', 'Signalling record reference (IA04)'),
    area('drawing_refs', 'Drawing / zone plan references and revisions; user-manual references'),
    area('changes_limitations', 'Changes from quote / design and limitations (link IA05)'),
  ]),
  engineerSignOff(
    'Engineer verification',
    'I confirm this record describes the installed system within the recorded scope. Unknown and unverified items are identified. A quote is a proposed baseline only; quoted quantity is not installed proof. Customer acceptance of changes is recorded separately on IA05/IA07.',
  ),
]);

export const IA02_READINGS = form('IA02 Parameters and electrical readings', [
  header(),
  section('meta', 'Test identity', [
    date('test_date', 'Test date', true),
    text('engineer_name', 'Engineer', true),
    text('instrument_id', 'Instrument ID / verification reference'),
    area('method_note', 'Use the approved procedure and applicable acceptance limits. Record actual readings. Do not use a tick as a substitute for a reading.'),
  ]),
  section('detection', 'Detection and interconnection record', [
    text('zone_asset', 'Zone / asset', true),
    text('device_type_location', 'Device type / location', true),
    text('resistance_ohm', 'Resistance (ohm)'),
    text('device_volts_dc', 'Device volts DC'),
    text('coverage_range', 'Coverage / range'),
    area('wireless_readings', 'Wireless readings / units / limits, test conditions and evidence'),
    area('exceptions', 'Exceptions and linked issue / retest references'),
  ], { repeatable: true }),
  section('supply', 'Supply readings (one sheet per supply)', [
    text('psu_asset', 'Panel / PSU asset ID and location', true),
    text('make_model_supply', 'Make / model / supply type'),
    text('charging_voltage', 'Charging voltage (V DC)'),
    text('standby_current', 'Standby current (mA)'),
    text('alarm_current', 'Alarm current (mA)'),
    text('battery_only_current', 'Battery-only current (mA)'),
    text('battery_test_voltage', 'Battery test voltage (V DC)'),
    text('battery_make_model_date', 'Battery make / model / date'),
    text('battery_qty_arrangement', 'Quantity / connection arrangement'),
    text('rated_capacity_ah', 'Individual rated capacity (Ah)'),
    text('required_capacity_ah', 'Required capacity (Ah)'),
    text('standby_hours', 'Required standby period (hours)'),
    text('alarm_minutes', 'Alarm duration used (minutes)'),
    area('calculation', 'Calculation method, applicable clause, derating / recharge assumptions and evidence ref', true),
    ...check('capacity_adequate', 'Calculated capacity adequate for applicable duty'),
    ...check('mains_battery_faults', 'Mains failure / restoration and battery / supply faults verified'),
    area('instrument_conditions', 'Instrument / conditions, issues / retest references'),
  ]),
  section('warning', 'Warning devices', [
    text('asset_location', 'Asset / location', true),
    text('power_type', 'Power type'),
    text('input_vdc', 'Input V DC'),
    text('standby_alarm_ma', 'Standby / alarm mA'),
    text('charge_check_ref', 'Charge check / ref'),
  ], { repeatable: true }),
  section('settings', 'Programmed and verified settings', [
    text('entry_time', 'Entry time (seconds)'),
    text('exit_time', 'Exit time (seconds)'),
    text('confirmation_time', 'Confirmation time / units'),
    text('sounder_duration', 'Sounder duration (minutes)'),
    text('sounder_delay', 'Sounder delay (minutes)'),
    select('hold_up_warning', 'Hold-up local warning', ['silent', 'audible', 'not_fitted']),
    select('unconfirmed_reset', 'Unconfirmed reset', ['user', 'engineer', 'not_applicable']),
    select('confirmed_reset', 'Confirmed reset', ['user', 'engineer', 'not_applicable']),
    text('setting_reset_procedure', 'Setting / reset procedure reference'),
    area('settings_by_area', 'Settings by area, acceptance limits, exceptions and evidence refs'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm these readings and settings were taken under the recorded conditions and that omitted measurements are identified with reasons. Technical measurements are the engineer’s and company’s responsibility.',
  ),
]);

export const IA03_COMMISSIONING = form('IA03 Commissioning and verification checks', [
  header(),
  section('meta', 'Test identity', [
    text('engineer_name', 'Engineer', true),
    date('test_date', 'Test date', true),
    text('procedure_revision', 'Approved procedure / revision'),
    text('grade_profile', 'Applicable grade / standard profile'),
    text('as_fitted_revision', 'As-fitted record revision'),
  ]),
  section('installation', 'Installation and operation', [
    ...check('scope_reconciled', 'Installed scope reconciled with agreed design and as-fitted record'),
    ...check('compatibility', 'Equipment compatibility, grading and environment verified'),
    ...check('cabling', 'Cabling, supports, segregation and relevant electrical evidence'),
    ...check('detection_tested', 'All applicable detection devices and coverage tested'),
    ...check('tampers', 'Applicable device, enclosure and removal tampers tested'),
    ...check('setting_unsetting', 'Full / part setting, exit completion and unsetting verified'),
    ...check('entry_exit', 'Entry / exit indications and routes verified'),
    ...check('faults_isolations', 'Fault indications, inhibit / isolation and restoration verified'),
    ...check('warning_devices', 'Warning devices and alternate-power operation verified'),
    ...check('power_on_ia02', 'Power readings, standby duty and failure tests recorded on IA02'),
    area('failures_exclusions', 'Failures, exclusions, untested items and evidence / issue references'),
  ]),
  section('remaining', 'Remaining applicable tests', [
    ...check('hold_up', 'Hold-up devices and configured response tested'),
    ...check('confirmation', 'Confirmation method and timing verified'),
    ...check('arc_signals', 'Required ARC signals and each transmission path tested (IA04)'),
    ...check('wireless', 'Wireless supervision, radio performance and battery faults tested'),
    ...check('interfaces', 'Interfaces tested end to end with authorised parties'),
    ...check('remote_app', 'Remote / app operation and access responsibilities verified'),
    ...check('regression', 'Affected retained equipment retested following changes'),
    ...check('datetime_events', 'Correct date / time and applicable event records verified'),
    ...check('test_modes_cleared', 'Test modes cleared; final status and residual isolations recorded'),
    area('detailed_results', 'Detailed test records, expected / actual results and supporting attachments'),
    select('final_state', 'Final state', ['normal', 'restricted', 'faulty'], true),
    area('outstanding_issues', 'Outstanding issue references'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm the results reflect the work and tests performed within the stated scope. This checklist must be used with the approved detailed procedures and applicable standards. Commissioning tests are the engineer’s and company’s responsibility.',
  ),
]);

export const IA04_ARC = form('IA04 ARC signalling and response verification', [
  header(),
  section('connection', 'Connection', [
    text('arc_contact', 'ARC / contact', true),
    text('monitoring_account', 'Monitoring account reference'),
    text('transmitter_model', 'Transmitter model / asset'),
    text('transmission_category', 'Transmission category / paths'),
    text('engineer_name', 'Engineer'),
    date('test_date', 'Date', true),
    text('arc_booking', 'ARC test booking / operator reference'),
  ]),
  section('signals', 'Required signals', [
    text('signal_trigger', 'Signal / trigger', true),
    text('sent_time', 'Sent time'),
    text('received_time', 'Received time'),
    text('arc_ack', 'ARC acknowledgement'),
    { id: 'result', label: 'Result', type: 'test_result', required: true },
    text('result_ref', 'Reference'),
  ], { repeatable: true }),
  section('missing', 'Missing signals', [
    area('missing_retest', 'Missing signals, retest and linked issues'),
  ]),
  section('paths', 'Each transmission path', [
    text('path_provider', 'Path / provider', true),
    text('failure_restore', 'Failure / restore trigger'),
    text('time_limit', 'Time / expected limit'),
    area('actual_result', 'Actual result / ARC ref'),
  ], { repeatable: true }),
  section('response', 'Response and live service', [
    area('confirmation_evidence', 'Confirmation method / evidence'),
    text('police_force_policy', 'Police force / policy edition'),
    select('response_status', 'Response', ['active', 'pending', 'suspended', 'not_applicable'], true),
    text('urn_restricted_ref', 'URN / restricted record reference'),
    select('final_monitoring_state', 'Final monitoring state', ['live', 'pending', 'not_applicable', 'suspended'], true),
    text('test_mode_ended', 'Test mode ended: time / ARC ref'),
    area('outstanding_actions', 'Outstanding activation actions, owner, due date and customer notification'),
    area('restricted_note', 'Keep keyholder personal details and signalling secrets in the authorised restricted record. A successful signal test alone does not prove police response has been granted.'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm the signalling tests recorded above. Signalling tests and compatibility with the ARC are the engineer’s and company’s responsibility.',
  ),
]);

export const IA05_CHANGES = form('IA05 Changes, defects and remedial actions', [
  header(),
  section('issue', 'Issue / change', [
    text('issue_reference', 'Issue / change reference', true),
    date('raised_date', 'Date'),
    text('raised_by', 'Raised by'),
    select('issue_type', 'Type', [
      'design_change',
      'defect',
      'disconnected_or_reduced_protection',
      'limitation_or_incomplete_test',
      'other',
    ], true),
    select('status', 'Status', ['open', 'action', 'retest', 'closed'], true),
    area('description', 'Description, affected assets and quoted versus installed quantities / scope', true),
    area('operational_effect', 'Operational effect and applicable design / standards reference'),
    area('required_action', 'Required action and temporary protection / isolations', true),
    text('responsible_person', 'Responsible person'),
    date('due_date', 'Due date'),
    text('customer_notified', 'Customer notified / date'),
    area('technical_disposition', 'Technical disposition and closure / retest evidence'),
    area('note', 'Customer acknowledgement does not establish technical compliance or close a failed test. Preserve the original issue and record the corrective action and retest.'),
  ]),
  reviewerSignOff(),
  section('customer_acceptance', 'Customer acceptance of limitation or change', [
    area('acceptance_scope', 'Customer is asked to accept: changes from the agreed design, equipment left disconnected or protection reduced, and/or other limitations or incomplete tests.', true),
    signature('customer_signature', 'Customer name and signature', true),
    date('customer_signed_at', 'Date', true),
  ], {
    showWhen: whenField('issue', 'issue_type', [
      'design_change',
      'disconnected_or_reduced_protection',
      'limitation_or_incomplete_test',
    ]),
  }),
]);

export const IA06_TRAINING = form('IA06 Customer demonstration and training', [
  header(),
  section('session', 'Training session', [
    text('trainee_name_role', 'Trainee name / role', true),
    text('trainer_name', 'Trainer', true),
    date('training_date', 'Date', true),
  ]),
  section('topics', 'Topics demonstrated or explained', [
    text('topic', 'Topic', true),
    select('status', 'Status', ['done', 'outstanding', 'not_applicable'], true),
    area('notes', 'Notes / instruction reference'),
  ], { repeatable: true }),
  section('follow_up', 'Outstanding training', [
    area('outstanding_training', 'Outstanding training and user instructions supplied (reference / revision)'),
    area('note', 'Customer acknowledgement of the demonstration and training is recorded once on IA07. This sheet is the engineer/trainer record.'),
  ]),
  engineerSignOff(
    'Trainer / engineer record',
    'I confirm the instruction recorded above was given. Outstanding topics and limitations are identified in this record.',
  ),
]);

export const IA07_HANDOVER = form('IA07 Completion and handover acceptance', [
  header(),
  section('handover', 'Handover identity', [
    text('customer_name_role', 'Customer name / authorised role', true),
    date('commissioning_date', 'Commissioning date', true),
    text('as_fitted_reference', 'As-fitted reference / revision', true),
    text('completion_scope', 'Completion scope / work type', true),
    select('system_state', 'System state', ['operational', 'limited', 'not_live'], true),
    select('signalling_state', 'Signalling state', ['live', 'pending', 'not_applicable'], true),
    area('outstanding_work', 'Outstanding work, variations, limitations and document references'),
  ]),
  section('receipt', 'Items received and demonstrated', [
    ...check('demonstration_training', 'Operation demonstrated and user instruction provided (IA06)'),
    ...check('credentials', 'Operating fobs / keys / credentials transferred securely'),
    ...check('user_information', 'Complete user operating information supplied'),
    ...check('logbook_maintenance', 'System logbook and maintenance / emergency contacts supplied'),
    ...check('as_fitted_docs', 'Referenced as-fitted record and handover documents identified'),
    ...check('operating_status', 'System’s stated operating and monitoring status explained'),
  ]),
  section('customer_acceptance', 'Customer acknowledgement', [
    area(
      'acknowledgement_text',
      'The customer acknowledges the demonstration and training recorded, receipt of instructions, logbook and maintenance information, the referenced as-fitted record and handover documents, and the system’s stated operating and monitoring status.',
    ),
    signature('customer_signature', 'Customer name and signature', true),
    date('customer_signed_at', 'Date', true),
  ]),
  section('installer_declaration', 'Installer declaration', [
    area(
      'installer_text',
      'This record accurately describes the handover within the stated scope. The separate NSI Certificate of Compliance, if issued, is recorded in the O&M index. This form is not that certificate.',
    ),
    signature('installer_signature', 'Installer name and signature', true),
    date('installer_signed_at', 'Date', true),
  ]),
]);

export const IA08_LOG = form('IA08 System history and event log', [
  header(),
  section('log_meta', 'Log identity', [
    text('maintainer_telephone', 'Maintainer / service telephone'),
    text('log_reference', 'Log reference / continuation number'),
    area('instruction', 'Record activations, faults, maintenance, repairs and alterations. Include the person recording the event and the linked work sheet. Do not write access codes in this log.'),
  ]),
  section('events', 'Events and visits', [
    text('event_datetime', 'Date / time', true),
    area('event_area', 'Event / affected area', true),
    text('action_ref', 'Action / report reference'),
    text('recorded_by', 'Recorded by', true),
  ], { repeatable: true }),
  section('open', 'Current unresolved items', [
    area('unresolved', 'Current unresolved items / next action'),
  ]),
]);

export const IA09_SUPPORT = form('IA09 Maintenance and support information', [
  header(),
  section('service', 'Service arrangements', [
    text('maintenance_provider', 'Maintenance provider', true),
    text('agreement_ref', 'Agreement reference / effective date'),
    text('service_telephone', 'Service telephone', true),
    text('emergency_telephone', 'Emergency / out-of-hours telephone'),
    text('support_email', 'Support email'),
    text('monitoring_provider', 'Monitoring provider / support reference'),
    text('visit_frequency', 'Visit frequency / method'),
    date('first_service_due', 'First planned service due'),
    area('coverage', 'Coverage, attendance arrangements, exclusions and agreement attachment'),
  ]),
  section('documents', 'User documents and warranty', [
    text('user_manual_ref', 'User manual reference / revision'),
    text('quick_guide_logbook', 'Quick guide / logbook reference'),
    area('warranty', 'Warranty period, start date, scope and provider'),
    area('user_checks', 'User checks and false-alarm guidance reference'),
    area('advice', 'Keep routes clear and follow the supplied operating instructions. Report faults promptly and record activations in the logbook. Arrange changes through the maintainer.'),
  ]),
  engineerSignOff(
    'Issued by',
    'I confirm this support information was issued with the handover pack. Customer receipt of this information is acknowledged on IA07.',
  ),
]);

export const IA10_RELEASE = form('IA10 O&M document index and technical release', [
  header(),
  section('pack', 'Pack identity', [
    text('pack_reference', 'Pack reference / revision', true),
    text('reviewer_name', 'Reviewer'),
    date('review_date', 'Review date'),
  ]),
  section('manifest', 'Document manifest', [
    text('document_name', 'Document / attachment', true),
    text('reference_revision', 'Reference / revision'),
    select('presence', 'Present / pending / NA', ['present', 'pending', 'not_applicable'], true),
  ], { repeatable: true }),
  section('release', 'Release', [
    area('missing', 'Missing documents, technical blockers and responsible person / due date'),
    select('release_type', 'Release', ['return', 'interim', 'final'], true),
    text('exception_ref', 'Signed acceptance / exception reference'),
    area('note', 'Final release requires the company technical review and applicable evidence. An interim pack must identify its limitations. Attach the official issued certificate; this index is not a substitute certificate.'),
  ]),
  reviewerSignOff('Technical release'),
]);

export const IA11_TAKEOVER = form('IA11 Takeover survey and condition record', [
  header(),
  section('survey', 'Survey', [
    text('survey_engineer', 'Survey engineer', true),
    date('survey_date', 'Date', true),
    text('previous_provider', 'Previous provider / unknown'),
    text('existing_stated_grade', 'Existing stated grade / evidence'),
    text('verified_grade', 'Verified grade / not verified'),
  ]),
  section('records', 'Records and equipment', [
    area('existing_records', 'Existing certificate, drawings, zone list, manuals and service history references'),
    area('missing_records', 'Missing records and actions to establish current as-fitted information'),
    area('retained_equipment', 'Retained panel, signalling and equipment; compatibility / supportability'),
    area('inherited_faults', 'Inherited faults, inaccessible devices, unverified areas and limitations'),
    area('scope_inspected', 'Scope / areas inspected'),
    text('linked_records', 'Linked test and issue records'),
  ]),
  section('verification', 'Takeover verification', [
    select('engineering_access', 'Engineering access', ['available', 'partial', 'none'], true),
    text('remote_owner', 'Remote / cloud access owner'),
    area('cloud_transfer', 'Service-mode / cloud transfer process, timescale and charge basis'),
    area('testing_performed', 'Testing performed, exclusions, actual condition and supporting records'),
    area('remedial_scope', 'Remedial scope, temporary arrangements and customer notification'),
    text('transfer_ref', 'Monitoring / maintenance transfer ref (IA13)'),
    date('responsibility_starts', 'Incoming responsibility starts'),
    select('decision', 'Decision', ['proceed', 'conditional', 'remediate'], true),
    area('note', 'Existing paperwork and equipment markings are evidence to assess, not automatic confirmation of system compliance.'),
  ]),
  engineerSignOff(
    'Survey engineer sign-off',
    'I confirm the basis and limits of the takeover decision recorded above.',
  ),
  section('customer_acceptance', 'Customer acceptance of takeover limitations', [
    area('acceptance_scope', 'Customer agreement is required because the takeover is conditional, protection is reduced, or limitations / incomplete tests remain.', true),
    signature('customer_signature', 'Customer name and signature', true),
    date('customer_signed_at', 'Date', true),
  ], { showWhen: whenField('verification', 'decision', ['conditional', 'remediate']) }),
]);

export const IA12_UPGRADE = form('IA12 Upgrade and extension record', [
  header(),
  section('work', 'Work', [
    text('quote_variation', 'Quote / variation / agreed baseline', true),
    date('work_date', 'Work date', true),
    text('engineer_name', 'Engineer', true),
    area('reason_scope', 'Reason, agreed work and pre-work system record reference', true),
    { id: 'customer_acceptance_required', label: 'Changes from agreed design, disconnected equipment or incomplete tests need customer agreement', type: 'checkbox' },
  ]),
  section('scope', 'Scope reconciliation', [
    text('action_status', 'Action / status', true),
    text('equipment_location', 'Equipment / location / source line', true),
    text('quoted_qty', 'Quoted qty'),
    text('actual_qty', 'Actual qty', true),
  ], { repeatable: true }),
  section('effect', 'Compatibility and retesting', [
    area('compatibility', 'Compatibility and effect on grade, standby duty, signalling and operation'),
    area('regression', 'Affected existing devices / interfaces and regression test references'),
    text('updated_as_fitted', 'Updated as-fitted revision'),
    text('issue_refs', 'Issues / IA05 references'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm the upgrade/extension work and retesting recorded above. Compatibility assessments are the engineer’s and company’s responsibility.',
  ),
  reviewerSignOff(),
  section('customer_acceptance', 'Customer acceptance of design change or limitation', [
    area('acceptance_scope', 'Customer agreement is required for changes from the agreed design, equipment left disconnected or protection reduced, or incomplete tests.', true),
    signature('customer_signature', 'Customer name and signature', true),
    date('customer_signed_at', 'Date', true),
  ], { showWhen: whenChecked('work', 'customer_acceptance_required') }),
]);

export const IA13_TRANSFER = form('IA13 Maintenance and monitoring transfer', [
  header(),
  section('parties', 'Transfer parties', [
    text('outgoing_provider', 'Outgoing provider'),
    text('incoming_provider', 'Incoming provider', true),
    date('effective_date', 'Transfer effective date', true),
    text('customer_authority_ref', 'Customer authority reference'),
    { id: 'customer_acceptance_required', label: 'Service interruption, reduced protection or incomplete tests need customer agreement', type: 'checkbox' },
  ]),
  section('boundary', 'Responsibilities', [
    area('responsibility_boundary', 'Responsibility boundary, services transferred and contract references', true),
    area('cloud_access', 'Service-mode and cloud-access arrangements, timescale and pricing basis'),
    text('credential_transfer_ref', 'Records / credential transfer receipt ref'),
    text('prior_remote_review', 'Prior remote access reviewed by / date'),
    text('arc_transfer_ref', 'ARC / signalling transfer reference'),
    text('police_urn_action', 'Police / URN action reference or NA'),
    area('interruption', 'Service interruption / temporary protection and customer notification'),
    area('verification', 'Verification tests, final live state and unresolved actions / owner / due date'),
  ]),
  engineerSignOff(
    'Incoming engineer sign-off',
    'I confirm the transfer arrangements and verification tests recorded above.',
  ),
  section('customer_acceptance', 'Customer acceptance of interruption or limitation', [
    area('acceptance_scope', 'Customer agreement is required because of a service interruption, reduced protection, or other limitation during transfer.', true),
    signature('customer_signature', 'Customer name and signature', true),
    date('customer_signed_at', 'Date', true),
  ], { showWhen: whenChecked('parties', 'customer_acceptance_required') }),
]);

export const IA14_MAINTENANCE = form('IA14 Maintenance and corrective work record', [
  header(),
  section('visit', 'Visit', [
    select('visit_type', 'Visit', ['preventive', 'corrective', 'remote'], true),
    text('engineer_name', 'Engineer', true),
    date('visit_date', 'Date', true),
    text('arrival', 'Arrival'),
    text('departure', 'Departure'),
    text('work_order', 'Agreement / work-order reference'),
    select('state_on_arrival', 'System state on arrival', ['normal', 'fault', 'isolated', 'alarm', 'not_checked', 'not_applicable'], true),
  ]),
  section('checks', 'Applicable checks and results', [
    ...check('as_fitted_available', 'As-fitted information available and changes identified'),
    ...check('coverage', 'Device siting, coverage and detection performance checked'),
    ...check('warning_tampers', 'Warning devices and applicable tamper / power functions checked'),
    ...check('supply', 'Supply condition, readings and standby duty assessed'),
    ...check('signals', 'Required signals, confirmation and each path checked to ARC'),
    ...check('operation_timings', 'Operation, exit indication and configured timings checked'),
    ...check('logbook_updated', 'System logbook and maintenance record updated'),
    area('reported_problem', 'Reported problem, customer consultation and test limitations'),
  ]),
  section('work', 'Work completed and final state', [
    area('diagnosis', 'Diagnosis and corrective work carried out'),
  ]),
  section('parts', 'Parts replaced or modified', [
    text('part', 'Part replaced / modified'),
    text('asset_location', 'Asset / location'),
    text('retest_result', 'Functional retest / result'),
  ], { repeatable: true }),
  section('close', 'Close-out', [
    area('outstanding', 'Outstanding faults / untested items and follow-up'),
    select('final_state', 'Final system state', ['normal', 'restricted', 'faulty', 'isolated'], true),
    text('isolations_restored', 'Test mode / isolations restored or ref'),
    text('next_action', 'Next action owner / due date'),
    text('arc_ack', 'ARC final service acknowledgement'),
    area('note', 'Replacement and modified equipment must be tested to the extent necessary for the affected system. Routine customer signature is not required on this visit record.'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm this is an accurate record of attendance, work and system condition.',
  ),
]);

export interface IntruderPackForm {
  key: string;
  code: string;
  name: string;
  description: string;
  schema: SchemaCatalogue;
  documentId: string;
  iconKey: string;
  required?: boolean;
  displayOrder: number;
}

export const INTRUDER_PACK_FORMS: IntruderPackForm[] = [
  { key: 'ia01_as_fitted', code: 'IA01', name: 'IA01 As-fitted system record', description: 'Installed equipment schedule. Engineer verification. Quoted qty is not installed proof.', schema: IA01_AS_FITTED, documentId: 'ia01_as_fitted', iconKey: 'file', required: true, displayOrder: 10 },
  { key: 'ia02_readings', code: 'IA02', name: 'IA02 Parameters and electrical readings', description: 'Device, supply and settings readings. Engineer sign-off only.', schema: IA02_READINGS, documentId: 'ia02_readings', iconKey: 'clipboard', displayOrder: 20 },
  { key: 'ia03_commissioning', code: 'IA03', name: 'IA03 Commissioning and verification', description: 'Commissioning checks and tests. Engineer sign-off only.', schema: IA03_COMMISSIONING, documentId: 'ia03_commissioning', iconKey: 'clipboard', displayOrder: 30 },
  { key: 'ia04_arc', code: 'IA04', name: 'IA04 ARC signalling verification', description: 'End-to-end signalling tests. Engineer sign-off only.', schema: IA04_ARC, documentId: 'ia04_arc', iconKey: 'clipboard', displayOrder: 40 },
  { key: 'ia05_changes', code: 'IA05', name: 'IA05 Changes and remedial actions', description: 'Design changes, defects and limitations. Customer signs only if a change or limitation needs agreement.', schema: IA05_CHANGES, documentId: 'ia05_changes', iconKey: 'file', displayOrder: 50 },
  { key: 'ia06_training', code: 'IA06', name: 'IA06 Customer demonstration and training', description: 'Trainer record of demonstration. Customer acknowledgement is on IA07.', schema: IA06_TRAINING, documentId: 'ia06_training', iconKey: 'graduation', displayOrder: 60 },
  { key: 'ia07_handover', code: 'IA07', name: 'IA07 Completion and handover acceptance', description: 'The routine customer signature. Acknowledges demonstration, documents and operating status.', schema: IA07_HANDOVER, documentId: 'ia07_handover', iconKey: 'award', required: true, displayOrder: 70 },
  { key: 'ia08_log', code: 'IA08', name: 'IA08 System history and event log', description: 'Activations, faults and visits. No signature required.', schema: IA08_LOG, documentId: 'ia08_log', iconKey: 'file', displayOrder: 80 },
  { key: 'ia09_support', code: 'IA09', name: 'IA09 Maintenance and support information', description: 'Service contacts and warranty. Issued by the engineer; receipt is on IA07.', schema: IA09_SUPPORT, documentId: 'ia09_support', iconKey: 'file', displayOrder: 90 },
  { key: 'ia10_release', code: 'IA10', name: 'IA10 O&M index and technical release', description: 'Document completeness and company technical release. Reviewer sign-off.', schema: IA10_RELEASE, documentId: 'ia10_release', iconKey: 'clipboard', displayOrder: 100 },
  { key: 'ia11_takeover', code: 'IA11', name: 'IA11 Takeover survey and condition record', description: 'Inherited installation survey. Customer signs only if the takeover is conditional or limited.', schema: IA11_TAKEOVER, documentId: 'ia11_takeover', iconKey: 'clipboard', displayOrder: 110 },
  { key: 'ia12_upgrade', code: 'IA12', name: 'IA12 Upgrade and extension record', description: 'Change scope and retesting. Customer signs only for design changes or limitations.', schema: IA12_UPGRADE, documentId: 'ia12_upgrade', iconKey: 'clipboard', displayOrder: 120 },
  { key: 'ia13_transfer', code: 'IA13', name: 'IA13 Maintenance and monitoring transfer', description: 'Provider transfer. Customer signs only if there is an interruption or limitation.', schema: IA13_TRANSFER, documentId: 'ia13_transfer', iconKey: 'file', displayOrder: 130 },
  { key: 'ia14_maintenance', code: 'IA14', name: 'IA14 Maintenance and corrective work', description: 'Visit record. Engineer sign-off only.', schema: IA14_MAINTENANCE, documentId: 'ia14_maintenance', iconKey: 'clipboard', displayOrder: 140 },
];

const SCHEMA_BY_KEY: Record<string, SchemaCatalogue> = Object.fromEntries(
  INTRUDER_PACK_FORMS.map(item => [item.key, item.schema]),
);

const SCHEMA_ALIASES: Record<string, string> = {
  intruder_alarm_master: 'ia07_handover',
};

export function resolveIntruderFormKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (SCHEMA_BY_KEY[key]) return key;
  return SCHEMA_ALIASES[key] ?? null;
}

export function getIntruderFormSchema(key: string | null | undefined): SchemaCatalogue | null {
  const resolved = resolveIntruderFormKey(key);
  return resolved ? SCHEMA_BY_KEY[resolved] : null;
}

export function isIntruderPackFormKey(key: string | null | undefined): boolean {
  return Boolean(resolveIntruderFormKey(key));
}

export function intruderPackTemplateList(): Array<{ key: string; name: string; description: string; fields: [] }> {
  return INTRUDER_PACK_FORMS.map(item => ({
    key: item.key,
    name: item.name,
    description: item.description,
    fields: [],
  }));
}
