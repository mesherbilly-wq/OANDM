import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Loader2, Mail, Plus, Save, FileText } from 'lucide-react';
import { SchemaForm } from '../components/SchemaForm';
import { FormLetterhead } from '../components/FormLetterhead';
import { useProject } from './ProjectLayout';
import { supabase } from '../lib/supabase';
import { fetchPublicContractorBrand, type ContractorBrand } from '../lib/contractorBrand';
import { getSdpSchema } from '../lib/systemDesignProposal';
import {
  applySdpKind,
  buildSdpAnswers,
  buildSdpSnapshot,
  clearSdpSignatures,
  reconcileSimproRefresh,
  sdpHasBothSignatures,
  sdpKindOf,
  type SdpDiff,
} from '../lib/sdpAnswers';
import { insertSdpRevision, listSdpRevisions, saveSdpRevision, type SdpRevision } from '../lib/sdpRevisionsApi';
import { buildPacificPdf, jobRefFromProject, uploadProjectPdf } from '../lib/pacificPdf';
import type { FormAnswers } from '../lib/schemaForm';

export default function SdpPage() {
  const { project } = useProject();
  const schema = useMemo(() => getSdpSchema(), []);
  const [brand, setBrand] = useState<ContractorBrand | null>(null);
  const [revisions, setRevisions] = useState<SdpRevision[]>([]);
  const [current, setCurrent] = useState<SdpRevision | null>(null);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<SdpDiff[]>([]);

  const signed = sdpHasBothSignatures(answers);
  const kind = sdpKindOf(answers);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: scopeRow }, { data: asFitted }, { data: systems }, contractor, rows] = await Promise.all([
        supabase.from('project_documents').select('content').eq('project_id', project.id).eq('document_type', 'scope_of_works').maybeSingle(),
        supabase.from('as_fitted_items').select('quoted_description,quoted_quantity,source_quote_line_id').eq('project_id', project.id),
        supabase.from('project_systems').select('category,name').eq('project_id', project.id),
        fetchPublicContractorBrand(),
        listSdpRevisions(project.id),
      ]);
      setBrand(contractor);
      const imported = buildSdpAnswers({
        project,
        scopeText: scopeRow?.content ?? project.project_notes,
        equipment: (asFitted ?? []).map(item => ({
          item: item.quoted_description,
          qty_proposed: item.quoted_quantity,
          source: item.source_quote_line_id ? `Simpro line ${item.source_quote_line_id}` : 'Simpro quote line',
        })),
        discipline: (systems ?? []).map(item => item.category || item.name).filter(Boolean).join(', ') || undefined,
      });
      const snapshot = buildSdpSnapshot(project, scopeRow?.content ?? project.project_notes);
      if (rows.length === 0) {
        const created = await insertSdpRevision({
          project_id: project.id,
          revision_no: 1,
          kind: 'proposed',
          answers: imported,
          source_snapshot: snapshot,
        });
        setRevisions([created]);
        setCurrent(created);
        setAnswers(created.answers);
      } else {
        const latest = rows[0];
        const reconciled = reconcileSimproRefresh(latest.answers, imported, latest.source_snapshot, snapshot);
        setRevisions(rows);
        setCurrent(latest);
        setAnswers(reconciled.answers);
        setDiffs(reconciled.diffs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the SDP.');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => { void load(); }, [load]);

  const persist = async (nextAnswers: FormAnswers, extras: Partial<SdpRevision> = {}) => {
    if (!current) return;
    const kindNow = sdpKindOf(nextAnswers);
    const saved = await saveSdpRevision({
      id: current.id,
      project_id: project.id,
      revision_no: current.revision_no,
      kind: kindNow,
      status: extras.status ?? current.status,
      answers: nextAnswers,
      source_snapshot: current.source_snapshot,
      signed_pdf_url: extras.signed_pdf_url ?? current.signed_pdf_url,
      engineer_signed_at: extras.engineer_signed_at ?? current.engineer_signed_at,
      customer_signed_at: extras.customer_signed_at ?? current.customer_signed_at,
      parent_revision_id: current.parent_revision_id,
    });
    setCurrent(saved);
    setRevisions(rows => [saved, ...rows.filter(item => item.id !== saved.id)].sort((a, b) => b.revision_no - a.revision_no));
    return saved;
  };

  const saveDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      if (current && (current.status === 'finalised' || current.signed_pdf_url) && signed) {
        await persist(answers);
        setNotice(`Revision ${current.revision_no} saved. Signed copies stay on this revision.`);
      } else if (current?.signed_pdf_url && !signed) {
        setError('This revision was already signed. Use “New revision from this document” before changing the wording.');
      } else {
        await persist(answers, { status: 'draft' });
        setNotice('Draft saved.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const startNewRevision = async (nextKind: 'proposed' | 'as_fitted') => {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const nextNo = Math.max(...revisions.map(item => item.revision_no), current.revision_no) + 1;
      const nextAnswers = clearSdpSignatures(applySdpKind(answers, nextKind));
      const control = (nextAnswers.control && typeof nextAnswers.control === 'object' ? nextAnswers.control : {}) as Record<string, unknown>;
      control.revision_number = String(nextNo);
      control.parent_revision = String(current.revision_no);
      control.revision_date = new Date().toISOString().slice(0, 10);
      nextAnswers.control = control;
      const created = await insertSdpRevision({
        project_id: project.id,
        revision_no: nextNo,
        kind: nextKind,
        answers: nextAnswers,
        source_snapshot: current.source_snapshot,
        parent_revision_id: current.id,
      });
      setCurrent(created);
      setAnswers(created.answers);
      setRevisions(rows => [created, ...rows]);
      setNotice(`Revision ${nextNo} created as ${nextKind === 'as_fitted' ? 'as-fitted' : 'proposed'}. Signatures from revision ${current.revision_no} are preserved separately.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a new revision.');
    } finally {
      setSaving(false);
    }
  };

  const signAndLock = async () => {
    if (!sdpHasBothSignatures(answers)) {
      setError('Draw both the engineer and customer signatures before locking this revision.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const pdf = await buildPacificPdf({
        title: `System Design Proposal (SDP) Rev ${current?.revision_no ?? 1}`,
        brand,
        answers,
        schema,
        jobRef: jobRefFromProject(project),
        notice: kind === 'as_fitted'
          ? 'As-fitted revision. Signatures acknowledge the completed scope and disclosed changes.'
          : 'Proposed design revision. Signatures agree the proposed scope for this revision only.',
      });
      const url = await uploadProjectPdf({
        projectId: project.id,
        folder: 'sdp',
        fileName: pdf.fileName,
        pdfBase64: pdf.pdfBase64,
      });
      const signoff = (answers.signoff && typeof answers.signoff === 'object' ? answers.signoff : {}) as Record<string, unknown>;
      await persist(answers, {
        status: 'issued',
        signed_pdf_url: url,
        engineer_signed_at: String(signoff.engineer_signed_at || new Date().toISOString()),
        customer_signed_at: String(signoff.customer_signed_at || new Date().toISOString()),
      });
      await supabase.from('project_handover_docs').upsert({
        project_id: project.id,
        document_type: 'sdp',
        title: 'System Design Proposal (SDP)',
        status: 'completed',
        workflow_status: 'issued',
        revision_no: current?.revision_no ?? 1,
        file_name: pdf.fileName,
        file_url: url,
      }, { onConflict: 'project_id,document_type,system_type' });
      setNotice('Signed PDF saved. Later edits need a new revision.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the signed PDF.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">System Design Proposal (SDP)</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Revision {current?.revision_no ?? 1} · {kind === 'as_fitted' ? 'as-fitted record' : 'proposed design'}.
            Imported Simpro wording can be corrected. Signed copies stay on their revision.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="../handover" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700">
            <Mail className="w-3.5 h-3.5" />Email pack
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-2 rounded-lg">{error}</p>}
      {notice && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg">{notice}</p>}
      {diffs.length > 0 && (
        <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="font-semibold text-amber-900">Simpro data changed since this revision was last imported. Your edits were kept.</p>
          <ul className="mt-2 space-y-1 text-amber-900/90">
            {diffs.map(diff => (
              <li key={diff.field}><span className="font-mono text-xs">{diff.field}</span>: current “{diff.current}” · Simpro now “{diff.imported}”</li>
            ))}
          </ul>
        </div>
      )}

      {current?.signed_pdf_url && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          <CheckCircle className="w-4 h-4 text-emerald-600" />
          <p className="text-sm text-emerald-800 flex-1">This revision has a signed PDF. Change the wording on a new revision.</p>
          <a href={current.signed_pdf_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-800 underline">View signed PDF</a>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void saveDraft()} disabled={saving} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save draft
        </button>
        <button type="button" onClick={() => void signAndLock()} disabled={saving} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-[#C00000] text-white hover:bg-[#a00000] disabled:opacity-50">
          Save signed PDF
        </button>
        <button type="button" onClick={() => void startNewRevision('proposed')} disabled={saving} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" />New proposed revision
        </button>
        <button type="button" onClick={() => void startNewRevision('as_fitted')} disabled={saving} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" />Start as-fitted revision
        </button>
      </div>

      <div className="bg-white border border-[#404040] shadow-sm overflow-hidden">
        <FormLetterhead
          brand={brand}
          title="System Design Proposal (SDP)"
          subtitle={kind === 'as_fitted' ? 'As-fitted revision' : 'Proposed design revision'}
          jobRef={jobRefFromProject(project)}
        />
        <div className="p-4 sm:p-6">
          <SchemaForm schema={schema} answers={answers} onChange={setAnswers} />
        </div>
      </div>

      {revisions.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-800">Revision history</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {revisions.map(item => (
              <li key={item.id} className="flex items-center gap-3">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Rev {item.revision_no} · {item.kind} · {item.status}</span>
                {item.signed_pdf_url && <a href={item.signed_pdf_url} className="text-cyan-700 text-xs underline" target="_blank" rel="noreferrer">signed PDF</a>}
                <button type="button" className="text-xs text-slate-500 underline" onClick={() => { setCurrent(item); setAnswers(item.answers); }}>open</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
