import { createDraftId } from '../../core/draftHelpers';
import { createEquipmentDraft } from '../../models/ImportEquipmentDraft';
import { createEmptyProjectDraft } from '../../models/ImportProjectDraft';
import {
  createImportReviewDraft,
  type ImportReviewDraft,
  type ImportReviewIssue,
} from '../../models/ImportReviewDraft';
import { createSystemDraft } from '../../models/ImportSystemDraft';
import { categoryForSystemName, inferSystemTypeName, isKnownInstallSystemName } from '../../../lib/inferSystemType';
import { prepareCustomerScopeHtml } from '../../../lib/scopeOfWorksHtml';
import { looksLikeHtml } from '../simpro/simproImportHelpers';
import type { ConnectorId } from '../../types';

export interface AiExtractedDevice {
  system_type?: string | null;
  device_type?: string | null;
  manufacturer?: string | null;
  model_number?: string | null;
  model_name?: string | null;
  quantity?: number;
  location?: string | null;
  notes?: string | null;
  confidence?: number | null;
  quantity_basis?: string | null;
  evidence_class?: string | null;
  view_kind?: string | null;
  source_file?: string | null;
  source_page?: number | null;
  evidence_text?: string | null;
  conflict?: string | null;
}

export interface AiExtractedProject {
  project_name?: string | null;
  client_name?: string | null;
  site_name?: string | null;
  site_address?: string | null;
  job_number?: string | null;
  quote_number?: string | null;
  project_number?: string | null;
  project_manager?: string | null;
  engineer?: string | null;
  main_contractor?: string | null;
  project_summary?: string | null;
  project_notes?: string | null;
  scope_of_works?: string | null;
  system_types?: string[];
  devices?: AiExtractedDevice[];
  drawing_references?: string[] | null;
  sections?: { kind?: string | null; text?: string | null; source_file?: string | null; source_page?: number | null }[];
  missing?: string[] | null;
  warnings?: string[] | null;
  quantity_summary?: {
    statedTotal: number | null;
    countedTotal: number | null;
    classified?: { label: string; quantity: number }[];
    difference: string | null;
    unresolved: string | null;
  } | null;
}

export interface NormalizeAiExtractOptions {
  connectorId: Extract<ConnectorId, 'ai_documents' | 'ai_drawings'>;
  displayReference?: string | null;
  scopeHtmlFallback?: string | null;
}

function nullIfEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function asHtmlScope(value: string | null): string | null {
  const prepared = prepareCustomerScopeHtml(value);
  return prepared || null;
}

function wrapPlainAsHtml(value: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (looksLikeHtml(text)) return asHtmlScope(text);
  const paragraphs = text
    .split(/\n{2,}/)
    .map(block => `<p>${block.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`)
    .join('');
  return asHtmlScope(paragraphs);
}

function resolveScopeHtml(extracted: AiExtractedProject, fallback: string | null): string | null {
  return (
    asHtmlScope(nullIfEmpty(extracted.scope_of_works))
    ?? asHtmlScope(nullIfEmpty(extracted.project_summary))
    ?? asHtmlScope(fallback)
    ?? wrapPlainAsHtml(nullIfEmpty(extracted.project_summary))
  );
}

function quantityOf(value: unknown): { quantity: number; unstated: boolean } {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return { quantity: 0, unstated: true };
  return { quantity: Math.round(parsed), unstated: false };
}

function systemNameOf(device: AiExtractedDevice): string {
  return nullIfEmpty(device.system_type) || 'Unnamed System';
}

