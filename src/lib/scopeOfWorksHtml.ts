import {
  decodeEscapedHtml,
  looksLikeHtml,
  sanitizeSimproHtml,
} from '../integrations/connectors/simpro/simproImportHelpers';

const SCHEDULE_HEADING =
  /\b(device schedule|equipment schedule|materials? schedule|installation schedule|schedule of (?:works )?equipment|bill of (?:materials|quantities)|priced (?:bill|schedule)|schedule of rates|parts list|material list)\b/i;

const COMMERCIAL_HEADING =
  /\b(preliminar(?:y|ies)|prelims|sundries|contingency|cost summary|price summary|quotation summary|commercial summary|tender summary|vat analysis|grand totals?|sub[-\s]?totals?|net totals?|quotation totals?|overheads?(?:\s+and\s+profit)?)\b/i;

const SCHEDULE_OR_PRICE_HEADER =
  /^(qty|qty\.|quantity|part(\s*(no\.?|number|#))?|sku|cat(\.|alogue|alog)?(\s*(no\.?|number))?|model|manufacturer|unit|hours?|hr|rate|price|cost|total|amount|value|sell|net|vat|ex\s*vat|inc\s*vat|line total|unit price|sell price|cost price)$/i;

const CURRENCY = /(?:£|&pound;|\$|€|gbp)\s*[\d,]+(?:\.\d{2})?/gi;
const CURRENCY_OR_MONEY = /(?:£|\$|€)\s*[\d,]+(?:\.\d{2})?|^\d[\d,]*\.\d{2}$/;

function collapseText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isHeadingElement(el: Element): boolean {
  if (/^H[1-6]$/i.test(el.tagName)) return true;
  if (!/^(P|DIV|STRONG|B|SPAN|FONT|CENTER)$/i.test(el.tagName)) return false;
  if (el.querySelector('table')) return false;
  const text = collapseText(el.textContent ?? '');
  if (!text || text.length > 80 || /[.!?]$/.test(text)) return false;
  const style = `${el.getAttribute('style') ?? ''} ${el.querySelector('strong,b,font')?.getAttribute('style') ?? ''}`;
  const bold =
    /font-weight:\s*(bold|[6-9]00)/i.test(style) ||
    Boolean(el.querySelector('strong,b')) ||
    el.tagName === 'STRONG' ||
    el.tagName === 'B';
  return bold;
}

function headingIsScheduleOrCommercial(text: string): boolean {
  return SCHEDULE_HEADING.test(text) || COMMERCIAL_HEADING.test(text);
}

function tableLooksLikeScheduleOrCosts(table: HTMLTableElement): boolean {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return false;

  const headers = Array.from(rows[0].cells).map(cell => collapseText(cell.textContent ?? '').toLowerCase());
  const matchedHeaders = headers.filter(header => SCHEDULE_OR_PRICE_HEADER.test(header) || /unit price|sell price|cost price|ex vat|inc vat|line total/.test(header));
  if (matchedHeaders.length >= 2) return true;

  const tableText = table.textContent ?? '';
  const currencyHits = tableText.match(CURRENCY)?.length ?? 0;
  if (currencyHits >= 3) return true;

  if (rows[0].cells.length >= 3) {
    for (let col = 0; col < rows[0].cells.length; col += 1) {
      let money = 0;
      let nonempty = 0;
      for (const row of rows.slice(1)) {
        const cell = row.cells[col];
        if (!cell) continue;
        const text = collapseText(cell.textContent ?? '');
        if (!text) continue;
        nonempty += 1;
        if (CURRENCY_OR_MONEY.test(text)) money += 1;
      }
      if (nonempty >= 3 && money / nonempty >= 0.6) return true;
    }
  }

  const headerText = headers.join(' ');
  return /\b(qty|quantity)\b/.test(headerText) && /\b(part|model|description|item|catalogue|catalog)\b/.test(headerText);
}

function isPriceOnlyBlock(text: string): boolean {
  const value = collapseText(text);
  if (!value || value.length > 140) return false;
  return (
    /^(sub[-\s]?total|total|grand total|net|vat|amount due|quotation total|less discount)[:\s]/i.test(value) &&
    CURRENCY_OR_MONEY.test(value)
  ) || /^(?:£|\$|€)\s*[\d,]+\.\d{2}$/.test(value);
}

function isEmptyBlock(el: Element): boolean {
  if (el.querySelector('img,table')) return false;
  return !collapseText(el.textContent ?? '');
}

function stripScopeCommercialContent(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let skipping = false;

    for (const el of Array.from(doc.body.children)) {
      const text = collapseText(el.textContent ?? '');
      const heading = isHeadingElement(el);

      if (heading) {
        skipping = headingIsScheduleOrCommercial(text);
        if (skipping) {
          el.remove();
          continue;
        }
      }

      if (skipping) {
        el.remove();
        continue;
      }

      if (el.tagName === 'TABLE' && tableLooksLikeScheduleOrCosts(el as HTMLTableElement)) {
        el.remove();
        continue;
      }

      el.querySelectorAll('table').forEach(table => {
        if (tableLooksLikeScheduleOrCosts(table)) table.remove();
      });

      if (isPriceOnlyBlock(text) || isEmptyBlock(el)) {
        el.remove();
      }
    }

    return doc.body.innerHTML.trim();
  } catch {
    return html;
  }
}

function stripPlainScopeCommercial(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let skipping = false;
  let inTable = false;
  let tableBuffer: string[] = [];

  const flushTable = () => {
    const blob = tableBuffer.join('\n');
    tableBuffer = [];
    inTable = false;
    if (/\b(qty|quantity|part|price|cost|total|vat|amount)\b/i.test(blob) && blob.split('\n').length >= 3) {
      return;
    }
    kept.push(blob);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      if (!inTable) inTable = true;
      tableBuffer.push(line);
      continue;
    }
    if (inTable) flushTable();

    if (headingIsScheduleOrCommercial(trimmed) && trimmed.length <= 80) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (trimmed && trimmed.length <= 80 && !/[.!?]$/.test(trimmed) && !headingIsScheduleOrCommercial(trimmed)) {
        skipping = false;
      } else {
        continue;
      }
    }
    if (isPriceOnlyBlock(trimmed)) continue;
    kept.push(line);
  }
  if (inTable) flushTable();

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Keep Simpro/Word layout, drop device-schedule tables and commercial cost blocks. */
export function prepareCustomerScopeHtml(raw: string | null | undefined): string {
  const decoded = decodeEscapedHtml((raw ?? '').trim());
  if (!decoded) return '';
  if (looksLikeHtml(decoded)) {
    return sanitizeSimproHtml(stripScopeCommercialContent(decoded));
  }
  return stripPlainScopeCommercial(decoded);
}
