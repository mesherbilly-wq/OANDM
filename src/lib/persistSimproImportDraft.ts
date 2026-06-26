import type { ImportReviewDraft, ImportReviewIssue } from '../integrations';
import type { ImportEquipmentDraft } from '../integrations/models/ImportEquipmentDraft';
import {
  getImportReviewBlockingIssues,
  getImportReviewCreateConfirmationIssues,
  resolvedCategory,
  resolvedEquipmentCategory,
} from '../integrations';

import { clampLineQuantity } from './devicePersistConstants';
import { IMPORT_LINE_NOTE_TAG } from './deviceGrouping';
import { buildPrefixCounters } from './deviceProjectEdits';
import { getDevicePrefix } from './deviceLabel';
import {
  buildPersistSystemNameMap,
  insertProjectSystemsFromSimproDraft,
} from './projectSystemsDb';
import { supabase } from './supabase';

const DEVICE_INSERT_BATCH = 100;
const SOURCE_DOCUMENT = 'Simpro Import';

/** @deprecated Use getImportReviewCreateConfirmationIssues for confirm dialogs. */
export function getSimproImportPersistWarnings(draft: ImportReviewDraft): ImportReviewIssue[] {
  return getImportReviewCreateConfirmationIssues(draft);
}

export function getSimproImportBlockingIssues(draft: ImportReviewDraft): ImportReviewIssue[] {
  return getImportReviewBlockingIssues(draft);
}

function nullIfEmpty(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text || null;
}

/** Tag each expanded row with its Import Review equipment draft id for stable grouped counts. */
function buildPersistDeviceNotes(item: ImportEquipmentDraft): string {
  const lineTag = `${IMPORT_LINE_NOTE_TAG}${item.draftId}]`;
  const userNotes = item.notes?.trim();
  if (userNotes?.includes(lineTag)) return userNotes;
  return userNotes ? `${userNotes} ${lineTag}` : lineTag;
}

export interface SimproPersistQuantityAudit {
  equipmentDraftId: string;
  modelNumber: string | null;
  deviceType: string | null;
  importReviewQuantity: number;
  rowsInserted: number;
  systemName: string;
}

export function buildPersistQuantityAudit(
  draft: ImportReviewDraft,
  deviceRows: Record<string, unknown>[],
  persistSystemNames: Map<string, string>,
): SimproPersistQuantityAudit[] {
  const rowsByDraftId = new Map<string, number>();

  for (const row of deviceRows) {
    const draftId = extractImportLineDraftIdFromNotes(row.notes);
    if (!draftId) continue;
    rowsByDraftId.set(draftId, (rowsByDraftId.get(draftId) ?? 0) + 1);
  }

  const audit: SimproPersistQuantityAudit[] = [];

  for (const system of draft.systems) {
    if (!system.selected) continue;
    for (const item of system.equipment) {
      if (!item.selected) continue;
      audit.push({
        equipmentDraftId: item.draftId,
        modelNumber: item.modelNumber,
        deviceType: item.deviceType,
        importReviewQuantity: clampLineQuantity(item.quantity),
        rowsInserted: rowsByDraftId.get(item.draftId) ?? 0,
        systemName: persistSystemNames.get(system.draftId) ?? system.name,
      });
    }
  }

  return audit;
}

function extractImportLineDraftIdFromNotes(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const start = value.indexOf(IMPORT_LINE_NOTE_TAG);
  if (start < 0) return null;
  const from = start + IMPORT_LINE_NOTE_TAG.length;
  const end = value.indexOf(']', from);
  if (end < 0) return null;
  const draftId = value.slice(from, end).trim();
  return draftId || null;
}

