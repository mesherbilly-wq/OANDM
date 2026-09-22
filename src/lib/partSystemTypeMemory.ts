import type { ImportEquipmentDraft, ImportReviewDraft } from '../integrations';
import { categoryForSystemName } from './inferSystemType';
import { normalizePart, pickMetadataString } from './equipmentMatchUtils';
import { supabase } from './supabase';

export const SYSTEM_TYPE_SOURCE_KEY = 'systemTypeSource';
export type SystemTypeSource = 'user' | 'remembered' | 'inferred';

const LOCAL_STORAGE_KEY = 'oandm.partSystemTypes';
const DEVICE_LOOKUP_CHUNK = 80;

export type PartSystemTypeMap = Map<string, string>;

export function rawPartNumberFromEquipment(item: ImportEquipmentDraft): string {
  return (
    item.modelNumber?.trim() ||
    pickMetadataString(item.metadata, 'simproPartNo') ||
    pickMetadataString(item.metadata, 'simproCatalogNo') ||
    pickMetadataString(item.metadata, 'simproStockNo') ||
    ''
  );
}

export function partKeyFromEquipment(item: ImportEquipmentDraft): string {
  return normalizePart(rawPartNumberFromEquipment(item));
}

export function collectImportPartKeys(draft: ImportReviewDraft): string[] {
  const keys = new Set<string>();
  for (const system of draft.systems) {
    for (const item of system.equipment) {
      const key = partKeyFromEquipment(item);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

export function getSystemTypeSource(item: ImportEquipmentDraft): SystemTypeSource | null {
  const value = item.metadata?.[SYSTEM_TYPE_SOURCE_KEY];
  if (value === 'user' || value === 'remembered' || value === 'inferred') return value;
  return null;
}

function withSystemTypeSource(item: ImportEquipmentDraft, source: SystemTypeSource | null): ImportEquipmentDraft {
  const metadata = { ...item.metadata };
  if (source) metadata[SYSTEM_TYPE_SOURCE_KEY] = source;
  else delete metadata[SYSTEM_TYPE_SOURCE_KEY];
  return { ...item, metadata };
}

function readLocalMemory(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function writeLocalMemory(entries: Record<string, string>): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* private browsing */
  }
}

function mergeIntoMap(target: PartSystemTypeMap, entries: Record<string, string> | PartSystemTypeMap): void {
  const pairs = entries instanceof Map ? entries.entries() : Object.entries(entries);
  for (const [key, value] of pairs) {
    if (key && value?.trim() && !target.has(key)) target.set(key, value.trim());
  }
}

async function loadFromTable(partKeys: string[]): Promise<PartSystemTypeMap> {
  const map: PartSystemTypeMap = new Map();
  if (partKeys.length === 0) return map;

  const { data, error } = await supabase
    .from('part_system_types')
    .select('part_key, system_type')
    .in('part_key', partKeys);

  if (error) return map;
  for (const row of data ?? []) {
    const key = typeof row.part_key === 'string' ? row.part_key : '';
    const systemType = typeof row.system_type === 'string' ? row.system_type.trim() : '';
    if (key && systemType) map.set(key, systemType);
  }
  return map;
}

async function loadFromDevices(items: ImportEquipmentDraft[]): Promise<PartSystemTypeMap> {
  const map: PartSystemTypeMap = new Map();
  const rawParts = [...new Set(
    items
      .map(item => item.modelNumber?.trim())
      .filter((value): value is string => Boolean(value)),
  )];
  if (rawParts.length === 0) return map;

  for (let offset = 0; offset < rawParts.length; offset += DEVICE_LOOKUP_CHUNK) {
    const chunk = rawParts.slice(offset, offset + DEVICE_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from('devices')
      .select('id, model_number, system_type')
      .in('model_number', chunk)
      .not('system_type', 'is', null)
      .order('id', { ascending: false });
    if (error) return map;
    for (const row of data ?? []) {
      const key = normalizePart(row.model_number);
      const systemType = typeof row.system_type === 'string' ? row.system_type.trim() : '';
      if (key && systemType && !map.has(key)) map.set(key, systemType);
    }
  }
  return map;
}

export async function loadPartSystemTypeMemory(draft: ImportReviewDraft): Promise<PartSystemTypeMap> {
  const items = draft.systems.flatMap(system => system.equipment);
  const partKeys = collectImportPartKeys(draft);
  const map: PartSystemTypeMap = new Map();

  mergeIntoMap(map, await loadFromTable(partKeys));
  mergeIntoMap(map, readLocalMemory());
  mergeIntoMap(map, await loadFromDevices(items));
  return map;
}

export async function rememberPartSystemType(args: {
  partNumber?: string | null;
  manufacturer?: string | null;
  systemType: string;
}): Promise<void> {
  const partNumber = args.partNumber?.trim() ?? '';
  const partKey = normalizePart(partNumber);
  const systemType = args.systemType.trim();
  if (!partKey || !systemType) return;

  const local = readLocalMemory();
  local[partKey] = systemType;
  writeLocalMemory(local);

  const { error } = await supabase.from('part_system_types').upsert({
    part_key: partKey,
    part_number: partNumber || partKey,
    manufacturer: args.manufacturer?.trim() || null,
    system_type: systemType,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'part_key' });

  if (error && !/does not exist|schema cache/i.test(error.message)) {
    console.warn('[part-system-type] Could not save remembered system type:', error.message);
  }
}

export function applyRememberedSystemTypesToDraft(
  draft: ImportReviewDraft,
  remembered: PartSystemTypeMap,
): ImportReviewDraft {
  if (remembered.size === 0) return draft;

  return {
    ...draft,
    systems: draft.systems.map(system => ({
      ...system,
      equipment: system.equipment.map(item => {
        if (getSystemTypeSource(item) === 'user') return item;
        const key = partKeyFromEquipment(item);
        const rememberedType = key ? remembered.get(key) : undefined;
        if (!rememberedType) return item;
        if (item.systemType?.trim() === rememberedType && getSystemTypeSource(item) === 'remembered') {
          return item;
        }
        return withSystemTypeSource({
          ...item,
          systemType: rememberedType,
          category: categoryForSystemName(rememberedType),
        }, 'remembered');
      }),
    })),
  };
}

export function applyManualSystemTypeToMatchingParts(
  draft: ImportReviewDraft,
  equipmentDraftId: string,
  systemType: string | null,
): ImportReviewDraft {
  let sourceItem: ImportEquipmentDraft | null = null;
  for (const system of draft.systems) {
    const match = system.equipment.find(item => item.draftId === equipmentDraftId);
    if (match) {
      sourceItem = match;
      break;
    }
  }
  if (!sourceItem) return draft;

  const partKey = partKeyFromEquipment({ ...sourceItem, modelNumber: sourceItem.modelNumber });
  const nextType = systemType?.trim() || null;
  if (nextType && partKey) {
    void rememberPartSystemType({
      partNumber: rawPartNumberFromEquipment(sourceItem) || partKey,
      manufacturer: sourceItem.manufacturer,
      systemType: nextType,
    });
  }

  return {
    ...draft,
    systems: draft.systems.map(system => ({
      ...system,
      equipment: system.equipment.map(item => {
        const sameLine = item.draftId === equipmentDraftId;
        const samePart = Boolean(partKey && partKeyFromEquipment(item) === partKey);
        if (!sameLine && !samePart) return item;
        return withSystemTypeSource({
          ...item,
          systemType: nextType,
          category: nextType ? categoryForSystemName(nextType) : item.category,
        }, nextType ? (sameLine ? 'user' : 'remembered') : null);
      }),
    })),
  };
}

export async function rememberManualSystemTypesFromDraft(draft: ImportReviewDraft): Promise<void> {
  const seen = new Set<string>();
  for (const system of draft.systems) {
    if (!system.selected) continue;
    for (const item of system.equipment) {
      if (!item.selected) continue;
      if (getSystemTypeSource(item) !== 'user') continue;
      const systemType = item.systemType?.trim();
      const partKey = partKeyFromEquipment(item);
      if (!systemType || !partKey || seen.has(partKey)) continue;
      seen.add(partKey);
      await rememberPartSystemType({
        partNumber: rawPartNumberFromEquipment(item) || partKey,
        manufacturer: item.manufacturer,
        systemType,
      });
    }
  }
}
