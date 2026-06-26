import type { SystemCategory } from '../types';
import type { GroupedEquipment } from './deviceGrouping';
import { getDevicePrefix } from './deviceLabel';
import { clampLineQuantity } from './devicePersistConstants';
import { saveProjectSystemRecord } from './projectSystemsDb';
import { notifyProjectDevicesChanged, resolveDeviceCategory } from './systems';
import { supabase } from './supabase';

/** Persist system display name and trade category on project_systems and linked devices. */
export async function saveProjectSystem(
  projectId: number,
  systemId: number | null,
  currentName: string,
  newName: string,
  category: SystemCategory | null,
): Promise<string | null> {
  const errorMessage = await saveProjectSystemRecord(
    projectId,
    systemId,
    currentName,
    newName,
    category,
  );
  if (!errorMessage) notifyProjectDevicesChanged();
  return errorMessage;
}

/** @deprecated Use saveProjectSystem */
export async function renameProjectSystem(
  projectId: number,
  currentName: string,
  newName: string,
): Promise<string | null> {
  return saveProjectSystem(projectId, null, currentName, newName, null);
}

/** @deprecated Use saveProjectSystem */
export async function updateProjectSystemCategory(
  projectId: number,
  systemName: string,
  category: SystemCategory | null,
): Promise<string | null> {
  return saveProjectSystem(projectId, null, systemName, systemName, category);
}

export interface EquipmentGroupUpdates {
  manufacturer?: string | null;
  model_number?: string | null;
  device_type?: string | null;
  location?: string | null;
  notes?: string | null;
  quantity?: number;
}

export async function updateEquipmentGroup(
  projectId: number,
  group: GroupedEquipment,
  updates: EquipmentGroupUpdates,
  prefixCounters: Record<string, number>,
): Promise<string | null> {
  const ids = group.devices.map(device => device.id);
  const fieldUpdates: Record<string, unknown> = {};

  if (updates.manufacturer !== undefined) fieldUpdates.manufacturer = updates.manufacturer;
  if (updates.model_number !== undefined) fieldUpdates.model_number = updates.model_number;
  if (updates.device_type !== undefined) fieldUpdates.device_type = updates.device_type;
  if (updates.location !== undefined) fieldUpdates.location = updates.location;
  if (updates.notes !== undefined) fieldUpdates.notes = updates.notes;

  if (Object.keys(fieldUpdates).length > 0) {
    const { error } = await supabase.from('devices').update(fieldUpdates).in('id', ids);
    if (error) return error.message;
  }

  if (updates.quantity === undefined) {
    if (Object.keys(fieldUpdates).length > 0) notifyProjectDevicesChanged();
    return null;
  }

  const targetQty = clampLineQuantity(updates.quantity);
  const currentQty = group.devices.length;
  if (targetQty === currentQty) return null;

  if (targetQty < currentQty) {
    const excessIds = group.devices.slice(targetQty).map(device => device.id);
    const { error } = await supabase.from('devices').delete().in('id', excessIds);
    if (!error) notifyProjectDevicesChanged();
    return error?.message ?? null;
  }

  const template = group.devices[0];
  const category = resolveDeviceCategory(template) ?? 'Other';
  const prefix = getDevicePrefix(category, template.device_type ?? '');
  const newRows: Record<string, unknown>[] = [];

  for (let unit = currentQty; unit < targetQty; unit += 1) {
    prefixCounters[prefix] = (prefixCounters[prefix] ?? 0) + 1;
    newRows.push({
      project_id: projectId,
      project_system_id: template.project_system_id,
      system_type: template.system_type,
      system_category: template.system_category,
      device_type: template.device_type,
      device_name: `${prefix}-${String(prefixCounters[prefix]).padStart(3, '0')}`,
      manufacturer: template.manufacturer,
      model_number: template.model_number,
      model_name: template.model_name,
      location: template.location,
      notes: template.notes,
      matched: template.matched,
      datasheet_found: template.datasheet_found,
      status: template.status,
      source_document: template.source_document,
    });
  }

  const { error } = await supabase.from('devices').insert(newRows);
  if (!error) notifyProjectDevicesChanged();
  return error?.message ?? null;
}

export function buildPrefixCounters(
  existingNames: { device_name: string | null }[],
): Record<string, number> {
  const prefixCounters: Record<string, number> = {};
  for (const device of existingNames) {
    const match = device.device_name?.match(/^([A-Z]+)-(\d+)$/);
    if (!match) continue;
    const prefix = match[1];
    const number = parseInt(match[2], 10);
    if (!prefixCounters[prefix] || number > prefixCounters[prefix]) {
      prefixCounters[prefix] = number;
    }
  }
  return prefixCounters;
}
