import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { isAppRole, type AppRole } from './appRoles';

interface UserAccessValue {
  role: AppRole;
  roleLoading: boolean;
  profilesReady: boolean;
  refreshRole: () => Promise<void>;
}

const UserAccessContext = createContext<UserAccessValue | null>(null);

async function ensureProfile(user: User): Promise<{ role: AppRole; profilesReady: boolean }> {
  const { data, error } = await supabase
    .from('app_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    // Table not created yet — keep full access so the current account is not locked out.
    return { role: 'admin', profilesReady: false };
  }

  if (data && isAppRole(data.role)) {
    return { role: data.role, profilesReady: true };
  }

  await supabase.from('app_profiles').insert({
    user_id: user.id,
    email: user.email ?? '',
    role: 'end_user',
  });

  const { data: created } = await supabase
    .from('app_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    role: created && isAppRole(created.role) ? created.role : 'end_user',
    profilesReady: true,
  };
}

export function UserAccessProvider({ user, children }: { user: User; children: ReactNode }) {
  const [role, setRole] = useState<AppRole>('admin');
  const [roleLoading, setRoleLoading] = useState(true);
  const [profilesReady, setProfilesReady] = useState(false);

  const refreshRole = useCallback(async () => {
    const next = await ensureProfile(user);
    setRole(next.role);
    setProfilesReady(next.profilesReady);
    setRoleLoading(false);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    setRoleLoading(true);
    ensureProfile(user).then(next => {
      if (cancelled) return;
      setRole(next.role);
      setProfilesReady(next.profilesReady);
      setRoleLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const value = useMemo(
    () => ({ role, roleLoading, profilesReady, refreshRole }),
    [role, roleLoading, profilesReady, refreshRole],
  );

  return <UserAccessContext.Provider value={value}>{children}</UserAccessContext.Provider>;
}

export function useUserAccess(): UserAccessValue {
  const ctx = useContext(UserAccessContext);
  if (!ctx) throw new Error('useUserAccess must be used within UserAccessProvider');
  return ctx;
}