function buildDeviceRows(
  draft: ImportReviewDraft,
  projectId: number,
  prefixCounters: Record<string, number>,
  persistSystemNames: Map<string, string>,
  systemIdByDraftId: Map<string, number>,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const system of draft.systems) {
    if (!system.selected) continue;

    const systemCategory = resolvedCategory(system);
    const systemName =
      persistSystemNames.get(system.draftId) ??
      nullIfEmpty(system.name) ??
      'Unnamed System';
    const projectSystemId = systemIdByDraftId.get(system.draftId) ?? null;

    for (const item of system.equipment) {
      if (!item.selected) continue;

      const category = resolvedEquipmentCategory(system, item);
      const deviceType = nullIfEmpty(item.deviceType ?? item.modelName);
      const prefix = getDevicePrefix(category ?? 'Other', deviceType ?? '');
      const quantity = clampLineQuantity(item.quantity);

      for (let unit = 0; unit < quantity; unit += 1) {
        prefixCounters[prefix] = (prefixCounters[prefix] ?? 0) + 1;
        rows.push({
          project_id: projectId,
          project_system_id: projectSystemId,
          system_type: systemName,
          system_category: systemCategory,
          device_type: deviceType,
          device_name: `${prefix}-${String(prefixCounters[prefix]).padStart(3, '0')}`,
          manufacturer: nullIfEmpty(item.manufacturer),
          model_number: nullIfEmpty(item.modelNumber),
          model_name: nullIfEmpty(item.modelName),
          location: nullIfEmpty(item.location),
          notes: buildPersistDeviceNotes(item),
          matched: item.matched,
          datasheet_found: false,
          status: 'pending_review',
          source_document: SOURCE_DOCUMENT,
        });
      }
    }
  }

  return rows;
}

export async function persistSimproImportReviewDraft(
  draft: ImportReviewDraft,
): Promise<{ projectId: number }> {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      project_name: nullIfEmpty(draft.project.projectName),
      client_name: nullIfEmpty(draft.project.clientName),
      site_name: nullIfEmpty(draft.project.siteName),
      site_address: nullIfEmpty(draft.project.siteAddress),
      job_number: nullIfEmpty(draft.project.jobNumber),
      project_number: nullIfEmpty(draft.project.projectNumber),
      project_manager: nullIfEmpty(draft.project.projectManager),
      project_notes: nullIfEmpty(draft.project.projectNotes),
      project_status: 'active',
    })
    .select()
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? 'Failed to create project.');
  }

  const scopeContent = nullIfEmpty(draft.project.projectSummary);
  if (scopeContent) {
    const { error: scopeError } = await supabase.from('project_documents').insert({
      project_id: project.id,
      document_type: 'scope_of_works',
      title: 'Scope of Works',
      content: scopeContent,
      status: 'draft',
      generated_by: 'manual',
    });
    if (scopeError) {
      throw new Error(`Project created but Scope of Works failed to save: ${scopeError.message}`);
    }
  }

  const { data: existingDevices, error: existingError } = await supabase
    .from('devices')
    .select('device_name')
    .eq('project_id', project.id);

  if (existingError) {
    throw new Error(`Project created but devices could not be prepared: ${existingError.message}`);
  }

  const prefixCounters = buildPrefixCounters(existingDevices ?? []);
  const persistSystemNames = buildPersistSystemNameMap(draft.systems);
  const systemIdByDraftId = await insertProjectSystemsFromSimproDraft(
    draft,
    project.id,
    persistSystemNames,
  );
  const deviceRows = buildDeviceRows(
    draft,
    project.id,
    prefixCounters,
    persistSystemNames,
    systemIdByDraftId,
  );

  const quantityAudit = buildPersistQuantityAudit(draft, deviceRows, persistSystemNames);
  if (import.meta.env.DEV) {
    console.info('[Simpro persist quantity audit]', quantityAudit);
  }

  if (deviceRows.length > 0) {
    for (let offset = 0; offset < deviceRows.length; offset += DEVICE_INSERT_BATCH) {
      const batch = deviceRows.slice(offset, offset + DEVICE_INSERT_BATCH);
      const { error: deviceError } = await supabase.from('devices').insert(batch);
      if (deviceError) {
        throw new Error(`Project created but device import failed: ${deviceError.message}`);
      }
    }
  }

  return { projectId: project.id as number };
}
