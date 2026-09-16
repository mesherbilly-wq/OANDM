import type { SchemaCatalogue, SchemaField, SchemaSection } from './schemaForm';

export const CCTV_PACK_STATUS = 'DRAFT — NOT VALIDATED FOR NSI COMPLIANCE';
export const CCTV_PACK_REVISION = '01';

const WORK_OPTIONS = ['new', 'takeover', 'upgrade', 'extension'];
const TOPIC_STATUS = ['Done', 'Outstanding', 'NA'];
const PRESENCE = ['Present', 'Pending', 'NA'];
const CODES_NOTE = 'Codes: P pass, F fail, NT not tested, NA not applicable. Right columns: result, then reference.';

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

export const CV01_AS_FITTED = form('CV01 User requirements and as-fitted system record', [
  header([
    text('customer_organisation', 'Customer / responsible organisation'),
    text('customer_representative', 'Authorised representative'),
    area('installation_address', 'Installation address (site, not billing address)'),
    text('simpro_job_id', 'Simpro company / job ID'),
    text('quote_id', 'Quote ID / agreed baseline snapshot'),
    text('as_fitted_reference', 'CV01 reference / revision'),
    select('work_type', 'Work: new / takeover / upgrade / extension', WORK_OPTIONS),
  ]),
  section('requirements', 'A. AGREED OPERATIONAL REQUIREMENTS', [
    area('purpose_tasks', 'Purpose, risks, protected areas, users and required camera tasks'),
    text('cv16_revision', 'CV16 / user-requirements revision'),
    text('customer_agreement_ref', 'Customer agreement reference / date'),
    area('applicable_standards', 'Applicable standards / editions, monitoring route and project requirements'),
    area('scope_limits', 'Scope limits, excluded areas and quote variations'),
  ]),
  section('schedule_meta', '', [
    text('schedule_reference', 'Schedule reference / continuation number'),
    text('drawing_revisions', 'As-fitted drawings / revisions'),
    note(
      'schedule_note',
      'Confirm actual equipment and quantities. Link camera IDs to CV02; identify recorders, storage, switches, power supplies and monitors. Record removed items in CV06 / CV13 rather than presenting them as installed.',
    ),
  ]),
  section('equipment', 'B. EQUIPMENT SCHEDULE', [
    text('asset_id', 'Asset ID'),
    text('location_use', 'Location / use'),
    text('type_make_model', 'Type / make / model'),
    text('qty_serial', 'Qty / serial ref'),
    text('firmware_config_ref', 'Firmware / config ref'),
  ], { repeatable: true }),
  section('schedule_close', '', [
    area('serial_drawing_refs', 'Serial / firmware register, cabling and network drawing references'),
    text('verified_by', 'Verified by'),
    date('verification_date', 'Verification date'),
  ]),
  section('arrangements', 'C. ACTUAL SYSTEM ARRANGEMENTS', [
    area('recorder_vms', 'Recorder / VMS, storage architecture, licences and camera allocation'),
    area('viewing_access', 'Viewing, remote access, alarm integration and monitoring arrangements'),
    text('retention_requirement', 'Retention requirement / source'),
    text('recording_export_ref', 'Recording / export tests CV04 reference'),
    area('network_power', 'Network / power architecture and relevant interface responsibilities'),
    area('privacy_roles', 'Authorised privacy masks, audio, access roles and policy reference'),
    text('user_instructions', 'User instructions / drawing revisions'),
    text('cv06_ref', 'CV06 changes / limitations reference'),
  ]),
  section('engineer_signoff', '', [
    note(
      'declaration',
      'I confirm this is the actual system record for the stated scope. Unverified items and differences from the agreed design are identified. No passwords or access secrets are recorded here.',
    ),
    text('engineer_name', 'Engineer name'),
    date('signed_at', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed-record reference'),
  ]),
]);

export const CV02_CAMERAS = form('CV02 Camera performance and infrastructure readings', [
  header([
    text('cv02_reference', 'CV02 reference / revision'),
    text('engineer_test_date', 'Engineer / test date'),
    note(
      'method_note',
      'Complete a row per camera. Record the agreed viewing task and target area; use a referenced acceptance method from the applicable standard and user requirements. Settings alone do not prove image performance.',
    ),
  ]),
  section('camera_settings', 'A. CAMERA SCHEDULE AND SETTINGS', [
    text('camera_location', 'Camera / location'),
    text('required_task', 'Required task / target'),
    text('lens_view_aim', 'Lens / view / aim'),
    text('pixels_fps', 'Recorded pixels / fps'),
    text('codec_rate_mode', 'Codec / rate / mode'),
  ], { repeatable: true }),
  section('settings_refs', '', [
    area('privacy_ptz_analytics', 'Privacy-mask, audio, PTZ preset and analytics configuration references'),
    area('acceptance_criteria', 'Acceptance criteria / applicable edition and test target method'),
  ]),
  section('performance_meta', '', [
    text('camera_asset_id', 'Camera / asset ID'),
    text('test_datetime_engineer', 'Test date / time / engineer'),
    text('task_location_distance', 'Required task / location / distance'),
    text('target_method_ref', 'Target / method / acceptance reference'),
  ]),
  section('conditions', 'B. ACTUAL PERFORMANCE AND EVIDENCE', [
    text('condition', 'Condition'),
    text('live_image_result', 'Observed live image / result'),
    text('playback_result', 'Recorded playback / result'),
    text('evidence_ref', 'Evidence reference'),
  ], {
    repeatable: true,
    note: 'Include the applicable day, night, backlight, motion and lighting conditions. If a condition cannot be tested, record it as not tested and arrange completion; do not infer a night result from a daytime image.',
  }),
  section('performance_close', '', [
    area('measured_result', 'Measured result / units, target detail, scene lighting and achieved task'),
    area('obstructions', 'Obstructions, image limitations, failures and retest references'),
    text('cv03_cv06_refs', 'CV03 result / CV06 issue references'),
    text('engineer_verification_date', 'Engineer verification / date'),
  ]),
  section('infra_meta', '', [
    text('switch_psu_asset', 'Switch / PSU / UPS / link asset'),
    text('location_engineer_date', 'Location / engineer / date'),
  ]),
  section('infra_tests', 'C. MEASUREMENTS AND EVIDENCE', [
    text('item_test', 'Item / test'),
    text('acceptance_limit', 'Acceptance limit / method'),
    text('actual_reading', 'Actual reading / units'),
    text('result_evidence', 'Result / evidence'),
  ], {
    repeatable: true,
    note: 'Use applicable tests: camera supply, PoE allocation and headroom, link performance, network load, UPS duty and power failure / restoration. Attach electrical certificates and detailed calculations where required.',
  }),
  section('infra_close', '', [
    text('design_measured_load', 'Design load / measured load / units'),
    text('ups_duty', 'UPS duty required / demonstrated'),
    text('instrument_cal', 'Instrument / calibration reference'),
    text('electrical_certificate', 'Electrical certificate / edition'),
    area('exceptions', 'Exceptions, battery details, capacity calculations and retest references'),
    signature('engineer_signature', 'Engineer signature / date', false),
    text('cv08_receipt_ref', 'Receipt / test sign-off reference CV08'),
  ]),
]);

export const CV03_COMMISSIONING = form('CV03 Commissioning and system validation', [
  header([
    text('cv03_reference', 'CV03 reference / revision'),
    text('engineer_test_date', 'Engineer / test date'),
    text('user_as_fitted_revision', 'User requirements / as-fitted revision'),
    text('procedure_edition', 'Approved test procedure / edition'),
  ]),
  section('installation', 'A. INSTALLATION AND IMAGE TESTS', [
    check('scope_reconciled', 'Installed equipment and coverage reconciled with agreed requirements'),
    check('mounting_cabling', 'Mounting, cabling, supports and electrical evidence checked'),
    check('camera_identity', 'Camera identity, view, focus and required task verified'),
    check('day_night_cv02', 'Recorded day / night and applicable scene tests evidenced in CV02'),
    check('privacy_audio', 'Privacy masks, authorised audio and excluded areas checked'),
    check('ptz_analytics', 'PTZ, presets and analytics tested against their agreed purpose'),
    check('monitor_views', 'Monitor / display image quality and operator views verified'),
    check('interfaces', 'Interfaces and affected retained equipment tested end to end'),
    area('detailed_results', 'Detailed procedures, expected / actual results and test evidence references'),
    area('failures', 'Failures, untested conditions and linked CV06 issues'),
  ], { note: CODES_NOTE }),
  section('verification', 'B. SYSTEM VERIFICATION', [
    check('recording_modes', 'Recording modes, schedules and camera allocations verified'),
    check('playback_export_cv04', 'Playback, search and export independently tested (CV04)'),
    check('retention_capacity', 'Retention / capacity evidence supports the agreed requirement'),
    check('datetime_sync', 'Date, time, synchronisation and time-zone handling checked'),
    check('user_roles', 'User roles, authentication and remote-access responsibilities verified'),
    check('video_loss_recovery', 'Video loss, storage / power faults and recovery tested'),
    check('monitoring_cv05', 'Required monitoring functions tested with receiving centre (CV05)'),
    check('test_modes_cleared', 'Test modes cleared and final operating state recorded'),
    area('test_reports', 'Test reports, exceptions and retest evidence'),
    select('final_state', 'Final state: operational / limited / not live', ['operational', 'limited', 'not live']),
    text('cv06_cv15_ref', 'CV06 unresolved items / CV15 agreement'),
  ], { note: CODES_NOTE }),
  section('engineer_signoff', '', [
    note(
      'declaration',
      'Engineer declaration: these results accurately record the tests I performed. Untested work and failures are identified. Customer sign-off of the referenced results is recorded on CV08.',
    ),
    text('engineer_name', 'Engineer name'),
    date('signed_at', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed-record reference'),
  ]),
]);

export const CV04_RECORDING = form('CV04 Recording, retention and export verification', [
  header([
    text('cv04_reference', 'CV04 reference / revision'),
    text('recorder_asset', 'Recorder / VMS / storage asset'),
    text('required_retention', 'Required retention / requirement reference'),
    text('recording_mode', 'Recording mode / schedule / camera count'),
  ]),
  section('capacity', 'A. CAPACITY AND RECORDING', [
    text('usable_capacity', 'Usable recording capacity / units'),
    text('codec_bitrate', 'Codec / bitrate basis / recording duty'),
    area('capacity_method', 'Capacity method, assumptions, overheads and supporting calculation'),
    text('calculated_retention', 'Calculated retention / conditions'),
    text('oldest_newest', 'Oldest / newest accessible footage'),
    text('check_datetime', 'Date / time of actual check'),
    text('evidence_period', 'Evidence period since commissioning'),
    note('capacity_codes', CODES_NOTE),
    check('cameras_recording', 'All intended cameras recording at agreed settings'),
    check('playback_gaps', 'Playback available without unexplained gaps in checked interval'),
    check('storage_fault', 'Storage fault / full-disk / overwrite behaviour verified'),
    area('retention_vs_forecast', 'Observed retention versus forecast; gaps, untested duration and follow-up'),
  ]),
  section('export_meta', '', [
    text('engineer_test_date', 'Engineer / test date'),
    text('test_clip_id', 'Test clip ID / cameras / event time'),
  ]),
  section('export', 'B. EVIDENCE HANDLING CHECKS', [
    check('search_playback', 'Search / playback retrieves the selected camera and time'),
    check('export_clip', 'Export produces the intended clip and required metadata'),
    check('independent_replay', 'Export replayed on an independent authorised device / player'),
    check('datetime_agrees', 'Date / time / time zone agree with the known test event'),
    check('image_detail', 'Image detail remains suitable in playback and export'),
    check('export_permissions', 'Export permissions, audit trail and authorised access verified'),
    area('export_format', 'Export format, player/version, destination and independent playback result'),
    area('integrity_refs', 'Timestamp offset / integrity checks / evidence references and limitations'),
    note(
      'note',
      'Use authorised test images and approved storage. Record references to evidence rather than adding unnecessary personal footage to the general O&M pack.',
    ),
    signature('engineer_signature', 'Engineer signature / date', false),
    text('cv08_ref', 'Customer results sign-off CV08 ref'),
  ], { note: CODES_NOTE }),
]);

export const CV05_MONITORING = form('CV05 Remote monitoring and alarm verification', [
  header([
    text('cv05_reference', 'CV05 reference / revision'),
    text('receiving_centre', 'Receiving centre / account reference'),
    text('standard_profile', 'Applicable standard / monitoring profile'),
    text('engineer_operator_booking', 'Engineer / centre operator / test booking'),
  ]),
  section('signals', 'A. ALARM AND TRANSMISSION FUNCTIONS', [
    text('trigger_device', 'Trigger / device'),
    text('expected_response', 'Expected response / image'),
    text('receipt_time', 'Receipt time / operator ref'),
    check('result', 'Result / evidence'),
  ], {
    repeatable: true,
    note: 'Record the actual trigger and the image / information received. A working remote-view app does not establish detector-activated monitoring or police response.',
  }),
  section('alignment', '', [
    area('detection_alignment', 'Detection / analytics alignment, alarm image coverage and verification procedure'),
    area('missing_functions', 'Missing functions, failed signals and retest references'),
  ]),
  section('paths', 'B. PATHS AND SERVICE STATE', [
    text('path_fault_restore', 'Path / fault / restore'),
    text('required_response', 'Required response / limit'),
    area('actual_result', 'Actual result / centre ref'),
  ], { repeatable: true }),
  section('response', '', [
    area('site_procedures', 'Site operating / arming procedures'),
    area('audio_challenge', 'Audio challenge / response arrangements'),
    text('police_force_policy', 'Police force / applicable policy'),
    text('urn_evidence', 'Response / URN evidence or NA'),
    select('final_service', 'Final service: live / pending / restricted', ['live', 'pending', 'restricted']),
    text('test_mode_ended', 'Test mode ended: date / centre ref'),
    area('outstanding', 'Outstanding activation / coverage limits, owner, due date and customer notice'),
    note(
      'restricted_note',
      'Keep keyholder data and access secrets in the restricted service record. Do not record response as active without supporting evidence.',
    ),
    text('engineer_name', 'Engineer name'),
    date('signed_at', 'Date / time'),
    signature('engineer_signature', 'Engineer signature / signed-record reference', false),
  ]),
]);

export const CV06_CHANGES = form('CV06 Changes, defects and remedial actions', [
  header([
    text('issue_reference', 'Issue reference / revision'),
    text('date_raised_by', 'Date / raised by'),
    select('issue_type', 'Type: change / defect / untested / restriction', ['change', 'defect', 'untested', 'restriction']),
    select('status', 'Status: open / action / retest / closed', ['open', 'action', 'retest', 'closed']),
    area('description', 'Description, affected cameras / assets and original versus actual scope'),
    area('operational_effect', 'Effect on coverage, image task, recording, privacy or monitoring'),
    area('required_action', 'Required action, temporary arrangements and acceptance criterion'),
    text('responsible_person', 'Responsible person'),
    date('due_date', 'Due date'),
    text('customer_notified', 'Customer notified / date'),
    text('cv15_ref', 'Specific agreement CV15 ref or NA'),
    area('technical_disposition', 'Technical disposition, retest evidence and closure'),
    note(
      'note',
      'Customer agreement does not turn a failed technical test into a pass or waive a required standard. Retain the original finding and linked corrective evidence.',
    ),
    signature('reviewer_signature', 'Technical reviewer / signature', false),
    date('reviewed_at', 'Date'),
  ]),
]);

export const CV07_TRAINING = form('CV07 Customer demonstration and training', [
  header([
    text('cv07_reference', 'CV07 reference / revision'),
    text('event_reference', 'Event reference / date'),
    text('trainee_name_role', 'Trainees / roles or attendance-list ref'),
    text('trainer_name', 'Trainer name'),
  ]),
  section('topics', 'A. DEMONSTRATION AND PRACTICE', [
    text('topic', 'Topic'),
    select('status', 'Status', TOPIC_STATUS),
    area('notes', 'Notes / reference'),
  ], { repeatable: true, note: 'Record Done / Outstanding / NA and the relevant manual section or limitation.' }),
  section('follow_up', '', [
    area('outstanding_training', 'User-manual references, outstanding training and responsible person'),
    note(
      'note',
      'I confirm the attendance and instruction recorded. The customer acknowledges the applicable training and handover on CV08 for this event; no repeat trainee signature is requested here.',
    ),
    signature('trainer_signature', 'Trainer signature / date', false),
    text('cv08_ref', 'Current-event CV08 reference'),
  ]),
]);

export const CV08_HANDOVER = form('CV08 Customer test sign-off and handover', [
  header([
    text('customer_name_role', 'Customer name / authorised role'),
    date('commissioning_date', 'Event / commissioning date'),
    text('cv08_reference', 'CV08 event / handover reference'),
    text('completion_scope', 'Scope / areas / stage covered'),
  ]),
  section('documents', 'A. DOCUMENTS - REFERENCE AND REVISION OR NA', [
    text('cv01_ref', 'CV01 user needs / as-fitted record'),
    text('cv02_ref', 'CV02 image / infrastructure results'),
    text('cv03_ref', 'CV03 commissioning results'),
    text('cv04_ref', 'CV04 recording / export results'),
    text('cv05_ref', 'CV05 monitoring results or NA'),
    text('cv07_cv10_ref', 'CV07 training / CV10 support records'),
    text('cv11_ref', 'CV11 document index / user manuals'),
    select('system_state', 'System state: operational / limited / not live', ['operational', 'limited', 'not live']),
    select('monitoring_state', 'Monitoring: live / pending / NA', ['live', 'pending', 'NA']),
    text('cv15_ref', 'CV15 changes / restrictions ref or none'),
  ]),
  section('customer_acceptance', '', [
    note(
      'acknowledgement_text',
      'Customer sign-off: I confirm the identified test results were presented and explained to me and sign off those results for the stated scope, subject to CV15. I acknowledge the applicable training, documents and secure access handover recorded in this pack. This signature does not certify the accuracy of engineer measurements or assume the installer technical responsibilities.',
    ),
    signature('customer_signature', 'Customer signature'),
    date('customer_signed_at', 'Date / time'),
    note(
      'installer_text',
      'Engineer: I confirm the stated results and handover record are accurate. Changes and unresolved items are identified above. Technical responsibility remains with the company and its appointed personnel.',
    ),
    signature('installer_signature', 'Engineer name / signature'),
    date('installer_signed_at', 'Date / time'),
  ]),
]);

export const CV09_LOG = form('CV09 System history and event log', [
  header([
    text('maintainer_telephone', 'Maintainer / service telephone'),
    text('log_reference', 'Log reference / continuation number'),
    note(
      'instruction',
      'Record faults, visits, configuration changes, repairs and relevant incidents. Identify affected cameras / assets and associated work records. Keep personal footage and access secrets in authorised separate storage.',
    ),
  ]),
  section('events', 'A. EVENTS AND ACTIONS', [
    text('event_datetime', 'Date / time'),
    area('event_area', 'Event / assets affected'),
    text('action_ref', 'Action / evidence reference'),
    text('recorded_by', 'Recorded by'),
  ], { repeatable: true }),
  section('open', '', [
    area('unresolved', 'Unresolved items and next actions'),
  ]),
]);

export const CV10_SUPPORT = form('CV10 Maintenance and support information', [
  header(),
  section('service', 'A. SERVICE CONTACTS', [
    text('maintenance_provider', 'Maintaining company'),
    text('agreement_ref', 'Agreement / effective date'),
    text('service_telephone', 'Service telephone'),
    text('emergency_telephone', 'Out-of-hours / emergency support'),
    text('support_email', 'Support email'),
    text('monitoring_provider', 'Monitoring centre / reference or NA'),
    text('visit_frequency', 'Planned visit frequency / method'),
    date('first_service_due', 'First service due'),
    area('coverage', 'Service coverage, attendance arrangements and exclusions'),
  ]),
  section('documents', 'B. DOCUMENTS, LICENCES AND WARRANTY', [
    text('user_manual_ref', 'User manual / quick guide references'),
    text('cv08_ref', 'Training / current-event CV08 ref'),
    area('licences', 'Licence / subscription owner, expiry / renewal and support responsibilities'),
    area('warranty', 'Warranty provider, start date, period and limitations'),
    note(
      'advice',
      'Report image loss, recording faults and changes to camera views promptly. Follow the supplied operating instructions and authorised retention / export procedures. Keep the system record current after alterations.',
    ),
    text('issued_by_date', 'Issued by / date'),
    text('delivery_receipt_ref', 'Delivery / receipt reference'),
  ]),
]);

export const CV11_RELEASE = form('CV11 O&M document index and technical release', [
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
    area('missing', 'Missing evidence, certificate number / issuer / date or applicability decision'),
    select('release_type', 'Decision: return / interim / final', ['return', 'interim', 'final']),
    text('exception_ref', 'CV08 / CV15 acceptance references'),
    note(
      'note',
      'An interim pack must identify its limitations. Confirm applicable technical tests and customer sign-off before final release. Attach the official issued certificate where required; this index is not a certificate.',
    ),
    signature('reviewer_signature', 'Reviewer signature', false),
    text('release_date_recipient', 'Release date / recipient'),
  ]),
]);

