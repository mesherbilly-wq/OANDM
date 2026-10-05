import { useEffect, useMemo, useState } from 'react';
import { Link as LinkIcon, Trash2 } from 'lucide-react';
import { displayProjectJobNumber } from '../../lib/projectJobNumber';
import { fetchContractorForProject, resolveOmBrand, type ContractorBrand } from '../../lib/contractorBrand';
import { buildCompletionPdf } from '../../lib/completionFormPdf';
import {
  approveForCustomer,
  deleteCompletionForm,
  issueCompletionForm,
  issueCustomerToken,
  listCompletionDocuments,
  listCompletionForms,
  listFormTokens,
  listProjectCompletionAssignments,
  replaceEngineerLink,
  returnCompletionForm,
  saveApprovedPdf,
} from '../../lib/completionFormsApi';
import { supabase } from '../../lib/supabase';
import { loadDocumentProjectSystems, PROJECT_WIDE_SYSTEM_KEY, PROJECT_WIDE_SYSTEM_LABEL } from '../../lib/documentProjectSystems';
import { getCategoryStyle, type ProjectSystem } from '../../lib/systems';
import type { CompletionFormSummary } from '../../lib/completionFormTypes';
import type { Device, Project } from '../../types';

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
  const [brand, setBrand] = useState<ContractorBrand | null>(null);
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
  const [projectSystems, setProjectSystems] = useState<ProjectSystem[]>([]);
  const [activeSystemKey, setActiveSystemKey] = useState(PROJECT_WIDE_SYSTEM_KEY);
  const [issueDocs, setIssueDocs] = useState<Array<{ template_key: string; title: string }>>([]);
  const [templateKey, setTemplateKey] = useState('');

  const theme = resolveOmBrand(brand);
  const systemType = activeSystemKey === PROJECT_WIDE_SYSTEM_KEY ? PROJECT_WIDE_SYSTEM_LABEL : activeSystemKey;

  const prefill = useMemo(() => ({
    job_number: displayProjectJobNumber(project.job_number, project.project_number),
    site_address: project.site_address ?? project.site_name ?? '',
    client: project.client_name ?? '',
    job_title: project.project_name ?? '',
    project_manager: project.project_manager ?? '',
    engineer: project.engineer ?? '',
    system_type: systemType === PROJECT_WIDE_SYSTEM_LABEL ? '' : systemType,
  }), [project, systemType]);

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
    void fetchContractorForProject({ projectId: project.id, contractorProfileId: project.contractor_profile_id })
      .then(setBrand)
      .catch(() => undefined);
  }, [project.id, project.contractor_profile_id]);

  useEffect(() => {
    void supabase.from('devices').select('system_type, system_category, project_system_id').eq('project_id', project.id)
      .then(async ({ data }) => {
        setProjectSystems(await loadDocumentProjectSystems(project.id, (data ?? []) as Device[]));
      });
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [assigned, docs] = await Promise.all([
        listProjectCompletionAssignments(project.id, systemType),
        listCompletionDocuments(systemType),
      ]);
      if (cancelled) return;
      const assignedDocs = docs.filter(doc => assigned.includes(doc.template_key));
      const available = assignedDocs.length > 0 ? assignedDocs : docs;
      setIssueDocs(available.map(doc => ({ template_key: doc.template_key, title: doc.title })));
      setTemplateKey(current => available.some(doc => doc.template_key === current) ? current : (available[0]?.template_key ?? ''));
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, systemType]);

  const tabs = [
    { key: PROJECT_WIDE_SYSTEM_KEY, name: PROJECT_WIDE_SYSTEM_LABEL, category: null as ProjectSystem['category'] },
    ...projectSystems.map(system => ({ key: system.name, name: system.name, category: system.category })),
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Completion and handover</h3>
          <p className="text-sm text-slate-500 mt-1">
            Issue a secure link using the documents assigned to this system on the Templates tab.
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

        <div className="flex flex-wrap gap-1.5">
          {tabs.map(tab => {
            const Icon = tab.key === PROJECT_WIDE_SYSTEM_KEY ? null : getCategoryStyle(tab.category).icon;
            const selected = activeSystemKey === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveSystemKey(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${selected ? 'text-white' : 'bg-slate-100 text-slate-600'}`}
                style={selected ? { background: theme.primary } : undefined}
              >
                {Icon ? <Icon className="w-3.5 h-3.5" /> : null}
                {tab.name}
              </button>
            );
          })}
        </div>
        {issueDocs.length > 0 ? (
          <label className="block text-sm text-slate-700">Document to issue
            <select
              value={templateKey}
              onChange={event => setTemplateKey(event.target.value)}
              className="mt-1 w-full max-w-md border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {issueDocs.map(doc => (
                <option key={doc.template_key} value={doc.template_key}>{doc.title}</option>
              ))}
            </select>
            <span className="block text-xs text-slate-500 mt-1">
              {issueDocs.length === 1
                ? `Assigned for ${systemType}. Tick more documents on the Templates tab.`
                : `${issueDocs.length} documents assigned for ${systemType}.`}
            </span>
          </label>
        ) : (
          <p className="text-sm text-slate-600">No document assigned for {systemType}. Choose one or more on the Templates tab.</p>
        )}

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
          disabled={busy || !assignedName.trim() || !templateKey}
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
                templateKey,
                companyName: theme.name,
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
          style={{ background: theme.primary }}
        >
          Issue {issueDocs.find(doc => doc.template_key === templateKey)?.title || 'completion form'}
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
          brand={brand}
          returnNote={returnNote}
          outstanding={outstanding}
          onReturnNote={setReturnNote}
          onOutstanding={setOutstanding}
          onNotice={setNotice}
          onError={setError}
          onRefresh={() => void load()}
          onDelete={async () => {
            if (!confirm(`Remove "${form.title}"? Issued links will stop working. This cannot be undone.`)) return;
            try {
              await deleteCompletionForm(form);
              setNotice('Form removed.');
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not remove the form.');
            }
          }}
        />
      ))}
    </div>
  );
}

function FormCard({
  form,
  project,
  brand,
  returnNote,
  outstanding,
  onReturnNote,
  onOutstanding,
  onNotice,
  onError,
  onRefresh,
  onDelete,
}: {
  form: CompletionFormSummary;
  project: Project;
  brand: ContractorBrand | null;
  returnNote: string;
  outstanding: boolean;
  onReturnNote: (value: string) => void;
  onOutstanding: (value: boolean) => void;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
  onRefresh: () => void;
  onDelete: () => Promise<void>;
}) {
  const theme = resolveOmBrand(brand);
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
        <a href={form.pdf_url} target="_blank" rel="noreferrer" className="text-sm font-medium" style={{ color: theme.primary }}>
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
          <LinkIcon className="w-3.5 h-3.5" />Copy engineer link
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
            <button type="button" className="text-sm px-3 py-2 text-white rounded-lg" style={{ background: theme.primary }} onClick={async () => {
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
          <button type="button" className="text-sm px-3 py-2 text-white rounded-lg" style={{ background: theme.primary }} onClick={async () => {
            try {
              const [{ data: row }, { data: revision }] = await Promise.all([
                supabase.from('completion_forms').select('*').eq('id', form.id).single(),
                supabase.from('completion_form_revisions').select('*').eq('form_id', form.id).eq('revision_no', form.current_revision_no).single(),
              ]);
              const built = await buildCompletionPdf({
                schema: row?.schema_json,
                answers: revision?.answers ?? {},
                photos: [],
                brand,
                jobRef: displayProjectJobNumber(project.job_number, project.project_number),
                documentRef: `${form.template_key}-${form.id}`,
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
        <button
          type="button"
          className="text-sm px-3 py-2 border border-red-200 text-red-700 rounded-lg inline-flex items-center gap-1"
          onClick={() => void onDelete()}
        >
          <Trash2 className="w-3.5 h-3.5" />Remove form
        </button>
      </div>
      <p className="text-xs text-slate-400">
        Simpro return attach is queued only. It is not sent to a live job from this screen.
        {form.simpro_attach_status ? ` Last status: ${form.simpro_attach_status}` : ''}
      </p>
    </div>
  );
}
