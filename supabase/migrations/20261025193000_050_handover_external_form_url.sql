-- Optional web address for upload documents.
-- The engineer opens the form, fills it in, downloads it, then uploads the file.

ALTER TABLE handover_document_definitions
  ADD COLUMN IF NOT EXISTS external_form_url text;
