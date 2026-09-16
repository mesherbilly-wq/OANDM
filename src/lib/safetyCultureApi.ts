import { supabase } from './supabase';

export async function invokeSafetyCulture(
  action: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  const { data, error } = await supabase.functions.invoke('safetyculture-proxy', {
    body: { action, ...extra },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
