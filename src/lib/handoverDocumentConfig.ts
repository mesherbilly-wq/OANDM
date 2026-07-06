import type { LucideIcon } from 'lucide-react';
import {
  Award,
  Camera,
  Car,
  ClipboardCheck,
  FileText,
  GraduationCap,
  HardHat,
  Lock,
  Network,
  Phone,
  Shield,
  ShieldAlert,
} from 'lucide-react';

import type { SystemCategory } from '../types';
import { supabase } from './supabase';

export const PROJECT_WIDE_DOCUMENT_TYPE_KEY = 'project_wide';

export const DEFAULT_SC_FIELD_MAPPINGS: Record<string, string> = {
  job_number: '',
  project_name: '',
  client_name: '',
  site_name: '',
  site_address: '',
  project_manager: '',
  inspection_title: '',
};

export interface HandoverDocumentType {
  id: number;
  key: string;
  label: string;
  display_order: number;
  is_active: boolean;
}

export interface HandoverDocumentDefinition {
  id: number;
  document_id: string;
  type_key: string;
  title: string;
  description: string | null;
  icon_key: string;
  sc_enabled: boolean;
  sc_template_id: string | null;
  field_mappings: Record<string, string>;
  required: boolean;
  upload_only: boolean;
  multi: boolean;
  display_order: number;
  is_active: boolean;
}

export const HANDOVER_ICON_MAP: Record<string, LucideIcon> = {
  camera: Camera,
  lock: Lock,
  shield_alert: ShieldAlert,
  clipboard: ClipboardCheck,
  car: Car,
  phone: Phone,
  network: Network,
  graduation: GraduationCap,
  award: Award,
  shield: Shield,
  hardhat: HardHat,
  file: FileText,
};

export function handoverDocumentIcon(iconKey: string): LucideIcon {
  return HANDOVER_ICON_MAP[iconKey] ?? FileText;
}

/** Embedded defaults when config tables are unavailable (pre-migration). */
export const FALLBACK_DOCUMENT_TYPES: HandoverDocumentType[] = [
  { id: 1, key: 'cctv', label: 'CCTV', display_order: 10, is_active: true },
  { id: 2, key: 'access_control', label: 'Access Control', display_order: 20, is_active: true },
  { id: 3, key: 'intruder_alarm', label: 'Intruder Alarm', display_order: 30, is_active: true },
  { id: 4, key: 'fire_alarm', label: 'Fire Alarm', display_order: 40, is_active: true },
  { id: 5, key: 'intercom', label: 'Intercom', display_order: 50, is_active: true },
  { id: 6, key: 'anpr', label: 'ANPR', display_order: 60, is_active: true },
  { id: 7, key: 'networking', label: 'Networking', display_order: 70, is_active: true },
  { id: 8, key: 'other', label: 'Other', display_order: 80, is_active: true },
  { id: 9, key: PROJECT_WIDE_DOCUMENT_TYPE_KEY, label: 'Project-wide', display_order: 90, is_active: true },
];

function fallbackDefinition(
  document_id: string,
  type_key: string,
  title: string,
  description: string,
  icon_key: string,
  opts: Partial<HandoverDocumentDefinition> = {},
): HandoverDocumentDefinition {
  return {
    id: 0,
    document_id,
    type_key,
    title,
    description,
    icon_key,
    sc_enabled: opts.sc_enabled ?? false,
    sc_template_id: opts.sc_template_id ?? null,
    field_mappings: opts.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
    required: opts.required ?? false,
    upload_only: opts.upload_only ?? false,
    multi: opts.multi ?? false,
    display_order: opts.display_order ?? 0,
    is_active: opts.is_active ?? true,
  };
}

