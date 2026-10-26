import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { normalizeAiExtract } from '../src/integrations/connectors/aiDocuments/normalizeAiExtract.ts';
import { countCameraSymbols } from '../src/lib/aiImport/countSymbols.ts';
import { reconcileDeviceLines, type ExtractedDeviceLine } from '../src/lib/aiImport/reconcile.ts';
import { parseDrawingFacts, resolveDrawingExtraction, transcriptFromPdf, type PdfAnnotation, type PdfTextItem } from '../src/lib/aiImport/resolveDrawing.ts';
import { verifyExtractedEvidence } from '../src/lib/aiImport/verifyEvidence.ts';

function line(partial: Partial<ExtractedDeviceLine> & Pick<ExtractedDeviceLine, 'quantity'>): ExtractedDeviceLine {
  return {
    systemType: 'CCTV',
    deviceType: 'Dome camera',
    manufacturer: null,
    modelNumber: null,
    modelName: 'Dome camera',
    location: 'Car park',
    notes: null,
    quantityBasis: 'counted',
    evidenceClass: 'proposed',
    viewKind: 'detail',
    sourceFile: 'drawing.pdf',
    sourcePage: 1,
    evidenceText: null,
    confidence: 0.8,
    ...partial,
  };
}

const scheduleAndOverview = reconcileDeviceLines([
  line({ quantity: 8, quantityBasis: 'stated', viewKind: 'schedule', sourceFile: 'schedule.pdf', sourcePage: 2, evidenceText: '8 dome cameras' }),
  line({ quantity: 12, quantityBasis: 'counted', viewKind: 'overview', sourceFile: 'drawing.pdf', sourcePage: 1 }),
]);
assert.equal(scheduleAndOverview.devices.length, 1);
assert.equal(scheduleAndOverview.devices[0].quantity, 8);
assert.match(scheduleAndOverview.devices[0].conflict ?? '', /does not match/);

const overviewNotAdded = reconcileDeviceLines([
  line({ quantity: 2, viewKind: 'detail', sourcePage: 2 }),
  line({ quantity: 2, viewKind: 'detail', sourcePage: 2 }),
  line({ quantity: 6, viewKind: 'overview', sourcePage: 1 }),
]);
assert.equal(overviewNotAdded.devices.length, 1);
assert.equal(overviewNotAdded.devices[0].quantity, 4);
assert.match(overviewNotAdded.devices[0].conflict ?? '', /not added/);

const quoted = reconcileDeviceLines([
  line({ quantity: 10, evidenceClass: 'quoted', quantityBasis: 'stated', viewKind: 'schedule', sourceFile: 'quote.pdf' }),
]);
assert.equal(quoted.devices[0].evidenceClass, 'quoted');
assert.equal(quoted.issues.some(issue => /not confirmed installed/.test(issue)), true);

const revisions = reconcileDeviceLines([
  line({ quantity: 4, viewKind: 'revision', sourceFile: 'revA.pdf', sourcePage: 1 }),
  line({ quantity: 6, viewKind: 'revision', sourceFile: 'revB.pdf', sourcePage: 1 }),
]);
assert.equal(revisions.devices.length, 1);
assert.match(revisions.devices[0].conflict ?? '', /were not added together/);

const verified = verifyExtractedEvidence({
  devices: [{ device_type: 'Dome camera', manufacturer: 'Hikvision', model_number: 'DS-2CD2347', quantity: 4 }],
}, 'Schedule: 4 dome cameras in the car park');
assert.equal(verified.devices?.[0].model_number, null);
assert.equal(verified.devices?.[0].manufacturer, null);

const kept = verifyExtractedEvidence({
  devices: [{ device_type: 'Dome camera', manufacturer: 'Hikvision', model_number: 'DS-2CD2347', quantity: 4 }],
}, 'Hikvision DS-2CD2347 dome camera quantity 4');
assert.equal(kept.devices?.[0].model_number, 'DS-2CD2347');

