# Simpro import and editable as-fitted specification

Version 0.2.0 • 16 September 2026
Companion to intruder-alarm-master-specification.md and intruder-alarm-form-schema.json.
These requirements extend the master specification. Technical content remains pending controlled standards validation.

## 1. Intended workflow

Office selects the Simpro company and job, or quote where a job does not yet exist. Fetch linked site, customer, appropriate contact and quote information through the server-side API integration. Show a preview of the selected records and scope before creating the system record.

Prefill the engineer forms and create an editable as-fitted draft from the selected agreed quote scope. The engineer confirms actual installation details, edits descriptions, changes quantities, adds/removes equipment and records deviations. Produce the as-fitted report from verified current information. Preserve the original imported quote baseline.

The quote describes proposed work. Imported quote quantities are proposed quantities, never proof that equipment was installed or tested.

## 2. Source mapping

Logical resource mappings below are implementation requirements; confirm exact endpoint fields in the live API documentation and the connected customer's configuration.

- Project reference: selected job ID/display reference; quote reference is separate if no job exists.
- Site name and installation address: linked SITE record, not customer billing address.
- Customer organisation: linked customer record.
- Customer representative: selected relevant contact; do not assume billing contact can accept a system.
- Contract/proposal reference: selected quote identifier and available revision metadata.
- Agreed scope: selected quote description, sections and cost centres after office scope confirmation.
- Candidate equipment schedule: selected quote material lines, catalogue items and applicable prebuild components, with quoted quantities.
- Manufacturer/model: only explicit supported source fields or approved catalogue mapping; do not infer from ambiguous descriptions.
- Drawings/manuals: supported accessible attachments selected and classified by the office, where available.
- Grade and other specialist design properties: configured custom field mapping if present, otherwise require entry and evidence.
- Engineer and attendance: current assignment / actual attendance confirmed by engineer, never inferred solely from salesperson or quote creation date.

Maintain mapping configuration per connection/company. Custom field IDs are configured explicitly, not matched silently by similar labels. Missing, ambiguous or inaccessible data produces a visible gap requiring review.

## 3. Quote selection and baseline

Resolve the linked quote from the job when supported. If several quotes, alternatives, revisions or variations exist, require an explicit selection of the agreed baseline and relevant intruder cost centres. Never select “latest” as a substitute for agreement.

For mixed-discipline quotes, import only selected intruder scope into the intruder module. Display all candidate sections so the office can check selection. Exclude rejected/optional scope unless explicitly included in the agreed selection.

Store connection ID, company ID, customer/site/job/quote IDs, selected section/cost-centre IDs, line IDs, import time, available source modification metadata and a snapshot hash. If the API supplies no formal quote revision, show a local snapshot ID and retrieval time, clearly identified as local. Do not invent a Simpro revision.

Archive a sanitised immutable baseline and selected source references. Keep commercial data and any original quote attachment restricted to authorised office users. Customer O&M output omits prices, margins, labour rates, supplier costs and internal notes by default.

## 4. Editable as-fitted model

Maintain two linked layers:
1. Quoted baseline: immutable imported scope, line descriptions and proposed quantities.
2. As-fitted revision: editable actual scope, installed quantities, locations, zones, equipment and technical details.

Each as-fitted item has:
- stable internal UUID;
- source quote line / prebuild parent references, or “added on site”;
- original quoted description and quantity;
- editable installed description and actual installed quantity;
- reconciliation status: awaiting_verification, installed_as_quoted, modified, omitted, added_on_site, existing_retained;
- installed asset links, location/zone/partition and manufacturer/model;
- verification person/time and evidence;
- change reason and linked variation/issue where applicable.

Actual installed quantity starts unknown, not equal to quoted quantity. A user can confirm quoted quantity explicitly. Do not create verified installed assets until confirmed. Serial numbers, test results, measured readings and customer signatures always require actual evidence.

Separate aggregate material quantities (e.g. cable metres) from individually identifiable devices. Do not turn labour, discounts or commercial allowance lines into assets. Preserve excluded line references and classification reasons.

For prebuilds, choose a documented representation: parent assembly or expanded physical components. Avoid counting both. Record ambiguity when expansion is unavailable. Stable parent-child IDs prevent duplicate imports.

Provide actions: edit description; confirm quantity; change quantity; add installed item; mark omitted; split a quoted line across locations; link replacement; attach evidence. A deletion marks an omission/tombstone with reason and audit history, not permanent erasure of the baseline.