export function normalizeAiExtract(
  raw: unknown,
  options: NormalizeAiExtractOptions,
): ImportReviewDraft {
  const extracted = (raw && typeof raw === 'object' ? raw : {}) as AiExtractedProject;
  const issues: ImportReviewIssue[] = [];
  const devices = Array.isArray(extracted.devices) ? extracted.devices : [];
  const scopeHtml = resolveScopeHtml(extracted, options.scopeHtmlFallback ?? null);

  const project = {
    ...createEmptyProjectDraft(),
    projectName: nullIfEmpty(extracted.project_name),
    clientName: nullIfEmpty(extracted.client_name),
    siteName: nullIfEmpty(extracted.site_name),
    siteAddress: nullIfEmpty(extracted.site_address) ?? nullIfEmpty(extracted.site_name),
    jobNumber: nullIfEmpty(extracted.job_number),
    quoteNumber: nullIfEmpty(extracted.quote_number),
    projectNumber: nullIfEmpty(extracted.project_number),
    projectManager: nullIfEmpty(extracted.project_manager),
    engineer: nullIfEmpty(extracted.engineer),
    mainContractor: nullIfEmpty(extracted.main_contractor),
    projectSummary: scopeHtml,
    projectNotes: nullIfEmpty(extracted.project_notes),
  };

  const grouped = new Map<string, AiExtractedDevice[]>();
  for (const device of devices) {
    const name = systemNameOf(device);
    const list = grouped.get(name) ?? [];
    list.push(device);
    grouped.set(name, list);
  }

  const systems = [...grouped.entries()].map(([name, rows]) => {
    const systemDraftId = createDraftId('system');
    const suggestedSystemType = isKnownInstallSystemName(name)
      ? name
      : inferSystemTypeName([name, ...rows.map(row => row.device_type), ...rows.map(row => row.model_name)]);

    const equipment = rows.map((row, index) => {
      const deviceType = nullIfEmpty(row.device_type) ?? nullIfEmpty(row.model_name);
      const modelName = nullIfEmpty(row.model_name) ?? deviceType;
      const quantity = quantityOf(row.quantity);
      const confidence = typeof row.confidence === 'number' ? row.confidence : null;
      const sourceFile = nullIfEmpty(row.source_file);
      const sourcePage = typeof row.source_page === 'number' ? row.source_page : null;
      const source = [sourceFile, sourcePage ? `p.${sourcePage}` : null].filter(Boolean).join(' ');
      const evidenceNote = [nullIfEmpty(row.quantity_basis), nullIfEmpty(row.evidence_class)].filter(Boolean).join(', ');
      const notes = [nullIfEmpty(row.notes), evidenceNote ? `Evidence: ${evidenceNote}` : null, nullIfEmpty(row.evidence_text)]
        .filter(Boolean)
        .join(' ');

      return createEquipmentDraft({
        draftId: createDraftId('equip'),
        systemDraftId,
        deviceType,
        manufacturer: nullIfEmpty(row.manufacturer),
        modelNumber: nullIfEmpty(row.model_number),
        modelName,
        quantity: quantity.quantity,
        location: nullIfEmpty(row.location),
        notes: notes || null,
        category: suggestedSystemType ? categoryForSystemName(suggestedSystemType) : null,
        systemType: suggestedSystemType,
        productCategory: null,
        warrantyYears: null,
        matched: false,
        matchedProductId: null,
        confidence,
        selected: row.conflict || quantity.unstated ? false : true,
        sourceLineRef: source || `ai-${index + 1}`,
        metadata: {
          aiSystemType: row.system_type ?? null,
          quantityBasis: row.quantity_basis ?? null,
          evidenceClass: row.evidence_class ?? null,
          viewKind: row.view_kind ?? null,
          sourceFile,
          sourcePage,
          evidenceText: nullIfEmpty(row.evidence_text),
          conflict: nullIfEmpty(row.conflict),
          quantityUnstated: quantity.unstated,
        },
      });
    });

    for (const row of rows) {
      const conflict = nullIfEmpty(row.conflict);
      if (!conflict) continue;
      issues.push({
        code: 'ai.conflict',
        message: `${nullIfEmpty(row.device_type) ?? name}: ${conflict}`,
        severity: 'warning',
      });
    }

    if (!suggestedSystemType) {
      issues.push({
        code: 'ai.unresolved_category',
        message: `No CCTV / Access Control / Intruder / Fire type suggested for "${name}" — set one during review.`,
        severity: 'info',
        draftId: systemDraftId,
      });
    }

    return createSystemDraft({
      draftId: systemDraftId,
      name,
      description: null,
      selected: true,
      sourceSectionRef: name,
      sourceLocationName: null,
      sourceCostCentreName: name,
      sourceCostCentreLabel: name,
      category: {
        suggestedCategory: suggestedSystemType ? categoryForSystemName(suggestedSystemType) : null,
        confirmedCategory: null,
        suggestedSystemType,
        confirmedSystemType: null,
        method: suggestedSystemType ? 'keyword_rule' : 'unresolved',
        confidence: suggestedSystemType ? 0.7 : 0,
      },
      equipment,
    });
  });

  if (systems.length === 0) {
    issues.push({
      code: 'ai.no_systems',
      message: 'No equipment systems were found in the uploaded documents.',
      severity: 'warning',
    });
  }

  if (!scopeHtml) {
    issues.push({
      code: 'ai.no_scope',
      message: 'No Scope of Works wording was found. Add it on the Scope of Works page after create if needed.',
      severity: 'info',
    });
  }

  const drawingRefs = (extracted.drawing_references ?? []).map(item => item.trim()).filter(Boolean);
  if (drawingRefs.length > 0) {
    const note = `Drawing references: ${drawingRefs.join(', ')}`;
    project.projectNotes = project.projectNotes ? `${project.projectNotes}\n${note}` : note;
  }

  for (const section of extracted.sections ?? []) {
    const text = nullIfEmpty(section.text);
    const kind = nullIfEmpty(section.kind);
    if (!text || !kind) continue;
    const source = [nullIfEmpty(section.source_file), section.source_page ? `p.${section.source_page}` : null].filter(Boolean).join(' ');
    issues.push({
      code: `ai.section.${kind}`,
      message: source ? `${text}\nSource: ${source}` : text,
      severity: 'info',
    });
  }

  const missing = (extracted.missing ?? []).map(item => item.trim()).filter(Boolean);
  if (missing.length > 0) {
    issues.push({
      code: 'ai.section.missing',
      message: missing.map(item => `- ${item}`).join('\n'),
      severity: 'info',
    });
  }

  const summary = extracted.quantity_summary;
  if (summary && typeof summary === 'object') {
    const lines = [
      summary.statedTotal != null ? `Stated camera total: ${summary.statedTotal}` : 'Stated camera total: not found',
      summary.countedTotal != null ? `Counted drawing total: ${summary.countedTotal}` : 'Counted drawing total: not established',
      summary.classified?.length
        ? `Classified quantities: ${summary.classified.map(item => `${item.label} ${item.quantity}`).join(', ')}`
        : 'Classified quantities: not established',
      summary.difference,
      summary.unresolved,
    ].filter((line): line is string => Boolean(line));
    issues.unshift({
      code: 'ai.quantity',
      message: lines.join('\n'),
      severity: summary.unresolved || (summary.statedTotal != null && summary.countedTotal != null && summary.statedTotal !== summary.countedTotal) ? 'warning' : 'info',
    });
  }

  if (devices.some(device => !nullIfEmpty(device.model_number))) {
    issues.push({
      code: 'ai.product_lookup',
      message: 'No part number is stated, so product lookup did not create or remove devices. Model, resolution and frame rate stay blank until reviewed.',
      severity: 'info',
    });
  }

  for (const warning of extracted.warnings ?? []) {
    const message = warning.trim();
    if (!message || message.startsWith('Part numbers are not stated')) continue;
    issues.push({ code: 'ai.warning', message, severity: 'warning' });
  }

  return createImportReviewDraft({
    reviewId: createDraftId('review'),
    source: {
      connectorId: options.connectorId,
      displayReference: options.displayReference ?? null,
      fetchedAt: new Date().toISOString(),
      externalIds: {},
    },
    project,
    systems,
    issues,
  });
}
