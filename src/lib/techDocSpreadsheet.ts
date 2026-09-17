import * as XLSX from 'xlsx';
import Papa from 'papaparse';

export type SpreadsheetTable = { headers: string[]; rows: Record<string, string>[] };

const HEADER_HINTS = /name|model|serial|mac|ip address|\bip\b|camera|firmware|location|device|channel|status|manufacturer|part|host|address|description|product type|unit type|\bunit\b|\bid\b|qty|quantity|role/i;

export function filledCount(row: string[]): number {
  return row.filter(cell => cell.trim()).length;
}

function looksLikeIpOrMac(text: string): boolean {
  const value = text.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value)) return true;
  if (/^([0-9a-f]{2}[:\-]){5}[0-9a-f]{2}$/i.test(value)) return true;
  return false;
}

function looksLikeDataValue(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (looksLikeIpOrMac(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(value)) return true;
  if (/^\d+([.,]\d+)?$/.test(value)) return true;
  return false;
}

function looksLikeHeaderRow(row: string[]): boolean {
  const filled = row.map(cell => cell.trim()).filter(Boolean);
  if (filled.length < 2) return false;
  const dataLike = filled.filter(looksLikeDataValue).length;
  if (dataLike >= Math.ceil(filled.length / 2)) return false;
  const long = filled.filter(cell => cell.length > 60).length;
  return long < filled.length / 2;
}

function uniquifyHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}

function headerHintCount(row: string[]): number {
  return row.filter(cell => HEADER_HINTS.test(cell)).length;
}

export function isInventoryHeader(row: string[]): boolean {
  const joined = row.map(cell => cell.toLowerCase().replace(/\s+/g, ' ')).join(' | ');
  return (/\bunit\b/.test(joined) || /\bname\b/.test(joined))
    && (/\bmanufacturer\b/.test(joined) || /\bproduct type\b/.test(joined) || /\bip address\b/.test(joined) || /\bmodel\b/.test(joined));
}

function isReportMetaRow(row: string[]): boolean {
  const first = (row.find(cell => cell.trim()) ?? '').trim();
  return /^(report:|user:|date:|number of query|units:)/i.test(first);
}

function rowHasNetworkValue(row: string[]): boolean {
  return row.some(cell => looksLikeIpOrMac(cell));
}

function usedWidth(row: string[]): number {
  let width = row.length;
  while (width > 0 && !String(row[width - 1] ?? '').trim()) width--;
  return width;
}

function tableScore(table: SpreadsheetTable, headerLike: boolean, hint: number, inventory: boolean): number {
  if (table.headers.length < 2 || table.rows.length === 0) return -1;
  return table.rows.length * table.headers.length + hint * 50 + (headerLike ? 20 : 0) + (inventory ? 400 : 0);
}

function splitSingletonRow(row: string[]): string[] {
  const filled = row.map(cell => cell.trim()).filter(Boolean);
  if (filled.length !== 1) return row;
  const cell = filled[0];
  if (cell.includes('\t') && cell.split('\t').length >= 4) return cell.split('\t').map(part => part.trim());
  if (cell.includes(',') && /unit type|manufacturer|product type|ip address/i.test(cell) && cell.split(',').length >= 4) {
    return cell.split(',').map(part => part.trim());
  }
  if (cell.split('|').length >= 4) return cell.split('|').map(part => part.trim());
  return row;
}

function gridFromUnknown(raw: unknown[][]): string[][] {
  return raw.map(row => splitSingletonRow(
    (Array.isArray(row) ? row : [row]).map(cell => String(cell ?? '').replace(/\s+/g, ' ').trim()),
  ));
}

function tableFromHeader(grid: string[][], headerIdx: number): SpreadsheetTable {
  let width = 0;
  for (let i = headerIdx; i < grid.length; i++) width = Math.max(width, usedWidth(grid[i]));
  if (width < 2) return { headers: [], rows: [] };

  const headers = uniquifyHeaders(Array.from({ length: width }, (_, col) => grid[headerIdx][col] ?? ''));
  const headerJoined = headers.join(' | ').toLowerCase();
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = headers.map((_, col) => grid[i][col] ?? '');
    if (cells.every(cell => !cell.trim())) continue;
    const filled = cells.filter(cell => cell.trim());
    if (filled.length === 1 && filled[0].length > 80) continue;
    if (isReportMetaRow(cells)) continue;
    if (isInventoryHeader(cells)) continue;
    const rowJoined = cells.join(' | ').toLowerCase();
    if (rowJoined === headerJoined) continue;
    const row: Record<string, string> = {};
    for (let col = 0; col < headers.length; col++) row[headers[col]] = cells[col];
    rows.push(row);
  }
  return { headers, rows };
}

