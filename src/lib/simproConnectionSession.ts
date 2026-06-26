const SESSION_KEY = 'oandm.simpro.connection.v1';

export interface SimproConnectionSession {
  baseUrl: string;
  companyId: string;
  apiToken: string;
  connectedAt: string;
  companyName: string | null;
  apiVersion: string | null;
}

export function setSimproConnectionSession(session: SimproConnectionSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getSimproConnectionSession(): SimproConnectionSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SimproConnectionSession;
    if (!parsed?.baseUrl || !parsed?.apiToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSimproConnectionSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function isSimproConnectionConfigured(): boolean {
  const session = getSimproConnectionSession();
  return !!session?.baseUrl && !!session?.apiToken;
}

export function isSimproJobDiscoveryEnabled(): boolean {
  return import.meta.env.VITE_SIMPRO_JOB_DISCOVERY === 'true';
}
