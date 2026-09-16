import { recordEmailOutbox, getEmailSettings } from './emailSettings';
import { supabase } from './supabase';
import { PACIFIC_TEMPLATE_FILES, fillPacificHandoverPdf, identityFromAnswers } from './pacificTemplateFill';
import { buildPacificPdf, jobRefFromProject, uploadProjectPdf } from './pacificPdf';
import type { ContractorBrand } from './contractorBrand';
import { getSdpSchema } from './systemDesignProposal';
import { applySchemaPrefill, type FormAnswers } from './schemaForm';
import { getPackFormSchema } from './packFormSchemas';

export const COMPLETION_BY_CATEGORY: Record<string, { documentId: string; title: string; templateKey: string }> = {
  intruder_alarm: { documentId: 'ia01_completion', title: 'IA01 Intruder alarm completion and handover', templateKey: 'ia01_completion' },
  cctv: { documentId: 'cc01_completion', title: 'CC01 CCTV completion and handover', templateKey: 'cc01_completion' },
  access_control: { documentId: 'ac01_completion', title: 'AC01 Access control completion and handover', templateKey: 'ac01_completion' },
};

export interface PackDocumentLink {
  documentId: string;
  title: string;
  templateKey: string;
  returnUrl: string;
  issuedPdfUrl?: string;
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function origin(): string {
  return window.location.origin;
}

export function relevantCompletionDocs(systemCategories: string[]): Array<{ documentId: string; title: string; templateKey: string }> {
  const docs: Array<{ documentId: string; title: string; templateKey: string }> = [
    { documentId: 'sdp', title: 'System Design Proposal (SDP)', templateKey: 'sdp' },
  ];
  const seen = new Set<string>(['sdp']);
  for (const category of systemCategories) {
    const mapped = COMPLETION_BY_CATEGORY[category];
    if (mapped && !seen.has(mapped.documentId)) {
      seen.add(mapped.documentId);
      docs.push(mapped);
    }
  }
  return docs;
}

function prefillFromProject(project: {
  job_number?: string | null;
  project_name?: string | null;
  client_name?: string | null;
  site_name?: string | null;
  site_address?: string | null;
  project_manager?: string | null;
  quote_number?: string | null;
  engineer?: string | null;
}): Record<string, string> {
  return {
    job_number: project.job_number ?? '',
    project_name: project.project_name ?? '',
    client_name: project.client_name ?? '',
    site_name: project.site_name ?? '',
    site_address: project.site_address ?? '',
    project_manager: project.project_manager ?? '',
    quote_number: project.quote_number ?? '',
    engineer: project.engineer ?? '',
  };
}

export function completionAnswersFromSdp(
  templateKey: string,
  project: Parameters<typeof prefillFromProject>[0],
  sdpAnswers: FormAnswers,
  companyName?: string | null,
): FormAnswers {
  const schema = getPackFormSchema(templateKey);
  if (!schema) return {};
  const answers = applySchemaPrefill(schema, prefillFromProject(project), companyName);
  const identity = (answers.identity && typeof answers.identity === 'object' ? answers.identity : {}) as Record<string, unknown>;
  const sdpProject = (sdpAnswers.project && typeof sdpAnswers.project === 'object' ? sdpAnswers.project : {}) as Record<string, unknown>;
  const sdpDescription = (sdpAnswers.description && typeof sdpAnswers.description === 'object' ? sdpAnswers.description : {}) as Record<string, unknown>;
  const sdpControl = (sdpAnswers.control && typeof sdpAnswers.control === 'object' ? sdpAnswers.control : {}) as Record<string, unknown>;
  identity.customer_organisation = sdpProject.customer_organisation || identity.customer_organisation;
  identity.customer_representative = sdpProject.customer_representative || identity.customer_representative;
  identity.site_address = sdpProject.site_address || identity.site_address;
  identity.simpro_job_number = sdpProject.simpro_job_number || identity.simpro_job_number;
  identity.project_work_title = sdpProject.project_title || identity.project_work_title;
  identity.engineer_survey_date = sdpProject.engineer || identity.engineer_survey_date;
  identity.work_type = sdpControl.work_type || identity.work_type;
  answers.identity = identity;
  const design = (answers.design && typeof answers.design === 'object' ? answers.design : {}) as Record<string, unknown>;
  design.protected_areas = sdpDescription.system_description || design.protected_areas;
  answers.design = design;
  return answers;
}

async function createReturnToken(opts: {
  projectId: number;
  documentId: string;
  revisionNo?: number;
  formToken?: string;
}): Promise<string> {
  const token = randomToken();
  const { error } = await supabase.from('document_return_tokens').insert({
    token,
    project_id: opts.projectId,
    document_id: opts.documentId,
    revision_no: opts.revisionNo ?? null,
    form_token: opts.formToken ?? null,
    status: 'open',
  });
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message)
    ? 'Run Copy 035–037 SQL in Supabase before emailing the completion pack.'
    : error.message);
  return token;
}

