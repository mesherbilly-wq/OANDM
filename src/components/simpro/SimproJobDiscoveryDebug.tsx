import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileSearch, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  buildJobDiscoveryColumns,
  extractJobRecords,
  formatDiscoveryCellValue,
  pickJobId,
} from './simproJobHelpers';

export function SimproJobDiscoveryDebug({
  baseUrl,
  companyId,
  apiToken,
}: {
  baseUrl: string;
  companyId: string;
  apiToken: string;
}) {
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [rawListPayload, setRawListPayload] = useState<unknown>(null);
  const [jobRecords, setJobRecords] = useState<Record<string, unknown>[]>([]);
  const [selectedJobIndex, setSelectedJobIndex] = useState<number | null>(null);
  const [loadingJobDetail, setLoadingJobDetail] = useState(false);
  const [jobDetailError, setJobDetailError] = useState<string | null>(null);
  const [rawJobDetail, setRawJobDetail] = useState<unknown>(null);

  const discoveryColumns = useMemo(() => buildJobDiscoveryColumns(jobRecords), [jobRecords]);
  const selectedJobId = useMemo(() => {
    if (selectedJobIndex == null) return null;
    const job = jobRecords[selectedJobIndex];
    return job ? pickJobId(job) : null;
  }, [selectedJobIndex, jobRecords]);

  const loadJobDiscovery = useCallback(async () => {
    setLoadingJobs(true);
    setListError(null);
    setRawListPayload(null);
    setJobRecords([]);
    setSelectedJobIndex(null);
    setRawJobDetail(null);

    try {
      const { data, error } = await supabase.functions.invoke('simpro-proxy', {
        body: {
          action: 'list_jobs',
          base_url: baseUrl,
          company_id: companyId,
          api_token: apiToken,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      if (!data?.ok) throw new Error('Failed to load jobs');

      setRawListPayload(data.raw ?? null);
      setJobRecords(extractJobRecords(data.raw));
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoadingJobs(false);
    }
  }, [baseUrl, companyId, apiToken]);

  const loadJobDetails = useCallback(async () => {
    if (selectedJobIndex == null) {
      setJobDetailError('Select a job row first.');
      return;
    }
    const jobId = pickJobId(jobRecords[selectedJobIndex]);
    if (!jobId) {
      setJobDetailError('Selected row has no job ID.');
      return;
    }

    setLoadingJobDetail(true);
    setJobDetailError(null);
    setRawJobDetail(null);

    try {
      const { data, error } = await supabase.functions.invoke('simpro-proxy', {
        body: {
          action: 'get_job',
          job_id: jobId,
          base_url: baseUrl,
          company_id: companyId,
          api_token: apiToken,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      if (!data?.ok) throw new Error('Failed to load job details');

      setRawJobDetail(data.raw ?? null);
    } catch (e: unknown) {
      setJobDetailError(e instanceof Error ? e.message : 'Failed to load job details');
    } finally {
      setLoadingJobDetail(false);
    }
  }, [selectedJobIndex, jobRecords, baseUrl, companyId, apiToken]);

  useEffect(() => {
    loadJobDiscovery();
  }, [loadJobDiscovery]);

  return (
    <details className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 overflow-hidden group">
      <summary className="cursor-pointer select-none list-none px-4 py-3 text-sm font-semibold text-slate-700">
        Developer debug — Job Discovery (VITE_SIMPRO_JOB_DISCOVERY=true)
      </summary>
      <div className="border-t border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Schema inspection only — import runs from Create Project, not Integrations.
          </p>
          <button
            type="button"
            onClick={loadJobDiscovery}
            disabled={loadingJobs}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingJobs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Reload
          </button>
        </div>

        {listError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{listError}</span>
          </div>
        )}

        {!loadingJobs && rawListPayload != null && (
          <>
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-600">
                  {jobRecords.length} job record{jobRecords.length !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={loadJobDetails}
                  disabled={selectedJobIndex == null || loadingJobDetail}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
                >
                  {loadingJobDetail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSearch className="w-3.5 h-3.5" />}
                  Load Job Details
                </button>
              </div>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs text-left">
                  <thead className="bg-white border-b border-slate-100 text-slate-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-semibold">#</th>
                      {discoveryColumns.map(column => (
                        <th key={column.key + column.label} className="px-3 py-2 font-semibold whitespace-nowrap">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {jobRecords.map((job, index) => (
                      <tr
                        key={index}
                        onClick={() => setSelectedJobIndex(index)}
                        className={`cursor-pointer align-top ${selectedJobIndex === index ? 'bg-cyan-50' : 'hover:bg-slate-50'}`}
                      >
                        <td className="px-3 py-2 text-slate-400">{index + 1}</td>
                        {discoveryColumns.map(column => (
                          <td key={column.key + column.label} className="px-3 py-2 max-w-xs break-all whitespace-pre-wrap">
                            {formatDiscoveryCellValue(job, column)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 px-4 py-3">
                <p className="text-xs font-medium text-slate-600 mb-2">Full raw Simpro list response</p>
                <pre className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 overflow-x-auto max-h-48">
                  {JSON.stringify(rawListPayload, null, 2)}
                </pre>
              </div>
            </div>

            {jobDetailError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{jobDetailError}</span>
              </div>
            )}

            {rawJobDetail != null && (
              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">
                  Full raw Simpro job detail (job {selectedJobId})
                </p>
                <pre className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 overflow-x-auto max-h-80 border border-slate-100">
                  {JSON.stringify(rawJobDetail, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
