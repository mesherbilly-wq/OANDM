import type { ReactNode } from 'react';
import { formatContractorAddress, formatContractorContact, type ContractorBrand } from '../lib/contractorBrand';

export function FormLetterhead({
  brand,
  title,
  subtitle,
  jobRef,
  dateLabel,
}: {
  brand: ContractorBrand | null;
  title: string;
  subtitle?: string;
  jobRef?: string;
  dateLabel?: string;
}) {
  const company = brand?.company_name?.trim() || 'O&M Builder';
  const address = formatContractorAddress(brand);
  const contact = formatContractorContact(brand);
  const certs = [brand?.nsi_number ? `NSI ${brand.nsi_number}` : null, brand?.ssaib_number ? `SSAIB ${brand.ssaib_number}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <header className="border-b-4 border-slate-900">
      <div className="flex items-start justify-between gap-4 px-6 py-5">
        <div className="flex items-start gap-4 min-w-0">
          {brand?.logo_url ? (
            <img src={brand.logo_url} alt={company} className="h-16 w-auto max-w-[11rem] object-contain flex-shrink-0" />
          ) : (
            <div className="h-16 w-16 bg-slate-900 text-white flex items-center justify-center text-lg font-bold flex-shrink-0">
              {company.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-lg font-bold tracking-tight text-slate-900 leading-tight">{company}</p>
            {address ? <p className="text-xs text-slate-600 mt-1">{address}</p> : null}
            {contact ? <p className="text-[11px] text-slate-500 mt-1">{contact}</p> : null}
            {certs ? <p className="text-[11px] text-slate-500 mt-1">{certs}</p> : null}
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-600 shrink-0 space-y-2 max-w-[12rem]">
          {jobRef ? (
            <p>
              <span className="block font-semibold uppercase tracking-wide text-slate-500">Job / site ref</span>
              {jobRef}
            </p>
          ) : null}
          {dateLabel ? (
            <p>
              <span className="block font-semibold uppercase tracking-wide text-slate-500">Date</span>
              {dateLabel}
            </p>
          ) : null}
        </div>
      </div>
      <div className="bg-slate-900 text-white px-6 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-slate-300">Completion record</p>
        <h1 className="text-lg font-semibold uppercase tracking-wide leading-snug mt-0.5">{title}</h1>
        {subtitle ? <p className="text-xs text-slate-300 mt-1">{subtitle}</p> : null}
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
    <label className="block border border-slate-800 bg-white">
      <span className="block bg-slate-100 border-b border-slate-800 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <span className="block">{children}</span>
    </label>
  );
}
