import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useProject } from './ProjectLayout';
import { UploadDatasheetModal } from '../components/UploadDatasheetModal';
import {
  resolveEquipmentDatasheet,
  type DatasheetMatchSuggestion,
  type EquipmentDatasheetMatch,
} from '../lib/datasheetMatching';
import {
  approveDatasheetMatchOverride,
  dismissDatasheetMatchSuggestions,
  loadDatasheetMatchOverrides,
  type DatasheetMatchOverrideState,
} from '../lib/datasheetMatchOverrides';
import {
  AI_AUTO_PLACE_SCORE,
  aiPlacementFromDatasheet,
  findAndSaveDatasheet,
  googleDatasheetSearchUrl,
  saveDatasheetFromUrl,
  type DatasheetCandidate,
} from '../lib/datasheetLookup';
import type { Datasheet } from '../types';
import {
  BookOpen, Eye, Upload, AlertCircle, CheckCircle, Search, Sparkles, Check, X, Loader2,
} from 'lucide-react';

interface DatasheetRow {
  manufacturer: string;
  model_number: string;
  deviceCount: number;
  match: EquipmentDatasheetMatch;
}

type AiLookupState = {
  status: 'idle' | 'searching' | 'attaching' | 'candidates' | 'failed';
  candidates?: DatasheetCandidate[];
  error?: string;
};

function formatMatchMethod(method: EquipmentDatasheetMatch['method']): string {
  switch (method) {
    case 'exact_device':
      return 'Exact device model';
    case 'exact_model_number':
      return 'Exact model number';
    case 'normalized_model':
      return 'Normalized model';
    case 'manufacturer_model':
      return 'Manufacturer + model';
    case 'close_match':
      return 'Close match';
    case 'description_similarity':
      return 'Description similarity';
    case 'user_approved':
      return 'User approved';
    default:
      return 'No match';
  }
}

