import { useCallback, useEffect, useMemo, useState } from 'react';
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

const MIXED_STATUS = '__mixed__';

interface AsFittedItem {
  id: string;
  quoted_description: string | null;
  quoted_quantity: number | null;
  installed_description: string | null;
  actual_installed_quantity: number | null;
  reconciliation_status: string;
  change_reason: string | null;
}

function seededQuantity(item: Pick<AsFittedItem, 'actual_installed_quantity' | 'quoted_quantity'>): number | null {
  if (item.actual_installed_quantity != null) return Number(item.actual_installed_quantity);
  if (item.quoted_quantity != null) return Number(item.quoted_quantity);
  return null;
}

export function AsFittedItemsPanel({ projectId }: { projectId: number | null }) {
  const [items, setItems] = useState<AsFittedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);

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
      setLoading(false);
      return;
    }
    setMissingTable(false);
    const rows = ((data ?? []) as AsFittedItem[]).map(item => ({
      ...item,
      actual_installed_quantity: seededQuantity(item),
    }));
    setItems(rows);
    const toSeed = rows.filter((item, index) => item.actual_installed_quantity != null && (data ?? [])[index]?.actual_installed_quantity == null);
    if (toSeed.length > 0) {
      await Promise.all(toSeed.map(item =>
        supabase.from('as_fitted_items').update({ actual_installed_quantity: item.actual_installed_quantity }).eq('id', item.id),
      ));
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const sharedStatus = useMemo(() => {
    const statuses = [...new Set(items.map(item => item.reconciliation_status))];
    return statuses.length === 1 ? statuses[0] : MIXED_STATUS;
  }, [items]);

  const updateItem = async (id: string, patch: Partial<AsFittedItem>) => {
    await supabase.from('as_fitted_items').update(patch).eq('id', id);
    setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const applyStatusToAll = async (status: string) => {
    if (!projectId || !status || status === MIXED_STATUS || applyingAll) return;
    setApplyingAll(true);
    await supabase.from('as_fitted_items').update({ reconciliation_status: status }).eq('project_id', projectId);
    setItems(current => current.map(item => ({ ...item, reconciliation_status: status })));
    setApplyingAll(false);
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
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Quoted vs as-fitted equipment</h3>
          <p className="text-xs text-slate-500 mt-1">
            Installed quantity starts as the quoted quantity. Set one status for every line, then change any that differ.
          </p>
        </div>
        <label className="text-xs text-slate-500 min-w-[12rem]">
          Status for all lines
          <select
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
            value={sharedStatus}
            disabled={applyingAll}
            onChange={event => void applyStatusToAll(event.target.value)}
          >
            {sharedStatus === MIXED_STATUS && <option value={MIXED_STATUS} disabled>Multiple statuses</option>}
            {STATUSES.map(status => (
              <option key={status} value={status}>{humanizeOption(status)}</option>
            ))}
          </select>
        </label>
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
                  actual_installed_quantity: event.target.value === ''
                    ? (item.quoted_quantity != null ? Number(item.quoted_quantity) : null)
                    : Number(event.target.value),
                })}
              />
            </label>
            <label className="text-xs text-slate-500">
              Status
              <select
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                value={item.reconciliation_status}
                disabled={applyingAll}
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
