import { CCTV_NCP104_SCHEMA } from './cctvNcp104Completion';
import type {
  CompletionAnswers,
  CompletionField,
  CompletionGroup,
  CompletionPhoto,
  CompletionSection,
  CompletionShowWhen,
  CompletionTemplateSchema,
  CompletionTestResult,
} from './completionFormTypes';

export function newRowId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
}

export function testResultOf(value: unknown): CompletionTestResult {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const result = String(record.result ?? '');
    return {
      result: result === 'pass' || result === 'fail' || result === 'not_tested' || result === 'not_applicable' ? result : '',
      reason: String(record.reason ?? ''),
    };
  }
  return { result: '', reason: '' };
}

export function emptyFieldValue(field: CompletionField): unknown {
  if (field.type === 'multiselect' || field.type === 'photo') return [];
  if (field.type === 'test_result') return { result: '', reason: '' };
  if (field.type === 'declaration') return false;
  if (field.type === 'signature') return { name: '', company: '', role: '', accepted: false, dataUrl: '', signedAt: '', revisionNo: 0 };
  if (field.type === 'note') return '';
  return '';
}

export function emptyGroupRow(group: CompletionGroup): Record<string, unknown> {
  const row: Record<string, unknown> = { _rowId: newRowId() };
  for (const field of group.fields) {
    if (field.type === 'note') continue;
    row[field.id] = emptyFieldValue(field);
  }
  for (const nested of group.nested ?? []) {
    row[nested.id] = [];
  }
  return row;
}

export function emptyAnswers(schema: CompletionTemplateSchema): CompletionAnswers {
  const answers: CompletionAnswers = {};
  for (const section of schema.sections) {
    const record: Record<string, unknown> = {};
    for (const field of section.fields ?? []) {
      if (field.type === 'note') continue;
      record[field.id] = emptyFieldValue(field);
    }
    for (const group of section.groups ?? []) {
      record[group.id] = [];
    }
    answers[section.id] = record;
  }
  return answers;
}

export function sectionRecord(answers: CompletionAnswers, sectionId: string): Record<string, unknown> {
  return asRecord(answers[sectionId]);
}

function readField(row: Record<string, unknown>, fieldId: string): unknown {
  const value = row[fieldId];
  if (value && typeof value === 'object' && !Array.isArray(value) && 'result' in value) {
    return (value as { result?: unknown }).result;
  }
  return value;
}

function matchShowWhen(rule: CompletionShowWhen, row: Record<string, unknown>, section: Record<string, unknown>): boolean {
  const source = rule.scope === 'section' ? section : row;
  const raw = readField(source, rule.field);
  const values = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
  if (rule.op === 'includes') return rule.values.some(value => values.includes(value));
  if (rule.op === 'in') return rule.values.includes(values[0]);
  if (rule.op === 'neq') return !rule.values.includes(values[0]);
  return rule.values.includes(values[0]);
}

export function isFieldVisible(
  field: CompletionField,
  row: Record<string, unknown>,
  section: Record<string, unknown>,
): boolean {
  if (!field.showWhen?.length) return true;
  return field.showWhen.every(rule => matchShowWhen(rule, row, section));
}

export function isGroupVisible(group: CompletionGroup, section: Record<string, unknown>, parentRow?: Record<string, unknown>): boolean {
  const rules = [
    ...(group.showWhen ?? []),
    ...(group.fields.find(field => field.showWhen?.some(rule => rule.scope === 'section'))?.showWhen ?? []),
  ];
  if (rules.length === 0) return true;
  return rules.every(rule => matchShowWhen(rule, parentRow ?? section, section));
}

export function equipmentTitle(group: CompletionGroup, row: Record<string, unknown>, index: number): string {
  const filled = group.nameTemplate.replace(/\{(\w+)\}/g, (_, key: string) => String(row[key] ?? '').trim());
  const cleaned = filled.replace(/\s+—\s+$/, '').replace(/^\s+—\s+/, '').trim();
  if (cleaned && !cleaned.endsWith('—') && cleaned !== group.title) return cleaned;
  return `${group.title} ${String(index + 1).padStart(2, '0')}`;
}