const pdf = await PDFDocument.create();
const page = pdf.addPage();
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText('CCTV dome camera quantity 4 car park', { x: 40, y: 100, size: 12, font });
const bytes = await pdf.save();
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const loaded = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
const textPage = await loaded.getPage(1);
const content = await textPage.getTextContent();
const text = content.items.map((item: { str?: string }) => item.str ?? '').join(' ');
assert.match(text, /dome camera quantity 4/i);

const peckhamPath = 'C:/Users/Bill/Downloads/2026.10.01 - Bright Horizons - Peckham Rye CCTV Layout - Martin.pdf';
const peckhamBytes = new Uint8Array(fs.readFileSync(peckhamPath));
const peckhamPdf = await pdfjs.getDocument({ data: peckhamBytes, disableWorker: true }).promise;
const peckhamPage = await peckhamPdf.getPage(1);
const peckhamContent = await peckhamPage.getTextContent();
const peckhamAnnotations = await peckhamPage.getAnnotations() as PdfAnnotation[];
const peckhamText = transcriptFromPdf(peckhamContent.items as PdfTextItem[], peckhamAnnotations);
const peckhamFacts = parseDrawingFacts(peckhamText);
const peckhamSymbols = await countCameraSymbols(peckhamPage);
const failedModel = {
  project_name: 'Briggs Fire & Security Ltd',
  client_name: 'Briggs Fire & Security Ltd',
  devices: [
    { system_type: 'CCTV', device_type: 'Bullet Camera', manufacturer: 'Verkada', model_name: 'Bullet Camera', quantity: 1, evidence_class: 'installed' },
    { system_type: 'CCTV', device_type: 'Dome Camera', manufacturer: 'Verkada', model_name: 'Dome Camera', quantity: 1, evidence_class: 'installed' },
  ],
};
const peckhamResolved = resolveDrawingExtraction({
  fileName: '2026.10.01 - Bright Horizons - Peckham Rye CCTV Layout - Martin.pdf',
  text: peckhamText,
  symbols: peckhamSymbols,
  model: failedModel,
});
const peckhamDraft = normalizeAiExtract(peckhamResolved, { connectorId: 'ai_drawings' });
const peckhamEquipment = peckhamDraft.systems.flatMap(system => system.equipment);

assert.equal(peckhamFacts.statedCameraTotal, 21);
assert.equal(peckhamFacts.siteName, 'Peckham Rye');
assert.match(peckhamFacts.siteAddress ?? '', /24 Waveney Ave, London, SE15 3UE/);
assert.equal(peckhamFacts.fields.cable, 'CAT6');
assert.equal(peckhamFacts.fields.cameraManufacturer, 'Verkada');
assert.match(peckhamFacts.fields.cameraTypes ?? '', /Bullet \(External\), Dome \(Internal\)/);
assert.equal(peckhamFacts.fields.videoSoftware, 'Verkada Command');
assert.equal(peckhamFacts.fields.powerMethod, 'PoE');
assert.match(peckhamFacts.fields.powerSource ?? '', /Local server rack/);
assert.match(peckhamFacts.fields.recorderLocation ?? '', /Main office/);
assert.match(peckhamFacts.fields.storage ?? '', /Camera SD cards/);
assert.match(peckhamFacts.fields.retention ?? '', /30 days/);
assert.equal(peckhamFacts.fields.clientSwitch, 'Yes');
assert.equal(peckhamFacts.fields.ipCctv, 'Yes');
assert.match(peckhamFacts.fields.coverage ?? '', /Child accessible areas/);
assert.equal(peckhamFacts.fields.drawingDate, '30/09/2026');
assert.equal(peckhamFacts.fields.scale, 'NTS');
assert.equal(peckhamFacts.fields.drawnBy, 'MP');
assert.equal(peckhamFacts.fields.checkedBy, 'VB');
assert.equal(peckhamFacts.drawingAuthor, 'Briggs Fire & Security Ltd');
assert.equal(peckhamFacts.proposedDesign, true);
assert.equal(peckhamSymbols.internalDome, 21);
assert.equal(peckhamSymbols.externalBullet, 2);
assert.equal(peckhamSymbols.externalDome, 8);
assert.equal(peckhamSymbols.countedTotal, 31);
assert.ok((peckhamSymbols.legendExcluded ?? 0) >= 1);

