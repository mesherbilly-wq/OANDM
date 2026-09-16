import type { SchemaCatalogue, SchemaField, SchemaSection } from './schemaForm';

export const INTRUDER_PACK_STATUS = 'DRAFT — NOT VALIDATED FOR NSI COMPLIANCE';
export const INTRUDER_PACK_REVISION = '02';

const WORK_OPTIONS = ['new', 'takeover', 'upgrade', 'extension'];
const TOPIC_STATUS = ['Done', 'Outstanding', 'NA'];
const PRESENCE = ['Present', 'Pending', 'NA'];
const CODES_NOTE = 'Codes: P pass, F fail, NT not tested, NA not applicable. Right columns: result, then reference.';

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
    note: extras.note,
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

function check(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'check_result', required };
}

function note(id: string, label: string): SchemaField {
  return { id, label, type: 'note' };
}

function signature(id: string, label: string, required = true): SchemaField {
  return { id, label, type: 'signature', required };
}

function header(extra: SchemaField[] = []): SchemaSection {
  return section('header', '', [
    text('site_building', 'Site / building', true),
    text('job_system_ref', 'Job / system ref', true),
    ...extra,
  ]);
}

export const IA01_AS_FITTED = form('IA01 As-fitted system record and equipment schedule', [
  header(),
  section('customer', 'A. CUSTOMER AND PREMISES', [
    text('customer_organisation', 'Customer organisation'),
    text('customer_representative', 'Customer representative'),
    area('installation_address', 'Installation address (site address, not billing address)'),
    text('simpro_job_id', 'Simpro company / job ID'),
    text('quote_id', 'Quote ID / baseline snapshot'),
    text('as_fitted_reference', 'As-fitted reference / revision'),
    date('final_verification_date', 'Date of final verification'),
  ]),
  section('basis', 'B. WORK AND DESIGN BASIS', [
    select('work_type', 'Work: new / takeover / upgrade / extension', WORK_OPTIONS),
    text('design_risk_reference', 'Design / risk assessment reference'),
    text('existing_stated_grade', 'Existing stated grade / unknown'),
    text('verified_grade', 'Verified grade / evidence reference'),
    area('applicable_standards', 'Applicable standards, editions, amendments and environmental classifications'),
    area('agreed_scope', 'Agreed scope, protected areas, exclusions and source quote sections'),
  ]),
  section('schedule_meta', '', [
    text('schedule_reference', 'Schedule reference / continuation number'),
    text('linked_quote', 'Linked quote / agreed variation'),
    note(
      'schedule_note',
      'Record actual installed devices. Retain original quoted quantities in the change record. Use asset IDs to link readings and tests; record old equipment separately where removed or replaced.',
    ),
  ]),
  section('device_rows', 'C. DEVICE SCHEDULE', [
    text('asset_zone', 'Asset / zone'),
    text('location', 'Location / area'),
    text('type_make_model', 'Type / make / model'),
    text('grade_class', 'Grade / class'),
    text('qty_serial', 'Qty / serial ref'),
  ], { repeatable: true }),
  section('schedule_close', '', [
    area('firmware_drawing_refs', 'Firmware, connection type, serial-number schedule or associated drawing references'),
    text('confirmed_by', 'Confirmed by'),
    date('confirmed_revision', 'Date / revision'),
  ]),
  section('arrangements', 'D. ACTUAL SYSTEM ARRANGEMENTS', [
    text('panel_model', 'Panel / control equipment model'),
    text('panel_location', 'Panel location / asset reference'),
    area('setting_unsetting', 'Areas / partitions, setting and unsetting methods, entry / exit routes'),
    area('confirmation_monitoring', 'Alarm confirmation, monitoring, hold-up and interface arrangements'),
    text('power_record_ref', 'Power / battery record reference IA02'),
    text('signalling_record_ref', 'Signalling record reference IA04'),
    area('drawing_refs', 'Drawing / zone plan references and revisions; user-manual references'),
    area('changes_limitations', 'Changes from quote / design and limitations (link IA05)'),
  ]),
  section('engineer_signoff', '', [
    note(
      'declaration',
      'Engineer verification: this record describes the installed system within the recorded scope. Unknown and unverified items are identified. Customer acceptance of changes is recorded separately.',
    ),
    text('engineer_name', 'Engineer name'),
    date('signed_at', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed-record reference'),
  ]),
]);

export const IA02_READINGS = form('IA02 Parameters and electrical readings', [
  header([
    text('test_date_engineer', 'Test date / engineer'),
    text('instrument_id', 'Instrument ID / verification reference'),
    note(
      'method_note',
      'Use the approved procedure and applicable acceptance limits. Record actual readings and conditions. Identify omitted measurements and reasons; do not use a tick as a substitute for a reading.',
    ),
  ]),
  section('detection', 'A. DETECTION AND INTERCONNECTION RECORD', [
    text('zone_asset', 'Zone / asset'),
    text('device_type_location', 'Device type / location'),
    text('resistance_ohm', 'Resistance (ohm)'),
    text('device_volts_dc', 'Device volts DC'),
    text('coverage_range', 'Coverage / range'),
    area('wireless_readings', 'Wireless readings / units / limits, test conditions and referenced evidence'),
    area('exceptions', 'Exceptions and linked issue / retest references'),
  ], { repeatable: true }),
  section('supply', 'B. SUPPLY READINGS (ONE SHEET PER SUPPLY)', [
    text('psu_asset', 'Panel / PSU asset ID and location'),
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
    area('calculation', 'Calculation method, applicable clause, derating / recharge assumptions and evidence ref'),
    check('capacity_adequate', 'Calculated capacity adequate for applicable duty'),
    check('mains_battery_faults', 'Mains failure / restoration and battery / supply faults verified'),
    area('instrument_conditions', 'Instrument / conditions'),
    area('issues_retest', 'Issues / retest references'),
  ], { repeatable: true, note: CODES_NOTE }),
  section('warning', 'C. WARNING DEVICES', [
    text('asset_location', 'Asset / location'),
    text('power_type', 'Power type'),
    text('input_vdc', 'Input V DC'),
    text('standby_alarm_ma', 'Standby / alarm mA'),
    text('charge_check_ref', 'Charge check / ref'),
  ], { repeatable: true }),
  section('settings', 'D. PROGRAMMED AND VERIFIED SETTINGS', [
    text('entry_time', 'Entry time (seconds)'),
    text('exit_time', 'Exit time (seconds)'),
    text('confirmation_time', 'Confirmation time / units'),
    text('sounder_duration', 'Sounder duration (minutes)'),
    text('sounder_delay', 'Sounder delay (minutes)'),
    select('hold_up_warning', 'Hold-up local warning: silent / audible', ['silent', 'audible']),
    select('unconfirmed_reset', 'Unconfirmed reset: user / engineer', ['user', 'engineer']),
    select('confirmed_reset', 'Confirmed reset: user / engineer', ['user', 'engineer']),
    text('setting_reset_procedure', 'Setting / reset procedure reference'),
    area('settings_by_area', 'Settings by area, acceptance limits, exceptions and evidence refs'),
  ]),
  section('engineer_signoff', '', [
    signature('engineer_signature', 'Engineer name / signature'),
    date('signed_at', 'Date'),
    text('ia02_reference', 'IA02 record reference / revision'),
    text('customer_receipt_ia07', 'Customer receipt: IA07 reference'),
  ]),
]);

export const IA03_COMMISSIONING = form('IA03 Commissioning and verification checks', [
  header([
    text('engineer_test_date', 'Engineer / test date'),
    text('procedure_revision', 'Approved procedure / revision'),
    text('grade_profile', 'Applicable grade / standard profile'),
    text('as_fitted_revision', 'As-fitted record revision'),
  ]),
  section('installation', 'A. INSTALLATION AND OPERATION', [
    check('scope_reconciled', 'Installed scope reconciled with agreed design and as-fitted record'),
    check('compatibility', 'Equipment compatibility, grading and environment verified'),
    check('cabling', 'Cabling, supports, segregation and relevant electrical evidence'),
    check('detection_tested', 'All applicable detection devices and coverage tested'),
    check('tampers', 'Applicable device, enclosure and removal tampers tested'),
    check('setting_unsetting', 'Full / part setting, exit completion and unsetting verified'),
    check('entry_exit', 'Entry / exit indications and routes verified'),
    check('faults_isolations', 'Fault indications, inhibit / isolation and restoration verified'),
    check('warning_devices', 'Warning devices and alternate-power operation verified'),
    check('power_on_ia02', 'Power readings, standby duty and failure tests recorded on IA02'),
    area('failures_exclusions', 'Failures, exclusions, untested items and evidence / issue references'),
  ], { note: CODES_NOTE }),
  section('remaining', 'B. REMAINING APPLICABLE TESTS', [
    check('hold_up', 'Hold-up devices and configured response tested'),
    check('confirmation', 'Confirmation method and timing verified'),
    check('arc_signals', 'Required ARC signals and each transmission path tested (IA04)'),
    check('wireless', 'Wireless supervision, radio performance and battery faults tested'),
    check('interfaces', 'Interfaces tested end to end with authorised parties'),
    check('remote_app', 'Remote / app operation and access responsibilities verified'),
    check('regression', 'Affected retained equipment retested following changes'),
    check('datetime_events', 'Correct date / time and applicable event records verified'),
    check('test_modes_cleared', 'Test modes cleared; final status and residual isolations recorded'),
    area('detailed_results', 'Detailed test records, expected / actual results and supporting attachments'),
    select('final_state', 'Final state: normal / restricted / faulty', ['normal', 'restricted', 'faulty']),
    area('outstanding_issues', 'Outstanding issue references'),
  ], { note: CODES_NOTE }),
  section('engineer_signoff', '', [
    note(
      'declaration',
      'I confirm the results reflect the work and tests performed within the stated scope. This checklist must be used with the approved detailed procedures and applicable standards.',
    ),
    text('engineer_name', 'Engineer name'),
    date('signed_at', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed-record reference'),
  ]),
]);

export const IA04_ARC = form('IA04 ARC signalling and response verification', [
  header([
    text('arc_contact', 'ARC / contact'),
    text('monitoring_account', 'Monitoring account reference'),
    text('transmitter_model', 'Transmitter model / asset'),
    text('transmission_category', 'Transmission category / paths'),
    text('engineer_date', 'Engineer / date'),
    text('arc_booking', 'ARC test booking / operator reference'),
  ]),
  section('signals', 'A. REQUIRED SIGNALS', [
    text('signal_trigger', 'Signal / trigger'),
    text('sent_time', 'Sent time'),
    text('received_time', 'Received time'),
    text('arc_ack', 'ARC acknowledgement'),
    check('result', 'Result / ref'),
  ], {
    repeatable: true,
    note: 'List signals required for this system. Record the actual triggering function, receipt and ARC acknowledgement. Include intruder, hold-up, confirmation, tamper, faults and setting signals where applicable.',
  }),
  section('missing', '', [
    area('missing_retest', 'Missing signals, retest and linked issues'),
  ]),
  section('paths', 'B. EACH TRANSMISSION PATH', [
    text('path_provider', 'Path / provider'),
    text('failure_restore', 'Failure / restore trigger'),
    text('time_limit', 'Time / expected limit'),
    area('actual_result', 'Actual result / ARC ref'),
  ], { repeatable: true }),
  section('response', '', [
    area('confirmation_evidence', 'Confirmation method / evidence'),
    text('police_force_policy', 'Police force / policy edition'),
    select('response_status', 'Response: active / pending / suspended / NA', ['active', 'pending', 'suspended', 'NA']),
    text('urn_restricted_ref', 'URN / restricted record reference'),
    text('final_monitoring_state', 'Final monitoring state'),
    text('test_mode_ended', 'Test mode ended: time / ARC ref'),
    area('outstanding_actions', 'Outstanding activation actions, owner, due date and customer notification'),
    note(
      'restricted_note',
      'Keep keyholder personal details and signalling secrets in the authorised restricted record. A successful signal test alone does not prove police response has been granted.',
    ),
    text('engineer_name', 'Engineer name'),
    date('signed_at', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed-record reference'),
  ]),
]);

export const IA05_CHANGES = form('IA05 Changes, defects and remedial actions', [
  header([
    text('issue_reference', 'Issue / change reference'),
    text('date_raised_by', 'Date / raised by'),
    select('issue_type', 'Type: design change / defect / departure', ['design change', 'defect', 'departure']),
    select('status', 'Status: open / action / retest / closed', ['open', 'action', 'retest', 'closed']),
    area('description', 'Description, affected assets and quoted versus installed quantities / scope'),
    area('operational_effect', 'Operational effect and applicable design / standards reference'),
    area('required_action', 'Required action and temporary protection / isolations'),
    text('responsible_person', 'Responsible person'),
    date('due_date', 'Due date'),
    text('customer_notified', 'Customer notified / date'),
    text('ia15_acceptance_ref', 'IA15 acceptance ref / not required'),
    area('technical_disposition', 'Technical disposition and closure / retest evidence'),
    note(
      'note',
      'Customer acknowledgement does not establish technical compliance or close a failed test. Preserve the original issue and record the corrective action and retest.',
    ),
    signature('reviewer_signature', 'Technical reviewer / signature', false),
    date('reviewed_at', 'Date'),
  ]),
]);

export const IA06_TRAINING = form('IA06 Customer demonstration and training', [
  header([
    text('trainee_name_role', 'Trainee name / role'),
    text('trainer_date', 'Trainer / date'),
  ]),
  section('topics', 'A. TOPICS DEMONSTRATED OR EXPLAINED', [
    text('topic', 'Topic'),
    select('status', 'Status', TOPIC_STATUS),
    area('notes', 'Notes / instruction reference'),
  ], { repeatable: true, note: 'Enter Done, Outstanding or NA; record reasons and further training below.' }),
  section('follow_up', '', [
    area('outstanding_training', 'Outstanding training and user instructions supplied (reference / revision)'),
    note(
      'trainer_declaration',
      'Trainer declaration: I confirm who attended and what was demonstrated or explained. Outstanding topics are recorded. Customer acknowledgement is linked to the current event on IA07; no repeat trainee signature is requested here.',
    ),
    signature('trainer_signature', 'Trainer signature / date', false),
    text('ia06_reference', 'IA06 record reference / revision'),
    text('event_reference', 'Current event reference / date'),
    text('ia07_ack_ref', 'IA07 acknowledgement reference'),
  ]),
]);

export const IA07_HANDOVER = form('IA07 Completion and handover acceptance', [
  header([
    text('customer_name_role', 'Customer name / authorised role'),
    text('event_date_work_type', 'Event date / work type'),
    text('ia07_reference', 'IA07 handover / event reference'),
    text('completion_scope', 'Scope / areas / visit covered'),
  ]),
  section('receipt', 'A. RECORDS RECEIVED - REFERENCE AND REVISION OR NA', [
    text('ia01_ref', 'IA01 as-fitted record / revision'),
    text('ia02_ref', 'IA02 readings record / revision'),
    text('ia06_ref', 'IA06 training record / revision'),
    text('ia09_ref', 'IA09 support information / revision'),
    text('ia10_ref', 'IA10 document index / revision'),
    text('user_instructions', 'User instructions / logbook reference'),
    select('system_state', 'System state: operational / limited / not live', ['operational', 'limited', 'not live']),
    select('monitoring_state', 'Monitoring: live / pending / not applicable', ['live', 'pending', 'not applicable']),
    text('design_changes', 'Design changes: none / IA15 reference'),
    text('restrictions', 'Restrictions / untested items: none / IA15'),
  ]),
  section('customer_acceptance', '', [
    note(
      'acknowledgement_text',
      'I acknowledge the stated event, condition and listed documents. For this event, the applicable demonstration, instructions, logbook, support information and operating keys / fobs / credentials were provided as recorded. Exceptions are identified in IA15; NA items are outside this event. My signature does not verify technical readings or certify compliance.',
    ),
    signature('customer_signature', 'Customer signature'),
    date('customer_signed_at', 'Date / time'),
    note(
      'installer_text',
      'Engineer: I confirm the handover record is accurate. Design changes are either absent or identified above. I remain responsible for my recorded work and tests; customer agreement does not resolve a technical defect.',
    ),
    signature('installer_signature', 'Engineer name / signature'),
    date('installer_signed_at', 'Date / time'),
  ]),
]);

export const IA08_LOG = form('IA08 System history and event log', [
  header([
    text('maintainer_telephone', 'Maintainer / service telephone'),
    text('log_reference', 'Log reference / continuation number'),
    note(
      'instruction',
      'Record activations, faults, maintenance, repairs and alterations. Include the person recording the event and the linked work sheet. Do not write access codes in this log.',
    ),
  ]),
  section('events', 'A. EVENTS AND VISITS', [
    text('event_datetime', 'Date / time'),
    area('event_area', 'Event / affected area'),
    text('action_ref', 'Action / report reference'),
    text('recorded_by', 'Recorded by'),
  ], { repeatable: true }),
  section('open', '', [
    area('unresolved', 'Current unresolved items / next action'),
  ]),
]);

export const IA09_SUPPORT = form('IA09 Maintenance and support information', [
  header(),
  section('service', 'A. SERVICE ARRANGEMENTS', [
    text('maintenance_provider', 'Maintenance provider'),
    text('agreement_ref', 'Agreement reference / effective date'),
    text('service_telephone', 'Service telephone'),
    text('emergency_telephone', 'Emergency / out-of-hours telephone'),
    text('support_email', 'Support email'),
    text('monitoring_provider', 'Monitoring provider / support reference'),
    text('visit_frequency', 'Visit frequency / method'),
    date('first_service_due', 'First planned service due'),
    area('coverage', 'Coverage, attendance arrangements, exclusions and agreement attachment'),
  ]),
  section('documents', 'B. USER DOCUMENTS AND WARRANTY', [
    text('user_manual_ref', 'User manual reference / revision'),
    text('quick_guide_logbook', 'Quick guide / logbook reference'),
    area('warranty', 'Warranty period, start date, scope and provider'),
    area('user_checks', 'User checks and false-alarm guidance reference'),
    note(
      'advice',
      'Keep routes clear and follow the supplied operating instructions. Report faults promptly and record activations in the logbook. Arrange changes to operation or protection through the maintainer; follow site procedures in an emergency.',
    ),
    text('issued_by_date', 'Issued by / date'),
    text('receipt_ref', 'Receipt: IA07 / delivery reference'),
  ]),
]);

export const IA10_RELEASE = form('IA10 O&M document index and technical release', [
  header([
    text('pack_reference', 'Pack reference / revision'),
    text('reviewer_date', 'Reviewer / date'),
  ]),
  section('manifest', 'A. DOCUMENT MANIFEST', [
    text('document_name', 'Document / attachment'),
    text('reference_revision', 'Reference / revision'),
    select('presence', 'Present / pending / NA', PRESENCE),
  ], { repeatable: true }),
  section('release', '', [
    area('missing', 'Missing documents, technical blockers and responsible person / due date'),
    select('release_type', 'Release: return / interim / final', ['return', 'interim', 'final']),
    text('exception_ref', 'Signed acceptance / exception reference'),
    note(
      'note',
      'Final release requires the company technical review and applicable evidence. An interim pack must identify its limitations. Attach the official issued certificate; this index is not a substitute certificate.',
    ),
    signature('reviewer_signature', 'Reviewer signature', false),
    text('release_date_recipient', 'Release date / recipient'),
  ]),
]);

export const IA11_TAKEOVER = form('IA11 Takeover survey and condition record', [
  header([
    text('survey_engineer_date', 'Survey engineer / date'),
    text('previous_provider', 'Previous provider / unknown'),
    text('existing_stated_grade', 'Existing stated grade / evidence'),
    text('verified_grade', 'Verified grade / not verified'),
  ]),
  section('records', 'A. RECORDS AND EQUIPMENT', [
    area('existing_records', 'Existing certificate, drawings, zone list, manuals and service history references'),
    area('missing_records', 'Missing records and actions to establish current as-fitted information'),
    area('retained_equipment', 'Retained panel, signalling and equipment; compatibility / supportability'),
    area('inherited_faults', 'Inherited faults, inaccessible devices, unverified areas and limitations'),
    area('scope_inspected', 'Scope / areas inspected'),
    text('linked_records', 'Linked test and issue records'),
  ]),
  section('verification', 'B. TAKEOVER VERIFICATION', [
    select('engineering_access', 'Engineering access: available / partial / no', ['available', 'partial', 'no']),
    text('remote_owner', 'Remote / cloud access owner'),
    area('cloud_transfer', 'Service-mode / cloud transfer process, timescale and charge basis'),
    area('testing_performed', 'Testing performed, exclusions, actual condition and supporting records'),
    area('remedial_scope', 'Remedial scope, temporary arrangements and customer notification'),
    text('transfer_ref', 'Monitoring / maintenance transfer ref IA13'),
    text('responsibility_starts', 'Incoming responsibility starts'),
    select('decision', 'Decision: proceed / conditional / remediate', ['proceed', 'conditional', 'remediate']),
    text('ia07_ia15_ref', 'IA07 / IA15 acknowledgement ref'),
    note(
      'note',
      'Existing paperwork and equipment markings are evidence to assess, not automatic confirmation of system compliance. Record the basis and limits of the takeover decision.',
    ),
    text('survey_engineer_name', 'Survey engineer name'),
    date('signed_at', 'Date / time'),
    signature('engineer_signature', 'Survey engineer signature / signed-record reference', false),
  ]),
]);

export const IA12_UPGRADE = form('IA12 Upgrade and extension record', [
  header([
    text('quote_variation', 'Quote / variation / agreed baseline'),
    text('work_date_engineer', 'Work date / engineer'),
    area('reason_scope', 'Reason, agreed work and pre-work system record reference'),
  ]),
  section('scope', 'A. SCOPE RECONCILIATION', [
    select('action_status', 'Action / status', ['added', 'retained', 'removed', 'replaced', 'NA']),
    text('equipment_location', 'Equipment / location / source line'),
    text('quoted_actual_qty', 'Quoted / actual qty'),
  ], { repeatable: true }),
  section('effect', '', [
    area('compatibility', 'Compatibility and effect on grade, standby duty, signalling and operation'),
    area('regression', 'Affected existing devices / interfaces and regression test references'),
    text('updated_as_fitted', 'Updated as-fitted revision'),
    text('issue_refs', 'IA05 issues / IA15 change acceptance'),
    signature('engineer_signature', 'Engineer signature / date', false),
    text('technical_review_date', 'Technical review / date'),
  ]),
]);

export const IA13_TRANSFER = form('IA13 Maintenance and monitoring transfer', [
  header([
    text('outgoing_provider', 'Outgoing provider'),
    text('incoming_provider', 'Incoming provider'),
    text('effective_date', 'Transfer effective date / time'),
    text('customer_authority_ref', 'Customer authority reference'),
    area('responsibility_boundary', 'Responsibility boundary, services transferred and contract references'),
    area('cloud_access', 'Service-mode and cloud-access arrangements, timescale and pricing basis'),
    text('credential_transfer_ref', 'Records / credential transfer receipt ref'),
    text('prior_remote_review', 'Prior remote access reviewed by / date'),
    text('arc_transfer_ref', 'ARC / signalling transfer reference'),
    text('police_urn_action', 'Police / URN action reference or NA'),
    area('interruption', 'Service interruption / temporary protection and customer notification'),
    area('verification', 'Verification tests, final live state and unresolved actions / owner / due date'),
    signature('engineer_signature', 'Incoming engineer signature / date', false),
    text('ia07_authority_ref', 'Current-event IA07 / authority ref'),
  ]),
]);

export const IA14_MAINTENANCE = form('IA14 Maintenance and corrective work record', [
  header([
    select('visit_type', 'Visit: preventive / corrective / remote', ['preventive', 'corrective', 'remote']),
    text('engineer_date_times', 'Engineer / date / arrival / departure'),
    text('work_order', 'Agreement / work-order reference'),
    text('state_on_arrival', 'System state on arrival'),
  ]),
  section('checks', 'A. APPLICABLE CHECKS AND RESULTS', [
    check('as_fitted_available', 'As-fitted information available and changes identified'),
    check('coverage', 'Device siting, coverage and detection performance checked'),
    check('warning_tampers', 'Warning devices and applicable tamper / power functions checked'),
    check('supply', 'Supply condition, readings and standby duty assessed'),
    check('signals', 'Required signals, confirmation and each path checked to ARC'),
    check('operation_timings', 'Operation, exit indication and configured timings checked'),
    check('logbook_updated', 'System logbook and maintenance record updated'),
    area('reported_problem', 'Reported problem, customer consultation and test limitations'),
  ], { note: CODES_NOTE }),
  section('work', '', [
    area('diagnosis', 'Diagnosis and corrective work carried out'),
  ]),
  section('parts', '', [
    text('part', 'Part replaced / modified'),
    text('asset_location', 'Asset / location'),
    text('retest_result', 'Functional retest / result'),
  ], { repeatable: true }),
  section('close', '', [
    area('outstanding', 'Outstanding faults / untested items, customer agreement and follow-up'),
    text('final_state', 'Final system state'),
    text('isolations_restored', 'Test mode / isolations restored or ref'),
    text('next_action', 'Next action owner / due date'),
    text('arc_ack', 'ARC final service acknowledgement'),
    note(
      'note',
      'Replacement and modified equipment must be tested to the extent necessary for the affected system. Record the actual result and any restriction on service.',
    ),
    signature('engineer_signature', 'Engineer signature / date', false),
    text('receipt_ia15_ref', 'Current-visit receipt / IA15 agreement ref'),
    note(
      'visit_note',
      'For a separate later visit, record its own receipt and any customer agreement required by the applicable procedure. Do not reuse the installation handover signature.',
    ),
  ]),
]);

export const IA15_ACCEPTANCE = form('IA15 Conditional customer acceptance', [
  header([
    text('acceptance_reference', 'Acceptance record reference / revision'),
    text('ia07_ref', 'Current event / IA07 reference'),
    select('acceptance_type', 'Type: design change / disconnection / other', ['design change', 'disconnection', 'other']),
    text('ia05_items', 'Related IA05 items / record revisions'),
    area('acceptance_scope', 'Exact change, disconnected equipment, untested work or exception being agreed'),
    area('operational_effect', 'Affected area, operational effect, lost protection and limitations explained'),
    area('agreed_action', 'Agreed action, temporary arrangements, responsible person and target date'),
    text('effective_at', 'Effective date / time'),
    text('restoration_due', 'Restoration / retest / review due'),
    note(
      'note',
      'I specifically agree to the items identified above: the stated changes to the agreed design; the declared temporary disconnections and their effects; and / or the listed work that could not be tested, as applicable. The scope and implications have been explained. My agreement does not verify technical results, waive required compliance or close an unresolved defect.',
    ),
    text('customer_name_role', 'Customer name / authorised role'),
    signature('customer_signature', 'Customer signature / date'),
    signature('engineer_signature', 'Engineer name / signature', false),
    date('signed_at', 'Date / time'),
    note(
      'omit_note',
      'If not applicable, omit this sheet. Existing signed approval may be referenced instead of obtained again if it covers the same items and revisions. Do not treat notice or silence as consent.',
    ),
  ]),
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
  { key: 'ia01_as_fitted', code: 'IA01', name: 'IA01 As-fitted system record and equipment schedule', description: 'Installed equipment schedule. Engineer verification. Quoted qty is not installed proof.', schema: IA01_AS_FITTED, documentId: 'ia01_as_fitted', iconKey: 'file', required: true, displayOrder: 10 },
  { key: 'ia02_readings', code: 'IA02', name: 'IA02 Parameters and electrical readings', description: 'Device, supply and settings readings. Engineer sign-off only.', schema: IA02_READINGS, documentId: 'ia02_readings', iconKey: 'clipboard', displayOrder: 20 },
  { key: 'ia03_commissioning', code: 'IA03', name: 'IA03 Commissioning and verification checks', description: 'Commissioning checks and tests. Engineer sign-off only.', schema: IA03_COMMISSIONING, documentId: 'ia03_commissioning', iconKey: 'clipboard', displayOrder: 30 },
  { key: 'ia04_arc', code: 'IA04', name: 'IA04 ARC signalling and response verification', description: 'End-to-end signalling tests. Engineer sign-off only.', schema: IA04_ARC, documentId: 'ia04_arc', iconKey: 'clipboard', displayOrder: 40 },
  { key: 'ia05_changes', code: 'IA05', name: 'IA05 Changes, defects and remedial actions', description: 'Design changes, defects and limitations. Customer agreement is on IA15 where required.', schema: IA05_CHANGES, documentId: 'ia05_changes', iconKey: 'file', displayOrder: 50 },
  { key: 'ia06_training', code: 'IA06', name: 'IA06 Customer demonstration and training', description: 'Trainer record of demonstration. Customer acknowledgement is on IA07.', schema: IA06_TRAINING, documentId: 'ia06_training', iconKey: 'graduation', displayOrder: 60 },
  { key: 'ia07_handover', code: 'IA07', name: 'IA07 Completion and handover acceptance', description: 'The routine customer signature. Acknowledges demonstration, documents and operating status.', schema: IA07_HANDOVER, documentId: 'ia07_handover', iconKey: 'award', required: true, displayOrder: 70 },
  { key: 'ia08_log', code: 'IA08', name: 'IA08 System history and event log', description: 'Activations, faults and visits. No signature required.', schema: IA08_LOG, documentId: 'ia08_log', iconKey: 'file', displayOrder: 80 },
  { key: 'ia09_support', code: 'IA09', name: 'IA09 Maintenance and support information', description: 'Service contacts and warranty. Issued by the engineer; receipt is on IA07.', schema: IA09_SUPPORT, documentId: 'ia09_support', iconKey: 'file', displayOrder: 90 },
  { key: 'ia10_release', code: 'IA10', name: 'IA10 O&M document index and technical release', description: 'Document completeness and company technical release. Reviewer sign-off.', schema: IA10_RELEASE, documentId: 'ia10_release', iconKey: 'clipboard', displayOrder: 100 },
  { key: 'ia11_takeover', code: 'IA11', name: 'IA11 Takeover survey and condition record', description: 'Inherited installation survey. Customer signs IA15 only if the takeover is conditional or limited.', schema: IA11_TAKEOVER, documentId: 'ia11_takeover', iconKey: 'clipboard', displayOrder: 110 },
  { key: 'ia12_upgrade', code: 'IA12', name: 'IA12 Upgrade and extension record', description: 'Change scope and retesting. Customer signs IA15 only for design changes or limitations.', schema: IA12_UPGRADE, documentId: 'ia12_upgrade', iconKey: 'clipboard', displayOrder: 120 },
  { key: 'ia13_transfer', code: 'IA13', name: 'IA13 Maintenance and monitoring transfer', description: 'Provider transfer. Customer signs IA15 only if there is an interruption or limitation.', schema: IA13_TRANSFER, documentId: 'ia13_transfer', iconKey: 'file', displayOrder: 130 },
  { key: 'ia14_maintenance', code: 'IA14', name: 'IA14 Maintenance and corrective work record', description: 'Visit record. Engineer sign-off only.', schema: IA14_MAINTENANCE, documentId: 'ia14_maintenance', iconKey: 'clipboard', displayOrder: 140 },
  { key: 'ia15_acceptance', code: 'IA15', name: 'IA15 Conditional customer acceptance', description: 'Extra customer signature only for design changes, disconnections or incomplete tests.', schema: IA15_ACCEPTANCE, documentId: 'ia15_acceptance', iconKey: 'award', displayOrder: 150 },
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
