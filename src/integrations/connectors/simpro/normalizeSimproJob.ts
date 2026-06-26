import { createDraftId } from '../../core/draftHelpers';
import { createEquipmentDraft } from '../../models/ImportEquipmentDraft';
import { createEmptyProjectDraft } from '../../models/ImportProjectDraft';
import {
  createImportReviewDraft,
  type ImportReviewDraft,
  type ImportReviewIssue,
} from '../../models/ImportReviewDraft';
import { createSystemDraft } from '../../models/ImportSystemDraft';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function pickString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function pickNestedName(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return pickString(value);
  return (
    pickString(record.Name) ??
    pickString(record.name) ??
    pickString(record.CompanyName) ??
    pickString(record.company_name)
  );
}

function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

function htmlToPlainText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = doc.body.textContent ?? '';
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

function pickScopeText(record: Record<string, unknown>): string | null {
  for (const key of ['Description', 'Notes', 'ScopeOfWorks', 'Scope']) {
    const value = record[key];
    if (value == null) continue;
    const raw = String(value);
    return looksLikeHtml(raw) ? htmlToPlainText(raw) : raw.trim();
  }
  return null;
}

function pickJobNumber(record: Record<string, unknown>): string | null {
  for (const key of ['JobNo', 'OrderNo', 'RequestNo', 'Reference', 'Name']) {
    const value = pickString(record[key]);
    if (value) return value;
  }
  return null;
}

function pickSiteAddress(site: Record<string, unknown>): string | null {
  return (
    pickString(site.Address) ??
    pickString(site.address) ??
    pickNestedName(site)
  );
}

function pickCatalogLines(centreRecord: Record<string, unknown>): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  const groupedItems = centreRecord.Items ?? centreRecord.items;
  if (groupedItems && typeof groupedItems === 'object') {
    for (const [groupName, groupItems] of Object.entries(groupedItems as Record<string, unknown>)) {
      for (const item of normalizeArray(groupItems)) {
        const itemRecord = asRecord(item);
        if (itemRecord) lines.push({ ...itemRecord, _itemGroup: groupName });
      }
    }
  }
  for (const key of ['Catalogs', 'Catalogues', 'catalogs', 'Labors', 'Prebuilds', 'ServiceFees', 'OneOffs', 'Stock']) {
    for (const item of normalizeArray(centreRecord[key])) {
      const itemRecord = asRecord(item);
      if (itemRecord) lines.push({ ...itemRecord, _itemGroup: key });
    }
  }
  return lines;
}

function pickLineText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = pickString(record[key]);
    if (direct) return direct;
    const nested = pickNestedName(record[key]);
    if (nested) return nested;
  }
  return null;
}

function pickLineQuantity(record: Record<string, unknown>): number {
  for (const key of ['Qty', 'Quantity', 'quantity', 'TotalQty']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, value);
    if (value != null) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return 1;
}

export interface NormalizeSimproJobOptions {
  jobId?: string | number | null;
}