export const CV12_TAKEOVER = form('CV12 Takeover and provider transfer record', [
  header([
    text('survey_engineer_date', 'Survey engineer / date'),
    text('previous_provider', 'Previous provider / unknown'),
    text('existing_stated_standard', 'Existing standard / certificate evidence'),
    text('user_requirements_ref', 'Current user-requirements reference'),
  ]),
  section('records', 'A. CONDITION AND RECORDS', [
    area('existing_records', 'Existing plans, equipment lists, manuals, commissioning and service history'),
    area('retained_equipment', 'Panel / recorder / VMS, camera compatibility, support and licence ownership'),
    area('existing_condition', 'Existing image / recording condition, missing footage and unresolved faults'),
    area('inaccessible', 'Inaccessible assets, missing records and unverified performance / restrictions'),
    area('scope_inspected', 'Survey scope / areas inspected'),
    text('linked_records', 'CV02-05 tests / CV06 issue references'),
  ]),
  section('verification', 'B. TRANSFER AND VERIFICATION', [
    text('incoming_provider', 'Incoming provider / effective date'),
    text('customer_authority_ref', 'Customer authority / event reference'),
    area('access_transfer', 'Access and account ownership, remote services, licences and secure transfer refs'),
    area('outgoing_review', 'Outgoing access review, records / footage custody and retention instructions'),
    text('monitoring_transfer_ref', 'Monitoring transfer / CV05 reference'),
    text('interruption_ref', 'Interruption / temporary coverage ref'),
    area('responsibilities', 'Responsibilities, transfer verification and outstanding actions / due dates'),
    select('decision', 'Decision: proceed / conditional / remediate', ['proceed', 'conditional', 'remediate']),
    text('cv08_cv15_ref', 'Current-event CV08 / CV15 reference'),
    note(
      'note',
      'Record the technical evidence and limits of the takeover. Prior certification or a live camera image alone does not establish the current system performance or recording capability.',
    ),
    text('survey_engineer_name', 'Survey engineer name'),
    date('signed_at', 'Date / time'),
    signature('engineer_signature', 'Survey engineer signature / signed-record reference', false),
  ]),
]);

