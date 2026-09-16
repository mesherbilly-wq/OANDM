import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import { SignaturePad } from '../components/SignaturePad';
import { SchemaForm } from '../components/SchemaForm';
import { FormLetterhead, WorksheetField } from '../components/FormLetterhead';
import { fetchPublicContractorBrand, type ContractorBrand } from '../lib/contractorBrand';
import { getPublicHandoverForm, saveHandoverFormDraft, submitPublicHandoverForm } from '../lib/handoverFormsApi';
import { getHandoverFormTemplate, type HandoverFormField } from '../lib/handoverFormTemplates';
import { getPackFormSchema, packCustomerSignatureNotice } from '../lib/packFormSchemas';
import { buildPacificPdf } from '../lib/pacificPdf';
import {
  applySchemaPrefill,
  mergeSavedAnswers,
  primarySignatureDataUrl,
  primarySignerName,
  validateSchemaAnswers,
  type FormAnswers,
  type SchemaCatalogue,
} from '../lib/schemaForm';

const worksheetInputClass = 'w-full border-0 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400';

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

function jobRefFromAnswers(
  prefill: Record<string, string>,
  simpleAnswers: Record<string, string | boolean>,
  schemaAnswers: FormAnswers,
): string {
  const schemaSite = schemaAnswers.header && typeof schemaAnswers.header === 'object' && !Array.isArray(schemaAnswers.header)
    ? schemaAnswers.header as Record<string, unknown>
    : {};
  return String(
    simpleAnswers.job_number
    || prefill.job_number
    || schemaSite.job_system_ref
    || schemaSite.job_number
    || simpleAnswers.site_name
    || prefill.site_name
    || schemaSite.site_building
    || schemaSite.site_name
    || prefill.project_name
    || '',
  );
}

async function buildSignedPdf(opts: {
  title: string;
  brand: ContractorBrand | null;
  fields?: HandoverFormField[];
  answers: Record<string, unknown>;
  signerName: string;
  signatureDataUrl: string;
  schema?: SchemaCatalogue | null;
  jobRef?: string;
}): Promise<{ fileName: string; pdfBase64: string }> {
  const lines = opts.schema
    ? undefined
    : [
        ...(opts.fields ?? []).map(field => {
          const raw = opts.answers[field.key];
          const value = typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw ?? '').trim() || '—';
          return { label: field.label, value };
        }),
        { label: 'SIGN-OFF', value: '' },
        { label: 'Signer', value: opts.signerName, image: opts.signatureDataUrl || undefined },
      ];
  const pdf = await buildPacificPdf({
    title: opts.title,
    brand: opts.brand,
    answers: opts.answers,
    schema: opts.schema,
    lines,
    jobRef: opts.jobRef,
  });
  return { fileName: pdf.fileName, pdfBase64: pdf.pdfBase64 };
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
  const schema = useMemo(() => getPackFormSchema(templateKey), [templateKey]);
  const isSchemaForm = Boolean(schema);
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
        if (getPackFormSchema(form.form_template_key)) {
          const loaded = getPackFormSchema(form.form_template_key)!;
          setSchemaAnswers(mergeSavedAnswers(applySchemaPrefill(loaded, form.prefill ?? {}, form.company_name), form.answers));
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

    if (isSchemaForm && schema) {
      const schemaError = validateSchemaAnswers(schema, schemaAnswers);
      if (schemaError) {
        setError(schemaError);
        return;
      }
      const signerName = primarySignerName(schema, schemaAnswers) || String(simpleAnswers.signer_name ?? 'Completed').trim();
      const signatureDataUrl = primarySignatureDataUrl(schema, schemaAnswers) || signature;
      setSubmitting(true);
      try {
        const pdf = await buildSignedPdf({
          title: documentTitle,
          brand: displayBrand,
          answers: schemaAnswers,
          signerName,
          signatureDataUrl,
          schema,
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
    <div className="min-h-screen bg-[#e8e8e8] py-6 sm:py-10">
      <div className="max-w-[210mm] mx-auto px-3 sm:px-4">
        <div className="bg-white border border-[#404040] shadow-2xl overflow-hidden">
          <FormLetterhead
            brand={displayBrand}
            title={documentTitle}
            subtitle={schema?.title || template.description}
            jobRef={jobRef}
          />

          <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
            <p className="text-xs text-slate-600 border border-slate-800 bg-slate-50 px-3 py-2">
              Complete all applicable sections. Use N/A where appropriate. Tick boxes and add brief details.
            </p>
            {isSchemaForm && schema && (
              <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-300 px-3 py-2">
                {packCustomerSignatureNotice(templateKey, schema.status)}
              </p>
            )}

            {isSchemaForm && schema ? (
              <SchemaForm schema={schema} answers={schemaAnswers} onChange={setSchemaAnswers} />
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
                <section className="border border-[#404040] overflow-hidden">
                  <h2 className="bg-[#C00000] text-white text-xs font-bold uppercase tracking-wider px-3 py-2">
                    Sign-off
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
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-[#C00000] text-[#C00000] font-semibold uppercase tracking-wide text-sm disabled:opacity-50"
              >
                {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save draft
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#C00000] text-white font-semibold uppercase tracking-wide text-sm hover:bg-[#a00000] disabled:opacity-50"
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
