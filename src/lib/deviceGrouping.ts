import type { Device, SystemType } from '../types';

export interface GroupedEquipment {
  manufacturer: string | null;
  model_number: string | null;
  description: string | null;
  system_type: SystemType | null;
  quantity: number;
  devices: Device[];
}

function normalizeKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Uses device_type as the equipment description (Device has no separate description field). */
function getDescription(device: Device): string | null {
  const description = device.device_type?.trim();
  return description || null;
}

function buildGroupKey(device: Device): string {
  return [
    normalizeKey(device.manufacturer),
    normalizeKey(device.model_number),
    normalizeKey(getDescription(device)),
    normalizeKey(device.system_type),
  ].join('\0');
}

/**
 * Groups individual device rows by manufacturer, model, description (device_type), and system.
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
    const first = members[0];
    groups.push({
      manufacturer: first.manufacturer?.trim() || null,
      model_number: first.model_number?.trim() || null,
      description: getDescription(first),
      system_type: first.system_type,
      quantity: members.length,
      devices: members,
    });
  }

  groups.sort((a, b) => {
    const bySystem = normalizeKey(a.system_type).localeCompare(normalizeKey(b.system_type));
    if (bySystem !== 0) return bySystem;
    const byManufacturer = normalizeKey(a.manufacturer).localeCompare(normalizeKey(b.manufacturer));
    if (byManufacturer !== 0) return byManufacturer;
    const byModel = normalizeKey(a.model_number).localeCompare(normalizeKey(b.model_number));
    if (byModel !== 0) return byModel;
    return normalizeKey(a.description).localeCompare(normalizeKey(b.description));
  });

  return groups;
}
