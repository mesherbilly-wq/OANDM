import { jsPDF } from 'jspdf';
import { formatContractorAddress, formatContractorContact, imageUrlToDataUrl, resolveOmBrand, type ContractorBrand } from './contractorBrand';
import { flattenAnswersForPdf, type FormAnswers, type SchemaCatalogue } from './schemaForm';
import { supabase } from './supabase';

export const SIGNATURE_IMAGE_NOTICE =
  'Signatures on this document are drawn images bound to this revision. They are not verified digital signatures.';

function pdfImageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return /image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG';
}

function drawLetterhead(
  doc: jsPDF,
  brand: ContractorBrand | null,
  logoDataUrl: string | null,
  title: string,
  jobRef: string,
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const address = formatContractorAddress(brand);
  const contact = formatContractorContact(brand);
  const theme = resolveOmBrand(brand);
  const [pr, pg, pb] = theme.primaryRgb;
  const [ir, ig, ib] = theme.inkRgb;

  doc.setFillColor(pr, pg, pb);
  doc.rect(pageWidth - 18, 0, 18, 42, 'F');
  doc.circle(pageWidth - 24, 12, 1.4, 'F');
  doc.circle(pageWidth - 24, 17, 1.4, 'F');
  doc.circle(pageWidth - 24, 22, 1.4, 'F');

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, pdfImageFormat(logoDataUrl), 14, 10, 62, 16);
    } catch {
      /* logo optional */
    }
  }

  const textX = 14;
  let infoY = logoDataUrl ? 30 : 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(pr, pg, pb);
  doc.text(theme.tagline.toUpperCase(), textX, infoY);
  infoY += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(ir, ig, ib);
  if (address) {
    const lines = doc.splitTextToSize(address, 120);
    doc.text(lines, textX, infoY);
    infoY += lines.length * 3.2;
  }
  if (contact) {
    doc.text(contact, textX, infoY);
    infoY += 4;
  }

  if (jobRef) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(pr, pg, pb);
    doc.text('JOB / SITE REF', pageWidth - 22, 12, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(ir, ig, ib);
    const jobLines = doc.splitTextToSize(jobRef, 40);
    doc.text(jobLines, pageWidth - 22, 17, { align: 'right' });
  }

  infoY = Math.max(infoY, 36);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(pr, pg, pb);
  const titleLines = doc.splitTextToSize(title.toUpperCase(), pageWidth - 40);
  doc.text(titleLines, 14, infoY + 4);
  doc.setTextColor(ir, ig, ib);
  return infoY + 4 + titleLines.length * 6 + 4;
}

function addPdfLines(doc: jsPDF, lines: { label: string; value: string; image?: string }[], startY: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = startY;
  for (const line of lines) {
    if (y > 262) {
      doc.addPage();
      y = 16;
    }
    if (!line.value) {
      doc.setFillColor(192, 0, 0);
      doc.rect(14, y, pageWidth - 28, 7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(line.label.toUpperCase(), 16, y + 4.8);
      doc.setTextColor(64, 64, 64);
      y += 9;
      continue;
    }
    doc.setDrawColor(64, 64, 64);
    doc.setLineWidth(0.3);
    const valueLines = doc.splitTextToSize(line.value || '—', pageWidth - 34);
    const boxHeight = Math.max(12, 6 + valueLines.length * 4.2);
    doc.rect(14, y, pageWidth - 28, boxHeight);
    doc.setFillColor(217, 217, 217);
    doc.rect(14, y, pageWidth - 28, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(64, 64, 64);
    doc.text(line.label.toUpperCase(), 16, y + 3.6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(valueLines, 16, y + 9);
    y += boxHeight + 2;
    if (line.image) {
      if (y > 230) {
        doc.addPage();
        y = 16;
      }
      try {
        doc.addImage(line.image, pdfImageFormat(line.image), 16, y, 70, 24);
        y += 28;
      } catch {
        y += 4;
      }
    }
  }
  return y;
}

export async function buildPacificPdf(opts: {
  title: string;
  brand: ContractorBrand | null;
  answers: Record<string, unknown>;
  schema?: SchemaCatalogue | null;
  lines?: { label: string; value: string; image?: string }[];
  jobRef?: string;
  notice?: string;
}): Promise<{ fileName: string; pdfBase64: string; dataUri: string }> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const theme = resolveOmBrand(opts.brand);
  const logoUrl = theme.logoSrc.startsWith('http') ? theme.logoSrc : origin ? `${origin}${theme.logoSrc}` : theme.logoSrc;
  const logoDataUrl = await imageUrlToDataUrl(logoUrl);
  let y = drawLetterhead(doc, opts.brand, logoDataUrl, opts.title, opts.jobRef ?? '');

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(opts.notice || 'Complete all applicable sections. Use N/A where appropriate.', 14, y);
  y += 6;
  doc.setTextColor(15, 23, 42);

  if (opts.schema) {
    y = addPdfLines(doc, flattenAnswersForPdf(opts.schema, opts.answers as FormAnswers), y);
  } else if (opts.lines) {
    y = addPdfLines(doc, opts.lines, y);
  }

  if (y > 270) {
    doc.addPage();
    y = 16;
  }
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  const noticeLines = doc.splitTextToSize(SIGNATURE_IMAGE_NOTICE, doc.internal.pageSize.getWidth() - 28);
  doc.text(noticeLines, 14, y + 4);

  const fileName = `${opts.title.replace(/[^\w]+/g, '_')}_${Date.now()}.pdf`;
  const dataUri = doc.output('datauristring') as string;
  return { fileName, pdfBase64: dataUri.split(',')[1] ?? '', dataUri };
}

export async function uploadProjectPdf(opts: {
  projectId: number;
  folder: string;
  fileName: string;
  pdfBase64: string;
}): Promise<string> {
  const raw = opts.pdfBase64.includes(',') ? opts.pdfBase64.split(',').pop()! : opts.pdfBase64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const file = new Blob([bytes], { type: 'application/pdf' });
  const path = `${opts.folder}/${opts.projectId}/${opts.fileName}`;
  const { error } = await supabase.storage.from('om-uploads').upload(path, file, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(`Could not save PDF: ${error.message}`);
  return supabase.storage.from('om-uploads').getPublicUrl(path).data.publicUrl;
}

export function jobRefFromProject(project: {
  job_number?: string | null;
  site_name?: string | null;
  project_name?: string | null;
}): string {
  return project.job_number || project.site_name || project.project_name || '';
}
