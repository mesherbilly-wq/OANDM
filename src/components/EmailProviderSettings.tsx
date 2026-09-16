import { useEffect, useState } from 'react';
import { getEmailSettings, saveEmailSettings, type EmailProvider } from '../lib/emailSettings';

export function EmailProviderSettings() {
  const [provider, setProvider] = useState<EmailProvider>('development');
  const [from, setFrom] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getEmailSettings().then(settings => {
      setProvider(settings.provider);
      setFrom(settings.from);
    }).catch(() => undefined);
  }, []);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await saveEmailSettings(provider, from);
      setNotice('Email settings saved.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save email settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Email for completion packs</h2>
      <p className="text-sm text-slate-500 mt-1">
        Development mode writes the message to the project outbox and opens a mail draft. Resend sends from the configured address when the handover-forms function has <code>RESEND_API_KEY</code>.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Provider
          <select value={provider} onChange={event => setProvider(event.target.value as EmailProvider)} className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2">
            <option value="development">Development (outbox + mailto)</option>
            <option value="mailto">Mailto only</option>
            <option value="resend">Resend</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          From address
          <input value={from} onChange={event => setFrom(event.target.value)} placeholder="Pacific <docs@yourdomain>" className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
        </label>
      </div>
      <button type="button" onClick={() => void save()} disabled={saving} className="mt-4 text-xs font-medium px-3 py-2 rounded-lg bg-cyan-600 text-white disabled:opacity-50">
        {saving ? 'Saving…' : 'Save email settings'}
      </button>
      {notice && <p className="text-xs text-slate-600 mt-2">{notice}</p>}
    </div>
  );
}
