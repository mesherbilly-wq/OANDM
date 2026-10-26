-- Separate operating companies on one platform.
--
-- Migration plan for existing data (nothing is deleted):
-- 1. Create one platform company from the current default letterhead, or "Original company".
-- 2. Keep every existing admin, staff and end user on that company. Do not turn anyone into the platform owner.
-- 3. Stamp that company on projects, letterheads, integrations, catalogues and every project child row.
-- 4. Child rows take the company from their project or parent, so a form and its signed PDF stay with that job.
-- 5. After a second company exists, new people join only through an invite. Open registration still joins the
--    original company while it is the only active company.
--
-- The platform owner (role master) administers companies, subscriptions and suspension.
-- That account cannot read or write projects, documents, forms, signatures, branding or integration secrets.
-- Service-role keys, the database owner, and public storage URLs are a separate infrastructure bypass.
-- See public.platform_infrastructure_bypass().

CREATE TABLE IF NOT EXISTS public.platform_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  subscription_plan text NOT NULL DEFAULT 'standard',
  subscription_status text NOT NULL DEFAULT 'active',
  contact_email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz
);

ALTER TABLE public.platform_companies ENABLE ROW LEVEL SECURITY;

INSERT INTO public.platform_companies (name, status, subscription_plan, subscription_status, contact_email, phone)
SELECT
  COALESCE(
    (SELECT NULLIF(trim(company_name), '') FROM public.contractor_profile WHERE is_default ORDER BY id LIMIT 1),
    (SELECT NULLIF(trim(company_name), '') FROM public.contractor_profile ORDER BY id LIMIT 1),
    'Original company'
  ),
  'active',
  'legacy',
  'active',
  (SELECT NULLIF(trim(email), '') FROM public.contractor_profile ORDER BY is_default DESC, id LIMIT 1),
  (SELECT NULLIF(trim(telephone), '') FROM public.contractor_profile ORDER BY is_default DESC, id LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.platform_companies);

CREATE OR REPLACE FUNCTION public.original_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.platform_companies ORDER BY created_at ASC, id ASC LIMIT 1
$$;

ALTER TABLE public.app_profiles DROP CONSTRAINT IF EXISTS app_profiles_role_check;
ALTER TABLE public.app_profiles
  ADD CONSTRAINT app_profiles_role_check CHECK (role IN ('master', 'admin', 'staff', 'end_user'));

ALTER TABLE public.app_profiles
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.platform_companies(id);

ALTER TABLE public.app_user_invites DROP CONSTRAINT IF EXISTS app_user_invites_role_check;
ALTER TABLE public.app_user_invites
  ADD CONSTRAINT app_user_invites_role_check CHECK (role IN ('master', 'admin', 'staff', 'end_user'));

ALTER TABLE public.app_user_invites
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.platform_companies(id);

UPDATE public.app_profiles
SET company_id = public.original_company_id()
WHERE role <> 'master'
  AND company_id IS NULL;

UPDATE public.app_user_invites
SET company_id = public.original_company_id()
WHERE role <> 'master'
  AND company_id IS NULL;

CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.app_profiles WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_platform_master()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_profiles
    WHERE user_id = auth.uid() AND role = 'master'
  )
$$;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.app_profiles
  WHERE user_id = auth.uid()
    AND role <> 'master'
$$;

CREATE OR REPLACE FUNCTION public.company_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_profiles p
    JOIN public.platform_companies c ON c.id = p.company_id
    WHERE p.user_id = auth.uid()
      AND p.role <> 'master'
      AND c.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.sole_active_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN (SELECT count(*) FROM public.platform_companies WHERE status = 'active') = 1
    THEN (SELECT id FROM public.platform_companies WHERE status = 'active' LIMIT 1)
    ELSE NULL
  END
$$;

GRANT EXECUTE ON FUNCTION public.app_role() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_master() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_is_active() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sole_active_company_id() TO authenticated;

-- Add company_id to every company-owned table that exists in this database.
CREATE OR REPLACE FUNCTION public._add_company_column(target text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass('public.' || target) IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format(
    'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.platform_companies(id)',
    target
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)',
    target || '_company_id_idx',
    target
  );
END;
$$;

SELECT public._add_company_column(target) FROM unnest(ARRAY[
  'projects',
  'contractor_profile',
  'integration_settings',
  'manufacturers',
  'product_models',
  'datasheets',
  'user_manuals',
  'part_system_types',
  'handover_document_types',
  'handover_document_definitions',
  'sc_template_mappings',
  'completion_form_templates',
  'devices',
  'drawings',
  'drawing_proposals',
  'project_documents',
  'project_systems',
  'commissioning_records',
  'handover_documents',
  'project_handover_docs',
  'om_pack_uploads',
  'as_fitted_drawings',
  'as_fitted_items',
  'project_source_docs',
  'document_authority',
  'project_team',
  'project_revisions',
  'sc_inspections',
  'tech_doc_rows',
  'tech_doc_column_configs',
  'tech_doc_documents',
  'project_user_manuals',
  'handover_other_docs',
  'generated_documents',
  'project_completion_documents',
  'completion_forms',
  'completion_form_revisions',
  'completion_form_tokens',
  'completion_form_assets',
  'completion_form_events',
  'handover_form_invites',
  'email_outbox',
  'document_return_tokens',
  'sdp_revisions',
  'project_end_user_access'
]) AS target;

-- Created after projects.company_id exists. SQL functions are checked at creation time.
CREATE OR REPLACE FUNCTION public.can_access_project(pid bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN pid IS NULL THEN false
    WHEN NOT public.company_is_active() THEN false
    WHEN NOT EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = pid
        AND p.company_id = public.current_company_id()
    ) THEN false
    WHEN public.app_role() = 'admin' THEN true
    WHEN public.app_role() = 'staff' THEN true
    WHEN public.app_role() = 'end_user' THEN EXISTS (
      SELECT 1
      FROM public.project_end_user_access a
      WHERE a.project_id = pid
        AND a.accepted_at IS NOT NULL
        AND a.user_id = auth.uid()
    )
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project(pid bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_project(pid)
    AND public.app_role() IN ('admin', 'staff')
$$;

GRANT EXECUTE ON FUNCTION public.can_access_project(bigint) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_project(bigint) TO authenticated;

-- Letterhead and catalogue rows belong to the original company.
DO $$
DECLARE
  target text;
  cid uuid := public.original_company_id();
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'contractor_profile', 'integration_settings', 'manufacturers', 'product_models', 'datasheets',
    'user_manuals', 'part_system_types', 'handover_document_types', 'handover_document_definitions',
    'sc_template_mappings', 'completion_form_templates'
  ]
  LOOP
    IF to_regclass('public.' || target) IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I SET company_id = $1 WHERE company_id IS NULL', target) USING cid;
    END IF;
  END LOOP;
END $$;

UPDATE public.projects
SET company_id = public.original_company_id()
WHERE company_id IS NULL
  AND to_regclass('public.projects') IS NOT NULL;