export function duplicateEquipmentRow(group: CompletionGroup, row: Record<string, unknown>): Record<string, unknown> {
  const next = emptyGroupRow(group);
  for (const field of group.fields) {
    if (field.type === 'test_result' || field.type === 'photo' || field.type === 'signature' || field.type === 'declaration') continue;
    if (group.identityFields.includes(field.id) || field.type === 'select' || field.type === 'multiselect' || field.type === 'text' || field.type === 'number') {
      next[field.id] = structuredCloneSafe(row[field.id]);
    }
  }
  if (typeof next.camera_number === 'string' && next.camera_number.trim()) {
    const match = next.camera_number.match(/(\d+)\s*$/);
    if (match) {
      next.camera_number = next.camera_number.replace(/\d+\s*$/, String(Number(match[1]) + 1).padStart(match[1].length, '0'));
    }
  }
  if ('ip_address' in next) next.ip_address = '';
  for (const nested of group.nested ?? []) {
    next[nested.id] = asRows(row[nested.id]).map(child => {
      const copied = duplicateEquipmentRow(nested, child);
      return copied;
    });
  }
  return next;
}

function structuredCloneSafe(value: unknown): unknown {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function fieldHasValue(field: CompletionField, value: unknown, photos: CompletionPhoto[], fieldPath: string): boolean {
  if (field.type === 'note') return true;
  if (field.type === 'declaration') return value === true;
  if (field.type === 'photo') {
    return photos.some(photo => photo.fieldPath === fieldPath && photo.status === 'ready');
  }
  if (field.type === 'test_result') return Boolean(testResultOf(value).result);
  if (field.type === 'signature') return Boolean(asRecord(value).dataUrl);
  if (Array.isArray(value)) return value.length > 0;
  return String(value ?? '').trim() !== '';
}

export function fieldNeedsReason(field: CompletionField, value: unknown): boolean {
  if (field.type !== 'test_result') return false;
  const result = testResultOf(value);
  return Boolean(result.result && field.reasonWhen?.includes(result.result) && !result.reason.trim());
}

export interface FieldIssue {
  path: string;
  sectionId: string;
  label: string;
  message: string;
}

export function validateAnswers(
  schema: CompletionTemplateSchema,
  answers: CompletionAnswers,
  photos: CompletionPhoto[],
  mode: 'engineer' | 'customer' = 'engineer',
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const section of schema.sections) {
    if (mode === 'customer' && !section.customerVisible) continue;
    const record = sectionRecord(answers, section.id);
    for (const field of section.fields ?? []) {
      if (mode === 'customer' && field.customerVisible === false) continue;
      if (!isFieldVisible(field, record, record)) continue;
      const path = `${section.id}.${field.id}`;
      if (field.required && !fieldHasValue(field, record[field.id], photos, path)) {
        issues.push({ path, sectionId: section.id, label: field.label, message: 'This is required.' });
      }
      if (fieldNeedsReason(field, record[field.id])) {
        issues.push({ path, sectionId: section.id, label: field.label, message: 'Give a reason for Fail, Not tested or Not applicable.' });
      }
    }
    for (const group of section.groups ?? []) {
      if (!isGroupVisible(group, record)) continue;
      const rows = asRows(record[group.id]);
      rows.forEach((row, index) => {
        for (const field of group.fields) {
          if (!isFieldVisible(field, row, record)) continue;
          const path = `${section.id}.${group.id}.${index}.${field.id}`;
          if (field.required && !fieldHasValue(field, row[field.id], photos, path)) {
            issues.push({ path, sectionId: section.id, label: `${equipmentTitle(group, row, index)}: ${field.label}`, message: 'This is required.' });
          }
          if (fieldNeedsReason(field, row[field.id])) {
            issues.push({ path, sectionId: section.id, label: `${equipmentTitle(group, row, index)}: ${field.label}`, message: 'Give a reason for Fail, Not tested or Not applicable.' });
          }
        }
        for (const nested of group.nested ?? []) {
          if (!isGroupVisible(nested, record, row)) continue;
          asRows(row[nested.id]).forEach((child, nestedIndex) => {
            for (const field of nested.fields) {
              if (!isFieldVisible(field, child, row)) continue;
              const path = `${section.id}.${group.id}.${index}.${nested.id}.${nestedIndex}.${field.id}`;
              if (field.required && !fieldHasValue(field, child[field.id], photos, path)) {
                issues.push({ path, sectionId: section.id, label: `${field.label}`, message: 'This is required.' });
              }
            }
          });
        }
      });
    }
  }
  return issues;
}

export function sectionProgress(
  schema: CompletionTemplateSchema,
  answers: CompletionAnswers,
  photos: CompletionPhoto[],
  section: CompletionSection,
): { required: number; complete: number } {
  const issues = validateAnswers({ ...schema, sections: [section] }, answers, photos, 'engineer');
  const required = countRequired(section, sectionRecord(answers, section.id), photos, section.id);
  return { required, complete: Math.max(0, required - issues.length) };
}

