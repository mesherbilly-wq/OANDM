import type { Device } from '../types';
import {
  extractProductCategoryFromNotes,
  extractWarrantyYearsFromNotes,
  getDeviceProductDescription,
} from './deviceProductFields';

export const IMPORT_LINE_NOTE_TAG = '[oandm:line:';

export interface GroupedEquipment {
  product_description: string | null;
  manufacturer: string | null;
  part_number: string | null;
  product_category: string | null;
  warranty_years: number | null;
  /** @deprecated Use product_description */
  description: string | null;
  /** @deprecated Use part_number */
  model_number: string | null;
  system_type: string | null;
  quantity: number;
  devices: Device[];
}

function normalizeKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Stable import-line id written during Simpro persist (`[oandm:line:{draftId}]`). */
export function extractImportLineDraftId(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const start = notes.indexOf(IMPORT_LINE_NOTE_TAG);
  if (start < 0) return null;
  const from = start + IMPORT_LINE_NOTE_TAG.length;
  const end = notes.indexOf(']', from);
  if (end < 0) return null;
  const draftId = notes.slice(from, end).trim();
  return draftId || null;
}

export function getDeviceGroupKey(device: Device): string {
  return buildGroupKey(device);
}

export function getGroupRowKey(group: GroupedEquipment): string {
  return getDeviceGroupKey(group.devices[0]);
}

function buildGroupKey(device: Device): string {
  const importLineDraftId = extractImportLineDraftId(device.notes);
  if (importLineDraftId) {
    return [
      'import-line',
      importLineDraftId,
      String(device.project_system_id ?? ''),
      normalizeKey(device.system_type),
    ].join('\0');
  }

  return [
    normalizeKey(device.manufacturer),
    normalizeKey(device.model_number),
    normalizeKey(getDeviceProductDescription(device)),
    normalizeKey(device.system_type),
  ].join('\0');
}

function buildGroupedEquipment(members: Device[]): GroupedEquipment {
  const first = members[0];
  const productDescription = getDeviceProductDescription(first);
  return {
    product_description: productDescription,
    manufacturer: first.manufacturer?.trim() || null,
    part_number: first.model_number?.trim() || null,
    product_category: extractProductCategoryFromNotes(first.notes),
    warranty_years: extractWarrantyYearsFromNotes(first.notes),
    description: productDescription,
    model_number: first.model_number?.trim() || null,
    system_type: first.system_type,
    quantity: members.length,
    devices: members,
  };
}

/**
 * Groups individual device rows by manufacturer, part number, description, and system.
 * Does not mutate or replace source records — each group retains the original Device[].
 */
export function groupDevices(devices: Device[]): GroupedEquipment[] {
  const byKey = new Map<string, Device[]>();

  for (const device of devices) {
    const key = buildGroupKey(device);
    const existing = byKey.get(key);
    if (existing) existing.push(device);
    else byKey.set(key, [device]);
  }

  const groups: GroupedEquipment[] = [];
  for (const members of byKey.values()) {
    groups.push(buildGroupedEquipment(members));
  }

  groups.sort((a, b) => {
    const bySystem = normalizeKey(a.system_type).localeCompare(normalizeKey(b.system_type));
    if (bySystem !== 0) return bySystem;
    const byManufacturer = normalizeKey(a.manufacturer).localeCompare(normalizeKey(b.manufacturer));
    if (byManufacturer !== 0) return byManufacturer;
    const byPart = normalizeKey(a.part_number).localeCompare(normalizeKey(b.part_number));
    if (byPart !== 0) return byPart;
    return normalizeKey(a.product_description).localeCompare(normalizeKey(b.product_description));
  });

  return groups;
}
