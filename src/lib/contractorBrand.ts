import { supabase } from './supabase';

export const DEFAULT_BRAND_PRIMARY = '#C00000';
export const DEFAULT_BRAND_INK = '#404040';
export const DEFAULT_BRAND_TAGLINE = 'Specialists in fire; experts in security';
export const DEFAULT_BRAND_LOGO_SRC = '/pacific-logo.png';

export interface ContractorBrand {
  id?: number;
  company_name: string | null;
  logo_url: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  telephone: string | null;
  email: string | null;
  website: string | null;
  nsi_number: string | null;
  ssaib_number: string | null;
  brand_primary?: string | null;
  brand_ink?: string | null;
  tagline?: string | null;
  is_default?: boolean;
}

export interface OmBrandTheme {
  name: string;
  tagline: string;
  logoSrc: string;
  primary: string;
  ink: string;
  primaryRgb: [number, number, number];
  inkRgb: [number, number, number];
}

export function formatContractorAddress(brand: ContractorBrand | null | undefined): string {
  if (!brand) return '';
  return [brand.address_line1, brand.address_line2, brand.city, brand.postcode].filter(Boolean).join(', ');
}

export function formatContractorContact(brand: ContractorBrand | null | undefined): string {
  if (!brand) return '';
  return [brand.telephone, brand.email, brand.website].filter(Boolean).join(' · ');
}

export function normalizeBrandHex(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? '').trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(raw)) {
    return (raw.startsWith('#') ? raw : `#${raw}`).toUpperCase();
  }
  if (/^#?[0-9a-fA-F]{3}$/.test(raw)) {
    const h = raw.replace('#', '');
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }
  return fallback;
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  const cleaned = normalizeBrandHex(hex, DEFAULT_BRAND_PRIMARY).slice(1);
  const n = parseInt(cleaned, 16);
  if (!Number.isFinite(n)) return [192, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function resolveOmBrand(contractor: ContractorBrand | null | undefined): OmBrandTheme {
  const primary = normalizeBrandHex(contractor?.brand_primary, DEFAULT_BRAND_PRIMARY);
  const ink = normalizeBrandHex(contractor?.brand_ink, DEFAULT_BRAND_INK);
  return {
    name: contractor?.company_name?.trim() || 'Operations & Maintenance',
    tagline: contractor?.tagline?.trim() || DEFAULT_BRAND_TAGLINE,
    logoSrc: contractor?.logo_url?.trim() || DEFAULT_BRAND_LOGO_SRC,
    primary,
    ink,
    primaryRgb: hexToRgbTuple(primary),
    inkRgb: hexToRgbTuple(ink),
  };
}

export async function fetchPublicContractorBrand(): Promise<ContractorBrand | null> {
  const { data: preferred } = await supabase
    .from('contractor_profile')
    .select('*')
    .eq('is_default', true)
    .order('id')
    .limit(1)
    .maybeSingle();
  if (preferred) return preferred as ContractorBrand;

  const { data, error } = await supabase
    .from('contractor_profile')
    .select('*')
    .order('id')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ContractorBrand;
}

export async function fetchDefaultContractorProfileId(): Promise<number | null> {
  const brand = await fetchPublicContractorBrand();
  return brand?.id ?? null;
}

export async function fetchContractorForProject(opts: {
  projectId: number;
  contractorProfileId?: number | null;
}): Promise<ContractorBrand | null> {
  if (opts.contractorProfileId) {
    const { data } = await supabase
      .from('contractor_profile')
      .select('*')
      .eq('id', opts.contractorProfileId)
      .maybeSingle();
    if (data) return data as ContractorBrand;
  }

  const { data: project } = await supabase
    .from('projects')
    .select('contractor_profile_id')
    .eq('id', opts.projectId)
    .maybeSingle();

  if (project?.contractor_profile_id) {
    const { data } = await supabase
      .from('contractor_profile')
      .select('*')
      .eq('id', project.contractor_profile_id)
      .maybeSingle();
    if (data) return data as ContractorBrand;
  }

  return fetchPublicContractorBrand();
}

export async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const resolved = url.startsWith('http') || url.startsWith('data:') || !origin ? url : `${origin}${url}`;
    const response = await fetch(resolved);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