export function normalizeSimproJob(raw: unknown, options: NormalizeSimproJobOptions = {}): ImportReviewDraft {
  const record = asRecord(raw);
  if (!record) {
    throw new Error('Simpro job payload is not an object.');
  }

  const issues: ImportReviewIssue[] = [];
  const jobId =
    pickString(options.jobId) ??
    pickString(record.ID) ??
    pickString(record.Id) ??
    pickString(record.id);

  const project = {
    ...createEmptyProjectDraft(),
    projectName: pickString(record.Name),
    clientName: pickNestedName(record.Customer),
    siteName: pickNestedName(record.Site),
    siteAddress: asRecord(record.Site) ? pickSiteAddress(asRecord(record.Site)!) : null,
    jobNumber: pickJobNumber(record),
    projectNumber: jobId,
    projectManager: pickNestedName(record.ProjectManager),
    projectSummary: pickScopeText(record),
    projectNotes: pickString(record.Notes),
  };

  if (!project.projectName) {
    issues.push({
      code: 'simpro.missing_project_name',
      message: 'Simpro job did not return a Name field.',
      severity: 'warning',
    });
  }

  const systems = [];
  const sections = normalizeArray(record.Sections ?? record.sections);
  if (sections.length === 0) {
    issues.push({
      code: 'simpro.no_sections',
      message: 'No Sections returned — cost centres and catalogue lines may require display=all on get_job.',
      severity: 'warning',
    });
  }

  for (const section of sections) {
    const sectionRecord = asRecord(section);
    if (!sectionRecord) continue;
    const sectionId = pickString(sectionRecord.ID ?? sectionRecord.Id ?? sectionRecord.id);
    const sectionName = pickString(sectionRecord.Name ?? sectionRecord.name) ?? 'Section';
    const centres = normalizeArray(
      sectionRecord.CostCenters ??
      sectionRecord.CostCentres ??
      sectionRecord.costCenters ??
      sectionRecord.costCentres,
    );

    if (centres.length === 0) {
      issues.push({
        code: 'simpro.section_without_cost_centres',
        message: `Section "${sectionName}" has no cost centres.`,
        severity: 'info',
      });
    }

    for (const centre of centres) {
      const centreRecord = asRecord(centre);
      if (!centreRecord) continue;

      const centreId = pickString(centreRecord.ID ?? centreRecord.Id ?? centreRecord.id);
      const centreName =
        pickString(centreRecord.Name) ??
        pickNestedName(centreRecord.CostCenter ?? centreRecord.CostCentre) ??
        'Cost Centre';
      const systemDraftId = createDraftId('system');
      const equipment = pickCatalogLines(centreRecord).map(line => {
        const lineId = pickString(line.ID ?? line.Id ?? line.id);
        return createEquipmentDraft({
          draftId: createDraftId('equip'),
          systemDraftId,
          deviceType:
            pickLineText(line, ['Name', 'PartNo', 'Catalog', 'Description', 'ItemName']) ??
            pickString(line._itemGroup),
          manufacturer: pickLineText(line, ['Manufacturer', 'Supplier', 'Brand']),
          modelNumber: pickLineText(line, ['PartNo', 'Model', 'CatalogNo', 'StockNo']),
          modelName: pickLineText(line, ['Name', 'Description']),
          quantity: pickLineQuantity(line),
          location: sectionName,
          notes: pickString(line._itemGroup),
          systemType: null,
          selected: true,
          sourceLineRef: lineId,
          metadata: {
            simproSectionId: sectionId,
            simproCostCentreId: centreId,
            simproItemGroup: line._itemGroup ?? null,
          },
        });
      });

      if (equipment.length === 0) {
        issues.push({
          code: 'simpro.empty_cost_centre',
          message: `Cost centre "${centreName}" has no catalogue/line items in the normalised payload.`,
          severity: 'info',
          draftId: systemDraftId,
        });
      }

      systems.push(
        createSystemDraft({
          draftId: systemDraftId,
          name: centreName,
          description: pickString(sectionRecord.Description),
          selected: true,
          sourceSectionRef: [sectionId, centreId].filter(Boolean).join(':') || null,
          inference: {
            suggestedSystemType: null,
            confirmedSystemType: null,
            method: 'unresolved',
            confidence: 0,
          },
          equipment,
        }),
      );
    }
  }

  if (systems.length === 0) {
    issues.push({
      code: 'simpro.no_systems',
      message: 'No import systems were created from Simpro sections/cost centres.',
      severity: 'warning',
    });
  }

  return createImportReviewDraft({
    reviewId: createDraftId('review'),
    source: {
      connectorId: 'simpro',
      displayReference: project.jobNumber ?? jobId,
      fetchedAt: new Date().toISOString(),
      externalIds: {
        ...(jobId ? { jobId } : {}),
      },
    },
    project,
    systems,
    issues,
  });
}
