import { getCctvFormSchema, isCctvPackFormKey } from './cctvSurveillancePack';
import { getIntruderFormSchema, isIntruderPackFormKey } from './intruderAlarmPack';
import type { SchemaCatalogue } from './schemaForm';

export function getPackFormSchema(key: string | null | undefined): SchemaCatalogue | null {
  return getIntruderFormSchema(key) ?? getCctvFormSchema(key);
}

export function isPackFormKey(key: string | null | undefined): boolean {
  return isIntruderPackFormKey(key) || isCctvPackFormKey(key);
}

export function packCustomerSignatureNotice(key: string | null | undefined, status: string): string {
  if (isCctvPackFormKey(key)) {
    return `${status}. This is not an official NSI certificate. Technical measurements and tests are the engineer’s and company’s responsibility. The customer signs CV08 once, plus CV15 only where a change, restriction or incomplete work needs agreement.`;
  }
  return `${status}. This is not an official NSI certificate. Technical measurements and tests are the engineer’s and company’s responsibility. The customer signs IA07 once, plus IA05/IA11/IA12/IA13 only where a change or limitation needs agreement.`;
}
