import { supabase } from './supabase';
import type { FormAnswers } from './schemaForm';
import type { SimproRefreshSnapshot } from './sdpAnswers';

export type SdpRevisionStatus =
  | 'draft'
  | 'issued'
  | 'returned'
  | 'needs_correction'
  | 'technically_reviewed'
  | 'finalised';

export interface SdpRevision {
  id: number;
  project_id: number;
  revision_no: number;
  kind: 'proposed' | 'as_fitted';
  status: SdpRevisionStatus;
  answers: FormAnswers;
  source_snapshot: SimproRefreshSnapshot | null;
  signed_pdf_url: string | null;
  engineer_signed_at: string | null;
  customer_signed_at: string | null;
  parent_revision_id: number | null;
  created_at: string;
  updated_at: string;
}

function missingTable(message: string): boolean {
  return /does not exist|schema cache|sdp_revisions/i.test(message);
}

export function explainSdpTableError(message: string): string {
  if (missingTable(message)) {
    return 'Run Copy 035–036 SQL in Supabase so SDP revisions can be saved.';
  }
  return message;
}

export async function listSdpRevisions(projectId: number): Promise<SdpRevision[]> {
  const { data, error } = await supabase
    .from('sdp_revisions')
    .select('*')
    .eq('project_id', projectId)
    .order('revision_no', { ascending: false });
  if (error) throw new Error(explainSdpTableError(error.message));
  return (data ?? []) as SdpRevision[];
}

export async function saveSdpRevision(row: Partial<SdpRevision> & { project_id: number; revision_no: number; kind: 'proposed' | 'as_fitted'; answers: FormAnswers }): Promise<SdpRevision> {
  const payload = {
    ...row,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('sdp_revisions')
    .upsert(payload, { onConflict: 'project_id,revision_no' })
    .select()
    .single();
  if (error) throw new Error(explainSdpTableError(error.message));
  return data as SdpRevision;
}

export async function insertSdpRevision(row: {
  project_id: number;
  revision_no: number;
  kind: 'proposed' | 'as_fitted';
  status?: SdpRevisionStatus;
  answers: FormAnswers;
  source_snapshot?: SimproRefreshSnapshot | null;
  parent_revision_id?: number | null;
}): Promise<SdpRevision> {
  const { data, error } = await supabase.from('sdp_revisions').insert({
    project_id: row.project_id,
    revision_no: row.revision_no,
    kind: row.kind,
    status: row.status ?? 'draft',
    answers: row.answers,
    source_snapshot: row.source_snapshot ?? null,
    parent_revision_id: row.parent_revision_id ?? null,
  }).select().single();
  if (error) throw new Error(explainSdpTableError(error.message));
  return data as SdpRevision;
}
