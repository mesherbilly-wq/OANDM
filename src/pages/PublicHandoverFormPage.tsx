import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { CheckCircle, Loader2 } from 'lucide-react';
import { SignaturePad } from '../components/SignaturePad';
import { SchemaForm } from '../components/SchemaForm';
import { FormLetterhead, WorksheetField } from '../components/FormLetterhead';
import { fetchPublicContractorBrand, formatContractorAddress, formatContractorContact, imageUrlToDataUrl, type ContractorBrand } from '../lib/contractorBrand';
import { getPublicHandoverForm, saveHandoverFormDraft, submitPublicHandoverForm } from '../lib/handoverFormsApi';
import { getHandoverFormTemplate, type HandoverFormField } from '../lib/handoverFormTemplates';
import {
  INTRUDER_ALARM_FORM_KEY,
  INTRUDER_ALARM_SCHEMA,
  applySchemaPrefill,
  flattenAnswersForPdf,
  mergeSavedAnswers,
  primarySignatureDataUrl,
  primarySignerName,
  validateSchemaAnswers,
  type FormAnswers,
} from '../lib/schemaForm';

const worksheetInputClass = 'w-full border-0 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-GB');
}

function defaultAnswers(fields: HandoverFormField[], prefill: Record<string, string>): Record<string, string | boolean> {
  const answers: Record<string, string | boolean> = {};
  for (const field of fields) {
    if (field.type === 'checkbox') {
      answers[field.key] = false;
    } else if (field.type === 'date') {
      answers[field.key] = prefill[field.key] || todayIso();
    } else {
      answers[field.key] = prefill[field.key] ?? '';
    }
  }
  return answers;
}

function jobRefFromAnswers(
  prefill: Record<string, string>,
  simpleAnswers: Record<string, string | boolean>,
  schemaAnswers: FormAnswers,
): string {
  const schemaSite = schemaAnswers.site && typeof schemaAnswers.site === 'object' && !Array.isArray(schemaAnswers.site)
    ? schemaAnswers.site as Record<string, unknown>
    : {};
  return String(
    simpleAnswers.job_number
    || prefill.job_number
    || schemaSite.job_number
    || simpleAnswers.site_name
    || prefill.site_name
    || schemaSite.site_name
    || prefill.project_name
    || '',
  );
}

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
  const company = brand?.company_name?.trim() || 'O&M Builder';
  const address = formatContractorAddress(brand);
  const contact = formatContractorContact(brand);

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, pdfImageFormat(logoDataUrl), 14, 10, 28, 16);
    } catch {
      /* logo optional */
    }
  }

  const textX = logoDataUrl ? 46 : 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(company, textX, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  let infoY = 21;
  if (address) {
    const lines = doc.splitTextToSize(address, 90);
    doc.text(lines, textX, infoY);
    infoY += lines.length * 3.2;
  }
  if (contact) {
    doc.text(contact, textX, infoY);
  }

  if (jobRef) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('JOB / SITE REF', pageWidth - 14, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(jobRef, pageWidth - 14, 19, { align: 'right' });
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('DATE', pageWidth - 14, 25, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(todayLabel(), pageWidth - 14, 30, { align: 'right' });

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 34, pageWidth, 16, 'F');
  doc.setTextColor(226, 232, 240);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('COMPLETION RECORD', 14, 40);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  const titleLines = doc.splitTextToSize(title.toUpperCase(), pageWidth - 28);
  doc.text(titleLines, 14, 46);
  doc.setTextColor(15, 23, 42);
  return 56;
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
      doc.setFillColor(15, 23, 42);
      doc.rect(14, y, pageWidth - 28, 7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(line.label.toUpperCase(), 16, y + 4.8);
      doc.setTextColor(15, 23, 42);
      y += 9;
      continue;
    }
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.3);
    const valueLines = doc.splitTextToSize(line.value || '—', pageWidth - 34);
    const boxHeight = Math.max(12, 6 + valueLines.length * 4.2);
    doc.rect(14, y, pageWidth - 28, boxHeight);
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, pageWidth - 28, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
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

async function buildSignedPdf(opts: {
  title: string;
  brand: ContractorBrand | null;
  fields?: HandoverFormField[];
  answers: Record<string, unknown>;
  signerName: string;
  signatureDataUrl: string;
  schema?: boolean;
  jobRef?: string;
}): Promise<{ fileName: string; pdfBase64: string }> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logoDataUrl = opts.brand?.logo_url ? await imageUrlToDataUrl(opts.brand.logo_url) : null;
  let y = drawLetterhead(doc, opts.brand, logoDataUrl, opts.title, opts.jobRef ?? '');

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Complete all applicable sections. Use N/A where appropriate.', 14, y);
  y += 6;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  if (opts.schema) {
    y = addPdfLines(doc, flattenAnswersForPdf(INTRUDER_ALARM_SCHEMA, opts.answers as FormAnswers), y);
  } else {
    y = addPdfLines(
      doc,
      (opts.fields ?? []).map(field => {
        const raw = opts.answers[field.key];
        const value = typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw ?? '').trim() || '—';
        return { label: field.label, value };
      }),
      y,
    );
  }

  if (y > 220) {
    doc.addPage();
    y = 16;
  }
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42);
  doc.rect(14, y, pageWidth - 28, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('LEAD ENGINEER / SIGN-OFF', 16, y + 4.8);
  doc.setTextColor(15, 23, 42);
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(opts.signerName, 16, y);
  y += 4;
  try {
    if (opts.signatureDataUrl) doc.addImage(opts.signatureDataUrl, 'PNG', 16, y, 80, 28);
  } catch {
    doc.text('(Signature captured)', 16, y + 8);
  }

  const fileName = `${opts.title.replace(/[^\w]+/g, '_')}_${Date.now()}.pdf`;
  const dataUri = doc.output('datauristring') as string;
  return { fileName, pdfBase64: dataUri.split(',')[1] ?? '' };
}

