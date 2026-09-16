import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField } from 'pdf-lib';

export const PACIFIC_TEMPLATE_FILES: Record<string, string> = {
  ia01_completion: '/templates/Pacific_Intruder_Alarm_Handover_Simplified_Rev01.pdf',
  cc01_completion: '/templates/Pacific_CCTV_Handover_Simplified_Rev01.pdf',
  ac01_completion: '/templates/Pacific_Access_Control_Handover_Simplified_Rev01.pdf',
};

const PREFIX: Record<string, string> = {
  ia01_completion: 'IA01',
  cc01_completion: 'CC01',
  ac01_completion: 'AC01',
};

const WORK_TYPE_OPTIONS: Record<string, string> = {
  'new installation': 'New installation',
  takeover: 'Takeover',
  upgrade: 'Upgrade / extension',
  extension: 'Upgrade / extension',
  'upgrade / extension': 'Upgrade / extension',
  maintenance: 'Maintenance',
  other: 'Other',
};

export interface ExtractedPdfField {
  name: string;
  type: string;
  value: string | boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textOf(value: unknown): string {
  return String(value ?? '').trim();
}

function setText(form: ReturnType<PDFDocument['getForm']>, name: string, value: string) {
  if (!value) return;
  try {
    form.getTextField(name).setText(value.slice(0, 3000));
  } catch {
    /* field missing on this template */
  }
}

function setDropdown(form: ReturnType<PDFDocument['getForm']>, name: string, value: string) {
  if (!value) return;
  try {
    const field = form.getDropdown(name);
    const options = field.getOptions();
    const match = options.find(option => option.toLowerCase() === value.toLowerCase())
      ?? options.find(option => option.toLowerCase().includes(value.toLowerCase()));
    if (match && match !== 'Select...') field.select(match);
  } catch {
    /* field missing */
  }
}

export function workTypeForPdf(value: string | null | undefined): string {
  const key = String(value ?? '').trim().toLowerCase();
  return WORK_TYPE_OPTIONS[key] || (value?.trim() ? value : '');
}

export async function fillPacificHandoverPdf(opts: {
  documentId: string;
  templateBytes: ArrayBuffer;
  identity: {
    customer?: string;
    representative?: string;
    siteAddress?: string;
    jobNumber?: string;
    title?: string;
    engineer?: string;
    workType?: string;
    systemState?: string;
    scope?: string;
  };
}): Promise<Uint8Array> {
  const prefix = PREFIX[opts.documentId];
  const pdf = await PDFDocument.load(opts.templateBytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  if (!prefix) return pdf.save();

  setText(form, `${prefix}.p1.f1`, opts.identity.customer ?? '');
  setText(form, `${prefix}.p1.f2`, opts.identity.representative ?? '');
  setText(form, `${prefix}.p1.f3`, opts.identity.siteAddress ?? '');
  setText(form, `${prefix}.p1.f4`, opts.identity.jobNumber ?? '');
  setText(form, `${prefix}.p1.f5`, opts.identity.title ?? '');
  setText(form, `${prefix}.p1.f6`, opts.identity.engineer ?? '');
  setDropdown(form, `${prefix}.p1.f7`, workTypeForPdf(opts.identity.workType));
  setDropdown(form, `${prefix}.p1.f8`, opts.identity.systemState ?? '');
  setText(form, `${prefix}.p1.f13`, opts.identity.scope ?? '');
  return pdf.save();
}

export function identityFromAnswers(answers: Record<string, unknown>): {
  customer?: string;
  representative?: string;
  siteAddress?: string;
  jobNumber?: string;
  title?: string;
  engineer?: string;
  workType?: string;
  systemState?: string;
  scope?: string;
} {
  const identity = asRecord(answers.identity);
  const project = asRecord(answers.project);
  const description = asRecord(answers.description);
  const design = asRecord(answers.design);
  return {
    customer: textOf(identity.customer_organisation || project.customer_organisation),
    representative: textOf(identity.customer_representative || project.customer_representative),
    siteAddress: textOf(identity.site_address || project.site_address),
    jobNumber: textOf(identity.simpro_job_number || project.simpro_job_number),
    title: textOf(identity.project_work_title || project.project_title),
    engineer: textOf(identity.engineer_survey_date || project.engineer),
    workType: textOf(identity.work_type || asRecord(answers.control).work_type),
    systemState: textOf(identity.system_state_at_visit),
    scope: textOf(design.protected_areas || description.system_description),
  };
}

export async function extractPdfFields(bytes: ArrayBuffer): Promise<{
  fields: ExtractedPdfField[];
  flag: string | null;
}> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = pdf.getForm();
    const fields = form.getFields();
    if (fields.length === 0) {
      return { fields: [], flag: 'flattened_or_unreadable' };
    }
    const extracted: ExtractedPdfField[] = [];
    for (const field of fields) {
      const name = field.getName();
      if (field instanceof PDFTextField) {
        extracted.push({ name, type: 'text', value: field.getText() ?? '' });
      } else if (field instanceof PDFDropdown) {
        extracted.push({ name, type: 'dropdown', value: field.getSelected().join(', ') });
      } else if (field instanceof PDFCheckBox) {
        extracted.push({ name, type: 'checkbox', value: field.isChecked() });
      } else {
        extracted.push({ name, type: field.constructor.name, value: '' });
      }
    }
    return { fields: extracted, flag: null };
  } catch {
    return { fields: [], flag: 'flattened_or_unreadable' };
  }
}