export const CV13_UPGRADE = form('CV13 Upgrade and extension record', [
  header([
    text('quote_variation', 'Quote / agreed variation / baseline'),
    text('work_date_engineer', 'Work date / engineer'),
    area('reason_scope', 'Reason, agreed work and pre-work system record revision'),
  ]),
  section('scope', 'A. SCOPE RECONCILIATION', [
    select('action_status', 'Action / status', ['added', 'retained', 'removed', 'replaced', 'NA']),
    text('equipment_location', 'Camera / asset / quote line'),
    text('quoted_actual_qty', 'Quoted / actual quantity'),
  ], { repeatable: true }),
  section('effect', '', [
    area('compatibility', 'Compatibility, VMS / licence impact, network / power and storage assessment'),
    area('regression', 'Affected views, recording, privacy / interfaces and regression test references'),
    text('updated_as_fitted', 'Updated as-fitted revision'),
    text('issue_refs', 'CV06 issues / CV15 change acceptance'),
    signature('engineer_signature', 'Engineer signature / date', false),
    text('technical_review_date', 'Technical reviewer / date'),
  ]),
]);

export const CV14_MAINTENANCE = form('CV14 Maintenance and corrective work record', [
  header([
    text('visit_reference_type_date', 'Visit reference / type / date'),
    text('engineer_times', 'Engineer / arrival / departure'),
    text('work_order', 'Agreement / work-order reference'),
    text('state_on_arrival', 'System state on arrival'),
  ]),
  section('checks', 'A. APPLICABLE CHECKS', [
    check('user_needs_reviewed', 'User needs, scene changes and as-fitted information reviewed'),
    check('cameras_inspected', 'Cameras, housings, mounts and accessible cabling inspected'),
    check('views_privacy', 'Views, focus, image tasks and authorised privacy masks checked'),
    check('day_night', 'Applicable day / night evidence and lighting condition assessed'),
    check('recording_export', 'Recording, accessible retention, playback and export checked'),
    check('time_storage', 'Time, storage / power faults and recovery verified'),
    check('monitoring', 'Remote services / monitoring tested where included in scope'),
    check('firmware_licences', 'Relevant firmware / licences / access responsibilities reviewed'),
    area('reported_problem', 'Customer-reported problem, inaccessible equipment and test limitations'),
  ], { note: CODES_NOTE }),
  section('work', '', [
    area('diagnosis', 'Diagnosis, configuration changes and corrective work'),
  ]),
  section('parts', '', [
    text('part', 'Part / setting changed'),
    text('asset_location', 'Camera / asset / location'),
    text('retest_result', 'Retest / actual result'),
  ], { repeatable: true }),
  section('close', '', [
    area('outstanding', 'Remaining faults / untested items, operational effect and customer agreement'),
    text('final_state', 'Final system / monitoring state'),
    text('isolations_restored', 'Test modes / temporary changes cleared'),
    text('next_action', 'Next action owner / due date'),
    text('cv08_cv15_ref', 'Current-visit receipt / CV15 ref'),
    note(
      'note',
      'Test modified equipment and affected functions. For preventive maintenance, obtain current-visit customer acknowledgment on CV08 or an approved equivalent referencing this record. Do not reuse the installation signature.',
    ),
    signature('engineer_signature', 'Engineer signature / date', false),
    text('work_report_ref', 'Evidence / work-report reference'),
  ]),
]);

