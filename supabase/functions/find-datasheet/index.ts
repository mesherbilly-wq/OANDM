import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Candidate {
  url: string;
  title: string;
  domain: string;
  verified: boolean;
  score: number;
  source?: string;
}

async function verify(url: string): Promise<boolean> {
  if (/adiglobaldistribution/i.test(url) && isAdiDatasheetUrl(url)) return true;
  const adiCdn = /adiglobaldistribution/i.test(url);
  const header = adiCdn
    ? await pdfHeader(url, false)
    : await pdfHeader(url, true) ?? await pdfHeader(url, false);
  return Boolean(header?.startsWith("%PDF"));
}

async function pdfHeader(url: string, useRange: boolean): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    };
    if (useRange) headers.Range = "bytes=0-15";
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok && res.status !== 206) return null;
    return (await peekBytes(res, 16)).trimStart();
  } catch {
    return null;
  }
}

async function peekBytes(res: Response, maxBytes: number): Promise<string> {
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (received < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        received += value.byteLength;
      }
    } finally {
      try { await reader.cancel(); } catch { /* ignore */ }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk.subarray(0, Math.min(chunk.byteLength, maxBytes - offset)), offset);
      offset += Math.min(chunk.byteLength, maxBytes - offset);
      if (offset >= maxBytes) break;
    }
    return new TextDecoder("latin1").decode(merged);
  }
  return new TextDecoder("latin1").decode(new Uint8Array(await res.arrayBuffer()).slice(0, maxBytes));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { manufacturer, model } = await req.json();
    if (!manufacturer || !model) {
      return new Response(
        JSON.stringify({ error: "manufacturer and model are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adiHits = await searchAdiDatasheets(manufacturer, model);
    const adiChecked = await verifyCandidates(adiHits, manufacturer, model);
    const adiDatasheets = adiChecked
      .filter((c) => c.source === "adi" && isAdiDatasheetHit(c))
      .map((c) => ({
        ...c,
        verified: c.verified || isAdiDatasheetHit(c),
        score: Math.max(c.score, 93),
      }));
    if (adiDatasheets.length > 0) {
      adiDatasheets.sort((a, b) => (b.score - a.score) || (b.verified ? 1 : 0) - (a.verified ? 1 : 0));
      return new Response(JSON.stringify({ candidates: adiDatasheets, source: "adi" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiHits = await findWithClaude(manufacturer, model);
    const discovered: Array<{ url: string; title: string; domain: string; score: number | null; source?: string }> = [...adiHits];

    for (const hit of aiHits) {
      if (/\.pdf(\?|#|$)/i.test(hit.url)) discovered.push({ ...hit, source: "ai" });
    }

    const pagesToScrape = [
      ...aiHits.filter((hit) => !/\.pdf(\?|#|$)/i.test(hit.url)).map((hit) => hit.url),
      ...manufacturerPages(manufacturer, model),
    ];
    const scraped = await Promise.all(
      uniqueStrings(pagesToScrape).slice(0, 6).map((page) => scrapeDatasheetPdfUrls(page, model)),
    );
    for (const urls of scraped) {
      for (const url of urls) {
        discovered.push({
          url,
          title: `${manufacturer} ${model} datasheet`,
          domain: safeDomain(url),
          score: /datasheet|data-sheet/i.test(url) ? 94 : 80,
          source: /adiglobaldistribution/i.test(url) ? "adi" : "web",
        });
      }
    }

    const adiPages = uniqueStrings(aiHits.map((hit) => hit.url).filter((url) => adiProductSegment(url))).slice(0, 4);
    for (const page of adiPages) {
      discovered.push(...await adiDocumentsFromProductUrl(page, model));
    }

    const webHits = await webSearchPdfs(manufacturer, model);
    discovered.push(...webHits.map((hit) => ({ ...hit, score: null as number | null, source: "web" })));
    for (const hit of webHits) {
      if (adiProductSegment(hit.url)) {
        discovered.push(...await adiDocumentsFromProductUrl(hit.url, model));
      }
    }

    const uniqueSeeds = uniqueByUrl(discovered);
    const checked = await verifyCandidates(uniqueSeeds, manufacturer, model);
    checked.sort((a, b) => (b.score - a.score) || (b.verified ? 1 : 0) - (a.verified ? 1 : 0));
    const verifiedOnly = checked.filter((c) => c.verified);

    return new Response(JSON.stringify({ candidates: verifiedOnly.length > 0 ? verifiedOnly : checked.slice(0, 6) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message ?? "Datasheet search failed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function findWithClaude(
  manufacturer: string,
  model: string,
): Promise<Array<{ url: string; title: string; domain: string; score: number | null }>> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) return [];

  const prompt = `You are a technical product researcher. Find datasheet PDF URLs for this security/AV/IT equipment product.

Manufacturer: ${manufacturer}
Model: ${model}

Your task:
1. Return direct PDF download URLs you know with confidence from your training data
2. Include the official manufacturer product/datasheet page
3. Include major distributor pages, especially ADI Global Distribution UK (adiglobaldistribution.co.uk), plus RS Components, Farnell, Digi-Key and Anixter if you know them
4. Prefer URLs ending in .pdf when possible. ADI datasheets are often named Product-Data-Sheet.pdf on cdn.adiglobaldistribution.co.uk
5. Return ONLY URLs you are highly confident actually exist — do NOT invent or guess URLs
6. Do NOT invent Axis /dam/public hash paths, ADI PIM folder numbers, or other hashed CDN URLs. If you are not sure of the live PDF, return the official product, support, or ADI product page instead
7. Give each hit a score from 0 to 100 for how likely it is the official datasheet for THIS exact manufacturer and model. Use 90+ only when you are highly confident it is the correct model PDF.

Return ONLY a JSON array, no explanation:
[{"url":"https://...","title":"descriptive title","domain":"domain.com","score":92}]

If you have no confident URLs return: []`;

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!claudeRes.ok) return [];

    const claudeJson = await claudeRes.json();
    const raw = claudeJson.content?.[0]?.text?.trim() ?? "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c: { url?: string }) => typeof c?.url === "string")
      .map((c: { url: string; title?: string; domain?: string; score?: unknown }) => ({
        url: c.url,
        title: c.title || c.url,
        domain: c.domain || safeDomain(c.url),
        score: parseScore(c.score),
      }));
  } catch {
    return [];
  }
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

function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function verifyCandidates(
  seeds: Array<{ url: string; title: string; domain: string; score: number | null; source?: string }>,
  manufacturer: string,
  model: string,
): Promise<Candidate[]> {
  const checked = await Promise.all(
    uniqueByUrl(seeds).slice(0, 16).map(async (c) => {
      const verifiedPdf = await verify(c.url);
      return {
        url: c.url,
        title: c.title || c.url,
        domain: c.domain || safeDomain(c.url),
        verified: verifiedPdf,
        score: hitScore(c, manufacturer, model, verifiedPdf, c.score),
        source: c.source,
      };
    }),
  );
  return uniqueByUrl(checked);
}

function modelSlug(model: string): string {
  return model.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9.-]+/g, "");
}

function manufacturerPages(manufacturer: string, model: string): string[] {
  const slug = modelSlug(model);
  if (!slug) return [];
  const mfr = manufacturer.toLowerCase();
  if (mfr.includes("axis")) {
    return [
      `https://www.axis.com/products/axis-${slug}`,
      `https://www.axis.com/products/axis-${slug}/support`,
    ];
  }
  return [];
}

async function scrapeDatasheetPdfUrls(pageUrl: string, model: string): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const html = await res.text();
    const modelKey = compact(model);
    const datasheets: string[] = [];
    const others: string[] = [];
    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
      let href = match[1].replace(/&amp;/g, "&");
      let url = "";
      try {
        url = new URL(href, pageUrl).href;
      } catch {
        continue;
      }
      if (!/\.pdf(\?|#|$)/i.test(url)) continue;
      const compactUrl = compact(url);
      const adiCdn = /adiglobaldistribution/i.test(url);
      if (modelKey && !compactUrl.includes(modelKey) && !adiCdn) continue;
      if (/datasheet|data-sheet|product-data-sheet/i.test(url)) datasheets.push(url);
      else if (!/install|drill|dimension|declaration|mtbf|comparison|discontinu|assembly|brochure/i.test(url)) others.push(url);
    }
    return uniqueStrings([...datasheets, ...others]).slice(0, 5);
  } catch {
    return [];
  }
}

function parseScore(value: unknown): number | null {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hitScore(
  candidate: { url?: string; title?: string; source?: string },
  manufacturer: string,
  model: string,
  verified: boolean,
  claudeScore: number | null,
): number {
  if (candidate.source === "adi" && claudeScore != null) {
    return Math.max(verified ? claudeScore : 93, 93);
  }
  if (claudeScore != null) {
    return verified ? claudeScore : Math.min(claudeScore, 89);
  }
  const url = (candidate.url ?? "").toLowerCase();
  const hay = compact(`${candidate.url ?? ""} ${candidate.title ?? ""}`);
  const modelKey = compact(model);
  const mfrKey = compact(manufacturer);
  let score = 40;
  if (verified) score += 30;
  if (modelKey && hay.includes(modelKey)) score += 20;
  if (mfrKey && hay.includes(mfrKey)) score += 8;
  if (url.includes(".pdf")) score += 7;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function webSearchPdfs(
  manufacturer: string,
  model: string,
): Promise<Array<{ url: string; title: string; domain: string }>> {
  const queries = [
    `${manufacturer} ${model} datasheet filetype:pdf`,
    `site:adiglobaldistribution.co.uk ${manufacturer} ${model}`,
  ];
  const hits: Array<{ url: string; title: string; domain: string }> = [];
  for (const query of queries) {
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DatasheetFinder/1.0)" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const matches = html.matchAll(/uddg=([^&"]+)/g);
      for (const match of matches) {
        let url = "";
        try {
          url = decodeURIComponent(match[1]);
        } catch {
          continue;
        }
        if (!/^https?:\/\//i.test(url)) continue;
        if (hits.some((hit) => hit.url === url)) continue;
        hits.push({ url, title: `${manufacturer} ${model} datasheet`, domain: safeDomain(url) });
        if (hits.length >= 8) break;
      }
    } catch {
      // Try the next query.
    }
  }
  return hits;
}

const ADI_ORIGINS = [
  "https://www.adiglobaldistribution.co.uk",
  "https://www.adiglobaldistribution.com",
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};

const adiCookiesByOrigin = new Map<string, Map<string, string>>();

type AdiHit = { url: string; title: string; domain: string; score: number | null; source?: string };

async function searchAdiDatasheets(manufacturer: string, model: string): Promise<AdiHit[]> {
  const hits: AdiHit[] = [];
  for (const origin of ADI_ORIGINS) {
    hits.push(...await searchAdiOrigin(origin, manufacturer, model));
    if (hits.some((hit) => isAdiDatasheetHit(hit))) break;
  }
  return uniqueByUrl(hits);
}

async function searchAdiOrigin(origin: string, manufacturer: string, model: string): Promise<AdiHit[]> {
  const products = await adiFindProducts(origin, manufacturer, model);
  const matched = products
    .filter((product) => adiProductMatches(product, model))
    .sort((a, b) => adiMatchRank(b, model) - adiMatchRank(a, model))
    .slice(0, 4);
  const hits: AdiHit[] = [];
  for (const product of matched) {
    hits.push(...await adiDocumentsForProduct(origin, product, model));
  }
  return hits;
}

async function adiDocumentsFromProductUrl(pageUrl: string, model: string): Promise<AdiHit[]> {
  const origin = adiOriginFromUrl(pageUrl);
  const segment = adiProductSegment(pageUrl);
  if (!origin || !segment) return [];
  const products = (await adiSearchProducts(origin, segment))
    .filter((product) => adiProductMatches(product, model) || compact(adiPartNumber(product)) === compact(segment));
  const hits: AdiHit[] = [];
  for (const product of products.slice(0, 2)) {
    hits.push(...await adiDocumentsForProduct(origin, product, model));
  }
  return hits;
}

async function adiFindProducts(origin: string, manufacturer: string, model: string): Promise<AdiProduct[]> {
  const products: AdiProduct[] = [];
  for (const query of adiQueryVariants(manufacturer, model)) {
    products.push(...await adiSearchProducts(origin, query));
    products.push(...await adiAutocompleteProducts(origin, query));
    if (products.some((product) => adiProductMatches(product, model))) break;
  }
  return uniqueById(products);
}

function adiQueryVariants(manufacturer: string, model: string): string[] {
  const modelOnly = model.trim();
  const combined = `${manufacturer} ${model}`.replace(/\s+/g, " ").trim();
  const withoutMfr = manufacturer
    ? modelOnly.replace(new RegExp(`^${escapeRegExp(manufacturer)}\\s+`, "i"), "").trim()
    : modelOnly;
  return uniqueStrings([modelOnly, withoutMfr, combined].filter((query) => query.length >= 3));
}

async function adiSearchProducts(origin: string, query: string): Promise<AdiProduct[]> {
  const json = await adiJson(origin, `/api/v1/products?query=${encodeURIComponent(query)}&pageSize=48`);
  return Array.isArray(json?.products) ? json.products.map(normalizeAdiProduct) : [];
}

async function adiAutocompleteProducts(origin: string, query: string): Promise<AdiProduct[]> {
  const json = await adiJson(origin, `/api/v1/autocomplete?query=${encodeURIComponent(query)}`);
  return Array.isArray(json?.products) ? json.products.map(normalizeAdiProduct) : [];
}

async function adiDocumentsForProduct(origin: string, product: AdiProduct, model: string): Promise<AdiHit[]> {
  const detail = await adiProductDetail(origin, product);
  const docs = Array.isArray(detail?.documents) ? detail.documents : [];
  const hits: AdiHit[] = [];
  for (const doc of docs) {
    const url = adiAbsolutePdfUrl(doc?.fileUrl || doc?.filePath, origin);
    if (!url) continue;
    if (!isAdiDatasheetDoc(doc, url) && /assembly|install|brochure|user manual|msds|instruction/i.test(`${doc?.name ?? ""} ${doc?.documentType ?? ""} ${url}`)) continue;
    hits.push({
      url,
      title: `${detail?.name || product.name || model} — ${doc?.name || "Datasheet"}`,
      domain: safeDomain(url) || safeDomain(origin),
      score: isAdiDatasheetDoc(doc, url) ? 93 : 82,
      source: "adi",
    });
  }
  return hits;
}

async function adiProductDetail(origin: string, product: AdiProduct): Promise<AdiProduct | null> {
  if (product.id) {
    const json = await adiJson(origin, `/api/v1/products/${product.id}?expand=documents`);
    const detail = json?.product ?? json;
    if (detail?.id && Array.isArray(detail.documents) && detail.documents.length > 0) {
      return normalizeAdiProduct(detail);
    }
  }
  const part = adiPartNumber(product);
  if (!part) return null;
  const listed = (await adiSearchProducts(origin, part)).find((item) => compact(adiPartNumber(item)) === compact(part) && item.id);
  if (!listed?.id || listed.id === product.id) return null;
  const json = await adiJson(origin, `/api/v1/products/${listed.id}?expand=documents`);
  const detail = json?.product ?? json;
  return detail?.id ? normalizeAdiProduct(detail) : null;
}

async function adiJson(origin: string, path: string): Promise<any | null> {
  let res = await adiFetch(origin, path);
  if (!res || !isJsonResponse(res)) {
    await adiWarmup(origin);
    res = await adiFetch(origin, path);
  }
  if (!res || !isJsonResponse(res)) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function adiFetch(origin: string, path: string): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      Accept: "application/json",
      Referer: `${origin}/`,
    };
    const cookie = cookieHeader(origin);
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${origin}${path}`, {
      signal: ctrl.signal,
      headers,
      redirect: "follow",
    });
    clearTimeout(timer);
    rememberCookies(origin, res);
    return res;
  } catch {
    return null;
  }
}

async function adiWarmup(origin: string): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${origin}/`, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": BROWSER_HEADERS["User-Agent"],
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": BROWSER_HEADERS["Accept-Language"],
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    rememberCookies(origin, res);
  } catch {
    // Catalogue calls still run without the homepage cookies.
  }
}

function rememberCookies(origin: string, res: Response) {
  const jar = adiCookiesByOrigin.get(origin) ?? new Map<string, string>();
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  adiCookiesByOrigin.set(origin, jar);
}

function cookieHeader(origin: string): string {
  const jar = adiCookiesByOrigin.get(origin);
  if (!jar || jar.size === 0) return "";
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function isJsonResponse(res: Response): boolean {
  return res.ok && /json/i.test(res.headers.get("content-type") || "");
}

type AdiProduct = {
  id?: string;
  name?: string;
  modelNumber?: string;
  manufacturerItem?: string;
  erpNumber?: string;
  urlSegment?: string;
  sku?: string;
  documents?: Array<{ name?: string; documentType?: string; fileTypeString?: string; fileUrl?: string; filePath?: string }>;
  properties?: Record<string, string>;
};

function normalizeAdiProduct(raw: any): AdiProduct {
  return {
    id: raw?.id,
    name: raw?.name || raw?.productTitle || raw?.shortDescription || "",
    modelNumber: raw?.modelNumber || raw?.properties?.updated_Model_Number || "",
    manufacturerItem: raw?.manufacturerItem || raw?.manufacturerItemNumber || "",
    erpNumber: raw?.erpNumber || "",
    urlSegment: raw?.urlSegment || raw?.erpNumber || "",
    sku: raw?.sku || "",
    documents: Array.isArray(raw?.documents) ? raw.documents : [],
    properties: raw?.properties,
  };
}

function uniqueById(products: AdiProduct[]): AdiProduct[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    const key = String(product.id || adiPartNumber(product) || product.name || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function adiPartNumber(product: AdiProduct): string {
  return product.erpNumber || product.manufacturerItem || product.urlSegment || product.sku || "";
}

function adiIdentityKeys(product: AdiProduct): string[] {
  return uniqueStrings([
    product.modelNumber,
    product.properties?.updated_Model_Number,
    product.manufacturerItem,
    product.erpNumber,
    product.urlSegment,
    product.sku,
  ].map((value) => compact(value || "")).filter((value) => value.length >= 4));
}

function adiProductMatches(product: AdiProduct, model: string): boolean {
  const modelKey = compact(model);
  if (!modelKey || !(product?.id || adiPartNumber(product))) return false;
  const keys = adiIdentityKeys(product);
  if (keys.some((key) => key === modelKey || (modelKey.length >= 5 && key.includes(modelKey)) || (key.length >= 5 && modelKey.includes(key)))) {
    return true;
  }
  const name = product.name || "";
  if (isAccessoryName(name)) return false;
  return compact(name).includes(modelKey);
}

function adiMatchRank(product: AdiProduct, model: string): number {
  const modelKey = compact(model);
  const keys = adiIdentityKeys(product);
  if (keys.includes(modelKey)) return 3;
  if (keys.some((key) => key.includes(modelKey) || modelKey.includes(key))) return 2;
  if (isAccessoryName(product.name || "")) return 0;
  return 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAccessoryName(name: string): boolean {
  return /\b(bracket|mount|shield|casing|spare|injector|armature|housing|weathershield|junction box|for selected)\b/i.test(name);
}

function isAdiDatasheetDoc(doc: { name?: string; documentType?: string; fileTypeString?: string }, url: string): boolean {
  const hay = `${doc?.name ?? ""} ${doc?.documentType ?? ""} ${doc?.fileTypeString ?? ""} ${url}`;
  return /data[- ]?sheet|product manual|product-data-sheet/i.test(hay);
}

function isAdiDatasheetUrl(url: string): boolean {
  return /product-data-sheet|datasheet|data-sheet/i.test(url);
}

function isAdiDatasheetHit(candidate: { url?: string; title?: string; source?: string; score?: number }): boolean {
  if (candidate.source !== "adi" && !/adiglobaldistribution/i.test(candidate.url ?? "")) return false;
  if (isAdiDatasheetUrl(candidate.url ?? "")) return true;
  if ((candidate.score ?? 0) >= 90) return true;
  return /product manual|data[- ]?sheet/i.test(candidate.title ?? "");
}

function adiAbsolutePdfUrl(raw: unknown, origin: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    if (/^https?:\/\//i.test(value)) {
      return /\.pdf(\?|#|$)/i.test(value) ? value : null;
    }
    if (/pim\//i.test(value) || value.startsWith("/pim")) {
      const path = value.startsWith("/") ? value : `/${value}`;
      const cdn = `https://cdn.adiglobaldistribution.co.uk${path}`;
      return /\.pdf(\?|#|$)/i.test(cdn) ? cdn : null;
    }
    const resolved = new URL(value, origin).href;
    return /\.pdf(\?|#|$)/i.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function adiProductSegment(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/adiglobaldistribution\.(co\.uk|com)$/i.test(parsed.hostname.replace(/^www\./, ""))) return null;
    const match = parsed.pathname.match(/\/(?:Product|product)\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function adiOriginFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/adiglobaldistribution\.(co\.uk|com)$/i.test(parsed.hostname.replace(/^www\./, ""))) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
