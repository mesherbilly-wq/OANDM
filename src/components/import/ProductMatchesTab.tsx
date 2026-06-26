import React from 'react';
import { Check, CircleDashed, CircleOff, Package, Sparkles } from 'lucide-react';
import type {
  EquipmentProductMatch,
  ProductMatchMethod,
  ProductMatchSummary,
} from '../integrations';
import type { ProductModel } from '../types';

function displayValue(value: string | null | undefined): string {
  return value?.trim() ? value : '—';
}

function formatMatchMethod(method: ProductMatchMethod): string {
  switch (method) {
    case 'exact_part_number':
      return 'Exact model / part number';
    case 'manufacturer_model':
      return 'Manufacturer + model';
    case 'catalogue_number':
      return 'Catalogue number';
    case 'stock_number':
      return 'Stock number';
    case 'description_similarity':
      return 'Description similarity';
    case 'user_selected':
      return 'User selected';
    default:
      return 'No match';
  }
}

function rowStatus(match: EquipmentProductMatch): 'matched' | 'needs_review' | 'unmatched' {
  if (match.resolution === 'unmatched') return 'unmatched';
  if (match.resolution === 'new_product_later') return 'needs_review';
  if (match.matchedProduct && (match.resolution === 'accepted' || (match.confidence ?? 0) >= 0.85)) {
    return 'matched';
  }
  if (match.matchedProduct && (match.confidence ?? 0) < 0.85) return 'needs_review';
  if (match.suggestions.length > 0) return 'needs_review';
  return 'unmatched';
}

function StatusBadge({ status }: { status: ReturnType<typeof rowStatus> }) {
  if (status === 'matched') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
        <Check className="w-3 h-3" />
        Matched
      </span>
    );
  }
  if (status === 'needs_review') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
        <CircleDashed className="w-3 h-3" />
        Needs review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
      <CircleOff className="w-3 h-3" />
      Unmatched
    </span>
  );
}

export function ProductMatchesTab({
  matches,
  products,
  summary,
  onAcceptSuggestion,
  onLeaveUnmatched,
  onMarkNewProductLater,
}: {
  matches: EquipmentProductMatch[];
  products: ProductModel[];
  summary: ProductMatchSummary;
  onAcceptSuggestion: (equipmentDraftId: string, productId: number) => void;
  onLeaveUnmatched: (equipmentDraftId: string) => void;
  onMarkNewProductLater: (equipmentDraftId: string) => void;
}) {
  const productById = new Map(products.map(product => [product.id, product]));

  if (matches.length === 0) {
    return (
      <p className="text-sm text-slate-500 rounded-xl border border-slate-200 bg-white px-4 py-6 text-center">
        No equipment lines to match.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Matched</p>
          <p className="text-2xl font-bold text-emerald-900 mt-1">{summary.matched}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Needs review</p>
          <p className="text-2xl font-bold text-amber-900 mt-1">{summary.needsReview}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Unmatched</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{summary.unmatched}</p>
        </div>
      </div>

      <div className="space-y-3">
        {matches.map(match => {
          const status = rowStatus(match);
          const importDescription = match.equipment.modelName ?? match.equipment.deviceType;
          const matched = match.matchedProduct;

          return (
            <section key={match.equipmentDraftId} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <StatusBadge status={status} />
                    <span className="text-xs text-slate-500">{match.systemName}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800">{displayValue(importDescription)}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Import: {displayValue(match.equipment.manufacturer)} · {displayValue(match.equipment.modelNumber)} · Qty {match.equipment.quantity}
                  </p>
                </div>
                {matched && status === 'matched' && (
                  <div className="text-right text-xs text-slate-500">
                    <p className="font-semibold text-slate-700">{formatMatchMethod(match.method)}</p>
                    {match.confidence != null && <p>{Math.round(match.confidence * 100)}% confidence</p>}
                  </div>
                )}
              </div>

              <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Matched product</p>
                  {matched && match.resolution !== 'unmatched' && match.resolution !== 'new_product_later' ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-slate-900">
                            {displayValue(matched.model_name ?? matched.device_type)}
                          </p>
                          <p className="text-slate-700 mt-1">
                            {displayValue(matched.manufacturer)} · {displayValue(matched.model_number ?? matched.part_number)}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            {formatMatchMethod(match.method)}
                            {match.confidence != null ? ` · ${Math.round(match.confidence * 100)}%` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : match.resolution === 'new_product_later' ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Marked to create a new product later (Phase 11+).
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      No product linked yet.
                    </div>
                  )}
                </div>

                <div>
                  {match.suggestions.length > 0 && status !== 'matched' ? (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        Suggested products
                      </p>
                      <div className="space-y-2">
                        {match.suggestions.map(suggestion => {
                          const product = productById.get(suggestion.productId);
                          if (!product) return null;
                          return (
                            <div
                              key={suggestion.productId}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5"
                            >
                              <div className="min-w-0 text-sm">
                                <p className="font-medium text-slate-800">{suggestion.label}</p>
                                <p className="text-xs text-slate-500">
                                  {formatMatchMethod(suggestion.method)} · {Math.round(suggestion.confidence * 100)}%
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => onAcceptSuggestion(match.equipmentDraftId, suggestion.productId)}
                                className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
                              >
                                Accept
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  {status !== 'matched' && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => onLeaveUnmatched(match.equipmentDraftId)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Leave unmatched
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarkNewProductLater(match.equipmentDraftId)}
                        className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                      >
                        New product later
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
