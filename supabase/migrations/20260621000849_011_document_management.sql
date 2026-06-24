-- Extend projects with missing document management fields
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS main_contractor TEXT,
  ADD COLUMN IF NOT EXISTS project_number TEXT,
  ADD COLUMN IF NOT EXISTS engineer TEXT;

-- Global contractor profile (one row per company)
CREATE TABLE contractor_profile (
  id SERIAL PRIMARY KEY,
  company_name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  postcode TEXT,
  telephone TEXT,
  email TEXT,
  website TEXT,
  company_reg_number TEXT,
  vat_number TEXT,
  nsi_number TEXT,
  ssaib_number TEXT,
  other_certifications TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contractor_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_select_contractor_profile" ON contractor_profile FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_insert_contractor_profile" ON contractor_profile FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_update_contractor_profile" ON contractor_profile FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_contractor_profile" ON contractor_profile FOR DELETE TO anon, authenticated USING (true);

-- Per-project document authority (prepared / checked / approved)
CREATE TABLE document_authority (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  prepared_by TEXT,
  prepared_date DATE,
  prepared_signature_url TEXT,
  checked_by TEXT,
  checked_date DATE,
  checked_signature_url TEXT,
  approved_by TEXT,
  approved_date DATE,
  approved_signature_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE document_authority ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_select_document_authority" ON document_authority FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_insert_document_authority" ON document_authority FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_update_document_authority" ON document_authority FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_document_authority" ON document_authority FOR DELETE TO anon, authenticated USING (true);

-- Storage bucket for signatures
INSERT INTO storage.buckets (id, name, public) VALUES ('signatures', 'signatures', true) ON CONFLICT DO NOTHING;

CREATE POLICY "public_select_signatures" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'signatures');
CREATE POLICY "public_insert_signatures" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'signatures');
CREATE POLICY "public_update_signatures" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'signatures');
CREATE POLICY "public_delete_signatures" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'signatures');
