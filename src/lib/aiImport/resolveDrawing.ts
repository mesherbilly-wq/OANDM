import type { CameraSymbolCount } from './countSymbols';
import type { AiExtractedDevice, AiExtractedSection, AiExtractPayload, AiQuantitySummary } from './types';

export interface DrawingFacts {
  siteName: string | null;
  siteAddress: string | null;
  drawingAuthor: string | null;
  documentStatus: string | null;
  proposedDesign: boolean;
  statedCameraTotal: number | null;
  cameraReferences: string[];
  fields: Record<string, string>;
  blankFields: string[];
}

export interface PdfTextItem {
  str?: string;
  transform?: number[];
}

export interface PdfAnnotation {
  subtype?: string;
  contents?: string;
  contentsObj?: { str?: string };
}

function joinPdfLine(parts: string[]): string {
  const words: string[] = [];
  for (const part of parts) {
    const previous = words[words.length - 1];
    const ligature = /^(?:fi|fl|ff|ffi|ffl)$/.test(part);
    const continuesWord = Boolean(previous && /(?:fi|fl|ff|ffi|ffl)$/.test(previous) && /^[a-z]/.test(part));
    if (previous && (ligature || continuesWord)) words[words.length - 1] = previous + part;
    else words.push(part);
  }
  return words.join(' | ');
}

function clean(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text || null;
}

function field(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return clean(match?.[1]?.split('|')[0]?.replace(/[.\s]+$/, ''));
}

function addressLines(text: string): string[] {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const collected: string[] = [];
  let capture = false;
  for (const line of lines) {
    const cell = line.split('|')[0].trim();
    if (/^site address:?$/i.test(cell)) {
      capture = true;
      continue;
    }
    if (!capture) continue;
    if (/:/.test(cell)) break;
    collected.push(cell.replace(/,$/, ''));
    if (collected.length >= 6) break;
  }
  return collected;
}

export function transcriptFromPdf(items: PdfTextItem[], annotations: PdfAnnotation[] = []): string {
  const rows = new Map<number, { x: number; text: string }[]>();
  for (const item of items) {
    const text = item.str?.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const y = Math.round(item.transform?.[5] ?? 0);
    const row = rows.get(y) ?? [];
    row.push({ x: item.transform?.[4] ?? 0, text });
    rows.set(y, row);
  }
  const body = [...rows.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, parts]) => joinPdfLine(parts.sort((left, right) => left.x - right.x).map(part => part.text)))
    .join('\n');
  const labels = annotations
    .map(annotation => clean(annotation.contentsObj?.str || annotation.contents))
    .filter((label): label is string => Boolean(label && /^\d{3,5}-\d{2,}$/.test(label)));
  const unique = [...new Set(labels)];
  const referenceBlock = unique.length > 0 ? `Camera references:\n${unique.join('\n')}` : '';
  return [body, referenceBlock].filter(Boolean).join('\n\n');
}

