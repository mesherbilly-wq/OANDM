export type AppRole = 'admin' | 'staff' | 'end_user';

export const APP_ROLES: { value: AppRole; label: string; description: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Full access, including Integrations, Handover Config, and users.' },
  { value: 'staff', label: 'Staff', description: 'Edit projects and documents. Cannot open Integrations or Handover Config.' },
  { value: 'end_user', label: 'End user', description: 'Invited to specific projects. Sees the O&M pack only, read-only, with download of the full pack or selected sections.' },
];

export function isAppRole(value: unknown): value is AppRole {
  return value === 'admin' || value === 'staff' || value === 'end_user';
}

export function roleLabel(role: AppRole): string {
  return APP_ROLES.find(item => item.value === role)?.label ?? role;
}

export function canAccessIntegrations(role: AppRole): boolean {
  return role === 'admin';
}

export function canAccessHandoverConfig(role: AppRole): boolean {
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
  return role === 'end_user' ? '/projects' : '/dashboard';
}

export function defaultProjectPath(projectId: number | string, role: AppRole): string {
  return role === 'end_user' ? `/projects/${projectId}/om-builder` : `/projects/${projectId}/info`;
}

export function canAccessPath(pathname: string, role: AppRole): boolean {
  if (pathname.startsWith('/f/') || pathname.startsWith('/i/') || pathname.startsWith('/u/')) return true;
  if (role === 'admin') return true;

  if (pathname.startsWith('/integrations') || pathname.startsWith('/users')) return false;

  if (role === 'staff') return true;

  if (pathname === '/projects' || pathname === '/om-preview') return true;

  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
  if (projectMatch) {
    const rest = projectMatch[2] ?? '';
    return rest === '' || rest === 'om-builder' || rest.startsWith('om-builder/');
  }

  return false;
}
