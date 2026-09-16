import { supabase } from './supabase';

const SESSION_KEY = 'oandm.simpro.connection.v1';
export const SIMPRO_CONNECTION_KEY = 'simpro_connection';

export interface SimproConnectionSession {
  baseUrl: string;
  companyId: string;
  apiToken: string;
  connectedAt: string;
  companyName: string | null;
  apiVersion: string | null;
}

let memoryCache: SimproConnectionSession | null | undefined;

function parseConnection(raw: unknown): SimproConnectionSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<SimproConnectionSession>;
  if (!parsed.baseUrl || !parsed.apiToken) return null;
  return {
    baseUrl: parsed.baseUrl,
    companyId: parsed.companyId ?? '',
    apiToken: parsed.apiToken,
    connectedAt: parsed.connectedAt ?? new Date().toISOString(),
    companyName: parsed.companyName ?? null,
    apiVersion: parsed.apiVersion ?? null,
  };
}

function cacheConnection(session: SimproConnectionSession | null): void {
  memoryCache = session;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage failures (private mode).
  }
}

function readLocalCache(): SimproConnectionSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return parseConnection(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function getSimproConnectionSession(): SimproConnectionSession | null {
  if (memoryCache !== undefined) return memoryCache;
  const local = readLocalCache();
  memoryCache = local;
  return local;
}

export function setSimproConnectionSession(session: SimproConnectionSession): void {
  cacheConnection(session);
}

export function clearSimproConnectionSession(): void {
  cacheConnection(null);
}

export function isSimproConnectionConfigured(): boolean {
  const session = getSimproConnectionSession();
  return !!session?.baseUrl && !!session?.apiToken;
}

export function isSimproJobDiscoveryEnabled(): boolean {
  return import.meta.env.VITE_SIMPRO_JOB_DISCOVERY === 'true';
}

export function isMissingRelationError(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = error?.message ?? '';
  return error?.code === '42P01' || /does not exist|schema cache/i.test(message);
}

export async function loadSimproConnection(): Promise<{
  connection: SimproConnectionSession | null;
  error: string | null;
  needsMigration: boolean;
}> {
  const { data, error } = await supabase
    .from('integration_settings')
    .select('value')
    .eq('key', SIMPRO_CONNECTION_KEY)
    .maybeSingle();

  if (error) {
    const local = readLocalCache();
    cacheConnection(local);
    return {
      connection: local,
      error: error.message,
      needsMigration: isMissingRelationError(error),
    };
  }

  if (!data?.value) {
    cacheConnection(null);
    return { connection: null, error: null, needsMigration: false };
  }

  try {
    const parsed = parseConnection(typeof data.value === 'string' ? JSON.parse(data.value) : data.value);
    cacheConnection(parsed);
    return { connection: parsed, error: null, needsMigration: false };
  } catch {
    cacheConnection(null);
    return { connection: null, error: 'Saved Simpro connection could not be read.', needsMigration: false };
  }
}

export async function saveSimproConnection(session: SimproConnectionSession): Promise<{ error: string | null; needsMigration: boolean }> {
  const { error } = await supabase.from('integration_settings').upsert(
    {
      key: SIMPRO_CONNECTION_KEY,
      value: JSON.stringify(session),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );

  if (error) {
    return { error: error.message, needsMigration: isMissingRelationError(error) };
  }

  cacheConnection(session);
  return { error: null, needsMigration: false };
}

export async function unlinkSimproConnection(): Promise<{ error: string | null; needsMigration: boolean }> {
  const { error } = await supabase.from('integration_settings').delete().eq('key', SIMPRO_CONNECTION_KEY);
  if (error) {
    return { error: error.message, needsMigration: isMissingRelationError(error) };
  }
  cacheConnection(null);
  return { error: null, needsMigration: false };
}
