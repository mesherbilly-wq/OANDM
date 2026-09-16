import type { SchemaCatalogue, SchemaField, SchemaSection, SchemaShowWhen } from './schemaForm';

export const CCTV_PACK_STATUS = 'DRAFT — NOT VALIDATED FOR NSI COMPLIANCE';
export const CCTV_PACK_REVISION = '01';

function form(title: string, sections: SchemaSection[]): SchemaCatalogue {
  return {
    schemaVersion: '1.0.0',
    status: CCTV_PACK_STATUS,
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

export const CV01_AS_FITTED = form('CV01 As-fitted system record and camera schedule', [
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
    text('design_risk_reference', 'Design / risk assessment / operational requirement reference'),
    area('applicable_standards', 'Applicable standards, editions, amendments and environmental classifications', true),
    area('agreed_scope', 'Agreed scope, areas of coverage, exclusions and source quote sections', true),
    area('quote_note', 'Quote / quantity note', false),
    select('monitoring_applicable', 'Detector-activated / remotely monitored system (CV05)', ['yes', 'no', 'not_applicable'], true),
  ]),
  section('cameras', 'Installed cameras', [
    text('camera_id', 'Camera / asset ID', true),
    text('location', 'Location / area / view', true),
    text('type_make_model', 'Type / make / model', true),
    text('lens_fov', 'Lens / FoV / resolution'),
    text('lighting', 'Lighting / IR / WDR'),
    text('qty_serial', 'Actual qty / serial ref', true),
    text('quoted_qty', 'Quoted qty (baseline only — not installed proof)'),
    area('notes', 'Notes / old equipment removed or replaced'),
  ], { repeatable: true }),
  section('recorders', 'Recorders, display and infrastructure', [
    text('recorder_id', 'Recorder / NVR / VMS asset ID', true),
    text('location', 'Location', true),
    text('type_make_model', 'Type / make / model', true),
    text('channels_storage', 'Channels / storage arrangement'),
    text('qty_serial', 'Actual qty / serial ref', true),
    text('quoted_qty', 'Quoted qty (baseline only)'),
    area('notes', 'Notes / firmware / licence'),
  ], { repeatable: true }),
  section('arrangements', 'Actual system arrangements', [
    text('recorder_model', 'Primary recorder / VMS', true),
    text('recorder_location', 'Recorder location / asset reference', true),
    area('network_power', 'Network, PoE, power and UPS arrangements', true),
    area('recording_export', 'Recording, retention, export and evidence-handling arrangements', true),
    area('viewing_access', 'Live viewing, user access and remote-access owner', true),
    area('monitoring_interfaces', 'Detector activation, remote monitoring and interface arrangements, or NA'),
    text('camera_record_ref', 'Camera / performance record reference (CV02)'),
    text('recording_record_ref', 'Recording / export record reference (CV04)'),
    text('monitoring_record_ref', 'Monitoring record reference (CV05) or NA'),
    area('drawing_refs', 'Drawing / camera plan references and revisions; user-manual references'),
    area('changes_limitations', 'Changes from quote / design and limitations (link CV06 / CV15)'),
  ]),
  engineerSignOff(
    'Engineer verification',
    'I confirm this record describes the installed CCTV system within the recorded scope. Unknown and unverified items are identified. A quote is a proposed baseline only; quoted quantity is not installed proof. Customer acceptance of changes is recorded separately on CV08/CV15. Do not record passwords or personal footage on this form.',
  ),
]);