-- Project children follow the project. Rows without a project follow the original company.
DO $$
DECLARE
  target text;
  cid uuid := public.original_company_id();
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'devices', 'drawings', 'project_documents', 'project_systems', 'commissioning_records',
    'handover_documents', 'project_handover_docs', 'om_pack_uploads', 'as_fitted_drawings',
    'as_fitted_items', 'project_source_docs', 'document_authority', 'project_team',
    'project_revisions', 'sc_inspections', 'tech_doc_rows', 'tech_doc_column_configs',
    'tech_doc_documents', 'project_user_manuals', 'handover_other_docs', 'generated_documents',
    'project_completion_documents', 'completion_forms', 'handover_form_invites', 'email_outbox',
    'document_return_tokens', 'sdp_revisions', 'project_end_user_access'
  ]
  LOOP
    IF to_regclass('public.' || target) IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target AND column_name = 'project_id'
    ) THEN
      EXECUTE format(
        'UPDATE public.%I child
         SET company_id = proj.company_id
         FROM public.projects proj
         WHERE child.project_id = proj.id
           AND child.company_id IS NULL',
        target
      );
    END IF;
    EXECUTE format(
      'UPDATE public.%I SET company_id = $1 WHERE company_id IS NULL',
      target
    ) USING cid;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.drawing_proposals') IS NOT NULL AND to_regclass('public.drawings') IS NOT NULL THEN
    UPDATE public.drawing_proposals proposal
    SET company_id = drawing.company_id
    FROM public.drawings drawing
    WHERE proposal.drawing_id = drawing.id
      AND proposal.company_id IS NULL;
    UPDATE public.drawing_proposals
    SET company_id = public.original_company_id()
    WHERE company_id IS NULL;
  END IF;

  IF to_regclass('public.completion_forms') IS NOT NULL THEN
    UPDATE public.completion_form_revisions child
    SET company_id = form.company_id
    FROM public.completion_forms form
    WHERE child.form_id = form.id AND child.company_id IS NULL;
    UPDATE public.completion_form_tokens child
    SET company_id = form.company_id
    FROM public.completion_forms form
    WHERE child.form_id = form.id AND child.company_id IS NULL;
    UPDATE public.completion_form_assets child
    SET company_id = form.company_id
    FROM public.completion_forms form
    WHERE child.form_id = form.id AND child.company_id IS NULL;
    UPDATE public.completion_form_events child
    SET company_id = form.company_id
    FROM public.completion_forms form
    WHERE child.form_id = form.id AND child.company_id IS NULL;
  END IF;
END $$;

-- One letterhead default per company.
UPDATE public.contractor_profile profile
SET is_default = false
WHERE is_default
  AND id NOT IN (
    SELECT DISTINCT ON (company_id) id
    FROM public.contractor_profile
    WHERE is_default
    ORDER BY company_id, id
  );

CREATE UNIQUE INDEX IF NOT EXISTS contractor_profile_one_default_per_company
  ON public.contractor_profile (company_id)
  WHERE is_default;

-- Keys that used to be global become unique inside a company.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.handover_document_types') IS NOT NULL THEN
    FOR r IN
      SELECT con.conname, rel.relname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE con.contype = 'f'
        AND con.confrelid = 'public.handover_document_types'::regclass
        AND nsp.nspname = 'public'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.relname, r.conname);
    END LOOP;

    ALTER TABLE public.handover_document_types DROP CONSTRAINT IF EXISTS handover_document_types_key_key;
    CREATE UNIQUE INDEX IF NOT EXISTS handover_document_types_company_key_uq
      ON public.handover_document_types (company_id, key);
  END IF;

  IF to_regclass('public.handover_document_definitions') IS NOT NULL THEN
    ALTER TABLE public.handover_document_definitions DROP CONSTRAINT IF EXISTS handover_document_definitions_document_id_key;
    CREATE UNIQUE INDEX IF NOT EXISTS handover_document_definitions_company_doc_uq
      ON public.handover_document_definitions (company_id, document_id);
    ALTER TABLE public.handover_document_definitions
      DROP CONSTRAINT IF EXISTS handover_document_definitions_company_type_fk;
    ALTER TABLE public.handover_document_definitions
      ADD CONSTRAINT handover_document_definitions_company_type_fk
      FOREIGN KEY (company_id, type_key)
      REFERENCES public.handover_document_types (company_id, key)
      ON UPDATE CASCADE;
  END IF;

  IF to_regclass('public.project_systems') IS NOT NULL THEN
    ALTER TABLE public.project_systems
      DROP CONSTRAINT IF EXISTS project_systems_company_handover_type_fk;
    ALTER TABLE public.project_systems
      ADD CONSTRAINT project_systems_company_handover_type_fk
      FOREIGN KEY (company_id, handover_document_type_key)
      REFERENCES public.handover_document_types (company_id, key)
      ON UPDATE CASCADE;
  END IF;

  IF to_regclass('public.projects') IS NOT NULL THEN
    ALTER TABLE public.projects
      DROP CONSTRAINT IF EXISTS projects_company_handover_type_fk;
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_company_handover_type_fk
      FOREIGN KEY (company_id, handover_project_wide_type_key)
      REFERENCES public.handover_document_types (company_id, key)
      ON UPDATE CASCADE;
  END IF;

  IF to_regclass('public.sc_template_mappings') IS NOT NULL THEN
    ALTER TABLE public.sc_template_mappings DROP CONSTRAINT IF EXISTS sc_template_mappings_template_id_key;
    CREATE UNIQUE INDEX IF NOT EXISTS sc_template_mappings_company_template_uq
      ON public.sc_template_mappings (company_id, template_id);
  END IF;

  IF to_regclass('public.completion_form_templates') IS NOT NULL THEN
    ALTER TABLE public.completion_form_templates
      DROP CONSTRAINT IF EXISTS completion_form_templates_template_key_version_key;
    CREATE UNIQUE INDEX IF NOT EXISTS completion_form_templates_company_version_uq
      ON public.completion_form_templates (company_id, template_key, version);
  END IF;

  IF to_regclass('public.integration_settings') IS NOT NULL THEN
    ALTER TABLE public.integration_settings DROP CONSTRAINT IF EXISTS integration_settings_key_key;
    CREATE UNIQUE INDEX IF NOT EXISTS integration_settings_company_key_uq
      ON public.integration_settings (company_id, key);
  END IF;

  IF to_regclass('public.part_system_types') IS NOT NULL THEN
    ALTER TABLE public.part_system_types DROP CONSTRAINT IF EXISTS part_system_types_pkey;
    ALTER TABLE public.part_system_types
      ADD CONSTRAINT part_system_types_pkey PRIMARY KEY (company_id, part_key);
  END IF;
END $$;

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
    -- Keep this inside the projects branch. PL/pgSQL looks up NEW.contractor_profile_id
    -- as soon as the statement runs, and child tables such as project_documents do not have it.
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

CREATE OR REPLACE FUNCTION public.stamp_catalog_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'A record cannot move to another company';
  END IF;
  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.current_company_id();
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

CREATE OR REPLACE FUNCTION public.stamp_parent_company()
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

  IF TG_TABLE_NAME = 'drawing_proposals' THEN
    SELECT company_id INTO cid FROM public.drawings WHERE id = NEW.drawing_id;
  ELSE
    SELECT company_id INTO cid FROM public.completion_forms WHERE id = NEW.form_id;
  END IF;

  IF NEW.company_id IS NULL THEN
    NEW.company_id := cid;
  ELSIF cid IS NOT NULL AND NEW.company_id IS DISTINCT FROM cid THEN
    RAISE EXCEPTION 'Record company does not match its parent';
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

CREATE OR REPLACE FUNCTION public._bind_company_trigger(target text, fn text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass('public.' || target) IS NULL THEN
    RETURN;
  END IF;
  IF fn = 'stamp_project_company' AND target <> 'projects' AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = target AND column_name = 'project_id'
  ) THEN
    RETURN;
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS stamp_company ON public.%I', target);
  EXECUTE format(
    'CREATE TRIGGER stamp_company BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',
    target,
    fn
  );
