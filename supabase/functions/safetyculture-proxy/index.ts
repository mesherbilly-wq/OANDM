import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SC_BASE = "https://api.safetyculture.io";
const SC_AUDIT_TITLE_ITEM_ID = "f3245d40-ea77-11e1-aff1-0800200c9a66";

/** Standard SafetyCulture title-page item IDs (information section). */
const SC_STANDARD_HEADER_ITEM_IDS = new Set([
  SC_AUDIT_TITLE_ITEM_ID,
  "f3245d41-ea77-11e1-aff1-0800200c9a66", // Client / Site
  "f3245d42-ea77-11e1-aff1-0800200c9a66", // Conducted on
  "f3245d43-ea77-11e1-aff1-0800200c9a66", // Prepared by
  "f3245d44-ea77-11e1-aff1-0800200c9a66", // Location
  "f3245d45-ea77-11e1-aff1-0800200c9a66", // Personnel
  "f3245d46-ea77-11e1-aff1-0800200c9a66", // Document No.
]);

function isHeaderItemId(itemId: string): boolean {
  return SC_STANDARD_HEADER_ITEM_IDS.has(itemId);
}

function normalizeIntegrationItemType(raw: string | undefined): string {
  const up = String(raw ?? "TEXT").toUpperCase().trim();
  if (up.startsWith("ITEM_TYPE_")) return up;
  const map: Record<string, string> = {
    TEXT: "ITEM_TYPE_TEXT",
    TEXTSINGLE: "ITEM_TYPE_TEXT",
    NUMBER: "ITEM_TYPE_NUMBER",
    DATETIME: "ITEM_TYPE_DATETIME",
    CHECKBOX: "ITEM_TYPE_CHECKBOX",
    QUESTION: "ITEM_TYPE_QUESTION",
    PARAGRAPH: "ITEM_TYPE_PARAGRAPH",
    LOCATION: "ITEM_TYPE_LOCATION",
  };
  return map[up] ?? `ITEM_TYPE_${up}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Strip wrappers users paste from SC UI or curl examples. */
function normalizeSafetyCultureToken(raw: string): string {
  let token = raw.trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  if (token.toLowerCase().startsWith("bearer ")) {
    token = token.slice(7).trim();
  }
  return token;
}

function scAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function scErr(r: Response, text: string) {
  if (r.status === 401) {
    return (
      "SafetyCulture API 401: token rejected. Disconnect, then paste a fresh API token from " +
      "SafetyCulture → My Profile → Settings → API tokens (new tokens start with scapi_). " +
      `Details: ${text.substring(0, 200)}`
    );
  }
  return `SafetyCulture API ${r.status}: ${text.substring(0, 400)}`;
}

interface NormalizedTemplate {
  id: string;
  template_id: string;
  name: string;
  owner_name: string;
  modified_at: string;
}

function mapTemplateRow(t: Record<string, unknown>): NormalizedTemplate | null {
  const id = String(t.id ?? t.template_id ?? "").trim();
  if (!id) return null;
  return {
    id,
    template_id: id,
    name: String(t.name ?? t.title ?? "Unnamed Template"),
    owner_name: String(t.owner_name ?? t.owner?.name ?? ""),
    modified_at: String(t.modified_at ?? t.updated_at ?? t.revision_key ?? ""),
  };
}

function extractTemplateArray(data: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [
    data.templates,
    data.data,
    data.results,
    (data.data as Record<string, unknown> | undefined)?.templates,
    (data.data as Record<string, unknown> | undefined)?.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
  }
  return [];
}

async function fetchTemplatesFromV1(token: string): Promise<{ ok: boolean; status: number; templates: NormalizedTemplate[]; error?: string }> {
  const headers = scAuthHeaders(token);
  const templates: NormalizedTemplate[] = [];
  let pageToken: string | null = null;
  let lastStatus = 0;

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ page_size: "100" });
    if (pageToken) params.set("page_token", pageToken);
    const url = `${SC_BASE}/templates/v1/templates?${params}`;
    const r = await fetch(url, { headers }).catch(() => null);
    if (!r) return { ok: false, status: 0, templates, error: "Network error connecting to SafetyCulture" };
    lastStatus = r.status;
    if (!r.ok) {
      const errText = await r.text().catch(() => `HTTP ${r.status}`);
      return { ok: false, status: r.status, templates, error: scErr(r, errText) };
    }

    const data = await r.json().catch(() => ({} as Record<string, unknown>));
    for (const row of extractTemplateArray(data)) {
      const mapped = mapTemplateRow(row);
      if (mapped && !(row.archived === true)) templates.push(mapped);
    }

    const next =
      (data.next_page_token as string | undefined) ??
      (data.nextPageToken as string | undefined) ??
      ((data.metadata as Record<string, unknown> | undefined)?.next_page_token as string | undefined) ??
      null;
    if (!next || next === pageToken) break;
    pageToken = next;
  }

  return { ok: true, status: lastStatus, templates };
}

async function fetchTemplatesFromFeed(token: string): Promise<{ ok: boolean; status: number; templates: NormalizedTemplate[]; error?: string }> {
  const r = await fetch(`${SC_BASE}/feed/templates`, { headers: scAuthHeaders(token) }).catch(() => null);
  if (!r) return { ok: false, status: 0, templates: [], error: "Network error connecting to SafetyCulture" };
  if (!r.ok) {
    const errText = await r.text().catch(() => `HTTP ${r.status}`);
    return { ok: false, status: r.status, templates: [], error: scErr(r, errText) };
  }
  const data = await r.json().catch(() => ({} as Record<string, unknown>));
  const templates = extractTemplateArray(data)
    .filter(t => t.archived !== true)
    .map(mapTemplateRow)
    .filter((t): t is NormalizedTemplate => t != null);
  return { ok: true, status: r.status, templates };
}

async function listSafetyCultureTemplates(token: string): Promise<{ templates: NormalizedTemplate[]; source: string; error?: string }> {
  const v1 = await fetchTemplatesFromV1(token);
  if (v1.ok && v1.templates.length > 0) {
    return { templates: v1.templates, source: "templates/v1/templates" };
  }

  const feed = await fetchTemplatesFromFeed(token);
  if (feed.ok && feed.templates.length > 0) {
    return { templates: feed.templates, source: "feed/templates" };
  }

  if (v1.ok) return { templates: v1.templates, source: "templates/v1/templates" };
  if (feed.ok) return { templates: feed.templates, source: "feed/templates" };

  return {
    templates: [],
    source: "none",
    error: v1.error ?? feed.error ?? "Could not list SafetyCulture templates.",
  };
}

async function verifySafetyCultureConnection(token: string): Promise<{ ok: boolean; error?: string; source?: string }> {
  const listed = await listSafetyCultureTemplates(token);
  if (listed.templates.length > 0) {
    return { ok: true, source: listed.source };
  }
  if (listed.error) return { ok: false, error: listed.error };

  // Empty library is still a valid token — probe template list endpoint directly.
  const r = await fetch(`${SC_BASE}/templates/v1/templates?page_size=1`, { headers: scAuthHeaders(token) }).catch(() => null);
  if (r?.ok) return { ok: true, source: "templates/v1/templates" };
  if (r && !r.ok) {
    const errText = await r.text().catch(() => `HTTP ${r.status}`);
    return { ok: false, error: scErr(r, errText) };
  }
  return { ok: false, error: "Network error connecting to SafetyCulture" };
}

function log(action: string, detail: string) {
  console.log(`[SC-proxy][${action}] ${detail}`);
}

function inspectionIdVariants(inspectionId: string): { auditId: string; inspIds: string[]; auditIds: string[] } {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const inspIds = new Set<string>([inspectionId]);
  const auditIds = new Set<string>();
  let auditId = inspectionId;

  if (inspectionId.startsWith("insp_")) {
    const core = inspectionId.slice(5);
    auditId = `audit_${core}`;
    auditIds.add(auditId);
    inspIds.add(auditId);
    if (UUID_RE.test(core)) inspIds.add(core);
  } else if (inspectionId.startsWith("audit_")) {
    const core = inspectionId.slice(6);
    auditIds.add(inspectionId);
    inspIds.add(`insp_${core}`);
    auditId = inspectionId;
    if (UUID_RE.test(core)) inspIds.add(core);
  } else if (UUID_RE.test(inspectionId)) {
    auditId = `audit_${inspectionId}`;
    auditIds.add(auditId);
    auditIds.add(inspectionId);
    inspIds.add(`insp_${inspectionId}`);
  } else {
    auditIds.add(inspectionId);
  }

  return { auditId, inspIds: [...inspIds], auditIds: [...auditIds] };
}

async function fetchTemplateItems(
  templateId: string,
  headers: Record<string, string>,
): Promise<any[]> {
  try {
    const r = await fetch(`${SC_BASE}/templates/v1/templates/${templateId}`, { headers });
    if (!r.ok) return [];
    const raw = await r.json().catch(() => ({}));
    return flattenTemplateItems(
      raw.items ?? raw.template?.items ?? raw.header_items ?? raw.data?.items ?? [],
    );
  } catch {
    return [];
  }
}

function templateItemIds(templateItems: any[]): Set<string> {
  const ids = new Set<string>();
  for (const item of templateItems) {
    const id = item.item_id ?? item.id;
    if (id) ids.add(String(id));
  }
  return ids;
}

function filterItemsToTemplate(items: any[], validIds: Set<string>): any[] {
  return items.filter(item => item.item_id && validIds.has(String(item.item_id)));
}

function flattenTemplateItems(arr: any[]): any[] {
  const out: any[] = [];
  for (const item of arr ?? []) {
    out.push(item);
    if (Array.isArray(item.children)) out.push(...flattenTemplateItems(item.children));
    if (Array.isArray(item.items)) out.push(...flattenTemplateItems(item.items));
  }
  return out;
}

async function discoverAuditTitleItemIds(
  templateId: string,
  explicitItemId: string | undefined,
  headers: Record<string, string>,
  templateItems?: any[],
): Promise<string[]> {
  const items = templateItems ?? await fetchTemplateItems(templateId, headers);
  const validIds = templateItemIds(items);
  const ids = new Set<string>();

  if (explicitItemId?.trim() && validIds.has(explicitItemId.trim())) {
    ids.add(explicitItemId.trim());
  }
  if (validIds.has(SC_AUDIT_TITLE_ITEM_ID)) ids.add(SC_AUDIT_TITLE_ITEM_ID);

  for (const item of items) {
    const id = item.item_id ?? item.id;
    const label = String(item.label ?? item.name ?? "").toLowerCase();
    if (
      id && validIds.has(String(id)) && (
        /audit\s*title/.test(label)
        || /inspection\s*title/.test(label)
        || label === "title"
      )
    ) {
      ids.add(String(id));
    }
  }

  return [...ids];
}

async function applyAuditListName(
  inspectionId: string,
  name: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { auditIds } = inspectionIdVariants(inspectionId);

  const bodies = [
    { audit_data: { name: trimmed } },
    { name: trimmed },
    { audit_name: trimmed },
    { audit_data: { name: trimmed }, name: trimmed, audit_name: trimmed },
  ];

  for (const auditId of auditIds) {
    for (const body of bodies) {
      const r = await fetch(`${SC_BASE}/audits/${auditId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      }).catch(() => null);
      if (r?.ok) {
        log("applyAuditListName", `legacy PUT ${auditId} keys=${Object.keys(body).join(",")}`);
        return `legacy_name:${auditId}`;
      }
    }
  }
  return null;
}

