import { supabase } from './supabase';

export interface ContractorBrand {
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
}

export function formatContractorAddress(brand: ContractorBrand | null | undefined): string {
  if (!brand) return '';
  return [brand.address_line1, brand.address_line2, brand.city, brand.postcode].filter(Boolean).join(', ');
}

export function formatContractorContact(brand: ContractorBrand | null | undefined): string {
  if (!brand) return '';
  return [brand.telephone, brand.email, brand.website].filter(Boolean).join(' · ');
}

export async function fetchPublicContractorBrand(): Promise<ContractorBrand | null> {
  const { data, error } = await supabase
    .from('contractor_profile')
    .select('company_name,logo_url,address_line1,address_line2,city,postcode,telephone,email,website,nsi_number,ssaib_number')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ContractorBrand;
}

export async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
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
