import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, ExternalLink, FileText, Link as LinkIcon, Trash2 } from 'lucide-react';
import { displayProjectJobNumber } from '../../lib/projectJobNumber';
import { fetchContractorForProject, resolveOmBrand, type ContractorBrand } from '../../lib/contractorBrand';
import {
  approveForCustomer,
  deleteCompletionForm,
  ensureApprovedCompletionPdf,
  issueCompletionForm,
  issueCustomerToken,
  listCompletionDocuments,
  listCompletionForms,
  listFormTokens,
  listProjectCompletionAssignments,
  replaceEngineerLink,
  resolveCompletionViewUrl,
  returnCompletionForm,
} from '../../lib/completionFormsApi';
import { supabase } from '../../lib/supabase';
import { loadDocumentProjectSystems, PROJECT_WIDE_SYSTEM_KEY, PROJECT_WIDE_SYSTEM_LABEL } from '../../lib/documentProjectSystems';
import { getCategoryStyle, type ProjectSystem } from '../../lib/systems';
import { completionDocUiStatus, completionShouldAttachPdf, type CompletionFormSummary } from '../../lib/completionFormTypes';
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

const STATUS_CONFIG = {
  not_started: { label: 'Not Started', color: 'bg-slate-100 text-slate-500 border-slate-200' },
  in_progress: { label: 'In Progress', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  completed: { label: 'Completed', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
} as const;

type DocCard = {
  key: string;
  title: string;
  templateKey: string;
  form: CompletionFormSummary | null;
};

function buildDocumentCards(
  issueDocs: Array<{ template_key: string; title: string }>,
  forms: CompletionFormSummary[],
): DocCard[] {
  const live = forms.filter(form => form.status !== 'revoked' && form.status !== 'superseded');
  const assignedKeys = issueDocs.map(doc => doc.template_key);
  const cards: DocCard[] = [];
  for (const doc of issueDocs) {
    const matches = live.filter(form => form.template_key === doc.template_key);
    if (matches.length === 0) {
      cards.push({ key: `empty-${doc.template_key}`, title: doc.title, templateKey: doc.template_key, form: null });
      continue;
    }
    for (const form of matches) {
      cards.push({ key: `form-${form.id}`, title: form.title || doc.title, templateKey: doc.template_key, form });
    }
  }
  for (const form of live) {
    if (assignedKeys.includes(form.template_key)) continue;
    cards.push({ key: `form-${form.id}`, title: form.title, templateKey: form.template_key, form });
  }
  return cards;
}

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
  const attachingRef = useRef(false);
  const failedPdfIds = useRef(new Set<number>());

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
    const missing = forms.filter(form => completionShouldAttachPdf(form.status) && !form.pdf_url && !failedPdfIds.current.has(form.id));
    if (!missing.length || attachingRef.current) return;
    attachingRef.current = true;
    void (async () => {
      try {
        for (const form of missing) {
          try {
            await ensureApprovedCompletionPdf({ form, project, brand });
          } catch {
            failedPdfIds.current.add(form.id);
          }
        }
        await load();
      } finally {
        attachingRef.current = false;
      }
    })();
  }, [forms, brand, project]);

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

  const documentCards = useMemo(() => buildDocumentCards(issueDocs, forms), [issueDocs, forms]);
  const completedDocs = documentCards.filter(card => completionDocUiStatus(card.form?.status, card.form) === 'completed').length;
  const totalDocs = documentCards.length;

  const viewDocument = async (form: CompletionFormSummary) => {
    setError(null);
    try {
      if (completionShouldAttachPdf(form.status) && !form.pdf_url) {
        try {
          const pdfUrl = await ensureApprovedCompletionPdf({ form, project, brand });
          window.open(pdfUrl, '_blank', 'noopener,noreferrer');
          await load();
          return;
        } catch {
          // Fall through to the live form if the PDF cannot be built yet.
        }
      }
      const url = form.pdf_url || await resolveCompletionViewUrl(form);
      if (!url) {
        setError('No document to view yet. Issue the form first.');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the document.');
    }
  };

  const issueForm = async (key: string) => {
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
        templateKey: key,
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
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Completion and handover</h3>
          <p className="text-sm text-slate-500 mt-1">
            Issue a secure link using the documents assigned to this system on the Templates tab.
            After office review the customer signs on site or through a separate link. Completed PDFs attach to this project’s O&amp;M pack.
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
          onClick={() => void issueForm(templateKey)}
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

      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">Completion Documents</h2>
          <p className="text-sm text-slate-500 mt-0.5">Issue the form, track progress, then open the signed PDF from here and the O&amp;M pack</p>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${totalDocs > 0 && completedDocs === totalDocs ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {completedDocs}/{totalDocs} complete
        </span>
      </div>

      {documentCards.length === 0 ? (
        <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-6 text-center">
          No completion documents assigned for this system yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {documentCards.map(card => {
            const status = completionDocUiStatus(card.form?.status, card.form);
            const statusCfg = STATUS_CONFIG[status];
            return (
              <div key={card.key} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${status === 'completed' ? 'bg-emerald-100' : 'bg-slate-200'}`}>
                    {status === 'completed' ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <FileText className="w-5 h-5 text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{card.title}</p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {card.form
                        ? `${card.form.assigned_name || 'Unassigned'} · ${STATUS_LABEL[card.form.status] ?? card.form.status}`
                        : 'Not issued yet'}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusCfg.color}`}>
                    {statusCfg.label}
                  </span>
                </div>
                <div className="px-5 py-4 space-y-3">
                  {!card.form ? (
                    <button
                      type="button"
                      disabled={busy || !assignedName.trim()}
                      onClick={() => void issueForm(card.templateKey)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg text-white disabled:opacity-50"
                      style={{ background: theme.primary }}
                    >
                      Issue this document
                    </button>
                  ) : (
                    <>
                      <div className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 border ${status === 'completed' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                        <FileText className={`w-4 h-4 flex-shrink-0 ${status === 'completed' ? 'text-emerald-600' : 'text-slate-500'}`} />
                        <span className={`text-sm font-medium flex-1 min-w-0 truncate ${status === 'completed' ? 'text-emerald-800' : 'text-slate-700'}`}>
                          {card.form.pdf_file_name || card.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => void viewDocument(card.form!)}
                          className={`text-xs hover:underline flex items-center gap-0.5 flex-shrink-0 ${status === 'completed' ? 'text-emerald-700' : 'text-slate-700'}`}
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                      <CompletionFormActions
                      form={card.form}
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
                        if (!confirm(`Remove "${card.form?.title}"? Issued links will stop working. This cannot be undone.`)) return;
                        try {
                          await deleteCompletionForm(card.form!);
                          setNotice('Form removed.');
                          await load();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Could not remove the form.');
                        }
                      }}
                    />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CompletionFormActions({
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
    <div className="space-y-3">
      {form.review_note && <p className="text-sm text-amber-900">Last note: {form.review_note}</p>}
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
              try {
                await ensureApprovedCompletionPdf({ form: { ...form, status: 'awaiting_customer' }, project, brand });
              } catch {
                // View still opens the live form if the PDF cannot be built yet.
              }
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
        {completionShouldAttachPdf(form.status) && !form.pdf_url && (
          <button type="button" className="text-sm px-3 py-2 text-white rounded-lg" style={{ background: theme.primary }} onClick={async () => {
            try {
              await ensureApprovedCompletionPdf({ form, project, brand });
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