END;
$$;

SELECT public._bind_company_trigger('projects', 'stamp_project_company');
SELECT public._bind_company_trigger(target, 'stamp_project_company')
FROM unnest(ARRAY[
  'devices', 'drawings', 'project_documents', 'project_systems', 'commissioning_records',
  'handover_documents', 'project_handover_docs', 'om_pack_uploads', 'as_fitted_drawings',
  'as_fitted_items', 'project_source_docs', 'document_authority', 'project_team',
  'project_revisions', 'sc_inspections', 'tech_doc_rows', 'tech_doc_column_configs',
  'tech_doc_documents', 'project_user_manuals', 'handover_other_docs', 'generated_documents',
  'project_completion_documents', 'completion_forms', 'handover_form_invites', 'email_outbox',
  'document_return_tokens', 'sdp_revisions', 'project_end_user_access'
]) AS target;

SELECT public._bind_company_trigger(target, 'stamp_catalog_company')
FROM unnest(ARRAY[
  'contractor_profile', 'integration_settings', 'manufacturers', 'product_models', 'datasheets',
  'user_manuals', 'part_system_types', 'handover_document_types', 'handover_document_definitions',
  'sc_template_mappings', 'completion_form_templates'
]) AS target;

SELECT public._bind_company_trigger(target, 'stamp_parent_company')
FROM unnest(ARRAY[
  'drawing_proposals', 'completion_form_revisions', 'completion_form_tokens',
  'completion_form_assets', 'completion_form_events'
]) AS target;

CREATE OR REPLACE FUNCTION public.guard_profile_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'master' THEN
    NEW.company_id := NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role = 'master' AND NEW.user_id = auth.uid() THEN
    NEW.role := 'master';
    NEW.company_id := NULL;
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_platform_master()
     AND current_setting('app.allow_profile_write', true) IS DISTINCT FROM '1' THEN
    IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Company membership cannot be changed here';
    END IF;
    IF NEW.role = 'master' OR (TG_OP = 'UPDATE' AND OLD.role = 'master') THEN
      RAISE EXCEPTION 'Cannot assign the platform owner role';
    END IF;
    IF TG_OP = 'INSERT'
       AND NEW.company_id IS NOT NULL
       AND public.current_company_id() IS NULL THEN
      RAISE EXCEPTION 'Company membership is assigned by an invite';
    END IF;
    IF NEW.company_id IS NOT NULL
       AND public.current_company_id() IS NOT NULL
       AND NEW.company_id IS DISTINCT FROM public.current_company_id() THEN
      RAISE EXCEPTION 'Cannot join another company';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_membership ON public.app_profiles;
CREATE TRIGGER guard_profile_membership
  BEFORE INSERT OR UPDATE ON public.app_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_membership();

CREATE OR REPLACE FUNCTION public.guard_company_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_master()
     OR current_setting('app.allow_company_write', true) = '1' THEN
    IF NEW.status = 'suspended' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'suspended') THEN
      NEW.suspended_at := COALESCE(NEW.suspended_at, now());
    ELSIF NEW.status = 'active' THEN
      NEW.suspended_at := NULL;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM public.current_company_id() THEN
    RAISE EXCEPTION 'Cannot edit another company';
  END IF;
  IF public.app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only a company admin can edit the company profile';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at THEN
    RAISE EXCEPTION 'Subscription and suspension are managed by the platform owner';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_company_account ON public.platform_companies;
CREATE TRIGGER guard_company_account
  BEFORE INSERT OR UPDATE ON public.platform_companies
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_account();

CREATE OR REPLACE FUNCTION public.guard_user_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'master' THEN
    IF current_setting('app.allow_master_invite', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'Only the platform owner can create a platform owner';
    END IF;
    NEW.company_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    NEW.company_id := public.current_company_id();
  END IF;
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'An invite needs a company';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT public.is_platform_master()
     AND current_setting('app.allow_company_write', true) IS DISTINCT FROM '1'
     AND NEW.company_id IS DISTINCT FROM public.current_company_id() THEN
    RAISE EXCEPTION 'Cannot invite someone into another company';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = NEW.project_id AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'That project belongs to another company';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_user_invite ON public.app_user_invites;
CREATE TRIGGER guard_user_invite
  BEFORE INSERT OR UPDATE ON public.app_user_invites
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_invite();

-- Profiles and company accounts.
DROP POLICY IF EXISTS "select_own_or_admin_app_profiles" ON public.app_profiles;
DROP POLICY IF EXISTS "insert_own_end_user_app_profiles" ON public.app_profiles;
DROP POLICY IF EXISTS "admin_update_app_profiles" ON public.app_profiles;

CREATE POLICY "select_own_or_admin_app_profiles"
  ON public.app_profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_platform_master()
    OR (
      public.app_role() = 'admin'
      AND company_id = public.current_company_id()
      AND company_id IS NOT NULL
    )
  );

CREATE POLICY "insert_own_end_user_app_profiles"
  ON public.app_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'end_user');

CREATE POLICY "admin_update_app_profiles"
  ON public.app_profiles FOR UPDATE TO authenticated
  USING (
    public.is_platform_master()
    OR (
      public.app_role() = 'admin'
      AND company_id = public.current_company_id()
      AND company_id IS NOT NULL
    )
  )
  WITH CHECK (
    public.is_platform_master()
    OR (
      public.app_role() = 'admin'
      AND company_id = public.current_company_id()
      AND role IN ('admin', 'staff', 'end_user')
    )
  );

DROP POLICY IF EXISTS select_platform_companies ON public.platform_companies;
DROP POLICY IF EXISTS update_platform_companies ON public.platform_companies;

CREATE POLICY select_platform_companies
  ON public.platform_companies FOR SELECT TO authenticated
  USING (public.is_platform_master() OR id = public.current_company_id());

CREATE POLICY update_platform_companies
  ON public.platform_companies FOR UPDATE TO authenticated
  USING (public.is_platform_master() OR (public.app_role() = 'admin' AND id = public.current_company_id()))
  WITH CHECK (public.is_platform_master() OR (public.app_role() = 'admin' AND id = public.current_company_id()));

GRANT SELECT, UPDATE ON public.platform_companies TO authenticated;

DROP POLICY IF EXISTS "select_app_user_invites_admin" ON public.app_user_invites;
DROP POLICY IF EXISTS "write_app_user_invites_admin" ON public.app_user_invites;
DROP POLICY IF EXISTS "update_app_user_invites_admin" ON public.app_user_invites;
DROP POLICY IF EXISTS "delete_app_user_invites_admin" ON public.app_user_invites;

CREATE POLICY "select_app_user_invites_admin"
  ON public.app_user_invites FOR SELECT TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND company_id = public.current_company_id()
  );

CREATE POLICY "write_app_user_invites_admin"
  ON public.app_user_invites FOR INSERT TO authenticated
  WITH CHECK (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND role IN ('admin', 'staff', 'end_user')
    AND company_id = public.current_company_id()
  );

CREATE POLICY "update_app_user_invites_admin"
  ON public.app_user_invites FOR UPDATE TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND company_id = public.current_company_id()
  )
  WITH CHECK (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND role IN ('admin', 'staff', 'end_user')
    AND company_id = public.current_company_id()
  );

