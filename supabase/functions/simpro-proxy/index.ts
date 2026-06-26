import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function simproErr(status: number, text: string) {
  return `Simpro API ${status}: ${text.substring(0, 400)}`;
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

async function readSimproJson(r: Response): Promise<{ ok: boolean; status: number; raw: unknown; error?: string }> {
  const status = r.status;
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    return { ok: false, status, raw: null, error: simproErr(status, text || `HTTP ${status}`) };
  }
  try {
    return { ok: true, status, raw: text ? JSON.parse(text) : null };
  } catch {
    return { ok: true, status, raw: text };
  }
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

    const params = new URLSearchParams({ pageSize: "1", columns: "ID,Reference,Name" });
    const url = buildApiUrl(config.baseUrl, config.companyId, "/jobs/", params);
    log("test_connection", url);

    const r = await simproFetch(url, config.apiToken).catch(() => null);
    if (!r) return json({ error: "Network error connecting to Simpro" });

    const parsed = await readSimproJson(r);
    if (!parsed.ok) return json({ error: parsed.error, status: parsed.status });

    let companyName: string | null = null;
    const companyUrl = buildApiUrl(config.baseUrl, config.companyId, "/");
    const companyR = await simproFetch(companyUrl, config.apiToken).catch(() => null);
    if (companyR?.ok) {
      const companyParsed = await readSimproJson(companyR);
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

  const config = storedConfig;
  const configError = assertSimproConfig(config);
  if (configError) return json({ error: configError });

  // ── search_jobs ───────────────────────────────────────────────────────────────
  // Read-only job search by job number. Returns raw Simpro list payload (quotes are out of scope).
  if (action === "search_jobs") {
    const query = String(body.query ?? body.job_number ?? "").trim();
    if (!query) return json({ error: "query or job_number required" });

    const params = new URLSearchParams({
      pageSize: "25",
      columns: "ID,Reference,Name,Status,DateIssued,Site,Customer",
    });
    params.set("Reference", query);

    const url = buildApiUrl(config.baseUrl, config.companyId, "/jobs/", params);
    log("search_jobs", `${url} (job_number="${query}")`);

    const r = await simproFetch(url, config.apiToken).catch(() => null);
    if (!r) return json({ error: "Network error connecting to Simpro", jobs: [] });

    const parsed = await readSimproJson(r);
    if (!parsed.ok) return json({ error: parsed.error, status: parsed.status, jobs: [] });

    return json({
      ok: true,
      job_number: query,
      raw: parsed.raw,
    });
  }

  // ── get_job ───────────────────────────────────────────────────────────────────
  // Read-only job detail with nested sections/cost centres when Simpro supports display=all.
  if (action === "get_job") {
    const jobId = body.job_id ?? body.jobId ?? body.id;
    if (jobId === undefined || jobId === null || String(jobId).trim() === "") {
      return json({ error: "job_id required" });
    }

    const params = new URLSearchParams({ display: "all" });
    const url = buildApiUrl(config.baseUrl, config.companyId, `/jobs/${jobId}`, params);
    log("get_job", url);

    const r = await simproFetch(url, config.apiToken).catch(() => null);
    if (!r) return json({ error: "Network error connecting to Simpro" });

    const parsed = await readSimproJson(r);
    if (!parsed.ok) return json({ error: parsed.error, status: parsed.status });

    return json({
      ok: true,
      job_id: jobId,
      raw: parsed.raw,
    });
  }

  return json({ error: `Unknown action: ${action}` });
});
