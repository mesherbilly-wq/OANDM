export function extractJobRecords(raw: unknown): Record<string, unknown>[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const candidate = record.Results ?? record.results ?? record.data ?? record.items ?? record.jobs;
    if (Array.isArray(candidate)) list = candidate;
  }
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
}

/** Normalise search_jobs raw payload — list results or a single direct get_job hit. */
export function parseSearchJobResults(raw: unknown): Record<string, unknown>[] {
  const fromList = extractJobRecords(raw);
  if (fromList.length > 0) return fromList;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (pickJobId(record) || record.Name != null || record.JobNo != null) {
      return [record];
    }
  }
  return [];
}

export function jobMatchesSearchQuery(job: Record<string, unknown>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  for (const key of ['ID', 'id', 'JobNo', 'OrderNo', 'Name', 'Description'] as const) {
    const value = job[key];
    if (value == null) continue;
    const hay = String(value).trim().toLowerCase();
    if (hay === needle || hay.includes(needle)) return true;
  }
  return false;
}

export function pickJobId(job: Record<string, unknown>): string | null {
  const id = job.ID ?? job.Id ?? job.id;
  if (id == null || String(id).trim() === '') return null;
  return String(id);
}

export function pickNestedName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const name = record.Name ?? record.name ?? record.CompanyName;
    if (name != null && String(name).trim()) return String(name);
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

export function formatFieldValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const PROJECT_MANAGER_KEYS = ['ProjectManager', 'Project_Manager', 'project_manager'];

export interface JobDiscoveryColumn {
  key: string;
  label: string;
  isProjectManager?: boolean;
  pmField?: string | null;
}

function collectFieldNames(jobs: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const job of jobs) {
    for (const key of Object.keys(job)) keys.add(key);
  }
  return [...keys].sort();
}

function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

function htmlToPlainText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

export function buildJobDiscoveryColumns(jobs: Record<string, unknown>[]): JobDiscoveryColumn[] {
  const allSorted = collectFieldNames(jobs);
  const pmField = PROJECT_MANAGER_KEYS.find(key => jobs.some(job => key in job)) ?? null;
  const columns: JobDiscoveryColumn[] = [];
  let projectManagerAdded = false;

  for (const key of allSorted) {
    if (key === 'Total') {
      columns.push({
        key: pmField ?? '__project_manager__',
        label: 'Project Manager',
        isProjectManager: true,
        pmField,
      });
      projectManagerAdded = true;
      continue;
    }
    if (PROJECT_MANAGER_KEYS.includes(key)) continue;
    columns.push({ key, label: key });
  }

  if (!projectManagerAdded) {
    columns.push({
      key: pmField ?? '__project_manager__',
      label: 'Project Manager',
      isProjectManager: true,
      pmField,
    });
  }

  return columns;
}

export function formatDiscoveryCellValue(job: Record<string, unknown>, column: JobDiscoveryColumn): string {
  if (column.isProjectManager) {
    if (!column.pmField) return '-';
    return pickNestedName(job[column.pmField]) ?? '-';
  }
  if (column.key === 'Description') {
    const raw = job[column.key];
    if (raw == null) return '—';
    const text = String(raw);
    return looksLikeHtml(text) ? htmlToPlainText(text) || '—' : text;
  }
  return formatFieldValue(job[column.key]);
}

export function pickJobNumber(job: Record<string, unknown>): string | null {
  for (const key of ['JobNo', 'OrderNo', 'RequestNo', 'Reference', 'Name']) {
    const value = job[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

export interface SimproJobSearchRow {
  id: string;
  jobNumber: string | null;
  name: string | null;
  customer: string | null;
  site: string | null;
  raw: Record<string, unknown>;
}

export function toJobSearchRow(job: Record<string, unknown>): SimproJobSearchRow | null {
  const id = pickJobId(job);
  if (!id) return null;
  return {
    id,
    jobNumber: pickJobNumber(job),
    name: pickNestedName(job.Name) ?? pickNestedName(job.name),
    customer: pickNestedName(job.Customer),
    site: pickNestedName(job.Site),
    raw: job,
  };
}
