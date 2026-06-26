import React, { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Building, ChevronDown, FolderOpen, Info, MapPin, Tag, User,
} from 'lucide-react';
import {
  resolvedSystemType,
  selectedDeviceCount,
  type ImportReviewDraft,
} from '../integrations';
import { pickRawDescriptionHtml } from '../integrations/connectors/simpro/simproImportHelpers';
import { getSimproImportSession } from '../lib/simproImportSession';
import type { SystemType } from '../types';

type ReviewTab = 'project' | 'systems' | 'issues' | 'debug';

const SYSTEM_TYPE_BADGE: Record<SystemType, string> = {
  'CCTV': 'bg-blue-100 text-blue-800 border-blue-200',
  'Access Control': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Intruder': 'bg-red-100 text-red-800 border-red-200',
  'Intercom': 'bg-amber-100 text-amber-800 border-amber-200',
  'ANPR': 'bg-violet-100 text-violet-800 border-violet-200',
  'Perimeter Detection': 'bg-orange-100 text-orange-800 border-orange-200',
  'Networking': 'bg-slate-100 text-slate-700 border-slate-200',
};

function displayValue(value: string | null | undefined): string {
  return value?.trim() ? value : '—';
}

function severityStyle(severity: ImportReviewDraft['issues'][number]['severity']): string {
  if (severity === 'error') return 'border-red-200 bg-red-50 text-red-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function ReadOnlyField({ label, value, icon: Icon }: {
  label: string;
  value: string | null | undefined;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
        <div className={`border border-slate-200 rounded-xl py-2.5 text-sm text-slate-800 bg-slate-50 ${Icon ? 'pl-10 pr-4' : 'px-4'}`}>
          {displayValue(value)}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyMultilineField({ label, value }: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
      <div className="border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 bg-slate-50 whitespace-pre-wrap min-h-[5rem]">
        {displayValue(value)}
      </div>
    </div>
  );
}

