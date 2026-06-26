import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/** Placeholder integration_settings keys (not wired to UI in this phase). */
const SETTING_BASE_URL = "simpro_base_url";
const SETTING_COMPANY_ID = "simpro_company_id";
const SETTING_API_TOKEN = "simpro_api_token";

/** Placeholder Edge Function secrets (set in Supabase dashboard when ready). */
const ENV_BASE_URL = "SIMPRO_BASE_URL";
const ENV_COMPANY_ID = "SIMPRO_COMPANY_ID";
const ENV_API_TOKEN = "SIMPRO_API_TOKEN";

interface SimproConfig {
  baseUrl: string;
  companyId: string;
  apiToken: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function log(action: string, detail: string) {
  console.log(`[Simpro-proxy][${action}] ${detail}`);
}

function parseSimproBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatSimproBodyForDisplay(body: unknown): string {
  if (body == null) return "(empty response body)";
  if (typeof body === "string") return body;
  return JSON.stringify(body, null, 2);
}

function redactSecrets(text: string, apiToken: string): string {
  let result = text;
  if (apiToken) {
    result = result.split(apiToken).join("[REDACTED]");
  }
  return result.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]");
}

function simproErrorResponse(status: number, endpoint: string, bodyText: string, apiToken: string) {
  const simpro_body = parseSimproBody(bodyText);
  const bodyDisplay = redactSecrets(formatSimproBodyForDisplay(simpro_body), apiToken);
  return {
    error: `Simpro returned HTTP ${status}\nEndpoint: ${endpoint}\nResponse:\n${bodyDisplay}`,
    status,
    endpoint,
    simpro_body,
  };
}

function logSimproFailure(
  action: string,
  status: number,
  endpoint: string,
  simpro_body: unknown,
  apiToken = "",
) {
  const bodyPreview = redactSecrets(formatSimproBodyForDisplay(simpro_body), apiToken).substring(0, 500);
  log(action, `HTTP ${status} ${endpoint} body=${bodyPreview}`);
}

