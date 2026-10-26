import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { reconcileDeviceLines, type ExtractedDeviceLine } from '../src/lib/aiImport/reconcile.ts';
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

console.log('ai import checks passed');
console.log('pdf text:', text);
