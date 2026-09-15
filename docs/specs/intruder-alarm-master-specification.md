# Intruder alarm O&M builder — master form specification

Version: 0.2 • Date: 16 September 2026
Status: DRAFT FOR IMPLEMENTATION — NOT VALIDATED FOR NSI COMPLIANCE

## 1. Purpose and boundary

Build a mobile-friendly engineer questionnaire for UK intruder and hold-up alarm projects. Support new installations, takeovers, upgrades and extensions, including combined takeover/upgrade work. Generate consistent commissioning and handover records from shared data.

This is a proposed product specification, not an official NSI template, a certificate of compliance or a completed clause-by-clause standards assessment. NSI approval belongs to the approved company. The system must not display an NSI-approved claim or logo merely because this questionnaire has been completed.

Companion file: intruder-alarm-form-schema.json. It supplies field IDs, types, choices and section conditions. Where a conditional rule below narrows a required field, implement that rule. Use a controlled standards profile to define the actual technical tests and acceptance limits before production use.

Integration companion: simpro-import-and-as-fitted-specification.md. Implement Simpro prefilling and quote-derived editable as-fitted records using that document. Preserve the selected agreed quote baseline, track installed changes, and never treat quoted equipment as verified installation evidence. This companion extends the field catalogue and implementation requirements.

## 2. Engineer journey

1. Office creates the project, agrees scope, enters site information and selects work types and system features.
2. Engineer receives an individual secure email link and verifies access.
3. Engineer checks prefilled information and records survey / existing condition where applicable.
4. Engineer records equipment, changes, power supplies and actual test results.
5. Engineer records faults, limitations and required remedial actions.
6. Engineer records monitoring status and provider transfer where applicable.
7. Engineer completes customer training and obtains the appropriate acknowledgements.
8. Engineer submits a locked revision for technical review.
9. Reviewer requests corrections or authorises an interim or final pack.
10. Builder produces a revision-controlled pack and records delivery.

Allow saving drafts and resuming on a phone. Show progress by active section. Do not require an engineer to re-enter the same site, equipment or customer information in different documents.

## 3. Route selection

Work types are multi-select, with one restriction: new_installation cannot coexist with takeover, upgrade or extension for the same system record. A project containing separate new and existing systems uses separate system records.

All routes: project, basis, equipment, power where applicable, tests, issues, training and release.
Takeover: add existing condition survey and transfer assessment.
Upgrade / extension: add change scope and compatibility assessment.
Any provider change: enable transfer, even if takeover was not initially selected.
ARC monitoring: enable signalling.
Hold-up: enable applicable hold-up tests and training.
Wireless: enable radio-related tests from the approved standards profile.
Interfaces: identify each interface and its approved verification procedure.

Customer training and acceptance are different events. A trainee may not be authorised to accept the system. Capture each person's role.

## 4. Proposed generated documents

IA-01 System Details and As-Fitted Record: project, design basis and current equipment / zone schedule.
IA-02 Installation, Commissioning and Verification Record: route scope, approved checklist, actual tests, tester and outcomes.
IA-03 Power Supply and Battery Record: one record per applicable supply, measurements and approved capacity calculation.
IA-04 Alarm Signalling and ARC Verification Record: only where applicable.
IA-05 Design Changes, Variations and Outstanding Works: preserve issue types and status.
IA-06 Customer Training Record: applicable topics and attendee acknowledgements.
IA-07 Handover and Customer Acceptance: exact system/as-fitted revision, operational status and limitations.
IA-08 System Logbook: initial system details, service contacts and continuing events.
IA-09 Maintenance and Support Information: service arrangements, contacts and warranty.
IA-10 O&M Document Index and Technical Release: document manifest, review and release.
IA-11 Takeover Survey and Condition Report: takeover only.
IA-12 Upgrade / Extension Scope and Compatibility Record: relevant changes only.
IA-13 Maintenance / Monitoring Transfer Record: provider changes only.

The issued NSI Certificate of Compliance is an attached external document. Store its number, issuer, date and file reference. Never fabricate its number or generate an imitation certificate. The reviewer determines the certificate requirements for the particular work.

Every generated document must show project reference, system reference, document ID, revision, date, author, status and page numbering. Interim packs must visibly say INTERIM and list unresolved items. Keep reports readable when printed; repeat headings on multipage schedules and avoid splitting signature blocks.

## 5. Field and repeating-record behaviour

Use the JSON schema as the field catalogue. Give each equipment, power, test, issue and training row a stable UUID, independent of visible reference numbers. Link tests to assets and issues through those UUIDs.

Asset records need a history of added, retained, replaced and removed states. Removed items remain visible in the change history but are excluded from the current as-fitted schedule. Replacing a device creates a new asset linked to its predecessor.

