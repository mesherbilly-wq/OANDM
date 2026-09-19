ALTER TABLE public.contractor_profile
  ADD COLUMN IF NOT EXISTS brand_primary text DEFAULT '#C00000',
  ADD COLUMN IF NOT EXISTS brand_ink text DEFAULT '#404040',
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

UPDATE public.contractor_profile
SET
  brand_primary = COALESCE(NULLIF(brand_primary, ''), '#C00000'),
  brand_ink = COALESCE(NULLIF(brand_ink, ''), '#404040')
WHERE brand_primary IS NULL OR brand_ink IS NULL OR brand_primary = '' OR brand_ink = '';

UPDATE public.contractor_profile
SET is_default = true
WHERE id = (
  SELECT id FROM public.contractor_profile ORDER BY id ASC LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM public.contractor_profile WHERE is_default
);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS contractor_profile_id integer REFERENCES public.contractor_profile(id) ON DELETE SET NULL;

UPDATE public.projects
SET contractor_profile_id = (
  SELECT id FROM public.contractor_profile WHERE is_default ORDER BY id ASC LIMIT 1
)
WHERE contractor_profile_id IS NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-logos',
  'company-logos',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS company_logos_public ON storage.objects;
CREATE POLICY company_logos_public ON storage.objects
  FOR ALL TO public
  USING (bucket_id = 'company-logos')
  WITH CHECK (bucket_id = 'company-logos');

NOTIFY pgrst, 'reload schema';