CREATE POLICY "delete_app_user_invites_admin"
  ON public.app_user_invites FOR DELETE TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND company_id = public.current_company_id()
  );

-- Replace open policies. End users keep invited projects. Staff keep every project in their company.
CREATE OR REPLACE FUNCTION public._install_project_policies(target text, end_user_read boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  existing record;
BEGIN
  IF to_regclass('public.' || target) IS NULL THEN
    RETURN;
  END IF;
  IF target IN ('tech_doc_documents', 'tech_doc_rows') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = target AND column_name = 'project_id'
  ) THEN
    RETURN;
  END IF;
  FOR existing IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = target
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', existing.policyname, target);
  END LOOP;

  IF end_user_read THEN
    EXECUTE format(
      'CREATE POLICY company_select ON public.%I FOR SELECT TO authenticated USING (public.can_access_project(project_id))',
      target
    );
  ELSE
    EXECUTE format(
      'CREATE POLICY company_select ON public.%I FOR SELECT TO authenticated USING (public.can_edit_project(project_id))',
      target
    );
  END IF;
  EXECUTE format(
    'CREATE POLICY company_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_project(project_id))',
    target
  );
  EXECUTE format(
    'CREATE POLICY company_update ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_project(project_id)) WITH CHECK (public.can_edit_project(project_id))',
    target
  );
  EXECUTE format(
    'CREATE POLICY company_delete ON public.%I FOR DELETE TO authenticated USING (public.can_edit_project(project_id))',
    target
  );
END;
$$;

SELECT public._install_project_policies(target, true)
FROM unnest(ARRAY[
  'devices', 'drawings', 'project_documents', 'project_systems', 'commissioning_records',
  'handover_documents', 'project_handover_docs', 'om_pack_uploads', 'as_fitted_drawings',
  'as_fitted_items', 'document_authority', 'project_team', 'project_revisions',
  'project_user_manuals', 'handover_other_docs', 'generated_documents'
]) AS target;

SELECT public._install_project_policies(target, false)
FROM unnest(ARRAY[
  'project_source_docs', 'sc_inspections', 'project_completion_documents', 'completion_forms',
  'handover_form_invites', 'email_outbox', 'document_return_tokens', 'sdp_revisions',
  'tech_doc_column_configs'
]) AS target;

-- Tech doc rows keep the protected-document filter, and writes stay inside the company.
DROP POLICY IF EXISTS "public_select_tech_doc_rows" ON public.tech_doc_rows;
DROP POLICY IF EXISTS "public_insert_tech_doc_rows" ON public.tech_doc_rows;
DROP POLICY IF EXISTS "public_update_tech_doc_rows" ON public.tech_doc_rows;
DROP POLICY IF EXISTS "public_delete_tech_doc_rows" ON public.tech_doc_rows;
DROP POLICY IF EXISTS "select_tech_doc_rows_by_project" ON public.tech_doc_rows;
DROP POLICY IF EXISTS company_insert ON public.tech_doc_rows;
DROP POLICY IF EXISTS company_update ON public.tech_doc_rows;
DROP POLICY IF EXISTS company_delete ON public.tech_doc_rows;

CREATE POLICY "select_tech_doc_rows_by_project"
  ON public.tech_doc_rows FOR SELECT TO authenticated
  USING (
    public.can_access_project(project_id)
    AND (
      public.app_role() IN ('admin', 'staff')
      OR document_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.tech_doc_documents doc
        WHERE doc.id = tech_doc_rows.document_id
          AND doc.is_protected = true
      )
    )
  );

CREATE POLICY company_insert ON public.tech_doc_rows
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_project(project_id));
CREATE POLICY company_update ON public.tech_doc_rows
  FOR UPDATE TO authenticated
  USING (public.can_edit_project(project_id))
  WITH CHECK (public.can_edit_project(project_id));
CREATE POLICY company_delete ON public.tech_doc_rows
  FOR DELETE TO authenticated USING (public.can_edit_project(project_id));

DO $$
DECLARE
  existing record;
BEGIN
  IF to_regclass('public.drawing_proposals') IS NULL THEN
    RETURN;
  END IF;
  FOR existing IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'drawing_proposals'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.drawing_proposals', existing.policyname);
  END LOOP;
END $$;

CREATE POLICY company_select ON public.drawing_proposals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drawings drawing
      WHERE drawing.id = drawing_proposals.drawing_id
        AND public.can_access_project(drawing.project_id)
    )
  );
CREATE POLICY company_insert ON public.drawing_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drawings drawing
      WHERE drawing.id = drawing_proposals.drawing_id
        AND public.can_edit_project(drawing.project_id)
    )
  );
CREATE POLICY company_update ON public.drawing_proposals
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drawings drawing
      WHERE drawing.id = drawing_proposals.drawing_id
        AND public.can_edit_project(drawing.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drawings drawing
      WHERE drawing.id = drawing_proposals.drawing_id
        AND public.can_edit_project(drawing.project_id)
    )
  );
CREATE POLICY company_delete ON public.drawing_proposals
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drawings drawing
      WHERE drawing.id = drawing_proposals.drawing_id
        AND public.can_edit_project(drawing.project_id)
    )
  );

DO $$
DECLARE
  target text;
  existing record;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'completion_form_revisions', 'completion_form_tokens', 'completion_form_assets', 'completion_form_events'
  ]
  LOOP
    IF to_regclass('public.' || target) IS NULL THEN
      CONTINUE;
    END IF;
    FOR existing IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = target
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', existing.policyname, target);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY company_select ON public.%I FOR SELECT TO authenticated
       USING (public.company_is_active() AND public.app_role() IN (''admin'', ''staff'') AND company_id = public.current_company_id())',
      target
    );
    EXECUTE format(
      'CREATE POLICY company_insert ON public.%I FOR INSERT TO authenticated
       WITH CHECK (public.company_is_active() AND public.app_role() IN (''admin'', ''staff'') AND company_id = public.current_company_id())',
      target
    );
    EXECUTE format(
      'CREATE POLICY company_update ON public.%I FOR UPDATE TO authenticated
       USING (public.company_is_active() AND public.app_role() IN (''admin'', ''staff'') AND company_id = public.current_company_id())
       WITH CHECK (public.company_is_active() AND public.app_role() IN (''admin'', ''staff'') AND company_id = public.current_company_id())',
      target
    );
    EXECUTE format(
      'CREATE POLICY company_delete ON public.%I FOR DELETE TO authenticated
       USING (public.company_is_active() AND public.app_role() IN (''admin'', ''staff'') AND company_id = public.current_company_id())',
      target
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._install_catalog_policies(target text, writers text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  existing record;
BEGIN
  IF to_regclass('public.' || target) IS NULL THEN
    RETURN;
  END IF;
  FOR existing IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = target
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', existing.policyname, target);
  END LOOP;
  EXECUTE format(
    'CREATE POLICY company_select ON public.%I FOR SELECT TO authenticated
     USING (public.company_is_active() AND public.app_role() IN (''admin'', ''staff'') AND company_id = public.current_company_id())',
    target
  );
  EXECUTE format(
    'CREATE POLICY company_insert ON public.%I FOR INSERT TO authenticated
     WITH CHECK (public.company_is_active() AND public.app_role() IN (%s) AND company_id = public.current_company_id())',
    target,
    writers
  );
  EXECUTE format(
    'CREATE POLICY company_update ON public.%I FOR UPDATE TO authenticated
     USING (public.company_is_active() AND public.app_role() IN (%s) AND company_id = public.current_company_id())
     WITH CHECK (public.company_is_active() AND public.app_role() IN (%s) AND company_id = public.current_company_id())',
    target,
    writers,
    writers
  );
  EXECUTE format(
    'CREATE POLICY company_delete ON public.%I FOR DELETE TO authenticated
     USING (public.company_is_active() AND public.app_role() IN (%s) AND company_id = public.current_company_id())',
    target,
    writers
  );
END;
$$;

SELECT public._install_catalog_policies(target, '''admin'', ''staff''')
FROM unnest(ARRAY['manufacturers', 'product_models', 'datasheets', 'part_system_types']) AS target;

SELECT public._install_catalog_policies(target, '''admin''')
FROM unnest(ARRAY[
  'handover_document_types', 'handover_document_definitions', 'sc_template_mappings', 'completion_form_templates'
]) AS target;

-- Letterheads: staff edit them; an end user can read the letterhead on a project shared with them.
DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contractor_profile'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.contractor_profile', existing.policyname);
  END LOOP;
END $$;

CREATE POLICY company_select ON public.contractor_profile
  FOR SELECT TO authenticated
  USING (
    public.company_is_active()
    AND company_id = public.current_company_id()
    AND (
      public.app_role() IN ('admin', 'staff')
      OR EXISTS (
        SELECT 1 FROM public.projects project
        WHERE project.company_id = contractor_profile.company_id
          AND public.can_access_project(project.id)
          AND (
            project.contractor_profile_id = contractor_profile.id
            OR (project.contractor_profile_id IS NULL AND contractor_profile.is_default)
          )
      )
    )
  );
CREATE POLICY company_insert ON public.contractor_profile
  FOR INSERT TO authenticated
  WITH CHECK (
    public.company_is_active()
    AND public.app_role() IN ('admin', 'staff')
    AND company_id = public.current_company_id()
  );
CREATE POLICY company_update ON public.contractor_profile
  FOR UPDATE TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() IN ('admin', 'staff')
    AND company_id = public.current_company_id()
  )
  WITH CHECK (
    public.company_is_active()
    AND public.app_role() IN ('admin', 'staff')
    AND company_id = public.current_company_id()
  );
