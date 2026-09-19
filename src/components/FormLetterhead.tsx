import type { ReactNode } from 'react';
import {
  DEFAULT_BRAND_INK,
  DEFAULT_BRAND_LOGO_SRC,
  DEFAULT_BRAND_PRIMARY,
  formatContractorAddress,
  formatContractorContact,
  resolveOmBrand,
  type ContractorBrand,
} from '../lib/contractorBrand';

export const PACIFIC_LOGO_SRC = DEFAULT_BRAND_LOGO_SRC;
export const PACIFIC_RED = DEFAULT_BRAND_PRIMARY;
export const PACIFIC_LABEL_GREY = '#D9D9D9';
export const PACIFIC_INK = DEFAULT_BRAND_INK;

export function FormLetterhead({
  brand,
  title,
  subtitle,
  jobRef,
}: {
  brand: ContractorBrand | null;
  title: string;
  subtitle?: string;
  jobRef?: string;
}) {
  const theme = resolveOmBrand(brand);
  const address = formatContractorAddress(brand);
  const contact = formatContractorContact(brand);

  return (
    <header className="relative border-b-2 overflow-hidden" style={{ borderColor: theme.primary }}>
      <div className="absolute right-0 top-0 h-full w-14" style={{ background: theme.primary }} aria-hidden />
      <div className="absolute right-16 top-4 flex flex-col gap-1.5" aria-hidden>
        <span className="block h-2 w-2 rounded-full" style={{ background: theme.primary }} />
        <span className="block h-2 w-2 rounded-full" style={{ background: theme.primary }} />
        <span className="block h-2 w-2 rounded-full" style={{ background: theme.primary }} />
      </div>
      <div className="flex items-start justify-between gap-4 px-6 py-5 pr-20">
        <div className="min-w-0">
          <img src={theme.logoSrc} alt={theme.name} className="h-14 w-auto max-w-[16rem] object-contain" />
          <p className="text-[10px] font-semibold tracking-[0.14em] uppercase mt-2" style={{ color: theme.primary }}>
            {theme.tagline}
          </p>
          {address ? <p className="text-xs mt-1" style={{ color: theme.ink }}>{address}</p> : null}
          {contact ? <p className="text-[11px] mt-0.5" style={{ color: theme.ink, opacity: 0.8 }}>{contact}</p> : null}
        </div>
        {jobRef ? (
          <p className="text-right text-[11px] shrink-0 max-w-[11rem] pt-1" style={{ color: theme.ink }}>
            <span className="block font-semibold uppercase tracking-wide" style={{ color: theme.primary }}>Job / site ref</span>
            {jobRef}
          </p>
        ) : null}
      </div>
      <div className="px-6 pb-4">
        <h1 className="text-xl font-bold uppercase tracking-wide leading-snug" style={{ color: theme.primary }}>{title}</h1>
        {subtitle ? <p className="text-xs mt-1" style={{ color: theme.ink }}>{subtitle}</p> : null}
      </div>
    </header>
  );
}

export function WorksheetField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block border border-[#404040] bg-white">
      <span className="block bg-[#D9D9D9] border-b border-[#404040] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#404040]">
        {label}
        {required ? <span className="text-[#C00000]"> *</span> : null}
      </span>
      <span className="block">{children}</span>
    </label>
  );
}
