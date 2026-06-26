import { useEffect, useRef, useState } from 'react';

import { Check, Pencil, Sparkles, X } from 'lucide-react';

import type { ProductModel } from '../types';

import {
  AUTO_MANUFACTURER_THRESHOLD,
  type PendingManufacturerSuggestion,
} from '../lib/autoManufacturerLookup';

import {

  MODEL_REQUIRED_MESSAGE,

  resolveManufacturerSuggestion,

  type ManufacturerSuggestion,

  type ManufacturerResolverInput,

} from '../lib/manufacturerSuggestion';



interface Props {

  context: ManufacturerResolverInput;

  productModels: ProductModel[];

  pendingSuggestion?: PendingManufacturerSuggestion | null;

  onAccept: (manufacturer: string, suggestion: ManufacturerSuggestion) => Promise<void>;

  onManualEdit: (draft: string) => void;

}



function pendingToSuggestion(pending: PendingManufacturerSuggestion): ManufacturerSuggestion {

  return {

    manufacturer: pending.manufacturer,

    source: pending.source,

    confidence: pending.confidence,

    reason: pending.reason,

    productId: null,

  };

}



export function ManufacturerSuggestHelper({

  context,

  productModels,

  pendingSuggestion,

  onAccept,

  onManualEdit,

}: Props) {

  const [open, setOpen] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [suggestion, setSuggestion] = useState<ManufacturerSuggestion | null>(null);

  const [accepting, setAccepting] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);



  useEffect(() => {

    if (!open) return;

    const handleClick = (event: MouseEvent) => {

      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {

        setOpen(false);

      }

    };

    document.addEventListener('mousedown', handleClick);

    return () => document.removeEventListener('mousedown', handleClick);

  }, [open]);



  const loadSuggestion = async () => {

    if (pendingSuggestion) {

      setOpen(true);

      setLoading(false);

      setError(null);

      setSuggestion(pendingToSuggestion(pendingSuggestion));

      return;

    }



    if (!context.modelNumber?.trim()) {

      setOpen(true);

      setLoading(false);

      setSuggestion(null);

      setError(MODEL_REQUIRED_MESSAGE);

      return;

    }



    setLoading(true);

    setError(null);

    setSuggestion(null);

    setOpen(true);



    const result = await resolveManufacturerSuggestion(context, productModels);

    setLoading(false);



    if ('error' in result) {

      setError(result.error);

      return;

    }



    setSuggestion(result);

  };



  const handleAccept = async () => {

    if (!suggestion) return;

    setAccepting(true);

    setError(null);

    try {

      await onAccept(suggestion.manufacturer, suggestion);

      setOpen(false);

      setSuggestion(null);

    } catch (acceptError) {

      setError(acceptError instanceof Error ? acceptError.message : 'Failed to apply manufacturer.');

    } finally {

      setAccepting(false);

    }

  };



  const refreshLookup = async () => {

    if (!context.modelNumber?.trim()) {

      setError(MODEL_REQUIRED_MESSAGE);

      return;

    }



    setLoading(true);

    setError(null);



    const result = await resolveManufacturerSuggestion(context, productModels);

    setLoading(false);



    if ('error' in result) {

      setError(result.error);

      return;

    }



    setSuggestion(result);

  };



  return (

    <div className="relative flex-shrink-0" ref={panelRef}>

      <button

        type="button"

        onClick={() => void loadSuggestion()}

        disabled={loading || accepting}

        className="relative p-1 text-violet-600 hover:text-violet-700 hover:bg-violet-50 rounded transition-colors disabled:opacity-50"

        title={

          pendingSuggestion

            ? `Review suggested manufacturer (${Math.round(pendingSuggestion.confidence * 100)}%)`

            : context.modelNumber?.trim()

              ? 'Suggest manufacturer with AI'

              : MODEL_REQUIRED_MESSAGE

        }

      >

        <Sparkles className="w-3.5 h-3.5" />

        {pendingSuggestion && (

          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-white" />

        )}

      </button>



      {open && (

        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white shadow-lg p-3 text-sm">

          {loading && <p className="text-slate-500">Looking up manufacturer…</p>}



          {!loading && error && (

            <div className="space-y-2">

              <p className="text-red-700">{error}</p>

              <button

                type="button"

                onClick={() => setOpen(false)}

                className="text-xs text-slate-500 hover:text-slate-700"

              >

                Close

              </button>

            </div>

          )}



          {!loading && suggestion && (

            <div className="space-y-3">

              <div>

                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">

                  {pendingSuggestion

                    ? 'Automatic lookup suggestion'

                    : suggestion.source === 'product_database'

                      ? 'Product database match'

                      : 'AI suggestion'}

                </p>

                <p className="font-medium text-slate-900">{suggestion.manufacturer}</p>

                {suggestion.confidence != null && (

                  <p className="text-xs text-slate-500 mt-1">

                    Confidence: {Math.round(suggestion.confidence * 100)}%

                  </p>

                )}

                {suggestion.reason && (

                  <p className="text-xs text-slate-600 mt-1">{suggestion.reason}</p>

                )}

              </div>

              <p className="text-xs text-slate-400">

                {pendingSuggestion

                  ? `Below the ${Math.round(AUTO_MANUFACTURER_THRESHOLD * 100)}% auto-apply threshold — accept to apply manually.`

                  : 'Review before accepting — nothing is applied automatically from this panel.'}

              </p>

              <div className="flex flex-wrap gap-2">

                <button

                  type="button"

                  disabled={accepting}

                  onClick={() => void handleAccept()}

                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-md text-xs hover:bg-emerald-700 disabled:opacity-50"

                >

                  <Check className="w-3.5 h-3.5" />Accept

                </button>

                <button

                  type="button"

                  onClick={() => {

                    onManualEdit(suggestion.manufacturer);

                    setOpen(false);

                  }}

                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-md text-xs hover:bg-slate-50"

                >

                  <Pencil className="w-3.5 h-3.5" />Edit

                </button>

                {pendingSuggestion && (

                  <button

                    type="button"

                    disabled={loading}

                    onClick={() => void refreshLookup()}

                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-md text-xs hover:bg-slate-50 disabled:opacity-50"

                  >

                    Refresh

                  </button>

                )}

                <button

                  type="button"

                  onClick={() => setOpen(false)}

                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-500 rounded-md text-xs hover:bg-slate-50"

                >

                  <X className="w-3.5 h-3.5" />Ignore

                </button>

              </div>

            </div>

          )}

        </div>

      )}

    </div>

  );

}

