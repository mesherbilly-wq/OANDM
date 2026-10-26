import { supabase } from './supabase';

export async function ownCompanyId(): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('app_profiles')
    .select('company_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.company_id) return null;
  return String(data.company_id);
}