function SystemTypeBadge({ systemType, confidence }: { systemType: SystemType | null; confidence: number }) {
  if (!systemType) {
    return (
      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
        System type unresolved
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${SYSTEM_TYPE_BADGE[systemType]}`}>
      {systemType}
      {confidence > 0 ? (
        <span className="opacity-70">· {Math.round(confidence * 100)}%</span>
      ) : null}
    </span>
  );
}

export function ImportReviewPage() {
  const session = useMemo(() => getSimproImportSession(), []);
  const [tab, setTab] = useState<ReviewTab>('project');

  if (!session) {
    return <Navigate to="/create-project" replace />;
  }

  const { draft, rawJob } = session;
  const deviceCount = selectedDeviceCount(draft);
  const rawJobRecord = rawJob && typeof rawJob === 'object' ? (rawJob as Record<string, unknown>) : null;
  const originalDescriptionHtml = rawJobRecord ? pickRawDescriptionHtml(rawJobRecord) : null;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-md">
                <FolderOpen className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Import Review</h1>
                <p className="text-sm text-slate-500">
                  Read-only preview from Simpro · nothing is saved to OANDM yet
                </p>
              </div>
            </div>
          </div>
          <Link
            to="/create-project"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Create Project
          </Link>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
        <p className="font-semibold">Simpro import draft (session only)</p>
        <p className="text-cyan-800/90 mt-0.5">
          Job {displayValue(draft.project.jobNumber)} · Simpro ID {displayValue(draft.project.projectNumber)} ·{' '}
          {draft.systems.length} cost centre{draft.systems.length !== 1 ? 's' : ''} · {deviceCount} equipment line
          {deviceCount !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-5">
        {([
          ['project', 'Project'],
          ['systems', 'Systems & Equipment'],
          ['issues', `Issues (${draft.issues.length})`],
          ['debug', 'Debug JSON'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'project' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="text-base font-semibold text-slate-800">Project Details</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <ReadOnlyField label="Project Name" value={draft.project.projectName} />
            </div>
            <ReadOnlyField label="Job Number" value={draft.project.jobNumber} />
            <ReadOnlyField label="Simpro ID" value={draft.project.projectNumber} />
            <ReadOnlyField label="Client" value={draft.project.clientName} icon={Building} />
            <ReadOnlyField label="Site" value={draft.project.siteName} icon={MapPin} />
            <ReadOnlyField label="Site Address" value={draft.project.siteAddress} />
            <ReadOnlyField label="Project Manager" value={draft.project.projectManager} icon={User} />
            <div className="md:col-span-2">
              <ReadOnlyMultilineField label="Scope of Works" value={draft.project.projectSummary} />
            </div>
            <div className="md:col-span-2">
              <ReadOnlyMultilineField label="Project Notes" value={draft.project.projectNotes} />
            </div>
          </div>
        </div>
      )}

      {tab === 'systems' && (
        <div className="space-y-4">
          {draft.systems.length === 0 ? (
            <p className="text-sm text-slate-500 rounded-xl border border-slate-200 bg-white px-4 py-6 text-center">
              No systems were normalised from this job.
            </p>
          ) : (
            draft.systems.map((system, index) => {
              const systemType = resolvedSystemType(system);
              return (
                <details key={system.draftId} open={index === 0} className="bg-white border border-slate-200 rounded-2xl overflow-hidden group">
                  <summary className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none list-none">
                    <div className="flex items-start gap-3 min-w-0">
                      <ChevronDown className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0 transition-transform group-open:rotate-180" />
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-800">{system.name}</h3>
                        {system.description && (
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{system.description}</p>
                        )}
                        {system.sourceSectionRef && (
                          <p className="text-[11px] text-slate-400 mt-1 font-mono">Ref {system.sourceSectionRef}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <SystemTypeBadge systemType={systemType} confidence={system.inference.confidence} />
                      <span className="inline-flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5" />
                        {system.equipment.length} line{system.equipment.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </summary>
                  {system.equipment.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-slate-500">No equipment lines for this cost centre.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-white border-b border-slate-100 text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5 font-semibold">Description</th>
                            <th className="px-4 py-2.5 font-semibold">Type</th>
                            <th className="px-4 py-2.5 font-semibold">Manufacturer</th>
                            <th className="px-4 py-2.5 font-semibold">Model / Part No</th>
                            <th className="px-4 py-2.5 font-semibold">Qty</th>
                            <th className="px-4 py-2.5 font-semibold">Item group</th>
                            <th className="px-4 py-2.5 font-semibold">Source ref</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {system.equipment.map(item => (
                            <tr key={item.draftId} className="align-top">
                              <td className="px-4 py-2.5 text-slate-800 max-w-xs whitespace-pre-wrap">
                                {displayValue(item.modelName ?? item.deviceType)}
                              </td>
                              <td className="px-4 py-2.5 text-slate-700">{displayValue(item.deviceType)}</td>
                              <td className="px-4 py-2.5 text-slate-700">{displayValue(item.manufacturer)}</td>
                              <td className="px-4 py-2.5 text-slate-700 font-mono text-xs">
                                {displayValue(item.modelNumber)}
                              </td>
                              <td className="px-4 py-2.5 text-slate-700">{item.quantity}</td>
                              <td className="px-4 py-2.5 text-slate-500 text-xs">{displayValue(item.notes)}</td>
                              <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{displayValue(item.sourceLineRef)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </details>
              );
            })
          )}
        </div>
      )}

      {tab === 'issues' && (
        <div className="space-y-3">
          {draft.issues.length === 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              No normalisation issues recorded for this draft.
            </div>
          ) : (
            draft.issues.map(issue => (
              <div
                key={`${issue.code}-${issue.message}-${issue.draftId ?? ''}`}
                className={`rounded-xl border px-4 py-3 text-sm ${severityStyle(issue.severity)}`}
              >
                <p className="font-semibold">{issue.code}</p>
                <p className="mt-0.5">{issue.message}</p>
                {issue.draftId && (
                  <p className="mt-1 text-xs opacity-80 font-mono">ref: {issue.draftId}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'debug' && (
        <div className="space-y-4">
          {originalDescriptionHtml && (
            <details className="rounded-xl border border-slate-200 bg-white overflow-hidden group">
              <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none list-none bg-slate-50 border-b border-slate-100 text-sm font-semibold text-slate-700">
                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                Original Simpro Description (HTML)
              </summary>
              <pre className="text-[11px] text-slate-600 p-4 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
                {originalDescriptionHtml}
              </pre>
            </details>
          )}
          <details open className="rounded-xl border border-slate-200 bg-white overflow-hidden group">
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none list-none bg-slate-50 border-b border-slate-100 text-sm font-semibold text-slate-700">
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
              Normalised ImportReviewDraft
            </summary>
            <pre className="text-[11px] text-slate-600 p-4 overflow-x-auto max-h-96">
              {JSON.stringify(draft, null, 2)}
            </pre>
          </details>
          <details open className="rounded-xl border border-slate-200 bg-white overflow-hidden group">
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none list-none bg-slate-50 border-b border-slate-100 text-sm font-semibold text-slate-700">
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
              Raw Simpro job JSON
            </summary>
            <pre className="text-[11px] text-slate-600 p-4 overflow-x-auto max-h-96">
              {JSON.stringify(rawJob, null, 2)}
            </pre>
          </details>
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Debug data is kept in sessionStorage only for this browser tab session. Scope of Works in the review uses plain text; original HTML is preserved here only.
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
        <p className="text-sm text-slate-600">
          Import draft is kept in this browser session only. Project creation arrives in the next phase.
        </p>
        <button
          type="button"
          disabled
          title="Project creation is disabled until the next phase"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 cursor-not-allowed"
        >
          Create Project (Phase 11)
        </button>
      </div>
    </div>
  );
}
