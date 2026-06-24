
-- Add system_type to devices
ALTER TABLE devices ADD COLUMN IF NOT EXISTS system_type text;

-- Enable RLS on devices (was missing)
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_devices" ON devices FOR SELECT TO public USING (true);
CREATE POLICY "insert_devices" ON devices FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "update_devices" ON devices FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "delete_devices" ON devices FOR DELETE TO public USING (true);

-- Drawings table
CREATE TABLE IF NOT EXISTS drawings (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz DEFAULT now(),
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name text,
  file_url text,
  file_type text,
  file_size bigint,
  processing_status text DEFAULT 'pending',
  notes text
);

ALTER TABLE drawings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_drawings" ON drawings FOR SELECT TO public USING (true);
CREATE POLICY "insert_drawings" ON drawings FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "update_drawings" ON drawings FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "delete_drawings" ON drawings FOR DELETE TO public USING (true);

-- Drawing proposals table
CREATE TABLE IF NOT EXISTS drawing_proposals (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz DEFAULT now(),
  drawing_id bigint NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_name text,
  manufacturer text,
  model_number text,
  device_type text,
  system_type text,
  location text,
  notes text,
  raw_reference text,
  confidence numeric DEFAULT 0.8,
  status text DEFAULT 'pending'
);

ALTER TABLE drawing_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_proposals" ON drawing_proposals FOR SELECT TO public USING (true);
CREATE POLICY "insert_proposals" ON drawing_proposals FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "update_proposals" ON drawing_proposals FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "delete_proposals" ON drawing_proposals FOR DELETE TO public USING (true);

-- Storage bucket for drawings
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'drawings', 'drawings', true, 52428800,
  ARRAY['application/pdf','image/png','image/jpeg','image/tiff','image/webp','application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "drawings_storage_public" ON storage.objects
  FOR ALL TO public
  USING (bucket_id = 'drawings')
  WITH CHECK (bucket_id = 'drawings');
