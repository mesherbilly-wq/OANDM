import { supabase } from './supabase';
import type { Datasheet } from '../types';
import { findLibraryDatasheetForDevice } from './datasheetMatching';

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
  source?: string;
}

export const AI_AUTO_PLACE_SCORE = 93;
export const ADI_AUTO_PLACE_SCORE = 93;

export function aiPlacementFromDatasheet(
  datasheet: Pick<Datasheet, 'file_name'> & { source?: string | null; ai_confidence?: number | null },
): { placed: boolean; source: 'adi' | 'ai' | null; score: number | null } {
  const adiScore = parsePlacedScore(datasheet.file_name, 'adi-placed');
  if (datasheet.source === 'adi' || adiScore != null) {
    return { placed: true, source: 'adi', score: adiScore ?? datasheet.ai_confidence ?? null };
  }
  if (datasheet.source === 'ai') {
    return {
      placed: true,
      source: 'ai',
      score: datasheet.ai_confidence ?? parsePlacedScore(datasheet.file_name, 'ai-placed'),
    };
  }
  const aiScore = parsePlacedScore(datasheet.file_name, 'ai-placed');
  return { placed: aiScore != null, source: aiScore != null ? 'ai' : null, score: aiScore };
}

function parsePlacedScore(fileName: string | null | undefined, prefix: 'ai-placed' | 'adi-placed'): number | null {
  const match = new RegExp(`(?:^|/)${prefix}-(\\d+)[_-]`, 'i').exec(fileName ?? '');
  if (!match) return null;
  const score = Number(match[1]);
  return Number.isFinite(score) ? score : null;
}

export function googleDatasheetSearchUrl(manufacturer: string, model: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${manufacturer} ${model} datasheet filetype:pdf`)}`;
}