CREATE POLICY company_delete ON public.contractor_profile
  FOR DELETE TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() IN ('admin', 'staff')
    AND company_id = public.current_company_id()
  );

-- Manuals are a company catalogue. End users can read a manual linked to a shared project.
DO $$
DECLARE
  existing record;
BEGIN
  IF to_regclass('public.user_manuals') IS NULL THEN
    RETURN;
  END IF;
  FOR existing IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_manuals'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_manuals', existing.policyname);
  END LOOP;
END $$;

CREATE POLICY company_select ON public.user_manuals
  FOR SELECT TO authenticated
  USING (
    public.company_is_active()
    AND company_id = public.current_company_id()
    AND (
      public.app_role() IN ('admin', 'staff')
      OR EXISTS (
        SELECT 1 FROM public.project_user_manuals link
        WHERE link.manual_id = user_manuals.id
          AND public.can_access_project(link.project_id)
      )
    )
  );
CREATE POLICY company_insert ON public.user_manuals
  FOR INSERT TO authenticated
  WITH CHECK (public.company_is_active() AND public.app_role() IN ('admin', 'staff') AND company_id = public.current_company_id());
CREATE POLICY company_update ON public.user_manuals
  FOR UPDATE TO authenticated
  USING (public.company_is_active() AND public.app_role() IN ('admin', 'staff') AND company_id = public.current_company_id())
  WITH CHECK (public.company_is_active() AND public.app_role() IN ('admin', 'staff') AND company_id = public.current_company_id());
CREATE POLICY company_delete ON public.user_manuals
  FOR DELETE TO authenticated
  USING (public.company_is_active() AND public.app_role() IN ('admin', 'staff') AND company_id = public.current_company_id());

-- Integration secrets: company admin writes, staff can read, platform owner cannot.
DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integration_settings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.integration_settings', existing.policyname);
  END LOOP;
END $$;

CREATE POLICY company_select ON public.integration_settings
  FOR SELECT TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() IN ('admin', 'staff')
    AND company_id = public.current_company_id()
  );
CREATE POLICY company_insert ON public.integration_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND company_id = public.current_company_id()
  );
CREATE POLICY company_update ON public.integration_settings
  FOR UPDATE TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND company_id = public.current_company_id()
  )
  WITH CHECK (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND company_id = public.current_company_id()
  );
CREATE POLICY company_delete ON public.integration_settings
  FOR DELETE TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() = 'admin'
    AND company_id = public.current_company_id()
  );

DROP POLICY IF EXISTS "public_select_projects" ON public.projects;
DROP POLICY IF EXISTS "public_insert_projects" ON public.projects;
DROP POLICY IF EXISTS "public_update_projects" ON public.projects;
DROP POLICY IF EXISTS "public_delete_projects" ON public.projects;
DROP POLICY IF EXISTS "select_projects_by_role" ON public.projects;
DROP POLICY IF EXISTS "write_projects_staff_admin" ON public.projects;
DROP POLICY IF EXISTS "update_projects_staff_admin" ON public.projects;
DROP POLICY IF EXISTS "delete_projects_staff_admin" ON public.projects;

CREATE POLICY "select_projects_by_role"
  ON public.projects FOR SELECT TO authenticated
  USING (public.can_access_project(id));

CREATE POLICY "write_projects_staff_admin"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    public.company_is_active()
    AND public.app_role() IN ('admin', 'staff')
    AND company_id = public.current_company_id()
  );

CREATE POLICY "update_projects_staff_admin"
  ON public.projects FOR UPDATE TO authenticated
  USING (public.can_edit_project(id))
  WITH CHECK (
    public.can_edit_project(id)
    AND company_id = public.current_company_id()
  );

CREATE POLICY "delete_projects_staff_admin"
  ON public.projects FOR DELETE TO authenticated
  USING (public.can_edit_project(id));

DROP POLICY IF EXISTS "select_project_end_user_access" ON public.project_end_user_access;
DROP POLICY IF EXISTS "write_project_end_user_access" ON public.project_end_user_access;
DROP POLICY IF EXISTS "update_project_end_user_access" ON public.project_end_user_access;
DROP POLICY IF EXISTS "delete_project_end_user_access" ON public.project_end_user_access;

CREATE POLICY "select_project_end_user_access"
  ON public.project_end_user_access FOR SELECT TO authenticated
  USING (
    public.can_edit_project(project_id)
    OR user_id = auth.uid()
  );

CREATE POLICY "write_project_end_user_access"
  ON public.project_end_user_access FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY "update_project_end_user_access"
  ON public.project_end_user_access FOR UPDATE TO authenticated
  USING (public.can_edit_project(project_id))
  WITH CHECK (public.can_edit_project(project_id));

CREATE POLICY "delete_project_end_user_access"
  ON public.project_end_user_access FOR DELETE TO authenticated
  USING (public.can_edit_project(project_id));

-- Private tech-doc files follow the project, including for staff and admins.
DROP POLICY IF EXISTS "tech_docs_private_select" ON storage.objects;
CREATE POLICY "tech_docs_private_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'tech-docs-private'
    AND public.can_access_project(public.storage_project_id(name))
    AND (
      public.app_role() IN ('admin', 'staff')
      OR EXISTS (
        SELECT 1 FROM public.tech_doc_documents doc
        WHERE doc.storage_bucket = 'tech-docs-private'
          AND doc.storage_path = name
          AND COALESCE(doc.visible_in_portal, true) = true
      )
    )
  );

