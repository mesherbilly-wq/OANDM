import { completionDocUiStatus, type CompletionFormSummary } from './completionFormTypes';
import {
  documentMatchesSystem,
  isProjectWideDocument,
  PROJECT_WIDE_SYSTEM_LABEL,
} from './documentProjectSystems';
import {
  applyHandoverTypeSelectionsToSystems,
  FALLBACK_DOCUMENT_DEFINITIONS,
  handoverCaptureMethod,
  inferHandoverDocumentTypeKey,
  resolveProjectWideHandoverTypeKey,
  visibleHandoverDefinitions,
  type HandoverDocumentDefinition,
} from './handoverDocumentConfig';
import type { ProjectSystem } from './systems';

const DONE_STATUSES = new Set(['completed', 'imported', 'uploaded']);

export type CompulsoryDocumentGap = {
  systemLabel: string;
  title: string;
  documentId: string;
};

type PlacedRecord = {
  system_type?: string | null;
  project_system_id?: number | null;
};

type HandoverRecord = PlacedRecord & {
  document_type: string;
  status?: string | null;
  file_url?: string | null;
};

type UploadRecord = PlacedRecord & {
  section: string;
};

type SystemSlot = {
  label: string;
  system: Pick<ProjectSystem, 'id' | 'name'> | null;
};

function matchesSlot(record: PlacedRecord, slot: SystemSlot): boolean {
  if (!slot.system) return isProjectWideDocument(record);
  return documentMatchesSystem(record, slot.system);
}

function handoverRecordDone(record: HandoverRecord, documentId: string, slot: SystemSlot): boolean {
  if (record.document_type !== documentId || !matchesSlot(record, slot)) return false;
  return DONE_STATUSES.has(String(record.status ?? '').toLowerCase()) || Boolean(record.file_url);
}

function uploadDone(uploads: UploadRecord[], documentId: string, slot: SystemSlot): boolean {
  return uploads.some(upload => upload.section === documentId && matchesSlot(upload, slot));
}

function formFilled(forms: CompletionFormSummary[], templateKey: string | null | undefined): boolean {
  const key = templateKey?.trim();
  if (!key) return false;
  return forms.some(form =>
    form.template_key === key
    && form.status !== 'revoked'
    && form.status !== 'superseded'
    && completionDocUiStatus(form.status, form) === 'completed',
  );
}

function documentSatisfied(
  definition: HandoverDocumentDefinition,
  slot: SystemSlot,
  handoverDocs: HandoverRecord[],
  uploads: UploadRecord[],
  forms: CompletionFormSummary[],
): boolean {
  const uploaded = uploadDone(uploads, definition.document_id, slot)
    || handoverDocs.some(record => handoverRecordDone(record, definition.document_id, slot));
  if (handoverCaptureMethod(definition) === 'web_form') {
    return formFilled(forms, definition.web_form_template_key) || uploaded;
  }
  return uploaded;
}

/** Required handover documents for each installed system, plus project-wide, that are not uploaded or filled in. */
export function missingCompulsoryHandoverDocuments(input: {
  projectId: number;
  projectWideTypeKey?: string | null;
  systems: ProjectSystem[];
  definitions: HandoverDocumentDefinition[];
  handoverDocs: HandoverRecord[];
  uploads: UploadRecord[];
  completionForms: CompletionFormSummary[];
}): CompulsoryDocumentGap[] {
  const definitions = input.definitions.length > 0 ? input.definitions : FALLBACK_DOCUMENT_DEFINITIONS;
  const systems = input.systems.map(system => ({ ...system }));
  applyHandoverTypeSelectionsToSystems(input.projectId, systems);

  const slots: Array<SystemSlot & { typeKey: string }> = [
    ...systems.map(system => ({
      label: system.name,
      system,
      typeKey: system.handoverDocumentTypeKey?.trim()
        || inferHandoverDocumentTypeKey(system.name, system.category),
    })),
    {
      label: PROJECT_WIDE_SYSTEM_LABEL,
      system: null,
      typeKey: resolveProjectWideHandoverTypeKey(input.projectId, input.projectWideTypeKey),
    },
  ];

  const gaps: CompulsoryDocumentGap[] = [];
  const seen = new Set<string>();

  for (const slot of slots) {
    const existingIds = [
      ...input.handoverDocs.filter(record => matchesSlot(record, slot)).map(record => record.document_type),
      ...input.uploads.filter(record => matchesSlot(record, slot)).map(record => record.section),
    ];
    const required = visibleHandoverDefinitions(definitions, slot.typeKey, existingIds).filter(definition => definition.required);
    for (const definition of required) {
      if (documentSatisfied(definition, slot, input.handoverDocs, input.uploads, input.completionForms)) continue;
      const key = `${slot.label}::${definition.document_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      gaps.push({ systemLabel: slot.label, title: definition.title, documentId: definition.document_id });
    }
  }

  return gaps;
}
