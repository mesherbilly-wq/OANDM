import type { ReactNode } from 'react';
import { formatContractorAddress, formatContractorContact, type ContractorBrand } from '../lib/contractorBrand';

export const PACIFIC_LOGO_SRC = '/pacific-logo.png';
export const PACIFIC_RED = '#C00000';
export const PACIFIC_LABEL_GREY = '#D9D9D9';
export const PACIFIC_INK = '#404040';

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
  const address = formatContractorAddress(brand);
  const contact = formatContractorContact(brand);

  return (
    <header className="relative border-b-2 border-[#C00000] overflow-hidden">
      <div className="absolute right-0 top-0 h-full w-14 bg-[#C00000]" aria-hidden />
      <div className="absolute right-16 top-4 flex flex-col gap-1.5" aria-hidden>
        <span className="block h-2 w-2 rounded-full bg-[#C00000]" />
        <span className="block h-2 w-2 rounded-full bg-[#C00000]" />
        <span className="block h-2 w-2 rounded-full bg-[#C00000]" />
      </div>
      <div className="flex items-start justify-between gap-4 px-6 py-5 pr-20">
        <div className="min-w-0">
          <img src={PACIFIC_LOGO_SRC} alt="Pacific Fire & Security" className="h-14 w-auto max-w-[16rem] object-contain" />
          <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[#C00000] mt-2">
            Specialists in fire; experts in security
          </p>
          {address ? <p className="text-xs text-[#404040] mt-1">{address}</p> : null}
          {contact ? <p className="text-[11px] text-[#404040]/80 mt-0.5">{contact}</p> : null}
        </div>
        {jobRef ? (
          <p className="text-right text-[11px] text-[#404040] shrink-0 max-w-[11rem] pt-1">
            <span className="block font-semibold uppercase tracking-wide text-[#C00000]">Job / site ref</span>
            {jobRef}
          </p>
        ) : null}
      </div>
      <div className="px-6 pb-4">
        <h1 className="text-xl font-bold uppercase tracking-wide leading-snug text-[#C00000]">{title}</h1>
        {subtitle ? <p className="text-xs text-[#404040] mt-1">{subtitle}</p> : null}
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