CREATE OR REPLACE FUNCTION public.can_access_storage_object(bucket text, object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  first_part text := split_part(object_name, '/', 1);
  second_part text := split_part(object_name, '/', 2);
  company uuid;
  project_id bigint;
BEGIN
  IF NOT public.company_is_active() THEN
    RETURN false;
  END IF;

  BEGIN
    company := first_part::uuid;
  EXCEPTION WHEN others THEN
    company := NULL;
  END;

  IF company IS NOT NULL AND company = public.current_company_id() THEN
    BEGIN
      project_id := second_part::bigint;
    EXCEPTION WHEN others THEN
      project_id := NULL;
    END;
    IF project_id IS NULL THEN
      RETURN public.app_role() IN ('admin', 'staff');
    END IF;
    RETURN public.can_access_project(project_id);
  END IF;

  IF first_part IN ('handover', 'completion', 'sc') THEN
    BEGIN
      project_id := second_part::bigint;
    EXCEPTION WHEN others THEN
      project_id := NULL;
    END;
    RETURN public.can_access_project(project_id);
  END IF;

  IF first_part = 'returns' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.document_return_tokens token
      JOIN public.projects project ON project.id = token.project_id
      WHERE token.token = second_part
        AND public.can_access_project(project.id)
    );
  END IF;

  BEGIN
    project_id := NULLIF(first_part, '')::bigint;
  EXCEPTION WHEN others THEN
    project_id := NULL;
  END;
  IF project_id IS NOT NULL THEN
    RETURN public.can_access_project(project_id);
  END IF;

  IF bucket = 'company-logos' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.contractor_profile profile
      WHERE profile.company_id = public.current_company_id()
        AND public.app_role() IN ('admin', 'staff')
        AND (
          object_name LIKE profile.id::text || '/%'
          OR (profile.logo_url IS NOT NULL AND profile.logo_url LIKE '%' || object_name || '%')
        )
    );
  END IF;

  IF bucket = 'user-datasheets' THEN
    RETURN public.app_role() IN ('admin', 'staff')
      AND EXISTS (
        SELECT 1 FROM public.datasheets sheet
        WHERE sheet.company_id = public.current_company_id()
          AND sheet.datasheet_url LIKE '%' || object_name || '%'
      );
  END IF;

  IF bucket = 'completion-form-files' THEN
    RETURN public.app_role() IN ('admin', 'staff')
      AND EXISTS (
        SELECT 1 FROM public.completion_forms form
        WHERE form.company_id = public.current_company_id()
          AND (
            form.id::text = first_part
            OR object_name LIKE '%/' || form.id::text || '/%'
          )
      );
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_storage_object(text, text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.can_anon_upload_return(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT split_part(object_name, '/', 1) = 'returns'
    AND EXISTS (
      SELECT 1 FROM public.document_return_tokens token
      WHERE token.token = split_part(object_name, '/', 2)
        AND token.status IS DISTINCT FROM 'received'
    )
$$;

GRANT EXECUTE ON FUNCTION public.can_anon_upload_return(text) TO anon, authenticated;

DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname NOT LIKE 'tech_docs_private_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', existing.policyname);
  END LOOP;
END $$;

CREATE POLICY company_storage_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('om-uploads', 'drawings', 'signatures', 'user-datasheets', 'company-logos', 'completion-form-files')
    AND public.can_access_storage_object(bucket_id, name)
  );

CREATE POLICY company_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('om-uploads', 'drawings', 'signatures', 'user-datasheets', 'company-logos', 'completion-form-files')
    AND public.app_role() IN ('admin', 'staff')
    AND public.can_access_storage_object(bucket_id, name)
  );

CREATE POLICY company_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('om-uploads', 'drawings', 'signatures', 'user-datasheets', 'company-logos', 'completion-form-files')
    AND public.app_role() IN ('admin', 'staff')
    AND public.can_access_storage_object(bucket_id, name)
  )
  WITH CHECK (
    bucket_id IN ('om-uploads', 'drawings', 'signatures', 'user-datasheets', 'company-logos', 'completion-form-files')
    AND public.app_role() IN ('admin', 'staff')
    AND public.can_access_storage_object(bucket_id, name)
  );

CREATE POLICY company_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('om-uploads', 'drawings', 'signatures', 'user-datasheets', 'company-logos', 'completion-form-files')
    AND public.app_role() IN ('admin', 'staff')
    AND public.can_access_storage_object(bucket_id, name)
  );

CREATE POLICY anon_return_upload
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'om-uploads'
    AND public.can_anon_upload_return(name)
  );

