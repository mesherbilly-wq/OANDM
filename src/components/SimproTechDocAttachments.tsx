import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, FileText, Loader2, Paperclip, RefreshCw, Table2 } from 'lucide-react';
import type { Project } from '../types';
import type { ProjectSystem } from '../lib/systems';
import {
  loadSimproConnection,
  type SimproConnectionSession,
} from '../lib/simproConnectionSession';
import {
  downloadSimproJobAttachment,
  listSimproJobAttachments,
  type SimproJobAttachment,
} from '../lib/simproJobAttachments';

export function simproJobIdFromProject(project: Pick<Project, 'project_number' | 'job_number'>): string {
  const projectNumber = project.project_number?.trim() ?? '';
  if (projectNumber) return projectNumber;
  const jobNumber = project.job_number?.trim() ?? '';
  return /^\d+$/.test(jobNumber) ? jobNumber : '';
}

function formatBytes(size: number | null): string {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SimproTechDocAttachments({
  project,
  systems,
  defaultSystem,
  existingFileNames,
  disabled,
  onImportFiles,
}: {
  project: Project;
  systems: ProjectSystem[];
  defaultSystem: string;
  existingFileNames: string[];
  disabled?: boolean;
  onImportFiles: (files: File[], systemName: string, jobId: string, mode: 'table' | 'original') => Promise<void>;
}) {
  const [connection, setConnection] = useState<SimproConnectionSession | null>(null);
  const [connectionReady, setConnectionReady] = useState(false);
  const [jobId, setJobId] = useState(() => simproJobIdFromProject(project));
  const [attachments, setAttachments] = useState<SimproJobAttachment[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [systemName, setSystemName] = useState(defaultSystem);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [modePrompt, setModePrompt] = useState(false);

  const alreadyImported = useMemo(
    () => new Set(existingFileNames.map(name => name.trim().toLowerCase()).filter(Boolean)),
    [existingFileNames],
  );

  useEffect(() => {
    setJobId(simproJobIdFromProject(project));
  }, [project.id, project.project_number, project.job_number]);

  useEffect(() => {
    if (defaultSystem) setSystemName(current => current || defaultSystem);
  }, [defaultSystem]);

  useEffect(() => {
    let cancelled = false;
    void loadSimproConnection().then(result => {
      if (cancelled) return;
      setConnection(result.connection);
      setConnectionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAttachments = useCallback(async (overrideJobId?: string) => {
    const nextJobId = (overrideJobId ?? jobId).trim();
    if (!connection || !nextJobId) {
      setError(connection ? 'Enter the Simpro job number for this project.' : 'Connect Simpro in Integrations first.');
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    const result = await listSimproJobAttachments(connection, nextJobId);
    setLoading(false);
    if (result.error) {
      setAttachments([]);
      setSelectedIds([]);
      setError(result.error);
      return;
    }
    setAttachments(result.attachments);
    setSelectedIds(result.attachments
      .filter(item => !alreadyImported.has(item.filename.toLowerCase()))
      .map(item => item.id));
    if (result.attachments.length === 0) {
      setStatus('No attachments on that Simpro job.');
    }
  }, [alreadyImported, connection, jobId]);

  useEffect(() => {
    if (!connectionReady || !connection) return;
    const initialJobId = simproJobIdFromProject(project);
    if (!initialJobId) return;
    void loadAttachments(initialJobId);
  }, [connection, connectionReady, project.job_number, project.project_number]);

  const toggle = (id: string) => {
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  const importSelected = async (mode: 'table' | 'original') => {
    if (!connection) return;
    const chosen = attachments.filter(item => selectedIds.includes(item.id));
    if (chosen.length === 0) {
      setError('Select at least one attachment.');
      setModePrompt(false);
      return;
    }
    setModePrompt(false);
    setImporting(true);
    setError(null);
    setStatus(null);
    const files: File[] = [];
    const failures: string[] = [];
    for (const item of chosen) {
      const downloaded = await downloadSimproJobAttachment(connection, jobId.trim(), item);
      if (downloaded.error) failures.push(downloaded.error);
      else files.push(downloaded.file);
    }
    try {
      if (files.length > 0) {
        await onImportFiles(files, systemName, jobId.trim(), mode);
        setStatus(
          mode === 'table'
            ? `Downloaded ${files.length} file${files.length === 1 ? '' : 's'}. Name each one and convert it to a table.`
            : `Added ${files.length} original file${files.length === 1 ? '' : 's'} from Simpro job ${jobId.trim()}.`,
        );
        setSelectedIds(current => current.filter(id => !chosen.some(item => item.id === id)));
      }
      if (failures.length > 0) setError(failures.join('\n'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add those attachments.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-slate-400" />
            <h3 className="font-semibold text-slate-900">From Simpro job</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Take files attached to this job in Simpro and add them as technical documents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAttachments()}
          disabled={disabled || loading || importing || !connection}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {!connectionReady ? (
        <p className="text-sm text-slate-400">Checking Simpro connection…</p>
      ) : !connection ? (
        <p className="text-sm text-slate-600">
          Connect Simpro in{' '}
          <Link to="/integrations" className="text-cyan-700 font-medium hover:underline">Integrations</Link>
          {' '}first.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Simpro job
              <input
                type="text"
                value={jobId}
                onChange={event => setJobId(event.target.value)}
                onBlur={() => { if (jobId.trim()) void loadAttachments(); }}
                placeholder="Job ID"
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Add to system
              <select
                value={systemName}
                onChange={event => setSystemName(event.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white"
              >
                {!systemName && <option value="">Select a system</option>}
                {systems.map(system => (
                  <option key={system.id ?? system.name} value={system.name}>{system.name}</option>
                ))}
                {systemName && !systems.some(system => system.name === systemName) && (
                  <option value={systemName}>{systemName}</option>
                )}
              </select>
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 whitespace-pre-wrap">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
          {status && (
            <div className="flex items-start gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {status}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {attachments.map(item => {
                const imported = alreadyImported.has(item.filename.toLowerCase());
                return (
                  <label key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggle(item.id)}
                      disabled={disabled || importing}
                      className="h-4 w-4 rounded border-slate-300 text-cyan-600"
                    />
                    <span className="flex-1 min-w-0 truncate text-slate-800">{item.filename}</span>
                    {item.sizeBytes != null && (
                      <span className="text-xs text-slate-400 flex-shrink-0">{formatBytes(item.sizeBytes)}</span>
                    )}
                    {imported && (
                      <span className="text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0">Already added</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (selectedIds.length === 0) {
                  setError('Select at least one attachment.');
                  return;
                }
                setError(null);
                setModePrompt(true);
              }}
              disabled={disabled || importing || loading || selectedIds.length === 0}
              className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-xl hover:bg-cyan-700 text-sm font-medium disabled:opacity-50"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
              {importing ? 'Adding…' : `Add ${selectedIds.length || ''} selected`}
            </button>
          </div>
        </>
      )}

      {modePrompt && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">How should these files be added?</h3>
            <p className="text-sm text-slate-500">
              {selectedIds.length} selected from Simpro job {jobId.trim() || '—'}.
            </p>
            <button
              type="button"
              onClick={() => void importSelected('table')}
              className="w-full text-left rounded-xl border border-slate-200 hover:border-cyan-400 hover:bg-cyan-50 px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Table2 className="w-4 h-4 text-cyan-700" />
                Convert into a table
              </span>
              <span className="block text-xs text-slate-500 mt-1">
                Read a door schedule, zone list, IP table or similar and keep the rows in Technical Docs.
              </span>
            </button>
            <button
              type="button"
              onClick={() => void importSelected('original')}
              className="w-full text-left rounded-xl border border-slate-200 hover:border-cyan-400 hover:bg-cyan-50 px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="w-4 h-4 text-cyan-700" />
                Import the original file
              </span>
              <span className="block text-xs text-slate-500 mt-1">
                Keep the PDF or picture as-is. It will show in Technical Docs, the O&amp;M Builder and the downloaded pack.
              </span>
            </button>
            <div className="flex justify-end">
              <button type="button" onClick={() => setModePrompt(false)} className="px-4 py-2 text-sm font-medium text-slate-600">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
