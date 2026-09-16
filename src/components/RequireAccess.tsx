import { Navigate, useLocation } from 'react-router-dom';
import { canAccessPath, defaultHomePath, defaultProjectPath, isEndUser } from '../lib/appRoles';
import { useUserAccess } from '../lib/userAccess';

export function RequireAccess({ children }: { children: React.ReactNode }) {
  const { role, roleLoading } = useUserAccess();
  const location = useLocation();

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isEndUser(role)) {
    const projectInner = location.pathname.match(/^\/projects\/([^/]+)\/(.+)$/);
    if (projectInner && projectInner[2] !== 'om-builder' && !projectInner[2].startsWith('om-builder/')) {
      return <Navigate to={defaultProjectPath(projectInner[1], role)} replace />;
    }
  }

  if (!canAccessPath(location.pathname, role)) {
    return <Navigate to={defaultHomePath(role)} replace />;
  }

  return <>{children}</>;
}
