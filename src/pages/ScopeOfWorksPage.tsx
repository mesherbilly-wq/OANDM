import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileUp, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { MarkdownDocEditor, renderDocumentHtml, documentPreviewClassName } from '../components/MarkdownDocEditor';
import { prepareCustomerScopeHtml } from '../lib/scopeOfWorksHtml';

export default function ScopeOfWorksPage() {
  const { id } = useParams<{ id: string }>();
  const pid = id ? parseInt(id) : null;
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [docId, setDocId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pastePreview, setPastePreview] = useState('');

  const load = useCallback(async () => {
    if (!pid) return;
    const { data: docs } = await supabase
      .from('project_documents')
      .select('id, content')
      .eq('project_id', pid)
      .eq('document_type', 'scope_of_works')
      .limit(1);

    const existing = docs?.[0];
    setDocId(existing?.id ?? null);
    setContent(existing?.content ?? '');
    setLoading(false);
  }, [pid]);

  useEffect(() => { void load(); }, [load]);

  const saveScope = async (nextContent = content) => {
    if (!pid) return;
    setSaving(true);
    if (docId) {
      await supabase.from('project_documents').update({
        content: nextContent,
        status: 'draft',
      }).eq('id', docId);
    } else {
      const { data } = await supabase.from('project_documents').insert({
        project_id: pid,
        document_type: 'scope_of_works',
        title: 'Scope of Works',
        content: nextContent,
        status: 'draft',
        generated_by: 'manual',
      }).select('id').single();
      setDocId(data?.id ?? null);
    }
    setContent(nextContent);
    setSaving(false);
  };

  const applyImportedHtml = async (raw: string) => {
    const cleaned = prepareCustomerScopeHtml(raw);
    if (!cleaned) {
      setImportError('Nothing usable was left after removing the device schedule and commercial costs.');
      return;
    }
    if (content.trim() && content.trim() !== cleaned && !window.confirm('Replace the current Scope of Works with this import?')) {
      return;
    }
    setImportError(null);
    setShowPaste(false);
    setPastePreview('');
    await saveScope(cleaned);
  };

  const onPasteHtml = (event: React.ClipboardEvent) => {
    const html = event.clipboardData.getData('text/html') || event.clipboardData.getData('text/plain');
    if (!html.trim()) return;
    event.preventDefault();
    const cleaned = prepareCustomerScopeHtml(html);
    if (!cleaned) {
      setPastePreview('');
      setImportError('Nothing usable was left after removing the device schedule and commercial costs.');
      return;
    }
    setImportError(null);
    setPastePreview(cleaned);
  };

  const onPickFile = async (file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.pdf')) {
      setImportError('Paste from Word or Simpro, or upload an HTML file, so the original layout can be kept.');
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const text = await file.text();
      await applyImportedHtml(text);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read that file.');
    }
    setImporting(false);
  };

  const stripExisting = () => {
    const cleaned = prepareCustomerScopeHtml(content);
    if (!cleaned) {
      setImportError('Nothing usable was left after removing the device schedule and commercial costs.');
      return;
    }
    setImportError(null);
    setContent(cleaned);
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
        <h2 className="text-lg font-semibold text-slate-900">Scope of Works</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Filled automatically from Simpro. You can also paste or upload a quote — layout is kept, device schedules and commercial costs are removed.
        </p>
      </div>

      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
        onDrop={event => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file) void onPickFile(file);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm,.txt,text/html,text/plain"
          className="hidden"
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onPickFile(file);
          }}
        />
        <button
          type="button"
          disabled={importing || saving}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
          Import HTML
        </button>
        <button
          type="button"
          disabled={importing || saving}
          onClick={() => { setShowPaste(open => !open); setImportError(null); }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Paste from Word / Simpro
        </button>
      </div>

      {importError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {importError}
        </div>
      )}

      {showPaste && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-800">Paste the quote here</p>
          <p className="mt-1 text-xs text-slate-500">
            Copy from Word or Simpro and paste. Style is kept; device schedule and prices are stripped.
          </p>
          <div
            contentEditable
            suppressContentEditableWarning
            onPaste={onPasteHtml}
            className="mt-3 min-h-24 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            Click here and paste…
          </div>
          {pastePreview && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview after cleanup</p>
              <div
                className={documentPreviewClassName(pastePreview, 'min-h-32 mt-2')}
                dangerouslySetInnerHTML={{ __html: renderDocumentHtml(pastePreview) }}
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void applyImportedHtml(pastePreview)}
                  className="rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700"
                >
                  Use this
                </button>
                <button
                  type="button"
                  onClick={() => { setPastePreview(''); setShowPaste(false); }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <MarkdownDocEditor
        title="Scope of Works"
        content={content}
        onChange={setContent}
        onSave={() => void saveScope()}
        saving={saving}
        placeholder="Enter Scope of Works here, or paste a quote above…"
        emptyHint="No Scope of Works yet. Import from Simpro when creating the project, or paste/upload a quote here."
        extraAction={{
          label: 'Remove schedule & costs',
          onClick: stripExisting,
          disabled: !content.trim() || importing || saving,
        }}
      />
    </div>
  );
}