export function adiDatasheetSearchUrl(manufacturer: string, model: string): string {
  return `https://www.adiglobaldistribution.co.uk/search?text=${encodeURIComponent(`${manufacturer} ${model}`.trim())}`;
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
  options?: { source?: 'ai' | 'adi' | 'upload'; score?: number; requireExactPart?: boolean },
): Promise<Datasheet> {
  const { data, error } = await supabase.functions.invoke('fetch-datasheet', {
    body: {
      url,
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      source: options?.source ?? 'upload',
      score: options?.score ?? null,
      requireExactPart: options?.requireExactPart ?? false,
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
): Promise<{ datasheet: Datasheet | null; candidates: DatasheetCandidate[]; placedScore: number | null; placedSource: 'adi' | 'ai' | null }> {
  const library = await findLibraryDatasheet(manufacturer, model);
  if (library) {
    return { datasheet: library, candidates: [], placedScore: 100, placedSource: null };
  }

  const candidates = await searchDatasheetCandidates(manufacturer, model);
  const autoPlace = [...candidates]
    .filter(candidate => {
      if ((candidate.score ?? 0) < ADI_AUTO_PLACE_SCORE) return false;
      if (!candidateNamesManufacturer(candidate, manufacturer)) return false;
      const exactPart = candidateHasExactPartNumber(candidate, manufacturer, model);
      const adiExact = candidateIsAdi(candidate) && (candidate.score ?? 0) >= 96;
      if (!exactPart && !adiExact) return false;
      if (candidateIsAdi(candidate)) return true;
      return Boolean(candidate.verified);
    })
    .sort((a, b) => {
      const aAdi = candidateIsAdi(a) ? 1 : 0;
      const bAdi = candidateIsAdi(b) ? 1 : 0;
      return (bAdi - aAdi) || ((b.score ?? 0) - (a.score ?? 0));
    });

  for (const candidate of autoPlace) {
    const source = candidateIsAdi(candidate) ? 'adi' : 'ai';
    try {
      const datasheet = await saveDatasheetFromUrl(candidate.url, manufacturer, model, {
        source,
        score: candidate.score,
        requireExactPart: true,
      });
      return { datasheet, candidates, placedScore: candidate.score ?? AI_AUTO_PLACE_SCORE, placedSource: source };
    } catch {
      // Try the next high-score PDF.
    }
  }

  return { datasheet: null, candidates, placedScore: null, placedSource: null };
}

function candidateIsAdi(candidate: DatasheetCandidate): boolean {
  return candidate.source === 'adi' || /adiglobaldistribution/i.test(candidate.domain) || /adiglobaldistribution|product-data-sheet/i.test(candidate.url);
}

function compactToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function candidateNamesManufacturer(candidate: DatasheetCandidate, manufacturer: string): boolean {
  return hayContainsManufacturer(`${candidate.title} ${candidate.url} ${candidate.domain}`, manufacturer);
}

export function hayContainsManufacturer(hay: string, manufacturer: string): boolean {
  const mfr = manufacturer.trim();
  if (!mfr) return false;
  const compactHay = compactToken(hay);
  const compactMfr = compactToken(mfr);
  if (compactMfr.length >= 3 && compactHay.includes(compactMfr)) return true;
  const generic = /^(ltd|limited|inc|uk|plc|the|and|group|international|global|distribution|security)$/;
  const words = mfr
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !generic.test(word));
  return words.some(word => compactHay.includes(compactToken(word)));
}

function distinctiveModelTokens(model: string, manufacturer: string): string[] {
  const generic = /^(premier|elite|series|keypad|wired|wireless|alarm|kit|zone|with|white|black|display|programmable|character)$/;
  const mfr = compactToken(manufacturer);
  return [...new Set(
    model
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 4 && !generic.test(word))
      .map(word => compactToken(word))
      .filter(word => word && word !== mfr && !mfr.includes(word)),
  )];
}

function candidateHasExactPartNumber(
  candidate: DatasheetCandidate,
  manufacturer: string,
  model: string,
): boolean {
  return hayContainsExactPart(`${candidate.title} ${candidate.url}`, model, manufacturer);
}

export async function findLibraryDatasheet(
  manufacturer: string,
  model: string,
): Promise<Datasheet | null> {
  const mfr = manufacturer.trim();
  const mdl = model.trim();
  if (!mfr || !mdl) return null;
  const { data } = await supabase
    .from('datasheets')
    .select('*')
    .not('datasheet_url', 'is', null)
    .ilike('manufacturer', `%${mfr.replace(/[%_]/g, '')}%`);
  if (!data?.length) return null;
  return findLibraryDatasheetForDevice(mfr, mdl, data) as Datasheet | null;
}

export function hayContainsExactPart(hay: string, model: string, manufacturer: string): boolean {
  const tokens = distinctiveModelTokens(model, manufacturer);
  const parts = hay
    .toLowerCase()
    .split(/[\s,;:/\\|()]+/)
    .map(part => compactToken(part))
    .filter(Boolean);
  if (tokens.length > 0) return tokens.every(token => parts.includes(token));
  const compactModel = compactToken(model);
  return compactModel.length >= 3 && parts.includes(compactModel);
}

export function selectProductPageIndexes(
  pageTexts: string[],
  manufacturer: string,
  model: string,
): number[] {
  const hits: number[] = [];
  for (let index = 0; index < pageTexts.length; index += 1) {
    if (hayContainsExactPart(pageTexts[index] ?? '', model, manufacturer)) hits.push(index);
  }
  if (hits.length === 0) return pageTexts.map((_, index) => index);
  const keep = new Set(hits);
  for (const index of hits) {
    const next = pageTexts[index + 1];
    if (next && hayContainsManufacturer(next, manufacturer)) keep.add(index + 1);
  }
  return [...keep].sort((left, right) => left - right);
}

function userDatasheetStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = '/object/public/user-datasheets/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
  } catch {
    return url.slice(idx + marker.length).split('?')[0];
  }
}

export async function forgetDatasheet(
  datasheet: Pick<Datasheet, 'id' | 'datasheet_url' | 'manufacturer' | 'model_number'>,
  alsoUnlink?: { manufacturer: string; modelNumber: string },
): Promise<void> {
  const path = userDatasheetStoragePath(datasheet.datasheet_url);
  if (path) {
    await supabase.storage.from('user-datasheets').remove([path]);
  }

  const { error } = await supabase.from('datasheets').delete().eq('id', datasheet.id);
  if (error) throw new Error(error.message || 'Could not remove that datasheet');

  const pairs = [
    { manufacturer: datasheet.manufacturer, modelNumber: datasheet.model_number },
    alsoUnlink,
  ].filter((pair): pair is { manufacturer: string; modelNumber: string } =>
    Boolean(pair?.manufacturer?.trim() && pair?.modelNumber?.trim()),
  );

  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = `${pair.manufacturer.trim().toLowerCase()}::${pair.modelNumber.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await supabase
      .from('devices')
      .update({ datasheet_found: false })
      .ilike('manufacturer', pair.manufacturer.trim())
      .ilike('model_number', pair.modelNumber.trim());
  }
}
