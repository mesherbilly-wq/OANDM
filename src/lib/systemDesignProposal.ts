import type { SchemaCatalogue, SchemaField, SchemaSection } from './schemaForm';
import { PACIFIC_PACK_STATUS } from './pacificCompletionPacks';

const KINDS = ['proposed', 'as_fitted'];
const WORK_TYPES = ['New installation', 'Takeover', 'Upgrade / extension', 'Maintenance', 'Other'];

function form(title: string, sections: SchemaSection[]): SchemaCatalogue {
  return { schemaVersion: '1.0.0', status: PACIFIC_PACK_STATUS, title, sections };
}

function section(id: string, title: string, fields: SchemaField[], extras: Partial<SchemaSection> = {}): SchemaSection {
  return {
    id,
    title,
    showWhen: extras.showWhen ?? null,
    repeatable: extras.repeatable ?? false,
    fields,
    note: extras.note,
  };
}

function text(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'text', required };
}
function area(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'textarea', required };
}
function date(id: string, label: string): SchemaField {
  return { id, label, type: 'date' };
}
function select(id: string, label: string, options: string[], required = false): SchemaField {
  return { id, label, type: 'select', options, required };
}
function note(id: string, label: string): SchemaField {
  return { id, label, type: 'note' };
}
function signature(id: string, label: string, required = false): SchemaField {
  return { id, label, type: 'signature', required };
}

export const SDP_PROPOSED_WORDING =
  'I agree that this System Design Proposal (this revision) describes the proposed scope of works for the stated project. It is not a record of installed equipment or completed tests.';

export const SDP_AS_FITTED_WORDING =
  'I acknowledge that this as-fitted revision records the completed scope, retained equipment, additions, removals, substitutions and disclosed departures from the agreed proposal. It does not certify test measurements or replace the completion and handover record.';

export const SDP_SCHEMA = form('System Design Proposal (SDP)', [
  section('control', 'DOCUMENT CONTROL', [
    select('revision_kind', 'Revision describes', KINDS, true),
    text('revision_number', 'Document revision', true),
    date('revision_date', 'Revision date'),
    text('parent_revision', 'Previous signed revision (if any)'),
    select('work_type', 'Work type', WORK_TYPES),
    text('discipline', 'Discipline (intruder / CCTV / access control / mixed)'),
    note('nsi_note', 'This SDP follows Pacific’s company template and the applicable NSI model-documentation headings. An imported Simpro scope does not automatically meet NSI requirements. Complete the gaps marked incomplete before treating this revision as agreed or as-fitted.'),
  ]),
  section('project', 'PROJECT DETAILS', [
    text('customer_organisation', 'Customer organisation', true),
    text('customer_representative', 'Customer or authorised representative'),
    area('site_address', 'Site address (installation, not billing)', true),
    text('simpro_job_number', 'Simpro job number', true),
    text('project_title', 'Project / work title'),
    text('engineer', 'Engineer'),
    text('project_manager', 'Project manager'),
    text('quote_reference', 'Accepted quote / baseline snapshot'),
    area('source_map', 'Imported Simpro field sources (do not delete; correct values in the sections below)'),
  ]),
  section('requirements', 'CUSTOMER REQUIREMENTS', [
    area('customer_requirements', 'Customer requirements, risks, protected areas and operational need'),
    area('gaps_requirements', 'Information still needed to complete the applicable NSI model template'),
  ]),
  section('description', 'SYSTEM DESCRIPTION', [
    area('system_description', 'System description (from imported scope of works; edit as required)'),
    area('operating_arrangements', 'Operating arrangements, users, setting / viewing / access methods'),
  ]),
  section('works', 'PROPOSED WORKS', [
    area('proposed_works', 'Proposed works and sequence'),
    area('exclusions', 'Exclusions, limitations and assumptions'),
  ]),
  section('equipment', 'EQUIPMENT AND LOCATIONS', [
    note('qty_note', 'Imported quantities and descriptions remain proposed until the engineer verifies them on an as-fitted revision. Quoted quantity is not installed proof.'),
  ]),
  section('equipment_rows', '', [
    text('location', 'Location'),
    text('item', 'Equipment / description'),
    text('qty_proposed', 'Proposed qty (Simpro)'),
    text('qty_actual', 'Actual qty (as-fitted only)'),
    select('status', 'Status', ['proposed', 'installed_as_quoted', 'modified', 'omitted', 'added_on_site', 'existing_retained', 'awaiting_verification']),
    text('source', 'Source (Simpro line / added on site)'),
  ], { repeatable: true }),
  section('as_fitted', 'AS-FITTED CHANGES', [
    area('retained', 'Retained existing equipment'),
    area('additions', 'Additions'),
    area('removals', 'Removals'),
    area('substitutions', 'Substitutions / replacements'),
    area('departures', 'Departures from the agreed proposal'),
  ]),
  section('signoff', 'SIGN-OFF (FINAL PAGE)', [
    note('wording_help', 'Signing wording must match the revision type selected above. Ordinary typed names are not verified digital signatures.'),
    area('signing_wording', 'Signing wording for this revision'),
    text('engineer_name', 'Engineer name'),
    date('engineer_signed_at', 'Engineer date'),
    signature('engineer_signature', 'Engineer signature', true),
    text('customer_name', 'Customer or authorised representative name'),
    text('customer_role', 'Role'),
    date('customer_signed_at', 'Customer date'),
    signature('customer_signature', 'Customer or authorised representative signature', true),
  ]),
]);

export const SDP_FORM_KEY = 'sdp';

export function getSdpSchema(): SchemaCatalogue {
  return SDP_SCHEMA;
}

export function isSdpFormKey(key: string | null | undefined): boolean {
  return key === SDP_FORM_KEY || key === 'system_design_proposal';
}

export function sdpSigningWording(kind: string): string {
  return kind === 'as_fitted' ? SDP_AS_FITTED_WORDING : SDP_PROPOSED_WORDING;
}

export function sdpTemplateList(): Array<{ key: string; name: string; description: string; fields: [] }> {
  return [{
    key: SDP_FORM_KEY,
    name: 'System Design Proposal (SDP)',
    description: 'Editable proposed or as-fitted scope. Signed at the bottom. Imported Simpro wording can be corrected.',
    fields: [],
  }];
}
