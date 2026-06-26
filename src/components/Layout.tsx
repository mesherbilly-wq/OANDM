import React, { useState } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import {
  Shield, LayoutDashboard, FolderOpen, Box, Menu, X, Plus, Plug,
  ChevronDown, ChevronRight,
  Camera, Lock, PhoneCall, ShieldAlert, Network, ScanLine, Radar,
  ImageIcon, BookOpen, Cpu, Wifi, ClipboardCheck, Award, Download, Info,
  FileText, Layers, ExternalLink, LogOut, Building2, User,
} from 'lucide-react';

const SYSTEM_SUB_NAV = [
  { name: 'CCTV',                slug: 'cctv',           icon: Camera },
  { name: 'Access Control',      slug: 'access-control', icon: Lock },
  { name: 'Intruder',            slug: 'intruder',       icon: ShieldAlert },
  { name: 'Intercom',            slug: 'intercom',       icon: PhoneCall },
  { name: 'ANPR',                slug: 'anpr',           icon: ScanLine },
  { name: 'Perimeter Detection', slug: 'perimeter',      icon: Radar },
  { name: 'Networking',          slug: 'networking',     icon: Network },
];

const PROJECT_MODULES = [
  { name: 'Overview',           slug: 'info',          icon: Info },
  { name: 'Document Mgmt',      slug: 'documents',     icon: FileText },
  { name: 'Systems',            slug: 'systems',       icon: Cpu,           hasChildren: true },
  { name: 'Device Schedule',    slug: 'schedule',      icon: ClipboardCheck },
  { name: 'Technical Docs',     slug: 'technical',     icon: Wifi },
  { name: 'Commissioning',      slug: 'commissioning',  icon: ShieldAlert },
  { name: 'Handover',           slug: 'handover',       icon: Award },
  { name: 'As Fitted Drawings', slug: 'as-fitted',      icon: Layers },
  { name: 'Datasheets',         slug: 'datasheets',    icon: BookOpen },
  { name: 'O&M Builder',        slug: 'om-builder',    icon: FolderOpen },
  { name: 'Export Centre',      slug: 'export',        icon: Download },
];

export function Layout({ companyName, userEmail, onSignOut }: {
  companyName?: string;
  userEmail?: string;
  onSignOut?: () => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [systemsExpanded, setSystemsExpanded] = useState(true);
  const location = useLocation();

  const projectMatch = location.pathname.match(/^\/projects\/(\d+)/);
  const currentProjectId = projectMatch?.[1] ?? null;

  const isActive = (href: string) =>
    location.pathname === href || (href !== '/dashboard' && href !== '/projects' && location.pathname.startsWith(href));

  const isProjectsActive = location.pathname.startsWith('/projects') && !currentProjectId;

  return (
    <div className="min-h-screen bg-slate-50">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed top-0 left-0 z-50 h-full w-64 bg-slate-950 transform transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-slate-800 flex-shrink-0">
          <Link to="/dashboard" className="flex items-center gap-3">
            <img
              src="https://www.pacific-uk.co.uk/wp-content/uploads/2018/07/pacific-logo.png"
              alt="Pacific Fire and Security Systems"
              className="h-8 object-contain"
            />
          </Link>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          <NavLink href="/dashboard" icon={LayoutDashboard} label="Dashboard"
            active={isActive('/dashboard')} onClick={() => setSidebarOpen(false)} />

          <NavLink href="/projects" icon={FolderOpen} label="Projects"
            active={isProjectsActive} onClick={() => setSidebarOpen(false)} />

          {/* Project sub-nav */}
          {currentProjectId && (
            <div className="ml-1 mt-1 space-y-0.5">
              <div className="px-2 py-1">
                <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider truncate">
                  Project #{currentProjectId}
                </p>
              </div>
              {PROJECT_MODULES.map(mod => {
                const href = `/projects/${currentProjectId}/${mod.slug}`;
                const isSystemsModule = mod.slug === 'systems';
                const active = location.pathname.startsWith(href) || (isSystemsModule && location.pathname.includes('/systems/'));

                if (isSystemsModule) {
                  return (
                    <div key={mod.slug}>
                      <button
                        onClick={() => { setSystemsExpanded(e => !e); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${active ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                      >
                        <mod.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="font-medium flex-1 text-left">Systems</span>
                        {systemsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      {systemsExpanded && (
                        <div className="ml-3 mt-0.5 pl-3 border-l border-slate-800 space-y-0.5">
                          {SYSTEM_SUB_NAV.map(s => {
                            const sHref = `/projects/${currentProjectId}/systems/${s.slug}`;
                            const sActive = location.pathname === sHref || location.pathname.startsWith(sHref);
                            return (
                              <Link key={s.slug} to={sHref} onClick={() => setSidebarOpen(false)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${sActive ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'}`}>
                                <s.icon className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="font-medium">{s.name}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <Link key={mod.slug} to={href} onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${active ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                    <mod.icon className="w-4 h-4 flex-shrink-0" />
                    <span className="font-medium">{mod.name}</span>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="pt-3 mt-2 border-t border-slate-800/60">
            <NavLink href="/product-models" icon={Box} label="Product Database"
              active={isActive('/product-models')} onClick={() => setSidebarOpen(false)} />

            <Link to="/create-project" onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all mt-0.5 ${isActive('/create-project') ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-900/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              <Plus className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">Create Project</span>
            </Link>

            <NavLink href="/integrations" icon={Plug} label="Integrations"
              active={isActive('/integrations')} onClick={() => setSidebarOpen(false)} />
          </div>
        </nav>

        <div className="px-3 py-3 border-t border-slate-800 flex-shrink-0 space-y-1">
          {/* Company / user info */}
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
            <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center flex-shrink-0">
              {companyName
                ? <Building2 className="w-4 h-4 text-slate-400" />
                : <User className="w-4 h-4 text-slate-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-300 truncate leading-tight">
                {companyName || 'My Company'}
              </p>
              {userEmail && (
                <p className="text-[10px] text-slate-600 truncate leading-tight">{userEmail}</p>
              )}
            </div>
          </div>
          {/* Sign out */}
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-all text-sm"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              <span className="font-medium">Sign Out</span>
            </button>
          )}
          <p className="text-slate-700 text-[10px] text-center uppercase tracking-wider pt-1">SecureOps v2.0</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
          <div className="flex items-center h-14 px-4 sm:px-6">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-slate-500 hover:text-slate-700 mr-3">
              <Menu className="w-6 h-6" />
            </button>
            <div className="flex-1" />
            <span className="text-xs text-slate-400 font-medium">Security Project Lifecycle Platform</span>
          </div>
        </header>

        <main className="p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavLink({ href, icon: Icon, label, active, onClick }: {
  href: string; icon: React.ElementType; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <Link to={href} onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${active ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="font-medium">{label}</span>
    </Link>
  );
}
