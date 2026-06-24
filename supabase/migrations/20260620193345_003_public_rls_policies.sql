-- Allow full public access to all tables (no auth in this app)
CREATE POLICY "public_select_projects" ON projects FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_insert_projects" ON projects FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_update_projects" ON projects FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_projects" ON projects FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "public_select_devices" ON devices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_insert_devices" ON devices FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_update_devices" ON devices FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_devices" ON devices FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "public_select_manufacturers" ON manufacturers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_insert_manufacturers" ON manufacturers FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_update_manufacturers" ON manufacturers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_manufacturers" ON manufacturers FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "public_select_product_models" ON product_models FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_insert_product_models" ON product_models FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_update_product_models" ON product_models FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_product_models" ON product_models FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "public_select_datasheets" ON datasheets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_insert_datasheets" ON datasheets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_update_datasheets" ON datasheets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_datasheets" ON datasheets FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "public_select_generated_documents" ON generated_documents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_insert_generated_documents" ON generated_documents FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_update_generated_documents" ON generated_documents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "public_delete_generated_documents" ON generated_documents FOR DELETE TO anon, authenticated USING (true);