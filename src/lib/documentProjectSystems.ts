import type { Device, SystemCategory } from '../types';
import type { ProjectSystem } from './systems';
import { deriveProjectSystems, legacySystemNameToCategory, populatedProjectSystems } from './systems';
import { loadProjectSystemsForProject } from './projectSystemsDb';

export const PROJECT_WIDE_SYSTEM_KEY = '__project_wide__';
export const PROJECT_WIDE_SYSTEM_LABEL = 'Project-wide';

/** Load install sections for document grouping (project_systems with device fallback). */
export async function loadDocumentProjectSystems(
  projectId: number,
  devices: Device[] = [],
): Promise<ProjectSystem[]> {
  const systemRows = await loadProjectSystemsForProject(projectId, devices);
  return populatedProjectSystems(deriveProjectSystems(devices, systemRows));
}

/** Keep only systems still included in the O&M. Leftover document names are ignored. */
export function mergeDocumentSystemNames(
  projectSystems: ProjectSystem[],
  _extraNames: string[] = [],
): ProjectSystem[] {
  return populatedProjectSystems(projectSystems);
}

export function documentBelongsToProjectSystems(
  record: { system_type?: string | null; project_system_id?: number | null },
  systems: Array<Pick<ProjectSystem, 'id' | 'name'>>,
): boolean {
  if (isProjectWideDocument(record)) return true;
  return systems.some(system => documentMatchesSystem(record, system));
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

/** Map a chosen system name onto device columns, using a project system row when one exists. */
export function resolveSystemAssignment(
  projectSystems: Array<Pick<ProjectSystem, 'id' | 'name' | 'category'>>,
  systemName: string | null | undefined,
): { system_type: string | null; project_system_id: number | null; system_category: SystemCategory | null } {
  const name = systemName?.trim();
  if (!name) {
    return { system_type: null, project_system_id: null, system_category: null };
  }
  const matched = projectSystems.find(system => system.name === name);
  return {
    ...systemAssignmentFields(matched ?? { name, id: undefined }),
    system_category: matched ? matched.category ?? null : legacySystemNameToCategory(name),
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

  return groups;
}

export function resolveActiveDocumentSystem(
  systems: ProjectSystem[],
  activeKey: string,
): ProjectSystem | null {
  if (activeKey === PROJECT_WIDE_SYSTEM_KEY) return null;
  return systems.find(system => system.name === activeKey || system.slug === activeKey) ?? null;
}