export const CV02_CAMERAS = form('CV02 Camera, image and infrastructure record', [
  header(),
  section('meta', 'Test identity', [
    date('test_date', 'Test date', true),
    text('engineer_name', 'Engineer', true),
    text('instrument_id', 'Instrument / test-chart / verification reference'),
    area('method_note', 'Use the approved procedure and applicable image / identification criteria. Record actual results. Do not use a tick as a substitute for a result. NCP 104 Issue 3 (Nov 2017) is the documented NSI CCTV Codes of Practice baseline; apply the current BS EN IEC 62676-4 edition where it is the specified performance standard.'),
  ]),
  section('camera_rows', 'Camera image and siting', [
    text('camera_id', 'Camera / asset', true),
    text('location_view', 'Location / intended view', true),
    text('purpose', 'Purpose / operational requirement (observe / recognise / identify)'),
    text('image_result', 'Image result / evidence ref'),
    text('focus_fov', 'Focus / FoV / masking'),
    text('day_night', 'Day / night / IR result'),
    area('exceptions', 'Obstructions, lighting shortfalls, exceptions and linked issue / retest references'),
  ], { repeatable: true }),
  section('infrastructure', 'Cable, network and power', [
    ...check('cabling_supports', 'Cabling, supports, containment and segregation verified'),
    ...check('network_poe', 'Network / PoE / switch loading and link integrity verified'),
    ...check('power_ups', 'Mains, PSU, camera power and applicable UPS / standby verified'),
    ...check('time_sync', 'Date / time source and recorder / camera time sync verified'),
    ...check('cyber_hardening', 'Default accounts changed and unused services disabled as applicable'),
    area('infrastructure_notes', 'Infrastructure notes, test conditions and evidence refs'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm these camera and infrastructure results were taken under the recorded conditions and that omitted measurements are identified with reasons. Technical measurements are the engineer’s and company’s responsibility.',
  ),
]);

export const CV03_COMMISSIONING = form('CV03 Commissioning and verification checks', [
  header(),
  section('meta', 'Test identity', [
    text('engineer_name', 'Engineer', true),
    date('test_date', 'Test date', true),
    text('procedure_revision', 'Approved procedure / revision'),
    text('standard_profile', 'Applicable standard / operational-requirement profile'),
    text('as_fitted_revision', 'As-fitted record revision'),
  ]),
  section('installation', 'Installation and operation', [
    ...check('scope_reconciled', 'Installed scope reconciled with agreed design and as-fitted record'),
    ...check('compatibility', 'Equipment compatibility, environment and mounting verified'),
    ...check('cameras_views', 'All applicable cameras, views and image criteria tested (CV02)'),
    ...check('recording_export', 'Recording, playback and export verified (CV04)'),
    ...check('displays_workstations', 'Displays, workstations and authorised live viewing verified'),
    ...check('user_access', 'User access levels and audit / operator functions verified'),
    ...check('faults_indications', 'Fault indications, storage warnings and restoration verified'),
    ...check('privacy_masking', 'Privacy masking, blanking and authorised views verified where required'),
    area('failures_exclusions', 'Failures, exclusions, untested items and evidence / issue references'),
  ]),
  section('remaining', 'Remaining applicable tests', [
    ...check('motion_analytics', 'Motion detection / analytics configured and tested where required'),
    ...check('audio', 'Audio capture tested or confirmed not fitted / not authorised'),
    ...check('monitoring', 'Remote monitoring / detector activation tested (CV05) or marked NA'),
    ...check('interfaces', 'Interfaces tested end to end with authorised parties'),
    ...check('remote_access', 'Remote / app / client access and access-owner responsibilities verified'),
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

export const CV04_RECORDING = form('CV04 Recording, retention and export verification', [
  header(),
  section('recorder', 'Recorder identity', [
    text('recorder_asset', 'Recorder / VMS asset', true),
    text('make_model', 'Make / model / software revision'),
    text('engineer_name', 'Engineer', true),
    date('test_date', 'Date', true),
    text('storage_arrangement', 'Storage arrangement / RAID / spare'),
    text('channel_count', 'Configured channels / cameras recorded'),
  ]),
  section('retention', 'Retention and overwrite', [
    text('required_retention', 'Required retention period', true),
    text('achieved_retention', 'Achieved / calculated retention'),
    text('frame_rate_codec', 'Frame rate / codec / quality profile'),
    select('overwrite_mode', 'Overwrite / lock mode', ['overwrite', 'stop_when_full', 'mixed', 'not_applicable'], true),
    ...check('storage_health', 'Storage health, remaining capacity and warning thresholds verified'),
    ...check('continuous_or_event', 'Continuous / scheduled / event recording matches the agreed design'),
    area('calculation_evidence', 'Retention calculation method, assumptions and evidence reference'),
  ]),
  section('export', 'Playback and export', [
    ...check('live_playback', 'Live view and playback of recorded images verified'),
    ...check('time_search', 'Time / event search functions verified'),
    ...check('export_native', 'Native export completed and playable on independent player'),
    ...check('export_standard', 'Standard / evidential export format completed where required'),
    ...check('watermark_audit', 'Watermark, checksum or audit trail verified where provided'),
    ...check('authorised_export', 'Export rights restricted to authorised users'),
    area('export_refs', 'Export file references, player version and test limitations'),
    area('note', 'Customer acknowledgement of demonstrated playback and export is recorded on CV08. Do not attach personal footage to this pack.'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm the recording, retention and export tests recorded above. Technical measurements are the engineer’s and company’s responsibility.',
  ),
]);

export const CV05_MONITORING = form('CV05 Remote monitoring and detector-activated verification', [
  header(),
  section('applicability', 'Applicability', [
    select('monitoring_type', 'Monitoring type', ['detector_activated', 'remote_video_response', 'bs_8418', 'other_monitored', 'not_applicable'], true),
    area('applicability_note', 'Use this form only where the system is remotely monitored, detector-activated, or BS 8418 applies. Mark not_applicable and do not complete the tests if monitoring is not in scope.'),
  ]),
  section('connection', 'Connection', [
    text('rvrc_arc', 'RVRC / ARC / monitoring provider', true),
    text('monitoring_account', 'Monitoring account reference'),
    text('transmitter_model', 'Transmitter / encoder / asset'),
    text('transmission_paths', 'Transmission category / paths'),
    text('engineer_name', 'Engineer'),
    date('test_date', 'Date', true),
    text('booking_ref', 'Test booking / operator reference'),
  ], { showWhen: whenField('applicability', 'monitoring_type', ['detector_activated', 'remote_video_response', 'bs_8418', 'other_monitored']) }),
  section('signals', 'Required signals and images', [
    text('signal_trigger', 'Signal / trigger / camera', true),
    text('sent_time', 'Sent time'),
    text('received_time', 'Received time'),
    text('operator_ack', 'Operator acknowledgement'),
    { id: 'result', label: 'Result', type: 'test_result', required: true },
    text('result_ref', 'Reference'),
  ], {
    repeatable: true,
    showWhen: whenField('applicability', 'monitoring_type', ['detector_activated', 'remote_video_response', 'bs_8418', 'other_monitored']),
  }),
  section('paths', 'Each transmission path', [
    text('path_provider', 'Path / provider', true),
    text('failure_restore', 'Failure / restore trigger'),
    text('time_limit', 'Time / expected limit'),
    area('actual_result', 'Actual result / operator ref'),
  ], {
    repeatable: true,
    showWhen: whenField('applicability', 'monitoring_type', ['detector_activated', 'remote_video_response', 'bs_8418', 'other_monitored']),
  }),
  section('response', 'Response and live service', [
    area('confirmation_evidence', 'Image quality, detector cause and operator instruction evidence'),
    select('final_monitoring_state', 'Final monitoring state', ['live', 'pending', 'not_applicable', 'suspended'], true),
    text('test_mode_ended', 'Test mode ended: time / operator ref'),
    area('outstanding_actions', 'Outstanding activation actions, owner, due date and customer notification'),
    area('restricted_note', 'Keep signalling secrets and personal footage in the authorised restricted record. A successful signal test alone does not prove police or keyholder response has been granted.'),
  ], { showWhen: whenField('applicability', 'monitoring_type', ['detector_activated', 'remote_video_response', 'bs_8418', 'other_monitored']) }),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm the monitoring tests recorded above, or that remote monitoring is not applicable. Monitoring tests and compatibility with the RVRC/ARC are the engineer’s and company’s responsibility.',
  ),
]);

export const CV06_CHANGES = form('CV06 Changes, defects and remedial actions', [
  header(),
  section('issue', 'Issue / change', [
    text('issue_reference', 'Issue / change reference', true),
    date('raised_date', 'Date'),
    text('raised_by', 'Raised by'),
    select('issue_type', 'Type', [
      'design_change',
      'defect',
      'disconnected_or_reduced_coverage',
      'limitation_or_incomplete_test',
      'other',
    ], true),
    select('status', 'Status', ['open', 'action', 'retest', 'closed'], true),
    area('description', 'Description, affected cameras / recorders and quoted versus installed quantities / scope', true),
    area('operational_effect', 'Operational effect and applicable design / standards reference'),
    area('required_action', 'Required action and temporary coverage / isolations', true),
    text('responsible_person', 'Responsible person'),
    date('due_date', 'Due date'),
    text('customer_notified', 'Customer notified / date'),
    text('cv15_ref', 'Customer acceptance reference (CV15) if a change or limitation needs agreement'),
    area('technical_disposition', 'Technical disposition and closure / retest evidence'),
    area('note', 'Customer acknowledgement does not establish technical compliance or close a failed test. Preserve the original issue and record the corrective action and retest. Use CV15 for customer acceptance of design changes, reduced coverage or incomplete tests.'),
  ]),
  reviewerSignOff(),
]);

export const CV07_TRAINING = form('CV07 Customer demonstration and training', [
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
    area('note', 'Customer acknowledgement of the demonstration and training is recorded once on CV08. This sheet is the engineer/trainer record. Do not request a repeat trainee signature on this form.'),
  ]),
  engineerSignOff(
    'Trainer / engineer record',
    'I confirm the instruction recorded above was given. Outstanding topics and limitations are identified in this record.',
  ),
]);

export const CV08_HANDOVER = form('CV08 Completion and handover acceptance', [
  header(),
  section('handover', 'Handover identity', [
    text('customer_name_role', 'Customer name / authorised role', true),
    date('commissioning_date', 'Commissioning date', true),
    text('as_fitted_reference', 'As-fitted reference / revision', true),
    text('completion_scope', 'Completion scope / work type', true),
    select('system_state', 'System state', ['operational', 'limited', 'not_live'], true),
    select('monitoring_state', 'Monitoring state', ['live', 'pending', 'not_applicable'], true),
    area('outstanding_work', 'Outstanding work, variations, limitations and document references'),
  ]),
  section('receipt', 'Items received and demonstrated', [
    ...check('demonstration_training', 'Operation demonstrated and user instruction provided (CV07)'),
    ...check('live_playback_export', 'Live view, playback and agreed export method demonstrated (CV04)'),
    ...check('credentials', 'Authorised access / credentials transferred securely — do not write passwords here'),
    ...check('user_information', 'Complete user operating information supplied'),
    ...check('logbook_maintenance', 'System logbook and maintenance / emergency contacts supplied'),
    ...check('as_fitted_docs', 'Referenced as-fitted record and handover documents identified'),
    ...check('operating_status', 'System’s stated operating and monitoring status explained'),
    ...check('privacy_use', 'Authorised use, privacy and footage-handling responsibilities explained'),
  ]),
  section('customer_acceptance', 'Customer acknowledgement', [
    area(
      'acknowledgement_text',
      'The customer acknowledges the demonstration and training recorded, receipt of instructions, logbook and maintenance information, the referenced as-fitted record and handover documents, and the system’s stated operating and monitoring status. This is the routine customer signature for the CCTV pack.',
    ),
    signature('customer_signature', 'Customer name and signature', true),
    date('customer_signed_at', 'Date', true),
  ]),
  section('installer_declaration', 'Installer declaration', [
    area(
      'installer_text',
      'This record accurately describes the handover within the stated scope. The separate NSI Certificate of Compliance, if issued, is recorded in the O&M index. This form is not that certificate. NCP 120 is an intruder-alarm code and is not used as the CCTV baseline.',
    ),
    signature('installer_signature', 'Installer name and signature', true),
    date('installer_signed_at', 'Date', true),
  ]),
]);

export const CV09_LOG = form('CV09 System history and event log', [
  header(),
  section('log_meta', 'Log identity', [
    text('maintainer_telephone', 'Maintainer / service telephone'),
    text('log_reference', 'Log reference / continuation number'),
    area('instruction', 'Record activations, faults, maintenance, repairs, footage requests and alterations. Include the person recording the event and the linked work sheet. Do not write passwords, PINs or personal footage references in this log.'),
  ]),
  section('events', 'Events and visits', [
    text('event_datetime', 'Date / time', true),
    area('event_area', 'Event / affected cameras or recorder', true),
    text('action_ref', 'Action / report reference'),
    text('recorded_by', 'Recorded by', true),
  ], { repeatable: true }),
  section('open', 'Current unresolved items', [
    area('unresolved', 'Current unresolved items / next action'),
  ]),
]);

export const CV10_SUPPORT = form('CV10 Maintenance and support information', [
  header(),
  section('service', 'Service arrangements', [
    text('maintenance_provider', 'Maintenance provider', true),
    text('agreement_ref', 'Agreement reference / effective date'),
    text('service_telephone', 'Service telephone', true),
    text('emergency_telephone', 'Emergency / out-of-hours telephone'),
    text('support_email', 'Support email'),
    text('monitoring_provider', 'Monitoring provider / support reference or NA'),
    text('visit_frequency', 'Visit frequency / method'),
    date('first_service_due', 'First planned service due'),
    area('coverage', 'Coverage, attendance arrangements, exclusions and agreement attachment'),
  ]),
  section('documents', 'User documents and warranty', [
    text('user_manual_ref', 'User manual reference / revision'),
    text('quick_guide_logbook', 'Quick guide / logbook reference'),
    area('warranty', 'Warranty period, start date, scope and provider'),
    area('user_checks', 'User checks, privacy, footage requests and fault-reporting guidance'),
    area('advice', 'Keep cameras and views clear and follow the supplied operating instructions. Report faults promptly and record events in the logbook. Arrange changes through the maintainer. Do not store passwords on this sheet.'),
  ]),
  engineerSignOff(
    'Issued by',
    'I confirm this support information was issued with the handover pack. Customer receipt of this information is acknowledged on CV08.',
  ),
]);

export const CV11_RELEASE = form('CV11 O&M document index and technical release', [
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
    text('exception_ref', 'Signed acceptance / exception reference (CV15)'),
    area('note', 'Final release requires the company technical review and applicable evidence. An interim pack must identify its limitations. Attach the official issued certificate; this index is not a substitute certificate. These company forms are not NSI-issued.'),
  ]),
  reviewerSignOff('Technical release'),
]);

export const CV12_TAKEOVER = form('CV12 Takeover survey and condition record', [
  header(),
  section('survey', 'Survey', [
    text('survey_engineer', 'Survey engineer', true),
    date('survey_date', 'Date', true),
    text('previous_provider', 'Previous provider / unknown'),
    text('existing_stated_standard', 'Existing stated standard / evidence'),
    text('verified_standard', 'Verified standard / not verified'),
  ]),
  section('records', 'Records and equipment', [
    area('existing_records', 'Existing certificate, drawings, camera schedule, manuals and service history references'),
    area('missing_records', 'Missing records and actions to establish current as-fitted information'),
    area('retained_equipment', 'Retained recorders, cameras, network and equipment; compatibility / supportability'),
    area('inherited_faults', 'Inherited faults, inaccessible cameras, unverified views and limitations'),
    area('scope_inspected', 'Scope / areas inspected'),
    text('linked_records', 'Linked test and issue records'),
  ]),
  section('verification', 'Takeover verification', [
    select('engineering_access', 'Engineering access', ['available', 'partial', 'none'], true),
    text('remote_owner', 'Remote / cloud / VMS access owner'),
    area('cloud_transfer', 'Remote-access / cloud transfer process, timescale and charge basis'),
    area('testing_performed', 'Testing performed, exclusions, actual condition and supporting records'),
    area('remedial_scope', 'Remedial scope, temporary arrangements and customer notification'),
    text('cv15_ref', 'Customer acceptance reference (CV15) if the takeover is conditional or limited'),
    date('responsibility_starts', 'Incoming responsibility starts'),
    select('decision', 'Decision', ['proceed', 'conditional', 'remediate'], true),
    area('note', 'Existing paperwork and equipment markings are evidence to assess, not automatic confirmation of system compliance. Extra customer signature is on CV15 only where required.'),
  ]),
  engineerSignOff(
    'Survey engineer sign-off',
    'I confirm the basis and limits of the takeover decision recorded above.',
  ),
]);

export const CV13_UPGRADE = form('CV13 Upgrade and extension record', [
  header(),
  section('work', 'Work', [
    text('quote_variation', 'Quote / variation / agreed baseline', true),
    date('work_date', 'Work date', true),
    text('engineer_name', 'Engineer', true),
    area('reason_scope', 'Reason, agreed work and pre-work system record reference', true),
    text('cv15_ref', 'Customer acceptance reference (CV15) if design, coverage or tests change'),
  ]),
  section('scope', 'Scope reconciliation', [
    text('action_status', 'Action / status', true),
    text('equipment_location', 'Equipment / location / source line', true),
    text('quoted_qty', 'Quoted qty'),
    text('actual_qty', 'Actual qty', true),
  ], { repeatable: true }),
  section('effect', 'Compatibility and retesting', [
    area('compatibility', 'Compatibility and effect on coverage, recording, storage, network and operation'),
    area('regression', 'Affected existing cameras / recorders / interfaces and regression test references'),
    text('updated_as_fitted', 'Updated as-fitted revision'),
    text('issue_refs', 'Issues / CV06 references'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm the upgrade/extension work and retesting recorded above. Compatibility assessments are the engineer’s and company’s responsibility.',
  ),
  reviewerSignOff(),
]);

export const CV14_MAINTENANCE = form('CV14 Maintenance and corrective work record', [
  header(),
  section('visit', 'Visit', [
    select('visit_type', 'Visit', ['preventive', 'corrective', 'remote'], true),
    text('engineer_name', 'Engineer', true),
    date('visit_date', 'Date', true),
    text('arrival', 'Arrival'),
    text('departure', 'Departure'),
    text('work_order', 'Agreement / work-order reference'),
    select('state_on_arrival', 'System state on arrival', ['normal', 'fault', 'isolated', 'offline', 'not_checked', 'not_applicable'], true),
  ]),
  section('checks', 'Applicable checks and results', [
    ...check('as_fitted_available', 'As-fitted information available and changes identified'),
    ...check('camera_views', 'Camera siting, views and image performance checked'),
    ...check('recording_export', 'Recording, playback and export functions checked'),
    ...check('storage_time', 'Storage health, retention and date / time checked'),
    ...check('network_power', 'Network, PoE and power condition checked'),
    ...check('monitoring', 'Required monitoring / detector signals checked or marked NA'),
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
    text('monitoring_ack', 'Monitoring final service acknowledgement or NA'),
    area('note', 'Replacement and modified equipment must be tested to the extent necessary for the affected system. Routine customer signature for a completed visit is recorded on CV08, not on this sheet.'),
  ]),
  engineerSignOff(
    'Engineer sign-off',
    'I confirm this is an accurate record of attendance, work and system condition.',
  ),
]);

export const CV15_ACCEPTANCE = form('CV15 Customer acceptance of change, restriction or incomplete work', [
  header(),
  section('reason', 'Reason for extra customer acceptance', [
    select('acceptance_type', 'Acceptance type', [
      'design_change',
      'disconnected_or_reduced_coverage',
      'limitation_or_incomplete_test',
      'conditional_takeover',
      'other',
    ], true),
    text('linked_record', 'Linked record (CV06 / CV12 / CV13 / CV16)', true),
    date('raised_date', 'Date', true),
    area('acceptance_scope', 'The customer is asked to accept the recorded change from the agreed design, equipment left disconnected or coverage reduced, and/or other limitations or incomplete tests.', true),
    area('operational_effect', 'Operational effect, remaining risk and temporary arrangements'),
    area('outstanding_actions', 'Outstanding actions, owner and due date'),
    area('note', 'Use this form only where a change, restriction or incomplete work needs customer agreement. Routine handover acknowledgement remains on CV08. Customer acknowledgement does not establish technical compliance or close a failed test.'),
  ]),
  section('customer_acceptance', 'Customer acceptance', [
    signature('customer_signature', 'Customer name and signature', true),
    date('customer_signed_at', 'Date', true),
  ]),
  engineerSignOff(
    'Engineer / reviewer record',
    'I confirm the limitation or change described above has been explained to the customer. Technical disposition remains the company’s responsibility.',
  ),
]);

export const CV16_SURVEY = form('CV16 Survey and test plan', [
  header(),
  section('plan', 'Plan identity', [
    text('planner_name', 'Planner / survey engineer', true),
    date('plan_date', 'Date', true),
    select('work_type', 'Work type', ['new_installation', 'takeover', 'upgrade', 'extension', 'maintenance'], true),
    text('operational_requirement_ref', 'Operational requirement / design reference'),
    area('scope', 'Proposed survey / test scope, areas and cameras', true),
  ]),
  section('method', 'Method and resources', [
    area('methods', 'Approved procedures, image criteria, recording tests and monitoring tests to be used'),
    area('access_equipment', 'Access, permits, isolation and test equipment required'),
    area('exclusions', 'Known exclusions, constraints and customer-agreed limitations'),
    area('evidence_method', 'Customer agreement method / evidence (meeting record, email, signed instruction) — do not request a second signature solely to repeat CV08/CV15 approval'),
  ]),
  engineerSignOff(
    'Planner / engineer sign-off',
    'I confirm this plan describes the intended survey and tests. Results are recorded on the applicable CV sheets after the work is done.',
  ),
  reviewerSignOff(),
]);

export interface CctvPackForm {
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

export const CCTV_PACK_FORMS: CctvPackForm[] = [
  { key: 'cv01_as_fitted', code: 'CV01', name: 'CV01 As-fitted system record', description: 'Installed camera and recorder schedule. Engineer verification. Quoted qty is not installed proof.', schema: CV01_AS_FITTED, documentId: 'cv01_as_fitted', iconKey: 'file', required: true, displayOrder: 10 },
  { key: 'cv02_cameras', code: 'CV02', name: 'CV02 Camera and infrastructure record', description: 'Image, siting, network and power results. Engineer sign-off only.', schema: CV02_CAMERAS, documentId: 'cv02_cameras', iconKey: 'clipboard', displayOrder: 20 },
  { key: 'cv03_commissioning', code: 'CV03', name: 'CV03 Commissioning and verification', description: 'Commissioning checks and tests. Engineer sign-off only.', schema: CV03_COMMISSIONING, documentId: 'cv03_commissioning', iconKey: 'clipboard', displayOrder: 30 },
  { key: 'cv04_recording', code: 'CV04', name: 'CV04 Recording and export verification', description: 'Retention, playback and export tests. Engineer sign-off; customer results on CV08.', schema: CV04_RECORDING, documentId: 'cv04_recording', iconKey: 'clipboard', displayOrder: 40 },
  { key: 'cv05_monitoring', code: 'CV05', name: 'CV05 Remote monitoring verification', description: 'Use only for remotely monitored / detector-activated / BS 8418 systems. Engineer sign-off only.', schema: CV05_MONITORING, documentId: 'cv05_monitoring', iconKey: 'clipboard', displayOrder: 50 },
  { key: 'cv06_changes', code: 'CV06', name: 'CV06 Changes and remedial actions', description: 'Design changes, defects and limitations. Reviewer sign-off. Customer agreement is on CV15 where required.', schema: CV06_CHANGES, documentId: 'cv06_changes', iconKey: 'file', displayOrder: 60 },
  { key: 'cv07_training', code: 'CV07', name: 'CV07 Customer demonstration and training', description: 'Trainer record of demonstration. Customer acknowledgement is on CV08.', schema: CV07_TRAINING, documentId: 'cv07_training', iconKey: 'graduation', displayOrder: 70 },
  { key: 'cv08_handover', code: 'CV08', name: 'CV08 Completion and handover acceptance', description: 'The routine customer signature. Acknowledges demonstration, documents and operating status.', schema: CV08_HANDOVER, documentId: 'cv08_handover', iconKey: 'award', required: true, displayOrder: 80 },
  { key: 'cv09_log', code: 'CV09', name: 'CV09 System history and event log', description: 'Activations, faults and visits. No signature required.', schema: CV09_LOG, documentId: 'cv09_log', iconKey: 'file', displayOrder: 90 },
  { key: 'cv10_support', code: 'CV10', name: 'CV10 Maintenance and support information', description: 'Service contacts and warranty. Issued by the engineer; receipt is on CV08.', schema: CV10_SUPPORT, documentId: 'cv10_support', iconKey: 'file', displayOrder: 100 },
  { key: 'cv11_release', code: 'CV11', name: 'CV11 O&M index and technical release', description: 'Document completeness and company technical release. Reviewer sign-off.', schema: CV11_RELEASE, documentId: 'cv11_release', iconKey: 'clipboard', displayOrder: 110 },
  { key: 'cv12_takeover', code: 'CV12', name: 'CV12 Takeover survey and condition record', description: 'Inherited installation survey. Customer signs CV15 only if the takeover is conditional or limited.', schema: CV12_TAKEOVER, documentId: 'cv12_takeover', iconKey: 'clipboard', displayOrder: 120 },
  { key: 'cv13_upgrade', code: 'CV13', name: 'CV13 Upgrade and extension record', description: 'Change scope and retesting. Customer signs CV15 only for design changes or limitations.', schema: CV13_UPGRADE, documentId: 'cv13_upgrade', iconKey: 'clipboard', displayOrder: 130 },
  { key: 'cv14_maintenance', code: 'CV14', name: 'CV14 Maintenance and corrective work', description: 'Visit record. Engineer sign-off only.', schema: CV14_MAINTENANCE, documentId: 'cv14_maintenance', iconKey: 'clipboard', displayOrder: 140 },
  { key: 'cv15_acceptance', code: 'CV15', name: 'CV15 Customer acceptance of change or limitation', description: 'Extra customer signature only for design changes, reduced coverage or incomplete tests.', schema: CV15_ACCEPTANCE, documentId: 'cv15_acceptance', iconKey: 'award', displayOrder: 150 },
  { key: 'cv16_survey', code: 'CV16', name: 'CV16 Survey and test plan', description: 'Planned survey and tests. Engineer and reviewer; do not repeat CV08/CV15 signatures.', schema: CV16_SURVEY, documentId: 'cv16_survey', iconKey: 'clipboard', displayOrder: 160 },
];

const SCHEMA_BY_KEY: Record<string, SchemaCatalogue> = Object.fromEntries(
  CCTV_PACK_FORMS.map(item => [item.key, item.schema]),
);

const SCHEMA_ALIASES: Record<string, string> = {
  handover_cctv: 'cv08_handover',
  cctv_commissioning_sheet: 'cv03_commissioning',
  camera_schedule: 'cv01_as_fitted',
  nvr_dvr_configuration: 'cv04_recording',
  cctv_customer_training: 'cv07_training',
};

export function resolveCctvFormKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (SCHEMA_BY_KEY[key]) return key;
  return SCHEMA_ALIASES[key] ?? null;
}

export function getCctvFormSchema(key: string | null | undefined): SchemaCatalogue | null {
  const resolved = resolveCctvFormKey(key);
  return resolved ? SCHEMA_BY_KEY[resolved] : null;
}

export function isCctvPackFormKey(key: string | null | undefined): boolean {
  return Boolean(resolveCctvFormKey(key));
}

export function cctvPackTemplateList(): Array<{ key: string; name: string; description: string; fields: [] }> {
  return CCTV_PACK_FORMS.map(item => ({
    key: item.key,
    name: item.name,
    description: item.description,
    fields: [],
  }));
}