function buildApiUrl(baseUrl: string, companyId: string, path: string, searchParams?: URLSearchParams): string {
  const base = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}/v1.0/companies/${companyId}${normalizedPath}`;
  if (!searchParams || [...searchParams.keys()].length === 0) return url;
  return `${url}?${searchParams.toString()}`;
}

async function loadSimproConfig(db: ReturnType<typeof createClient>): Promise<SimproConfig> {
  const { data: rows } = await db
    .from("integration_settings")
    .select("key, value")
    .in("key", [SETTING_BASE_URL, SETTING_COMPANY_ID, SETTING_API_TOKEN]);

  const settings: Record<string, string> = {};
  for (const row of rows ?? []) {
    if (row?.key && row?.value) settings[row.key] = String(row.value);
  }

  return {
    baseUrl: (settings[SETTING_BASE_URL] ?? Deno.env.get(ENV_BASE_URL) ?? "").trim(),
    companyId: (settings[SETTING_COMPANY_ID] ?? Deno.env.get(ENV_COMPANY_ID) ?? "0").trim(),
    apiToken: (settings[SETTING_API_TOKEN] ?? Deno.env.get(ENV_API_TOKEN) ?? "").trim(),
  };
}

function resolveConfigFromBody(body: Record<string, unknown>, stored: SimproConfig): SimproConfig {
  return {
    baseUrl: String(body.base_url ?? body.baseUrl ?? stored.baseUrl ?? "").trim(),
    companyId: String(body.company_id ?? body.companyId ?? stored.companyId ?? "0").trim(),
    apiToken: String(body.api_token ?? body.apiToken ?? stored.apiToken ?? "").trim(),
  };
}

function assertSimproConfig(config: SimproConfig): string | null {
  if (!config.baseUrl) return "Simpro base URL not configured";
  if (!config.apiToken) return "Simpro API token not configured";
  return null;
}

function pickCompanyName(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const name = record.Name ?? record.CompanyName ?? record.name ?? record.Company;
  return name ? String(name) : null;
}

function pickApiVersion(response: Response): string | null {
  return (
    response.headers.get("X-API-Version") ??
    response.headers.get("Api-Version") ??
    response.headers.get("X-Simpro-Api-Version") ??
    null
  );
}

async function simproFetch(url: string, apiToken: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

async function readSimproJson(
  r: Response,
  endpoint: string,
  apiToken: string,
): Promise<
  | { ok: true; status: number; raw: unknown }
  | { ok: false; status: number; endpoint: string; simpro_body: unknown; error: string }
> {
  const status = r.status;
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    return { ok: false, ...simproErrorResponse(status, endpoint, text, apiToken) };
  }
  try {
    return { ok: true, status, raw: text ? JSON.parse(text) : null };
  } catch {
    return { ok: true, status, raw: text };
  }
}

function extractJobList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of ["Results", "results", "data", "items", "jobs"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

function jobMatchesSearchQuery(job: unknown, query: string): boolean {
  if (!job || typeof job !== "object") return false;
  const record = job as Record<string, unknown>;
  const needle = query.trim().toLowerCase();
  if (!needle) return false;

  for (const key of ["ID", "id", "JobNo", "OrderNo", "Name", "Description"]) {
    const value = record[key];
    if (value == null) continue;
    const hay = String(value).trim().toLowerCase();
    if (hay === needle || hay.includes(needle)) return true;
  }
  return false;
}

function pickJobIdFromRecord(record: Record<string, unknown>): string | null {
  const id = record.ID ?? record.Id ?? record.id;
  if (id == null || String(id).trim() === "") return null;
  return String(id);
}

function isNumericJobQuery(query: string): boolean {
  return /^\d+$/.test(query.trim());
}

const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 20;

async function fetchJobById(
  config: SimproConfig,
  jobId: string,
  displayAll = false,
): Promise<
  | { ok: true; status: number; raw: unknown; url: string }
  | { ok: false; status: number; url: string; endpoint: string; simpro_body: unknown; error: string }
> {
  const params = displayAll ? new URLSearchParams({ display: "all" }) : undefined;
  const url = buildApiUrl(config.baseUrl, config.companyId, `/jobs/${jobId}`, params);
  const r = await simproFetch(url, config.apiToken).catch(() => null);
  if (!r) {
    return {
      ok: false,
      status: 0,
      url,
      endpoint: url,
      simpro_body: null,
      error: `Network error connecting to Simpro\nEndpoint: ${url}`,
    };
  }
  const parsed = await readSimproJson(r, url, config.apiToken);
  if (!parsed.ok) {
    return { ...parsed, url };
  }
  return { ok: true, status: parsed.status, raw: parsed.raw, url };
}

async function searchJobsPaged(
  config: SimproConfig,
  query: string,
): Promise<
  | { ok: true; matches: unknown[] }
  | { ok: false; status: number; endpoint: string; simpro_body: unknown; error: string }
> {
  const matches: unknown[] = [];
  const seenIds = new Set<string>();

  for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      pageSize: String(SEARCH_PAGE_SIZE),
      page: String(page),
    });
    const list = await fetchJobList(config, params);
    if (!list.ok) {
      if (page === 1) {
        return {
          ok: false,
          status: list.status,
          endpoint: list.endpoint,
          simpro_body: list.simpro_body,
          error: list.error,
        };
      }
      break;
    }

    const jobs = extractJobList(list.raw);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (!jobMatchesSearchQuery(job, query)) continue;
      if (!job || typeof job !== "object") continue;
      const id = pickJobIdFromRecord(job as Record<string, unknown>);
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      matches.push(job);
    }

    if (jobs.length < SEARCH_PAGE_SIZE) break;
  }

  return { ok: true, matches };
}

async function fetchJobList(
  config: SimproConfig,
  params: URLSearchParams,
): Promise<
  | { ok: true; status: number; raw: unknown; url: string }
  | { ok: false; status: number; url: string; endpoint: string; simpro_body: unknown; error: string }
> {
  const url = buildApiUrl(config.baseUrl, config.companyId, "/jobs/", params);
  const r = await simproFetch(url, config.apiToken).catch(() => null);
  if (!r) {
    return {
      ok: false,
      status: 0,
      url,
      endpoint: url,
      simpro_body: null,
      error: `Network error connecting to Simpro\nEndpoint: ${url}`,
    };
  }
  const parsed = await readSimproJson(r, url, config.apiToken);
  if (!parsed.ok) {
    return { ...parsed, url };
  }
  return { ok: true, status: parsed.status, raw: parsed.raw, url };
}

function simproFailureJson(parsed: {
  error: string;
  status: number;
  endpoint: string;
  simpro_body: unknown;
}) {
  return json({
    error: parsed.error,
    status: parsed.status,
    endpoint: parsed.endpoint,
    simpro_body: parsed.simpro_body,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" });
  }

  const action = String(body.action ?? "");
  log(action, "invoked");

  const storedConfig = await loadSimproConfig(db);

  // ── test_connection ───────────────────────────────────────────────────────────
  // Accepts optional base_url, company_id, api_token in body (wizard session — not persisted).
  if (action === "test_connection") {
    const config = resolveConfigFromBody(body, storedConfig);
    const configError = assertSimproConfig(config);
    if (configError) return json({ error: configError });

    const params = new URLSearchParams({ pageSize: "1" });
    const url = buildApiUrl(config.baseUrl, config.companyId, "/jobs/", params);
    log("test_connection", url);

    const r = await simproFetch(url, config.apiToken).catch(() => null);
    if (!r) {
      return json({
        error: `Network error connecting to Simpro\nEndpoint: ${url}`,
        status: 0,
        endpoint: url,
        simpro_body: null,
      });
    }

    const parsed = await readSimproJson(r, url, config.apiToken);
    if (!parsed.ok) {
      logSimproFailure("test_connection", parsed.status, parsed.endpoint, parsed.simpro_body, config.apiToken);
      return simproFailureJson(parsed);
    }

    let companyName: string | null = null;
    const companyUrl = buildApiUrl(config.baseUrl, config.companyId, "/");
    const companyR = await simproFetch(companyUrl, config.apiToken).catch(() => null);
    if (companyR?.ok) {
      const companyParsed = await readSimproJson(companyR, companyUrl, config.apiToken);
      if (companyParsed.ok) companyName = pickCompanyName(companyParsed.raw);
    }

    const apiVersion = pickApiVersion(r) ?? (companyR ? pickApiVersion(companyR) : null);

    return json({
      ok: true,
      status: "connected",
      company_name: companyName,
      api_version: apiVersion,
      raw: parsed.raw,
    });
  }

  // ── list_jobs ─────────────────────────────────────────────────────────────────
  // Discovery: first page of jobs, unfiltered raw Simpro payload.
  if (action === "list_jobs") {
    const config = resolveConfigFromBody(body, storedConfig);
    const configError = assertSimproConfig(config);
    if (configError) return json({ error: configError });

    const params = new URLSearchParams({ pageSize: "100", page: "1" });
    const list = await fetchJobList(config, params);
    log("list_jobs", list.url);

    if (!list.ok) {
      logSimproFailure("list_jobs", list.status, list.endpoint, list.simpro_body, config.apiToken);
      return simproFailureJson(list);
    }

    return json({
      ok: true,
      raw: list.raw,
    });
  }

  // ── search_jobs ───────────────────────────────────────────────────────────────
  // Read-only job search: direct get_job for numeric IDs, then paged list fallback.
  if (action === "search_jobs") {
    const config = resolveConfigFromBody(body, storedConfig);
    const configError = assertSimproConfig(config);
    if (configError) return json({ error: configError });

    const query = String(body.query ?? body.job_number ?? "").trim();
    if (!query) return json({ error: "query or job_number required" });

    if (isNumericJobQuery(query)) {
      const direct = await fetchJobById(config, query, false);
      log("search_jobs", `${direct.url} (direct job_id="${query}")`);
      if (direct.ok) {
        return json({
          ok: true,
          job_number: query,
          raw: [direct.raw],
        });
      }
      log("search_jobs", `direct get_job failed for "${query}", falling back to paged search`);
    }

    const paged = await searchJobsPaged(config, query);
    if (!paged.ok) {
      logSimproFailure("search_jobs", paged.status, paged.endpoint, paged.simpro_body, config.apiToken);
      return json({
        error: paged.error,
        status: paged.status,
        endpoint: paged.endpoint,
        simpro_body: paged.simpro_body,
        jobs: [],
      });
    }

    log("search_jobs", `paged search complete (job_number="${query}", matches=${paged.matches.length})`);
    return json({
      ok: true,
      job_number: query,
      raw: paged.matches,
    });
  }

  // ── get_job ───────────────────────────────────────────────────────────────────
  // Read-only job detail with nested sections/cost centres when Simpro supports display=all.
  if (action === "get_job") {
    const config = resolveConfigFromBody(body, storedConfig);
    const configError = assertSimproConfig(config);
    if (configError) return json({ error: configError });

    const jobId = body.job_id ?? body.jobId ?? body.id;
    if (jobId === undefined || jobId === null || String(jobId).trim() === "") {
      return json({ error: "job_id required" });
    }

    const params = new URLSearchParams({ display: "all" });
    const url = buildApiUrl(config.baseUrl, config.companyId, `/jobs/${jobId}`, params);
    log("get_job", url);

    const r = await simproFetch(url, config.apiToken).catch(() => null);
    if (!r) {
      return json({
        error: `Network error connecting to Simpro\nEndpoint: ${url}`,
        status: 0,
        endpoint: url,
        simpro_body: null,
      });
    }

    const parsed = await readSimproJson(r, url, config.apiToken);
    if (!parsed.ok) {
      logSimproFailure("get_job", parsed.status, parsed.endpoint, parsed.simpro_body, config.apiToken);
      return simproFailureJson(parsed);
    }

    return json({
      ok: true,
      job_id: jobId,
      raw: parsed.raw,
    });
  }

  return json({ error: `Unknown action: ${action}` });
});
