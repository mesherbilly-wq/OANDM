import type { LucideIcon } from 'lucide-react';
import {
  Building2, Flame, Plug, Wrench, Wind, Droplets, Monitor, Server, Shield,
  HelpCircle,
} from 'lucide-react';
import type { Device, ProjectSystemRecord, SystemCategory } from '../types';

/** Trade-agnostic categories — styling and reporting only, not project hierarchy. */
export const SYSTEM_CATEGORIES: SystemCategory[] = [
  'Security',
  'Fire',
  'Electrical',
  'Mechanical',
  'HVAC',
  'Plumbing',
  'Audio Visual',
  'IT',
  'Building Fabric',
  'Other',
];

/** Legacy Fire & Security system type names (pre trade-agnostic model). */
export const LEGACY_SYSTEM_TYPE_NAMES = [
  'CCTV',
  'Access Control',
  'Intruder',
  'Intercom',
  'ANPR',
  'Perimeter Detection',
  'Networking',
] as const;

export type LegacySystemTypeName = (typeof LEGACY_SYSTEM_TYPE_NAMES)[number];

export interface ProjectSystem {
  id?: number;
  name: string;
  slug: string;
  category: SystemCategory | null;
  deviceCount: number;
  handoverDocumentTypeKey?: string | null;
}

export interface CategoryStyle {
  icon: LucideIcon;
  badgeClass: string;
  navClass: string;
  colorKey: string;
}

const CATEGORY_STYLES: Record<SystemCategory, CategoryStyle> = {
  Security: {
    icon: Shield,
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
    navClass: 'text-slate-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'slate',
  },
  Fire: {
    icon: Flame,
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
    navClass: 'text-red-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'red',
  },
  Electrical: {
    icon: Plug,
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-200',
    navClass: 'text-amber-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'amber',
  },
  Mechanical: {
    icon: Wrench,
    badgeClass: 'bg-orange-100 text-orange-900 border-orange-200',
    navClass: 'text-orange-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'orange',
  },
  HVAC: {
    icon: Wind,
    badgeClass: 'bg-cyan-100 text-cyan-900 border-cyan-200',
    navClass: 'text-cyan-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'cyan',
  },
  Plumbing: {
    icon: Droplets,
    badgeClass: 'bg-blue-100 text-blue-900 border-blue-200',
    navClass: 'text-blue-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'blue',
  },
  'Audio Visual': {
    icon: Monitor,
    badgeClass: 'bg-violet-100 text-violet-900 border-violet-200',
    navClass: 'text-violet-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'violet',
  },
  IT: {
    icon: Server,
    badgeClass: 'bg-indigo-100 text-indigo-900 border-indigo-200',
    navClass: 'text-indigo-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'indigo',
  },
  'Building Fabric': {
    icon: Building2,
    badgeClass: 'bg-stone-100 text-stone-800 border-stone-200',
    navClass: 'text-stone-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'stone',
  },
  Other: {
    icon: HelpCircle,
    badgeClass: 'bg-gray-100 text-gray-800 border-gray-200',
    navClass: 'text-gray-300 hover:text-white hover:bg-slate-800/60',
    colorKey: 'gray',
  },
};

const LEGACY_NAME_TO_CATEGORY: Record<LegacySystemTypeName, SystemCategory> = {
  CCTV: 'Security',
  'Access Control': 'Security',
  Intruder: 'Security',
  Intercom: 'Security',
  ANPR: 'Security',
  'Perimeter Detection': 'Security',
  Networking: 'IT',
};

export function isLegacySystemTypeName(value: string | null | undefined): value is LegacySystemTypeName {
  if (!value) return false;
  return (LEGACY_SYSTEM_TYPE_NAMES as readonly string[]).includes(value);
}

export function legacySystemNameToCategory(name: string): SystemCategory {
  if (isLegacySystemTypeName(name)) {
    return LEGACY_NAME_TO_CATEGORY[name];
  }
  return 'Other';
}

export function normalizeSystemCategory(value: string | null | undefined): SystemCategory | null {
  if (!value?.trim()) return null;
  const match = SYSTEM_CATEGORIES.find(
    category => category.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? null;
}

export function getCategoryStyle(category: SystemCategory | null | undefined): CategoryStyle {
  return CATEGORY_STYLES[category ?? 'Other'];
}

export function systemNameToSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'system';
}