async function issuedTemplatePdf(opts: {
  documentId: string;
  answers: FormAnswers;
  projectId: number;
}): Promise<string | undefined> {
  const path = PACIFIC_TEMPLATE_FILES[opts.documentId];
  if (!path) return undefined;
  const response = await fetch(path);
  if (!response.ok) return undefined;
  const bytes = await fillPacificHandoverPdf({
    documentId: opts.documentId,
    templateBytes: await response.arrayBuffer(),
    identity: identityFromAnswers(opts.answers),
  });
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const fileName = `${opts.documentId}_issued_${Date.now()}.pdf`;
  const storagePath = `issued/${opts.projectId}/${fileName}`;
  const { error } = await supabase.storage.from('om-uploads').upload(storagePath, blob, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) return undefined;
  return supabase.storage.from('om-uploads').getPublicUrl(storagePath).data.publicUrl;
}

export async function sendCompletionPack(opts: {
  projectId: number;
  project: Parameters<typeof prefillFromProject>[0];
  systemCategories: string[];
  recipientEmail: string;
  recipientName: string;
  sdpAnswers: FormAnswers;
  sdpRevisionNo: number;
  brand: ContractorBrand | null;
  companyName?: string | null;
}): Promise<{ links: PackDocumentLink[]; mailtoHref: string; emailed: boolean; provider: string }> {
  const settings = await getEmailSettings();
  const docs = relevantCompletionDocs(opts.systemCategories);
  const links: PackDocumentLink[] = [];

  for (const doc of docs) {
    const answers = doc.templateKey === 'sdp'
      ? opts.sdpAnswers
      : completionAnswersFromSdp(doc.templateKey, opts.project, opts.sdpAnswers, opts.companyName);
    const schema = getPackFormSchema(doc.templateKey) ?? (doc.templateKey === 'sdp' ? getSdpSchema() : null);
    const returnToken = await createReturnToken({
      projectId: opts.projectId,
      documentId: doc.documentId,
      revisionNo: doc.documentId === 'sdp' ? opts.sdpRevisionNo : undefined,
    });

    let issuedPdfUrl: string | undefined;
    if (PACIFIC_TEMPLATE_FILES[doc.documentId]) {
      issuedPdfUrl = await issuedTemplatePdf({
        documentId: doc.documentId,
        answers,
        projectId: opts.projectId,
      });
    }
    if (!issuedPdfUrl && schema) {
      try {
        const pdf = await buildPacificPdf({
          title: doc.title,
          brand: opts.brand,
          answers,
          schema,
          jobRef: jobRefFromProject(opts.project),
        });
        issuedPdfUrl = await uploadProjectPdf({
          projectId: opts.projectId,
          folder: 'issued',
          fileName: pdf.fileName,
          pdfBase64: pdf.pdfBase64,
        });
      } catch {
        issuedPdfUrl = undefined;
      }
    }

    await supabase.from('project_handover_docs').upsert({
      project_id: opts.projectId,
      document_type: doc.documentId,
      title: doc.title,
      status: 'in_progress',
      workflow_status: 'issued',
      revision_no: doc.documentId === 'sdp' ? opts.sdpRevisionNo : null,
      sc_inspection_id: returnToken,
      sc_template_id: doc.templateKey,
      sc_inspection_name: issuedPdfUrl ?? `${origin()}/r/${returnToken}`,
    }, { onConflict: 'project_id,document_type,system_type' });

    links.push({
      documentId: doc.documentId,
      title: doc.title,
      templateKey: doc.templateKey,
      returnUrl: `${origin()}/r/${returnToken}`,
      issuedPdfUrl,
    });
  }

  const subject = `${opts.project.job_number || opts.project.project_name || 'Job'} — Pacific handover PDFs`;
  const body = [
    `Please complete the attached Pacific PDF pack for ${opts.project.project_name || 'this job'}.`,
    'Fill the PDF itself. Do not use a browser form.',
    '',
    ...links.flatMap(link => [
      `${link.title}`,
      link.issuedPdfUrl ? `Prefilled PDF: ${link.issuedPdfUrl}` : '',
      `Return the signed PDF: ${link.returnUrl}`,
      '',
    ]),
    'Signatures on the SDP bind only that revision. Return the completed PDF with the upload link so it is saved against this job.',
  ].filter(item => item !== undefined).join('\n');

  await recordEmailOutbox({
    project_id: opts.projectId,
    provider: settings.provider,
    recipient: opts.recipientEmail,
    subject,
    body,
    meta: { links },
  });

  let emailed = false;
  if (settings.provider === 'resend' && opts.recipientEmail) {
    try {
      const { data, error } = await supabase.functions.invoke('handover-forms', {
        body: {
          action: 'send_pack',
          to: opts.recipientEmail,
          subject,
          body,
        },
      });
      emailed = !error && Boolean(data);
    } catch {
      emailed = false;
    }
  }

  const mailtoHref = `mailto:${encodeURIComponent(opts.recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { links, mailtoHref, emailed, provider: settings.provider };
}
