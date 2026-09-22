import { useEffect, useMemo, useState } from 'react';
import { Link } from 'lucide-react';
import { PACIFIC_RED } from '../FormLetterhead';
import { displayProjectJobNumber } from '../../lib/projectJobNumber';
import { fetchContractorForProject } from '../../lib/contractorBrand';
import { buildCompletionPdf } from '../../lib/completionFormPdf';
import {
  approveForCustomer,
  issueCompletionForm,
  issueCustomerToken,
  listCompletionForms,
  listFormTokens,
  replaceEngineerLink,
  returnCompletionForm,
  saveApprovedPdf,
} from '../../lib/completionFormsApi';
import { supabase } from '../../lib/supabase';
import type { CompletionFormSummary } from '../../lib/completionFormTypes';
import type { Project } from '../../types';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  issued: 'Issued',
  opened: 'Opened',
  in_progress: 'In progress',
  submitted: 'Submitted',
  returned: 'Returned for correction',
  awaiting_review: 'Awaiting review',
  awaiting_customer: 'Awaiting customer signature',
  complete: 'Complete',
  revoked: 'Revoked',
  superseded: 'Superseded',
};

export function CompletionOfficePanel({ project }: { project: Project }) {
  const [forms, setForms] = useState<CompletionFormSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsSql, setNeedsSql] = useState(false);
  const [assignedName, setAssignedName] = useState(project.engineer ?? '');
  const [assignedEmail, setAssignedEmail] = useState('');
  const [assignedCompany, setAssignedCompany] = useState('');
  const [expiryDays, setExpiryDays] = useState(30);
  const [returnNote, setReturnNote] = useState('');
  const [outstanding, setOutstanding] = useState(false);

  const prefill = useMemo(() => ({
    job_number: displayProjectJobNumber(project.job_number, project.project_number),
    site_address: project.site_address ?? project.site_name ?? '',
    client: project.client_name ?? '',
    job_title: project.project_name ?? '',
    project_manager: project.project_manager ?? '',
    engineer: project.engineer ?? '',
    system_type: '',
  }), [project]);

  const load = async () => {
    try {
      setForms(await listCompletionForms(project.id));
      setNeedsSql(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load forms.';
      setError(message);
      setNeedsSql(/045 SQL/.test(message));
    }
  };

  useEffect(() => {
    void load();
  }, [project.id]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">CCTV completion and handover</h3>
          <p className="text-sm text-slate-500 mt-1">
            Issue a secure link to an engineer or subcontractor. They complete the Pacific CCTV record on a phone, add photographs and sign.
            After office review the customer signs on site or through a separate link. The approved PDF goes into this project’s O&amp;M pack.
          </p>
        </div>
        {needsSql && (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Paste migration 045 in the Supabase SQL editor before issuing a form.
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {notice && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-700">Engineer or subcontractor name
            <input value={assignedName} onChange={event => setAssignedName(event.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm text-slate-700">Email (optional)
            <input type="email" value={assignedEmail} onChange={event => setAssignedEmail(event.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm text-slate-700">Company
            <input value={assignedCompany} onChange={event => setAssignedCompany(event.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm text-slate-700">Link expiry (days)
            <input type="number" min={1} max={90} value={expiryDays} onChange={event => setExpiryDays(Number(event.target.value))} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !assignedName.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const issued = await issueCompletionForm({
                projectId: project.id,
                assignedName: assignedName.trim(),
                assignedEmail: assignedEmail.trim() || undefined,
                assignedCompany: assignedCompany.trim() || undefined,
                expiryDays,
                prefill,
              });
              await navigator.clipboard.writeText(issued.engineerUrl);
              setNotice(`Engineer link copied. ${issued.emailNote}`);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not issue the form.');
            } finally {
              setBusy(false);
            }
          }}
          className="min-h-11 px-4 rounded-lg text-white text-sm font-medium disabled:opacity-50"
          style={{ background: PACIFIC_RED }}
        >
          Issue CCTV completion form
        </button>
        <p className="text-xs text-slate-500">
          Layout preview only (not saved): <a className="underline" href="/c/demo-cctv" target="_blank" rel="noreferrer">engineer demo</a>
          {' · '}
          <a className="underline" href="/c/demo-cctv-customer" target="_blank" rel="noreferrer">customer demo</a>
        </p>
      </div>

      {forms.map(form => (
        <FormCard
          key={form.id}
          form={form}
          project={project}
          returnNote={returnNote}
          outstanding={outstanding}
          onReturnNote={setReturnNote}
          onOutstanding={setOutstanding}
          onNotice={setNotice}
          onError={setError}
          onRefresh={() => void load()}
        />
      ))}
    </div>
  );
}

function FormCard({
  form,
  project,
  returnNote,
  outstanding,
  onReturnNote,
  onOutstanding,
  onNotice,
  onError,
  onRefresh,
}: {
  form: CompletionFormSummary;
  project: Project;
  returnNote: string;
  outstanding: boolean;
  onReturnNote: (value: string) => void;
  onOutstanding: (value: boolean) => void;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{form.title}</p>
          <p className="text-sm text-slate-500 mt-0.5">
            {form.assigned_name || 'Unassigned'} · template v{form.template_version} · revision {form.current_revision_no}
          </p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide bg-slate-100 text-slate-700 px-2 py-1 rounded">
          {STATUS_LABEL[form.status] ?? form.status}
        </span>
      </div>
      {form.review_note && <p className="text-sm text-amber-900">Last note: {form.review_note}</p>}
      {form.pdf_url && (
        <a href={form.pdf_url} target="_blank" rel="noreferrer" className="text-sm font-medium" style={{ color: PACIFIC_RED }}>
          Open approved PDF
        </a>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="text-sm px-3 py-2 border border-slate-200 rounded-lg inline-flex items-center gap-1" onClick={async () => {
          const tokens = await listFormTokens(form.id);
          const live = tokens.find(token => token.role === 'engineer' && !token.revoked_at);
          if (!live) {
            onError('No live engineer link. Replace the link first.');
            return;
          }
          await navigator.clipboard.writeText(`${window.location.origin}/c/${live.token}`);
          onNotice('Engineer link copied.');
        }}>
          <Link className="w-3.5 h-3.5" />Copy engineer link
        </button>
        <button type="button" className="text-sm px-3 py-2 border border-slate-200 rounded-lg" onClick={async () => {
          const url = await replaceEngineerLink(form.id);
          await navigator.clipboard.writeText(url);
          onNotice('Previous engineer link revoked. New link copied.');
          onRefresh();
        }}>Replace engineer link</button>
        {form.status === 'awaiting_review' && (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={outstanding} onChange={event => onOutstanding(event.target.checked)} />
              Authorise handover with outstanding items
            </label>
            <button type="button" className="text-sm px-3 py-2 text-white rounded-lg" style={{ background: PACIFIC_RED }} onClick={async () => {
              await approveForCustomer(form.id, outstanding);
              const url = await issueCustomerToken(form.id);
              await navigator.clipboard.writeText(url);
              onNotice('Approved for customer signature. Customer link copied.');
              onRefresh();
            }}>Approve for customer</button>
            <input value={returnNote} onChange={event => onReturnNote(event.target.value)} placeholder="Return reason" className="text-sm border border-slate-200 rounded-lg px-3 py-2" />
            <button type="button" className="text-sm px-3 py-2 border border-slate-200 rounded-lg" onClick={async () => {
              if (!returnNote.trim()) {
                onError('Explain what needs to change.');
                return;
              }
              await returnCompletionForm(form.id, returnNote.trim());
              onNotice('Returned. The engineer must sign the new revision.');
              onRefresh();
            }}>Return for correction</button>
          </>
        )}
        {form.status === 'complete' && !form.pdf_url && (
          <button type="button" className="text-sm px-3 py-2 text-white rounded-lg" style={{ background: PACIFIC_RED }} onClick={async () => {
            try {
              const [{ data: row }, { data: revision }, brand] = await Promise.all([
                supabase.from('completion_forms').select('*').eq('id', form.id).single(),
                supabase.from('completion_form_revisions').select('*').eq('form_id', form.id).eq('revision_no', form.current_revision_no).single(),
                fetchContractorForProject({ projectId: project.id, contractorProfileId: project.contractor_profile_id }),
              ]);
              const built = await buildCompletionPdf({
                schema: row?.schema_json,
                answers: revision?.answers ?? {},
                photos: [],
                brand,
                jobRef: displayProjectJobNumber(project.job_number, project.project_number),
                documentRef: `CCTV-${form.id}`,
                revisionNo: form.current_revision_no,
                status: 'Approved',
                issueDate: new Date().toLocaleDateString('en-GB'),
                outstandingAuthorised: form.outstanding_handover_authorised,
              });
              await saveApprovedPdf({ formId: form.id, projectId: project.id, fileName: built.fileName, pdfBase64: built.pdfBase64 });
              onNotice('Approved PDF saved to the O&M commissioning section.');
              onRefresh();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Could not build the PDF.');
            }
          }}>Generate O&amp;M PDF</button>
        )}
      </div>
      <p className="text-xs text-slate-400">
        Simpro return attach is queued only. It is not sent to a live job from this screen.
        {form.simpro_attach_status ? ` Last status: ${form.simpro_attach_status}` : ''}
      </p>
    </div>
  );
}
