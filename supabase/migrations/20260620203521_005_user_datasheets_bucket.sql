
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-datasheets', 'user-datasheets', true, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "user_datasheets_public" ON storage.objects
  FOR ALL TO public
  USING (bucket_id = 'user-datasheets')
  WITH CHECK (bucket_id = 'user-datasheets');
