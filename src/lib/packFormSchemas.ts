import { getPacificCompletionSchema, isPacificCompletionKey } from './pacificCompletionPacks';
import { getCctvFormSchema, isCctvPackFormKey } from './cctvSurveillancePack';
import { getIntruderFormSchema, isIntruderPackFormKey } from './intruderAlarmPack';
import { getSdpSchema, isSdpFormKey } from './systemDesignProposal';
import type { SchemaCatalogue } from './schemaForm';

export function getPackFormSchema(key: string | null | undefined): SchemaCatalogue | null {
  if (isSdpFormKey(key)) return getSdpSchema();
  return getPacificCompletionSchema(key) ?? getIntruderFormSchema(key) ?? getCctvFormSchema(key);
}

export function isPackFormKey(key: string | null | undefined): boolean {
  return isSdpFormKey(key) || isPacificCompletionKey(key) || isIntruderPackFormKey(key) || isCctvPackFormKey(key);
}

export function packCustomerSignatureNotice(key: string | null | undefined, status: string): string {
  if (isSdpFormKey(key)) {
    return `${status}. This System Design Proposal is not an NSI certificate. Signatures bind only this revision. Later edits need a new revision and fresh signatures.`;
  }
  if (isPacificCompletionKey(key) || isCctvPackFormKey(key) || isIntruderPackFormKey(key)) {
    return `${status}. This company form is not an NSI certificate. Technical measurements remain the engineer’s and company’s responsibility. The customer acknowledges receipt and demonstration on this sheet, plus extra acceptance only for a specific change, restriction or incomplete item.`;
  }
  return `${status}. This is not an official NSI certificate.`;
}
