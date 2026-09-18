-- File password for protected technical documents. Requires 041.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.tech_doc_documents
  ADD COLUMN IF NOT EXISTS file_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS has_file_password BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.tech_doc_unlocks (
  document_id BIGINT NOT NULL REFERENCES public.tech_doc_documents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (document_id, user_id)
);

ALTER TABLE public.tech_doc_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tech_doc_unlocks" ON public.tech_doc_unlocks;
CREATE POLICY "select_own_tech_doc_unlocks"
  ON public.tech_doc_unlocks FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.tech_doc_unlocks TO authenticated;

CREATE OR REPLACE FUNCTION public.set_tech_doc_file_password(doc_id bigint, new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.app_role() NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF new_password IS NULL OR length(btrim(new_password)) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;
  UPDATE public.tech_doc_documents
  SET file_password_hash = crypt(btrim(new_password), gen_salt('bf')),
      has_file_password = true
  WHERE id = doc_id
    AND public.can_access_project(project_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_tech_doc_file_password(doc_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.app_role() NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE public.tech_doc_documents
  SET file_password_hash = NULL,
      has_file_password = false
  WHERE id = doc_id
    AND public.can_access_project(project_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
  DELETE FROM public.tech_doc_unlocks WHERE document_id = doc_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_tech_doc_file(doc_id bigint, typed_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc public.tech_doc_documents%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;

  SELECT * INTO doc FROM public.tech_doc_documents WHERE id = doc_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT public.can_access_project(doc.project_id) THEN
    RETURN false;
  END IF;
  IF public.app_role() NOT IN ('admin', 'staff') AND COALESCE(doc.visible_in_portal, true) = false THEN
    RETURN false;
  END IF;

  IF COALESCE(doc.has_file_password, false) THEN
    IF typed_password IS NULL
       OR doc.file_password_hash IS NULL
       OR doc.file_password_hash <> crypt(btrim(typed_password), doc.file_password_hash) THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO public.tech_doc_unlocks (document_id, user_id, expires_at)
  VALUES (doc_id, auth.uid(), now() + interval '5 minutes')
  ON CONFLICT (document_id, user_id)
  DO UPDATE SET expires_at = now() + interval '5 minutes';

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_tech_doc_file_password(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_tech_doc_file_password(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_tech_doc_file(bigint, text) TO authenticated;

REVOKE SELECT (file_password_hash) ON public.tech_doc_documents FROM anon, authenticated;
REVOKE UPDATE (file_password_hash) ON public.tech_doc_documents FROM anon, authenticated;

DROP POLICY IF EXISTS "tech_docs_private_select" ON storage.objects;
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
            AND (
              COALESCE(d.has_file_password, false) = false
              OR EXISTS (
                SELECT 1
                FROM public.tech_doc_unlocks u
                WHERE u.document_id = d.id
                  AND u.user_id = auth.uid()
                  AND u.expires_at > now()
              )
            )
        )
      )
    )
  );
