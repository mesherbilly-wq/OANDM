import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { humanizeOption } from '../lib/schemaForm';

const STATUSES = [
  'awaiting_verification',
  'installed_as_quoted',
  'modified',
  'omitted',
  'added_on_site',
  'existing_retained',
] as const;

interface AsFittedItem {
  id: string;
  quoted_description: string | null;
  quoted_quantity: number | null;
  installed_description: string | null;
  actual_installed_quantity: number | null;
  reconciliation_status: string;
  change_reason: string | null;
}

export function AsFittedItemsPanel({ projectId }: { projectId: number | null }) {
  const [items, setItems] = useState<AsFittedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('as_fitted_items')
      .select('id,quoted_description,quoted_quantity,installed_description,actual_installed_quantity,reconciliation_status,change_reason')
      .eq('project_id', projectId)
      .order('created_at');
    if (error && /does not exist|schema cache/i.test(error.message)) {
      setMissingTable(true);
      setItems([]);
    } else {
      setMissingTable(false);
      setItems((data ?? []) as AsFittedItem[]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const updateItem = async (id: string, patch: Partial<AsFittedItem>) => {
    await supabase.from('as_fitted_items').update(patch).eq('id', id);
    setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  if (loading) {
    return <div className="mb-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />Loading as-fitted items…</div>;
  }
  if (missingTable) {
    return (
      <div className="mb-6 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        Run migration 026_intruder_master_form.sql to store quoted vs installed equipment. Quoted quantities stay unverified until you confirm them here.
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Quoted vs as-fitted equipment</h3>
        <p className="text-xs text-slate-500 mt-1">
          Quote quantities are proposed only. Actual installed quantity starts blank until verified. This is not proof of installation or test.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map(item => (
          <div key={item.id} className="px-5 py-3 grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
            <div className="md:col-span-2">
              <p className="text-sm text-slate-800">{item.quoted_description || 'Untitled line'}</p>
              <p className="text-xs text-slate-400 mt-0.5">Quoted: {item.quoted_quantity ?? '—'}</p>
            </div>
            <label className="text-xs text-slate-500">
              Installed qty
              <input
                type="number"
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={item.actual_installed_quantity ?? ''}
                onChange={event => void updateItem(item.id, {
                  actual_installed_quantity: event.target.value === '' ? null : Number(event.target.value),
                })}
              />
            </label>
            <label className="text-xs text-slate-500">
              Status
              <select
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                value={item.reconciliation_status}
                onChange={event => void updateItem(item.id, { reconciliation_status: event.target.value })}
              >
                {STATUSES.map(status => (
                  <option key={status} value={status}>{humanizeOption(status)}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Change reason
              <input
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                value={item.change_reason ?? ''}
                onChange={event => void updateItem(item.id, { change_reason: event.target.value || null })}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
