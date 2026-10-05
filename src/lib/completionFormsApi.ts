import { supabase } from './supabase';
import { publishedSchema } from './completionFormEngine';
import { CCTV_NCP104_SCHEMA } from './cctvNcp104Completion';
import { recordEmailOutbox, getEmailSettings } from './emailSettings';
import { COMPLETION_TEMPLATE_KEY } from './completionFormTypes';
import type {
  CompletionAnswers,
  CompletionFormSummary,
  CompletionPublicForm,
  CompletionSignature,
  CompletionTemplateRecord,
  CompletionTemplateSchema,
} from './completionFormTypes';
import { blankCompletionSchema, slugifyTemplateKey } from './completionTemplateSystems';
import { buildCompletionPdf } from './completionFormPdf';
import type { ContractorBrand } from './contractorBrand';
import { displayProjectJobNumber } from './projectJobNumber';

function invoke<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  return supabase.functions.invoke('completion-forms', { body: { action, ...payload } }).then(({ data, error }) => {
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(String(data.error));
    return data as T;
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function completionFormUrl(token: string): string {
  return `${window.location.origin}/c/${token}`;
}

function missingTemplateSql(message: string): boolean {
  return /does not exist|schema cache|column .*system_type|project_completion_documents/i.test(message);
}

export async function ensurePublishedTemplate(templateKey = COMPLETION_TEMPLATE_KEY): Promise<{ id: number; schema: CompletionTemplateSchema; systemType: string | null }> {
  const published = await getPublishedTemplate(templateKey);
  if (published) return published;
  if (templateKey !== COMPLETION_TEMPLATE_KEY) {
    throw new Error('Publish this document on the Templates tab before issuing it.');
  }
  const schema = publishedSchema();
  const { data, error } = await supabase.from('completion_form_templates').insert({
    template_key: schema.key,
    version: schema.version,
    title: schema.title,
    status: 'published',
    system_type: 'CCTV',
    schema,
    published_at: new Date().toISOString(),
  }).select('id').single();
  if (error) {
    if (/column .*system_type/i.test(error.message)) {
      const retry = await supabase.from('completion_form_templates').insert({
        template_key: schema.key,
        version: schema.version,
        title: schema.title,
        status: 'published',
        schema,
        published_at: new Date().toISOString(),
      }).select('id').single();
      if (retry.error) throw new Error(missingTemplateSql(retry.error.message) ? 'Paste 045 SQL in Supabase, then issue the form again.' : retry.error.message);
      return { id: Number(retry.data.id), schema, systemType: 'CCTV' };
    }
    if (missingTemplateSql(error.message)) throw new Error('Paste 045 SQL in Supabase, then issue the form again.');
    throw new Error(error.message);
  }
  return { id: Number(data.id), schema, systemType: 'CCTV' };
}

export async function getPublishedTemplate(templateKey: string): Promise<{ id: number; schema: CompletionTemplateSchema; systemType: string | null } | null> {
  let query = await supabase
    .from('completion_form_templates')
    .select('id, schema, system_type')
    .eq('template_key', templateKey)
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (query.error && /column .*system_type/i.test(query.error.message)) {
    query = await supabase
      .from('completion_form_templates')
      .select('id, schema')
      .eq('template_key', templateKey)
      .eq('status', 'published')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
  }
  if (query.error) {
    if (missingTemplateSql(query.error.message)) return null;
    throw new Error(query.error.message);
  }
  if (!query.data?.id) return null;
  return {
    id: Number(query.data.id),
    schema: (query.data.schema as CompletionTemplateSchema),
    systemType: (query.data as { system_type?: string | null }).system_type ?? (templateKey === COMPLETION_TEMPLATE_KEY ? 'CCTV' : null),
  };
}

export async function listCompletionDocuments(systemType?: string): Promise<Array<{
  template_key: string;
  title: string;
  system_type: string | null;
  latest_version: number;
  latest_status: string;
}>> {
  const withType = await supabase
    .from('completion_form_templates')
    .select('template_key, title, system_type, version, status')
    .order('version', { ascending: false });
  const result = withType.error && /column .*system_type/i.test(withType.error.message)
    ? await supabase.from('completion_form_templates').select('template_key, title, version, status').order('version', { ascending: false })
    : withType;
  const { data, error } = result;
  if (error) {
    if (missingTemplateSql(error.message)) return [];
    throw new Error(error.message);
  }
  const latest = new Map<string, { template_key: string; title: string; system_type: string | null; latest_version: number; latest_status: string }>();
  for (const row of data ?? []) {
    const key = String(row.template_key);
    if (latest.has(key)) continue;
    latest.set(key, {
      template_key: key,
      title: String(row.title ?? key),
      system_type: (row as { system_type?: string | null }).system_type ?? (key === COMPLETION_TEMPLATE_KEY ? 'CCTV' : null),
      latest_version: Number(row.version),
      latest_status: String(row.status),
    });
  }
  const rows = Array.from(latest.values());
  if (!systemType) return rows;
  return rows.filter(row => (row.system_type ?? '') === systemType);
}

export async function listTemplateVersions(templateKey = COMPLETION_TEMPLATE_KEY): Promise<Array<{ id: number; version: number; status: string; title: string }>> {
  const { data, error } = await supabase
    .from('completion_form_templates')
    .select('id, version, status, title')
    .eq('template_key', templateKey)
    .order('version', { ascending: false });
  if (error) {
    if (missingTemplateSql(error.message)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function loadLatestTemplate(templateKey: string): Promise<CompletionTemplateRecord | null> {
  let query = await supabase
    .from('completion_form_templates')
    .select('id, template_key, version, title, status, system_type, schema, published_at, source_file_name')
    .eq('template_key', templateKey)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (query.error && /column .*(system_type|source_file_name)/i.test(query.error.message)) {
    query = await supabase
      .from('completion_form_templates')
      .select('id, template_key, version, title, status, schema, published_at')
      .eq('template_key', templateKey)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
  }
  if (query.error) {
    if (missingTemplateSql(query.error.message)) return null;
    throw new Error(query.error.message);
  }
  return query.data as CompletionTemplateRecord | null;
}

export async function createCompletionDocument(opts: {
  systemType: string;
  title: string;
}): Promise<CompletionTemplateSchema> {
  const key = await uniqueCompletionTemplateKey(opts.systemType, opts.title);
  const schema = blankCompletionSchema(key, opts.title.trim());
  const { error } = await supabase.from('completion_form_templates').insert({
    template_key: key,
    version: 1,
    title: schema.title,
    status: 'draft',
    system_type: opts.systemType,
    schema,
  });
  if (error) {
    if (/column .*system_type/i.test(error.message)) {
      throw new Error('Paste 046 SQL in Supabase so templates can be assigned to a system type.');
    }
    if (missingTemplateSql(error.message)) throw new Error('Paste 045 SQL in Supabase, then create the document again.');
    if (/duplicate|unique/i.test(error.message)) {
      throw new Error('A document with that name already exists. Choose a different name.');
    }
    throw new Error(error.message);
  }
  return schema;
}

async function uniqueCompletionTemplateKey(systemType: string, title: string): Promise<string> {
  const base = slugifyTemplateKey(systemType, title);
  let key = base;
  let n = 2;
  while (await loadLatestTemplate(key)) {
    const suffix = `_${n}`;
    key = `${base.slice(0, Math.max(12, 72 - suffix.length))}${suffix}`;
    n += 1;
    if (n > 40) return `${base.slice(0, 48)}_${Date.now().toString(36)}`;
  }
  return key;
}

export async function listProjectCompletionAssignments(projectId: number, systemType: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('project_completion_documents')
    .select('template_key')
    .eq('project_id', projectId)
    .eq('system_type', systemType)
    .order('updated_at', { ascending: false });
  if (error) {
    if (missingTemplateSql(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(row => String(row.template_key)).filter(Boolean);
}

export async function assignProjectCompletionDocument(projectId: number, systemType: string, templateKey: string): Promise<void> {
  const { error } = await supabase.from('project_completion_documents').upsert({
    project_id: projectId,
    system_type: systemType,
    template_key: templateKey,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id,system_type,template_key' });
  if (error) {
    if (/on conflict|no unique|project_id_system_type_key/i.test(error.message)) {
      throw new Error('Paste 047 SQL in Supabase so a system can keep more than one document.');
    }
    if (missingTemplateSql(error.message)) {
      throw new Error('Paste 046 SQL in Supabase so each system can keep its selected documents.');
    }
    throw new Error(error.message);
  }
}

export async function unassignProjectCompletionDocument(projectId: number, systemType: string, templateKey: string): Promise<void> {
  const { error } = await supabase.from('project_completion_documents')
    .delete()
    .eq('project_id', projectId)
    .eq('system_type', systemType)
    .eq('template_key', templateKey);
  if (error) {
    if (missingTemplateSql(error.message)) {
      throw new Error('Paste 046 SQL in Supabase so each system can keep its selected documents.');
    }
    throw new Error(error.message);
  }
}

export async function deleteCompletionForm(form: CompletionFormSummary): Promise<void> {
  await supabase.from('completion_form_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('form_id', form.id)
    .is('revoked_at', null);
  const { data: assets } = await supabase
    .from('completion_form_assets')
    .select('storage_path')
    .eq('form_id', form.id);
  const assetPaths = (assets ?? []).map(row => String(row.storage_path)).filter(Boolean);
  if (assetPaths.length) {
    await supabase.storage.from('completion-form-files').remove(assetPaths);
  }
  if (form.pdf_storage_path) {
    await supabase.storage.from('om-uploads').remove([form.pdf_storage_path]);
  }
  if (form.pdf_url) {
    await supabase.from('om_pack_uploads')
      .delete()
      .eq('project_id', form.project_id)
      .eq('file_url', form.pdf_url);
  }
  const { error } = await supabase.from('completion_forms').delete().eq('id', form.id);
  if (error) throw new Error(error.message);
}

export async function deleteCompletionTemplate(templateKey: string): Promise<{ issuedCount: number }> {
  const { count } = await supabase
    .from('completion_forms')
    .select('id', { count: 'exact', head: true })
    .eq('template_key', templateKey);
  const { data: versions, error: versionError } = await supabase
    .from('completion_form_templates')
    .select('id')
    .eq('template_key', templateKey);
  if (versionError) throw new Error(versionError.message);
  const ids = (versions ?? []).map(row => Number(row.id)).filter(Boolean);
  if (ids.length) {
    await supabase.from('completion_forms').update({ template_id: null }).in('template_id', ids);
  }
  await supabase.from('project_completion_documents').delete().eq('template_key', templateKey);
  const { error } = await supabase.from('completion_form_templates').delete().eq('template_key', templateKey);
  if (error) {
    if (/foreign key|violates/i.test(error.message)) {
      throw new Error('This template is still linked to an issued form. Remove those forms on Handover first, or try again.');
    }
    throw new Error(error.message);
  }
  return { issuedCount: count ?? 0 };
}

export async function listCompletionForms(projectId: number): Promise<CompletionFormSummary[]> {
  const { data, error } = await supabase
    .from('completion_forms')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as CompletionFormSummary[];
}

export async function listFormTokens(formId: number): Promise<Array<{ token: string; role: string; revoked_at: string | null; expires_at: string | null }>> {
  const { data, error } = await supabase
    .from('completion_form_tokens')
    .select('token, role, revoked_at, expires_at')
    .eq('form_id', formId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function issueCompletionForm(opts: {
  projectId: number;
  assignedName: string;
  assignedEmail?: string;
  assignedCompany?: string;
  expiryDays: number;
  prefill: Record<string, string>;
  templateKey?: string;
  companyName?: string;
}): Promise<{ form: CompletionFormSummary; engineerUrl: string; emailed: boolean; emailNote: string }> {
  const template = await ensurePublishedTemplate(opts.templateKey ?? COMPLETION_TEMPLATE_KEY);
  const answers = {
    job: {
      job_number: opts.prefill.job_number ?? '',
      site_address: opts.prefill.site_address ?? '',
      client: opts.prefill.client ?? '',
      job_title: opts.prefill.job_title ?? '',
      project_manager: opts.prefill.project_manager ?? '',
      engineer: opts.prefill.engineer || opts.assignedName,
      date_of_install: '',
      system_type: opts.prefill.system_type ?? '',
    },
  };
  const now = new Date();
  const expires = new Date(now.getTime() + opts.expiryDays * 24 * 60 * 60 * 1000);
  const { data: form, error } = await supabase.from('completion_forms').insert({
    project_id: opts.projectId,
    template_id: template.id,
    template_key: template.schema.key,
    template_version: template.schema.version,
    title: template.schema.title,
    schema_json: template.schema,
    status: 'issued',
    assigned_name: opts.assignedName,
    assigned_email: opts.assignedEmail || null,
    assigned_company: opts.assignedCompany || null,
    issued_at: now.toISOString(),
    expires_at: expires.toISOString(),
    current_revision_no: 1,
  }).select('*').single();
  if (error) throw new Error(error.message);
  const rev = await supabase.from('completion_form_revisions').insert({
    form_id: form.id,
    revision_no: 1,
    answers,
    locked: false,
  });
  if (rev.error) throw new Error(rev.error.message);
  const token = randomToken();
  const tok = await supabase.from('completion_form_tokens').insert({
    form_id: form.id,
    token,
    role: 'engineer',
    expires_at: expires.toISOString(),
  });
  if (tok.error) throw new Error(tok.error.message);
  await supabase.from('completion_form_events').insert({
    form_id: form.id,
    revision_no: 1,
    event_type: 'issued',
    detail: opts.assignedEmail || opts.assignedName,
  });
  const engineerUrl = completionFormUrl(token);
  let emailed = false;
  let emailNote = 'Copy the link to send it yourself.';
  if (opts.assignedEmail) {
    const settings = await getEmailSettings();
    try {
      const result = await invoke<{ emailed?: boolean; provider?: string }>('send_email', {
        to: opts.assignedEmail,
        title: template.schema.title,
        url: engineerUrl,
        company: opts.companyName || 'Operations & Maintenance',
      });
      emailed = Boolean(result.emailed);
      emailNote = emailed
        ? 'Sent through the configured Resend address.'
        : settings.provider === 'resend'
          ? 'Resend is selected but the completion-forms function does not have RESEND_API_KEY, so the link was not emailed.'
          : 'Email sending is not configured. Use the copied link or your mail draft.';
    } catch {
      emailNote = 'The email function could not be reached. Use the copied link.';
    }
    await recordEmailOutbox({
      project_id: opts.projectId,
      provider: emailed ? 'resend' : 'outbox',
      recipient: opts.assignedEmail,
      subject: `${template.schema.title} — please complete`,
      body: engineerUrl,
      meta: { form_id: form.id, emailed },
    });
  }
  return { form: form as CompletionFormSummary, engineerUrl, emailed, emailNote };
}

export async function issueCustomerToken(formId: number, expiryDays = 14): Promise<string> {
  await supabase.from('completion_form_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('form_id', formId)
    .eq('role', 'customer')
    .is('revoked_at', null);
  const token = randomToken();
  const expires = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('completion_form_tokens').insert({
    form_id: formId,
    token,
    role: 'customer',
    expires_at: expires,
  });
  if (error) throw new Error(error.message);
  return completionFormUrl(token);
}

export async function revokeFormToken(token: string): Promise<void> {
  const { error } = await supabase.from('completion_form_tokens').update({ revoked_at: new Date().toISOString() }).eq('token', token);
  if (error) throw new Error(error.message);
}

export async function replaceEngineerLink(formId: number, expiryDays = 30): Promise<string> {
  await supabase.from('completion_form_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('form_id', formId)
    .eq('role', 'engineer')
    .is('revoked_at', null);
  const token = randomToken();
  const { error } = await supabase.from('completion_form_tokens').insert({
    form_id: formId,
    token,
    role: 'engineer',
    expires_at: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return completionFormUrl(token);
}

export async function returnCompletionForm(formId: number, note: string): Promise<void> {
  const { data: form, error } = await supabase.from('completion_forms').select('current_revision_no').eq('id', formId).single();
  if (error) throw new Error(error.message);
  const { data: revision } = await supabase
    .from('completion_form_revisions')
    .select('*')
    .eq('form_id', formId)
    .eq('revision_no', form.current_revision_no)
    .single();
  const nextNo = Number(form.current_revision_no) + 1;
  const { error: revError } = await supabase.from('completion_form_revisions').insert({
    form_id: formId,
    revision_no: nextNo,
    answers: revision?.answers ?? {},
    locked: false,
  });
  if (revError) throw new Error(revError.message);
  const { error: upd } = await supabase.from('completion_forms').update({
    status: 'returned',
    review_note: note,
    current_revision_no: nextNo,
    updated_at: new Date().toISOString(),
  }).eq('id', formId);
  if (upd) throw new Error(upd.message);
  await supabase.from('completion_form_events').insert({
    form_id: formId,
    revision_no: nextNo,
    event_type: 'returned_for_correction',
    detail: note,
  });
}

export async function approveForCustomer(formId: number, outstandingAuthorised: boolean): Promise<void> {
  const { error } = await supabase.from('completion_forms').update({
    status: 'awaiting_customer',
    outstanding_handover_authorised: outstandingAuthorised,
    updated_at: new Date().toISOString(),
  }).eq('id', formId);
  if (error) throw new Error(error.message);
}

export async function saveApprovedPdf(opts: {
  formId: number;
  projectId: number;
  fileName: string;
  pdfBase64: string;
}): Promise<string> {
  const raw = opts.pdfBase64.includes(',') ? opts.pdfBase64.split(',').pop()! : opts.pdfBase64;
  const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
  const path = `completion/${opts.projectId}/${opts.formId}/${opts.fileName}`;
  const { error } = await supabase.storage.from('om-uploads').upload(path, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(error.message);
  const url = supabase.storage.from('om-uploads').getPublicUrl(path).data.publicUrl;
  await supabase.from('completion_forms').update({
    pdf_url: url,
    pdf_file_name: opts.fileName,
    pdf_storage_path: path,
    updated_at: new Date().toISOString(),
  }).eq('id', opts.formId);
  const { data: existing } = await supabase
    .from('om_pack_uploads')
    .select('id')
    .eq('project_id', opts.projectId)
    .eq('file_url', url)
    .maybeSingle();
  if (!existing) {
    await supabase.from('om_pack_uploads').insert({
      project_id: opts.projectId,
      section: 'commissioning',
      file_name: opts.fileName,
      file_url: url,
    });
  }
  return url;
}

export async function resolveCompletionViewUrl(form: CompletionFormSummary): Promise<string | null> {
  if (form.pdf_url) return form.pdf_url;
  const tokens = await listFormTokens(form.id);
  const live = tokens.filter(token => !token.revoked_at);
  const preferred = live.find(token => token.role === 'engineer') ?? live[0];
  return preferred ? completionFormUrl(preferred.token) : null;
}

export async function ensureApprovedCompletionPdf(opts: {
  form: CompletionFormSummary;
  project: { id: number; job_number?: string | null; project_number?: string | null };
  brand: ContractorBrand | null;
  force?: boolean;
}): Promise<string> {
  if (opts.form.pdf_url && !opts.force) return opts.form.pdf_url;
  const [{ data: row, error: rowErr }, { data: revision, error: revErr }] = await Promise.all([
    supabase.from('completion_forms').select('*').eq('id', opts.form.id).single(),
    supabase.from('completion_form_revisions').select('*').eq('form_id', opts.form.id).eq('revision_no', opts.form.current_revision_no).single(),
  ]);
  if (rowErr) throw new Error(rowErr.message);
  if (revErr) throw new Error(revErr.message);
  const built = await buildCompletionPdf({
    schema: row?.schema_json,
    answers: revision?.answers ?? {},
    photos: [],
    brand: opts.brand,
    jobRef: displayProjectJobNumber(opts.project.job_number, opts.project.project_number),
    documentRef: `${opts.form.template_key}-${opts.form.id}`,
    revisionNo: opts.form.current_revision_no,
    status: 'Approved',
    issueDate: new Date().toLocaleDateString('en-GB'),
    outstandingAuthorised: opts.form.outstanding_handover_authorised,
  });
  return saveApprovedPdf({
    formId: opts.form.id,
    projectId: opts.project.id,
    fileName: built.fileName,
    pdfBase64: built.pdfBase64,
  });
}

export function getPublicCompletionForm(token: string): Promise<CompletionPublicForm> {
  return invoke<CompletionPublicForm>('get_form', { token });
}

export function savePublicDraft(token: string, answers: CompletionAnswers): Promise<{ savedAt: string; status: string }> {
  return invoke('save_draft', { token, answers });
}

export function submitEngineerForm(token: string, answers: CompletionAnswers, signature: CompletionSignature): Promise<{ signedAt: string; revisionNo: number }> {
  return invoke('submit_engineer', { token, answers, signature });
}

export function signCustomerForm(token: string, signature: CompletionSignature): Promise<{ signedAt: string }> {
  return invoke('customer_sign', { token, signature });
}

export function requestCustomerCorrection(token: string, comment: string): Promise<void> {
  return invoke('customer_correction', { token, comment }).then(() => undefined);
}

export async function createPhotoUpload(token: string, opts: {
  fieldPath: string;
  fileName: string;
  contentType: string;
  caption: string;
}): Promise<{ assetId: number; path: string; signedToken: string; signedUrl: string }> {
  const data = await invoke<{ assetId: number; path: string; token: string; signedUrl: string }>('create_upload', {
    token,
    field_path: opts.fieldPath,
    file_name: opts.fileName,
    content_type: opts.contentType,
    caption: opts.caption,
  });
  return { assetId: data.assetId, path: data.path, signedToken: data.token, signedUrl: data.signedUrl };
}

export function confirmPhotoUpload(token: string, assetId: number, ok: boolean, error?: string, caption?: string): Promise<void> {
  return invoke('confirm_upload', { token, asset_id: assetId, ok, error, caption }).then(() => undefined);
}

export async function uploadPhotoFile(token: string, file: File, fieldPath: string, caption: string): Promise<void> {
  const prepared = await compressPhoto(file);
  const created = await createPhotoUpload(token, {
    fieldPath,
    fileName: prepared.name,
    contentType: prepared.type,
    caption,
  });
  const { error } = await supabase.storage.from('completion-form-files').uploadToSignedUrl(created.path, created.signedToken, prepared);
  await confirmPhotoUpload(token, created.assetId, !error, error?.message, caption);
  if (error) throw new Error(error.message);
}

export async function compressPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 900_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}

export async function saveDraftTemplate(schema: CompletionTemplateSchema, opts?: {
  systemType?: string;
  sourceFileName?: string | null;
}): Promise<void> {
  const { data: latest } = await supabase
    .from('completion_form_templates')
    .select('id, version, status')
    .eq('template_key', schema.key)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const extra = {
    schema,
    title: schema.title,
    ...(opts?.systemType ? { system_type: opts.systemType } : {}),
    ...(opts?.sourceFileName !== undefined ? { source_file_name: opts.sourceFileName } : {}),
  };
  if (latest?.status === 'draft') {
    const { error } = await supabase.from('completion_form_templates').update(extra).eq('id', latest.id);
    if (error) throw new Error(/column .*system_type|source_file_name/i.test(error.message)
      ? 'Paste 046 SQL in Supabase so templates can keep a system type and source file.'
      : error.message);
    return;
  }
  const { error } = await supabase.from('completion_form_templates').insert({
    template_key: schema.key,
    version: (latest?.version ?? schema.version) + 1,
    status: 'draft',
    ...extra,
  });
  if (error) throw new Error(/column .*system_type|source_file_name/i.test(error.message)
    ? 'Paste 046 SQL in Supabase so templates can keep a system type and source file.'
    : error.message);
}

export async function publishDraftTemplate(templateKey = COMPLETION_TEMPLATE_KEY): Promise<void> {
  const { data: draft, error } = await supabase
    .from('completion_form_templates')
    .select('id')
    .eq('template_key', templateKey)
    .eq('status', 'draft')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error('There is no draft template to publish.');
  const { error: upd } = await supabase.from('completion_form_templates').update({
    status: 'published',
    published_at: new Date().toISOString(),
  }).eq('id', draft.id);
  if (upd) throw new Error(upd.message);
}

export function defaultTemplateSchema(): CompletionTemplateSchema {
  return structuredClone(CCTV_NCP104_SCHEMA);
}