export function resolveDeviceCategory(device: Pick<Device, 'system_type' | 'system_category'>): SystemCategory | null {
  return normalizeSystemCategory(device.system_category) ?? legacySystemNameToCategory(device.system_type ?? '');
}

export function resolveSystemName(device: Pick<Device, 'system_type'>): string {
  const name = device.system_type?.trim();
  return name || 'Unnamed System';
}

function assignUniqueSlugs(systems: Omit<ProjectSystem, 'slug'>[]): ProjectSystem[] {
  const usedSlugs = new Set<string>();
  return systems.map(system => {
    const baseSlug = systemNameToSlug(system.name);
    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    return { ...system, slug };
  });
}

export const PROJECT_DEVICES_CHANGED_EVENT = 'oandm:project-devices-changed';

export function notifyProjectDevicesChanged(): void {
  window.dispatchEvent(new Event(PROJECT_DEVICES_CHANGED_EVENT));
}

export function deviceBelongsToSystem(
  device: Device,
  system: { id?: number; name: string },
): boolean {
  if (system.id != null && device.project_system_id != null) {
    return device.project_system_id === system.id;
  }
  return resolveSystemName(device) === system.name;
}

export function resolveSystemRecordCategory(
  system: Pick<ProjectSystemRecord, 'system_category' | 'system_name'>,
): SystemCategory | null {
  return (
    normalizeSystemCategory(system.system_category) ??
    legacySystemNameToCategory(system.system_name)
  );
}

function deriveProjectSystemsFromDevices(devices: Device[]): ProjectSystem[] {
  const byName = new Map<string, { category: SystemCategory | null; count: number }>();

  for (const device of devices) {
    const name = resolveSystemName(device);
    const category = resolveDeviceCategory(device);
    const existing = byName.get(name);
    if (existing) {
      existing.count += 1;
      if (!existing.category && category) existing.category = category;
    } else {
      byName.set(name, { category, count: 1 });
    }
  }

  const systems = [...byName.entries()]
    .map(([name, meta]) => ({
      name,
      category: meta.category,
      deviceCount: meta.count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return assignUniqueSlugs(systems);
}

function deriveProjectSystemsFromTable(
  systemRows: ProjectSystemRecord[],
  devices: Device[],
): ProjectSystem[] {
  const systems = [...systemRows]
    .sort((a, b) => a.display_order - b.display_order || a.system_name.localeCompare(b.system_name))
    .map(row => ({
      id: row.id,
      name: row.system_name,
      category: resolveSystemRecordCategory(row),
      handoverDocumentTypeKey: row.handover_document_type_key ?? null,
      deviceCount: devices.filter(device =>
        deviceBelongsToSystem(device, { id: row.id, name: row.system_name }),
      ).length,
    }));

  return assignUniqueSlugs(systems);
}

/** Project systems from table when available; otherwise infer from device rows only. */
export function deriveProjectSystems(
  devices: Device[],
  systemRows: ProjectSystemRecord[] = [],
): ProjectSystem[] {
  if (systemRows.length > 0) {
    return deriveProjectSystemsFromTable(systemRows, devices);
  }
  return deriveProjectSystemsFromDevices(devices);
}

export function findProjectSystemBySlug(systems: ProjectSystem[], slug: string | undefined): ProjectSystem | null {
  if (!slug) return null;
  return systems.find(system => system.slug === slug) ?? null;
}

export function findProjectSystemById(systems: ProjectSystem[], id: number | undefined): ProjectSystem | null {
  if (id == null) return null;
  return systems.find(system => system.id === id) ?? null;
}

export function legacySystemSlugToName(slug: string): string | null {
  const legacySlugMap: Record<string, LegacySystemTypeName> = {
    cctv: 'CCTV',
    'access-control': 'Access Control',
    intruder: 'Intruder',
    intercom: 'Intercom',
    anpr: 'ANPR',
    perimeter: 'Perimeter Detection',
    networking: 'Networking',
  };
  return legacySlugMap[slug] ?? null;
}

export function resolveSystemSlugToName(
  systems: ProjectSystem[],
  slug: string | undefined,
): string | null {
  const matched = findProjectSystemBySlug(systems, slug);
  if (matched) return matched.name;
  return legacySystemSlugToName(slug ?? '');
}
