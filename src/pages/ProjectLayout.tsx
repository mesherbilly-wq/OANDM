import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useParams, Navigate, Outlet, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Project, ProductModel, Datasheet } from '../types';
import { ArrowLeft, FolderOpen, Tag, CheckCircle2, PauseCircle, XCircle } from 'lucide-react';

interface ProjectContextType {
  project: Project;
  productModels: ProductModel[];
  datasheets: Datasheet[];
  refreshDatasheets: () => Promise<void>;
  refreshProductModels: () => Promise<void>;
  refreshProject: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectLayout');
  return ctx;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  active:    { label: 'Active',    icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700' },
  'on-hold': { label: 'On Hold',   icon: PauseCircle,  cls: 'bg-amber-100 text-amber-700' },
  completed: { label: 'Completed', icon: CheckCircle2, cls: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Cancelled', icon: XCircle,      cls: 'bg-red-100 text-red-700' },
};

export function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [productModels, setProductModels] = useState<ProductModel[]>([]);
  const [datasheets, setDatasheets] = useState<Datasheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    const pid = parseInt(id);
    Promise.all([
      supabase.from('projects').select('*').eq('id', pid).single(),
      supabase.from('product_models').select('*').order('manufacturer'),
      supabase.from('datasheets').select('*'),
    ]).then(([{ data: proj, error }, { data: models }, { data: ds }]) => {
      if (error || !proj) setNotFound(true);
      else setProject(proj);
      setProductModels(models ?? []);
      setDatasheets(ds ?? []);
      setLoading(false);
    });
  }, [id]);

  const refreshDatasheets = useCallback(async () => {
    const { data } = await supabase.from('datasheets').select('*');
    setDatasheets(data ?? []);
  }, []);

  const refreshProductModels = useCallback(async () => {
    const { data } = await supabase.from('product_models').select('*').order('manufacturer');
    setProductModels(data ?? []);
  }, []);

  const refreshProject = useCallback(async () => {
    if (!id) return;
    const { data: proj } = await supabase.from('projects').select('*').eq('id', parseInt(id)).single();
    if (proj) setProject(proj);
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !project) return <Navigate to="/projects" replace />;

  const statusKey = project.project_status ?? 'active';
  const status = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG['active'];
  const StatusIcon = status.icon;

  return (
    <ProjectContext.Provider value={{ project, productModels, datasheets, refreshDatasheets, refreshProductModels, refreshProject }}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 pb-5 border-b border-slate-200">
          <Link to="/projects" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 mb-3 transition-colors font-medium uppercase tracking-wider">
            <ArrowLeft className="w-3.5 h-3.5" />All Projects
          </Link>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md shadow-cyan-200">
              <FolderOpen className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900">{project.project_name || 'Untitled Project'}</h1>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.cls}`}>
                  <StatusIcon className="w-3 h-3" />{status.label}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {project.job_number && (
                  <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-cyan-700 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded-full">
                    {project.job_number}
                  </span>
                )}
                {project.client_name && <span className="text-sm text-slate-500">{project.client_name}</span>}
                {project.site_name && <span className="text-sm text-slate-400">· {project.site_name}</span>}
                {project.quote_number && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                    <Tag className="w-3 h-3" />{project.quote_number}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <Outlet />
      </div>
    </ProjectContext.Provider>
  );
}
