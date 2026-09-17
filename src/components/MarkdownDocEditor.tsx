import { useEffect, useState } from 'react';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';
import { looksLikeHtml, sanitizeSimproHtml } from '../integrations/connectors/simpro/simproImportHelpers';

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  let out = '';
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|\s*[-:]+/.test(line)) continue;
    if (line.startsWith('| ')) {
      if (!inTable) { out += '<table class="w-full text-sm border-collapse mb-4">'; inTable = true; }
      const cells = line.slice(1, -1).split('|').map(c =>
        `<td class="border border-slate-200 px-3 py-1.5">${inline(c.trim())}</td>`).join('');
      out += `<tr>${cells}</tr>`;
      continue;
    }
    if (inTable) { out += '</table>'; inTable = false; }
    if (line.startsWith('#### ')) { out += `<h4 class="text-sm font-semibold mt-3 mb-1 text-slate-700">${inline(line.slice(5))}</h4>`; continue; }
    if (line.startsWith('### ')) { out += `<h3 class="text-base font-bold mt-4 mb-1.5 text-slate-800">${inline(line.slice(4))}</h3>`; continue; }
    if (line.startsWith('## ')) { out += `<h2 class="text-lg font-bold mt-5 mb-2 text-slate-900">${inline(line.slice(3))}</h2>`; continue; }
    if (line.startsWith('# ')) { out += `<h1 class="text-xl font-bold mt-6 mb-2 text-slate-900">${inline(line.slice(2))}</h1>`; continue; }
    if (/^[-*] /.test(line)) { out += `<li class="ml-4 text-sm text-slate-700 list-disc">${inline(line.slice(2))}</li>`; continue; }
    if (/^\d+\. /.test(line)) { out += `<li class="ml-4 text-sm text-slate-700 list-decimal">${inline(line.replace(/^\d+\. /, ''))}</li>`; continue; }
    if (line === '') { out += '<div class="h-2"></div>'; continue; }
    out += `<p class="text-sm text-slate-700 mb-1.5">${inline(line)}</p>`;
  }
  if (inTable) out += '</table>';
  return out;
}

function inline(t: string): string {
  const safe = t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="font-mono text-xs bg-slate-100 px-1 rounded">$1</code>');
}

export function renderDocumentHtml(content: string): string {
  if (looksLikeHtml(content)) return sanitizeSimproHtml(content);
  return renderMarkdown(content);
}

export function documentPreviewClassName(content: string, extra = 'min-h-64'): string {
  const base = `p-4 border border-slate-200 rounded-lg max-w-none ${extra}`.trim();
  return looksLikeHtml(content)
    ? `${base} bg-white simpro-html`
    : `${base} bg-slate-50 prose prose-sm`;
}

export function MarkdownDocEditor({
  title,
  content,
  onChange,
  onSave,
  saving,
  placeholder,
  emptyHint,
  readOnly,
  isAiGenerated,
  onRegenerate,
  regenerating,
  missingSystems,
  extraAction,
}: {
  title: string;
  content: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  placeholder: string;
  emptyHint?: string;
  readOnly?: boolean;
  isAiGenerated?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
  missingSystems?: string[];
  extraAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const htmlDoc = looksLikeHtml(content);
  const [preview, setPreview] = useState(!!readOnly || htmlDoc);
  const missing = (missingSystems ?? []).filter(sys => !content.includes(sys));

  useEffect(() => {
    if (htmlDoc) setPreview(true);
  }, [htmlDoc]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-slate-400" />
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {isAiGenerated && <span className="text-xs text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-full font-medium ml-1">AI Generated</span>}
        {!readOnly && (
          <div className="ml-auto flex items-center gap-2">
            {extraAction && (
              <button
                type="button"
                onClick={extraAction.onClick}
                disabled={extraAction.disabled || regenerating}
                className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors disabled:opacity-40"
              >
                {extraAction.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreview(p => !p)}
              disabled={regenerating}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors disabled:opacity-40"
            >
              {preview ? 'Edit' : (htmlDoc ? 'View layout' : 'Preview')}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || regenerating}
              className="text-xs font-medium px-3 py-1 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {missing.length > 0 && !regenerating && !readOnly && onRegenerate && (
        <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 mb-0.5">
              {missing.length} system{missing.length > 1 ? 's' : ''} not in scope
            </p>
            <p className="text-xs text-amber-700">
              <strong>{missing.join(', ')}</strong> {missing.length > 1 ? 'have' : 'has'} devices but {missing.length > 1 ? 'are' : 'is'} not mentioned in this scope of works.
            </p>
          </div>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={saving}
            className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            Regenerate scope
          </button>
        </div>
      )}

      {regenerating && (
        <div className="mb-4 flex items-center gap-3 bg-cyan-50 border border-cyan-200 rounded-xl px-4 py-3">
          <Loader2 className="w-4 h-4 text-cyan-600 animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-cyan-800">Generating scope of works…</p>
            <p className="text-xs text-cyan-600">Claude is writing a scope based on your installed devices</p>
          </div>
        </div>
      )}

      {!content && !preview && !readOnly && missing.length === 0 && !regenerating && emptyHint && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          {emptyHint}
        </div>
      )}

      {preview || readOnly ? (
        <div
          className={documentPreviewClassName(content)}
          dangerouslySetInnerHTML={{ __html: content ? renderDocumentHtml(content) : '<p class="text-slate-400 text-sm">Nothing to preview.</p>' }}
        />
      ) : (
        <textarea
          value={content}
          onChange={e => onChange(e.target.value)}
          disabled={regenerating}
          rows={20}
          placeholder={placeholder}
          className={`w-full border border-slate-300 rounded-lg px-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none disabled:opacity-50 disabled:bg-slate-50 ${htmlDoc ? 'text-[11pt] leading-snug font-sans' : 'text-sm font-mono'}`}
        />
      )}
      {saving && (
        <p className="mt-2 text-xs text-slate-500 inline-flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />Saving
        </p>
      )}
    </div>
  );
}
