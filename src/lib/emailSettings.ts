import { supabase } from './supabase';

export type EmailProvider = 'development' | 'resend' | 'mailto';

export async function getEmailSettings(): Promise<{ provider: EmailProvider; from: string }> {
  const { data } = await supabase.from('integration_settings').select('key, value').in('key', ['email_provider', 'email_from']);
  const map = Object.fromEntries((data ?? []).map(row => [row.key, String(row.value ?? '')]));
  const provider = (map.email_provider || 'development') as EmailProvider;
  return {
    provider: ['development', 'resend', 'mailto'].includes(provider) ? provider : 'development',
    from: map.email_from || '',
  };
}

export async function saveEmailSettings(provider: EmailProvider, from: string): Promise<void> {
  const { error } = await supabase.from('integration_settings').upsert([
    { key: 'email_provider', value: provider },
    { key: 'email_from', value: from },
  ], { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

export async function recordEmailOutbox(row: {
  project_id: number;
  provider: string;
  recipient: string;
  subject: string;
  body: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('email_outbox').insert({
    project_id: row.project_id,
    provider: row.provider,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    meta: row.meta ?? {},
  });
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    throw new Error(error.message);
  }
}
