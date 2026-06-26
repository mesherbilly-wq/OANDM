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
}

async function verify(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DatasheetFinder/1.0)" },
      redirect: "follow",
    });
    clearTimeout(timer);
    const ct = res.headers.get("content-type") ?? "";
    return res.ok && (ct.includes("pdf") || url.toLowerCase().includes(".pdf"));
  } catch {
    return url.toLowerCase().includes(".pdf");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { manufacturer, model } = await req.json();
  if (!manufacturer || !model) {
    return new Response(
      JSON.stringify({ error: "manufacturer and model are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const prompt = `You are a technical product researcher. Find datasheet PDF URLs for this security/AV/IT equipment product.

Manufacturer: ${manufacturer}
Model: ${model}

Your task:
1. Return direct PDF download URLs you know with confidence from your training data
2. Include the official manufacturer product/datasheet page
3. Include major distributor pages (RS Components, Farnell, Digi-Key, Anixter, etc.) if you know them
4. Prefer URLs ending in .pdf when possible
5. Return ONLY URLs you are highly confident actually exist — do NOT invent or guess URLs
6. If you know the manufacturer's URL pattern (e.g. axis.com uses /files/datasheet/...) apply it

Return ONLY a JSON array, no explanation:
[{"url":"https://...","title":"descriptive title","domain":"domain.com"}]

If you have no confident URLs return: []`;

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

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return new Response(
      JSON.stringify({ error: "Claude API error: " + err.substring(0, 200) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const claudeJson = await claudeRes.json();
  const raw = claudeJson.content?.[0]?.text?.trim() ?? "[]";

  let candidates: Array<{ url: string; title: string; domain: string }> = [];
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    candidates = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    if (!Array.isArray(candidates)) candidates = [];
  } catch {
    candidates = [];
  }

  const verified: Candidate[] = await Promise.all(
    candidates.slice(0, 6).map(async (c) => ({
      url: c.url,
      title: c.title || c.url,
      domain: c.domain || new URL(c.url).hostname.replace("www.", ""),
      verified: await verify(c.url),
    })),
  );

  verified.sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));

  return new Response(JSON.stringify({ candidates: verified }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