export default function PublicHandoverFormPage() {
  const { token = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [alreadyComplete, setAlreadyComplete] = useState(false);
  const [documentTitle, setDocumentTitle] = useState('');
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [brand, setBrand] = useState<ContractorBrand | null>(null);
  const [prefill, setPrefill] = useState<Record<string, string>>({});
  const [templateKey, setTemplateKey] = useState('handover_certificate');
  const [simpleAnswers, setSimpleAnswers] = useState<Record<string, string | boolean>>({});
  const [schemaAnswers, setSchemaAnswers] = useState<FormAnswers>({});
  const [signature, setSignature] = useState('');

  const template = useMemo(() => getHandoverFormTemplate(templateKey), [templateKey]);
  const isSchemaForm = templateKey === INTRUDER_ALARM_FORM_KEY;
  const displayBrand: ContractorBrand = brand ?? {
    company_name: companyName,
    logo_url: null,
    address_line1: null,
    address_line2: null,
    city: null,
    postcode: null,
    telephone: null,
    email: null,
    website: null,
    nsi_number: null,
    ssaib_number: null,
  };
  const jobRef = jobRefFromAnswers(prefill, simpleAnswers, schemaAnswers);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [form, contractor] = await Promise.all([
          getPublicHandoverForm(token),
          fetchPublicContractorBrand(),
        ]);
        if (cancelled) return;
        setBrand(contractor);
        if (form.status === 'completed') {
          setAlreadyComplete(true);
          setDocumentTitle(form.document_title);
          setCompanyName(form.company_name);
          return;
        }
        setDocumentTitle(form.document_title);
        setCompanyName(form.company_name);
        setTemplateKey(form.form_template_key);
        setPrefill(form.prefill ?? {});
        if (form.form_template_key === INTRUDER_ALARM_FORM_KEY) {
          setSchemaAnswers(mergeSavedAnswers(applySchemaPrefill(form.prefill ?? {}, form.company_name), form.answers));
        } else {
          const tmpl = getHandoverFormTemplate(form.form_template_key);
          setSimpleAnswers(defaultAnswers(tmpl.fields, form.prefill ?? {}));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'This form link is not valid.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const updateField = (key: string, value: string | boolean) => {
    setSimpleAnswers(current => ({ ...current, [key]: value }));
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    setError(null);
    try {
      await saveHandoverFormDraft(token, isSchemaForm ? schemaAnswers : simpleAnswers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save draft.');
    } finally {
      setSavingDraft(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (isSchemaForm) {
      const schemaError = validateSchemaAnswers(INTRUDER_ALARM_SCHEMA, schemaAnswers);
      if (schemaError) {
        setError(schemaError);
        return;
      }
      const signerName = primarySignerName(schemaAnswers);
      const signatureDataUrl = primarySignatureDataUrl(schemaAnswers) || signature;
      if (!signerName || !signatureDataUrl) {
        setError('Complete the engineer declaration signature before submitting.');
        return;
      }
      setSubmitting(true);
      try {
        const pdf = await buildSignedPdf({
          title: documentTitle,
          brand: displayBrand,
          answers: schemaAnswers,
          signerName,
          signatureDataUrl,
          schema: true,
          jobRef,
        });
        await submitPublicHandoverForm({
          token,
          answers: schemaAnswers,
          signer_name: signerName,
          signature_data_url: signatureDataUrl,
          pdf_base64: pdf.pdfBase64,
          file_name: pdf.fileName,
        });
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not submit the form.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    for (const field of template.fields) {
      if (!field.required) continue;
      const value = simpleAnswers[field.key];
      if (field.type === 'checkbox' && value !== true) {
        setError(`Please confirm: ${field.label}`);
        return;
      }
      if (field.type !== 'checkbox' && !String(value ?? '').trim()) {
        setError(`${field.label} is required.`);
        return;
      }
    }
    if (!signature) {
      setError('Please sign the form before submitting.');
      return;
    }
    const signerName = String(simpleAnswers.signer_name ?? '').trim();
    if (!signerName) {
      setError('Please enter the name of the person signing.');
      return;
    }

    setSubmitting(true);
    try {
      const pdf = await buildSignedPdf({
        title: documentTitle,
        brand: displayBrand,
        fields: template.fields,
        answers: simpleAnswers,
        signerName,
        signatureDataUrl: signature,
        jobRef,
      });
      await submitPublicHandoverForm({
        token,
        answers: simpleAnswers,
        signer_name: signerName,
        signature_data_url: signature,
        pdf_base64: pdf.pdfBase64,
        file_name: pdf.fileName,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the form.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-400 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-800" />
      </div>
    );
  }

  if (alreadyComplete || done) {
    return (
      <div className="min-h-screen bg-slate-400 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border-2 border-slate-900 shadow-xl p-8 text-center space-y-3">
          <CheckCircle className="w-10 h-10 text-emerald-600 mx-auto" />
          <h1 className="text-xl font-semibold text-slate-900">
            {alreadyComplete ? 'This form is already complete' : 'Form submitted'}
          </h1>
          <p className="text-sm text-slate-600">
            {documentTitle} has been signed and saved into the project documents.
          </p>
        </div>
      </div>
    );
  }

  if (error && !documentTitle) {
    return (
      <div className="min-h-screen bg-slate-400 flex items-center justify-center p-6">
        <p className="max-w-md text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-400 py-6 sm:py-10">
      <div className="max-w-[210mm] mx-auto px-3 sm:px-4">
        <div className="bg-white border-2 border-slate-900 shadow-2xl overflow-hidden">
          <FormLetterhead
            brand={displayBrand}
            title={documentTitle}
            subtitle={isSchemaForm ? INTRUDER_ALARM_SCHEMA.title : template.description}
            jobRef={jobRef}
            dateLabel={todayLabel()}
          />

          <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
            <p className="text-xs text-slate-600 border border-slate-800 bg-slate-50 px-3 py-2">
              Complete all applicable sections. Use N/A where appropriate. Tick boxes and add brief details.
            </p>
            {isSchemaForm && (
              <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-300 px-3 py-2">
                {INTRUDER_ALARM_SCHEMA.status}. This is not an official NSI certificate.
              </p>
            )}

            {isSchemaForm ? (
              <SchemaForm schema={INTRUDER_ALARM_SCHEMA} answers={schemaAnswers} onChange={setSchemaAnswers} />
            ) : (
              <>
                {template.fields.map(field => (
                  <WorksheetField key={field.key} label={field.label} required={field.required}>
                    {field.type === 'textarea' ? (
                      <textarea
                        value={String(simpleAnswers[field.key] ?? '')}
                        onChange={event => updateField(field.key, event.target.value)}
                        rows={3}
                        className={worksheetInputClass}
                      />
                    ) : field.type === 'select' ? (
                      <select
                        value={String(simpleAnswers[field.key] ?? '')}
                        onChange={event => updateField(field.key, event.target.value)}
                        className={`${worksheetInputClass} bg-white`}
                      >
                        <option value="">Choose…</option>
                        {(field.options ?? []).map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : field.type === 'checkbox' ? (
                      <span className="flex items-center gap-2 text-sm text-slate-700 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={simpleAnswers[field.key] === true}
                          onChange={event => updateField(field.key, event.target.checked)}
                        />
                        Yes / confirmed
                      </span>
                    ) : (
                      <input
                        type={field.type}
                        value={String(simpleAnswers[field.key] ?? '')}
                        onChange={event => updateField(field.key, event.target.value)}
                        className={worksheetInputClass}
                      />
                    )}
                  </WorksheetField>
                ))}
                <section className="border-2 border-slate-900 overflow-hidden">
                  <h2 className="bg-slate-900 text-white text-xs font-bold uppercase tracking-wider px-3 py-2">
                    Lead engineer / sign-off
                  </h2>
                  <div className="p-3 space-y-2">
                    <p className="text-xs text-slate-600">
                      I confirm this is an accurate record. Sign below to complete and save this form into the project documents.
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-700">Signature *</p>
                    <SignaturePad value={signature} onChange={setSignature} />
                  </div>
                </section>
              </>
            )}

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2">{error}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={savingDraft || submitting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-slate-900 text-slate-800 font-semibold uppercase tracking-wide text-sm disabled:opacity-50"
              >
                {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save draft
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 text-white font-semibold uppercase tracking-wide text-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {submitting ? 'Saving…' : 'Complete and save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
