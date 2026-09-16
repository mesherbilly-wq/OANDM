import { supabase } from './supabase';
import type { Datasheet } from '../types';

export interface DatasheetCandidate {
  url: string;
  title: string;
  domain: string;
  verified: boolean;
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
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

export async function saveDatasheetFromUrl(
  url: string,
  manufacturer: string,
  model: string,
): Promise<Datasheet> {
  const { data, error } = await supabase.functions.invoke('fetch-datasheet', {
    body: { url, manufacturer: manufacturer.trim(), model: model.trim() },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.datasheet) throw new Error('Datasheet was downloaded but not saved.');
  return data.datasheet as Datasheet;
}

export async function findAndSaveDatasheet(
  manufacturer: string,
  model: string,
): Promise<{ datasheet: Datasheet | null; candidates: DatasheetCandidate[] }> {
  const candidates = await searchDatasheetCandidates(manufacturer, model);
  const verified = candidates.filter(candidate => candidate.verified);
  for (const candidate of verified) {
    try {
      const datasheet = await saveDatasheetFromUrl(candidate.url, manufacturer, model);
      return { datasheet, candidates };
    } catch {
      // Try the next verified URL; unverified hits stay available to pick manually.
    }
  }
  return { datasheet: null, candidates };
}
