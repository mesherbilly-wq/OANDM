import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

  const body = await req.json();
  const description = String(body.description ?? "").trim();
  const model = String(body.model ?? body.modelNumber ?? "").trim();
  const deviceType = String(body.deviceType ?? "").trim();

  if (!model) {
    return new Response(
      JSON.stringify({ error: "Model/part number required for AI manufacturer lookup." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const prompt = `You identify equipment manufacturers from product descriptions and model/part numbers for security, AV, IT, and building services equipment.

Given:
- Description: ${description || "unknown"}
- Model / part number: ${model}
- Device type: ${deviceType || "unknown"}

Return ONLY JSON with this shape:
{"manufacturer":"Official Manufacturer Name","confidence":0.85,"reason":"One short sentence explaining the match"}

Rules:
- Suggest the manufacturer brand name only (e.g. "Axis Communications", "Hikvision", "Paxton").
- Use confidence 0.0 to 1.0.
- reason must briefly explain why (e.g. "DS-2CD prefix is a Hikvision dome camera model series").
- If uncertain, use confidence below 0.6.
- If you cannot identify a manufacturer, return {"manufacturer":"","confidence":0,"reason":""}.`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 320,
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
  const raw = claudeJson.content?.[0]?.text?.trim() ?? "";

  let manufacturer = "";
  let confidence = 0;
  let reason = "";
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    manufacturer = String(parsed.manufacturer ?? "").trim();
    confidence = Number(parsed.confidence);
    reason = String(parsed.reason ?? "").trim();
    if (!Number.isFinite(confidence)) confidence = manufacturer ? 0.7 : 0;
  } catch {
    manufacturer = "";
    confidence = 0;
    reason = "";
  }

  if (!manufacturer) {
    return new Response(
      JSON.stringify({
        error: "AI could not identify a manufacturer for this model and description.",
      }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ manufacturer, confidence, reason }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
