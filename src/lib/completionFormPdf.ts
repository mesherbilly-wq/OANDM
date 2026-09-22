import { jsPDF } from 'jspdf';
import { imageUrlToDataUrl, resolveOmBrand, type ContractorBrand } from './contractorBrand';
import {
  asRecord,
  asRows,
  customerAnswers,
  equipmentTitle,
  isFieldVisible,
  isGroupVisible,
  openDefects,
  testResultOf,
} from './completionFormEngine';
import type {
  CompletionAnswers,
  CompletionField,
  CompletionPhoto,
  CompletionTemplateSchema,
  CompletionTestResult,
} from './completionFormTypes';

const RESULT_LABEL: Record<CompletionTestResult['result'], string> = {
  '': 'Not answered',
  pass: 'Pass',
  fail: 'Fail',
  not_tested: 'Not tested',
  not_applicable: 'Not applicable',
};

function hexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function fieldText(field: CompletionField, value: unknown): string {
  if (field.type === 'note') return '';
  if (field.sensitive) return fieldHasAny(value) ? 'Recorded separately' : '';
  if (field.type === 'test_result') {
    const result = testResultOf(value);
    const label = RESULT_LABEL[result.result];
    return result.reason ? `${label} — ${result.reason}` : label;
  }
  if (field.type === 'declaration') return value === true ? 'Confirmed' : '';
  if (field.type === 'signature') {
    const record = asRecord(value);
    return [record.name, record.role, record.signedAt].filter(Boolean).join(' · ');
  }
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(', ');
  return String(value ?? '').trim();
}

function fieldHasAny(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.values(value).some(item => String(item ?? '').trim());
  return String(value ?? '').trim() !== '';
}

