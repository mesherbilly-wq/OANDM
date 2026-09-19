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

function quantityOf(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.round(parsed);
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
      const confidence = typeof row.confidence === 'number' ? row.confidence : null;

      return createEquipmentDraft({
        draftId: createDraftId('equip'),
        systemDraftId,
        deviceType,
        manufacturer: nullIfEmpty(row.manufacturer),
        modelNumber: nullIfEmpty(row.model_number),
        modelName,
        quantity: quantityOf(row.quantity),
        location: nullIfEmpty(row.location),
        notes: nullIfEmpty(row.notes),
        category: suggestedSystemType ? categoryForSystemName(suggestedSystemType) : null,
        systemType: suggestedSystemType,
        productCategory: null,
        warrantyYears: null,
        matched: false,
        matchedProductId: null,
        confidence,
        selected: true,
        sourceLineRef: `ai-${index + 1}`,
        metadata: {
          aiSystemType: row.system_type ?? null,
        },
      });
    });

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