/** Skip title/date rows and pick the table with the most real columns and rows. */
export function extractTableFromGrid(raw: unknown[][]): SpreadsheetTable {
  const grid = gridFromUnknown(raw);
  let best: SpreadsheetTable = { headers: [], rows: [] };
  let bestScore = -1;
  const searchLimit = Math.min(grid.length - 1, 120);
  for (let i = 0; i <= searchLimit; i++) {
    if (filledCount(grid[i]) < 2) continue;
    if (isReportMetaRow(grid[i])) continue;
    if (rowHasNetworkValue(grid[i])) continue;
    const inventory = isInventoryHeader(grid[i]);
    const headerLike = looksLikeHeaderRow(grid[i]) || inventory;
    const hint = headerHintCount(grid[i]);
    if (!headerLike && hint === 0 && !inventory) continue;
    const table = tableFromHeader(grid, i);
    const score = tableScore(table, headerLike, hint, inventory);
    if (score > bestScore) {
      bestScore = score;
      best = table;
    }
  }
  if (best.rows.length > 0) return dropEmptyLeadingColumns(best);
  const fallbackIdx = grid.findIndex(row => filledCount(row) >= 2 && !isReportMetaRow(row) && !rowHasNetworkValue(row));
  return fallbackIdx >= 0 ? dropEmptyLeadingColumns(tableFromHeader(grid, fallbackIdx)) : { headers: [], rows: [] };
}

function dropEmptyLeadingColumns(table: SpreadsheetTable): SpreadsheetTable {
  let start = 0;
  while (start < table.headers.length) {
    const key = table.headers[start];
    const headerEmpty = !key.trim() || /^Column \d+$/.test(key);
    const dataEmpty = table.rows.every(row => !(row[key] ?? '').trim());
    if (headerEmpty && dataEmpty) start += 1;
    else break;
  }
  if (start === 0) return table;
  const headers = table.headers.slice(start);
  const rows = table.rows.map(row => {
    const next: Record<string, string> = {};
    for (const header of headers) next[header] = row[header] ?? '';
    return next;
  });
  return { headers, rows };
}

function parseCsvText(text: string, delimiter?: string): unknown[][] {
  const result = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: false,
    delimiter: delimiter || undefined,
  });
  return (result.data ?? []).map(row => (Array.isArray(row) ? row : [row]).map(cell => String(cell ?? '')));
}

function decodeSpreadsheetText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const utf16le = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE;
  const utf16be = bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF;
  const looksUtf16 = bytes.length > 4 && bytes[1] === 0 && bytes[3] === 0;
  const text = new TextDecoder(utf16le || looksUtf16 ? 'utf-16le' : utf16be ? 'utf-16be' : 'utf-8').decode(buf);
  return text.replace(/^\uFEFF/, '');
}

function bestTable(tables: SpreadsheetTable[]): SpreadsheetTable {
  let best = tables[0] ?? { headers: [], rows: [] };
  let bestScore = tableScore(best, true, headerHintCount(best.headers), isInventoryHeader(best.headers));
  for (const table of tables.slice(1)) {
    const score = tableScore(table, true, headerHintCount(table.headers), isInventoryHeader(table.headers));
    if (score > bestScore) {
      best = table;
      bestScore = score;
    }
  }
  return best;
}

function sheetToGrid(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  }) as unknown[][];
}

function workbookToTables(wb: XLSX.WorkBook): SpreadsheetTable[] {
  return wb.SheetNames.map(sheetName => extractTableFromGrid(sheetToGrid(wb.Sheets[sheetName])));
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHtmlTables(html: string): SpreadsheetTable[] {
  const tables: SpreadsheetTable[] = [];
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const tableHtml of tableMatches) {
    const grid: string[][] = [];
    const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const rowHtml of rowMatches) {
      const cells: string[] = [];
      const cellRe = /<t[dh][\s\S]*?>[\s\S]*?<\/t[dh]>/gi;
      const found = rowHtml.match(cellRe) ?? [];
      for (const cellHtml of found) cells.push(stripHtml(cellHtml));
      if (cells.length > 0) grid.push(cells);
    }
    if (grid.length >= 2) tables.push(extractTableFromGrid(grid));
  }
  return tables;
}

function csvCandidates(text: string): SpreadsheetTable[] {
  return [
    extractTableFromGrid(parseCsvText(text)),
    extractTableFromGrid(parseCsvText(text, ',')),
    extractTableFromGrid(parseCsvText(text, ';')),
    extractTableFromGrid(parseCsvText(text, '\t')),
    extractTableFromGrid(parseCsvText(text, '|')),
  ];
}

export function parseSpreadsheetBytes(fileName: string, buf: ArrayBuffer): SpreadsheetTable {
  const name = fileName.toLowerCase();
  const bytes = new Uint8Array(buf);
  const looksCsv = name.endsWith('.csv') || name.endsWith('.txt');

  if (!looksCsv) {
    try {
      const wb = XLSX.read(bytes, { type: 'array', cellDates: true, raw: false });
      const fromSheets = bestTable(workbookToTables(wb));
      if (fromSheets.rows.length > 0) return fromSheets;
    } catch { /* fall through */ }
  }

  const text = decodeSpreadsheetText(buf);
  if (/<table[\s>]/i.test(text)) {
    const html = bestTable(parseHtmlTables(text));
    if (html.rows.length > 0) return html;
  }
  if (!looksCsv) {
    try {
      const wb = XLSX.read(text, { type: 'string', cellDates: true, raw: false });
      const fromString = bestTable(workbookToTables(wb));
      if (fromString.rows.length > 0) return fromString;
    } catch { /* fall through */ }
  }
  return bestTable(csvCandidates(text));
}

export async function parseSpreadsheetFile(file: File): Promise<SpreadsheetTable> {
  return parseSpreadsheetBytes(file.name, await file.arrayBuffer());
}
