import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { CheckCircle, Loader2, Shield } from 'lucide-react';
import { SignaturePad } from '../components/SignaturePad';
import { SchemaForm } from '../components/SchemaForm';
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

function addPdfLines(doc: jsPDF, lines: { label: string; value: string; image?: string }[], startY = 18): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = startY;
  for (const line of lines) {
    if (y > 250) {
      doc.addPage();
      y = 18;
    }
    if (!line.value) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(line.label, 14, y);
      y += 8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      continue;
    }
    const block = doc.splitTextToSize(`${line.label}: ${line.value}`, pageWidth - 28);
    doc.text(block, 14, y);
    y += block.length * 5 + 2;
    if (line.image) {
      if (y > 220) {
        doc.addPage();
        y = 18;
      }
      try {
        doc.addImage(line.image, 'PNG', 14, y, 70, 24);
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
  companyName: string | null;
  fields?: HandoverFormField[];
  answers: Record<string, unknown>;
  signerName: string;
  signatureDataUrl: string;
  schema?: boolean;
}): Promise<{ fileName: string; pdfBase64: string }> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(opts.companyName || 'O&M Builder', 14, y);
  y += 8;
  doc.setFontSize(13);
  doc.text(opts.title, 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('DRAFT — NOT VALIDATED FOR NSI COMPLIANCE', 14, y);
  doc.setTextColor(15);
  y += 8;
  doc.setFontSize(10);
  doc.text(`Completed ${new Date().toLocaleString('en-GB')}`, 14, y);
  y += 10;

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
    y = 18;
  }
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Primary signature', 14, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.text(opts.signerName, 14, y);
  y += 4;
  try {
    if (opts.signatureDataUrl) doc.addImage(opts.signatureDataUrl, 'PNG', 14, y, 80, 28);
  } catch {
    doc.text('(Signature captured)', 14, y + 8);
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
  const [templateKey, setTemplateKey] = useState('handover_certificate');
  const [simpleAnswers, setSimpleAnswers] = useState<Record<string, string | boolean>>({});
  const [schemaAnswers, setSchemaAnswers] = useState<FormAnswers>({});
  const [signature, setSignature] = useState('');

  const template = useMemo(() => getHandoverFormTemplate(templateKey), [templateKey]);
  const isSchemaForm = templateKey === INTRUDER_ALARM_FORM_KEY;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const form = await getPublicHandoverForm(token);
        if (cancelled) return;
        if (form.status === 'completed') {
          setAlreadyComplete(true);
          setDocumentTitle(form.document_title);
          setCompanyName(form.company_name);
          return;
        }
        setDocumentTitle(form.document_title);
        setCompanyName(form.company_name);
        setTemplateKey(form.form_template_key);
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
          companyName,
          answers: schemaAnswers,
          signerName,
          signatureDataUrl,
          schema: true,
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
        companyName,
        fields: template.fields,
        answers: simpleAnswers,
        signerName,
        signatureDataUrl: signature,
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
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  if (alreadyComplete || done) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-3">
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
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <p className="max-w-md text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              {companyName || 'O&M Builder'}
            </p>
            <h1 className="text-xl font-semibold text-slate-900 mt-1">{documentTitle}</h1>
            <p className="text-sm text-slate-500 mt-1">{isSchemaForm ? INTRUDER_ALARM_SCHEMA.title : template.description}</p>
            {isSchemaForm && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-3">
              {INTRUDER_ALARM_SCHEMA.status}. This is not an official NSI certificate.
            </p>
            )}
          </div>

          <form onSubmit={submit} className="p-6 space-y-4">
            {isSchemaForm ? (
              <SchemaForm schema={INTRUDER_ALARM_SCHEMA} answers={schemaAnswers} onChange={setSchemaAnswers} />
            ) : (
              <>
                {template.fields.map(field => (
                  <label key={field.key} className="block">
                    <span className="text-sm font-medium text-slate-700">
                      {field.label}
                      {field.required ? <span className="text-red-500"> *</span> : null}
                    </span>
                    {field.type === 'textarea' ? (
                      <textarea
                        value={String(simpleAnswers[field.key] ?? '')}
                        onChange={event => updateField(field.key, event.target.value)}
                        rows={3}
                        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      />
                    ) : field.type === 'select' ? (
                      <select
                        value={String(simpleAnswers[field.key] ?? '')}
                        onChange={event => updateField(field.key, event.target.value)}
                        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                      >
                        <option value="">Choose…</option>
                        {(field.options ?? []).map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : field.type === 'checkbox' ? (
                      <span className="mt-1 flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={simpleAnswers[field.key] === true}
                          onChange={event => updateField(field.key, event.target.checked)}
                        />
                        I confirm
                      </span>
                    ) : (
                      <input
                        type={field.type}
                        value={String(simpleAnswers[field.key] ?? '')}
                        onChange={event => updateField(field.key, event.target.value)}
                        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      />
                    )}
                  </label>
                ))}
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-1">Signature <span className="text-red-500"> *</span></p>
                  <SignaturePad value={signature} onChange={setSignature} />
                </div>
              </>
            )}

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={savingDraft || submitting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-slate-300 text-slate-700 font-medium disabled:opacity-50"
              >
                {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save draft
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-cyan-600 text-white font-semibold hover:bg-cyan-700 disabled:opacity-50"
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
