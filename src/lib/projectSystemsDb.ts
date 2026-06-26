import type { ImportReviewDraft, ImportSystemDraft } from '../integrations';
import { resolvedCategory } from '../integrations';
import { buildSimproPersistSourceReference } from '../integrations/connectors/simpro/simproImportHelpers';
import type { Device, ProjectSystemRecord, SystemCategory } from '../types';
import { legacySystemNameToCategory, normalizeSystemCategory, resolveSystemName } from './systems';
import { supabase } from './supabase';

export async function fetchProjectSystems(projectId: number): Promise<ProjectSystemRecord[]> {
  const { data, error } = await supabase
    .from('project_systems')
    .select('*')
    .eq('project_id', projectId)
    .order('display_order')
    .order('system_name');

  if (error) throw error;
  return (data ?? []) as ProjectSystemRecord[];
}

/** Create project_system rows from legacy devices when table is empty. */
export async function backfillProjectSystemsFromDevices(
  projectId: number,
  devices: Device[],
): Promise<ProjectSystemRecord[]> {
  const existing = await fetchProjectSystems(projectId);
  if (existing.length > 0) return existing;

  const projectDevices = devices.filter(device => device.project_id === projectId);
  if (projectDevices.length === 0) return [];

  const byName = new Map<string, { category: SystemCategory | null; deviceIds: number[] }>();

  for (const device of projectDevices) {
    const name = resolveSystemName(device);
    const category =
      normalizeSystemCategory(device.system_category) ??
      legacySystemNameToCategory(device.system_type ?? '');
    const bucket = byName.get(name) ?? { category: null, deviceIds: [] };
    bucket.deviceIds.push(device.id);
    if (!bucket.category && category) bucket.category = category;
    byName.set(name, bucket);
  }

  let displayOrder = 0;
  const created: ProjectSystemRecord[] = [];

  for (const [systemName, meta] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    displayOrder += 1;
    const { data: row, error } = await supabase
      .from('project_systems')
      .insert({
        project_id: projectId,
        system_name: systemName,
        system_category: meta.category,
        source_type: 'legacy',
        display_order: displayOrder,
      })
      .select('*')
      .single();

    if (error || !row) throw error ?? new Error('Failed to backfill project system.');

    if (meta.deviceIds.length > 0) {
      const { error: linkError } = await supabase
        .from('devices')
        .update({ project_system_id: row.id })
        .in('id', meta.deviceIds);
      if (linkError) throw linkError;
    }

    created.push(row as ProjectSystemRecord);
  }

  return created;
}

export async function loadProjectSystemsForProject(
  projectId: number,
  devices: Device[],
): Promise<ProjectSystemRecord[]> {
  const rows = await fetchProjectSystems(projectId);
  if (rows.length > 0) return rows;
  return backfillProjectSystemsFromDevices(projectId, devices);
}

export async function insertProjectSystemsFromSimproDraft(
  draft: ImportReviewDraft,
  projectId: number,
  persistSystemNames: Map<string, string>,
): Promise<Map<string, number>> {
  const systemIdByDraftId = new Map<string, number>();
  let displayOrder = 0;

  for (const system of draft.systems) {
    if (!system.selected) continue;

    displayOrder += 1;
    const systemName =
      persistSystemNames.get(system.draftId) ??
      (system.name.trim() || 'Unnamed System');

    const { data: row, error } = await supabase
      .from('project_systems')
      .insert({
        project_id: projectId,
        system_name: systemName,
        system_category: resolvedCategory(system),
        source_type: 'simpro',
        source_reference: buildSimproPersistSourceReference(system) ?? system.sourceSectionRef,
        notes: system.description,
        display_order: displayOrder,
      })
      .select('id')
      .single();

    if (error || !row) {
      throw error ?? new Error(`Failed to create project system "${systemName}".`);
    }

    systemIdByDraftId.set(system.draftId, row.id as number);
  }

  return systemIdByDraftId;
}

export async function ensureProjectSystem(
  projectId: number,
  systemName: string,
  category: SystemCategory | null,
  sourceType: string,
  sourceReference?: string | null,
): Promise<number> {
  const trimmedName = systemName.trim() || 'Unnamed System';

  const { data: existing, error: existingError } = await supabase
    .from('project_systems')
    .select('id')
    .eq('project_id', projectId)
    .eq('system_name', trimmedName)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return existing.id as number;

  const { data: maxOrderRow } = await supabase
    .from('project_systems')
    .select('display_order')
    .eq('project_id', projectId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const displayOrder = ((maxOrderRow?.display_order as number | undefined) ?? 0) + 1;

  const { data: created, error: createError } = await supabase
    .from('project_systems')
    .insert({
      project_id: projectId,
      system_name: trimmedName,
      system_category: category,
      source_type: sourceType,
      source_reference: sourceReference ?? null,
      display_order: displayOrder,
    })
    .select('id')
    .single();

  if (createError || !created) {
    throw createError ?? new Error(`Failed to create project system "${trimmedName}".`);
  }

  return created.id as number;
}

export async function saveProjectSystemRecord(
  projectId: number,
  systemId: number | null,
  currentName: string,
  newName: string,
  category: SystemCategory | null,
  notes?: string | null,
): Promise<string | null> {
  const trimmedName = newName.trim();
  if (!trimmedName) return 'System name is required.';

  const updatedAt = new Date().toISOString();

  if (systemId != null) {
    const { error: systemError } = await supabase
      .from('project_systems')
      .update({
        system_name: trimmedName,
        system_category: category,
        notes: notes ?? null,
        updated_at: updatedAt,
      })
      .eq('id', systemId)
      .eq('project_id', projectId);

    if (systemError) return systemError.message;
  }

  let deviceUpdate = supabase
    .from('devices')
    .update({
      system_type: trimmedName,
      system_category: category,
    })
    .eq('project_id', projectId);

  if (systemId != null) {
    deviceUpdate = deviceUpdate.eq('project_system_id', systemId);
  } else {
    deviceUpdate = deviceUpdate.eq('system_type', currentName);
  }

  const { error: deviceError } = await deviceUpdate;
  if (deviceError) return deviceError.message;

  return null;
}

export function buildPersistSystemNameMap(systems: ImportSystemDraft[]): Map<string, string> {
  const selected = systems.filter(system => system.selected);
  const baseNameCounts = new Map<string, number>();

  for (const system of selected) {
    const base = system.name.trim() || 'Unnamed System';
    baseNameCounts.set(base, (baseNameCounts.get(base) ?? 0) + 1);
  }

  const persistNames = new Map<string, string>();
  const usedNames = new Set<string>();

  for (const system of selected) {
    let name = system.name.trim() || 'Unnamed System';

    if ((baseNameCounts.get(name) ?? 0) > 1) {
      const refSuffix = system.sourceSectionRef?.split(':').filter(Boolean).pop();
      name = refSuffix ? `${name} — ${refSuffix}` : `${name} — ${system.draftId.slice(-6)}`;
    }

    let uniqueName = name;
    let suffix = 2;
    while (usedNames.has(uniqueName)) {
      uniqueName = `${name} (${suffix})`;
      suffix += 1;
    }

    usedNames.add(uniqueName);
    persistNames.set(system.draftId, uniqueName);
  }

  return persistNames;
}