export function parseDrawingFacts(text: string): DrawingFacts {
  const siteLines = addressLines(text);
  const siteName = siteLines[0] && !/\d/.test(siteLines[0]) ? siteLines[0] : null;
  const addressLinesOnly = siteName ? siteLines.slice(1) : siteLines;
  const statedMatch = text.match(/number of cameras:\s*(\d+)/i);
  const references = [...text.matchAll(/\b(\d{3,5}-\d{2,})\b/g)].map(match => match[1]);
  const ups = text.split(/UPS provision/i)[1] ?? '';
  const upsCameras = ups.match(/Cameras:\s*(Yes|No)/i)?.[1] ?? null;
  const upsSwitches = ups.match(/Switches:\s*(Yes|No)/i)?.[1] ?? null;
  const upsRecorders = ups.match(/Recording devices:\s*(Yes|No)/i)?.[1] ?? null;
  const fields: Record<string, string> = {};
  const assign = (key: string, value: string | null) => {
    if (value) fields[key] = value;
  };
  assign('coverage', field(text, /Coverage:\s*([^|\n]+)/i));
  assign('cable', field(text, /Cable speci[^:\n]*:\s*([^|\n]+)/i));
  assign('cameraManufacturer', field(text, /Camera manufacturer:\s*([^|\n]+)/i));
  assign('cameraTypes', field(text, /Camera types:\s*([^|\n]+)/i));
  assign('ipCctv', field(text, /IP CCTV:\s*([^|\n]+)/i));
  assign('videoSoftware', field(text, /Video management software:\s*([^|\n]+)/i));
  assign('powerMethod', field(text, /Power method[^:\n]*:\s*([^|\n]+)/i));
  assign('powerSource', field(text, /Power source locations:\s*([^|\n]+)/i));
  assign('recorderLocation', field(text, /PoE\/NVR\/DVR location:\s*([^|\n]+)/i));
  assign('storage', field(text, /Storage capacity:\s*([^|\n]+)/i));
  assign('retention', field(text, /Retention policy:\s*([^|\n]+)/i));
  assign('clientSwitch', field(text, /Client provided switch:\s*([^|\n]+)/i));
  assign('recorderManufacturer', field(text, /DVR\/NVR Manufacturer:\s*([^|\n]+)/i));
  assign('drawingDate', field(text, /Drawing Date:\s*([^|\n]+)/i));
  assign('scale', field(text, /Scale:\s*([^|\n]+)/i));
  assign('drawnBy', field(text, /Drawn By:\s*([^|\n]+)/i));
  assign('checkedBy', field(text, /Checked By:\s*([^|\n]+)/i));
  if (upsCameras || upsSwitches || upsRecorders) {
    fields.ups = `Cameras: ${upsCameras ?? 'not stated'}; switches: ${upsSwitches ?? 'not stated'}; recording devices: ${upsRecorders ?? 'not stated'}`;
  }
  const blankCandidates: [string, string | null][] = [
    ['resolution', field(text, /Resolution:\s*([^|\n]*)/i)],
    ['frame rate', field(text, /Frame rate:\s*([^|\n]*)/i)],
    ['PoE switch size', field(text, /PoE switch size:\s*([^|\n]*)/i)],
    ['camera model', null],
  ];
  const blankFields = blankCandidates.filter((entry): entry is [string, null] => !entry[1]).map(([label]) => label);
  const documentStatus = /CCTV DESIGN PROPOSAL/i.test(text) ? 'CCTV DESIGN PROPOSAL' : null;
  return {
    siteName,
    siteAddress: addressLinesOnly.length > 0 ? addressLinesOnly.join(', ') : null,
    drawingAuthor: /Briggs Fire\s*&\s*Security Ltd/i.test(text) ? 'Briggs Fire & Security Ltd' : null,
    documentStatus,
    proposedDesign: Boolean(documentStatus) || /proposal|design/i.test(text),
    statedCameraTotal: statedMatch ? Number(statedMatch[1]) : null,
    cameraReferences: [...new Set(references)],
    fields,
    blankFields,
  };
}

function cameraLike(device: AiExtractedDevice): boolean {
  const label = `${device.device_type ?? ''} ${device.model_name ?? ''}`;
  return /camera|bullet|dome/i.test(label);
}

function statedSentence(total: number): string {
  return `${total} cameras stated; bullet/dome quantities require review.`;
}

function addDevice(
  devices: AiExtractedDevice[],
  device: AiExtractedDevice,
): void {
  if (!device.quantity || device.quantity < 1) return;
  devices.push(device);
}

