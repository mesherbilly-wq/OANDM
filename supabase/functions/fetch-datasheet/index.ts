import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/pdf,application/octet-stream;q=0.9,text/html;q=0.8,*/*;q=0.7",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isPdf(bytes: Uint8Array): boolean {
  const start = Math.min(bytes.byteLength, 16);
  const header = new TextDecoder("latin1").decode(bytes.slice(0, start)).trimStart();
  return header.startsWith("%PDF");
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const sample = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 800)).trimStart().toLowerCase();
  return sample.startsWith("<!doctype") || sample.startsWith("<html") || sample.includes("<head");
}

function extractPdfUrl(html: string, baseUrl: string): string | null {
  const patterns = [
    /href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
    /content\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
    /src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      const resolved = new URL(match[1].replace(/&amp;/g, "&"), baseUrl).href;
      if (/^https?:\/\//i.test(resolved)) return resolved;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const origin = new URL(url).origin;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { ...BROWSER_HEADERS, Referer: `${origin}/` },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching PDF`);
    const contentLength = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_PDF_BYTES) throw new Error("PDF exceeds 30 MB size limit");
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_BYTES) throw new Error("PDF exceeds 30 MB size limit");
    return { bytes: new Uint8Array(buffer), finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadPdf(url: string, manufacturer: string, model: string): Promise<Uint8Array> {
  try {
    return await downloadPdfFromUrl(url);
  } catch (firstError) {
    const fallbacks = await fallbackDatasheetUrls(manufacturer, model);
    for (const fallback of fallbacks) {
      if (fallback === url) continue;
      try {
        return await downloadPdfFromUrl(fallback);
      } catch {
        continue;
      }
    }
    throw firstError;
  }
}

async function downloadPdfFromUrl(url: string): Promise<Uint8Array> {
  const first = await fetchBytes(url);
  if (isPdf(first.bytes)) return first.bytes;

  if (looksLikeHtml(first.bytes)) {
    const html = new TextDecoder("utf-8", { fatal: false }).decode(first.bytes.slice(0, 250_000));
    const nested = extractPdfUrl(html, first.finalUrl);
    if (nested && nested !== url) {
      const second = await fetchBytes(nested);
      if (isPdf(second.bytes)) return second.bytes;
    }
  }

  throw new Error("URL does not point to a valid PDF file");
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function modelSlug(model: string): string {
  return model.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9.-]+/g, "");
}

async function fallbackDatasheetUrls(manufacturer: string, model: string): Promise<string[]> {
  const slug = modelSlug(model);
  const pages: string[] = [];
  if (slug && manufacturer.toLowerCase().includes("axis")) {
    pages.push(`https://www.axis.com/products/axis-${slug}/support`);
    pages.push(`https://www.axis.com/products/axis-${slug}`);
  }
  const urls: string[] = [];
  for (const page of pages) {
    urls.push(...await scrapeDatasheetPdfUrls(page, model));
  }
  urls.push(...await adiDatasheetUrls(manufacturer, model));
  return [...new Set(urls)].slice(0, 6);
}

async function adiDatasheetUrls(manufacturer: string, model: string): Promise<string[]> {
  const origins = [
    "https://www.adiglobaldistribution.co.uk",
    "https://www.adiglobaldistribution.com",
  ];
  const modelKey = compact(model);
  const urls: string[] = [];
  const queries = uniqueStrings([
    model.trim(),
    `${manufacturer} ${model}`.replace(/\s+/g, " ").trim(),
  ].filter((query) => query.length >= 3));

  for (const origin of origins) {
    try {
      const products: any[] = [];
      for (const query of queries) {
        const res = await fetch(
          `${origin}/api/v1/products?query=${encodeURIComponent(query)}&pageSize=48`,
          { headers: { ...BROWSER_HEADERS, Accept: "application/json", Referer: `${origin}/` }, redirect: "follow" },
        );
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json?.products)) products.push(...json.products);
        }
        const acRes = await fetch(
          `${origin}/api/v1/autocomplete?query=${encodeURIComponent(query)}`,
          { headers: { ...BROWSER_HEADERS, Accept: "application/json", Referer: `${origin}/` }, redirect: "follow" },
        );
        if (acRes.ok) {
          const acJson = await acRes.json();
          if (Array.isArray(acJson?.products)) products.push(...acJson.products);
        }
      }
      const matched = products.filter((product) => adiFetchProductMatches(product, modelKey)).slice(0, 4);
      for (const product of matched) {
        const detail = await adiFetchProductDetail(origin, product);
        const docs = Array.isArray(detail?.documents) ? detail.documents : [];
        for (const doc of docs) {
          const raw = String(doc?.fileUrl || doc?.filePath || "");
          let url = raw;
          if (raw && !/^https?:\/\//i.test(raw) && /pim\//i.test(raw)) {
            url = `https://cdn.adiglobaldistribution.co.uk${raw.startsWith("/") ? raw : `/${raw}`}`;
          }
          const hay = `${doc?.name ?? ""} ${doc?.documentType ?? ""} ${url}`;
          if (/product-data-sheet|data[- ]?sheet|product manual/i.test(hay) && /\.pdf(\?|#|$)/i.test(url)) {
            urls.push(url);
          }
        }
      }
      if (urls.length > 0) break;
    } catch {
      // Try the next ADI origin.
    }
  }
  return urls;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function adiFetchIdentityKeys(product: any): string[] {
  return uniqueStrings([
    product?.modelNumber,
    product?.manufacturerItem,
    product?.manufacturerItemNumber,
    product?.erpNumber,
    product?.urlSegment,
    product?.sku,
  ].map((value) => compact(String(value || ""))).filter((value) => value.length >= 4));
}

function adiFetchProductMatches(product: any, modelKey: string): boolean {
  if (!modelKey) return false;
  const keys = adiFetchIdentityKeys(product);
  if (keys.some((key) => key === modelKey || (modelKey.length >= 5 && key.includes(modelKey)) || (key.length >= 5 && modelKey.includes(key)))) {
    return true;
  }
  const name = product?.name || product?.productTitle || "";
  if (/\b(bracket|mount|shield|casing|spare|injector|armature|housing)\b/i.test(name)) return false;
  return compact(name).includes(modelKey);
}

async function adiFetchProductDetail(origin: string, product: any): Promise<any | null> {
  const ids = uniqueStrings([product?.id, product?.erpNumber, product?.manufacturerItemNumber, product?.urlSegment].map((value) => String(value || "")));
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    const detailRes = await fetch(`${origin}/api/v1/products/${id}?expand=documents`, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json", Referer: `${origin}/` },
      redirect: "follow",
    });
    if (!detailRes.ok) continue;
    const detailJson = await detailRes.json();
    const detail = detailJson?.product ?? detailJson;
    if (Array.isArray(detail?.documents) && detail.documents.length > 0) return detail;
  }
  const part = String(product?.erpNumber || product?.manufacturerItemNumber || product?.urlSegment || "").trim();
  if (!part) return null;
  const listedRes = await fetch(
    `${origin}/api/v1/products?query=${encodeURIComponent(part)}&pageSize=8`,
    { headers: { ...BROWSER_HEADERS, Accept: "application/json", Referer: `${origin}/` }, redirect: "follow" },
  );
  if (!listedRes.ok) return null;
  const listedJson = await listedRes.json();
  const listed = (listedJson?.products || []).find((item: any) => compact(item?.erpNumber || "") === compact(part) && item?.id);
  if (!listed?.id) return null;
  const detailRes = await fetch(`${origin}/api/v1/products/${listed.id}?expand=documents`, {
    headers: { ...BROWSER_HEADERS, Accept: "application/json", Referer: `${origin}/` },
    redirect: "follow",
  });
  if (!detailRes.ok) return null;
  const detailJson = await detailRes.json();
  return detailJson?.product ?? detailJson;
}

async function scrapeDatasheetPdfUrls(pageUrl: string, model: string): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": BROWSER_HEADERS["User-Agent"],
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const html = await res.text();
    const modelKey = compact(model);
    const datasheets: string[] = [];
    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
      let url = "";
      try {
        url = new URL(match[1].replace(/&amp;/g, "&"), pageUrl).href;
      } catch {
        continue;
      }
      if (!/\.pdf(\?|#|$)/i.test(url)) continue;
      if (modelKey && !compact(url).includes(modelKey) && !/adiglobaldistribution/i.test(url)) continue;
      if (/datasheet|data-sheet/i.test(url)) datasheets.push(url);
    }
    return [...new Set(datasheets)];
  } catch {
    return [];
  }
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function saveDatasheetRow(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  existingId: number | string | null,
) {
  const write = existingId
    ? () => supabase.from("datasheets").update(payload).eq("id", existingId).select().single()
    : () => supabase.from("datasheets").insert(payload).select().single();
  return await write();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json(503, { error: "Supabase credentials not configured" });
    }

    const { url, manufacturer, model, source, score } = await req.json();
    if (!url || !manufacturer || !model) {
      return json(400, { error: "url, manufacturer and model are required" });
    }

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await downloadPdf(String(url), String(manufacturer).trim(), String(model).trim());
    } catch (e: any) {
      return json(200, { error: "Failed to download PDF: " + (e?.message ?? "unknown error") });
    }

    const manufacturerName = String(manufacturer).trim();
    const modelNumber = String(model).trim();
    const safeMfr = manufacturerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const safeMdl = modelNumber.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
    const hitScore = Number(score);
    const fromAdi = source === "adi";
    const fromAi = source === "ai" && Number.isFinite(hitScore);
    const fileName = fromAdi
      ? `adi-placed-${Number.isFinite(hitScore) ? Math.round(hitScore) : 93}_${safeMfr || "manufacturer"}_${safeMdl || "model"}_datasheet.pdf`
      : fromAi
      ? `ai-placed-${Math.round(hitScore)}_${safeMfr || "manufacturer"}_${safeMdl || "model"}_datasheet.pdf`
      : `${safeMfr || "manufacturer"}_${safeMdl || "model"}_datasheet.pdf`;
    const storagePath = `${safeMfr || "manufacturer"}/${safeMdl || "model"}/${Date.now()}_${fileName}`;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { error: uploadError } = await supabase.storage
      .from("user-datasheets")
      .upload(storagePath, new Blob([pdfBytes], { type: "application/pdf" }), {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return json(200, { error: "Storage upload failed: " + uploadError.message });
    }

    const { data: publicUrlData } = supabase.storage.from("user-datasheets").getPublicUrl(storagePath);
    const publicUrl = publicUrlData.publicUrl;
    const payload = {
      manufacturer: manufacturerName,
      model_number: modelNumber,
      file_name: fileName,
      datasheet_url: publicUrl,
    };

    const { data: existing } = await supabase
      .from("datasheets")
      .select("id")
      .ilike("manufacturer", escapeIlike(manufacturerName))
      .ilike("model_number", escapeIlike(modelNumber))
      .limit(1)
      .maybeSingle();

    const save = await saveDatasheetRow(supabase, payload, existing?.id ?? null);

    if (save.error || !save.data) {
      return json(200, { error: "Database save failed: " + (save.error?.message ?? "unknown error") });
    }

    await supabase
      .from("devices")
      .update({ datasheet_found: true })
      .ilike("manufacturer", escapeIlike(manufacturerName))
      .ilike("model_number", escapeIlike(modelNumber));

    return json(200, {
      publicUrl,
      datasheet: save.data,
      fileName,
      sizeKb: Math.round(pdfBytes.byteLength / 1024),
    });
  } catch (e: any) {
    return json(200, { error: e?.message ?? "Could not attach datasheet" });
  }
});
