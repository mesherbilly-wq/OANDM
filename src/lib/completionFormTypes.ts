export const COMPLETION_TEMPLATE_KEY = 'cctv_ncp104_completion';
export const COMPLETION_TEMPLATE_VERSION = 1;

export type CompletionFormStatus =
  | 'draft'
  | 'issued'
  | 'opened'
  | 'in_progress'
  | 'submitted'
  | 'returned'
  | 'awaiting_review'
  | 'awaiting_customer'
  | 'complete'
  | 'revoked'
  | 'superseded';

export type CompletionTokenRole = 'engineer' | 'customer';

export type CompletionSaveState = 'saved' | 'saving' | 'unsaved' | 'offline' | 'error';

export type CompletionFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'tel'
  | 'email'
  | 'select'
  | 'multiselect'
  | 'test_result'
  | 'photo'
  | 'note'
  | 'declaration'
  | 'signature';

export type CompletionShowWhen = {
  field: string;
  op: 'eq' | 'in' | 'includes' | 'neq';
  values: string[];
  scope?: 'row' | 'section';
};

export interface CompletionField {
  id: string;
  label: string;
  type: CompletionFieldType;
  required?: boolean;
  options?: string[];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  inputMode?: 'decimal' | 'numeric' | 'tel' | 'email' | 'text';
  help?: string;
  sensitive?: boolean;
  customerVisible?: boolean;
  showWhen?: CompletionShowWhen[];
  reasonWhen?: string[];
  source?: string;
}

export interface CompletionGroup {
  id: string;
  title: string;
  addLabel: string;
  nameTemplate: string;
  identityFields: string[];
  fields: CompletionField[];
  nested?: CompletionGroup[];
  showWhen?: CompletionShowWhen[];
  source?: string;
}

export interface CompletionSection {
  id: string;
  title: string;
  summary: string;
  customerVisible?: boolean;
  fields?: CompletionField[];
  groups?: CompletionGroup[];
  note?: string;
  source?: string;
}

export interface CompletionReviewFlag {
  id: string;
  source: string;
  wording: string;
  reason: string;
}

export interface CompletionTemplateSchema {
  key: string;
  version: number;
  title: string;
  statusNotice: string;
  sections: CompletionSection[];
  reviewFlags: CompletionReviewFlag[];
}

export interface CompletionPhoto {
  id: string;
  fieldPath: string;
  fileName: string;
  caption: string;
  contentType: string;
  status: 'uploading' | 'ready' | 'failed';
  error?: string;
  signedUrl?: string;
}

export interface CompletionTestResult {
  result: '' | 'pass' | 'fail' | 'not_tested' | 'not_applicable';
  reason: string;
}

export type CompletionAnswers = Record<string, unknown>;

export interface CompletionSignature {
  name: string;
  company?: string;
  role: string;
  accepted: boolean;
  dataUrl: string;
  signedAt: string;
  revisionNo: number;
}

export interface CompletionFormSummary {
  id: number;
  project_id: number;
  template_key: string;
  template_version: number;
  title: string;
  status: CompletionFormStatus;
  assigned_name: string | null;
  assigned_email: string | null;
  assigned_company: string | null;
  issued_at: string | null;
  expires_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  current_revision_no: number;
  pdf_url: string | null;
  pdf_file_name: string | null;
  review_note: string | null;
  outstanding_handover_authorised: boolean;
  simpro_attach_status: string | null;
  simpro_attach_error: string | null;
}

export interface CompletionPublicForm {
  token: string;
  role: CompletionTokenRole;
  status: CompletionFormStatus;
  title: string;
  schema: CompletionTemplateSchema;
  answers: CompletionAnswers;
  photos: CompletionPhoto[];
  revisionNo: number;
  revisionLocked: boolean;
  project: {
    jobNumber: string;
    projectName: string;
    clientName: string;
    siteName: string;
    siteAddress: string;
    projectManager: string;
    engineer: string;
  };
  companyName: string;
  assignedName: string | null;
  expiresAt: string | null;
  reviewNote: string | null;
  outstandingHandoverAuthorised: boolean;
  offlineSupported: false;
  signatureNotice: string;
}
