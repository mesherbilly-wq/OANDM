import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const dir = 'public/templates';
for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.pdf'))) {
  const bytes = fs.readFileSync(path.join(dir, name));
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const fields = form.getFields();
  console.log('\n===', name, 'pages=', pdf.getPageCount(), 'fields=', fields.length);
  for (const field of fields.slice(0, 80)) {
    const type = field.constructor.name;
    let extra = '';
    try {
      if (typeof field.getOptions === 'function') extra = ` options=${JSON.stringify(field.getOptions())}`;
    } catch { /* ignore */ }
    console.log(`  ${type}  ${field.getName()}${extra}`);
  }
  if (fields.length > 80) console.log(`  … ${fields.length - 80} more`);
}
