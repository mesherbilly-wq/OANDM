import type { FormAnswers, FormRow } from './schemaForm';
import { emptyAnswers, emptyRow, newRowId } from './schemaForm';
import { getSdpSchema, sdpSigningWording } from './systemDesignProposal';
import { formatIncompleteMarker, valueOrIncomplete } from './simproJobFields';

export const INCOMPLETE_MARKER = /^\[Incomplete — /;

export interface SdpProjectInput {
  project_name?: string | null;
  client_name?: string | null;
  site_name?: string | null;
  site_address?: string | null;
  job_number?: string | null;
  quote_number?: string | null;
  project_manager?: string | null;
  engineer?: string | null;
  project_notes?: string | null;
}

export interface SdpEquipmentRow {
  location?: string | null;
  item?: string | null;
  qty_proposed?: string | number | null;
  source?: string | null;
}

export interface SimproRefreshSnapshot {
  customer_organisation: string;
  site_address: string;
  simpro_job_number: string;
  project_title: string;
  engineer: string;
  project_manager: string;
  quote_reference: string;
  system_description: string;
}

export interface SdpDiff {
  field: string;
  current: string;
  imported: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textOf(value: unknown): string {
  return String(value ?? '').trim();
}

function section(answers: FormAnswers, id: string): Record<string, unknown> {
  const current = asRecord(answers[id]);
  answers[id] = current;
  return current;
}

export function looksIncomplete(value: unknown): boolean {
  return INCOMPLETE_MARKER.test(textOf(value));
}

export function buildSdpSnapshot(project: SdpProjectInput, scopeText: string | null): SimproRefreshSnapshot {
  return {
    customer_organisation: project.client_name?.trim() || '',
    site_address: project.site_address?.trim() || '',
    simpro_job_number: project.job_number?.trim() || '',
    project_title: project.project_name?.trim() || '',
    engineer: project.engineer?.trim() || '',
    project_manager: project.project_manager?.trim() || '',
    quote_reference: project.quote_number?.trim() || '',
    system_description: scopeText?.trim() || '',
  };
}

export function buildSdpAnswers(opts: {
  project: SdpProjectInput;
  scopeText?: string | null;
  equipment?: SdpEquipmentRow[];
  discipline?: string;
  kind?: 'proposed' | 'as_fitted';
  revisionNumber?: string;
  parentRevision?: string;
}): FormAnswers {
  const schema = getSdpSchema();
  const answers = emptyAnswers(schema);
  const kind = opts.kind ?? 'proposed';
  const control = section(answers, 'control');
  const project = section(answers, 'project');
  const requirements = section(answers, 'requirements');
  const description = section(answers, 'description');
  const works = section(answers, 'works');
  const signoff = section(answers, 'signoff');

  control.revision_kind = kind;
  control.revision_number = opts.revisionNumber ?? '1';
  control.revision_date = new Date().toISOString().slice(0, 10);
  control.parent_revision = opts.parentRevision ?? '';
  control.work_type = '';
  control.discipline = opts.discipline ?? formatIncompleteMarker('discipline from project systems');

  project.customer_organisation = valueOrIncomplete(opts.project.client_name, 'Customer.Name');
  project.customer_representative = formatIncompleteMarker('CustomerContact.GivenName + FamilyName');
  project.site_address = valueOrIncomplete(opts.project.site_address, 'Site.Address');
  project.simpro_job_number = valueOrIncomplete(opts.project.job_number, 'JobNo');
  project.project_title = valueOrIncomplete(opts.project.project_name, 'Name');
  project.engineer = valueOrIncomplete(opts.project.engineer, 'Technicians[0].Name');
  project.project_manager = valueOrIncomplete(opts.project.project_manager, 'ProjectManager');
  project.quote_reference = valueOrIncomplete(opts.project.quote_number, 'ConvertedFromQuote');
  project.source_map = opts.project.project_notes?.trim() || formatIncompleteMarker('Simpro field sources');

  const scope = opts.scopeText?.trim() || '';
  description.system_description = scope || formatIncompleteMarker('Description / Info custom fields / Notes');
  description.operating_arrangements = formatIncompleteMarker('operating arrangements');
  works.proposed_works = scope || formatIncompleteMarker('proposed works from scope of works');
  works.exclusions = formatIncompleteMarker('exclusions and limitations');
  requirements.customer_requirements = scope || formatIncompleteMarker('customer requirements in Simpro Info / Description');
  requirements.gaps_requirements = [
    !opts.project.client_name ? 'Customer organisation' : null,
    !opts.project.site_address ? 'Site installation address' : null,
    !scope ? 'Scope of works narrative' : null,
    'Operating arrangements',
    'Exclusions / limitations',
    'Work type and applicable NSI model-document fields for the discipline',
  ].filter(Boolean).join('\n');

  const equipmentSection = schema.sections.find(item => item.id === 'equipment_rows');
  const rows: FormRow[] = (opts.equipment ?? []).map(item => ({
    ...(equipmentSection ? emptyRow(equipmentSection) : { _rowId: newRowId() }),
    location: item.location ?? '',
    item: item.item ?? '',
    qty_proposed: item.qty_proposed == null ? '' : String(item.qty_proposed),
    qty_actual: '',
    status: 'proposed',
    source: item.source ?? 'Simpro quote line',
  }));
  answers.equipment_rows = rows.length ? rows : equipmentSection ? [emptyRow(equipmentSection)] : [];

  signoff.signing_wording = sdpSigningWording(kind);
  signoff.engineer_name = opts.project.engineer ?? '';
  return answers;
}

const SNAPSHOT_PATHS: Array<{ field: keyof SimproRefreshSnapshot; section: string; key: string }> = [
  { field: 'customer_organisation', section: 'project', key: 'customer_organisation' },
  { field: 'site_address', section: 'project', key: 'site_address' },
  { field: 'simpro_job_number', section: 'project', key: 'simpro_job_number' },
  { field: 'project_title', section: 'project', key: 'project_title' },
  { field: 'engineer', section: 'project', key: 'engineer' },
  { field: 'project_manager', section: 'project', key: 'project_manager' },
  { field: 'quote_reference', section: 'project', key: 'quote_reference' },
  { field: 'system_description', section: 'description', key: 'system_description' },
];

export function reconcileSimproRefresh(
  current: FormAnswers,
  imported: FormAnswers,
  previousSnapshot?: SimproRefreshSnapshot | null,
  nextSnapshot?: SimproRefreshSnapshot | null,
): { answers: FormAnswers; diffs: SdpDiff[] } {
  const answers: FormAnswers = JSON.parse(JSON.stringify(current));
  const diffs: SdpDiff[] = [];

  for (const path of SNAPSHOT_PATHS) {
    const currentSection = section(answers, path.section);
    const importedSection = asRecord(imported[path.section]);
    const currentValue = textOf(currentSection[path.key]);
    const importedValue = textOf(importedSection[path.key]);
    const previous = previousSnapshot ? textOf(previousSnapshot[path.field]) : '';
    const next = nextSnapshot ? textOf(nextSnapshot[path.field]) : importedValue;

    if (currentValue === importedValue) continue;
    const userEdited = currentValue && currentValue !== previous && !looksIncomplete(currentValue);
    if (userEdited) {
      if (next && next !== currentValue && next !== previous) {
        diffs.push({ field: `${path.section}.${path.key}`, current: currentValue, imported: next });
      }
      continue;
    }
    currentSection[path.key] = importedValue;
  }

  return { answers, diffs };
}

export function sdpHasBothSignatures(answers: FormAnswers): boolean {
  const signoff = asRecord(answers.signoff);
  const engineer = asRecord(signoff.engineer_signature);
  const customer = asRecord(signoff.customer_signature);
  return Boolean(textOf(engineer.dataUrl) && textOf(customer.dataUrl));
}

export function clearSdpSignatures(answers: FormAnswers): FormAnswers {
  const next: FormAnswers = JSON.parse(JSON.stringify(answers));
  const signoff = section(next, 'signoff');
  signoff.engineer_signature = { signerName: '', dataUrl: '', signedAt: '' };
  signoff.customer_signature = { signerName: '', dataUrl: '', signedAt: '' };
  signoff.engineer_signed_at = '';
  signoff.customer_signed_at = '';
  return next;
}

export function applySdpKind(answers: FormAnswers, kind: 'proposed' | 'as_fitted'): FormAnswers {
  const next: FormAnswers = JSON.parse(JSON.stringify(answers));
  const control = section(next, 'control');
  const signoff = section(next, 'signoff');
  control.revision_kind = kind;
  signoff.signing_wording = sdpSigningWording(kind);
  return next;
}

export function sdpKindOf(answers: FormAnswers): 'proposed' | 'as_fitted' {
  return textOf(asRecord(answers.control).revision_kind) === 'as_fitted' ? 'as_fitted' : 'proposed';
}

export function sdpRevisionLabel(answers: FormAnswers): string {
  return textOf(asRecord(answers.control).revision_number) || '1';
}
