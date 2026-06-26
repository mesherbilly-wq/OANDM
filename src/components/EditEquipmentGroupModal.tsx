import React, { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import type { GroupedEquipment } from '../lib/deviceGrouping';
import { MAX_DEVICES_PER_LINE } from '../lib/devicePersistConstants';
import { updateEquipmentGroup, type EquipmentGroupUpdates } from '../lib/deviceProjectEdits';

interface Props {
  projectId: number;
  group: GroupedEquipment;
  prefixCounters: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}

export function EditEquipmentGroupModal({
  projectId,
  group,
  prefixCounters,
  onClose,
  onSaved,
}: Props) {
  const [manufacturer, setManufacturer] = useState(group.manufacturer ?? '');
  const [modelNumber, setModelNumber] = useState(group.model_number ?? '');
  const [description, setDescription] = useState(group.description ?? '');
  const [location, setLocation] = useState(
    [...new Set(group.devices.map(device => device.location?.trim()).filter(Boolean))][0] ?? '',
  );
  const [notes, setNotes] = useState(
    [...new Set(group.devices.map(device => device.notes?.trim()).filter(Boolean))][0] ?? '',
  );
  const [quantity, setQuantity] = useState(String(group.quantity));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ic = 'w-full border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-slate-900 bg-white text-sm';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const parsedQty = parseInt(quantity, 10);
    const updates: EquipmentGroupUpdates = {
      manufacturer: manufacturer.trim() || null,
      model_number: modelNumber.trim() || null,
      device_type: description.trim() || null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      quantity: Number.isFinite(parsedQty) ? parsedQty : group.quantity,
    };

    const message = await updateEquipmentGroup(projectId, group, updates, { ...prefixCounters });
    if (message) {
      setError(message);
      setSaving(false);
      return;
    }

    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Edit Equipment Group</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Updates all {group.quantity} matching device row{group.quantity !== 1 ? 's' : ''} in this system
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 p-5 space-y-4">
            {error && (
              <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Description</label>
              <input value={description} onChange={event => setDescription(event.target.value)} className={ic} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Manufacturer</label>
                <input value={manufacturer} onChange={event => setManufacturer(event.target.value)} className={ic} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Model / Part No.</label>
                <input value={modelNumber} onChange={event => setModelNumber(event.target.value)} className={ic} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Quantity</label>
              <input
                type="number"
                min={1}
                max={MAX_DEVICES_PER_LINE}
                value={quantity}
                onChange={event => setQuantity(event.target.value)}
                className={ic}
              />
              <p className="text-xs text-slate-400 mt-1">
                Individual view lists one row per unit. Grouped view shows this total (max {MAX_DEVICES_PER_LINE} per line).
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Location</label>
              <input value={location} onChange={event => setLocation(event.target.value)} className={ic} />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Notes</label>
              <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} className={`${ic} resize-none`} />
            </div>
          </div>

          <div className="px-5 py-4 bg-slate-50 rounded-b-2xl flex justify-end gap-3 border-t border-slate-200 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium text-sm disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
