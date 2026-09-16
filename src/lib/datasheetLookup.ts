import { supabase } from './supabase';
import type { Datasheet } from '../types';

async function readFunctionError(error: unknown, data: unknown): Promise<string> {
  const payload = data as { error?: unknown } | null;
  if (payload?.error) return String(payload.error);

  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
      if (typeof body === 'string' && body.trim()) return body;
    } catch {
      try {
        const text = await context.text();
        if (text.trim()) return text.slice(0, 300);
      } catch {
        // Body already consumed or not readable.
      }
    }
  }

  const message = (error as { message?: string })?.message;
  if (message && !/non-2xx status code/i.test(message)) return message;
  return 'Could not download that datasheet PDF. Try another result, search the web, or upload the file.';
}

export interface DatasheetCandidate {
  url: string;
  title: string;
  domain: string;
  verified: boolean;
  score?: number;
}

export const AI_AUTO_PLACE_SCORE = 90;

export function aiPlacementFromDatasheet(
  datasheet: Pick<Datasheet, 'file_name'> & { source?: string | null; ai_confidence?: number | null },
): { placed: boolean; score: number | null } {
  if (datasheet.source === 'ai') {
    return {
      placed: true,
      score: datasheet.ai_confidence ?? parseAiPlacedScore(datasheet.file_name),
    };
  }
  const score = parseAiPlacedScore(datasheet.file_name);
  return { placed: score != null, score };
}

function parseAiPlacedScore(fileName: string | null | undefined): number | null {
  const match = /(?:^|\/)ai-placed-(\d+)[_-]/i.exec(fileName ?? '');
  if (!match) return null;
  const score = Number(match[1]);
  return Number.isFinite(score) ? score : null;
}

export function googleDatasheetSearchUrl(manufacturer: string, model: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${manufacturer} ${model} datasheet filetype:pdf`)}`;
}

export async function searchDatasheetCandidates(
  manufacturer: string,
  model: string,
): Promise<DatasheetCandidate[]> {
  const { data, error } = await supabase.functions.invoke('find-datasheet', {
    body: { manufacturer: manufacturer.trim(), model: model.trim() },
  });
  if (error) throw new Error(await readFunctionError(error, data));
  if (data?.error) throw new Error(data.error);
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

export async function saveDatasheetFromUrl(
  url: string,
  manufacturer: string,
  model: string,
  options?: { source?: 'ai' | 'upload'; score?: number },
): Promise<Datasheet> {
  const { data, error } = await supabase.functions.invoke('fetch-datasheet', {
    body: {
      url,
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      source: options?.source ?? 'upload',
      score: options?.score ?? null,
    },
  });
  if (error) throw new Error(await readFunctionError(error, data));
  if (data?.error) throw new Error(data.error);
  if (!data?.datasheet) throw new Error('Datasheet was downloaded but not saved.');
  return data.datasheet as Datasheet;
}

export async function findAndSaveDatasheet(
  manufacturer: string,
  model: string,
): Promise<{ datasheet: Datasheet | null; candidates: DatasheetCandidate[]; placedScore: number | null }> {
  const candidates = await searchDatasheetCandidates(manufacturer, model);
  const autoPlace = [...candidates]
    .filter(candidate => candidate.verified && (candidate.score ?? 0) >= AI_AUTO_PLACE_SCORE)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  for (const candidate of autoPlace) {
    try {
      const datasheet = await saveDatasheetFromUrl(candidate.url, manufacturer, model, {
        source: 'ai',
        score: candidate.score,
      });
      return { datasheet, candidates, placedScore: candidate.score ?? AI_AUTO_PLACE_SCORE };
    } catch {
      // Try the next high-score PDF.
    }
  }

  return { datasheet: null, candidates, placedScore: null };
}