Document references must contain an ID, title, revision, date and attachment or controlled source link. Standards references additionally need edition, amendment and clause.

Every test result supports pass, fail, not_applicable and not_tested:
- Pass requires actual evidence sufficient for the approved procedure.
- Fail requires a linked issue.
- Not applicable requires a reason; it must not mean the test was skipped.
- Not tested requires a reason and linked outstanding item.
- Unknown grading is permitted for survey capture, but cannot produce a verified grade claim.

Record numeric measurements separately from units. Reject invalid numeric values and impossible dates; do not invent engineering pass thresholds. Include test conditions and instrument reference where the procedure requires them.

Required evidence and mandatory tests come from a versioned, technically approved standards profile. Until it exists, allow draft capture and preview only; block final NSI-compliance-labelled output.

## 6. Conditional field validation

Apply these rules in addition to the JSON required flags:
- Existing stated grade applies only to existing systems. Evidence is required for any verified grade.
- Police policy / response fields become active when police_response is selected.
- Zone function/address/partition apply to relevant devices; require an explicit applicability decision for other equipment.
- Battery fields apply only to supplies with batteries. A batteryless supply requires the approved profile's applicability outcome and reason.
- Takeover record gaps and unknown information accept an explicit “none identified” or “unknown”, with explanation; do not require invented values.
- In signalling, response evidence is required when police response is recorded as confirmed_documented.
- Pending monitoring actions require owner and due date when monitoring is not live_verified.
- Transfer details are required only if transfer_required is true. Otherwise record why no transfer is needed.
- Failure issue references, not-tested reasons and not-applicable reasons are required only for the matching result.
- Closed issues require closure evidence, the relevant retest result, closer and timestamp.
- An issued certificate requires its number, issuer, date and attachment. A pending certificate requires an action owner and due date.
- Customer signature may be unavailable: capture the reason and follow-up. Never insert a signature or mark acceptance complete automatically.
- First service due date must be supported by the confirmed service arrangement. If undecided, record an outstanding action.
- Unused optional fields display as not recorded or not applicable as appropriate, never as passed.

## 7. Issue control and acceptance

Keep design changes, standards departures, defects, incomplete work and unverified items distinct.

For each issue record description, affected equipment, operational effect, source requirement where known, owner, action, due date, temporary arrangements and evidence.

Customer acknowledgement does not resolve a technical defect or approve a departure from a standard. Technical review is separate. A closed issue must retain its original history and supporting retest; never overwrite the original failure with a pass.

Draft customer training acknowledgement:
“I acknowledge that the topics recorded above were demonstrated or explained to me and that I received the referenced operating and support information. Any outstanding training is listed in this record.”

Draft engineer declaration:
“I confirm that this record accurately describes the work and tests I carried out within the stated scope. Untested items, failures and limitations are identified. My declaration relates to the referenced revision.”

Draft customer acceptance:
“I acknowledge receipt of the system and documents identified in this handover record, the demonstration recorded, and the stated operational status and outstanding items.”

These are proposed operational statements for company review. Do not add a blanket customer declaration that the installation complies with every standard.

## 8. Release and revision rules

Workflow states: draft, submitted, changes_requested, technically_reviewed, interim_released, final_released, superseded.

Operational status, customer acceptance status, certificate status and pack workflow status are independent. For example, an operational system may still have a pending certificate.

Proposed product controls:
- Submission requires all active questions completed or explicitly marked unknown / not applicable with required reasons.
- Final release requires an approved standards profile, completed technical review and a complete document manifest or formally resolved applicability decision.
- An unresolved failed required test, unverified required test, or unsupported compliance claim blocks final compliant release.
- A customer acknowledgement never bypasses a technical blocker.
- Open administrative items require reviewer disposition; permit a clearly labelled interim pack where appropriate.
- Certificate applicability cannot remain awaiting review for final release.
- Issued documents and signatures bind to an immutable revision. Any material edit creates a new revision and requires the affected declarations/review again.
- Store a content hash of each released document and a delivery audit record.
- No checkbox should automatically infer system compliance from all visible questions being answered.

The technical reviewer must be a company-authorised person. Record their identity and approval basis.

## 9. Supporting records not expanded in the main field catalogue

System logbook event: UUID, system ID, event date/time, event type (activation, fault, maintenance, repair, modification, other), area/device, description, action, person, linked service/test/issue references and attachments. Protect audit history; corrections append a new entry.

Service contacts: provider organisation, service phone, emergency phone, email, agreement reference, effective dates and document attachment.

Certificate metadata: issuer, certificate number, issue date, work scope and attachment.

Delivery record: released revision, recipient, channel, timestamp and delivery outcome.

Action record: linked issue/document, owner, due date, status and completion evidence.

## 10. Security and access

