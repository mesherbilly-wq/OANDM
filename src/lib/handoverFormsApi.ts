import { supabase } from './supabase';

export interface HandoverFormInvite {
  token: string;
  fill_url: string;
  mailto_href: string;
  status: string;
  recipient_email: string | null;
  emailed: boolean;
}

export interface PublicHandoverForm {
  token: string;
  status: string;
  document_title: string;
  form_template_key: string;
  company_name: string | null;
  prefill: Record<string, string>;
  answers?: Record<string, unknown> | null;
  recipient_name: string | null;
  recipient_email: string | null;
}

function fillUrl(token: string): string {
  return `${window.location.origin}/f/${token}`;
}

function mailtoHref(to: string, title: string, url: string): string {
  const subject = encodeURIComponent(`${title} — please complete and sign`);
  const body = encodeURIComponent(`Please complete and sign this form online:\n\n${title}\n${url}`);
  return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function explainDbError(message: string): string {
  if (/schema cache|does not exist|handover_form_invites|get_handover_form|complete_handover_form/i.test(message)) {
    return 'Run migration 025_handover_web_forms.sql in the Supabase SQL editor, then try again.';
  }
  return message;
}

function asPublicForm(data: unknown): PublicHandoverForm {
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('This form link is not valid.');
  }
  return parsed as PublicHandoverForm;
}

export async function createHandoverFormInvite(payload: {
  project_id: number;
  document_id: string;
  document_title: string;
  form_template_key: string;
  recipient_email?: string;
  recipient_name?: string;
  system_type?: string | null;
  project_system_id?: number | null;
  prefill?: Record<string, string>;
  answers?: Record<string, unknown>;
}): Promise<HandoverFormInvite> {
  const token = randomToken();
  const url = fillUrl(token);
  const { error } = await supabase.from('handover_form_invites').insert({
    token,
    project_id: payload.project_id,
    document_id: payload.document_id,
    document_title: payload.document_title,
    form_template_key: payload.form_template_key,
    recipient_email: payload.recipient_email || null,
    recipient_name: payload.recipient_name || null,
    status: payload.recipient_email ? 'sent' : 'pending',
    prefill: payload.prefill ?? {},
    answers: payload.answers ?? null,
    system_type: payload.system_type ?? null,
    project_system_id: payload.project_system_id ?? null,
  });

  if (error) throw new Error(explainDbError(error.message));

  return {
    token,
    fill_url: url,
    mailto_href: mailtoHref(payload.recipient_email || '', payload.document_title, url),
    status: payload.recipient_email ? 'sent' : 'pending',
    recipient_email: payload.recipient_email || null,
    emailed: false,
  };
}

export async function getPublicHandoverForm(token: string): Promise<PublicHandoverForm> {
  const { data, error } = await supabase.rpc('get_handover_form', { p_token: token });
  if (error) throw new Error(explainDbError(error.message));
  return asPublicForm(data);
}

export async function saveHandoverFormDraft(token: string, answers: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('save_handover_form_draft', {
    p_token: token,
    p_answers: answers,
  });
  if (error) throw new Error(explainDbError(error.message));
}

export async function submitPublicHandoverForm(payload: {
  token: string;
  answers: Record<string, unknown>;
  signer_name: string;
  signature_data_url: string;
  pdf_base64: string;
  file_name: string;
}): Promise<{ ok: boolean; file_url: string }> {
  const raw = payload.pdf_base64.includes(',') ? payload.pdf_base64.split(',').pop()! : payload.pdf_base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const file = new Blob([bytes], { type: 'application/pdf' });

  const path = `forms/${payload.token}/${payload.file_name}`;
  const { error: uploadError } = await supabase.storage.from('om-uploads').upload(path, file, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
    throw new Error(`Could not save PDF: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage.from('om-uploads').getPublicUrl(path);
  const { data, error } = await supabase.rpc('complete_handover_form', {
    p_token: payload.token,
    p_answers: payload.answers,
    p_signer_name: payload.signer_name,
    p_file_name: payload.file_name,
    p_file_url: publicUrlData.publicUrl,
  });
  if (error) throw new Error(explainDbError(error.message));
  const result = (typeof data === 'string' ? JSON.parse(data) : data) as { ok?: boolean; file_url?: string } | null;
  return { ok: result?.ok ?? true, file_url: result?.file_url ?? publicUrlData.publicUrl };
}
