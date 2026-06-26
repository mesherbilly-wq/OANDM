import type { Device } from '../types';
import type { ProjectSystem } from './systems';
import { deriveProjectSystems, systemNameToSlug } from './systems';
import { loadProjectSystemsForProject } from './projectSystemsDb';

export const PROJECT_WIDE_SYSTEM_KEY = '__project_wide__';
export const PROJECT_WIDE_SYSTEM_LABEL = 'Project-wide';

/** Load install sections for document grouping (project_systems with device fallback). */
export async function loadDocumentProjectSystems(
  projectId: number,
  devices: Device[] = [],
): Promise<ProjectSystem[]> {
  const systemRows = await loadProjectSystemsForProject(projectId, devices);
  return deriveProjectSystems(devices, systemRows);
}

/** Merge extra system names from stored documents (e.g. legacy tech_doc imports). */
export function mergeDocumentSystemNames(
  projectSystems: ProjectSystem[],
  extraNames: string[],
): ProjectSystem[] {
  const byName = new Map(projectSystems.map(system => [system.name, system]));

  for (const rawName of extraNames) {
    const name = rawName?.trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, {
      name,
      slug: systemNameToSlug(name),
      category: null,
      deviceCount: 0,
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function documentMatchesSystem(
  record: { system_type?: string | null; project_system_id?: number | null },
  system: Pick<ProjectSystem, 'id' | 'name'>,
): boolean {
  if (system.id != null && record.project_system_id != null) {
    return record.project_system_id === system.id;
  }
  const recordName = record.system_type?.trim();
  if (!recordName) return false;
  return recordName === system.name;
}

export function isProjectWideDocument(
  record: { system_type?: string | null; project_system_id?: number | null },
): boolean {
  return record.project_system_id == null && !record.system_type?.trim();
}

export function systemAssignmentFields(
  system: Pick<ProjectSystem, 'id' | 'name'> | null,
): { system_type: string | null; project_system_id: number | null } {
  if (!system) {
    return { system_type: null, project_system_id: null };
  }
  return {
    system_type: system.name,
    project_system_id: system.id ?? null,
  };
}

export function groupRecordsByProjectSystems<
  T extends { system_type?: string | null; project_system_id?: number | null },
>(
  projectSystems: ProjectSystem[],
  records: T[],
): Array<{ system: ProjectSystem | null; label: string; records: T[] }> {
  const groups: Array<{ system: ProjectSystem | null; label: string; records: T[] }> = [];
  const matched = new Set<T>();

  for (const system of projectSystems) {
    const systemRecords = records.filter(record => documentMatchesSystem(record, system));
    systemRecords.forEach(record => matched.add(record));
    if (systemRecords.length > 0) {
      groups.push({ system, label: system.name, records: systemRecords });
    }
  }

  const projectWide = records.filter(record => isProjectWideDocument(record));
  projectWide.forEach(record => matched.add(record));
  if (projectWide.length > 0) {
    groups.push({ system: null, label: PROJECT_WIDE_SYSTEM_LABEL, records: projectWide });
  }

  const byLegacyName = new Map<string, T[]>();
  for (const record of records) {
    if (matched.has(record)) continue;
    const name = record.system_type?.trim() || 'Unassigned';
    const bucket = byLegacyName.get(name) ?? [];
    bucket.push(record);
    byLegacyName.set(name, bucket);
  }
  for (const [name, legacyRecords] of byLegacyName.entries()) {
    groups.push({ system: null, label: name, records: legacyRecords });
  }

  return groups;
}

export function resolveActiveDocumentSystem(
  systems: ProjectSystem[],
  activeKey: string,
): ProjectSystem | null {
  if (activeKey === PROJECT_WIDE_SYSTEM_KEY) return null;
  return systems.find(system => system.name === activeKey || system.slug === activeKey) ?? null;
}