export function ProjectDatasheetsPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id ? parseInt(id, 10) : null;
  const { productModels, datasheets, refreshDatasheets } = useProject();
  const [rows, setRows] = useState<DatasheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadFor, setUploadFor] = useState<{ manufacturer: string; modelNumber: string; mode?: 'search' | 'upload' | 'link' } | null>(null);
  const [overrides, setOverrides] = useState<DatasheetMatchOverrideState>({ approved: {}, dismissed: [] });
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [updatingRowKey, setUpdatingRowKey] = useState<string | null>(null);
  const [aiByRow, setAiByRow] = useState<Record<string, AiLookupState>>({});
  const [findingAll, setFindingAll] = useState(false);

  useEffect(() => {
    if (projectId) {
      setOverrides(loadDatasheetMatchOverrides(projectId));
    }
  }, [projectId]);

  const rebuildRows = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data } = await supabase
      .from('devices')
      .select('manufacturer, model_number')
      .eq('project_id', projectId);

    if (!data) {
      setLoading(false);
      return;
    }

    const counts = new Map<string, { manufacturer: string; model_number: string; count: number }>();
    for (const device of data) {
      if (!device.manufacturer && !device.model_number) continue;
      const key = `${device.manufacturer ?? ''}::${device.model_number ?? ''}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else {
        counts.set(key, {
          manufacturer: device.manufacturer ?? '',
          model_number: device.model_number ?? '',
          count: 1,
        });
      }
    }

    const built: DatasheetRow[] = [...counts.values()].map(({ manufacturer, model_number, count }) => {
      const match = resolveEquipmentDatasheet(
        { manufacturer, modelNumber: model_number },
        productModels,
        datasheets,
        overrides,
      );
      return { manufacturer, model_number, deviceCount: count, match };
    });

    built.sort((a, b) => {
      const aFound = Boolean(a.match.datasheet);
      const bFound = Boolean(b.match.datasheet);
      if (aFound && !bFound) return -1;
      if (!aFound && bFound) return 1;
      if (a.match.status === 'needs_review' && b.match.status !== 'needs_review') return -1;
      if (a.match.status !== 'needs_review' && b.match.status === 'needs_review') return 1;
      return a.manufacturer.localeCompare(b.manufacturer);
    });

    setRows(built);
    setLoading(false);
  }, [projectId, productModels, datasheets, overrides]);

  useEffect(() => {
    rebuildRows();
  }, [rebuildRows]);

  const markDevicesDatasheetFound = async (manufacturer: string, modelNumber: string) => {
    if (!projectId) return;
    await supabase
      .from('devices')
      .update({ datasheet_found: true })
      .eq('project_id', projectId)
      .ilike('manufacturer', manufacturer.trim())
      .ilike('model_number', modelNumber.trim());
  };

  const handleAcceptSuggestion = async (
    row: DatasheetRow,
    suggestion: DatasheetMatchSuggestion,
  ) => {
    if (!projectId) return;
    setUpdatingRowKey(row.match.rowKey);
    const next = approveDatasheetMatchOverride(projectId, row.match.rowKey, {
      datasheetId: suggestion.datasheetId,
      productId: suggestion.productId,
    });
    setOverrides(next);
    await markDevicesDatasheetFound(row.manufacturer, row.model_number);
    setExpandedRowKey(null);
    setUpdatingRowKey(null);
  };

  const handleDismissSuggestions = (row: DatasheetRow) => {
    if (!projectId) return;
    setUpdatingRowKey(row.match.rowKey);
    const next = dismissDatasheetMatchSuggestions(projectId, row.match.rowKey);
    setOverrides(next);
    setExpandedRowKey(null);
    setUpdatingRowKey(null);
  };

  const handleUploaded = async (_datasheet: Datasheet) => {
    await refreshDatasheets();
    if (uploadFor && projectId) {
      await markDevicesDatasheetFound(uploadFor.manufacturer, uploadFor.modelNumber);
    }
    setUploadFor(null);
  };

  const runAiLookup = async (row: DatasheetRow) => {
    const key = row.match.rowKey;
    setAiByRow(prev => ({ ...prev, [key]: { status: 'searching' } }));
    try {
      const { datasheet, candidates } = await findAndSaveDatasheet(row.manufacturer, row.model_number);
      if (datasheet) {
        await markDevicesDatasheetFound(row.manufacturer, row.model_number);
        await refreshDatasheets();
        setAiByRow(prev => ({ ...prev, [key]: { status: 'idle' } }));
        return;
      }
      if (candidates.length > 0) {
        setAiByRow(prev => ({ ...prev, [key]: { status: 'candidates', candidates } }));
        setExpandedRowKey(key);
        return;
      }
      setAiByRow(prev => ({ ...prev, [key]: { status: 'failed' } }));
    } catch (error: any) {
      setAiByRow(prev => ({
        ...prev,
        [key]: { status: 'failed', error: error?.message ?? 'AI search failed' },
      }));
    }
  };

  const attachAiCandidate = async (row: DatasheetRow, candidate: DatasheetCandidate) => {
    const key = row.match.rowKey;
    setAiByRow(prev => ({ ...prev, [key]: { ...prev[key], status: 'attaching', candidates: prev[key]?.candidates } }));
    try {
      await saveDatasheetFromUrl(candidate.url, row.manufacturer, row.model_number);
      await markDevicesDatasheetFound(row.manufacturer, row.model_number);
      await refreshDatasheets();
      setAiByRow(prev => ({ ...prev, [key]: { status: 'idle' } }));
      setExpandedRowKey(null);
    } catch (error: any) {
      setAiByRow(prev => ({
        ...prev,
        [key]: {
          status: 'candidates',
          candidates: prev[key]?.candidates,
          error: error?.message ?? 'Could not download that PDF',
        },
      }));
    }
  };

  const findMissingWithAi = async () => {
    const missingRows = rows.filter(row => !row.match.datasheet && row.match.status !== 'needs_review');
    if (missingRows.length === 0) return;
    setFindingAll(true);
    for (const row of missingRows) {
      await runAiLookup(row);
    }
    setFindingAll(false);
  };

  const found = rows.filter(row => row.match.datasheet).length;
  const needsReview = rows.filter(row => row.match.status === 'needs_review').length;
  const missing = rows.filter(row => !row.match.datasheet && row.match.status !== 'needs_review').length;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Datasheets</h2>
            <p className="text-sm text-slate-500">
              Use the library first. If a datasheet is missing, find it with AI. Hits of {AI_AUTO_PLACE_SCORE}% or more are saved to the library automatically. If that fails, search the web or upload a PDF.
            </p>
          </div>
        </div>
        {missing > 0 && (
          <button
            type="button"
            onClick={() => void findMissingWithAi()}
            disabled={findingAll}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 disabled:opacity-50 flex-shrink-0"
          >
            {findingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {findingAll ? 'Finding…' : `Find ${missing} missing with AI`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <p className="text-xl font-bold text-slate-900">{rows.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Unique Models</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <p className="text-xl font-bold text-green-600">{found}</p>
          <p className="text-xs text-green-700 mt-0.5">Linked</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-xl font-bold text-amber-600">{needsReview}</p>
          <p className="text-xs text-amber-700 mt-0.5">Suggestions</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <p className="text-xl font-bold text-slate-700">{missing}</p>
          <p className="text-xs text-slate-500 mt-0.5">Missing</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-xl border border-slate-200">
          <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No devices with product models in this project yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Manufacturer</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Model Number</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Devices</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Match</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Datasheet</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => {
                const { match } = row;
                const isExpanded = expandedRowKey === match.rowKey;
                const isUpdating = updatingRowKey === match.rowKey;
                const aiLookup = aiByRow[match.rowKey];
                const aiPlacement = match.datasheet ? aiPlacementFromDatasheet(match.datasheet) : { placed: false, score: null };

                return (
                  <React.Fragment key={match.rowKey}>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-slate-900">{row.manufacturer || '—'}</td>
                      <td className="px-5 py-3.5 font-mono text-sm text-slate-700">{row.model_number || '—'}</td>
                      <td className="px-5 py-3.5">
                        <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded">
                          {row.deviceCount} device{row.deviceCount !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {match.status === 'matched' && match.datasheet ? (
                          aiPlacement.placed ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-cyan-800 bg-cyan-100 px-2 py-1 rounded">
                              <Sparkles className="w-3 h-3" />
                              AI placed it{aiPlacement.score != null ? ` · ${aiPlacement.score}%` : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded">
                              <CheckCircle className="w-3 h-3" />
                              {match.method === 'user_approved' ? 'Approved' : 'Auto-matched'}
                            </span>
                          )
                        ) : match.status === 'needs_review' ? (
                          <button
                            type="button"
                            onClick={() => setExpandedRowKey(isExpanded ? null : match.rowKey)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded hover:bg-amber-200 transition-colors"
                          >
                            <Sparkles className="w-3 h-3" />
                            {match.suggestions.length} suggestion{match.suggestions.length !== 1 ? 's' : ''}
                          </button>
                        ) : aiLookup?.status === 'candidates' ? (
                          <button
                            type="button"
                            onClick={() => setExpandedRowKey(isExpanded ? null : match.rowKey)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700 bg-cyan-100 px-2 py-1 rounded hover:bg-cyan-200 transition-colors"
                          >
                            <Sparkles className="w-3 h-3" />
                            {aiLookup.candidates?.length ?? 0} AI result{(aiLookup.candidates?.length ?? 0) !== 1 ? 's' : ''}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded">
                            <AlertCircle className="w-3 h-3" />
                            No match
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {match.datasheet ? (
                          <div className="text-xs text-slate-600">
                            <span className="inline-flex items-center gap-1 font-medium text-green-700">
                              <CheckCircle className="w-3 h-3" />
                              Available
                            </span>
                            {aiPlacement.placed ? (
                              <p className="text-cyan-700 mt-0.5">
                                AI placed it{aiPlacement.score != null ? ` · ${aiPlacement.score}% hit` : ''}
                              </p>
                            ) : match.confidence != null && match.method !== 'exact_device' ? (
                              <p className="text-slate-400 mt-0.5">
                                {formatMatchMethod(match.method)}
                                {' · '}
                                {Math.round(match.confidence * 100)}%
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded">
                            <AlertCircle className="w-3 h-3" />
                            Not found
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {match.datasheet?.datasheet_url && (
                            <a
                              href={match.datasheet.datasheet_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View PDF
                            </a>
                          )}
                          {!match.datasheet && match.status !== 'needs_review' && (
                            <>
                              <button
                                type="button"
                                onClick={() => void runAiLookup(row)}
                                disabled={aiLookup?.status === 'searching' || aiLookup?.status === 'attaching' || findingAll}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-cyan-50 text-cyan-700 rounded-lg hover:bg-cyan-100 disabled:opacity-50"
                              >
                                {aiLookup?.status === 'searching' || aiLookup?.status === 'attaching' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3.5 h-3.5" />
                                )}
                                {aiLookup?.status === 'attaching' ? 'Saving…' : aiLookup?.status === 'searching' ? 'Finding…' : 'Find with AI'}
                              </button>
                              {(aiLookup?.status === 'failed' || aiLookup?.status === 'candidates') && (
                                <a
                                  href={googleDatasheetSearchUrl(row.manufacturer, row.model_number)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 border border-slate-200 transition-colors"
                                  title="Search Google for this datasheet PDF"
                                >
                                  <Search className="w-3.5 h-3.5" />
                                  Find on Web
                                </a>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => setUploadFor({
                              manufacturer: row.manufacturer,
                              modelNumber: row.model_number,
                              mode: (match.datasheet || aiLookup?.status === 'failed') ? 'upload' : 'search',
                            })}
                            title={match.datasheet ? 'Replace datasheet' : 'Upload or link a datasheet'}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                              match.datasheet
                                ? 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                : aiLookup?.status === 'failed'
                                  ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <Upload className="w-3.5 h-3.5" />
                            {match.datasheet ? 'Replace' : 'Upload'}
                          </button>
                        </div>
                        {aiLookup?.status === 'failed' && (
                          <p className="text-xs text-amber-700 mt-1.5">
                            {aiLookup.error ?? 'AI did not find a datasheet. Search the web or upload a PDF.'}
                          </p>
                        )}
                      </td>
                    </tr>

                    {isExpanded && match.suggestions.length > 0 && (
                      <tr className="bg-amber-50/40">
                        <td colSpan={6} className="px-5 py-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                                <Sparkles className="w-4 h-4 text-amber-600" />
                                Suggested Product Database matches
                              </p>
                              <button
                                type="button"
                                onClick={() => handleDismissSuggestions(row)}
                                disabled={isUpdating}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800"
                              >
                                <X className="w-3.5 h-3.5" />
                                Dismiss suggestions
                              </button>
                            </div>
                            <div className="grid gap-2">
                              {match.suggestions.map(suggestion => (
                                <div
                                  key={`${suggestion.productId}-${suggestion.datasheetId}`}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-800">{suggestion.label}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                      {formatMatchMethod(suggestion.method)}
                                      {' · '}
                                      {Math.round(suggestion.confidence * 100)}% confidence
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={() => handleAcceptSuggestion(row, suggestion)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
                                  >
                                    {isUpdating ? (
                                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5" />
                                    )}
                                    Use this datasheet
                                  </button>
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-slate-500">
                              Approving links this model to an existing Product Database datasheet. No new products are created.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                    {(aiLookup?.status === 'candidates') && (aiLookup.candidates?.length ?? 0) > 0 && (
                      <tr className="bg-cyan-50/40">
                        <td colSpan={6} className="px-5 py-4">
                          <div className="space-y-3">
                            <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-cyan-600" />
                              AI found possible datasheets — {AI_AUTO_PLACE_SCORE}%+ verified PDFs are saved automatically
                            </p>
                            {aiLookup.error && <p className="text-xs text-red-600">{aiLookup.error}</p>}
                            <div className="grid gap-2">
                              {aiLookup.candidates!.map(candidate => (
                                <div key={candidate.url} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-white px-4 py-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-800">{candidate.title}</p>
                                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                                      {candidate.score != null ? `${candidate.score}% hit · ` : ''}
                                      {candidate.domain} · {candidate.url}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {candidate.verified ? (
                                      <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-slate-600 hover:underline">Preview</a>
                                    ) : (
                                      <a href={googleDatasheetSearchUrl(row.manufacturer, row.model_number)} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-slate-600 hover:underline">Find on Web</a>
                                    )}
                                    <button
                                      type="button"
                                      disabled={aiLookup.status === 'attaching'}
                                      onClick={() => void attachAiCandidate(row, candidate)}
                                      className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
                                    >
                                      {aiLookup.status === 'attaching' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                      Save to library
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-slate-500">If none of these work, search the web or upload a PDF. It will still be saved for future matches.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {uploadFor && (
        <UploadDatasheetModal
          manufacturer={uploadFor.manufacturer}
          modelNumber={uploadFor.modelNumber}
          initialMode={uploadFor.mode}
          onClose={() => setUploadFor(null)}
          onUploaded={handleUploaded}
        />
      )}
    </div>
  );
}
