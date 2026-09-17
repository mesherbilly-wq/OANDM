import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AsFittedItemsPanel } from '../components/AsFittedItemsPanel';
import { MarkdownDocEditor } from '../components/MarkdownDocEditor';

export default function AsFittedPage() {
  const { id } = useParams<{ id: string }>();
  const pid = id ? parseInt(id) : null;

  const [loading, setLoading] = useState(true);
  const [asFittedScope, setAsFittedScope] = useState('');
  const [asFittedScopeId, setAsFittedScopeId] = useState<number | null>(null);
  const [proposedScope, setProposedScope] = useState('');
  const [scopeSaving, setScopeSaving] = useState(false);

  const load = useCallback(async () => {
    if (!pid) return;
    const { data: docs } = await supabase
      .from('project_documents')
      .select('id, document_type, content')
      .eq('project_id', pid)
      .in('document_type', ['scope_of_works', 'as_fitted_scope']);

    const asFitted = (docs ?? []).find(d => d.document_type === 'as_fitted_scope');
    const proposed = (docs ?? []).find(d => d.document_type === 'scope_of_works');
    setProposedScope(proposed?.content ?? '');
    if (asFitted) {
      setAsFittedScopeId(asFitted.id);
      setAsFittedScope(asFitted.content ?? '');
    } else if (proposed?.content) {
      const { data: inserted } = await supabase.from('project_documents').insert({
        project_id: pid,
        document_type: 'as_fitted_scope',
        title: 'As Fitted',
        content: proposed.content,
        status: 'draft',
        generated_by: 'manual',
      }).select('id, content').single();
      setAsFittedScopeId(inserted?.id ?? null);
      setAsFittedScope(inserted?.content ?? proposed.content);
    } else {
      setAsFittedScopeId(null);
      setAsFittedScope('');
    }
    setLoading(false);
  }, [pid]);

  useEffect(() => { void load(); }, [load]);

  const saveAsFittedScope = async () => {
    if (!pid) return;
    setScopeSaving(true);
    if (asFittedScopeId) {
      await supabase.from('project_documents').update({ content: asFittedScope, status: 'final' }).eq('id', asFittedScopeId);
    } else {
      const { data } = await supabase.from('project_documents').insert({
        project_id: pid,
        document_type: 'as_fitted_scope',
        title: 'As Fitted',
        content: asFittedScope,
        status: 'final',
        generated_by: 'manual',
      }).select('id').single();
      setAsFittedScopeId(data?.id ?? null);
    }
    setScopeSaving(false);
  };

  const copyFromScope = () => {
    if (!proposedScope) return;
    if (asFittedScope.trim() && asFittedScope !== proposedScope && !window.confirm('Replace the as-fitted record with the current Scope of Works?')) return;
    setAsFittedScope(proposedScope);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900">As Fitted</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Starts as a copy of the Scope of Works. Edit it to match what was actually installed.
        </p>
      </div>

      <AsFittedItemsPanel projectId={pid} />

      <MarkdownDocEditor
        title="As Fitted"
        content={asFittedScope}
        onChange={setAsFittedScope}
        onSave={() => void saveAsFittedScope()}
        saving={scopeSaving}
        placeholder="Enter as-fitted works here (supports Markdown formatting)..."
        emptyHint="No as-fitted record yet. It copies the Scope of Works when that exists, or you can type it here."
        extraAction={proposedScope ? { label: 'Copy from Scope of Works', onClick: copyFromScope } : undefined}
      />
    </div>
  );
}
