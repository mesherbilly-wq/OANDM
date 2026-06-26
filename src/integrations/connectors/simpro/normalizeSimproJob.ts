import { createDraftId } from '../../core/draftHelpers';

import { createEquipmentDraft } from '../../models/ImportEquipmentDraft';

import { createEmptyProjectDraft } from '../../models/ImportProjectDraft';

import {

  createImportReviewDraft,

  type ImportReviewDraft,

  type ImportReviewIssue,

} from '../../models/ImportReviewDraft';

import { createSystemDraft } from '../../models/ImportSystemDraft';

import {

  cleanTextField,

  inferCategoryFromTexts,

  mapSimproCatalogLine,

  pickNestedName,

  pickProjectName,

  pickScopeOfWorks,

  pickSimproCostCentreCatalogLines,

  pickSimproJobId,

  pickSimproJobNumber,

  pickString,

  resolveSimproCatalogLines,

} from './simproImportHelpers';



function asRecord(value: unknown): Record<string, unknown> | null {

  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

}



function normalizeArray(value: unknown): unknown[] {

  if (Array.isArray(value)) return value;

  if (value == null) return [];

  return [value];

}



function pickSiteAddress(site: Record<string, unknown>): string | null {

  return (

    pickString(site.Address) ??

    pickString(site.address) ??

    pickNestedName(site)

  );

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

  const jobId = pickSimproJobId(record, options.jobId);

  const jobNumber = pickSimproJobNumber(record);

  const scopeOfWorks = pickScopeOfWorks(record);



  const project = {

    ...createEmptyProjectDraft(),

    projectName: pickProjectName(record),

    clientName: pickNestedName(record.Customer),

    siteName: pickNestedName(record.Site),

    siteAddress: asRecord(record.Site) ? pickSiteAddress(asRecord(record.Site)!) : null,

    jobNumber,

    projectNumber: jobId,

    projectManager: pickNestedName(record.ProjectManager),

    projectSummary: scopeOfWorks,

    projectNotes: cleanTextField(record.Notes),

  };



  if (!project.projectName) {

    issues.push({

      code: 'simpro.missing_project_name',

      message: 'Simpro job did not return a usable Name or Description title.',

      severity: 'warning',

    });

  }



  if (!scopeOfWorks) {

    issues.push({

      code: 'simpro.missing_scope',

      message: 'Simpro job Description is empty — Scope of Works could not be populated.',

      severity: 'warning',

    });

  }



  if (!jobNumber) {

    issues.push({

      code: 'simpro.missing_job_number',

      message: 'No JobNo, OrderNo, RequestNo, or Reference found on this job.',

      severity: 'info',

    });

  }



  if (!jobId) {

    issues.push({

      code: 'simpro.missing_job_id',

      message: 'Simpro internal job ID was not found on the payload.',

      severity: 'warning',

    });

  }



  const systems = [];

  let excludedNonProductLines = 0;

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

      const rawCatalogLines = pickSimproCostCentreCatalogLines(centreRecord);

      const resolved = resolveSimproCatalogLines(rawCatalogLines);

      excludedNonProductLines += resolved.excludedCount;

      issues.push(...resolved.warnings);



      const equipment = resolved.importLines.map(({ line, itemGroup }) => {

        const mapped = mapSimproCatalogLine(line, itemGroup);

        for (const issue of mapped.issues) {

          issues.push({ ...issue, draftId: mapped.sourceLineRef ?? systemDraftId });

        }



        return createEquipmentDraft({

          draftId: createDraftId('equip'),

          systemDraftId,

          deviceType: mapped.deviceType,

          manufacturer: mapped.manufacturer,

          modelNumber: mapped.modelNumber,

          modelName: mapped.modelName,

          quantity: mapped.quantity,

          location: sectionName,

          notes: mapped.notes,

          category: null,

          matched: false,

          matchedProductId: null,

          confidence: null,

          selected: true,

          sourceLineRef: mapped.sourceLineRef,

          metadata: {

            simproSectionId: sectionId,

            simproCostCentreId: centreId,

            simproItemGroup: line._itemGroup ?? itemGroup,

            simproPrebuildParentId: line._prebuildParentId ?? null,

            simproPartNo: mapped.partNumber,

            simproCatalogNo: mapped.catalogNumber,

            simproStockNo: mapped.stockNumber,

            simproQuantitySource: mapped.quantitySource,

          },

        });

      });



      const inferenceTexts = [
        centreName,
        pickString(centreRecord.Description),
        ...equipment.flatMap(item => [item.deviceType, item.modelName, item.modelNumber]),
      ];
      const categoryInference = inferCategoryFromTexts(inferenceTexts);

      if (!categoryInference.suggestedCategory) {
        issues.push({
          code: 'simpro.unresolved_category',
          message: `No category suggested for system "${centreName}" — you can set one during review.`,
          severity: 'info',
          draftId: systemDraftId,
        });
      }



      if (equipment.length === 0) {

        issues.push({

          code: 'simpro.empty_cost_centre',

          message: `Cost centre "${centreName}" has no importable product/material lines after filtering.`,

          severity: 'info',

          draftId: systemDraftId,

        });

      }



      systems.push(

        createSystemDraft({

          draftId: systemDraftId,

          name: centreName,

          description: cleanTextField(centreRecord.Description) ?? cleanTextField(sectionRecord.Description),

          selected: true,

          sourceSectionRef: [sectionId, centreId].filter(Boolean).join(':') || null,

          category: {
            suggestedCategory: categoryInference.suggestedCategory,
            confirmedCategory: null,
            method: categoryInference.method,
            confidence: categoryInference.confidence,
          },

          equipment,

        }),

      );

    }

  }



  if (excludedNonProductLines > 0) {

    issues.push({

      code: 'simpro.excluded_non_product_lines',

      message: `Excluded ${excludedNonProductLines} non-product/commercial/prebuild line${excludedNonProductLines !== 1 ? 's' : ''} from equipment import.`,

      severity: 'info',

    });

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

      displayReference: jobNumber ?? jobId,

      fetchedAt: new Date().toISOString(),

      externalIds: {

        ...(jobId ? { jobId } : {}),

        ...(jobNumber ? { jobNumber } : {}),

      },

    },

    project,

    systems,

    issues,

  });

}


