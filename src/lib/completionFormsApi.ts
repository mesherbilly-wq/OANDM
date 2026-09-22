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
  CompletionTemplateSchema,
} from './completionFormTypes';

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

export async function ensurePublishedTemplate(): Promise<{ id: number; schema: CompletionTemplateSchema }> {
  const schema = publishedSchema();
  const { data: existing } = await supabase
    .from('completion_form_templates')
    .select('id, schema')
    .eq('template_key', schema.key)
    .eq('version', schema.version)
    .maybeSingle();
  if (existing?.id) return { id: Number(existing.id), schema: (existing.schema as CompletionTemplateSchema) ?? schema };
  const { data, error } = await supabase.from('completion_form_templates').insert({
    template_key: schema.key,
    version: schema.version,
    title: schema.title,
    status: 'published',
    schema,
    published_at: new Date().toISOString(),
  }).select('id').single();
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      throw new Error('Paste 045 SQL in Supabase, then issue the form again.');
    }
    throw new Error(error.message);
  }
  return { id: Number(data.id), schema };
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
}): Promise<{ form: CompletionFormSummary; engineerUrl: string; emailed: boolean; emailNote: string }> {
  const template = await ensurePublishedTemplate();
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
        company: 'Pacific',
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
  await supabase.from('om_pack_uploads').insert({
    project_id: opts.projectId,
    section: 'commissioning',
    file_name: opts.fileName,
    file_url: url,
  });
  return url;
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

export async function listTemplateVersions(): Promise<Array<{ id: number; version: number; status: string; title: string }>> {
  const { data, error } = await supabase
    .from('completion_form_templates')
    .select('id, version, status, title')
    .eq('template_key', COMPLETION_TEMPLATE_KEY)
    .order('version', { ascending: false });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function saveDraftTemplate(schema: CompletionTemplateSchema): Promise<void> {
  const { data: latest } = await supabase
    .from('completion_form_templates')
    .select('id, version, status')
    .eq('template_key', schema.key)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.status === 'draft') {
    const { error } = await supabase.from('completion_form_templates').update({ schema, title: schema.title }).eq('id', latest.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.from('completion_form_templates').insert({
    template_key: schema.key,
    version: (latest?.version ?? schema.version) + 1,
    title: schema.title,
    status: 'draft',
    schema,
  });
  if (error) throw new Error(error.message);
}

export async function publishDraftTemplate(): Promise<void> {
  const { data: draft, error } = await supabase
    .from('completion_form_templates')
    .select('id')
    .eq('template_key', COMPLETION_TEMPLATE_KEY)
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