function countRequired(section: CompletionSection, record: Record<string, unknown>, photos: CompletionPhoto[], sectionId: string): number {
  let count = 0;
  for (const field of section.fields ?? []) {
    if (field.type === 'note' || !isFieldVisible(field, record, record)) continue;
    if (field.required) count += 1;
  }
  for (const group of section.groups ?? []) {
    if (!isGroupVisible(group, record)) continue;
    for (const [index, row] of asRows(record[group.id]).entries()) {
      for (const field of group.fields) {
        if (field.type === 'note' || !isFieldVisible(field, row, record)) continue;
        if (field.required) count += 1;
      }
      void photos;
      void sectionId;
      void index;
    }
  }
  return count;
}

export function overallProgress(schema: CompletionTemplateSchema, answers: CompletionAnswers, photos: CompletionPhoto[]): { required: number; complete: number; percent: number } {
  let required = 0;
  let complete = 0;
  for (const section of schema.sections) {
    const progress = sectionProgress(schema, answers, photos, section);
    required += progress.required;
    complete += progress.complete;
  }
  return { required, complete, percent: required === 0 ? 0 : Math.round((complete / required) * 100) };
}

export function openDefects(answers: CompletionAnswers): Array<Record<string, unknown>> {
  return asRows(sectionRecord(answers, 'defects').defects).filter(row => {
    const status = String(row.status ?? '');
    return status && status !== 'Resolved' && status !== 'Accepted at handover';
  });
}

export function unansweredOrFailedChecks(answers: CompletionAnswers): string[] {
  const inspection = sectionRecord(answers, 'inspection');
  const schema = CCTV_NCP104_SCHEMA.sections.find(section => section.id === 'inspection');
  const labels: string[] = [];
  for (const field of schema?.fields ?? []) {
    if (field.type !== 'test_result' || !isFieldVisible(field, inspection, inspection)) continue;
    const result = testResultOf(inspection[field.id]);
    if (!result.result || result.result === 'fail' || result.result === 'not_tested') labels.push(field.label);
  }
  return labels;
}

export function systemLooksComplete(answers: CompletionAnswers, photos: CompletionPhoto[], authorisedOutstanding: boolean): boolean {
  const issues = validateAnswers(CCTV_NCP104_SCHEMA, answers, photos, 'engineer');
  if (issues.length > 0) return false;
  if (openDefects(answers).length > 0 && !authorisedOutstanding) return false;
  if (unansweredOrFailedChecks(answers).length > 0 && !authorisedOutstanding) return false;
  return true;
}

export function stripSensitiveAnswers(schema: CompletionTemplateSchema, answers: CompletionAnswers): CompletionAnswers {
  const next = structuredCloneSafe(answers) as CompletionAnswers;
  for (const section of schema.sections) {
    const record = asRecord(next[section.id]);
    for (const field of section.fields ?? []) {
      if (field.sensitive) record[field.id] = fieldHasValue(field, record[field.id], [], `${section.id}.${field.id}`) ? 'Recorded separately' : '';
    }
    for (const group of section.groups ?? []) {
      record[group.id] = asRows(record[group.id]).map(row => {
        const copy = { ...row };
        for (const field of group.fields) {
          if (field.sensitive) copy[field.id] = fieldHasValue(field, copy[field.id], [], field.id) ? 'Recorded separately' : '';
        }
        return copy;
      });
    }
    next[section.id] = record;
  }
  return next;
}

export function customerAnswers(schema: CompletionTemplateSchema, answers: CompletionAnswers): CompletionAnswers {
  const cleaned = stripSensitiveAnswers(schema, answers);
  const next: CompletionAnswers = {};
  for (const section of schema.sections) {
    if (!section.customerVisible) continue;
    next[section.id] = cleaned[section.id];
  }
  return next;
}

export function inactiveAnswersKept(schema: CompletionTemplateSchema, answers: CompletionAnswers): boolean {
  void schema;
  void answers;
  return true;
}

export function mergePrefill(schema: CompletionTemplateSchema, answers: CompletionAnswers, prefill: Record<string, string>): CompletionAnswers {
  const next = structuredCloneSafe(answers) as CompletionAnswers;
  const job = asRecord(next.job);
  for (const [key, value] of Object.entries(prefill)) {
    if (!value) continue;
    if (!String(job[key] ?? '').trim()) job[key] = value;
  }
  next.job = job;
  void schema;
  return next;
}

export function publishedSchema(): CompletionTemplateSchema {
  return structuredCloneSafe(CCTV_NCP104_SCHEMA) as CompletionTemplateSchema;
}
