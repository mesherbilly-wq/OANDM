import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Building, CheckCircle, ExternalLink, FileSearch, Loader2, Search,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  getSimproConnectionSession,
  isSimproConnectionConfigured,
} from '../../lib/simproConnectionSession';
import { normalizeSimproJob } from '../../integrations/connectors/simpro/normalizeSimproJob';
import { setSimproImportSession } from '../../lib/simproImportSession';
import { fetchAllProductModels } from '../../lib/productDatabaseDb';
import { enrichImportReviewDraftFromProductDatabase } from '../../lib/importEquipmentValidation';
import { parseSearchJobResults, toJobSearchRow, type SimproJobSearchRow } from './simproJobHelpers';

const inputClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent';

export function SimproImportFlow({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const connection = getSimproConnectionSession();

  const [jobNumber, setJobNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [matches, setMatches] = useState<SimproJobSearchRow[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [loadingJob, setLoadingJob] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rawJobDetail, setRawJobDetail] = useState<unknown>(null);
  const [loadedJobId, setLoadedJobId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [openingReview, setOpeningReview] = useState(false);

  if (!isSimproConnectionConfigured() || !connection) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Simpro is not connected</p>
            <p className="text-sm text-amber-800 mt-1">
              Configure your Simpro connection in Integrations first — Base URL, Company ID, API token, and a successful connection test.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/integrations"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800"
          >
            Open Integrations
          </Link>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to sources
          </button>
        </div>
      </div>
    );
  }

  const selectedMatch = matches.find(row => row.id === selectedMatchId) ?? null;

  const runSearch = async () => {
    const query = jobNumber.trim();
    if (!query) {
      setSearchError('Enter a job number to search.');
      return;
    }

    setSearching(true);
    setSearchError(null);
    setMatches([]);
    setSelectedMatchId(null);
    setRawJobDetail(null);
    setLoadedJobId(null);
    setLoadError(null);
    setReviewError(null);

    try {
      const { data, error } = await supabase.functions.invoke('simpro-proxy', {
        body: {
          action: 'search_jobs',
          job_number: query,
          query,
          base_url: connection.baseUrl,
          company_id: connection.companyId,
          api_token: connection.apiToken,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      if (!data?.ok) throw new Error('Job search failed');

      const rows = parseSearchJobResults(data?.raw)
        .map(toJobSearchRow)
        .filter((row): row is SimproJobSearchRow => !!row);

      setMatches(rows);
      if (rows.length === 0) {
        setSearchError(`No jobs matched "${query}".`);
      } else if (rows.length === 1) {
        setSelectedMatchId(rows[0].id);
      }
    } catch (e: unknown) {
      setSearchError(e instanceof Error ? e.message : 'Job search failed');
    } finally {
      setSearching(false);
    }
  };

  const loadSelectedJob = async () => {
    if (!selectedMatchId) {
      setLoadError('Select a job from the search results first.');
      return;
    }

    setLoadingJob(true);
    setLoadError(null);
    setRawJobDetail(null);
    setLoadedJobId(null);
    setReviewError(null);

    try {
      const { data, error } = await supabase.functions.invoke('simpro-proxy', {
        body: {
          action: 'get_job',
          job_id: selectedMatchId,
          base_url: connection.baseUrl,
          company_id: connection.companyId,
          api_token: connection.apiToken,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      if (!data?.ok) throw new Error('Failed to load job details');

      setRawJobDetail(data.raw ?? null);
      setLoadedJobId(String(data.job_id ?? selectedMatchId));
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load job details');
    } finally {
      setLoadingJob(false);
    }
  };

  const openImportReview = async () => {
    if (rawJobDetail == null) {
      setReviewError('Load the full job before opening Import Review.');
      return;
    }

    setOpeningReview(true);
    setReviewError(null);

    try {
      const draft = normalizeSimproJob(rawJobDetail, { jobId: loadedJobId ?? selectedMatchId });
      const { products, error } = await fetchAllProductModels();
      if (error) {
        setReviewError(`Product Database could not be loaded (${error}). Import Review will open without autofill.`);
      }

      const enrichedDraft =
        products.length > 0 ? enrichImportReviewDraftFromProductDatabase(draft, products) : draft;

      setSimproImportSession({ draft: enrichedDraft, rawJob: rawJobDetail });
      navigate('/import-review');
    } catch (e: unknown) {
      setReviewError(e instanceof Error ? e.message : 'Failed to normalise Simpro job');
    } finally {
      setOpeningReview(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-semibold text-slate-900">Import from Simpro</h2>
          </div>
          <p className="text-sm text-slate-500">
            Search by job number, load the full job, then review the normalised import draft. Nothing is saved to OANDM yet.
          </p>
          {connection.companyName && (
            <p className="text-xs text-slate-400 mt-1">Connected to {connection.companyName}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Search Simpro Job</h3>
          <p className="text-xs text-slate-500 mb-3">Enter the Simpro job number to search your connected company.</p>
          <div className="flex flex-wrap gap-2">
            <label className="flex-1 min-w-[12rem]">
              <span className="sr-only">Job Number</span>
              <input
                type="text"
                value={jobNumber}
                onChange={e => setJobNumber(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runSearch()}
                placeholder="Job number"
                className={inputClass}
              />
            </label>
            <button
              type="button"
              onClick={runSearch}
              disabled={searching}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>
        </div>

        {searchError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{searchError}</span>
          </div>
        )}

        {matches.length > 0 && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              {matches.length} match{matches.length !== 1 ? 'es' : ''} — select a job to load full detail
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b border-slate-100 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Job ID</th>
                    <th className="px-4 py-2.5 font-semibold">Job Number</th>
                    <th className="px-4 py-2.5 font-semibold">Name</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold">Site</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matches.map(row => {
                    const selected = selectedMatchId === row.id;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => {
                          setSelectedMatchId(row.id);
                          setLoadError(null);
                          setReviewError(null);
                          setRawJobDetail(null);
                          setLoadedJobId(null);
                        }}
                        className={`cursor-pointer ${selected ? 'bg-cyan-50' : 'hover:bg-slate-50'}`}
                      >
                        <td className="px-4 py-2.5 font-mono text-xs">{row.id}</td>
                        <td className="px-4 py-2.5">{row.jobNumber ?? '—'}</td>
                        <td className="px-4 py-2.5">{row.name ?? '—'}</td>
                        <td className="px-4 py-2.5">{row.customer ?? '—'}</td>
                        <td className="px-4 py-2.5">{row.site ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={loadSelectedJob}
            disabled={!selectedMatchId || loadingJob}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingJob ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
            Load Full Job
          </button>
          <button
            type="button"
            onClick={() => void openImportReview()}
            disabled={rawJobDetail == null || openingReview}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {openingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            Open Import Review
          </button>
          {selectedMatch && (
            <span className="text-xs text-slate-500">
              Selected: {selectedMatch.jobNumber ?? selectedMatch.id}
              {loadedJobId ? ` · loaded ${loadedJobId}` : ''}
            </span>
          )}
        </div>

        {loadError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
        )}

        {reviewError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{reviewError}</span>
          </div>
        )}

        {rawJobDetail != null && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Full job loaded — open Import Review to inspect the normalised draft (read-only).</span>
          </div>
        )}
      </div>
    </div>
  );
}
