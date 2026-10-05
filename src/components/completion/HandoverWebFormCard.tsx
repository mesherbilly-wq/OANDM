import { useState } from 'react';
import { CheckCircle, ExternalLink, FileText } from 'lucide-react';
import { displayProjectJobNumber } from '../../lib/projectJobNumber';
import { resolveOmBrand, type ContractorBrand } from '../../lib/contractorBrand';
import {
  deleteCompletionForm,
  ensureApprovedCompletionPdf,
  issueCompletionForm,
  resolveCompletionViewUrl,
} from '../../lib/completionFormsApi';
import { completionDocUiStatus, completionShouldAttachPdf, type CompletionFormSummary } from '../../lib/completionFormTypes';
import { handoverDocumentIcon, type HandoverDocumentDefinition } from '../../lib/handoverDocumentConfig';
import type { Project } from '../../types';
import { CompletionFormActions } from './CompletionOfficePanel';

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

export function HandoverWebFormCard({
  definition,
  forms,
  project,
  brand,
  systemType,
  engineerName,
  onRefresh,
  onNotice,
  onError,
}: {
  definition: HandoverDocumentDefinition;
  forms: CompletionFormSummary[];
  project: Project;
  brand: ContractorBrand | null;
  systemType: string;
  engineerName: string;
  onRefresh: () => void;
  onNotice: (value: string) => void;
  onError: (value: string) => void;
}) {
  const theme = resolveOmBrand(brand);
  const Icon = handoverDocumentIcon(definition.icon_key);
  const live = forms.filter(form => form.status !== 'revoked' && form.status !== 'superseded');
  const form = live[0] ?? null;
  const status = completionDocUiStatus(form?.status, form);
  const statusCfg = STATUS_CONFIG[status];
  const templateKey = definition.web_form_template_key?.trim() ?? '';
  const [assignedName, setAssignedName] = useState(engineerName || project.engineer || '');
  const [busy, setBusy] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [outstanding, setOutstanding] = useState(false);

  const viewDocument = async (row: CompletionFormSummary) => {
    try {
      if (completionShouldAttachPdf(row.status) && !row.pdf_url) {
        try {
          const pdfUrl = await ensureApprovedCompletionPdf({ form: row, project, brand });
          window.open(pdfUrl, '_blank', 'noopener,noreferrer');
          onRefresh();
          return;
        } catch {
          // Fall through to the live form.
        }
      }
      const url = row.pdf_url || await resolveCompletionViewUrl(row);
      if (!url) {
        onError('No document to view yet. Issue the form first.');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not open the document.');
    }
  };

  const issue = async () => {
    if (!templateKey || !assignedName.trim()) return;
    setBusy(true);
    try {
      const issued = await issueCompletionForm({
        projectId: project.id,
        assignedName: assignedName.trim(),
        expiryDays: 30,
        templateKey,
        companyName: theme.name,
        prefill: {
          job_number: displayProjectJobNumber(project.job_number, project.project_number),
          site_address: project.site_address ?? project.site_name ?? '',
          client: project.client_name ?? '',
          job_title: project.project_name ?? '',
          project_manager: project.project_manager ?? '',
          engineer: assignedName.trim(),
          system_type: systemType,
        },
      });
      await navigator.clipboard.writeText(issued.engineerUrl);
      onNotice(`Engineer link copied. ${issued.emailNote}`);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not issue the form.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${status === 'completed' ? 'bg-emerald-100' : 'bg-slate-200'}`}>
          {status === 'completed' ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <Icon className="w-5 h-5 text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">{definition.title}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {form ? `${form.assigned_name || 'Unassigned'} · ${STATUS_LABEL[form.status] ?? form.status}` : (definition.description || 'Web form')}
          </p>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusCfg.color}`}>
          {statusCfg.label}
        </span>
      </div>
      <div className="px-5 py-4 space-y-3">
        {!templateKey ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Choose a web form for this document on the Config tab.
          </p>
        ) : !form ? (
          <div className="space-y-2">
            <input
              value={assignedName}
              onChange={event => setAssignedName(event.target.value)}
              placeholder="Engineer name"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
            />
            <button
              type="button"
              disabled={busy || !assignedName.trim()}
              onClick={() => void issue()}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              Issue web form
            </button>
          </div>
        ) : (
          <>
            <div className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 border ${status === 'completed' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
              <FileText className={`w-4 h-4 flex-shrink-0 ${status === 'completed' ? 'text-emerald-600' : 'text-slate-500'}`} />
              <span className={`text-sm font-medium flex-1 min-w-0 truncate ${status === 'completed' ? 'text-emerald-800' : 'text-slate-700'}`}>
                {form.pdf_file_name || definition.title}
              </span>
              <button
                type="button"
                onClick={() => void viewDocument(form)}
                className={`text-xs hover:underline flex items-center gap-0.5 flex-shrink-0 ${status === 'completed' ? 'text-emerald-700' : 'text-slate-700'}`}
              >
                View <ExternalLink className="w-3 h-3" />
              </button>
            </div>
            <CompletionFormActions
              form={form}
              project={project}
              brand={brand}
              returnNote={returnNote}
              outstanding={outstanding}
              onReturnNote={setReturnNote}
              onOutstanding={setOutstanding}
              onNotice={onNotice}
              onError={onError}
              onRefresh={onRefresh}
              onDelete={async () => {
                if (!confirm(`Remove "${form.title}"? Issued links will stop working. This cannot be undone.`)) return;
                try {
                  await deleteCompletionForm(form);
                  onNotice('Form removed.');
                  onRefresh();
                } catch (err) {
                  onError(err instanceof Error ? err.message : 'Could not remove the form.');
                }
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
