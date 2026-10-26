import type { EvidenceClass, QuantityBasis, ViewKind } from './types';

export interface ExtractedDeviceLine {
  systemType: string | null;
  deviceType: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  modelName: string | null;
  quantity: number;
  location: string | null;
  notes: string | null;
  quantityBasis: QuantityBasis;
  evidenceClass: EvidenceClass;
  viewKind: ViewKind;
  sourceFile: string | null;
  sourcePage: number | null;
  evidenceText: string | null;
  confidence: number | null;
  quantityKnown?: boolean;
}

export interface ReconciledDeviceLine extends ExtractedDeviceLine {
  conflict: string | null;
}

export interface ReconcileResult {
  devices: ReconciledDeviceLine[];
  issues: string[];
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function identity(line: ExtractedDeviceLine): string {
  const name = norm(line.deviceType) || norm(line.modelName) || 'device';
  return [norm(line.systemType), name, norm(line.modelNumber), norm(line.location)].join('|');
}

function sourceLabel(line: ExtractedDeviceLine): string {
  const page = line.sourcePage ? ` p.${line.sourcePage}` : '';
  return `${line.sourceFile ?? 'document'}${page}`;
}

function isSchedule(line: ExtractedDeviceLine): boolean {
  return line.quantityBasis === 'stated' || line.viewKind === 'schedule';
}

function isOverview(line: ExtractedDeviceLine): boolean {
  return line.viewKind === 'overview' || line.viewKind === 'revision';
}

function uniqueQuantities(lines: ExtractedDeviceLine[]): number[] {
  return [...new Set(lines.map(line => line.quantity))];
}

function prefer(lines: ExtractedDeviceLine[]): ExtractedDeviceLine {
  return [...lines].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
}

function withConflict(line: ExtractedDeviceLine, conflict: string | null): ReconciledDeviceLine {
  return { ...line, conflict };
}

export function reconcileDeviceLines(lines: ExtractedDeviceLine[]): ReconcileResult {
  const issues: string[] = [];
  const devices: ReconciledDeviceLine[] = [];
  const groups = new Map<string, ExtractedDeviceLine[]>();

  const unknown = lines.filter(line => line.quantityKnown === false);
  const knownLines = lines.filter(line => line.quantityKnown !== false);

  for (const line of knownLines) {
    if (!line.deviceType && !line.modelName && !line.modelNumber) continue;
    const key = identity(line);
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const quoted = group.filter(line => line.evidenceClass === 'quoted');
    const rest = group.filter(line => line.evidenceClass !== 'quoted');

    for (const line of quoted) {
      devices.push(withConflict(line, null));
      issues.push(`${line.deviceType ?? line.modelName ?? 'Equipment'} on ${sourceLabel(line)} is quoted scope, not confirmed installed equipment.`);
    }

    if (rest.length === 0) continue;

    const stated = rest.filter(isSchedule);
    const counted = rest.filter(line => !isSchedule(line));
    const detail = counted.filter(line => !isOverview(line));
    const overview = counted.filter(isOverview);

    if (stated.length > 0) {
      const chosen = prefer(stated);
      const statedQuantities = uniqueQuantities(stated);
      const countedQuantities = uniqueQuantities(counted);
      const messages: string[] = [];
      if (statedQuantities.length > 1) {
        messages.push(`Schedules disagree (${statedQuantities.join(' and ')}).`);
      }
      const compared = countedQuantities.filter(quantity => quantity !== chosen.quantity);
      if (compared.length > 0) {
        messages.push(`Drawing count ${compared.join(' and ')} does not match the stated quantity ${chosen.quantity}.`);
      }
      if (overview.length > 0) {
        messages.push('Overview or repeat views were not added again.');
      }
      const conflict = messages.length > 0 ? messages.join(' ') : null;
      devices.push(withConflict({ ...chosen, quantityBasis: 'stated' }, conflict));
      if (conflict) issues.push(`${chosen.deviceType ?? 'Device'}: ${conflict}`);
      continue;
    }

    if (detail.length > 0) {
      const samePage = new Map<string, number>();
      for (const line of detail) {
        const key = `${line.sourceFile ?? ''}:${line.sourcePage ?? ''}`;
        samePage.set(key, (samePage.get(key) ?? 0) + line.quantity);
      }
      const pageTotals = [...samePage.values()];
      const quantity = pageTotals.reduce((sum, value) => sum + value, 0);
      const chosen = prefer(detail);
      const overviewDiffers = overview.some(line => line.quantity !== quantity);
      const conflict = overview.length > 0
        ? overviewDiffers
          ? `Detail count is ${quantity}. A repeated overview drawing was not added on top.`
          : 'A repeated overview drawing was not added on top of the detail count.'
        : null;
      devices.push(withConflict({
        ...chosen,
        quantity,
        quantityBasis: 'counted',
      }, conflict));
      if (overviewDiffers) issues.push(`${chosen.deviceType ?? 'Device'}: detail count ${quantity} disagrees with an overview drawing.`);
      continue;
    }

    const pageTotals = new Map<string, number>();
    for (const line of overview.length > 0 ? overview : counted) {
      const key = `${line.sourceFile ?? ''}:${line.sourcePage ?? ''}`;
      pageTotals.set(key, (pageTotals.get(key) ?? 0) + line.quantity);
    }
    const totals = [...pageTotals.values()];
    const distinct = [...new Set(totals)];
    const chosen = prefer(overview.length > 0 ? overview : counted);
    if (distinct.length > 1) {
      const conflict = `Counts differ across drawings (${distinct.join(' and ')}). They were not added together.`;
      devices.push(withConflict({ ...chosen, quantity: distinct[0], quantityBasis: 'counted' }, conflict));
      issues.push(`${chosen.deviceType ?? 'Device'}: ${conflict}`);
    } else {
      devices.push(withConflict({
        ...chosen,
        quantity: totals.reduce((sum, value) => sum + value, 0) > (distinct[0] ?? 0) && pageTotals.size === 1
          ? totals[0]
          : (distinct[0] ?? chosen.quantity),
        quantityBasis: chosen.quantityBasis === 'unknown' ? 'counted' : chosen.quantityBasis,
      }, pageTotals.size > 1 ? 'The same count is repeated on more than one view, so it was kept once.' : null));
    }
  }

  for (const line of unknown) {
    if (!line.deviceType && !line.modelName && !line.modelNumber) continue;
    devices.push(withConflict(line, 'Quantity was not stated and was not defaulted to 1.'));
    issues.push(`${line.deviceType ?? line.modelName ?? 'Device'}: quantity was not stated.`);
  }

  return { devices, issues };
}
