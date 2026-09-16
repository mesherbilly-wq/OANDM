-- Restore SafetyCulture handover documents. Hide Pacific PDF packs and old IA/CV web forms.

UPDATE handover_document_definitions
SET
  is_active = false,
  sc_enabled = false,
  updated_at = now()
WHERE document_id IN (
  'sdp', 'ia01_completion', 'cc01_completion', 'ac01_completion',
  'nsi_certificate_cctv', 'nsi_certificate_intruder', 'nsi_certificate_ac',
  'ia01_as_fitted', 'ia02_readings', 'ia03_commissioning', 'ia04_arc', 'ia05_changes', 'ia06_training',
  'ia07_handover', 'ia08_log', 'ia09_support', 'ia10_release', 'ia11_takeover', 'ia12_upgrade',
  'ia13_transfer', 'ia14_maintenance', 'ia15_acceptance',
  'cv01_as_fitted', 'cv02_cameras', 'cv03_commissioning', 'cv04_recording', 'cv05_monitoring',
  'cv06_changes', 'cv07_training', 'cv08_handover', 'cv09_log', 'cv10_support', 'cv11_release',
  'cv12_takeover', 'cv13_upgrade', 'cv14_maintenance', 'cv15_acceptance', 'cv16_survey'
);

UPDATE handover_document_definitions
SET
  is_active = true,
  upload_only = false,
  sc_enabled = true,
  sc_template_id = CASE
    WHEN sc_template_id LIKE 'template_%' THEN sc_template_id
    ELSE NULL
  END,
  updated_at = now()
WHERE document_id IN (
  'handover_cctv', 'cctv_commissioning_sheet', 'cctv_customer_training',
  'handover_ac', 'ac_reader_test_sheet', 'ac_customer_training',
  'handover_intruder', 'handover_intruder_record', 'intruder_customer_training',
  'fire_commissioning_certificate', 'fire_detector_test_record', 'fire_customer_training',
  'handover_intercom', 'intercom_customer_training',
  'handover_anpr', 'anpr_customer_training',
  'handover_networking', 'networking_customer_training',
  'other_handover_certificate', 'other_customer_training',
  'handover_acceptance', 'handover_training'
);

UPDATE handover_document_definitions
SET
  is_active = true,
  sc_enabled = false,
  upload_only = false,
  updated_at = now()
WHERE document_id IN (
  'camera_schedule', 'nvr_dvr_configuration',
  'ac_door_schedule', 'ac_controller_configuration',
  'intruder_zone_list', 'intruder_bell_strobe_test', 'intruder_keyholder_confirmation',
  'fire_cause_effect', 'fire_zone_chart'
);

UPDATE handover_document_definitions
SET
  is_active = true,
  sc_enabled = false,
  upload_only = true,
  updated_at = now()
WHERE document_id IN ('nsi_certificate', 'rams');