assert.equal(peckhamResolved.quantity_summary?.statedTotal, 21);
assert.equal(peckhamResolved.quantity_summary?.countedTotal, 31);
assert.equal(peckhamEquipment.length, 3);
assert.deepEqual(peckhamEquipment.map(item => item.quantity).sort((a, b) => a - b), [2, 8, 21]);
assert.equal(peckhamEquipment.some(item => item.quantity === 1), false);
assert.equal(peckhamEquipment.reduce((sum, item) => sum + item.quantity, 0), 31);
assert.equal(peckhamEquipment.every(item => item.metadata.evidenceClass === 'proposed'), true);
assert.equal(peckhamEquipment.every(item => !item.modelNumber), true);
assert.equal(peckhamDraft.project.clientName, null);
assert.equal(/briggs/i.test(peckhamDraft.project.clientName ?? ''), false);
assert.equal(peckhamDraft.project.mainContractor, null);
assert.equal(peckhamDraft.project.siteName, 'Peckham Rye');
assert.match(peckhamDraft.project.projectNotes ?? '', /CAT6/);
assert.match(peckhamDraft.project.projectNotes ?? '', /Verkada Command/);
assert.match(peckhamDraft.project.projectNotes ?? '', /30 days/);
assert.match(peckhamDraft.project.projectNotes ?? '', /not installed/i);
assert.match(peckhamDraft.project.projectNotes ?? '', /drawing author/i);
assert.equal(peckhamDraft.issues.some(issue => issue.code === 'ai.quantity' && /Stated camera total: 21/.test(issue.message) && /Counted drawing total: 31/.test(issue.message)), true);
assert.equal(peckhamDraft.issues.some(issue => issue.code === 'ai.product_lookup'), true);
assert.match(peckhamDraft.issues.find(issue => issue.code === 'ai.section.installation')?.message ?? '', /CAT6/);
assert.match(peckhamDraft.issues.find(issue => issue.code === 'ai.section.operating')?.message ?? '', /Verkada Command/);
const savedDevices = peckhamEquipment.filter(item => item.selected && item.metadata.quantityUnstated !== true);
assert.equal(savedDevices.reduce((sum, item) => sum + item.quantity, 0), 31);
assert.equal(savedDevices.every(item => item.metadata.evidenceClass !== 'installed'), true);

const unresolved = resolveDrawingExtraction({
  fileName: 'schedule.pdf',
  text: 'CCTV DESIGN PROPOSAL\nSite Address:\nPeckham Rye\nnumber of cameras: 21\nCamera types: Bullet (External), Dome (Internal)',
  symbols: null,
  model: failedModel,
});
assert.equal(unresolved.devices?.length, 1);
assert.equal(unresolved.devices?.[0].quantity, 21);
assert.match(unresolved.devices?.[0].notes ?? '', /21 cameras stated; bullet\/dome quantities require review/);
assert.equal(unresolved.devices?.some(device => device.quantity === 1), false);

console.log('ai import checks passed');
console.log('pdf text:', text);
console.log('peckham draft', JSON.stringify({
  project: peckhamDraft.project,
  equipment: peckhamEquipment.map(item => ({
    name: item.modelName,
    quantity: item.quantity,
    evidence: item.metadata.evidenceClass,
    basis: item.metadata.quantityBasis,
    part: item.modelNumber,
    evidenceText: item.metadata.evidenceText,
  })),
  quantity: peckhamDraft.issues.find(issue => issue.code === 'ai.quantity')?.message,
  symbols: peckhamSymbols,
}, null, 2));