## 5. Proposed as-fitted document layout

Use the title “Intruder and Hold-up Alarm System — As-Fitted System Record”.
This is a proposed NSI-aligned layout pending validation; there is no verified universal NSI page template in this package.

Ordered report sections:
1. Document control: system, project, revision, dates, author, reviewer and status.
2. Customer, protected premises and installer details.
3. Work route, scope and referenced agreed quotation/snapshot.
4. Applicable standards and design basis: verified grade, classifications and supporting references.
5. Installed system description: protected areas, partitions and operating arrangements.
6. Equipment and zone schedules: actual installed items, locations, identifiers and function.
7. Power supplies and battery record references.
8. Signalling, confirmation and response arrangements, where applicable.
9. Relevant interfaces and settings needed for operation/maintenance, excluding access secrets.
10. As-fitted drawing references and revisions.
11. Differences from the agreed quote/design, limitations and unresolved items.
12. Linked commissioning records, user instructions and maintenance information.
13. Engineer verification, technical review and customer acknowledgement of changes, each bound to this revision.

Transform quote prose into appropriate headings without inventing facts. Any assisted rewrite is a proposed edit requiring review. Avoid leaving future-tense “we will install” wording as a claim about completed work. Quote text alone must not populate verified grade or compliance declarations.

## 6. Refresh and conflicts

Simpro import is read-only; changes in this builder do not write back to Simpro.

A refresh creates a new source snapshot and proposed field-level changes:
- untouched imported fields may update in an unsigned draft, with visible audit history;
- locally edited fields are preserved and flagged for comparison;
- removed source lines remain traceable;
- signed/released revisions are never modified;
- accepted changes to a signed record create a new draft revision and renewed affected approvals.

Store last imported value, current local value and incoming value for three-way comparison. Record who accepted each conflict resolution. Changing company, site or quote after initial selection requires explicit relinking and review; do not merge records solely by matching names or descriptions.

## 7. Connection and failure handling

Use the existing site integration if present. Otherwise configure the connection server-side using a supported Simpro authentication method confirmed against current documentation. Keep credentials in server-side secret storage and out of browser bundles, email and logs. Scope user access to the correct tenant/company.

Implement pagination, bounded retry/backoff for transient errors and rate limits, token lifecycle handling, request timeout and idempotent imports. A partial fetch must display “incomplete import”; it cannot be marked complete or silently omit a page. Retrying the same snapshot must not duplicate lines.

Sanitise imported HTML and treat quote text/attachments as untrusted content. Validate file access and MIME types. Import failures leave the last good snapshot available with its date and clear stale/incomplete state.

Field provenance metadata: source system, connection/company IDs, resource type/ID, source field/line, snapshot ID, imported timestamp, original value, locally edited flag, editor/time and verification status.

## 8. Build acceptance tests

- Site address differs from billing address: all engineer forms show the linked site address.
- Two companies use the same quote number: records remain distinct.
- Quote spans several disciplines: only selected intruder sections seed this module.
- Quote offers alternative detectors: only explicitly agreed scope is seeded.
- Quoted 12 detectors, installed 10: report shows 10 actual, original 12 and recorded difference.
- Two extra devices installed: new assets and change records appear without altering the baseline.
- Labour/prebuild lines: no duplicated physical equipment.
- Missing model, grade or actual quantity: blank/unverified remains visible.
- Engineer edits scope then refreshes Simpro: edit survives; conflict is shown.
- A second import of the same quote: no duplicates.
- API failure on page two: import remains incomplete.
- Quote changes after signature: original release remains intact.
- Customer export: no prices, margin, internal notes or live credentials.
- Source quote has no revision: local snapshot identity is labelled honestly.

## 9. API evidence and implementation verification

Official Simpro API documentation lists Sites, Customers, Contacts, Jobs, Quotes, quote cost centres, Catalogs and Prebuilds:
https://developer.simprogroup.com/apidoc/

Official quote documentation describes accepted quotes being converted to jobs and provides quote-section resources:
https://developer.simprogroup.com/apidoc/?page=c9a28e7f0dbc3ed20a161351c4f29a7b

Checked 16 September 2026. This package has not connected to your Simpro instance. Available fields, permissions, attachments, quote-job linkage and custom fields must be verified during implementation. Do not assume proposed logical mappings are exact API property names.

