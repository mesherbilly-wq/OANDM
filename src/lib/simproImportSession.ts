import type { ImportReviewDraft } from '../integrations';

const SESSION_KEY = 'oandm.simpro.importReview.v1';

export interface SimproImportSession {
  draft: ImportReviewDraft;
  rawJob: unknown;
  savedAt: string;
}

export function setSimproImportSession(session: Omit<SimproImportSession, 'savedAt'>): void {
  const payload: SimproImportSession = {
    ...session,
    savedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

export function getSimproImportSession(): SimproImportSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SimproImportSession;
    if (!parsed?.draft?.reviewId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSimproImportSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