async function applyInspectionDisplayName(
  inspectionId: string | null | undefined,
  name: string,
  titleItemIds: string[],
  headers: Record<string, string>,
): Promise<string | null> {
  if (!inspectionId || !name.trim()) return null;
  const trimmed = name.trim();
  const { auditId, inspIds, auditIds } = inspectionIdVariants(inspectionId);
  const itemIds = new Set(titleItemIds);

  for (const aid of auditIds) {
    try {
      const getR = await fetch(`${SC_BASE}/audits/${aid}`, { headers });
      if (getR.ok) {
        const audit = await getR.json().catch(() => ({}));
        for (const item of audit.header_items ?? []) {
          const id = item.item_id ?? item.id;
          const label = String(item.label ?? "").toLowerCase();
          if (id && (/audit\s*title/.test(label) || /inspection\s*title/.test(label))) {
            itemIds.add(String(id));
          }
        }
        break;
      }
    } catch { /* ignore */ }
  }

  let lastOk: string | null = null;

  for (const itemId of itemIds) {
    for (const inspId of inspIds) {
      const putR = await fetch(`${SC_BASE}/inspections/integration/v1/inspections/${inspId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          items: [{
            item_id: itemId,
            item_type: "ITEM_TYPE_TEXT",
            text_item: { value: trimmed },
          }],
        }),
      }).catch(() => null);
      if (putR?.ok) {
        lastOk = `integration:${inspId}`;
        log("applyInspectionDisplayName", `integration PUT ${inspId} item=${itemId}`);
      } else if (putR) {
        const err = await putR.text().catch(() => `HTTP ${putR.status}`);
        log("applyInspectionDisplayName", `integration PUT failed ${inspId} item=${itemId}: ${err.substring(0, 200)}`);
      }
    }

    for (const legacyType of ["textsingle", "text"]) {
      for (const aid of auditIds) {
        const legacyR = await fetch(`${SC_BASE}/audits/${aid}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            header_items: [{ item_id: itemId, type: legacyType, responses: { text: trimmed } }],
          }),
        }).catch(() => null);
        if (legacyR?.ok) {
          lastOk = `legacy:${aid}:${legacyType}`;
          log("applyInspectionDisplayName", `legacy PUT ${aid} type=${legacyType} item=${itemId}`);
          break;
        }
      }
    }
  }

  if (!lastOk) {
    const listName = await applyAuditListName(inspectionId, trimmed, headers);
    if (listName) lastOk = listName;
  }

  return lastOk;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }); }

  const { action } = body;
  log(action, "invoked");

  // ── save_token ────────────────────────────────────────────────────────────────
  if (action === "save_token") {
    const { token } = body;
    const normalized = normalizeSafetyCultureToken(String(token ?? ""));
    if (!normalized) return json({ error: "token required" });
    const { error } = await db.from("integration_settings")
      .upsert({ key: "safetyculture_api_token", value: normalized, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return json({ error: error.message });
    return json({ ok: true });
  }

  // ── delete_token ──────────────────────────────────────────────────────────────
  if (action === "delete_token") {
    await db.from("integration_settings").delete().eq("key", "safetyculture_api_token");
    return json({ ok: true });
  }

  // Remaining actions need the stored token
  const { data: tokenRow } = await db
    .from("integration_settings")
    .select("value")
    .eq("key", "safetyculture_api_token")
    .single();

  if (!tokenRow?.value) return json({ error: "SafetyCulture API token not configured" });
  const scToken = normalizeSafetyCultureToken(tokenRow.value as string);
  const authHeaders = scAuthHeaders(scToken);

  // ── diagnose_template ────────────────────────────────────────────────────────
  // Returns raw API responses from every relevant endpoint so the UI can show
  // exactly what the token can access and what structure SC returns.
  if (action === "diagnose_template") {
    const { template_id } = body;
    if (!template_id) return json({ error: "template_id required" });

    const results: Array<{
      label: string;
      url: string;
      status: number | null;
      ok: boolean;
      error: string | null;
      raw_body: string | null;
      top_keys: string[];
      item_count: number;
    }> = [];

    async function probe(label: string, url: string) {
      let status: number | null = null;
      let ok = false;
      let raw_body: string | null = null;
      let top_keys: string[] = [];
      let item_count = 0;
      let error: string | null = null;
      try {
        const r = await fetch(url, { headers: authHeaders });
        status = r.status;
        ok = r.ok;
        const text = await r.text().catch(() => "");
        raw_body = text.substring(0, 3000);
        try {
          const parsed = JSON.parse(text);
          top_keys = Object.keys(parsed);
          // SC items can be keyed by item_id OR id — count whichever has them
          const candidates = [
            parsed.items, parsed.template?.items, parsed.data?.items,
            parsed.header_items, parsed.audit_data?.items,
            parsed.audit_data?.header_items,
            parsed.fields, parsed.questions,
          ];
          for (const c of candidates) {
            if (Array.isArray(c) && c.length > 0) {
              // Report whether items use 'id' or 'item_id'
              const firstItem = c[0];
              const idField = firstItem.item_id ? "item_id" : firstItem.id ? "id" : "unknown";
              const labelField = firstItem.label ? "label" : firstItem.name ? "name" : "unknown";
              item_count = Math.max(item_count, c.length);
              raw_body += `\n\n[Array found — ${c.length} items, id field: "${idField}", label field: "${labelField}"]`;
              if (c.length > 0) {
                raw_body += `\nFirst item sample: ${JSON.stringify(c[0]).substring(0, 300)}`;
              }
            }
          }
        } catch { /* not JSON */ }
      } catch (e: any) {
        error = e.message;
      }
      results.push({ label, url, status, ok, error, raw_body, top_keys, item_count });
    }

    // 1. Feed templates endpoint (known-working baseline)
    await probe("feed/templates (baseline)", `${SC_BASE}/feed/templates`);

    // 2. Template definition — primary
    await probe("templates/v1/templates/{id}", `${SC_BASE}/templates/v1/templates/${template_id}`);

    // 3. Template items sub-resource (SC may expose items separately)
    await probe("templates/v1/templates/{id}/items", `${SC_BASE}/templates/v1/templates/${template_id}/items`);

    // 4. Try fetching a recent audit for this template to extract schema
    const searchR = await fetch(
      `${SC_BASE}/audits/search?template=${encodeURIComponent(template_id)}&limit=1`,
      { headers: authHeaders }
    ).catch(() => null);
    const searchStatus = searchR?.status ?? null;
    let sampleAuditId: string | null = null;
    if (searchR?.ok) {
      const sd = await searchR.json().catch(() => ({}));
      const audits: any[] = sd.audits ?? sd.data ?? [];
      sampleAuditId = audits[0]?.audit_id ?? audits[0]?.id ?? null;
    }
    results.push({
      label: "audits/search (find sample audit)",
      url: `${SC_BASE}/audits/search?template=${template_id}&limit=1`,
      status: searchStatus,
      ok: searchR?.ok ?? false,
      error: null,
      raw_body: sampleAuditId ? `Found audit: ${sampleAuditId}` : "No audits found for this template — complete at least one inspection first to enable field auto-detection",
      top_keys: [],
      item_count: sampleAuditId ? 1 : 0,
    });

    // 5. If we have a sample audit, probe its full details
    if (sampleAuditId) {
      await probe(`audits/${sampleAuditId} (full inspection)`, `${SC_BASE}/audits/${sampleAuditId}`);
    }

    return json({ template_id, results });
  }


  // ── test_connection ───────────────────────────────────────────────────────────
  if (action === "test_connection") {
    const verified = await verifySafetyCultureConnection(scToken);
    if (!verified.ok) return json({ error: verified.error ?? "Connection failed" });
    return json({ ok: true, source: verified.source ?? "templates/v1/templates" });
  }

  // ── list_templates ────────────────────────────────────────────────────────────
  if (action === "list_templates") {
    const listed = await listSafetyCultureTemplates(scToken);
    if (listed.error && listed.templates.length === 0) {
      return json({ error: listed.error, templates: [] });
    }
    return json({ templates: listed.templates, source: listed.source });
  }

  // ── get_template_definition ───────────────────────────────────────────────────
  // Strategy (in order):
  //   1. GET /templates/v1/templates/{id}        — template object (may contain items)
  //   2. GET /templates/v1/templates/{id}/items  — dedicated items sub-resource
  //   3. Fetch any audit for this template and extract item schema from it
  if (action === "get_template_definition") {
    const { template_id } = body;
    if (!template_id) return json({ error: "template_id required" });

    let rawItems: any[] = [];
    const debugLog: string[] = [];

    // Flatten nested SC item trees (sections may have children / nested items arrays)
    function flattenItems(arr: any[]): any[] {
      const out: any[] = [];
      for (const item of arr) {
        out.push(item);
        if (Array.isArray(item.children) && item.children.length > 0)
          out.push(...flattenItems(item.children));
        if (Array.isArray(item.items) && item.items.length > 0)
          out.push(...flattenItems(item.items));
      }
      return out;
    }

    // SC uses 'item_id' in audit responses and 'id' in templates/v1 REST responses
    function itemId(i: any): string | null { return i.item_id ?? i.id ?? null; }
    // SC uses 'label' in audits, 'name' or 'label' in templates/v1
    function itemLabel(i: any): string {
      return i.label ?? i.name ?? i.content?.label ?? i.title ?? itemId(i) ?? "";
    }

    // Attempt 1: template object
    try {
      const r = await fetch(`${SC_BASE}/templates/v1/templates/${template_id}`, { headers: authHeaders });
      debugLog.push(`templates/v1/templates → ${r.status}`);
      if (r.ok) {
        const raw = await r.json().catch(() => ({}));
        debugLog.push(`  keys: ${Object.keys(raw).join(", ")}`);
        const candidate = flattenItems(
          raw.items ?? raw.template?.items ?? raw.data?.items ??
          raw.header_items ?? raw.fields ?? raw.questions ?? []
        );
        const withIds = candidate.filter(i => i.item_id ?? i.id);
        debugLog.push(`  items: ${candidate.length}, with-ids: ${withIds.length}`);
        if (withIds.length > 0) rawItems = withIds;
      }
    } catch (e: any) { debugLog.push(`templates/v1 error: ${e.message}`); }

    // Attempt 2: dedicated /items sub-resource
    if (rawItems.length === 0) {
      try {
        const r = await fetch(`${SC_BASE}/templates/v1/templates/${template_id}/items`, { headers: authHeaders });
        debugLog.push(`templates/v1/templates/items → ${r.status}`);
        if (r.ok) {
          const raw = await r.json().catch(() => ({}));
          debugLog.push(`  keys: ${Object.keys(raw).join(", ")}`);
          const candidate = flattenItems(raw.items ?? raw.data ?? raw.fields ?? raw.questions ?? []);
          const withIds = candidate.filter(i => i.item_id ?? i.id);
          debugLog.push(`  items: ${candidate.length}, with-ids: ${withIds.length}`);
          if (withIds.length > 0) rawItems = withIds;
        }
      } catch (e: any) { debugLog.push(`/items sub-resource error: ${e.message}`); }
    }

    // Attempt 3: extract schema from an existing audit for this template
    if (rawItems.length === 0) {
      debugLog.push("Falling back to audit extraction");
      try {
        const sr = await fetch(
          `${SC_BASE}/audits/search?template=${encodeURIComponent(template_id)}&limit=5`,
          { headers: authHeaders }
        );
        debugLog.push(`/audits/search → ${sr.status}`);
        if (sr.ok) {
          const sd = await sr.json().catch(() => ({}));
          const audits: any[] = sd.audits ?? sd.data ?? [];
          debugLog.push(`  audits found: ${audits.length}`);
          for (const audit of audits) {
            const auditId = audit.audit_id ?? audit.id;
            if (!auditId) continue;
            const ar = await fetch(`${SC_BASE}/audits/${auditId}`, { headers: authHeaders });
            debugLog.push(`  /audits/${auditId} → ${ar.status}`);
            if (ar.ok) {
              const ad = await ar.json().catch(() => ({}));
              const headerItems: any[] = ad.header_items ?? ad.audit_data?.header_items ?? [];
              const bodyItems: any[] = ad.items ?? ad.audit_data?.items ?? [];
              const combined = flattenItems([...headerItems, ...bodyItems]);
              debugLog.push(`  header: ${headerItems.length}, body: ${bodyItems.length}`);
              if (combined.length > 0) { rawItems = combined; break; }
            }
          }
        }
      } catch (e: any) { debugLog.push(`audit fallback error: ${e.message}`); }
    }

    log("get_template_definition", debugLog.join(" | "));

    const typeNorm = (raw: string): string => {
      // Default null/empty to "text" so unknown-type items appear in the mapping UI
      let up = (raw ?? "text").toUpperCase().trim();
      // Strip the ITEM_TYPE_ prefix that SC uses in some API responses
      if (up.startsWith("ITEM_TYPE_")) up = up.slice("ITEM_TYPE_".length);
      if (!up) return "TEXT";
      if (["TEXTSINGLE", "TEXTBOX", "OWNER", "PERSON"].includes(up)) return "TEXT";
      if (["DATE", "TIME"].includes(up)) return "DATETIME";
      return up;
    };

    // Types that cannot be prefilled via the SC inspection integration API
    const UNSETTABLE = new Set(["SECTION", "UNSPECIFIED", "SMART_FIELD", "MEDIA", "DRAWING", "ASSET", "SIGNATURE", "INFORMATION"]);

    // Filter and map — handle both item_id (audits) and id (templates/v1)
    const items = rawItems
      .filter(i => itemId(i) && !UNSETTABLE.has(typeNorm(i.type ?? i.item_type ?? "")))
      .map(i => ({
        item_id: itemId(i)!,
        type: typeNorm(i.type ?? i.item_type ?? "TEXT"),
        label: itemLabel(i),
        section: i.parent_id ?? null,
      }));

    const sections = rawItems
      .filter(i => typeNorm(i.type ?? i.item_type ?? "") === "SECTION")
      .map(i => ({ item_id: itemId(i)!, label: itemLabel(i) }));

    const tableItems = rawItems
      .filter(i => typeNorm(i.type ?? i.item_type ?? "") === "TABLE")
      .map(i => {
        const cols: any[] =
          i.options?.rows ?? i.responses?.columns ?? i.columns ?? i.table_columns ?? [];
        return {
          item_id: itemId(i)!,
          label: itemLabel(i),
          columns: cols
            .map((col: any) => ({
              field_id: col.field_id ?? col.id ?? col.item_id,
              label: col.label ?? col.name ?? col.type ?? col.field_id ?? col.id,
            }))
            .filter(c => c.field_id),
        };
      })
      .filter(t => t.columns.length > 0);

    return json({
      items,
      sections,
      tableItems,
      raw_item_count: rawItems.length,
      debug: debugLog,
    });
  }

  // ── search_inspections ────────────────────────────────────────────────────────
  if (action === "search_inspections") {
    const { template_id } = body;
    if (!template_id) return json({ error: "template_id required", inspections: [] });

    const params = new URLSearchParams({ template: template_id, completed: "true", archived: "false" });
    params.append("field", "audit_id");
    params.append("field", "modified_at");
    params.append("field", "template_id");
    params.set("limit", "100");

    const r = await fetch(`${SC_BASE}/audits/search?${params}`, { headers: authHeaders }).catch(() => null);
    if (!r) return json({ error: "Network error", inspections: [] });
    if (!r.ok) {
      const errText = await r.text().catch(() => `HTTP ${r.status}`);
      return json({ error: scErr(r, errText), inspections: [] });
    }
    const data = await r.json();
    const rawAudits: any[] = data.audits ?? data.data ?? [];
    const inspections = rawAudits.map(a => ({
      audit_id: a.audit_id,
      id: a.audit_id,
      audit_name: a.name ?? a.audit_name ?? a.title ?? null,
      date_completed: a.date_completed ?? a.completed_at ?? a.modified_at ?? null,
      completed_at: a.date_completed ?? a.completed_at ?? a.modified_at ?? null,
      modified_at: a.modified_at ?? null,
    }));
    return json({ inspections });
  }

  // ── create_inspection ─────────────────────────────────────────────────────────
  if (action === "create_inspection") {
    const { template_id, items: rawItems, name, audit_title_item_id } = body;
    if (!template_id) return json({ error: "template_id required" });

    const templateItems = await fetchTemplateItems(template_id, authHeaders);
    const validItemIds = templateItemIds(templateItems);
    const items: any[] = filterItemsToTemplate(
      Array.isArray(rawItems) ? [...rawItems] : [],
      validItemIds,
    );
    const inspectionName = typeof name === "string" ? name.trim() : "";
    const titleItemIds = await discoverAuditTitleItemIds(
      template_id,
      audit_title_item_id,
      authHeaders,
      templateItems,
    );
    const primaryTitleItemId = titleItemIds[0] ?? (
      validItemIds.has(SC_AUDIT_TITLE_ITEM_ID) ? SC_AUDIT_TITLE_ITEM_ID : null
    );
    const createErrors: string[] = [];

    const finalizeSuccess = async (inspection_id: string | null, raw: unknown, via: string) => {
      const rename_via = inspectionName
        ? await applyInspectionDisplayName(inspection_id, inspectionName, titleItemIds, authHeaders)
        : null;
      return json({
        ok: true,
        inspection_id,
        raw,
        created_via: via,
        rename_via,
        ...(createErrors.length > 0 ? { create_errors: createErrors } : {}),
      });
    };

    const toLegacyItem = (item: any) => {
      if (item.text_item?.value) {
        return {
          item_id: item.item_id,
          type: "textsingle",
          responses: { text: item.text_item.value },
        };
      }
      if (item.datetime_item?.value) {
        return {
          item_id: item.item_id,
          type: "datetime",
          responses: { datetime: item.datetime_item.value },
        };
      }
      return null;
    };

    const legacyItems = items
      .map(toLegacyItem)
      .filter(Boolean) as Array<{ item_id: string; type: string; responses: Record<string, string> }>;

    const titleLegacyItems: typeof legacyItems = inspectionName && primaryTitleItemId
      && !titleItemIds.some(id => legacyItems.some(li => li.item_id === id))
      ? [
        { item_id: primaryTitleItemId, type: "textsingle", responses: { text: inspectionName } },
        { item_id: primaryTitleItemId, type: "text", responses: { text: inspectionName } },
      ]
      : [];

    const mergedLegacy = [
      ...titleLegacyItems,
      ...legacyItems.filter(li => !titleLegacyItems.some(t => t.item_id === li.item_id && t.type === li.type)),
    ];
    const headerItems = mergedLegacy.filter(li => isHeaderItemId(li.item_id));
    const bodyItems = mergedLegacy.filter(li => !isHeaderItemId(li.item_id));

    const toIntegrationItems = () => {
      const integrationItems: any[] = [];
      for (const item of items) {
        if (item.text_item?.value) {
          integrationItems.push({
            item_id: item.item_id,
            item_type: normalizeIntegrationItemType(item.item_type),
            text_item: { value: item.text_item.value },
          });
        } else if (item.datetime_item?.value) {
          integrationItems.push({
            item_id: item.item_id,
            item_type: normalizeIntegrationItemType(item.item_type ?? "DATETIME"),
            datetime_item: { value: item.datetime_item.value },
          });
        }
      }
      if (inspectionName && primaryTitleItemId && !titleItemIds.some(id => integrationItems.some(item => item.item_id === id))) {
        integrationItems.unshift({
          item_id: primaryTitleItemId,
          item_type: "ITEM_TYPE_TEXT",
          text_item: { value: inspectionName },
        });
      }
      return integrationItems;
    };

    const withAuditName = (reqBody: Record<string, unknown>) => {
      if (inspectionName) {
        reqBody.audit_name = inspectionName;
        reqBody.name = inspectionName;
      }
      return reqBody;
    };

    log(
      "create_inspection",
      `template=${template_id}, prefill_items=${mergedLegacy.length}, header=${headerItems.length}, body=${bodyItems.length}, name=${inspectionName || "(none)"}, title_items=${titleItemIds.join(",")}`,
    );

    // Strategy 1: Integration API (preferred — supports item prefill reliably)
    {
      const integrationItems = toIntegrationItems();
      if (integrationItems.length > 0) {
        const r = await fetch(`${SC_BASE}/inspections/integration/v1/inspections`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ template_id, items: integrationItems }),
        }).catch(() => null);

        if (r?.ok) {
          const data = await r.json().catch(() => ({}));
          const inspection_id = data.inspection_identity?.inspection_id ?? data.inspection_id ?? null;
          log("create_inspection", `created via integration: inspection_id=${inspection_id}`);
          return await finalizeSuccess(inspection_id, data, "integration");
        }

        const errText = r ? await r.text().catch(() => `HTTP ${r.status}`) : "network error";
        createErrors.push(`integration (${r?.status}): ${errText.substring(0, 300)}`);
        log("create_inspection", `integration failed (${r?.status}): ${errText.substring(0, 300)}`);
      }
    }

    // Strategy 2: Legacy /audits with prefilled header_items
    if (headerItems.length > 0) {
      const r = await fetch(`${SC_BASE}/audits`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(withAuditName({
          template_id,
          header_items: headerItems,
          items: bodyItems,
        })),
      }).catch(() => null);

      if (r?.ok) {
        const data = await r.json().catch(() => ({}));
        const inspection_id = data.audit_id ?? data.inspection_id ?? null;
        log("create_inspection", `created via /audits: audit_id=${inspection_id}`);
        return await finalizeSuccess(inspection_id, data, "audits");
      }

      const errText = r ? await r.text().catch(() => `HTTP ${r.status}`) : "network error";
      createErrors.push(`audits (${r?.status}): ${errText.substring(0, 300)}`);
      log("create_inspection", `/audits failed (${r?.status}): ${errText.substring(0, 300)}`);

      const r2 = await fetch(`${SC_BASE}/audits`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(withAuditName({ template_id, header_items: headerItems })),
      }).catch(() => null);

      if (r2?.ok) {
        const data = await r2.json().catch(() => ({}));
        const inspection_id = data.audit_id ?? data.inspection_id ?? null;
        log("create_inspection", `created via /audits (header only): audit_id=${inspection_id}`);
        return await finalizeSuccess(inspection_id, data, "audits_header_only");
      }
    }

    // Strategy 3: Legacy /audits with audit_name only (list title when template has no Audit Title field)
    if (inspectionName) {
      const r = await fetch(`${SC_BASE}/audits`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(withAuditName({ template_id })),
      }).catch(() => null);

      if (r?.ok) {
        const data = await r.json().catch(() => ({}));
        const inspection_id = data.audit_id ?? data.inspection_id ?? null;
        log("create_inspection", `created via /audits (name only): audit_id=${inspection_id}`);
        return await finalizeSuccess(inspection_id, data, "audits_name_only");
      }

      const errText = r ? await r.text().catch(() => `HTTP ${r.status}`) : "network error";
      createErrors.push(`audits_name_only (${r?.status}): ${errText.substring(0, 300)}`);
      log("create_inspection", `/audits name-only failed (${r?.status}): ${errText.substring(0, 300)}`);
    }

    // Strategy 4: Bare create then rename
    {
      const r = await fetch(`${SC_BASE}/inspections/integration/v1/inspections`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ template_id }),
      }).catch(() => null);

      if (r?.ok) {
        const data = await r.json().catch(() => ({}));
        const inspection_id = data.inspection_identity?.inspection_id ?? data.inspection_id ?? null;
        log("create_inspection", `created via integration bare: inspection_id=${inspection_id}`);
        return await finalizeSuccess(inspection_id, data, "integration_bare");
      }

      const errText = r ? await r.text().catch(() => `HTTP ${r.status}`) : "network error";
      log("create_inspection", `integration bare failed (${r?.status}): ${errText.substring(0, 200)}`);

      const r2 = await fetch(`${SC_BASE}/audits`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ template_id }),
      }).catch(() => null);

      if (r2?.ok) {
        const data = await r2.json().catch(() => ({}));
        const inspection_id = data.audit_id ?? data.inspection_id ?? null;
        log("create_inspection", `created via /audits bare: audit_id=${inspection_id}`);
        return await finalizeSuccess(inspection_id, data, "audits_bare");
      }

      const errText2 = r2 ? await r2.text().catch(() => `HTTP ${r2.status}`) : "network error";
      log("create_inspection", `/audits bare failed (${r2?.status}): ${errText2.substring(0, 200)}`);
      return json({ error: scErr(r2 ?? r!, errText2 || errText), create_errors: createErrors });
    }
  }


  // ── get_inspection ────────────────────────────────────────────────────────────
  if (action === "get_inspection") {
    const { inspection_id } = body;
    if (!inspection_id) return json({ error: "inspection_id required" });

    let status = "in_progress";
    let score_pct: number | null = null;
    let engineer_name: string | null = null;
    let date_completed: string | null = null;
    let result: string | null = null;

    // Helper: extract fields from a flat or nested SC response object
    const extract = (d: any) => {
      const node = d.inspection ?? d.audit ?? d.audit_data ?? d;
      const dc =
        node.date_completed ?? node.dateCompleted ??
        node.completed_at ?? node.completedAt ??
        d.audit_data?.date_completed ?? d.audit_data?.dateCompleted ??
        null;
      // Ignore the proto zero-time placeholder SC sometimes returns
      const cleaned = (dc && dc !== "0001-01-01T00:00:00Z" && dc !== "") ? dc : null;
      return {
        date_completed: cleaned,
        score_pct: node.score_percentage ?? node.scorePercentage ??
          d.audit_data?.score_percentage ?? null,
        engineer_name: node.modified_by?.name ?? node.modifiedBy?.name ??
          node.owner_name ?? d.audit_data?.modified_by?.name ?? null,
      };
    };

    // Build both ID forms
    const isInsp = inspection_id.startsWith("insp_");
    const isAudit = inspection_id.startsWith("audit_");
    const auditId = isInsp ? "audit_" + inspection_id.slice(5) : inspection_id;
    const inspId  = isAudit ? "insp_" + inspection_id.slice(6) : inspection_id;

    const attempts = [
      // v1 details endpoint (works for insp_ IDs)
      { url: `${SC_BASE}/inspections/v1/inspections/${inspId}/details`, label: "v1/details/insp" },
      // v1 with audit_ ID as-is (some orgs)
      { url: `${SC_BASE}/inspections/v1/inspections/${inspection_id}/details`, label: "v1/details/raw" },
      // Legacy audit endpoint
      { url: `${SC_BASE}/audits/${auditId}`, label: "legacy/audits" },
      // Legacy with raw ID
      { url: `${SC_BASE}/audits/${inspection_id}`, label: "legacy/audits/raw" },
    ];

    for (const { url, label } of attempts) {
      if (date_completed !== null) break;
      try {
        const r = await fetch(url, { headers: authHeaders });
        log("get_inspection", `${label} → ${r.status}`);
        if (!r.ok) continue;
        const d = await r.json().catch(() => ({}));
        const fields = extract(d);
        if (fields.date_completed) {
          date_completed = fields.date_completed;
          score_pct = fields.score_pct;
          engineer_name = fields.engineer_name;
          status = "completed";
          log("get_inspection", `found completed via ${label}: date=${date_completed}`);
        } else if (!score_pct) {
          // Not complete but at least capture score info
          score_pct = fields.score_pct;
          engineer_name = fields.engineer_name;
          log("get_inspection", `not complete via ${label}`);
        }
      } catch (e: any) {
        log("get_inspection", `${label} threw: ${e.message}`);
      }
    }

    if (score_pct !== null && (score_pct as number) > 0) result = (score_pct as number) >= 80 ? "pass" : "fail";
    return json({ ok: true, status, score_pct, engineer_name, date_completed, result });
  }

  // ── export_pdf ────────────────────────────────────────────────────────────────
  // Exports a completed inspection PDF from SC, uploads to Supabase storage.
  // Does NOT write to any DB table — caller handles that.
  if (action === "export_pdf") {
    const { inspection_id, project_id, path_prefix } = body;
    if (!inspection_id || !project_id) return json({ error: "inspection_id and project_id required" });

    const prefix = path_prefix ?? "handover";
    const isInsp = inspection_id.startsWith("insp_");
    const auditId = isInsp ? "audit_" + inspection_id.slice(5) : inspection_id;
    const inspId  = inspection_id.startsWith("audit_") ? "insp_" + inspection_id.slice(6) : inspection_id;

    let pdfBuf: ArrayBuffer | null = null;
    let fileName = `SC_Inspection_${inspection_id}.pdf`;

    // ── Attempt 1: direct legacy PDF download (audit_ IDs)
    for (const url of [
      `${SC_BASE}/audits/${auditId}/export.pdf`,
      `${SC_BASE}/audits/${auditId}.pdf`,
    ]) {
      if (pdfBuf) break;
      try {
        const r = await fetch(url, { headers: authHeaders });
        log("export_pdf", `direct PDF ${url} → ${r.status}`);
        if (r.ok) {
          const ct = r.headers.get("content-type") ?? "";
          if (ct.includes("pdf") || ct.includes("octet")) {
            pdfBuf = await r.arrayBuffer();
            log("export_pdf", `got PDF via direct download, size=${pdfBuf.byteLength}`);
          }
        }
      } catch (e: any) { log("export_pdf", `direct threw: ${e.message}`); }
    }

    // ── Attempt 2: v1 export API (works for insp_ IDs, try both forms)
    if (!pdfBuf) {
      for (const idToTry of [inspId, inspection_id]) {
        if (pdfBuf) break;
        try {
          const exportR = await fetch(`${SC_BASE}/inspection/v1/export`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ export_data: [{ inspection_id: idToTry }], type: "DOCUMENT_TYPE_PDF" }),
          });
          log("export_pdf", `v1 export (${idToTry}) → ${exportR.status}`);
          if (exportR.ok) {
            const exportData = await exportR.json().catch(() => null);
            log("export_pdf", `v1 export status=${exportData?.status}`);
            let rawUrl: string | null = null;
            if (exportData?.status === "STATUS_DONE") {
              rawUrl = exportData.url;
            } else if (exportData?.status === "STATUS_IN_PROGRESS") {
              // Poll once after a short wait
              await new Promise(r => setTimeout(r, 5000));
              const retry = await fetch(`${SC_BASE}/inspection/v1/export`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ export_data: [{ inspection_id: idToTry }], type: "DOCUMENT_TYPE_PDF" }),
              }).catch(() => null);
              if (retry?.ok) {
                const rd = await retry.json().catch(() => null);
                if (rd?.status === "STATUS_DONE") rawUrl = rd.url;
              }
            }
            if (rawUrl) {
              const pdfRes = await fetch(rawUrl).catch(() => null);
              if (pdfRes?.ok) {
                pdfBuf = await pdfRes.arrayBuffer();
                log("export_pdf", `got PDF via v1 export, size=${pdfBuf.byteLength}`);
              }
            }
          }
        } catch (e: any) { log("export_pdf", `v1 export threw: ${e.message}`); }
      }
    }

    if (!pdfBuf) {
      return json({ error: "Could not export PDF from SafetyCulture. Ensure the inspection is completed and try again." });
    }

    const storagePath = `${prefix}/${project_id}/sc_${inspection_id}_${Date.now()}.pdf`;
    const { error: upErr } = await db.storage
      .from("om-uploads")
      .upload(storagePath, pdfBuf, { contentType: "application/pdf", upsert: false });
    if (upErr) return json({ error: "Storage upload failed: " + upErr.message });
    const { data: { publicUrl } } = db.storage.from("om-uploads").getPublicUrl(storagePath);
    log("export_pdf", `uploaded to storage: ${publicUrl}`);
    return json({ ok: true, pdf_url: publicUrl, file_name: fileName });
  }

  // ── import_results ────────────────────────────────────────────────────────────
  // Imports completed inspection results and PDF, stores against DB record
  if (action === "import_results") {
    const { sc_inspection_id, inspection_id, project_id } = body;
    // sc_inspection_id = our DB row id; inspection_id = SC's insp_xxx
    if (!sc_inspection_id || !inspection_id || !project_id) {
      return json({ error: "sc_inspection_id, inspection_id, project_id required" });
    }

    log("import_results", `Importing inspection_id=${inspection_id}`);

    // 1. Fetch inspection details for pass/fail/engineer
    let status = "completed";
    let score_pct: number | null = null;
    let engineer_name: string | null = null;
    let date_completed: string | null = null;
    let result: string | null = null;

    const detailsR = await fetch(`${SC_BASE}/inspections/v1/inspections/${inspection_id}/details`, {
      headers: authHeaders,
    }).catch(() => null);

    if (detailsR?.ok) {
      const d = await detailsR.json().catch(() => ({}));
      const insp = d.inspection ?? d;
      score_pct = insp.score_percentage ?? insp.score ?? null;
      engineer_name = insp.modified_by?.name ?? insp.owner_name ?? null;
      date_completed = insp.date_completed ?? insp.completed_at ?? null;
      status = date_completed ? "completed" : "in_progress";
      if (score_pct !== null && score_pct > 0) result = score_pct >= 80 ? "pass" : "fail";
    } else {
      // Fallback to legacy
      const auditId = inspection_id.replace("insp_", "audit_");
      const legacyR = await fetch(`${SC_BASE}/audits/${auditId}`, { headers: authHeaders }).catch(() => null);
      if (legacyR?.ok) {
        const d = await legacyR.json().catch(() => ({}));
        date_completed = d.audit_data?.date_completed ?? null;
        score_pct = d.audit_data?.score_percentage ?? null;
        engineer_name = d.audit_data?.modified_by?.name ?? null;
        status = date_completed ? "completed" : "in_progress";
        if (score_pct !== null && score_pct > 0) result = score_pct >= 80 ? "pass" : "fail";
      }
    }

    // 2. Export PDF
    let pdf_url: string | null = null;
    const exportR = await fetch(`${SC_BASE}/inspection/v1/export`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        export_data: [{ inspection_id }],
        type: "DOCUMENT_TYPE_PDF",
      }),
    }).catch(() => null);

    if (exportR?.ok) {
      const exportData = await exportR.json().catch(() => null);
      let rawUrl = exportData?.status === "STATUS_DONE" ? exportData.url : null;

      if (!rawUrl && exportData?.status === "STATUS_IN_PROGRESS") {
        await new Promise(r => setTimeout(r, 4000));
        const retry = await fetch(`${SC_BASE}/inspection/v1/export`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ export_data: [{ inspection_id }], type: "DOCUMENT_TYPE_PDF" }),
        }).catch(() => null);
        if (retry?.ok) {
          const rd = await retry.json().catch(() => null);
          if (rd?.status === "STATUS_DONE") rawUrl = rd.url;
        }
      }

      if (rawUrl) {
        // Download and re-upload to our storage
        const pdfRes = await fetch(rawUrl).catch(() => null);
        if (pdfRes?.ok) {
          const buf = await pdfRes.arrayBuffer();
          const path = `commissioning/${project_id}/sc_${inspection_id}_${Date.now()}.pdf`;
          const { error: upErr } = await db.storage
            .from("om-uploads")
            .upload(path, buf, { contentType: "application/pdf", upsert: false });
          if (!upErr) {
            const { data: { publicUrl } } = db.storage.from("om-uploads").getPublicUrl(path);
            pdf_url = publicUrl;
            log("import_results", `PDF uploaded: ${pdf_url}`);
          } else {
            log("import_results", `PDF upload failed: ${upErr.message}`);
          }
        }
      }
    }

    // 3. Update sc_inspections row
    const { error: dbErr } = await db
      .from("sc_inspections")
      .update({
        status,
        result,
        score_pct,
        engineer_name,
        completion_date: date_completed,
        pdf_url,
        imported_at: new Date().toISOString(),
      })
      .eq("id", sc_inspection_id);

    if (dbErr) {
      log("import_results", `DB update failed: ${dbErr.message}`);
      return json({ error: "DB update failed: " + dbErr.message });
    }

    return json({ ok: true, status, result, score_pct, engineer_name, date_completed, pdf_url });
  }

  // ── import_inspection (legacy PDF-only import) ────────────────────────────────
  if (action === "import_inspection") {
    const { audit_id, project_id, section, file_name } = body;
    if (!audit_id || !project_id || !section || !file_name) {
      return json({ error: "audit_id, project_id, section, file_name required" });
    }

    let pdfUrl: string | null = null;

    const exportRes = await fetch(`${SC_BASE}/inspection/v1/export`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        export_data: [{ inspection_id: audit_id }],
        type: "DOCUMENT_TYPE_PDF",
      }),
    }).catch(() => null);

    if (exportRes?.ok) {
      const exportData = await exportRes.json().catch(() => null);
      if (exportData?.status === "STATUS_DONE" && exportData?.url) {
        pdfUrl = exportData.url;
      } else if (exportData?.status === "STATUS_IN_PROGRESS") {
        await new Promise(r => setTimeout(r, 3000));
        const retry = await fetch(`${SC_BASE}/inspection/v1/export`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ export_data: [{ inspection_id: audit_id }], type: "DOCUMENT_TYPE_PDF" }),
        }).catch(() => null);
        if (retry?.ok) {
          const retryData = await retry.json().catch(() => null);
          if (retryData?.status === "STATUS_DONE" && retryData?.url) pdfUrl = retryData.url;
        }
      }
    }

    if (!pdfUrl) {
      for (const url of [`${SC_BASE}/audits/v1/audits/${audit_id}/export.pdf`, `${SC_BASE}/audits/${audit_id}/export.pdf`]) {
        try {
          const r = await fetch(url, { headers: { Authorization: `Bearer ${scToken}` } });
          if (r.ok) {
            const ct = r.headers.get("content-type") ?? "";
            if (ct.includes("pdf") || ct.includes("octet")) {
              const buffer = await r.arrayBuffer();
              const path = `handover/${project_id}/sc_${audit_id}_${Date.now()}.pdf`;
              const { error: upErr } = await db.storage.from("om-uploads").upload(path, buffer, { contentType: "application/pdf", upsert: false });
              if (upErr) return json({ error: "Storage upload failed: " + upErr.message });
              const { data: { publicUrl } } = db.storage.from("om-uploads").getPublicUrl(path);
              const { data: row, error: dbErr } = await db.from("om_pack_uploads")
                .insert({ project_id, section, file_name, file_url: publicUrl }).select().single();
              if (dbErr) return json({ error: "DB insert failed: " + dbErr.message });
              return json({ ok: true, record: row });
            }
          }
        } catch { /* try next */ }
      }
      return json({ error: "Could not export PDF from SafetyCulture. Ensure the inspection is complete and your account has PDF export access." });
    }

    const pdfRes = await fetch(pdfUrl).catch(() => null);
    if (!pdfRes?.ok) return json({ error: "Failed to download exported PDF from SafetyCulture" });
    const pdfBuffer = await pdfRes.arrayBuffer();

    const path = `handover/${project_id}/sc_${audit_id}_${Date.now()}.pdf`;
    const { error: upErr } = await db.storage.from("om-uploads").upload(path, pdfBuffer, { contentType: "application/pdf", upsert: false });
    if (upErr) return json({ error: "Storage upload failed: " + upErr.message });

    const { data: { publicUrl } } = db.storage.from("om-uploads").getPublicUrl(path);
    const { data: row, error: dbErr } = await db.from("om_pack_uploads")
      .insert({ project_id, section, file_name, file_url: publicUrl }).select().single();
    if (dbErr) return json({ error: "DB insert failed: " + dbErr.message });
    return json({ ok: true, record: row });
  }

  return json({ error: `Unknown action: ${action}` });
});
