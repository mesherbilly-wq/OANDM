import { PDFDocument, PDFCheckBox, PDFDropdown, PDFTextField, PDFSignature } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const file = process.argv[2] || 'public/templates/Pacific_Intruder_Alarm_Handover_Simplified_Rev01.pdf';
const bytes = fs.readFileSync(file);
const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
const form = pdf.getForm();
for (const field of form.getFields()) {
  const acro = field.acroField;
  const alt = acro.getDefaultAppearance?.() ?? '';
  const kids = acro.getWidgets?.() ?? [];
  const widget = kids[0];
  const rect = widget?.getRectangle?.();
  let kind = field.constructor.name;
  let extra = '';
  if (field instanceof PDFDropdown) extra = ` dd=${JSON.stringify(field.getOptions())}`;
  if (field instanceof PDFCheckBox) extra = ' checkbox';
  if (field instanceof PDFTextField) extra = ` maxlen=${field.getMaxLength() ?? ''} multiline=${field.isMultiline()}`;
  if (field instanceof PDFSignature) extra = ' signature';
  const page = widget ? pdf.getPages().findIndex((p) => {
    try { return widget.P() === p.ref || widget.dict.lookupMaybe('P') === p.ref; } catch { return false; }
  }) : -1;
  console.log(`${field.getName()}\t${kind}\tpage~${page}\t${rect ? `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}` : ''}${extra}`);
}
