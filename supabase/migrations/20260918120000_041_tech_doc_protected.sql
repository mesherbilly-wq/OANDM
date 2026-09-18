-- Password-protected / sensitive technical documents.
-- Private storage + project permission checks. Requires 028 (app_role) and 029 (project_end_user_access).

ALTER TABLE public.tech_doc_documents
  ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visible_in_portal BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_in_om BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_tech_doc_documents_storage_path
  ON public.tech_doc_documents (storage_path)
  WHERE storage_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_access_project(pid bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN pid IS NULL THEN false
    WHEN public.app_role() IN ('admin', 'staff') THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.project_end_user_access a
      WHERE a.project_id = pid
        AND a.accepted_at IS NOT NULL
        AND a.user_id = auth.uid()
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.storage_project_id(object_name text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN NULLIF(split_part(object_name, '/', 1), '')::bigint;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_project(bigint) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.storage_project_id(text) TO authenticated, anon;

DROP POLICY IF EXISTS "public_select_tech_doc_documents" ON public.tech_doc_documents;
DROP POLICY IF EXISTS "public_insert_tech_doc_documents" ON public.tech_doc_documents;
DROP POLICY IF EXISTS "public_update_tech_doc_documents" ON public.tech_doc_documents;
DROP POLICY IF EXISTS "public_delete_tech_doc_documents" ON public.tech_doc_documents;
DROP POLICY IF EXISTS "select_tech_doc_documents_by_project" ON public.tech_doc_documents;
DROP POLICY IF EXISTS "write_tech_doc_documents_staff" ON public.tech_doc_documents;
DROP POLICY IF EXISTS "update_tech_doc_documents_staff" ON public.tech_doc_documents;
DROP POLICY IF EXISTS "delete_tech_doc_documents_staff" ON public.tech_doc_documents;

CREATE POLICY "select_tech_doc_documents_by_project"
  ON public.tech_doc_documents FOR SELECT TO authenticated
  USING (
    public.can_access_project(project_id)
    AND (
      public.app_role() IN ('admin', 'staff')
      OR COALESCE(visible_in_portal, true) = true
    )
  );

CREATE POLICY "write_tech_doc_documents_staff"
  ON public.tech_doc_documents FOR INSERT TO authenticated
  WITH CHECK (
    public.app_role() IN ('admin', 'staff')
    AND public.can_access_project(project_id)
  );

CREATE POLICY "update_tech_doc_documents_staff"
  ON public.tech_doc_documents FOR UPDATE TO authenticated
  USING (public.app_role() IN ('admin', 'staff') AND public.can_access_project(project_id))
  WITH CHECK (public.app_role() IN ('admin', 'staff') AND public.can_access_project(project_id));

CREATE POLICY "delete_tech_doc_documents_staff"
  ON public.tech_doc_documents FOR DELETE TO authenticated
  USING (public.app_role() IN ('admin', 'staff') AND public.can_access_project(project_id));

DROP POLICY IF EXISTS "public_select_tech_doc_rows" ON public.tech_doc_rows;
DROP POLICY IF EXISTS "select_tech_doc_rows_by_project" ON public.tech_doc_rows;

CREATE POLICY "select_tech_doc_rows_by_project"
  ON public.tech_doc_rows FOR SELECT TO authenticated
  USING (
    public.can_access_project(project_id)
    AND (
      public.app_role() IN ('admin', 'staff')
      OR document_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.tech_doc_documents d
        WHERE d.id = tech_doc_rows.document_id
          AND d.is_protected = true
      )
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('tech-docs-private', 'tech-docs-private', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

DROP POLICY IF EXISTS "tech_docs_private_select" ON storage.objects;
DROP POLICY IF EXISTS "tech_docs_private_insert" ON storage.objects;
DROP POLICY IF EXISTS "tech_docs_private_update" ON storage.objects;
DROP POLICY IF EXISTS "tech_docs_private_delete" ON storage.objects;

CREATE POLICY "tech_docs_private_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'tech-docs-private'
    AND (
      public.app_role() IN ('admin', 'staff')
      OR (
        public.can_access_project(public.storage_project_id(name))
        AND EXISTS (
          SELECT 1
          FROM public.tech_doc_documents d
          WHERE d.storage_bucket = 'tech-docs-private'
            AND d.storage_path = name
            AND COALESCE(d.visible_in_portal, true) = true
        )
      )
    )
  );

CREATE POLICY "tech_docs_private_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tech-docs-private'
    AND public.app_role() IN ('admin', 'staff')
    AND public.can_access_project(public.storage_project_id(name))
  );

CREATE POLICY "tech_docs_private_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tech-docs-private'
    AND public.app_role() IN ('admin', 'staff')
    AND public.can_access_project(public.storage_project_id(name))
  )
  WITH CHECK (
    bucket_id = 'tech-docs-private'
    AND public.app_role() IN ('admin', 'staff')
    AND public.can_access_project(public.storage_project_id(name))
  );

CREATE POLICY "tech_docs_private_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'tech-docs-private'
    AND public.app_role() IN ('admin', 'staff')
    AND public.can_access_project(public.storage_project_id(name))
  );