-- Invites and registration stay inside one company.
CREATE OR REPLACE FUNCTION public.apply_app_user_invite(invite public.app_user_invites, uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_company uuid;
  existing_role text;
BEGIN
  SELECT company_id, role INTO existing_company, existing_role
  FROM public.app_profiles WHERE user_id = uid;

  IF existing_role = 'master' AND invite.role IS DISTINCT FROM 'master' THEN
    RAISE EXCEPTION 'This platform owner account cannot join a company';
  END IF;
  IF invite.role = 'master' AND existing_company IS NOT NULL THEN
    RAISE EXCEPTION 'Platform owner must be a separate account';
  END IF;
  IF existing_company IS NOT NULL
     AND invite.company_id IS NOT NULL
     AND existing_company IS DISTINCT FROM invite.company_id THEN
    RAISE EXCEPTION 'This account already belongs to another company';
  END IF;

  PERFORM set_config('app.allow_profile_write', '1', true);

  INSERT INTO public.app_profiles (user_id, email, role, company_id)
  VALUES (
    uid,
    invite.email,
    invite.role,
    CASE WHEN invite.role = 'master' THEN NULL ELSE invite.company_id END
  )
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        role = EXCLUDED.role,
        company_id = EXCLUDED.company_id,
        updated_at = now();

  UPDATE public.app_user_invites
  SET user_id = uid,
      accepted_at = COALESCE(accepted_at, now())
  WHERE id = invite.id;

  IF invite.project_id IS NOT NULL AND to_regclass('public.project_end_user_access') IS NOT NULL THEN
    INSERT INTO public.project_end_user_access (
      project_id, email, user_id, token, invited_by, accepted_at, company_id
    )
    VALUES (
      invite.project_id,
      invite.email,
      uid,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      invite.invited_by,
      now(),
      invite.company_id
    )
    ON CONFLICT (project_id, email) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          accepted_at = COALESCE(public.project_end_user_access.accepted_at, now()),
          company_id = EXCLUDED.company_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_role text;
  next_company uuid;
  invite public.app_user_invites%ROWTYPE;
BEGIN
  SELECT * INTO invite
  FROM public.app_user_invites i
  WHERE lower(i.email) = lower(COALESCE(NEW.email, ''))
    AND i.accepted_at IS NULL
  ORDER BY i.invited_at DESC
  LIMIT 1;

  IF invite.id IS NOT NULL THEN
    PERFORM public.apply_app_user_invite(invite, NEW.id);
    RETURN NEW;
  END IF;

  next_company := public.sole_active_company_id();
  IF NOT EXISTS (SELECT 1 FROM public.app_profiles WHERE role IN ('admin', 'master')) THEN
    next_role := 'admin';
    next_company := COALESCE(next_company, public.original_company_id());
  ELSE
    next_role := 'end_user';
  END IF;

  PERFORM set_config('app.allow_profile_write', '1', true);
  INSERT INTO public.app_profiles (user_id, email, role, company_id)
  VALUES (NEW.id, COALESCE(NEW.email, ''), next_role, next_company)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_end_user_invite(invite_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite public.project_end_user_access%ROWTYPE;
  uid uuid := auth.uid();
  user_email text;
  proj_name text;
  proj_company uuid;
  existing_company uuid;
  existing_role text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;

  SELECT email INTO user_email FROM auth.users WHERE id = uid;

  SELECT * INTO invite
  FROM public.project_end_user_access
  WHERE token = invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF lower(invite.email) <> lower(COALESCE(user_email, '')) THEN
    RAISE EXCEPTION 'This invite is for %', invite.email;
  END IF;

  SELECT company_id, project_name INTO proj_company, proj_name
  FROM public.projects WHERE id = invite.project_id;

  SELECT company_id, role INTO existing_company, existing_role
  FROM public.app_profiles WHERE user_id = uid;

  IF existing_role = 'master' THEN
    RAISE EXCEPTION 'This platform owner account cannot join a company';
  END IF;
  IF existing_company IS NOT NULL AND proj_company IS NOT NULL AND existing_company IS DISTINCT FROM proj_company THEN
    RAISE EXCEPTION 'This account already belongs to another company';
  END IF;

  UPDATE public.project_end_user_access
  SET user_id = uid,
      accepted_at = COALESCE(accepted_at, now()),
      company_id = COALESCE(company_id, proj_company)
  WHERE id = invite.id;

  PERFORM set_config('app.allow_profile_write', '1', true);
  INSERT INTO public.app_profiles (user_id, email, role, company_id)
  VALUES (uid, COALESCE(user_email, invite.email), 'end_user', proj_company)
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        company_id = COALESCE(public.app_profiles.company_id, EXCLUDED.company_id),
        updated_at = now()
    WHERE public.app_profiles.role = 'end_user';

  RETURN jsonb_build_object(
    'project_id', invite.project_id,
    'project_name', COALESCE(proj_name, 'Project')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_staff_user(user_email text, new_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  normalised text;
  existing_id uuid;
  existing_role text;
  existing_confirmed timestamptz;
  existing_company uuid;
  new_id uuid;
  hashed text;
  inst uuid;
  target_company uuid;
BEGIN
  normalised := lower(trim(user_email));

  IF normalised IS NULL OR normalised = '' OR normalised !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  IF new_password IS NULL OR length(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  hashed := crypt(new_password, gen_salt('bf'));

  SELECT u.id, u.email_confirmed_at, p.role, p.company_id
  INTO existing_id, existing_confirmed, existing_role, existing_company
  FROM auth.users u
  LEFT JOIN public.app_profiles p ON p.user_id = u.id
  WHERE lower(u.email) = normalised;

  IF existing_id IS NOT NULL THEN
    IF existing_role = 'master' THEN
      RAISE EXCEPTION 'This platform owner account cannot join a company';
    END IF;
    IF existing_confirmed IS NOT NULL AND existing_role IN ('admin', 'staff') THEN
      RAISE EXCEPTION 'This email already has an account. Sign in instead.';
    END IF;
    IF existing_confirmed IS NOT NULL AND existing_role = 'end_user' AND existing_company IS NOT NULL THEN
      RAISE EXCEPTION 'This email is an invited client account. Open the invite link, or ask an admin to change the role.';
    END IF;

    target_company := COALESCE(existing_company, public.sole_active_company_id());
    IF target_company IS NULL THEN
      RAISE EXCEPTION 'Ask your company admin for an invite link.';
    END IF;

    UPDATE auth.users
    SET encrypted_password = hashed,
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = existing_id;

    PERFORM set_config('app.allow_profile_write', '1', true);
    UPDATE public.app_profiles
    SET role = 'staff',
        company_id = target_company,
        updated_at = now()
    WHERE user_id = existing_id
      AND role IS DISTINCT FROM 'master';

    RETURN jsonb_build_object('ok', true, 'user_id', existing_id, 'created', false);
  END IF;

  target_company := public.sole_active_company_id();
  IF EXISTS (SELECT 1 FROM public.app_user_invites WHERE lower(email) = normalised AND accepted_at IS NULL) THEN
    target_company := COALESCE(
      (SELECT company_id FROM public.app_user_invites WHERE lower(email) = normalised AND accepted_at IS NULL ORDER BY invited_at DESC LIMIT 1),
      target_company
    );
  ELSIF target_company IS NULL THEN
    RAISE EXCEPTION 'Ask your company admin for an invite link.';
  END IF;

  SELECT instance_id INTO inst FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1;
  IF inst IS NULL THEN
    inst := '00000000-0000-0000-0000-000000000000';
  END IF;

  new_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    inst, new_id, 'authenticated', 'authenticated', normalised, hashed, now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb, now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), new_id,
    jsonb_build_object('sub', new_id::text, 'email', normalised, 'email_verified', true),
    'email', new_id::text, now(), now(), now()
  );

  PERFORM set_config('app.allow_profile_write', '1', true);
  UPDATE public.app_profiles
  SET role = CASE WHEN role = 'master' THEN role ELSE 'staff' END,
      company_id = COALESCE(company_id, target_company),
      updated_at = now()
  WHERE user_id = new_id
    AND role IS DISTINCT FROM 'master';

  RETURN jsonb_build_object('ok', true, 'user_id', new_id, 'created', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_company_catalogue(new_company uuid, source_company uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.handover_document_types') IS NOT NULL THEN
    INSERT INTO public.handover_document_types (key, label, display_order, is_active, company_id)
    SELECT key, label, display_order, is_active, new_company
    FROM public.handover_document_types
    WHERE company_id = source_company
      AND NOT EXISTS (
        SELECT 1 FROM public.handover_document_types existing
        WHERE existing.company_id = new_company AND existing.key = handover_document_types.key
      );
  END IF;

  IF to_regclass('public.handover_document_definitions') IS NOT NULL THEN
    INSERT INTO public.handover_document_definitions (
      document_id, type_key, title, description, icon_key, sc_enabled, sc_template_id,
      field_mappings, required, upload_only, multi, display_order, is_active,
      capture_method, web_form_template_key, external_form_url, company_id
    )
    SELECT
      document_id, type_key, title, description, icon_key, sc_enabled, sc_template_id,
      field_mappings, required, upload_only, multi, display_order, is_active,
      capture_method, web_form_template_key, external_form_url, new_company
    FROM public.handover_document_definitions source
    WHERE source.company_id = source_company
      AND NOT EXISTS (
        SELECT 1 FROM public.handover_document_definitions existing
        WHERE existing.company_id = new_company AND existing.document_id = source.document_id
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_platform_company(
  company_name text,
  admin_email text,
  contact_email text DEFAULT NULL,
  plan_name text DEFAULT 'standard'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
  normalised text := lower(trim(admin_email));
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  source_company uuid;
BEGIN
  IF NOT public.is_platform_master() THEN
    RAISE EXCEPTION 'Platform owner only';
  END IF;
  IF company_name IS NULL OR length(trim(company_name)) = 0 THEN
    RAISE EXCEPTION 'Enter a company name';
  END IF;
  IF normalised !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter the company admin email';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_profiles WHERE lower(email) = normalised) THEN
    RAISE EXCEPTION 'That email already has an account';
  END IF;

  PERFORM set_config('app.allow_company_write', '1', true);
  INSERT INTO public.platform_companies (name, status, subscription_plan, subscription_status, contact_email)
  VALUES (trim(company_name), 'active', COALESCE(NULLIF(trim(plan_name), ''), 'standard'), 'active', NULLIF(trim(contact_email), ''))
  RETURNING id INTO cid;

  INSERT INTO public.contractor_profile (company_name, email, is_default, company_id)
  VALUES (trim(company_name), NULLIF(trim(contact_email), ''), true, cid);

  source_company := public.original_company_id();
  IF source_company IS NOT NULL AND source_company IS DISTINCT FROM cid THEN
    PERFORM public.seed_company_catalogue(cid, source_company);
  END IF;

  PERFORM set_config('app.allow_company_write', '1', true);
  INSERT INTO public.app_user_invites (email, role, token, invited_by, company_id)
  VALUES (normalised, 'admin', token, auth.uid(), cid);

  RETURN jsonb_build_object('company_id', cid, 'invite_token', token, 'admin_email', normalised);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_platform_company_status(target uuid, next_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_master() THEN
    RAISE EXCEPTION 'Platform owner only';
  END IF;
  IF next_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Status must be active or suspended';
  END IF;
  PERFORM set_config('app.allow_company_write', '1', true);
  UPDATE public.platform_companies
  SET status = next_status,
      suspended_at = CASE WHEN next_status = 'suspended' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_platform_master(owner_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalised text := lower(trim(owner_email));
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  master_exists boolean;
BEGIN
  master_exists := EXISTS (SELECT 1 FROM public.app_profiles WHERE role = 'master');
  IF master_exists AND NOT public.is_platform_master() THEN
    RAISE EXCEPTION 'Platform owner only';
  END IF;
  IF NOT master_exists AND public.app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'A company admin creates the first platform owner';
  END IF;
  IF normalised !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter an email for the platform owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_profiles
    WHERE lower(email) = normalised AND (role <> 'master' OR company_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Use a separate email. This account must not already belong to a company';
  END IF;

  PERFORM set_config('app.allow_master_invite', '1', true);
  INSERT INTO public.app_user_invites (email, role, token, invited_by, company_id)
  VALUES (normalised, 'master', token, auth.uid(), NULL)
  ON CONFLICT (email) DO UPDATE
    SET role = 'master',
        company_id = NULL,
        token = EXCLUDED.token,
        invited_by = EXCLUDED.invited_by,
        invited_at = now(),
        accepted_at = NULL,
        user_id = NULL;

  SELECT i.token INTO token FROM public.app_user_invites i WHERE lower(i.email) = normalised;
  RETURN jsonb_build_object('invite_token', token, 'email', normalised);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_owner_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  RETURN jsonb_build_object(
    'exists', EXISTS (SELECT 1 FROM public.app_profiles WHERE role = 'master')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_company_usage()
RETURNS TABLE (
  company_id uuid,
  name text,
  status text,
  subscription_plan text,
  subscription_status text,
  contact_email text,
  created_at timestamptz,
  user_count bigint,
  project_count bigint,
  form_count bigint,
  signed_pdf_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_master() THEN
    RAISE EXCEPTION 'Platform owner only';
  END IF;

  RETURN QUERY
  SELECT
    company.id,
    company.name,
    company.status,
    company.subscription_plan,
    company.subscription_status,
    company.contact_email,
    company.created_at,
    (SELECT count(*) FROM public.app_profiles profile WHERE profile.company_id = company.id),
    (SELECT count(*) FROM public.projects project WHERE project.company_id = company.id),
    (SELECT count(*) FROM public.completion_forms form WHERE form.company_id = company.id),
    (
      SELECT count(*) FROM public.handover_form_invites invite
      WHERE invite.company_id = company.id AND invite.status = 'completed'
    )
      + (
      SELECT count(*) FROM public.completion_forms form
      WHERE form.company_id = company.id AND form.pdf_storage_path IS NOT NULL
    )
  FROM public.platform_companies company
  ORDER BY company.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_infrastructure_bypass()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_master() THEN
    RAISE EXCEPTION 'Platform owner only';
  END IF;
  RETURN jsonb_build_object(
    'notes', jsonb_build_array(
      'The platform owner app account cannot read company projects, documents, forms, signatures or integration secrets.',
      'The Supabase service role key bypasses row security. Edge functions that use it must check the signed-in company first. Public form links are an exception: they load only the project tied to that token.',
      'The database owner and the Supabase SQL editor bypass row security. That is infrastructure access, not the platform owner account.',
      'Public storage buckets still serve a file to anyone who already has its public URL. The storage API now refuses another company''s files. Making om-uploads, drawings, signatures, user-datasheets and company-logos private would close direct URL access and would also invalidate saved public links.',
      'SIMPRO_BASE_URL, SIMPRO_COMPANY_ID and SIMPRO_API_TOKEN are no longer used as a shared fallback. If those secrets are still set on the edge function, they are unused by the proxy but remain server credentials.',
      'RESEND_API_KEY is a platform email credential. It is not a company data key, and it can send mail for any company the function allows.'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_platform_company(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_company_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_platform_master(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_owner_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_company_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_infrastructure_bypass() TO authenticated;

-- End users read the company product catalogue so a shared O&M pack can still show warranties and datasheets.
DROP POLICY IF EXISTS company_select ON public.product_models;
CREATE POLICY company_select ON public.product_models
  FOR SELECT TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() IN ('admin', 'staff', 'end_user')
    AND company_id = public.current_company_id()
  );

DROP POLICY IF EXISTS company_select ON public.datasheets;
CREATE POLICY company_select ON public.datasheets
  FOR SELECT TO authenticated
  USING (
    public.company_is_active()
    AND public.app_role() IN ('admin', 'staff', 'end_user')
    AND company_id = public.current_company_id()
  );

DO $$
BEGIN
  IF to_regclass('public.generated_documents') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generated_documents' AND column_name = 'project_id'
  ) THEN
    PERFORM public._install_catalog_policies('generated_documents', '''admin'', ''staff''');
    PERFORM public._bind_company_trigger('generated_documents', 'stamp_catalog_company');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public._add_company_column(text);
DROP FUNCTION IF EXISTS public._bind_company_trigger(text, text);
DROP FUNCTION IF EXISTS public._install_project_policies(text, boolean);
DROP FUNCTION IF EXISTS public._install_catalog_policies(text, text);

-- Appoint the platform owner. An existing login is detached from its company.
DO $$
DECLARE
  owner_email text := 'william@pacific-uk.co.uk';
  uid uuid;
  token text;
BEGIN
  SELECT u.id INTO uid
  FROM auth.users u
  WHERE lower(u.email) = owner_email
  LIMIT 1;

  IF uid IS NOT NULL THEN
    PERFORM set_config('app.allow_profile_write', '1', true);
    INSERT INTO public.app_profiles (user_id, email, role, company_id)
    VALUES (uid, owner_email, 'master', NULL)
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          role = 'master',
          company_id = NULL,
          updated_at = now();
    RETURN;
  END IF;

  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  PERFORM set_config('app.allow_master_invite', '1', true);
  INSERT INTO public.app_user_invites (email, role, token, company_id)
  VALUES (owner_email, 'master', token, NULL)
  ON CONFLICT (email) DO UPDATE
    SET role = 'master',
        company_id = NULL,
        accepted_at = NULL,
        user_id = NULL,
        token = EXCLUDED.token,
        invited_at = now();
END $$;
