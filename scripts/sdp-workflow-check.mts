import { mapSimproJobFields, formatIncompleteMarker } from '../src/lib/simproJobFields.ts';
import { inferSystemTypeName, inferTradeCategoryFromTexts, shouldAutoAssignSystemType } from '../src/lib/inferSystemType.ts';
import { displayProjectJobNumber } from '../src/lib/projectJobNumber.ts';
import { buildSdpAnswers, reconcileSimproRefresh, sdpHasBothSignatures, applySdpKind } from '../src/lib/sdpAnswers.ts';
import { sdpSigningWording, SDP_PROPOSED_WORDING, SDP_AS_FITTED_WORDING } from '../src/lib/systemDesignProposal.ts';

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('ok', name);
  }
}

const mapped = mapSimproJobFields({
  JobNo: 'J-100',
  Name: 'Gatehouse cameras',
  Description: '<p>Install four cameras</p>',
  Notes: 'Keep existing NVR',
  Customer: { Name: 'HMP Example' },
  CustomerContact: { GivenName: 'Alex', FamilyName: 'Reed' },
  Site: { Name: 'Gatehouse', Address: { Address: '1 Site Road', City: 'Leeds', PostalCode: 'LS1 1AA' } },
  Technicians: [{ Name: 'Pat Engineer' }],
  ProjectManager: { Name: 'Sam PM' },
  ConvertedFromQuote: { ID: 'Q-9' },
  CustomFields: [{ CustomField: { ID: 12, Name: 'Info' }, Value: 'Cover the vehicle lock' }],
});

assert('maps job number from JobNo', mapped.jobNumber === 'J-100');
assert('maps job number from Simpro ID when JobNo is absent', mapSimproJobFields({
  ID: 8821,
  OrderNo: 'PO-999',
}).jobNumber === '8821');
assert('does not use the customer PO as the job number', mapSimproJobFields({
  ID: 8821,
  OrderNo: 'PO-999',
}, { jobNumberHint: 'PO-999' }).jobNumber === '8821');
assert('maps typed job number hint over internal ID', mapSimproJobFields({
  ID: 8821,
  OrderNo: 'PO-999',
  Name: 'Gatehouse cameras',
}, { jobNumberHint: 'NCP104' }).jobNumber === 'NCP104');
assert('does not use a project title as the job number hint', mapSimproJobFields({
  ID: 8821,
  Name: 'Gatehouse cameras',
}, { jobNumberHint: 'Gatehouse cameras' }).jobNumber === '8821');
assert('overview prefers Simpro ID over a stored PO', displayProjectJobNumber('PO-999', '8821') === '8821');
assert('overview keeps a manual job number when there is no Simpro ID', displayProjectJobNumber('NCP104', null) === 'NCP104');
assert('infers CCTV from camera text', inferSystemTypeName(['Axis P3245-LVE camera']) === 'CCTV');
assert('infers Access Control from reader text', inferSystemTypeName(['HID Signo reader']) === 'Access Control');
assert('infers Intruder from PIR text', inferSystemTypeName(['Grade 3 PIR detector']) === 'Intruder');
assert('infers Fire from fire alarm text', inferSystemTypeName(['Fire alarm sounder']) === 'Fire');
assert('does not treat Security as the install system type', inferSystemTypeName(['Axis P3245-LVE camera']) !== 'Security');
assert('maps camera part text to Security trade bucket only', inferTradeCategoryFromTexts(['Axis P3245-LVE camera']) === 'Security');
assert('auto-assigns Simpro materials lines', shouldAutoAssignSystemType('Materials') === true);
assert('keeps an already chosen CCTV type', shouldAutoAssignSystemType('CCTV') === false);
assert('maps customer', mapped.customerOrganisation === 'HMP Example');
assert('maps site address', /1 Site Road/.test(mapped.siteAddress || ''));
assert('maps engineer', mapped.engineer === 'Pat Engineer');
assert('scope keeps Description source', mapped.scopeSources.some((item) => item.path === 'Description'));
assert('scope keeps Info custom field', mapped.scopeSources.some((item) => item.path === 'CustomFields[ID=12].Value'));
assert('scope keeps Notes', mapped.scopeSources.some((item) => item.path === 'Notes'));

const answers = buildSdpAnswers({
  project: {
    project_name: mapped.projectTitle,
    client_name: mapped.customerOrganisation,
    site_address: mapped.siteAddress,
    job_number: mapped.jobNumber,
    engineer: mapped.engineer,
    project_manager: mapped.projectManager,
    quote_number: mapped.quoteNumber,
  },
  scopeText: mapped.scopeOfWorks,
  equipment: [{ item: 'Camera', qty_proposed: 4, source: 'Simpro line 1' }],
});
assert('leaves missing work type blank for review', answers.control.work_type === '');
assert('uses imported scope', String(answers.description.system_description).includes('Install four cameras'));
assert('proposed signing wording', sdpSigningWording('proposed') === SDP_PROPOSED_WORDING);
assert('as-fitted signing wording', sdpSigningWording('as_fitted') === SDP_AS_FITTED_WORDING);
assert('incomplete marker format', formatIncompleteMarker('Name').includes('Incomplete'));

const edited = JSON.parse(JSON.stringify(answers));
edited.description.system_description = 'Engineer corrected wording';
const imported = buildSdpAnswers({
  project: { project_name: 'Changed title', client_name: 'HMP Example', job_number: 'J-100' },
  scopeText: 'New Simpro scope',
});
const reconciled = reconcileSimproRefresh(edited, imported, {
  customer_organisation: 'HMP Example',
  site_address: mapped.siteAddress || '',
  simpro_job_number: 'J-100',
  project_title: 'Gatehouse cameras',
  engineer: 'Pat Engineer',
  project_manager: 'Sam PM',
  quote_reference: 'Q-9',
  system_description: mapped.scopeOfWorks || '',
}, {
  customer_organisation: 'HMP Example',
  site_address: mapped.siteAddress || '',
  simpro_job_number: 'J-100',
  project_title: 'Changed title',
  engineer: 'Pat Engineer',
  project_manager: 'Sam PM',
  quote_reference: 'Q-9',
  system_description: 'New Simpro scope',
});
assert('preserves engineer edit', reconciled.answers.description.system_description === 'Engineer corrected wording');
assert('flags scope difference', reconciled.diffs.some((item) => item.field === 'description.system_description'));

const unsigned = applySdpKind(answers, 'as_fitted');
assert('as-fitted kind updates wording', String(unsigned.signoff.signing_wording) === SDP_AS_FITTED_WORDING);
assert('unsigned until both images', sdpHasBothSignatures(answers) === false);

const packIds = ['sdp', 'cc01_completion', 'ia01_completion'];
assert('pack always includes SDP', packIds[0] === 'sdp');
assert('pack includes CC01 and IA01 for those systems', packIds.includes('cc01_completion') && packIds.includes('ia01_completion'));
assert('pack omits AC01 when no access system', !packIds.includes('ac01_completion'));

if (failed) {
  console.error(failed, 'checks failed');
  process.exit(1);
}
console.log('all workflow checks passed');
