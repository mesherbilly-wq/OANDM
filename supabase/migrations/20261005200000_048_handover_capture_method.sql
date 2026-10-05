-- Let each handover document choose web form, SafetyCulture, or PDF upload.

ALTER TABLE handover_document_definitions
  ADD COLUMN IF NOT EXISTS capture_method text;

ALTER TABLE handover_document_definitions
  ADD COLUMN IF NOT EXISTS web_form_template_key text;

UPDATE handover_document_definitions
SET capture_method = CASE
  WHEN upload_only THEN 'upload'
  WHEN sc_enabled THEN 'safetyculture'
  ELSE 'upload'
END
WHERE capture_method IS NULL;