export const CV15_ACCEPTANCE = form('CV15 Conditional customer acceptance', [
  header([
    text('acceptance_reference', 'Acceptance reference / revision'),
    text('cv08_ref', 'Current event / CV08 reference'),
    select('acceptance_type', 'Type: design change / restriction / untested', ['design change', 'restriction', 'untested']),
    text('cv06_items', 'CV06 items / document revisions'),
    area('acceptance_scope', 'Specific change, unavailable camera / recording, untested work or exception'),
    area('operational_effect', 'Effect on image task, coverage, recording, monitoring or authorised privacy controls'),
    area('agreed_action', 'Agreed action, temporary arrangements, responsible person and due date'),
    text('effective_at', 'Effective date / time'),
    text('restoration_due', 'Restoration / retest / review due'),
    note(
      'note',
      'I specifically agree to the identified changes and acknowledge the stated restrictions or incomplete work and their explained effects. This acceptance applies only to the listed items and revisions. It does not certify technical accuracy, waive required compliance or convert an unresolved test into a pass.',
    ),
    text('customer_name_role', 'Customer name / authorised role'),
    signature('customer_signature', 'Customer signature / date'),
    signature('engineer_signature', 'Engineer name / signature', false),
    date('signed_at', 'Date / time'),
    note(
      'omit_note',
      'Omit if not applicable. Reference existing signed agreement if it covers these same items and revisions. Notification or silence must not be treated as consent.',
    ),
  ]),
]);