Engineer links must be individual, expiring and revocable. Use access verification appropriate to company policy; possession of a forwarded email alone should not grant indefinite access.

Roles: project administrator, assigned engineer, customer signer, technical reviewer and read-only recipient. Customers must only access their own authorised project information.

Do not store live alarm PINs, engineer codes, passwords, recovery codes or signalling secrets in these questionnaires, evidence photographs or general O&M PDFs. Record secure handover completion and recipient identity instead. Review uploaded images for accidental credential exposure before release.

Restrict keyholder and monitoring-account information to appropriate recipients. Use a separate restricted annex if such details are required. Public or general distribution exports must omit it.

Save audit events for creation, edits, submissions, signatures, reviews, releases and downloads. Define retention, backups and access policies before production deployment.

## 11. Standards-validation register

Public references previously checked:
- NSI NACOSS Gold approval criteria, SF-002.9, October 2024: identifies PD 6662:2017 and NCP 120 Issue 1 as primary intruder requirements.
  https://nsi.org.uk/wp-content/uploads/2012/06/SF-002.9-NACOSS-Gold-approval-criteria-Oct-2024.pdf
- NSI notice, 23 November 2021: NCP 120 replaced NACP 11 and introduced documented maintenance transfer arrangements.
  https://www.nsi.org.uk/publication-of-nsi-code-of-practice-for-intruder-alarms-ncp-120-replacing-nacp-11/
- Public NACP 2 Issue 1, clauses 10.13–10.17: handover information, acceptance and remote signalling status. It is an older publication; verify current controlled applicability.
  https://www.nsi.org.uk/wp-content/uploads/2012/08/NACP-2-Code-of-Practice-NACOSS-Gold-and-ARC-Gold-Customer-Communication-Issue-1-Dec-1990-1.pdf

Before approval, obtain and check the applicable controlled editions, amendments and NSI bulletins for:
- PD 6662 and its called-up standards.
- NCP 120 and relevant NSI quality / customer communication requirements.
- BS EN 50131 series and application guidance relevant to the system.
- BS 9263 for commissioning, maintenance and remote support.
- BS 8243 where confirmed alarms apply.
- BS 8473 for false-alarm management.
- Applicable alarm transmission standards and ARC requirements.
- Applicable police policy where police response is intended.
- Applicable electrical requirements for the work performed.

This list is a validation starting point, not an assertion that every document applies to every project. Exact technical clauses, test limits, standby requirements and takeover certification rules remain unverified in this draft.

For each requirement store: document, edition, amendment, clause, applicability rule, source-access status, associated fields/tests, interpretation, reviewer, review date and approval status. Do not label a proposed field “mandatory under NSI” without that evidence.

No MoJ/HMPPS compliance assessment is included. If a project is in that scope, add a separate project profile checked against Bill's saved specification library and the installed moj-security-standards skill.

## 12. Cursor implementation brief

Implement this specification within the existing site's framework, styling, authentication and storage conventions. Inspect existing code before selecting libraries or changing architecture.

Deliver:
1. Schema-backed mobile questionnaire with conditional routes and repeatable rows.
2. Shared project data and stable relationships between assets, tests, issues and documents.
3. Draft saving, individual engineer invitations and role-based signing/review.
4. Server-side validation matching the rules above.
5. Printable document generation and a revisioned O&M manifest.
6. Immutable releases and an audit trail.
7. A standards-profile configuration interface accessible only to authorised staff.
8. A clear draft/unvalidated state until technical validation is approved.

Do not hard-code certification claims or infer missing results. Do not replace the site's existing permission model without first assessing it. Email sending should use the existing approved email service and must not expose sensitive site information in email bodies.

The supplied JSON is a field catalogue, not a complete database migration or executable standards rules engine. Implement the compound field types explicitly. Add supporting-record fields described in section 9.

## 13. Acceptance scenarios

- New wired installation: no takeover, change or signalling questions unless applicable.
- Takeover with unknown grade and missing records: save findings, create outstanding items, do not claim verified grade.
- Takeover plus upgrade: both relevant sections appear; shared assets are entered once.
- Upgrade of monitored system: record relevant existing-system retests and confirmed final monitoring state.
- Device test failure: linked issue required; customer signature cannot clear it.
- Required test not performed: “not tested” visible in report and release blocked until properly resolved.
- Provider change on upgrade: transfer section appears.
- Removed device: remains in history but not current as-fitted schedule.
- Certificate pending: no fabricated certificate or complete-certification label.
- Material edit after signature: new revision and affected approvals required.
- Customer declines / cannot sign: reason and follow-up preserved.
- Engineer invitation revoked: further access denied.
- Another customer's project: unauthorised user denied.
- Printed multipage schedules: readable headers, complete rows and intact signature blocks.
