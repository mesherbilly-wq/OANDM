import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectLayout } from './pages/ProjectLayout';
import ProjectInfoPage from './pages/ProjectInfoPage';
import DocumentManagementPage from './pages/DocumentManagementPage';
import ProjectSystemsPage from './pages/ProjectSystemsPage';
import { ProjectDrawingsPage } from './pages/ProjectDrawingsPage';
import DeviceSchedulePage from './pages/DeviceSchedulePage';
import TechnicalDocsPage from './pages/TechnicalDocsPage';
import CommissioningPage from './pages/CommissioningPage';
import HandoverPage from './pages/HandoverPage';
import { ProjectDatasheetsPage } from './pages/ProjectDatasheetsPage';
import { ProjectOMExportPage } from './pages/ProjectOMExportPage';
import ExportCentrePage from './pages/ExportCentrePage';
import { ProductModelsPage } from './pages/ProductModelsPage';
import { OMPreviewPage } from './pages/OMPreviewPage';
import { AIProjectBuilderPage } from './pages/AIProjectBuilderPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { ImportReviewPage } from './pages/ImportReviewPage';
import AsBuiltDrawingsPage from './pages/AsBuiltDrawingsPage';
import PublicHandoverFormPage from './pages/PublicHandoverFormPage';
import { UsersPage } from './pages/UsersPage';
import { ProjectInvitePage } from './pages/ProjectInvitePage';
import SdpPage from './pages/SdpPage';
import DocumentReturnPage from './pages/DocumentReturnPage';
import { UserAccessProvider, useUserAccess } from './lib/userAccess';
import { defaultHomePath, isEndUser } from './lib/appRoles';
import { RequireAccess } from './components/RequireAccess';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [companyName, setCompanyName] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionLoading(false);
      if (session) loadCompany();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadCompany();
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadCompany = async () => {
    const { data } = await supabase.from('contractor_profile').select('company_name').limit(1).maybeSingle();
    if (data?.company_name) setCompanyName(data.company_name);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setCompanyName('');
  };

  const isPublicFormPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/f/');
  const isInvitePath = typeof window !== 'undefined' && window.location.pathname.startsWith('/i/');
  const isReturnPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/r/');

  if (isPublicFormPath) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/f/:token" element={<PublicHandoverFormPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (isReturnPath) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/r/:token" element={<DocumentReturnPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    if (isInvitePath) {
      return (
        <BrowserRouter>
          <Routes>
            <Route path="/i/:token" element={<ProjectInvitePage />} />
            <Route path="*" element={<AuthPage />} />
          </Routes>
        </BrowserRouter>
      );
    }
    return <AuthPage />;
  }

  return (
    <UserAccessProvider user={session.user}>
      <AuthedApp
        companyName={companyName}
        userEmail={session.user.email ?? ''}
        onSignOut={handleSignOut}
      />
    </UserAccessProvider>
  );
}

function ProjectIndexRedirect() {
  const { role } = useUserAccess();
  return <Navigate to={isEndUser(role) ? 'om-builder' : 'info'} replace />;
}

function AuthedApp({
  companyName,
  userEmail,
  onSignOut,
}: {
  companyName: string;
  userEmail: string;
  onSignOut: () => void;
}) {
  const { role, roleLoading } = useUserAccess();

  if (roleLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/f/:token" element={<PublicHandoverFormPage />} />
        <Route path="/r/:token" element={<DocumentReturnPage />} />
        <Route path="/i/:token" element={<ProjectInvitePage />} />
        <Route path="/" element={<Layout companyName={companyName} userEmail={userEmail} onSignOut={onSignOut} />}>
          <Route index element={<Navigate to={defaultHomePath(role)} replace />} />
          <Route path="dashboard" element={<RequireAccess><DashboardPage /></RequireAccess>} />
          <Route path="projects" element={<RequireAccess><ProjectsPage /></RequireAccess>} />
          <Route path="create-project" element={<RequireAccess><AIProjectBuilderPage /></RequireAccess>} />
          <Route path="ai-builder" element={<Navigate to="/create-project" replace />} />

          <Route path="projects/:id" element={<RequireAccess><ProjectLayout /></RequireAccess>}>
            <Route index element={<ProjectIndexRedirect />} />
            <Route path="info" element={<ProjectInfoPage />} />
            <Route path="documents" element={<DocumentManagementPage />} />
            <Route path="systems" element={<ProjectSystemsPage />} />
            <Route path="systems/:system" element={<ProjectSystemsPage />} />
            <Route path="schedule" element={<DeviceSchedulePage />} />
            <Route path="technical" element={<TechnicalDocsPage />} />
            <Route path="commissioning" element={<CommissioningPage />} />
            <Route path="sdp" element={<SdpPage />} />
            <Route path="handover" element={<HandoverPage />} />
            <Route path="safetyculture" element={<Navigate to="../handover" replace />} />
            <Route path="datasheets" element={<ProjectDatasheetsPage />} />
            <Route path="as-fitted" element={<AsBuiltDrawingsPage />} />
            <Route path="om-builder" element={<ProjectOMExportPage />} />
            <Route path="export" element={<ExportCentrePage />} />
            <Route path="cctv" element={<Navigate to="../systems/cctv" replace />} />
            <Route path="access-control" element={<Navigate to="../systems/access-control" replace />} />
            <Route path="intercom" element={<Navigate to="../systems/intercom" replace />} />
            <Route path="intruder" element={<Navigate to="../systems/intruder" replace />} />
            <Route path="networking" element={<Navigate to="../systems/networking" replace />} />
            <Route path="om-export" element={<Navigate to="../om-builder" replace />} />
          </Route>

          <Route path="product-models" element={<RequireAccess><ProductModelsPage /></RequireAccess>} />
          <Route path="integrations" element={<RequireAccess><IntegrationsPage /></RequireAccess>} />
          <Route path="users" element={<RequireAccess><UsersPage /></RequireAccess>} />
          <Route path="import-review" element={<RequireAccess><ImportReviewPage /></RequireAccess>} />
          <Route path="om-preview" element={<RequireAccess><OMPreviewPage /></RequireAccess>} />
        </Route>
        <Route path="*" element={<Navigate to={defaultHomePath(role)} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
