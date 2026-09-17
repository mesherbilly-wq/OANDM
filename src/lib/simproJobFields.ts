import { cleanTextField, looksLikeHtml, pickNestedName, pickRichTextField, pickSimproJobNumber, pickString } from '../integrations/connectors/simpro/simproImportHelpers';
import { prepareCustomerScopeHtml } from './scopeOfWorksHtml';

export interface SimproFieldSource {
  path: string;
  label: string;
  value: string;
}

export interface MappedSimproJobFields {
  customerOrganisation: string | null;
  customerRepresentative: string | null;
  siteName: string | null;
  siteAddress: string | null;
  jobNumber: string | null;
  jobId: string | null;
  projectTitle: string | null;
  engineer: string | null;
  projectManager: string | null;
  quoteNumber: string | null;
  quoteId: string | null;
  scopeOfWorks: string | null;
  scopeSources: SimproFieldSource[];
  customFields: SimproFieldSource[];
  missing: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function personName(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return pickString(value);
  const given = pickString(record.GivenName ?? record.givenName);
  const family = pickString(record.FamilyName ?? record.familyName);
  const joined = [given, family].filter(Boolean).join(' ').trim();
  return joined || pickNestedName(record);
}

function joinAddressParts(record: Record<string, unknown>): string | null {
  const parts = [
    pickString(record.Address) ?? pickString(record.address) ?? pickString(record.Line1) ?? pickString(record.AddressLine1),
    pickString(record.Line2) ?? pickString(record.AddressLine2),
    pickString(record.City) ?? pickString(record.Suburb),
    pickString(record.State) ?? pickString(record.County),
    pickString(record.PostalCode) ?? pickString(record.Postcode) ?? pickString(record.Zip),
    pickString(record.Country),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Site installation address from the linked SITE record, not customer billing. */
export function pickSimproSiteAddress(site: unknown): string | null {
  const record = asRecord(site);
  if (!record) return pickString(site);
  const nested = asRecord(record.Address) ?? asRecord(record.address) ?? asRecord(record.PostalAddress);
  return (
    (nested ? joinAddressParts(nested) : null) ??
    joinAddressParts(record) ??
    pickString(record.Address) ??
    pickString(record.address)
  );
}

const INFO_NAME = /^(info|information)$|scope of works|scope of work|^scope$|system description|design proposal|^sdp$|user requirements|agreed scope/i;

export function listSimproCustomFields(job: Record<string, unknown>): SimproFieldSource[] {
  const fields: SimproFieldSource[] = [];
  for (const item of normalizeArray(job.CustomFields ?? job.customFields)) {
    const record = asRecord(item);
    if (!record) continue;
    const definition = asRecord(record.CustomField ?? record.customField) ?? record;
    const name = pickString(definition.Name ?? definition.name) ?? 'Custom field';
    const value = cleanTextField(record.Value ?? record.value);
    if (!value) continue;
    const id = pickString(definition.ID ?? definition.Id ?? definition.id);
    fields.push({
      path: id ? `CustomFields[ID=${id}].Value` : `CustomFields["${name}"].Value`,
      label: name,
      value,
    });
  }
  return fields;
}

function appendSource(targets: SimproFieldSource[], source: SimproFieldSource | null) {
  if (source?.value) targets.push(source);
}

/** Scope of works from Simpro Description, Info-named custom fields, then Notes. Each block keeps its source path. */
export function pickSimproScopeOfWorks(job: Record<string, unknown>): {
  text: string | null;
  sources: SimproFieldSource[];
} {
  const sources: SimproFieldSource[] = [];
  const description = pickRichTextField(job.Description);
  appendSource(sources, description ? { path: 'Description', label: 'Job Description', value: description } : null);

  for (const item of normalizeArray(job.CustomFields ?? job.customFields)) {
    const record = asRecord(item);
    if (!record) continue;
    const definition = asRecord(record.CustomField ?? record.customField) ?? record;
    const name = pickString(definition.Name ?? definition.name) ?? 'Custom field';
    if (!INFO_NAME.test(name)) continue;
    const id = pickString(definition.ID ?? definition.Id ?? definition.id);
    const value = pickRichTextField(record.Value ?? record.value);
    appendSource(sources, value ? {
      path: id ? `CustomFields[ID=${id}].Value` : `CustomFields["${name}"].Value`,
      label: name,
      value,
    } : null);
  }

  const notes = pickRichTextField(job.Notes);
  appendSource(sources, notes ? { path: 'Notes', label: 'Job Notes', value: notes } : null);

  const htmlSource = sources.find(source => looksLikeHtml(source.value));
  if (htmlSource) {
    return { text: prepareCustomerScopeHtml(htmlSource.value) || null, sources };
  }

  const text = sources.map(source => source.value).join('\n\n').trim();
  return { text: text ? prepareCustomerScopeHtml(text) || null : null, sources };
}

export function mapSimproJobFields(
  raw: unknown,
  options: { jobNumberHint?: string | number | null } = {},
): MappedSimproJobFields {
  const job = asRecord(raw) ?? {};
  const convertedFrom = asRecord(job.ConvertedFrom);
  const convertedQuote = asRecord(job.ConvertedFromQuote);
  const quote = asRecord(job.Quote);
  const technicians = normalizeArray(job.Technicians);
  const firstTechnician = asRecord(technicians[0]);
  const customFields = listSimproCustomFields(job);
  const scope = pickSimproScopeOfWorks(job);

  const quoteId =
    pickString(convertedQuote?.ID) ??
    (pickString(convertedFrom?.Type) === 'Quote' ? pickString(convertedFrom?.ID) : null) ??
    pickString(quote?.ID) ??
    pickString(quote?.QuoteNo);

  const missing: string[] = [];
  const customerOrganisation = pickNestedName(job.Customer);
  const customerRepresentative = personName(job.CustomerContact) ?? personName(job.SiteContact);
  const siteName = pickNestedName(job.Site);
  const siteAddress = pickSimproSiteAddress(job.Site);
  const jobId = pickString(job.ID ?? job.Id ?? job.id);
  const jobNumber = pickSimproJobNumber(job, options.jobNumberHint);
  const projectTitle = pickString(job.Name);
  const engineer = pickNestedName(firstTechnician) ?? pickNestedName(job.Technician);
  const projectManager = pickNestedName(job.ProjectManager);

  if (!customerOrganisation) missing.push('Customer.Name / Customer.CompanyName');
  if (!customerRepresentative) missing.push('CustomerContact.GivenName + FamilyName');
  if (!siteAddress) missing.push('Site.Address (installation address)');
  if (!jobNumber) missing.push('Job.ID / JobNo');
  if (!projectTitle) missing.push('Name');
  if (!engineer) missing.push('Technicians[0].Name / Technician.Name');
  if (!scope.text) missing.push('Description, Info custom fields, Notes');
  if (!quoteId) missing.push('ConvertedFromQuote.ID / ConvertedFrom (Type=Quote)');

  return {
    customerOrganisation,
    customerRepresentative,
    siteName,
    siteAddress,
    jobNumber,
    jobId,
    projectTitle,
    engineer,
    projectManager,
    quoteNumber: pickString(quote?.QuoteNo) ?? quoteId,
    quoteId,
    scopeOfWorks: scope.text,
    scopeSources: scope.sources,
    customFields,
    missing,
  };
}

export function formatIncompleteMarker(label: string): string {
  return `[Incomplete — ${label} not returned by Simpro]`;
}

export function valueOrIncomplete(value: string | null | undefined, label: string): string {
  const text = value?.trim();
  return text || formatIncompleteMarker(label);
}
