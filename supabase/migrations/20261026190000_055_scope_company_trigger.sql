-- Scope of Works failed after the project was created:
--   record "new" has no field "contractor_profile_id"
--
-- stamp_project_company() is also attached to project_documents. The branding
-- check mentioned contractor_profile_id in a condition that runs for every
-- table, and that column exists only on projects.

CREATE OR REPLACE FUNCTION public.stamp_project_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'A record cannot move to another company';
  END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    IF NEW.company_id IS NULL THEN
      NEW.company_id := public.current_company_id();
    END IF;
    IF NEW.contractor_profile_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.contractor_profile profile
        WHERE profile.id = NEW.contractor_profile_id
          AND profile.company_id = NEW.company_id
      ) THEN
        RAISE EXCEPTION 'That branding profile belongs to another company';
      END IF;
    END IF;
  ELSE
    SELECT company_id INTO cid FROM public.projects WHERE id = NEW.project_id;
    IF NEW.company_id IS NULL THEN
      NEW.company_id := cid;
    ELSIF cid IS NOT NULL AND NEW.company_id IS DISTINCT FROM cid THEN
      RAISE EXCEPTION 'Record company does not match its project';
    END IF;
  END IF;

  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'A company is required';
  END IF;

  IF current_setting('app.allow_company_write', true) IS DISTINCT FROM '1' THEN
    IF auth.uid() IS NOT NULL AND public.is_platform_master() THEN
      RAISE EXCEPTION 'Platform owner accounts cannot write company records';
    END IF;

    IF auth.uid() IS NOT NULL AND NEW.company_id IS DISTINCT FROM public.current_company_id() THEN
      RAISE EXCEPTION 'Cannot write another company''s records';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
