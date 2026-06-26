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

function assertSimproConfig(config: SimproConfig): string | null {
  if (!config.baseUrl) return "Simpro base URL not configured";
  if (!config.apiToken) return "Simpro API token not configured";
  return null;
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

  const config = await loadSimproConfig(db);
  const configError = assertSimproConfig(config);
  if (configError) return json({ error: configError });

  const authHeadersNote = "Credentials loaded server-side only — never returned to client";

  // ── test_connection ───────────────────────────────────────────────────────────
  // Lightweight read: list quotes with pageSize=1 to verify base URL, company, token.
  if (action === "test_connection") {
    const params = new URLSearchParams({ pageSize: "1", columns: "ID,Reference" });
    const url = buildApiUrl(config.baseUrl, config.companyId, "/quotes/", params);
    log("test_connection", url);

    const r = await simproFetch(url, config.apiToken).catch(() => null);
    if (!r) return json({ error: "Network error connecting to Simpro" });

    const parsed = await readSimproJson(r);
    if (!parsed.ok) return json({ error: parsed.error, status: parsed.status });

    return json({
      ok: true,
      message: authHeadersNote,
      status: parsed.status,
      raw: parsed.raw,
    });
  }

  // ── search_quotes ─────────────────────────────────────────────────────────────
  // Read-only quote search by reference/number string. Returns raw Simpro list payload.
  if (action === "search_quotes") {
    const query = String(body.query ?? body.quote_number ?? "").trim();
    if (!query) return json({ error: "query or quote_number required" });

    const params = new URLSearchParams({
      pageSize: "25",
      columns: "ID,Reference,Name,Status,DateIssued,Total",
    });
    // Simpro tenants may filter by Reference; pass through when supported.
    params.set("Reference", query);

    const url = buildApiUrl(config.baseUrl, config.companyId, "/quotes/", params);
    log("search_quotes", `${url} (query="${query}")`);

    const r = await simproFetch(url, config.apiToken).catch(() => null);
    if (!r) return json({ error: "Network error connecting to Simpro", quotes: [] });

    const parsed = await readSimproJson(r);
    if (!parsed.ok) return json({ error: parsed.error, status: parsed.status, quotes: [] });

    return json({
      ok: true,
      query,
      raw: parsed.raw,
    });
  }

  // ── get_quote ─────────────────────────────────────────────────────────────────
  // Read-only quote detail with nested sections/cost centres when Simpro supports display=all.
  if (action === "get_quote") {
    const quoteId = body.quote_id ?? body.quoteId ?? body.id;
    if (quoteId === undefined || quoteId === null || String(quoteId).trim() === "") {
      return json({ error: "quote_id required" });
    }

    const params = new URLSearchParams({ display: "all" });
    const url = buildApiUrl(config.baseUrl, config.companyId, `/quotes/${quoteId}`, params);
    log("get_quote", url);

    const r = await simproFetch(url, config.apiToken).catch(() => null);
    if (!r) return json({ error: "Network error connecting to Simpro" });

    const parsed = await readSimproJson(r);
    if (!parsed.ok) return json({ error: parsed.error, status: parsed.status });

    return json({
      ok: true,
      quote_id: quoteId,
      raw: parsed.raw,
    });
  }

  return json({ error: `Unknown action: ${action}` });
});
