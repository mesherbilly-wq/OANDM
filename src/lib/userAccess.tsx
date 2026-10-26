import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { fetchPublicContractorBrand } from './contractorBrand';
import { isAppRole, type AppRole } from './appRoles';

interface UserAccessValue {
  role: AppRole;
  userId: string;
  companyId: string | null;
  companyName: string;
  companyStatus: 'active' | 'suspended' | null;
  subscriptionPlan: string | null;
  tenancyReady: boolean;
  roleLoading: boolean;
  profilesReady: boolean;
  refreshRole: () => Promise<void>;
}

const UserAccessContext = createContext<UserAccessValue | null>(null);

interface LoadedAccess {
  role: AppRole;
  companyId: string | null;
  companyName: string;
  companyStatus: 'active' | 'suspended' | null;
  subscriptionPlan: string | null;
  tenancyReady: boolean;
  profilesReady: boolean;
}

async function loadCompany(companyId: string | null, role: AppRole): Promise<Pick<LoadedAccess, 'companyName' | 'companyStatus' | 'subscriptionPlan'>> {
  if (role === 'master') {
    return { companyName: 'Platform', companyStatus: null, subscriptionPlan: null };
  }
  if (!companyId) {
    return { companyName: '', companyStatus: null, subscriptionPlan: null };
  }

  const { data, error } = await supabase
    .from('platform_companies')
    .select('name, status, subscription_plan')
    .eq('id', companyId)
    .maybeSingle();

  if (!error && data) {
    const status = data.status === 'suspended' ? 'suspended' : 'active';
    return {
      companyName: String(data.name ?? ''),
      companyStatus: status,
      subscriptionPlan: data.subscription_plan ? String(data.subscription_plan) : null,
    };
  }

  const brand = await fetchPublicContractorBrand();
  return {
    companyName: brand?.company_name?.trim() ?? '',
    companyStatus: 'active',
    subscriptionPlan: null,
  };
}

async function ensureProfile(user: User): Promise<LoadedAccess> {
  const withCompany = await supabase
    .from('app_profiles')
    .select('role, company_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (withCompany.error && /company_id|platform_companies|schema cache/i.test(withCompany.error.message)) {
    const { data, error } = await supabase
      .from('app_profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      return {
        role: 'admin',
        companyId: null,
        companyName: '',
        companyStatus: null,
        subscriptionPlan: null,
        tenancyReady: false,
        profilesReady: false,
      };
    }
    const role = data && isAppRole(data.role) ? data.role : 'admin';
    return {
      role,
      companyId: null,
      companyName: '',
      companyStatus: null,
      subscriptionPlan: null,
      tenancyReady: false,
      profilesReady: true,
    };
  }

  if (withCompany.error) {
    return {
      role: 'admin',
      companyId: null,
      companyName: '',
      companyStatus: null,
      subscriptionPlan: null,
      tenancyReady: false,
      profilesReady: false,
    };
  }

  let role: AppRole = 'end_user';
  let companyId: string | null = null;
  if (withCompany.data && isAppRole(withCompany.data.role)) {
    role = withCompany.data.role;
    companyId = withCompany.data.company_id ? String(withCompany.data.company_id) : null;
  } else {
    await supabase.from('app_profiles').insert({
      user_id: user.id,
      email: user.email ?? '',
      role: 'end_user',
    });
    const { data: created } = await supabase
      .from('app_profiles')
      .select('role, company_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (created && isAppRole(created.role)) role = created.role;
    companyId = created?.company_id ? String(created.company_id) : null;
  }

  const company = await loadCompany(companyId, role);
  return {
    role,
    companyId,
    ...company,
    tenancyReady: true,
    profilesReady: true,
  };
}

export function UserAccessProvider({ user, children }: { user: User; children: ReactNode }) {
  const [access, setAccess] = useState<LoadedAccess>({
    role: 'admin',
    companyId: null,
    companyName: '',
    companyStatus: null,
    subscriptionPlan: null,
    tenancyReady: false,
    profilesReady: false,
  });
  const [roleLoading, setRoleLoading] = useState(true);

  const refreshRole = useCallback(async () => {
    const next = await ensureProfile(user);
    setAccess(next);
    setRoleLoading(false);
  }, [user.id, user.email]);

  useEffect(() => {
    let cancelled = false;
    setRoleLoading(true);
    ensureProfile(user).then(next => {
      if (cancelled) return;
      setAccess(next);
      setRoleLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const value = useMemo(
    () => ({ ...access, userId: user.id, roleLoading, refreshRole }),
    [access, user.id, roleLoading, refreshRole],
  );

  return <UserAccessContext.Provider value={value}>{children}</UserAccessContext.Provider>;
}

export function useUserAccess(): UserAccessValue {
  const ctx = useContext(UserAccessContext);
  if (!ctx) throw new Error('useUserAccess must be used within UserAccessProvider');
  return ctx;
}
