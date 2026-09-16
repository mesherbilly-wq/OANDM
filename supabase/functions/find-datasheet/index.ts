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
  const header = await pdfHeader(url, true) ?? await pdfHeader(url, false);
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
    return new TextDecoder("latin1").decode(new Uint8Array(await res.arrayBuffer()).slice(0, 16)).trimStart();
  } catch {
    return null;
  }
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
    const adiVerified = adiChecked.filter((c) => c.verified && isAdiDatasheetUrl(c.url));
    if (adiVerified.length > 0) {
      adiVerified.sort((a, b) => (b.score - a.score) || (b.verified ? 1 : 0) - (a.verified ? 1 : 0));
      return new Response(JSON.stringify({ candidates: adiVerified, source: "adi" }), {
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
  candidate: { url?: string; title?: string },
  manufacturer: string,
  model: string,
  verified: boolean,
  claudeScore: number | null,
): number {
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
};

type AdiHit = { url: string; title: string; domain: string; score: number | null; source?: string };

async function searchAdiDatasheets(manufacturer: string, model: string): Promise<AdiHit[]> {
  const hits: AdiHit[] = [];
  for (const origin of ADI_ORIGINS) {
    hits.push(...await searchAdiOrigin(origin, manufacturer, model));
    if (hits.some((hit) => isAdiDatasheetUrl(hit.url))) break;
  }
  return uniqueByUrl(hits);
}

async function searchAdiOrigin(origin: string, manufacturer: string, model: string): Promise<AdiHit[]> {
  const products = await adiSearchProducts(origin, `${manufacturer} ${model}`);
  const matched = products.filter((product) => adiProductMatches(product, model)).slice(0, 3);
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
    .filter((product) => adiProductMatches(product, model) || compact(product.urlSegment || "") === compact(segment));
  const hits: AdiHit[] = [];
  for (const product of products.slice(0, 2)) {
    hits.push(...await adiDocumentsForProduct(origin, product, model));
  }
  return hits;
}

async function adiSearchProducts(origin: string, query: string): Promise<AdiProduct[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(
      `${origin}/api/v1/products?query=${encodeURIComponent(query)}&pageSize=12`,
      { signal: ctrl.signal, headers: BROWSER_HEADERS, redirect: "follow" },
    );
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.products) ? json.products : [];
  } catch {
    return [];
  }
}

async function adiDocumentsForProduct(origin: string, product: AdiProduct, model: string): Promise<AdiHit[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${origin}/api/v1/products/${product.id}?expand=documents`, {
      signal: ctrl.signal,
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = await res.json();
    const detail = json?.product ?? json;
    const docs = Array.isArray(detail?.documents) ? detail.documents : [];
    const hits: AdiHit[] = [];
    for (const doc of docs) {
      const url = String(doc?.fileUrl || doc?.filePath || "");
      if (!/^https?:\/\//i.test(url) || !/\.pdf(\?|#|$)/i.test(url)) continue;
      if (!isAdiDatasheetDoc(doc, url) && /assembly|install|brochure|user manual|msds|instruction/i.test(`${doc?.name ?? ""} ${doc?.documentType ?? ""} ${url}`)) continue;
      hits.push({
        url,
        title: `${product.name || model} — ${doc?.name || "Datasheet"}`,
        domain: safeDomain(url) || safeDomain(origin),
        score: isAdiDatasheetDoc(doc, url) ? 93 : 82,
        source: "adi",
      });
    }
    return hits;
  } catch {
    return [];
  }
}

type AdiProduct = {
  id?: string;
  name?: string;
  modelNumber?: string;
  manufacturerItem?: string;
  urlSegment?: string;
  properties?: Record<string, string>;
};

function adiProductMatches(product: AdiProduct, model: string): boolean {
  const modelKey = compact(model);
  if (!modelKey || !product?.id) return false;
  const modelNumber = compact(product.modelNumber || product.properties?.updated_Model_Number || "");
  if (modelNumber && modelNumber === modelKey) return true;
  const name = product.name || "";
  if (isAccessoryName(name)) return false;
  return compact(name).includes(modelKey);
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
