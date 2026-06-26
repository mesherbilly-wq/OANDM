import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';
import {
  FolderOpen, Plus, ArrowRight, Clock, CheckCircle2, PauseCircle,
  AlertCircle, Sparkles, FileText, Cpu, Calendar, ChevronRight,
  Building2, MapPin, LayoutDashboard, RefreshCw,
} from 'lucide-react';

interface ProjectWithMeta extends Project {
  device_count: number;
  doc_count: number;
  pending_devices: number;
  om_upload_count: number;
  as_fitted_count: number;
}

type SortKey = 'status' | 'deadline' | 'updated';

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; bar: string }> = {
  active:    { label: 'Active',    color: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  'on-hold': { label: 'On Hold',  color: 'bg-amber-50 text-amber-700 ring-amber-200',       dot: 'bg-amber-400',   bar: 'bg-amber-400' },
  completed: { label: 'Completed', color: 'bg-slate-100 text-slate-600 ring-slate-200',      dot: 'bg-slate-400',   bar: 'bg-slate-400' },
  cancelled: { label: 'Cancelled', color: 'bg-red-50 text-red-600 ring-red-200',             dot: 'bg-red-400',     bar: 'bg-red-400' },
};

function computeProgress(p: ProjectWithMeta): number {
  if (p.project_status === 'completed') return 100;

  // Score each O&M builder section (8 sections total)
  const checks = [
    !!(p.project_name && p.client_name && p.site_name),  // cover — info filled
    !!(p.start_date || p.completion_date),                // dates set
    p.device_count > 0,                                   // device schedule populated
    p.device_count >= 5,                                  // device schedule substantial
    p.doc_count > 0,                                      // scope / maintenance plan exists
    p.doc_count >= 2,                                     // multiple documents created
    p.om_upload_count > 0,                                // commissioning / handover uploaded
    p.as_fitted_count > 0,                                // as-fitted drawings uploaded
  ];

  const score = checks.filter(Boolean).length;
  const pct = Math.max(5, Math.round((score / checks.length) * 95));
  if (p.project_status === 'on-hold') return Math.min(pct, 65);
  return pct;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function DeadlinePill({ date }: { date: string | null }) {
  const days = daysUntil(date);
  if (days === null) return <span className="text-slate-400 text-xs">No date set</span>;
  if (days < 0) return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><AlertCircle className="w-3 h-3" />{Math.abs(days)}d overdue</span>;
  if (days <= 7) return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><Clock className="w-3 h-3" />{days}d left</span>;
  return <span className="text-xs text-slate-500">{fmtDate(date)}</span>;
}

function StatusBadge({ status }: { status: string | null }) {
  const cfg = STATUS_CONFIG[status ?? 'active'] ?? STATUS_CONFIG.active;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function ProgressBar({ value, status }: { value: number; status: string | null }) {
  const cfg = STATUS_CONFIG[status ?? 'active'] ?? STATUS_CONFIG.active;
  return (
    <div className="flex items-center gap-2.5 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-600 w-8 text-right">{value}%</span>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('status');
  const [refreshing, setRefreshing] = useState(false);

  const today = new Date();
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true); else setRefreshing(true);

    const [{ data: projData }, { data: devCounts }, { data: docCounts }, { data: pendingCounts }, { data: omCounts }, { data: afdCounts }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('devices').select('project_id').not('project_id', 'is', null),
      supabase.from('project_documents').select('project_id'),
      supabase.from('devices').select('project_id').eq('status', 'pending_review').not('project_id', 'is', null),
      supabase.from('om_pack_uploads').select('project_id'),
      supabase.from('as_fitted_drawings').select('project_id'),
    ]);

    const devMap: Record<number, number> = {};
    for (const d of devCounts ?? []) {
      if (d.project_id) devMap[d.project_id] = (devMap[d.project_id] ?? 0) + 1;
    }
    const docMap: Record<number, number> = {};
    for (const d of docCounts ?? []) {
      if (d.project_id) docMap[d.project_id] = (docMap[d.project_id] ?? 0) + 1;
    }
    const pendMap: Record<number, number> = {};
    for (const d of pendingCounts ?? []) {
      if (d.project_id) pendMap[d.project_id] = (pendMap[d.project_id] ?? 0) + 1;
    }
    const omMap: Record<number, number> = {};
    for (const d of omCounts ?? []) {
      if (d.project_id) omMap[d.project_id] = (omMap[d.project_id] ?? 0) + 1;
    }
    const afdMap: Record<number, number> = {};
    for (const d of afdCounts ?? []) {
      if (d.project_id) afdMap[d.project_id] = (afdMap[d.project_id] ?? 0) + 1;
    }

    setProjects((projData ?? []).map(p => ({
      ...p,
      device_count: devMap[p.id] ?? 0,
      doc_count: docMap[p.id] ?? 0,
      pending_devices: pendMap[p.id] ?? 0,
      om_upload_count: omMap[p.id] ?? 0,
      as_fitted_count: afdMap[p.id] ?? 0,
    })));

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter(p => p.project_status === 'active').length,
    completed: projects.filter(p => p.project_status === 'completed').length,
    onHold: projects.filter(p => p.project_status === 'on-hold').length,
    pendingReview: projects.filter(p => p.pending_devices > 0).length,
  }), [projects]);

  const sorted = useMemo(() => {
    const STATUS_ORDER: Record<string, number> = { active: 0, 'on-hold': 1, completed: 2, cancelled: 3 };
    const list = [...projects];
    if (sort === 'status') {
      list.sort((a, b) => {
        const so = (STATUS_ORDER[a.project_status ?? ''] ?? 9) - (STATUS_ORDER[b.project_status ?? ''] ?? 9);
        if (so !== 0) return so;
        const da = daysUntil(a.completion_date) ?? 9999;
        const db = daysUntil(b.completion_date) ?? 9999;
        return da - db;
      });
    } else if (sort === 'deadline') {
      list.sort((a, b) => {
        const da = daysUntil(a.completion_date) ?? 99999;
        const db = daysUntil(b.completion_date) ?? 99999;
        return da - db;
      });
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [projects, sort]);

  const recent = useMemo(() =>
    [...projects].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5),
    [projects]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <LayoutDashboard className="w-4 h-4" />
            <span>{dateLabel}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{greeting}</h1>
          <p className="text-slate-500 mt-1">
            {stats.active > 0
              ? `You have ${stats.active} active project${stats.active > 1 ? 's' : ''}${stats.pendingReview > 0 ? ` · ${stats.pendingReview} project${stats.pendingReview > 1 ? 's' : ''} awaiting device review` : ''}.`
              : 'Create a new project to get started.'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to="/create-project"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl text-sm font-semibold hover:from-violet-700 hover:to-purple-700 transition-all shadow-sm shadow-violet-200"
          >
            <Plus className="w-4 h-4" />
            Create Project
          </Link>
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-xl text-sm font-semibold hover:bg-cyan-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Project
          </Link>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Projects',        value: stats.total,        icon: FolderOpen,    bg: 'bg-cyan-50',    iconColor: 'text-cyan-600',    link: '/projects' },
          { label: 'Active',                value: stats.active,       icon: CheckCircle2,  bg: 'bg-emerald-50', iconColor: 'text-emerald-600', link: '/projects' },
          { label: 'Completed',             value: stats.completed,    icon: CheckCircle2,  bg: 'bg-slate-100',  iconColor: 'text-slate-500',   link: '/projects' },
          { label: 'Awaiting Device Review',value: stats.pendingReview,icon: AlertCircle,   bg: 'bg-amber-50',   iconColor: 'text-amber-600',   link: '/projects' },
        ].map(({ label, value, icon: Icon, bg, iconColor, link }) => (
          <Link key={label} to={link}
            className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-slate-300 transition-all group">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${iconColor}`} />
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-sm text-slate-500 mt-0.5">{label}</p>
          </Link>
        ))}
      </div>

      {/* ── Main Content ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Projects Table */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-slate-400" />
              <h2 className="font-semibold text-slate-800">All Projects</h2>
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">{projects.length}</span>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              {([['status', 'By Status'], ['deadline', 'By Deadline'], ['updated', 'Recent']] as [SortKey, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setSort(key)}
                  className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${sort === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                <FolderOpen className="w-8 h-8 text-slate-300" />
              </div>
              <p className="font-semibold text-slate-700 mb-1">No projects yet</p>
              <p className="text-sm text-slate-400 mb-5">Create your first project to get started</p>
              <Link to="/projects" className="inline-flex items-center gap-2 bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-cyan-700 transition-colors">
                <Plus className="w-4 h-4" />New Project
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {sorted.map(p => {
                const progress = computeProgress(p);
                const cfg = STATUS_CONFIG[p.project_status ?? 'active'] ?? STATUS_CONFIG.active;
                return (
                  <div key={p.id} className="px-6 py-4 hover:bg-slate-50 transition-colors group">
                    <div className="flex items-start gap-4">
                      {/* Status dot */}
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${cfg.dot}`} />

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate text-sm">
                              {p.project_name || <span className="text-slate-400 italic">Unnamed Project</span>}
                            </p>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              {p.client_name && (
                                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                  <Building2 className="w-3 h-3" />{p.client_name}
                                </span>
                              )}
                              {p.site_name && (
                                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                  <MapPin className="w-3 h-3" />{p.site_name}
                                </span>
                              )}
                            </div>
                          </div>
                          <StatusBadge status={p.project_status} />
                        </div>

                        {/* Progress */}
                        <ProgressBar value={progress} status={p.project_status} />

                        {/* Meta row */}
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-4 text-xs text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <Cpu className="w-3 h-3" />{p.device_count} device{p.device_count !== 1 ? 's' : ''}
                            </span>
                            {p.pending_devices > 0 && (
                              <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                                <AlertCircle className="w-3 h-3" />{p.pending_devices} pending review
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <DeadlinePill date={p.completion_date} />
                            </span>
                          </div>
                          <button
                            onClick={() => navigate(`/projects/${p.id}`)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-600 hover:text-cyan-700 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            Continue <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {sorted.length > 0 && (
            <div className="px-6 py-3 border-t border-slate-100 bg-slate-50">
              <Link to="/projects" className="text-sm text-cyan-600 hover:text-cyan-700 font-medium inline-flex items-center gap-1">
                View all projects <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">

          {/* Recent Projects */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
              <Clock className="w-4 h-4 text-slate-400" />
              <h2 className="font-semibold text-slate-800 text-sm">Recent Projects</h2>
            </div>
            <div className="divide-y divide-slate-50">
              {recent.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-400">No projects yet.</p>
              ) : (
                recent.map(p => {
                  const cfg = STATUS_CONFIG[p.project_status ?? 'active'] ?? STATUS_CONFIG.active;
                  return (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-left group"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.dot.replace('bg-', 'bg-').replace('500', '100').replace('400', '100')}`}>
                        <FolderOpen className={`w-4 h-4 ${cfg.dot.replace('bg-', 'text-')}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {p.project_name || 'Unnamed Project'}
                        </p>
                        <p className="text-xs text-slate-400 truncate">{p.client_name || p.site_name || 'No details'}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-cyan-500 transition-colors flex-shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Quick Actions</h2>
            </div>
            <div className="p-3 space-y-1">
              {[
                { to: '/projects',            icon: Plus,         label: 'Create New Project',     sub: 'Start from scratch',          color: 'text-cyan-600' },
                { to: '/create-project',  icon: Plus,         label: 'Create Project',         sub: 'Import from Simpro jobs, AI, or files', color: 'text-violet-600' },
                { to: '/projects',            icon: FileText,     label: 'O&M Builder',            sub: 'Build operation manuals',      color: 'text-teal-600' },
                { to: '/product-models',      icon: Cpu,          label: 'Product Library',        sub: 'Manage device catalogue',      color: 'text-slate-500' },
              ].map(({ to, icon: Icon, label, sub, color }) => (
                <Link key={label} to={to}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 transition-colors group">
                  <div className="w-9 h-9 bg-slate-100 group-hover:bg-white rounded-xl flex items-center justify-center flex-shrink-0 transition-colors shadow-none group-hover:shadow-sm">
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{label}</p>
                    <p className="text-xs text-slate-400">{sub}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-400 transition-colors" />
                </Link>
              ))}
            </div>
          </div>

          {/* Stage Summary (if there are projects) */}
          {projects.length > 0 && (
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 text-white">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Project Summary</p>
              <div className="space-y-3">
                {[
                  { label: 'Active',    value: stats.active,    color: 'bg-emerald-400' },
                  { label: 'On Hold',   value: stats.onHold,    color: 'bg-amber-400' },
                  { label: 'Completed', value: stats.completed, color: 'bg-slate-500' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
                    <span className="text-sm text-slate-300 flex-1">{label}</span>
                    <span className="text-sm font-bold">{value}</span>
                    <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color} transition-all`}
                        style={{ width: projects.length ? `${(value / projects.length) * 100}%` : '0%' }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-slate-700">
                <p className="text-xs text-slate-400">{projects.length} total project{projects.length !== 1 ? 's' : ''} in the system</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
