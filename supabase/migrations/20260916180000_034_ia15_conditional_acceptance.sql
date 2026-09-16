-- Add IA15 Conditional customer acceptance from the Pacific Intruder Alarm pack.

INSERT INTO handover_document_definitions
  (document_id, type_key, title, description, icon_key, sc_enabled, sc_template_id, required, upload_only, multi, display_order, is_active)
VALUES
  ('ia15_acceptance', 'intruder_alarm', 'IA15 Conditional customer acceptance', 'Extra customer signature only for design changes, disconnections or incomplete tests.', 'award', true, 'ia15_acceptance', false, false, false, 150, true)
ON CONFLICT (document_id) DO UPDATE SET
  type_key = EXCLUDED.type_key,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  icon_key = EXCLUDED.icon_key,
  sc_enabled = EXCLUDED.sc_enabled,
  sc_template_id = EXCLUDED.sc_template_id,
  required = EXCLUDED.required,
  upload_only = EXCLUDED.upload_only,
  multi = EXCLUDED.multi,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

UPDATE handover_document_definitions
SET display_order = 160,
    updated_at = now()
WHERE document_id = 'nsi_certificate_intruder'
  AND type_key = 'intruder_alarm';