export const FALLBACK_DOCUMENT_DEFINITIONS: HandoverDocumentDefinition[] = [
  fallbackDefinition('handover_cctv', 'cctv', 'CCTV Handover Certificate', 'Signed customer acceptance for CCTV systems', 'camera', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('cctv_commissioning_sheet', 'cctv', 'CCTV Commissioning Sheet', 'Commissioning checks and test results for CCTV', 'clipboard', { sc_enabled: true, display_order: 20 }),
  fallbackDefinition('camera_schedule', 'cctv', 'Camera Schedule', 'Schedule of installed cameras and locations', 'file', { display_order: 30 }),
  fallbackDefinition('nvr_dvr_configuration', 'cctv', 'NVR/DVR Configuration', 'Recorder configuration and settings record', 'file', { display_order: 40 }),
  fallbackDefinition('cctv_customer_training', 'cctv', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 50 }),
  fallbackDefinition('handover_ac', 'access_control', 'Access Control Handover Certificate', 'Signed customer acceptance for access control systems', 'lock', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('ac_door_schedule', 'access_control', 'Door Schedule', 'Schedule of controlled doors and hardware', 'file', { display_order: 20 }),
  fallbackDefinition('ac_controller_configuration', 'access_control', 'Controller Configuration', 'Access controller configuration record', 'file', { display_order: 30 }),
  fallbackDefinition('ac_reader_test_sheet', 'access_control', 'Reader Test Sheet', 'Reader and door hardware test results', 'clipboard', { sc_enabled: true, display_order: 40 }),
  fallbackDefinition('ac_customer_training', 'access_control', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 50 }),
  fallbackDefinition('handover_intruder', 'intruder_alarm', 'Intruder Alarm Completion Certificate', 'Intruder alarm completion and commissioning certificate', 'shield_alert', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('handover_intruder_record', 'intruder_alarm', 'Intruder Record of System Checks', 'Engineer record of intruder system checks', 'clipboard', { sc_enabled: true, display_order: 20 }),
  fallbackDefinition('intruder_zone_list', 'intruder_alarm', 'Zone List', 'Configured alarm zones and descriptions', 'file', { display_order: 30 }),
  fallbackDefinition('intruder_bell_strobe_test', 'intruder_alarm', 'Bell/Strobe Test', 'Audible and visual alarm device test record', 'clipboard', { display_order: 40 }),
  fallbackDefinition('intruder_keyholder_confirmation', 'intruder_alarm', 'Keyholder Confirmation', 'Confirmed keyholder details and response plan', 'file', { display_order: 50 }),
  fallbackDefinition('intruder_customer_training', 'intruder_alarm', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 60 }),
  fallbackDefinition('fire_commissioning_certificate', 'fire_alarm', 'Fire Alarm Commissioning Certificate', 'Fire alarm commissioning and acceptance certificate', 'shield', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('fire_cause_effect', 'fire_alarm', 'Cause & Effect', 'Fire system cause and effect matrix', 'file', { display_order: 20 }),
  fallbackDefinition('fire_zone_chart', 'fire_alarm', 'Zone Chart', 'Fire alarm zone layout and chart', 'file', { display_order: 30 }),
  fallbackDefinition('fire_detector_test_record', 'fire_alarm', 'Detector Test Record', 'Detector walk-test and functional test record', 'clipboard', { sc_enabled: true, display_order: 40 }),
  fallbackDefinition('fire_customer_training', 'fire_alarm', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 50 }),
  fallbackDefinition('handover_intercom', 'intercom', 'Intercom Handover Certificate', 'Signed customer acceptance for intercom systems', 'phone', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('intercom_customer_training', 'intercom', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 20 }),
  fallbackDefinition('handover_anpr', 'anpr', 'ANPR Handover Certificate', 'Signed customer acceptance for ANPR systems', 'car', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('anpr_customer_training', 'anpr', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 20 }),
  fallbackDefinition('handover_networking', 'networking', 'Networking Handover Certificate', 'Signed customer acceptance for networking infrastructure', 'network', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('networking_customer_training', 'networking', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 20 }),
  fallbackDefinition('other_handover_certificate', 'other', 'System Handover Certificate', 'Signed customer acceptance certificate', 'award', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('other_customer_training', 'other', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 20 }),
  fallbackDefinition('handover_acceptance', PROJECT_WIDE_DOCUMENT_TYPE_KEY, 'System Acceptance Certificate', 'Overall project acceptance signed by customer', 'award', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('handover_training', PROJECT_WIDE_DOCUMENT_TYPE_KEY, 'Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 20 }),
  fallbackDefinition('nsi_certificate', PROJECT_WIDE_DOCUMENT_TYPE_KEY, 'NSI Certificate', 'NSI or certification body approval certificate', 'shield', { upload_only: true, display_order: 30 }),
  fallbackDefinition('rams', PROJECT_WIDE_DOCUMENT_TYPE_KEY, 'RAMS', 'Risk Assessment and Method Statements', 'hardhat', { upload_only: true, multi: true, display_order: 40 }),
];

export async function fetchHandoverDocumentTypes(): Promise<HandoverDocumentType[]> {
  const { data, error } = await supabase
    .from('handover_document_types')
    .select('*')
    .order('display_order')
    .order('label');

  if (error) {
    if (isMissingSchemaError(error.message)) {
      markHandoverConfigLocalOnly();
      return readLocalHandoverConfig().types;
    }
    return FALLBACK_DOCUMENT_TYPES;
  }
  if (!data?.length) return FALLBACK_DOCUMENT_TYPES;
  return data as HandoverDocumentType[];
}

export async function fetchHandoverDocumentDefinitions(): Promise<HandoverDocumentDefinition[]> {
  const { data, error } = await supabase
    .from('handover_document_definitions')
    .select('*')
    .order('display_order')
    .order('title');

  if (error) {
    if (isMissingSchemaError(error.message)) {
      markHandoverConfigLocalOnly();
      return readLocalHandoverConfig().definitions.map(row => ({
        ...row,
        field_mappings: row.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
      }));
    }
    return FALLBACK_DOCUMENT_DEFINITIONS;
  }
  if (!data?.length) return FALLBACK_DOCUMENT_DEFINITIONS;

  const definitions = (data as HandoverDocumentDefinition[]).map(row => ({
    ...row,
    field_mappings: row.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
  }));

  if (await syncLocalHandoverConfigToDatabase(definitions)) {
    const { data: refreshed, error: refreshError } = await supabase
      .from('handover_document_definitions')
      .select('*')
      .order('display_order')
      .order('title');

    if (!refreshError && refreshed?.length) {
      return (refreshed as HandoverDocumentDefinition[]).map(row => ({
        ...row,
        field_mappings: row.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
      }));
    }
  }

  return definitions;
}

export function definitionsForType(
  definitions: HandoverDocumentDefinition[],
  typeKey: string,
): HandoverDocumentDefinition[] {
  return definitions
    .filter(def => def.type_key === typeKey && def.is_active)
    .sort((a, b) => a.display_order - b.display_order || a.title.localeCompare(b.title));
}

/** Include saved legacy docs even if definition was deactivated or type changed. */
export function visibleHandoverDefinitions(
  definitions: HandoverDocumentDefinition[],
  typeKey: string,
  existingDocumentIds: string[],
): HandoverDocumentDefinition[] {
  const byId = new Map(definitions.map(def => [def.document_id, def]));
  const visible = definitionsForType(definitions, typeKey);
  const visibleIds = new Set(visible.map(def => def.document_id));

  for (const documentId of existingDocumentIds) {
    if (visibleIds.has(documentId)) continue;
    const def = byId.get(documentId);
    if (def) {
      visible.push(def);
      visibleIds.add(documentId);
    } else {
      visible.push(fallbackDefinition(documentId, typeKey, titleForLegacyDocumentId(documentId), 'Saved handover document', 'file', { is_active: true }));
      visibleIds.add(documentId);
    }
  }

  return visible.sort((a, b) => a.display_order - b.display_order || a.title.localeCompare(b.title));
}

export function titleForLegacyDocumentId(documentId: string): string {
  const known = FALLBACK_DOCUMENT_DEFINITIONS.find(def => def.document_id === documentId);
  if (known) return known.title;
  return documentId.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export function inferHandoverDocumentTypeKey(
  systemName: string,
  category: SystemCategory | null,
): string {
  const name = systemName.toLowerCase();

  if (category === 'Fire' || /\bfire\b/.test(name)) return 'fire_alarm';
  if (/\bcctv\b|camera|video/.test(name)) return 'cctv';
  if (/access.?control|\bac\b|door/.test(name)) return 'access_control';
  if (/intruder|alarm/.test(name)) return 'intruder_alarm';
  if (/intercom/.test(name)) return 'intercom';
  if (/\banpr\b|lpr|plate/.test(name)) return 'anpr';
  if (/network|switch|wifi|it\b/.test(name)) return 'networking';
  if (category === 'IT') return 'networking';
  if (category === 'Audio Visual') return 'intercom';

  return 'other';
}

const HANDOVER_TYPE_STORAGE_PREFIX = 'oandm.handover.typeSelections.v1';

interface HandoverTypeSelections {
  projectWide: string | null;
  bySystemId: Record<string, string>;
}

function handoverTypeStorageKey(projectId: number): string {
  return `${HANDOVER_TYPE_STORAGE_PREFIX}.${projectId}`;
}

function readHandoverTypeSelections(projectId: number): HandoverTypeSelections {
  const raw = localStorage.getItem(handoverTypeStorageKey(projectId));
  if (!raw) return { projectWide: null, bySystemId: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<HandoverTypeSelections>;
    return {
      projectWide: parsed.projectWide ?? null,
      bySystemId: parsed.bySystemId ?? {},
    };
  } catch {
    return { projectWide: null, bySystemId: {} };
  }
}

function writeHandoverTypeSelectionLocal(
  projectId: number,
  projectSystemId: number | null,
  typeKey: string,
): void {
  const current = readHandoverTypeSelections(projectId);
  if (projectSystemId == null) {
    current.projectWide = typeKey;
  } else {
    current.bySystemId[String(projectSystemId)] = typeKey;
  }
  localStorage.setItem(handoverTypeStorageKey(projectId), JSON.stringify(current));
}

export function getLocalHandoverDocumentTypeKey(
  projectId: number,
  projectSystemId: number | null,
): string | null {
  const selections = readHandoverTypeSelections(projectId);
  if (projectSystemId == null) return selections.projectWide;
  return selections.bySystemId[String(projectSystemId)] ?? null;
}

function isMissingSchemaError(message: string): boolean {
  return /schema cache|could not find the (table|column)|does not exist/i.test(message);
}

const HANDOVER_CONFIG_STORAGE_KEY = 'oandm.handover.config.v1';

interface HandoverConfigLocalStore {
  types: HandoverDocumentType[];
  definitions: HandoverDocumentDefinition[];
  nextTypeId: number;
  nextDefId: number;
}

let handoverConfigUsesLocalStorage = false;

/** True when handover config tables are missing and changes are stored in this browser only. */
export function isHandoverConfigLocalOnly(): boolean {
  return handoverConfigUsesLocalStorage;
}

function readLocalHandoverConfig(): HandoverConfigLocalStore {
  const raw = localStorage.getItem(HANDOVER_CONFIG_STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as HandoverConfigLocalStore;
    } catch {
      /* re-seed below */
    }
  }

  const store: HandoverConfigLocalStore = {
    types: FALLBACK_DOCUMENT_TYPES.map((type, index) => ({ ...type, id: index + 1 })),
    definitions: FALLBACK_DOCUMENT_DEFINITIONS.map((def, index) => ({ ...def, id: index + 1 })),
    nextTypeId: FALLBACK_DOCUMENT_TYPES.length + 1,
    nextDefId: FALLBACK_DOCUMENT_DEFINITIONS.length + 1,
  };
  localStorage.setItem(HANDOVER_CONFIG_STORAGE_KEY, JSON.stringify(store));
  return store;
}

function writeLocalHandoverConfig(store: HandoverConfigLocalStore): void {
  localStorage.setItem(HANDOVER_CONFIG_STORAGE_KEY, JSON.stringify(store));
}

function markHandoverConfigLocalOnly(): void {
  handoverConfigUsesLocalStorage = true;
}

function hasLocalHandoverConfigStore(): boolean {
  return Boolean(localStorage.getItem(HANDOVER_CONFIG_STORAGE_KEY));
}

function definitionsDiffer(
  local: HandoverDocumentDefinition,
  db: HandoverDocumentDefinition,
): boolean {
  return (
    local.sc_template_id !== db.sc_template_id
    || JSON.stringify(local.field_mappings ?? {}) !== JSON.stringify(db.field_mappings ?? {})
    || local.title !== db.title
    || (local.description ?? null) !== (db.description ?? null)
    || local.sc_enabled !== db.sc_enabled
    || local.required !== db.required
    || local.upload_only !== db.upload_only
    || local.multi !== db.multi
    || local.display_order !== db.display_order
    || local.is_active !== db.is_active
    || local.icon_key !== db.icon_key
  );
}

/** Push browser-only handover config into Supabase after migration 024 is applied. */
async function syncLocalHandoverConfigToDatabase(
  dbDefinitions: HandoverDocumentDefinition[],
): Promise<boolean> {
  if (!hasLocalHandoverConfigStore()) return false;

  const store = readLocalHandoverConfig();
  const dbByDocId = new Map(dbDefinitions.map(def => [def.document_id, def]));
  let changed = false;

  for (const local of store.definitions) {
    const db = dbByDocId.get(local.document_id);
    const payload = db
      ? { ...db, ...local, id: db.id }
      : {
          document_id: local.document_id,
          type_key: local.type_key,
          title: local.title,
          description: local.description,
          icon_key: local.icon_key,
          sc_enabled: local.sc_enabled,
          sc_template_id: local.sc_template_id,
          field_mappings: local.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
          required: local.required,
          upload_only: local.upload_only,
          multi: local.multi,
          display_order: local.display_order,
          is_active: local.is_active,
        };

    if (db && !definitionsDiffer(local, db)) continue;

    const { error } = db
      ? await supabase.from('handover_document_definitions').update({
          title: payload.title.trim(),
          description: payload.description?.trim() || null,
          icon_key: payload.icon_key || 'file',
          sc_enabled: payload.sc_enabled,
          sc_template_id: payload.sc_template_id?.trim() || null,
          field_mappings: payload.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
          required: payload.required,
          upload_only: payload.upload_only,
          multi: payload.multi,
          display_order: payload.display_order,
          is_active: payload.is_active,
          updated_at: new Date().toISOString(),
        }).eq('id', db.id)
      : await supabase.from('handover_document_definitions').insert({
          document_id: payload.document_id.trim(),
          type_key: payload.type_key,
          title: payload.title.trim(),
          description: payload.description?.trim() || null,
          icon_key: payload.icon_key || 'file',
          sc_enabled: payload.sc_enabled,
          sc_template_id: payload.sc_template_id?.trim() || null,
          field_mappings: payload.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
          required: payload.required,
          upload_only: payload.upload_only,
          multi: payload.multi,
          display_order: payload.display_order,
          is_active: payload.is_active,
        });

    if (!error) changed = true;
  }

  if (changed) {
    localStorage.removeItem(HANDOVER_CONFIG_STORAGE_KEY);
    handoverConfigUsesLocalStorage = false;
  }

  return changed;
}

export async function saveProjectSystemHandoverType(
  projectId: number,
  projectSystemId: number,
  typeKey: string,
): Promise<string | null> {
  const { error } = await supabase
    .from('project_systems')
    .update({
      handover_document_type_key: typeKey,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectSystemId);

  if (!error) return null;
  if (isMissingSchemaError(error.message)) {
    writeHandoverTypeSelectionLocal(projectId, projectSystemId, typeKey);
    return null;
  }
  return error.message;
}

export async function saveProjectWideHandoverType(
  projectId: number,
  typeKey: string,
): Promise<string | null> {
  const { error } = await supabase
    .from('projects')
    .update({ handover_project_wide_type_key: typeKey })
    .eq('id', projectId);

  if (!error) return null;
  if (isMissingSchemaError(error.message)) {
    writeHandoverTypeSelectionLocal(projectId, null, typeKey);
    return null;
  }
  return error.message;
}

/** Merge DB + localStorage type selections onto loaded project systems. */
export function applyHandoverTypeSelectionsToSystems(
  projectId: number,
  systems: Array<{ id?: number; handoverDocumentTypeKey?: string | null }>,
): void {
  const selections = readHandoverTypeSelections(projectId);
  for (const system of systems) {
    if (system.id == null || system.handoverDocumentTypeKey) continue;
    const local = selections.bySystemId[String(system.id)];
    if (local) system.handoverDocumentTypeKey = local;
  }
}

export function resolveProjectWideHandoverTypeKey(
  projectId: number,
  dbValue: string | null | undefined,
): string {
  return dbValue ?? getLocalHandoverDocumentTypeKey(projectId, null) ?? PROJECT_WIDE_DOCUMENT_TYPE_KEY;
}

export function mergeScFieldMappings(
  templateMappings: Record<string, string> | null | undefined,
  definitionMappings: Record<string, string> | null | undefined,
): Record<string, string> {
  return {
    ...DEFAULT_SC_FIELD_MAPPINGS,
    ...(templateMappings ?? {}),
    ...(definitionMappings ?? {}),
  };
}

export async function upsertHandoverDocumentType(
  type: Pick<HandoverDocumentType, 'key' | 'label' | 'display_order' | 'is_active'> & { id?: number },
): Promise<string | null> {
  const payload = {
    key: type.key.trim(),
    label: type.label.trim(),
    display_order: type.display_order,
    is_active: type.is_active,
    updated_at: new Date().toISOString(),
  };

  if (type.id) {
    const { error } = await supabase.from('handover_document_types').update(payload).eq('id', type.id);
    if (!error) return null;
    if (!isMissingSchemaError(error.message)) return error.message;
  } else {
    const { error } = await supabase.from('handover_document_types').insert(payload);
    if (!error) return null;
    if (!isMissingSchemaError(error.message)) return error.message;
  }

  markHandoverConfigLocalOnly();
  const store = readLocalHandoverConfig();
  if (type.id) {
    const index = store.types.findIndex(row => row.id === type.id);
    if (index >= 0) {
      store.types[index] = { ...store.types[index], ...payload };
    }
  } else {
    store.types.push({
      id: store.nextTypeId++,
      key: payload.key,
      label: payload.label,
      display_order: payload.display_order,
      is_active: payload.is_active,
    });
  }
  writeLocalHandoverConfig(store);
  return null;
}

export async function upsertHandoverDocumentDefinition(
  def: Omit<HandoverDocumentDefinition, 'id' | 'created_at' | 'updated_at'> & { id?: number },
): Promise<string | null> {
  const payload = {
    document_id: def.document_id.trim(),
    type_key: def.type_key,
    title: def.title.trim(),
    description: def.description?.trim() || null,
    icon_key: def.icon_key || 'file',
    sc_enabled: def.sc_enabled,
    sc_template_id: def.sc_template_id?.trim() || null,
    field_mappings: def.field_mappings ?? { ...DEFAULT_SC_FIELD_MAPPINGS },
    required: def.required,
    upload_only: def.upload_only,
    multi: def.multi,
    display_order: def.display_order,
    is_active: def.is_active,
    updated_at: new Date().toISOString(),
  };

  if (def.id) {
    const { error } = await supabase.from('handover_document_definitions').update(payload).eq('id', def.id);
    if (!error) return null;
    if (!isMissingSchemaError(error.message)) return error.message;
  } else {
    const { error } = await supabase.from('handover_document_definitions').insert(payload);
    if (!error) return null;
    if (!isMissingSchemaError(error.message)) return error.message;
  }

  markHandoverConfigLocalOnly();
  const store = readLocalHandoverConfig();
  const row: HandoverDocumentDefinition = {
    id: def.id ?? store.nextDefId++,
    document_id: payload.document_id,
    type_key: payload.type_key,
    title: payload.title,
    description: payload.description,
    icon_key: payload.icon_key,
    sc_enabled: payload.sc_enabled,
    sc_template_id: payload.sc_template_id,
    field_mappings: payload.field_mappings,
    required: payload.required,
    upload_only: payload.upload_only,
    multi: payload.multi,
    display_order: payload.display_order,
    is_active: payload.is_active,
  };

  if (def.id) {
    const index = store.definitions.findIndex(existing => existing.id === def.id);
    if (index >= 0) store.definitions[index] = row;
    else store.definitions.push(row);
  } else {
    const existingIndex = store.definitions.findIndex(existing => existing.document_id === row.document_id);
    if (existingIndex >= 0) {
      store.definitions[existingIndex] = { ...row, id: store.definitions[existingIndex].id };
    } else {
      store.definitions.push(row);
    }
  }

  writeLocalHandoverConfig(store);
  return null;
}

export async function deleteHandoverDocumentDefinition(id: number): Promise<string | null> {
  const { error } = await supabase.from('handover_document_definitions').delete().eq('id', id);
  if (!error) return null;
  if (!isMissingSchemaError(error.message)) return error.message;

  markHandoverConfigLocalOnly();
  const store = readLocalHandoverConfig();
  store.definitions = store.definitions.filter(def => def.id !== id);
  writeLocalHandoverConfig(store);
  return null;
}
