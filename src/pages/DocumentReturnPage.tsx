import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { extractPdfFields } from '../lib/pacificTemplateFill';

export default function DocumentReturnPage() {
  const { token = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [older, setOlder] = useState(false);
  const [meta, setMeta] = useState<{ document_id?: string; revision_no?: number; status?: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_document_return', { p_token: token });
      if (cancelled) return;
      if (rpcError) {
        setError(/does not exist|schema cache/i.test(rpcError.message)
          ? 'Return links are not enabled yet. Paste Copy 035–036 SQL in Supabase.'
          : 'This return link is not valid.');
        setLoading(false);
        return;
      }
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      setMeta(parsed);
      if (parsed?.status === 'received') setDuplicate(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError('Choose the completed PDF first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const bytes = await file.arrayBuffer();
      const extracted = await extractPdfFields(bytes);
      const path = `returns/${token}/${file.name}`;
      const { error: uploadError } = await supabase.storage.from('om-uploads').upload(path, file, {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (uploadError) throw new Error(uploadError.message);
      const fileUrl = supabase.storage.from('om-uploads').getPublicUrl(path).data.publicUrl;
      const { data, error: rpcError } = await supabase.rpc('complete_document_return', {
        p_token: token,
        p_file_name: file.name,
        p_file_url: fileUrl,
        p_extraction: { fields: extracted.fields },
        p_flag: extracted.flag,
      });
      if (rpcError) throw new Error(rpcError.message);
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      setDuplicate(Boolean(result?.duplicate));
      setOlder(Boolean(result?.older_revision));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the returned PDF.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-400 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-800" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-400 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border-2 border-slate-900 p-8 text-center space-y-3">
          <CheckCircle className="w-10 h-10 text-emerald-600 mx-auto" />
          <h1 className="text-xl font-semibold">Document received</h1>
          <p className="text-sm text-slate-600">
            {older
              ? 'This file is an older revision. It was stored but did not replace the current job record.'
              : duplicate
                ? 'This return link was already used. The file was stored without replacing a newer revision.'
                : `${meta?.document_id ?? 'Document'} has been saved against the job.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e8e8e8] flex items-center justify-center p-6">
      <form onSubmit={submit} className="max-w-lg w-full bg-white border border-[#404040] shadow-xl p-6 space-y-4">
        <h1 className="text-lg font-semibold text-slate-900">Return signed document</h1>
        <p className="text-sm text-slate-600">
          Upload the completed PDF for {meta?.document_id ?? 'this document'}
          {meta?.revision_no ? ` revision ${meta.revision_no}` : ''}. The original file is kept, including any signatures.
        </p>
        {duplicate && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">
            This link was used before. A further upload is stored as a duplicate and will not replace a newer revision.
          </p>
        )}
        <input
          type="file"
          accept="application/pdf"
          onChange={event => setFile(event.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full px-4 py-3 bg-[#C00000] text-white font-semibold uppercase tracking-wide text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Upload and save to job'}
        </button>
      </form>
    </div>
  );
}
