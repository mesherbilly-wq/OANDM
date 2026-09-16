-- Turn off browser forms. Handover uses the Pacific PDF packs only.

UPDATE handover_document_definitions
SET
  sc_enabled = false,
  sc_template_id = NULL,
  updated_at = now()
WHERE sc_enabled = true
   OR sc_template_id IS NOT NULL;

UPDATE handover_document_definitions
SET
  is_active = false,
  sc_enabled = false,
  sc_template_id = NULL,
  updated_at = now()
WHERE document_id IN (
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
  required = true,
  updated_at = now()
WHERE document_id IN ('sdp', 'ia01_completion', 'cc01_completion', 'ac01_completion');
