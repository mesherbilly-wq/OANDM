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

let fallbackDefinitionSeq = 1;

function fallbackDefinition(
  document_id: string,
  type_key: string,
  title: string,
  description: string,
  icon_key: string,
  opts: Partial<HandoverDocumentDefinition> = {},
): HandoverDocumentDefinition {
  return {
    id: opts.id ?? fallbackDefinitionSeq++,
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
  fallbackDefinition('cv01_as_fitted', 'cctv', 'CV01 User requirements and as-fitted system record', 'Installed camera and recorder schedule. Engineer verification. Quoted qty is not installed proof.', 'file', { sc_enabled: true, required: true, display_order: 10, sc_template_id: 'cv01_as_fitted' }),
  fallbackDefinition('cv02_cameras', 'cctv', 'CV02 Camera performance and infrastructure readings', 'Image, siting, network and power results. Engineer sign-off only.', 'clipboard', { sc_enabled: true, display_order: 20, sc_template_id: 'cv02_cameras' }),
  fallbackDefinition('cv03_commissioning', 'cctv', 'CV03 Commissioning and system validation', 'Commissioning checks and tests. Engineer sign-off only.', 'clipboard', { sc_enabled: true, display_order: 30, sc_template_id: 'cv03_commissioning' }),
  fallbackDefinition('cv04_recording', 'cctv', 'CV04 Recording, retention and export verification', 'Retention, playback and export tests. Engineer sign-off; customer results on CV08.', 'clipboard', { sc_enabled: true, display_order: 40, sc_template_id: 'cv04_recording' }),
  fallbackDefinition('cv05_monitoring', 'cctv', 'CV05 Remote monitoring and alarm verification', 'Use only for remotely monitored / detector-activated / BS 8418 systems. Engineer sign-off only.', 'clipboard', { sc_enabled: true, display_order: 50, sc_template_id: 'cv05_monitoring' }),
  fallbackDefinition('cv06_changes', 'cctv', 'CV06 Changes and remedial actions', 'Design changes, defects and limitations. Reviewer sign-off. Customer agreement is on CV15 where required.', 'file', { sc_enabled: true, display_order: 60, sc_template_id: 'cv06_changes' }),
  fallbackDefinition('cv07_training', 'cctv', 'CV07 Customer demonstration and training', 'Trainer record of demonstration. Customer acknowledgement is on CV08.', 'graduation', { sc_enabled: true, display_order: 70, sc_template_id: 'cv07_training' }),
  fallbackDefinition('cv08_handover', 'cctv', 'CV08 Customer test sign-off and handover', 'The routine customer signature. Acknowledges demonstration, documents and operating status.', 'award', { sc_enabled: true, required: true, display_order: 80, sc_template_id: 'cv08_handover' }),
  fallbackDefinition('cv09_log', 'cctv', 'CV09 System history and event log', 'Activations, faults and visits. No signature required.', 'file', { sc_enabled: true, display_order: 90, sc_template_id: 'cv09_log' }),
  fallbackDefinition('cv10_support', 'cctv', 'CV10 Maintenance and support information', 'Service contacts and warranty. Issued by the engineer; receipt is on CV08.', 'file', { sc_enabled: true, display_order: 100, sc_template_id: 'cv10_support' }),
  fallbackDefinition('cv11_release', 'cctv', 'CV11 O&M index and technical release', 'Document completeness and company technical release. Reviewer sign-off.', 'clipboard', { sc_enabled: true, display_order: 110, sc_template_id: 'cv11_release' }),
  fallbackDefinition('cv12_takeover', 'cctv', 'CV12 Takeover and provider transfer record', 'Inherited installation survey. Customer signs CV15 only if the takeover is conditional or limited.', 'clipboard', { sc_enabled: true, display_order: 120, sc_template_id: 'cv12_takeover' }),
  fallbackDefinition('cv13_upgrade', 'cctv', 'CV13 Upgrade and extension record', 'Change scope and retesting. Customer signs CV15 only for design changes or limitations.', 'clipboard', { sc_enabled: true, display_order: 130, sc_template_id: 'cv13_upgrade' }),
  fallbackDefinition('cv14_maintenance', 'cctv', 'CV14 Maintenance and corrective work record', 'Visit record. Engineer sign-off only.', 'clipboard', { sc_enabled: true, display_order: 140, sc_template_id: 'cv14_maintenance' }),
  fallbackDefinition('cv15_acceptance', 'cctv', 'CV15 Conditional customer acceptance', 'Extra customer signature only for design changes, reduced coverage or incomplete tests.', 'award', { sc_enabled: true, display_order: 150, sc_template_id: 'cv15_acceptance' }),
  fallbackDefinition('cv16_survey', 'cctv', 'CV16 Site survey, risk review and agreed test plan', 'Planned survey and tests. Engineer and reviewer; do not repeat CV08/CV15 signatures.', 'clipboard', { sc_enabled: true, display_order: 160, sc_template_id: 'cv16_survey' }),
  fallbackDefinition('nsi_certificate_cctv', 'cctv', 'NSI Certificate of Compliance', 'Official issued certificate — attach separately. Not generated by these forms.', 'shield', { upload_only: true, display_order: 170 }),
  fallbackDefinition('handover_ac', 'access_control', 'Access Control Handover Certificate', 'Signed customer acceptance for access control systems', 'lock', { sc_enabled: true, required: true, display_order: 10 }),
  fallbackDefinition('ac_door_schedule', 'access_control', 'Door Schedule', 'Schedule of controlled doors and hardware', 'file', { display_order: 20 }),
  fallbackDefinition('ac_controller_configuration', 'access_control', 'Controller Configuration', 'Access controller configuration record', 'file', { display_order: 30 }),
  fallbackDefinition('ac_reader_test_sheet', 'access_control', 'Reader Test Sheet', 'Reader and door hardware test results', 'clipboard', { sc_enabled: true, display_order: 40 }),
  fallbackDefinition('ac_customer_training', 'access_control', 'Customer Training Record', 'Signed training record for customer staff', 'graduation', { sc_enabled: true, display_order: 50 }),
  fallbackDefinition('ia01_as_fitted', 'intruder_alarm', 'IA01 As-fitted system record and equipment schedule', 'Installed equipment schedule. Engineer verification. Quoted qty is not installed proof.', 'file', { sc_enabled: true, required: true, display_order: 10, sc_template_id: 'ia01_as_fitted' }),
  fallbackDefinition('ia02_readings', 'intruder_alarm', 'IA02 Parameters and electrical readings', 'Device, supply and settings readings. Engineer sign-off only.', 'clipboard', { sc_enabled: true, display_order: 20, sc_template_id: 'ia02_readings' }),
  fallbackDefinition('ia03_commissioning', 'intruder_alarm', 'IA03 Commissioning and verification checks', 'Commissioning checks and tests. Engineer sign-off only.', 'clipboard', { sc_enabled: true, display_order: 30, sc_template_id: 'ia03_commissioning' }),
  fallbackDefinition('ia04_arc', 'intruder_alarm', 'IA04 ARC signalling and response verification', 'End-to-end signalling tests. Engineer sign-off only.', 'clipboard', { sc_enabled: true, display_order: 40, sc_template_id: 'ia04_arc' }),
  fallbackDefinition('ia05_changes', 'intruder_alarm', 'IA05 Changes, defects and remedial actions', 'Design changes, defects and limitations. Customer agreement is on IA15 where required.', 'file', { sc_enabled: true, display_order: 50, sc_template_id: 'ia05_changes' }),
  fallbackDefinition('ia06_training', 'intruder_alarm', 'IA06 Customer demonstration and training', 'Trainer record of demonstration. Customer acknowledgement is on IA07.', 'graduation', { sc_enabled: true, display_order: 60, sc_template_id: 'ia06_training' }),
  fallbackDefinition('ia07_handover', 'intruder_alarm', 'IA07 Completion and handover acceptance', 'The routine customer signature. Acknowledges demonstration, documents and operating status.', 'award', { sc_enabled: true, required: true, display_order: 70, sc_template_id: 'ia07_handover' }),
  fallbackDefinition('ia08_log', 'intruder_alarm', 'IA08 System history and event log', 'Activations, faults and visits. No signature required.', 'file', { sc_enabled: true, display_order: 80, sc_template_id: 'ia08_log' }),
  fallbackDefinition('ia09_support', 'intruder_alarm', 'IA09 Maintenance and support information', 'Service contacts and warranty. Issued by the engineer; receipt is on IA07.', 'file', { sc_enabled: true, display_order: 90, sc_template_id: 'ia09_support' }),
  fallbackDefinition('ia10_release', 'intruder_alarm', 'IA10 O&M document index and technical release', 'Document completeness and company technical release. Reviewer sign-off.', 'clipboard', { sc_enabled: true, display_order: 100, sc_template_id: 'ia10_release' }),
  fallbackDefinition('ia11_takeover', 'intruder_alarm', 'IA11 Takeover survey and condition record', 'Inherited installation survey. Customer signs only if the takeover is conditional or limited.', 'clipboard', { sc_enabled: true, display_order: 110, sc_template_id: 'ia11_takeover' }),
  fallbackDefinition('ia12_upgrade', 'intruder_alarm', 'IA12 Upgrade and extension record', 'Change scope and retesting. Customer signs only for design changes or limitations.', 'clipboard', { sc_enabled: true, display_order: 120, sc_template_id: 'ia12_upgrade' }),
  fallbackDefinition('ia13_transfer', 'intruder_alarm', 'IA13 Maintenance and monitoring transfer', 'Provider transfer. Customer signs only if there is an interruption or limitation.', 'file', { sc_enabled: true, display_order: 130, sc_template_id: 'ia13_transfer' }),
  fallbackDefinition('ia14_maintenance', 'intruder_alarm', 'IA14 Maintenance and corrective work record', 'Visit record. Engineer sign-off only.', 'clipboard', { sc_enabled: true, display_order: 140, sc_template_id: 'ia14_maintenance' }),
  fallbackDefinition('ia15_acceptance', 'intruder_alarm', 'IA15 Conditional customer acceptance', 'Extra customer signature only for design changes, disconnections or incomplete tests.', 'award', { sc_enabled: true, display_order: 150, sc_template_id: 'ia15_acceptance' }),
  fallbackDefinition('nsi_certificate_intruder', 'intruder_alarm', 'NSI Certificate of Compliance', 'Official issued certificate — attach separately. Not generated by these forms.', 'shield', { upload_only: true, display_order: 160 }),
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
    .order('type_key')
    .order('display_order');

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
      .order('type_key')
      .order('display_order');

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

/** Include saved legacy docs even if definition was deactivated. Do not pull in documents from another type. */
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
      if (def.type_key !== typeKey) continue;
      visible.push(def);
      visibleIds.add(documentId);
    } else {
      const knownFallback = FALLBACK_DOCUMENT_DEFINITIONS.find(row => row.document_id === documentId);
      if (knownFallback && knownFallback.type_key !== typeKey) continue;
      visible.push(fallbackDefinition(documentId, typeKey, titleForLegacyDocumentId(documentId), 'Saved handover document', 'file', { is_active: true }));
      visibleIds.add(documentId);
    }
  }

  return visible.sort((a, b) => a.display_order - b.display_order || a.title.localeCompare(b.title));
}

export function slugifyHandoverDocumentId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'document';
}

export function uniqueHandoverDocumentId(typeKey: string, title: string, existingIds: string[]): string {
  const base = `${typeKey}_${slugifyHandoverDocumentId(title)}`;
  const used = new Set(existingIds);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
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
    if (/duplicate|unique/i.test(error.message)) {
      return 'That Document ID already exists. Change it and save again.';
    }
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
    if (store.definitions.some(existing => existing.document_id === row.document_id)) {
      return 'That Document ID already exists. Change it and save again.';
    }
    store.definitions.push(row);
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
