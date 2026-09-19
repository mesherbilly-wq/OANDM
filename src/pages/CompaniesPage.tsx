import { Building2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { CompaniesManager } from '../components/CompaniesManager';
import { canEditOperations, defaultHomePath } from '../lib/appRoles';
import { useUserAccess } from '../lib/userAccess';

export function CompaniesPage() {
  const { role, roleLoading } = useUserAccess();

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canEditOperations(role)) {
    return <Navigate to={defaultHomePath(role)} replace />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-slate-400" />
          <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Set up companies, logos and O&amp;M colours here before you start a project. New projects use the default company unless you pick another.
        </p>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <CompaniesManager />
      </div>
    </div>
  );
}
