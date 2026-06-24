-- O&M pack PDF uploads
CREATE TABLE IF NOT EXISTS om_pack_uploads (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  project_id  bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section     text NOT NULL,  -- 'commissioning' | 'handover' | 'scope' | 'custom'
  file_name   text NOT NULL,
  file_url    text NOT NULL
);

ALTER TABLE om_pack_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sel_om_uploads" ON om_pack_uploads FOR SELECT TO public USING (true);
CREATE POLICY "ins_om_uploads" ON om_pack_uploads FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "upd_om_uploads" ON om_pack_uploads FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "del_om_uploads" ON om_pack_uploads FOR DELETE TO public USING (true);

-- Storage bucket for O&M PDF uploads (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('om-uploads', 'om-uploads', true, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "om_uploads_select" ON storage.objects FOR SELECT TO public USING (bucket_id = 'om-uploads');
CREATE POLICY "om_uploads_insert" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'om-uploads');
CREATE POLICY "om_uploads_delete" ON storage.objects FOR DELETE TO public USING (bucket_id = 'om-uploads');