export async function buildCompletionPdf(opts: {
  schema: CompletionTemplateSchema;
  answers: CompletionAnswers;
  photos: CompletionPhoto[];
  brand: ContractorBrand | null;
  jobRef: string;
  documentRef: string;
  revisionNo: number;
  status: string;
  issueDate: string;
  outstandingAuthorised: boolean;
}): Promise<{ fileName: string; pdfBase64: string }> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const theme = resolveOmBrand(opts.brand);
  const [pr, pg, pb] = theme.primaryRgb;
  const [ir, ig, ib] = hexRgb(theme.ink);
  const pageWidth = doc.internal.pageSize.getWidth();
  const answers = customerAnswers(opts.schema, opts.answers);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const logoUrl = theme.logoSrc.startsWith('http') ? theme.logoSrc : `${origin}${theme.logoSrc}`;
  const logo = await imageUrlToDataUrl(logoUrl);

  const footer = () => {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(ir, ig, ib);
      doc.text(`${opts.schema.title}  ·  ${opts.documentRef}  ·  Rev ${opts.revisionNo}  ·  ${opts.status}`, 14, 287);
      doc.text(`Page ${page} of ${pages}`, pageWidth - 14, 287, { align: 'right' });
    }
  };

  let y = 16;
  doc.setFillColor(pr, pg, pb);
  doc.rect(pageWidth - 16, 0, 16, 36, 'F');
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', 14, 10, 58, 15);
    } catch {
      /* optional */
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(pr, pg, pb);
  y = 32;
  doc.text(opts.schema.title.toUpperCase(), 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(ir, ig, ib);
  doc.text(`Project / site: ${opts.jobRef}`, 14, y);
  y += 5;
  doc.text(`Document ${opts.documentRef}   Revision ${opts.revisionNo}   ${opts.status}   ${opts.issueDate}`, 14, y);
  y += 6;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(opts.schema.statusNotice, pageWidth - 28), 14, y);
  y += 16;

  const ensure = (need: number) => {
    if (y + need < 278) return;
    doc.addPage();
    y = 16;
  };

  const heading = (title: string) => {
    ensure(12);
    doc.setFillColor(pr, pg, pb);
    doc.rect(14, y, pageWidth - 28, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(title.toUpperCase(), 16, y + 4.8);
    doc.setTextColor(ir, ig, ib);
    y += 10;
  };

  const kv = (label: string, value: string) => {
    if (!value) return;
    const lines = doc.splitTextToSize(value, pageWidth - 34);
    const height = Math.max(11, 7 + lines.length * 4);
    ensure(height + 2);
    doc.setDrawColor(200, 200, 200);
    doc.rect(14, y, pageWidth - 28, height);
    doc.setFillColor(245, 245, 245);
    doc.rect(14, y, pageWidth - 28, 4.6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(label.toUpperCase(), 16, y + 3.3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(lines, 16, y + 8.2);
    y += height + 1.5;
  };

  const defects = openDefects(opts.answers);
  if (defects.length > 0 || opts.outstandingAuthorised) {
    heading(opts.outstandingAuthorised ? 'Outstanding items accepted at handover' : 'Outstanding items and limitations');
    if (opts.outstandingAuthorised) {
      kv('Authorised handover', 'Office authorised handover with the outstanding items listed below.');
    }
    for (const row of defects) {
      kv(String(row.location || 'Outstanding item'), [row.description, row.status, row.responsible].filter(Boolean).join(' · '));
    }
  }

  for (const section of opts.schema.sections) {
    if (section.id === 'credentials' || section.id === 'engineer') {
      if (section.id === 'engineer') {
        heading('Engineer declaration');
        const record = asRecord(opts.answers.engineer);
        kv('Engineer', [record.name, record.company, record.role].filter(Boolean).join(' · '));
        kv('Signed revision', String(asRecord(record.signature).signedAt || asRecord(record.signature).revisionNo || ''));
        const image = String(asRecord(record.signature).dataUrl || '');
        if (image) {
          ensure(32);
          try {
            doc.addImage(image, 'PNG', 16, y, 60, 22);
            y += 26;
          } catch {
            y += 4;
          }
        }
        kv('Signature type', 'Drawn electronic signature with an audit record. Not a qualified digital signature.');
      }
      continue;
    }
    if (section.id === 'customer') {
      heading('Customer acknowledgement');
      const record = asRecord(opts.answers.customer);
      kv('Customer', [record.name, record.role].filter(Boolean).join(' · '));
      kv('Handover date', String(record.handover_date || ''));
      const image = String(asRecord(record.signature).dataUrl || '');
      if (image) {
        ensure(32);
        try {
          doc.addImage(image, 'PNG', 16, y, 60, 22);
          y += 26;
        } catch {
          y += 4;
        }
      }
      continue;
    }
    const record = asRecord(section.id === 'job' || section.customerVisible ? answers[section.id] ?? opts.answers[section.id] : opts.answers[section.id]);
    heading(section.title);
    for (const field of section.fields ?? []) {
      if (field.type === 'note' || field.sensitive || !isFieldVisible(field, record, record)) continue;
      if (field.type === 'photo') {
        const photos = opts.photos.filter(photo => photo.fieldPath === `${section.id}.${field.id}` && photo.status === 'ready');
        if (photos.length === 0) continue;
        kv(field.label, `${photos.length} photograph${photos.length === 1 ? '' : 's'}`);
        for (const photo of photos) {
          if (!photo.signedUrl) continue;
          const dataUrl = await imageUrlToDataUrl(photo.signedUrl);
          if (!dataUrl) continue;
          ensure(62);
          try {
            doc.addImage(dataUrl, 'JPEG', 16, y, 80, 50);
            y += 52;
            if (photo.caption) {
              doc.setFontSize(8);
              doc.text(photo.caption, 16, y);
              y += 5;
            }
          } catch {
            y += 4;
          }
        }
        continue;
      }
      kv(field.label, fieldText(field, record[field.id]));
    }
    for (const group of section.groups ?? []) {
      if (!isGroupVisible(group, record)) continue;
      const rows = asRows(record[group.id]);
      if (rows.length === 0) continue;
      ensure(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(group.title, 14, y);
      y += 5;
      rows.forEach((row, index) => {
        kv(equipmentTitle(group, row, index), group.fields
          .filter(field => !field.sensitive && field.type !== 'note' && isFieldVisible(field, row, record))
          .map(field => {
            const text = fieldText(field, row[field.id]);
            return text ? `${field.label}: ${text}` : '';
          })
          .filter(Boolean)
          .join('  |  '));
      });
    }
  }

  footer();
  const fileName = `Pacific_CCTV_Completion_R${opts.revisionNo}_${opts.documentRef.replace(/[^\w]+/g, '_')}.pdf`;
  const dataUri = doc.output('datauristring') as string;
  return { fileName, pdfBase64: dataUri.split(',')[1] ?? '' };
}