export const CV16_SURVEY = form('CV16 Site survey, risk review and agreed test plan', [
  header([
    text('cv16_reference', 'CV16 reference / revision'),
    text('surveyor_contact', 'Surveyor / date / customer contact'),
    text('risk_assessment_ref', 'Customer risk assessment reference or none'),
    text('site_plan_refs', 'Site plan / area references'),
  ]),
  section('requirements', 'A. REQUIREMENTS AND SITE CONDITIONS', [
    area('purpose', 'Purpose, incidents / threats, assets at risk and required operator response'),
    area('areas_tasks', 'Areas, camera tasks, target activity and operational hours'),
    area('lighting', 'Lighting by time, glare, obstructions, weather and environment'),
    area('infrastructure', 'Infrastructure, mounting / access, communications and recording constraints'),
    area('privacy', 'Privacy / audio restrictions, customer decisions and approved requirement refs'),
    text('reviewed_with_customer', 'Reviewed with customer / date'),
    text('agreed_requirement_evidence', 'Agreed requirement / approval evidence'),
  ]),
  section('method', '', [
    text('test_plan_revision', 'Test-plan reference / revision'),
    text('user_requirements_revision', 'User requirements / design revision'),
  ]),
  section('tests', 'B. AGREED VERIFICATION PLAN', [
    text('requirement_camera', 'Requirement / camera'),
    text('test_method', 'Test method / conditions'),
    text('pass_criterion', 'Pass criterion / source'),
    text('planned_time_owner', 'Planned time / owner'),
  ], {
    repeatable: true,
    note: 'Identify each requirement, test method, applicable edition, conditions and pass criterion before testing. Include representative illumination across the operational period, recording and export, power / network recovery, access and monitoring where applicable.',
  }),
  section('agreement', '', [
    area('evidence_naming', 'Reference image naming, evidence storage and linked result records'),
    text('plan_agreed_date', 'Plan agreed with customer / date'),
    text('agreement_method', 'Agreement method / evidence reference'),
    text('reviewer_name', 'Engineer / technical reviewer'),
    text('procedure_revision_date', 'Date / procedure revision'),
    note(
      'note',
      'Approval can reference an already agreed design / test plan; do not request another signature solely to repeat that approval. Obtain agreement to material changes before using revised criteria.',
    ),
  ]),
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
  { key: 'cv01_as_fitted', code: 'CV01', name: 'CV01 User requirements and as-fitted system record', description: 'Installed camera and recorder schedule. Engineer verification. Quoted qty is not installed proof.', schema: CV01_AS_FITTED, documentId: 'cv01_as_fitted', iconKey: 'file', required: true, displayOrder: 10 },
  { key: 'cv02_cameras', code: 'CV02', name: 'CV02 Camera performance and infrastructure readings', description: 'Image, siting, network and power results. Engineer sign-off only.', schema: CV02_CAMERAS, documentId: 'cv02_cameras', iconKey: 'clipboard', displayOrder: 20 },
  { key: 'cv03_commissioning', code: 'CV03', name: 'CV03 Commissioning and system validation', description: 'Commissioning checks and tests. Engineer sign-off only.', schema: CV03_COMMISSIONING, documentId: 'cv03_commissioning', iconKey: 'clipboard', displayOrder: 30 },
  { key: 'cv04_recording', code: 'CV04', name: 'CV04 Recording, retention and export verification', description: 'Retention, playback and export tests. Engineer sign-off; customer results on CV08.', schema: CV04_RECORDING, documentId: 'cv04_recording', iconKey: 'clipboard', displayOrder: 40 },
  { key: 'cv05_monitoring', code: 'CV05', name: 'CV05 Remote monitoring and alarm verification', description: 'Use only for remotely monitored / detector-activated / BS 8418 systems. Engineer sign-off only.', schema: CV05_MONITORING, documentId: 'cv05_monitoring', iconKey: 'clipboard', displayOrder: 50 },
  { key: 'cv06_changes', code: 'CV06', name: 'CV06 Changes, defects and remedial actions', description: 'Design changes, defects and limitations. Reviewer sign-off. Customer agreement is on CV15 where required.', schema: CV06_CHANGES, documentId: 'cv06_changes', iconKey: 'file', displayOrder: 60 },
  { key: 'cv07_training', code: 'CV07', name: 'CV07 Customer demonstration and training', description: 'Trainer record of demonstration. Customer acknowledgement is on CV08.', schema: CV07_TRAINING, documentId: 'cv07_training', iconKey: 'graduation', displayOrder: 70 },
  { key: 'cv08_handover', code: 'CV08', name: 'CV08 Customer test sign-off and handover', description: 'The routine customer signature. Acknowledges demonstration, documents and operating status.', schema: CV08_HANDOVER, documentId: 'cv08_handover', iconKey: 'award', required: true, displayOrder: 80 },
  { key: 'cv09_log', code: 'CV09', name: 'CV09 System history and event log', description: 'Activations, faults and visits. No signature required.', schema: CV09_LOG, documentId: 'cv09_log', iconKey: 'file', displayOrder: 90 },
  { key: 'cv10_support', code: 'CV10', name: 'CV10 Maintenance and support information', description: 'Service contacts and warranty. Issued by the engineer; receipt is on CV08.', schema: CV10_SUPPORT, documentId: 'cv10_support', iconKey: 'file', displayOrder: 100 },
  { key: 'cv11_release', code: 'CV11', name: 'CV11 O&M document index and technical release', description: 'Document completeness and company technical release. Reviewer sign-off.', schema: CV11_RELEASE, documentId: 'cv11_release', iconKey: 'clipboard', displayOrder: 110 },
  { key: 'cv12_takeover', code: 'CV12', name: 'CV12 Takeover and provider transfer record', description: 'Inherited installation survey. Customer signs CV15 only if the takeover is conditional or limited.', schema: CV12_TAKEOVER, documentId: 'cv12_takeover', iconKey: 'clipboard', displayOrder: 120 },
  { key: 'cv13_upgrade', code: 'CV13', name: 'CV13 Upgrade and extension record', description: 'Change scope and retesting. Customer signs CV15 only for design changes or limitations.', schema: CV13_UPGRADE, documentId: 'cv13_upgrade', iconKey: 'clipboard', displayOrder: 130 },
  { key: 'cv14_maintenance', code: 'CV14', name: 'CV14 Maintenance and corrective work record', description: 'Visit record. Engineer sign-off only.', schema: CV14_MAINTENANCE, documentId: 'cv14_maintenance', iconKey: 'clipboard', displayOrder: 140 },
  { key: 'cv15_acceptance', code: 'CV15', name: 'CV15 Conditional customer acceptance', description: 'Extra customer signature only for design changes, reduced coverage or incomplete tests.', schema: CV15_ACCEPTANCE, documentId: 'cv15_acceptance', iconKey: 'award', displayOrder: 150 },
  { key: 'cv16_survey', code: 'CV16', name: 'CV16 Site survey, risk review and agreed test plan', description: 'Planned survey and tests. Engineer and reviewer; do not repeat CV08/CV15 signatures.', schema: CV16_SURVEY, documentId: 'cv16_survey', iconKey: 'clipboard', displayOrder: 160 },
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
