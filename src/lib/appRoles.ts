export type AppRole = 'master' | 'admin' | 'staff' | 'end_user';
export type CompanyRole = 'admin' | 'staff' | 'end_user';

export const APP_ROLES: { value: CompanyRole; label: string; description: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Full access inside this company, including Integrations, Document Management, Templates, Handover Config, and users.' },
  { value: 'staff', label: 'Staff', description: 'Edit projects in this company. Cannot open Integrations, Document Management, Templates, Handover Config, or Users.' },
  { value: 'end_user', label: 'End user', description: 'Invited to specific projects in this company. Sees the O&M pack only, read-only, with download of the full pack or selected sections.' },
];

export function isAppRole(value: unknown): value is AppRole {
  return value === 'master' || value === 'admin' || value === 'staff' || value === 'end_user';
}

export function isCompanyRole(value: AppRole): value is CompanyRole {
  return value === 'admin' || value === 'staff' || value === 'end_user';
}

export function isPlatformMaster(role: AppRole): boolean {
  return role === 'master';
}

export function roleLabel(role: AppRole): string {
  if (role === 'master') return 'Platform owner';
  return APP_ROLES.find(item => item.value === role)?.label ?? role;
}

export function canAccessIntegrations(role: AppRole): boolean {
  return role === 'admin';
}

export function canAccessHandoverConfig(role: AppRole): boolean {
  return role === 'admin';
}

export function canAccessDocumentManagement(role: AppRole): boolean {
  return role === 'admin';
}

export function canAccessTemplates(role: AppRole): boolean {
  return role === 'admin';
}

export function canManageUsers(role: AppRole): boolean {
  return role === 'admin';
}

export function canEditOperations(role: AppRole): boolean {
  return role === 'admin' || role === 'staff';
}

export function isEndUser(role: AppRole): boolean {
  return role === 'end_user';
}

export function defaultHomePath(role: AppRole): string {
  if (role === 'master') return '/platform';
  return role === 'end_user' ? '/projects' : '/dashboard';
}

export function defaultProjectPath(projectId: number | string, role: AppRole): string {
  return role === 'end_user' ? `/projects/${projectId}/om-builder` : `/projects/${projectId}/info`;
}

export function canAccessPath(pathname: string, role: AppRole): boolean {
  if (pathname.startsWith('/f/') || pathname.startsWith('/c/') || pathname.startsWith('/i/') || pathname.startsWith('/u/')) return true;
  if (pathname.startsWith('/platform')) return role === 'master';
  if (role === 'master') return false;
  if (role === 'admin') return true;

  if (pathname.startsWith('/companies')) return canEditOperations(role);
  if (pathname.startsWith('/integrations') || pathname.startsWith('/users')) return false;
  if (/^\/projects\/[^/]+\/documents(?:\/|$)/.test(pathname)) return false;
  if (/^\/projects\/[^/]+\/templates(?:\/|$)/.test(pathname)) return false;

  if (role === 'staff') return true;

  if (pathname === '/projects' || pathname === '/om-preview') return true;

  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
  if (projectMatch) {
    const rest = projectMatch[2] ?? '';
    return rest === '' || rest === 'om-builder' || rest.startsWith('om-builder/');
  }

  return false;
}
