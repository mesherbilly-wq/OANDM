import type { Device, SystemCategory } from '../types';
import { getDeviceProductDescription, extractProductCategoryFromNotes } from './deviceProductFields';
import { isLegacySystemTypeName, legacySystemNameToCategory, LEGACY_SYSTEM_TYPE_NAMES } from './systems';

const KNOWN_INSTALL_SYSTEMS = [...LEGACY_SYSTEM_TYPE_NAMES, 'Fire'] as const;

const SYSTEM_TYPE_RULES: { name: string; patterns: RegExp[] }[] = [
  { name: 'ANPR', patterns: [/\banpr\b/i, /\blpr\b/i, /number\s*plate/i, /licence\s*plate/i, /license\s*plate/i] },
  { name: 'Perimeter Detection', patterns: [/\bperimeter\b/i, /\bpids\b/i, /fence\s*detect/i, /taut\s*wire/i] },
  {
    name: 'Access Control',
    patterns: [
      /\baccess control\b/i, /\bacs\b/i, /door controller/i, /card reader/i, /\bmaglock\b/i,
      /\bpaxton\b/i, /\bsalto\b/i, /\bhid\b/i, /\breader\b/i, /\bprox\b/i, /request.to.exit/i,
    ],
  },
  { name: 'Intercom', patterns: [/\bintercom\b/i, /video door/i, /door entry/i, /\b2n\b/i, /\bcommend\b/i] },
  {
    name: 'Intruder',
    patterns: [/\bintruder\b/i, /\bpir\b/i, /\bgrade\s*[23]\b/i, /alarm panel/i, /\btexecom\b/i, /\bgalaxy\b/i],
  },
  {
    name: 'CCTV',
    patterns: [
      /\bcctv\b/i, /\bcamera\b/i, /\bnvr\b/i, /\bdvr\b/i, /\bptz\b/i, /\bdome\b/i,
      /\baxis\b/i, /\bhikvision\b/i, /\bdahua\b/i, /\bhanwha\b/i, /\buniview\b/i, /\bwisenet\b/i,
    ],
  },
  { name: 'Networking', patterns: [/\bnetwork/i, /\bswitch\b/i, /\bpoe\b/i, /\brouter\b/i, /\bpatch panel/i] },
  {
    name: 'Fire',
    patterns: [/\bfire alarm/i, /\bfire detect/i, /\bsounder\b/i, /\bvesda\b/i, /\bnotifier\b/i, /\bloop\b/i, /\bmcie\b/i],
  },
];

export function isKnownInstallSystemName(name: string | null | undefined): boolean {
  const text = name?.trim();
  if (!text) return false;
  return KNOWN_INSTALL_SYSTEMS.some(item => item.toLowerCase() === text.toLowerCase());
}

export function looksLikeCommercialCostCentre(name: string | null | undefined): boolean {
  const text = name?.trim() ?? '';
  if (!text) return false;
  return /^(materials?|labour|labor|prelims?|overheads?|plant|attendance|sundries|discount|pc\s*sum|provisional|prebuild|section\b|cost\s*centre|cost\s*center)/i.test(text);
}

export function shouldAutoAssignSystemType(current: string | null | undefined): boolean {
  const name = current?.trim();
  if (!name || /^unnamed system$/i.test(name)) return true;
  if (isKnownInstallSystemName(name) || isLegacySystemTypeName(name)) return false;
  if (looksLikeCommercialCostCentre(name)) return true;
  return false;
}

export function categoryForSystemName(name: string): SystemCategory {
  if (name.trim().toLowerCase() === 'fire') return 'Fire';
  return legacySystemNameToCategory(name);
}

export function inferSystemTypeName(texts: (string | null | undefined)[]): string | null {
  const combined = texts.filter(Boolean).join(' ');
  if (!combined.trim()) return null;

  let bestName: string | null = null;
  let bestScore = 0;

  for (const rule of SYSTEM_TYPE_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(combined)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestName = rule.name;
    }
  }

  return bestScore > 0 ? bestName : null;
}

const TRADE_CATEGORY_RULES: { category: SystemCategory; patterns: RegExp[] }[] = [
  { category: 'Security', patterns: [/\bsecurity\b/i, /\balarm\b/i] },
  { category: 'Fire', patterns: [/\bfire\b/i, /\bsprinkler/i] },
  { category: 'Electrical', patterns: [/\belectrical/i, /\blv switch/i, /\bdistribution board/i] },
  { category: 'Mechanical', patterns: [/\bmechanical/i, /\bpump\b/i, /\bplant room/i] },
  { category: 'HVAC', patterns: [/\bhvac\b/i, /\bair handling/i, /\bahu\b/i, /\bchiller/i, /\bventilation/i] },
  { category: 'Plumbing', patterns: [/\bplumb/i, /\bdomestic water/i, /\bdrainage/i] },
  { category: 'Audio Visual', patterns: [/\baudio visual/i, /\bav system/i, /\bprojector/i] },
  { category: 'IT', patterns: [/\bdata cab/i, /\bstructured cabling/i, /\bserver/i] },
  { category: 'Building Fabric', patterns: [/\bbuilding fabric/i, /\bdoor hardware/i, /\bglazing/i] },
];

/** Trade category (Security, Fire, IT, …) from product text, part numbers, and Product Database category. */
export function inferTradeCategoryFromTexts(texts: (string | null | undefined)[]): SystemCategory | null {
  const systemName = inferSystemTypeName(texts);
  if (systemName) return categoryForSystemName(systemName);

  const combined = texts.filter(Boolean).join(' ');
  if (!combined.trim()) return null;

  let bestCategory: SystemCategory | null = null;
  let bestScore = 0;
  for (const rule of TRADE_CATEGORY_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(combined)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }
  return bestScore > 0 ? bestCategory : null;
}

export function textsForDeviceSystemInference(device: Pick<Device, 'model_name' | 'device_type' | 'manufacturer' | 'model_number' | 'notes'>): string[] {
  return [
    getDeviceProductDescription(device),
    device.manufacturer,
    device.model_number,
    device.device_type,
    device.model_name,
    extractProductCategoryFromNotes(device.notes),
  ];
}