function technicalNotes(facts: DrawingFacts, summary: AiQuantitySummary): string {
  const lines = [
    facts.documentStatus ? `Document status: ${facts.documentStatus}. This is proposed design information, not installed, commissioned or as-fitted equipment.` : null,
    facts.drawingAuthor ? `Drawing prepared by ${facts.drawingAuthor}. That is the drawing author, not the customer and not the importing company.` : null,
    facts.siteName ? `Site: ${facts.siteName}.` : null,
    facts.siteAddress ? `Address: ${facts.siteAddress}.` : null,
    facts.fields.drawingDate ? `Drawing date: ${facts.fields.drawingDate}.` : null,
    facts.fields.scale ? `Scale: ${facts.fields.scale}.` : null,
    facts.fields.drawnBy ? `Drawn by: ${facts.fields.drawnBy}.` : null,
    facts.fields.checkedBy ? `Checked by: ${facts.fields.checkedBy}.` : null,
    facts.fields.coverage ? `Coverage: ${facts.fields.coverage}.` : null,
    facts.fields.cable ? `Cable specification: ${facts.fields.cable}.` : null,
    facts.fields.cameraManufacturer ? `Camera manufacturer: ${facts.fields.cameraManufacturer}.` : null,
    facts.fields.cameraTypes ? `Camera types named on the title block: ${facts.fields.cameraTypes}.` : null,
    facts.fields.ipCctv ? `IP CCTV: ${facts.fields.ipCctv}.` : null,
    facts.fields.videoSoftware ? `Video management software: ${facts.fields.videoSoftware}.` : null,
    facts.fields.powerMethod ? `Power method: ${facts.fields.powerMethod}.` : null,
    facts.fields.powerSource ? `Power source: ${facts.fields.powerSource}.` : null,
    facts.fields.recorderLocation ? `PoE/NVR/DVR location: ${facts.fields.recorderLocation}.` : null,
    facts.fields.ups ? `UPS provision: ${facts.fields.ups}.` : null,
    facts.fields.storage ? `Storage: ${facts.fields.storage}.` : null,
    facts.fields.retention ? `Retention: ${facts.fields.retention}.` : null,
    facts.fields.clientSwitch ? `Client-provided switch: ${facts.fields.clientSwitch}.` : null,
    facts.fields.recorderManufacturer ? `DVR/NVR manufacturer: ${facts.fields.recorderManufacturer}.` : null,
    summary.statedTotal != null ? `Stated camera total: ${summary.statedTotal}.` : null,
    summary.countedTotal != null ? `Counted drawing total: ${summary.countedTotal}.` : null,
    summary.classified.length > 0 ? `Classified quantities: ${summary.classified.map(item => `${item.label} ${item.quantity}`).join(', ')}.` : null,
    summary.difference,
    summary.unresolved,
    facts.cameraReferences.length > 0
      ? `Camera references on the drawing: ${facts.cameraReferences.length} (${[...facts.cameraReferences].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0]} to ${[...facts.cameraReferences].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[facts.cameraReferences.length - 1]}). These label the symbols and are not an extra quantity.`
      : null,
    facts.blankFields.length > 0 ? `Not stated, left blank for review: ${facts.blankFields.join(', ')}.` : null,
  ];
  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

function sectionsFromFacts(facts: DrawingFacts, fileName: string): AiExtractedSection[] {
  const installation = [
    facts.fields.coverage ? `Coverage: ${facts.fields.coverage}.` : null,
    facts.fields.cable ? `Cable specification: ${facts.fields.cable}.` : null,
    facts.fields.powerMethod ? `Power method: ${facts.fields.powerMethod}.` : null,
    facts.fields.powerSource ? `Power source: ${facts.fields.powerSource}.` : null,
    facts.fields.recorderLocation ? `PoE/NVR/DVR location: ${facts.fields.recorderLocation}.` : null,
    facts.fields.clientSwitch ? `Client-provided switch: ${facts.fields.clientSwitch}.` : null,
    facts.fields.ups ? `UPS provision: ${facts.fields.ups}.` : null,
    'Taken from a design proposal. Not marked as installed.',
  ].filter(Boolean).join(' ');
  const operating = [
    facts.fields.ipCctv ? `IP CCTV: ${facts.fields.ipCctv}.` : null,
    facts.fields.videoSoftware ? `Video management software: ${facts.fields.videoSoftware}.` : null,
    facts.fields.storage ? `Storage: ${facts.fields.storage}.` : null,
    facts.fields.retention ? `Retention: ${facts.fields.retention}.` : null,
  ].filter(Boolean).join(' ');
  const sections: AiExtractedSection[] = [];
  if (installation.trim()) sections.push({ kind: 'installation', text: installation, source_file: fileName, source_page: 1 });
  if (operating.trim()) sections.push({ kind: 'operating', text: operating, source_file: fileName, source_page: 1 });
  sections.push({
    kind: 'missing',
    text: `Not on this drawing: ${facts.blankFields.join(', ') || 'camera model numbers'}, test results, and signatures.`,
    source_file: fileName,
    source_page: 1,
  });
  return sections;
}

function isDrawingCompany(value: string | null | undefined, author: string | null): boolean {
  if (!value || !author) return false;
  return value.toLowerCase().includes(author.toLowerCase()) || /briggs/i.test(value);
}

export function resolveDrawingExtraction(input: {
  fileName: string;
  text: string;
  symbols: CameraSymbolCount | null;
  model: AiExtractPayload | null;
}): AiExtractPayload {
  const facts = parseDrawingFacts(input.text);
  const model = input.model ?? {};
  const symbols = input.symbols;
  const counted = symbols?.countedTotal ?? 0;
  const classified = counted > 0 && symbols
    ? [
        { label: 'internal dome', quantity: symbols.internalDome },
        { label: 'external bullet', quantity: symbols.externalBullet },
        { label: 'external dome', quantity: symbols.externalDome },
      ].filter(item => item.quantity > 0)
    : [];
  const splitEstablished = classified.length > 0;
  const stated = facts.statedCameraTotal;
  let difference: string | null = null;
  let unresolved: string | null = null;
  if (splitEstablished && stated != null && stated !== counted) {
    const matchedClass = classified.find(item => item.quantity === stated);
    difference = matchedClass
      ? `The title block states ${stated} cameras, which matches the ${stated} ${matchedClass.label} symbols. The counted total is ${counted}. The stated ${stated} is not added again on top of the classified devices.`
      : `The title block states ${stated} cameras. The counted symbol total is ${counted}. Those figures were not added together.`;
  } else if (splitEstablished && stated != null && stated === counted) {
    difference = `The title-block total and the counted symbol total both say ${stated}.`;
  } else if (!splitEstablished && stated != null) {
    unresolved = statedSentence(stated);
  }

  const summary: AiQuantitySummary = {
    statedTotal: stated,
    countedTotal: splitEstablished ? counted : null,
    classified,
    difference,
    unresolved,
    legendExcluded: symbols?.legendExcluded ?? 0,
  };

  const evidenceClass = facts.proposedDesign ? 'proposed' : 'unknown';
  const manufacturer = facts.fields.cameraManufacturer ?? null;
  const devices: AiExtractedDevice[] = [];
  if (splitEstablished && symbols) {
    const source = `Page 1. Legend symbols excluded (${symbols.legendExcluded}). Coverage marks were not counted.`;
    addDevice(devices, {
      system_type: 'CCTV',
      device_type: 'Fixed dome camera',
      model_name: 'Fixed dome camera (internal)',
      manufacturer,
      model_number: null,
      quantity: symbols.internalDome,
      quantity_basis: 'counted',
      evidence_class: evidenceClass,
      view_kind: 'detail',
      source_file: input.fileName,
      source_page: 1,
      evidence_text: `${symbols.internalDome} red dome symbols on the plan. ${source}`,
      notes: 'Proposed on the design drawing. Model number is not stated.',
      confidence: 0.8,
    });
    addDevice(devices, {
      system_type: 'CCTV',
      device_type: 'Bullet camera',
      model_name: 'Bullet camera (external)',
      manufacturer,
      model_number: null,
      quantity: symbols.externalBullet,
      quantity_basis: 'counted',
      evidence_class: evidenceClass,
      view_kind: 'detail',
      source_file: input.fileName,
      source_page: 1,
      evidence_text: `${symbols.externalBullet} blue bullet symbols on the plan. ${source}`,
      notes: 'Proposed on the design drawing. Model number is not stated.',
      confidence: 0.74,
    });
    addDevice(devices, {
      system_type: 'CCTV',
      device_type: 'Dome camera',
      model_name: 'Dome camera (external)',
      manufacturer,
      model_number: null,
      quantity: symbols.externalDome,
      quantity_basis: 'counted',
      evidence_class: evidenceClass,
      view_kind: 'detail',
      source_file: input.fileName,
      source_page: 1,
      evidence_text: `${symbols.externalDome} blue dome symbols on the plan. ${source}`,
      notes: 'Proposed on the design drawing. Model number is not stated.',
      confidence: 0.74,
    });
  } else if (stated != null) {
    devices.push({
      system_type: 'CCTV',
      device_type: 'Camera',
      model_name: 'Cameras',
      manufacturer,
      model_number: null,
      quantity: stated,
      quantity_basis: 'stated',
      evidence_class: evidenceClass,
      view_kind: 'schedule',
      source_file: input.fileName,
      source_page: 1,
      evidence_text: `number of cameras: ${stated}`,
      notes: statedSentence(stated),
      confidence: 0.7,
    });
  }

  for (const device of model.devices ?? []) {
    if (cameraLike(device) && (splitEstablished || stated != null)) continue;
    const quantity = Number(device.quantity);
    const known = Number.isFinite(quantity) && quantity > 0;
    devices.push({
      ...device,
      quantity: known ? Math.round(quantity) : null,
      model_number: device.model_number ?? null,
      evidence_class: facts.proposedDesign && device.evidence_class === 'installed' ? 'proposed' : device.evidence_class,
      notes: known ? device.notes : [device.notes, 'Quantity was not stated and was not defaulted to 1.'].filter(Boolean).join(' '),
    });
  }

  const drawingLike = stated != null || counted > 0 || facts.proposedDesign || Boolean(facts.siteName);
  if (!drawingLike) {
    return { ...model, devices };
  }

  const clientName = isDrawingCompany(model.client_name, facts.drawingAuthor) ? null : clean(model.client_name);
  const projectName = facts.siteName
    ? `${facts.siteName} CCTV design proposal`
    : (isDrawingCompany(model.project_name, facts.drawingAuthor) ? null : clean(model.project_name));
  const notes = technicalNotes(facts, summary);
  const scope = [
    facts.documentStatus ? `${facts.documentStatus}.` : null,
    facts.siteName ? `Site: ${facts.siteName}.` : null,
    facts.fields.coverage ? `Coverage: ${facts.fields.coverage}.` : null,
    facts.fields.cameraTypes ? `Camera types named: ${facts.fields.cameraTypes}.` : null,
    'Equipment shown here is proposed and still needs verification. It is not as-fitted.',
  ].filter(Boolean).join(' ');

  return {
    ...model,
    project_name: projectName,
    client_name: clientName,
    site_name: facts.siteName ?? clean(model.site_name),
    site_address: facts.siteAddress ?? clean(model.site_address),
    project_notes: notes,
    scope_of_works: scope,
    system_types: ['CCTV'],
    devices,
    sections: sectionsFromFacts(facts, input.fileName),
    missing: [
      ...facts.blankFields.map(item => `${item} is not stated`),
      'Test results are not on this drawing',
      'Signatures are not on this drawing',
    ],
    warnings: [
      ...(facts.drawingAuthor ? [`${facts.drawingAuthor} is the drawing author and was not used as the customer or the importing company.`] : []),
    ],
    drawing_references: [input.fileName],
    quantity_summary: summary,
  };
}

export function sumSymbolCounts(counts: CameraSymbolCount[]): CameraSymbolCount {
  return counts.reduce((total, count) => ({
    internalDome: total.internalDome + count.internalDome,
    externalDome: total.externalDome + count.externalDome,
    externalBullet: total.externalBullet + count.externalBullet,
    legendExcluded: total.legendExcluded + count.legendExcluded,
    countedTotal: total.countedTotal + count.countedTotal,
  }), { internalDome: 0, externalDome: 0, externalBullet: 0, legendExcluded: 0, countedTotal: 0 });
}
