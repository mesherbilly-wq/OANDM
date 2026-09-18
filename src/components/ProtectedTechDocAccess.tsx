import React from 'react';
import { X } from 'lucide-react';

export function canPreviewTechDoc(fileName?: string | null): boolean {
  return /\.(pdf|png|jpe?g|gif|webp|txt|csv|html?)$/i.test(fileName || '');
}

export function ProtectedTechDocPasswordPrompt({
  title,
  actionLabel,
  password,
  error,
  busy,
  onPasswordChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  actionLabel: string;
  password: string;
  error: string | null;
  busy: boolean;
  onPasswordChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Enter document password</h2>
        <p className="text-sm text-slate-600">
          Enter the password to {actionLabel.toLowerCase()} <span className="font-semibold">{title}</span>.
        </p>
        <input
          type="password"
          value={password}
          onChange={e => onPasswordChange(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          autoComplete="current-password"
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter' && password.trim() && !busy) onConfirm();
          }}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !password.trim()}
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm bg-cyan-600 text-white rounded-lg disabled:opacity-40"
          >
            {busy ? 'Checking…' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProtectedTechDocViewer({
  url,
  title,
  fileName,
  onClose,
}: {
  url: string;
  title: string;
  fileName?: string | null;
  onClose: () => void;
}) {
  const preview = canPreviewTechDoc(fileName);
  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 truncate">{title}</p>
            {fileName && <p className="text-xs text-slate-500 truncate">{fileName}</p>}
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Open in new tab
          </a>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        {preview ? (
          <iframe title={title} src={url} className="flex-1 w-full bg-slate-100" />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <p className="text-sm text-slate-600">
              This file type can’t be previewed here. Use Open in new tab or Download.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
