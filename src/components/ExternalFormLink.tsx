import { ExternalLink } from 'lucide-react';
import { externalFormHref } from '../lib/handoverDocumentConfig';

/** Clickable form address for an Upload PDF handover document. */
export function ExternalFormLink({ url }: { url?: string | null }) {
  const href = externalFormHref(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-cyan-800 hover:bg-cyan-100"
    >
      <ExternalLink className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">Open form</span>
        <span className="block text-xs break-all underline">{href}</span>
        <span className="block text-xs text-slate-500 no-underline mt-1">Fill the form, download it, then upload the PDF.</span>
      </span>
    </a>
  );
}
