import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PROMPT = [
  "You are analysing a security system drawing, floor plan, or schedule.",
  "Extract every device reference and return ONLY a valid JSON object — no markdown, no explanation, no code fences.",
  "",
  "Required JSON structure:",
  '{',
  '  "project_name": null,',
  '  "client_name": null,',
  '  "site_name": null,',
  '  "project_manager": null,',
  '  "project_summary": "Extracted from drawing",',
  '  "devices": [',
  '    {',
  '      "system_type": "CCTV",',
  '      "device_type": "Camera",',
  '      "manufacturer": null,',
  '      "model_number": null,',
  '      "quantity": 1,',
  '      "location": null,',
  '      "notes": null,',
  '      "confidence": 0.9',
  '    }',
  '  ]',
  '}',
  "",
  "Rules:",
  "- system_type must be one of: CCTV, Access Control, Intercom, Intruder, Networking",
  "- Extract every camera, door contact, access reader, motion detector, intercom, switch, recorder etc.",
  "- Each individual device symbol on the drawing = one entry with quantity 1",
  "- If a schedule or legend lists a total quantity, use that as quantity",
  "- If you find title block info (client name, site, project), populate those fields",
  "- Return [] for devices if no devices found",
].join("\n");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let file_url: string;
  let media_type = "application/pdf";
  try {
    const body = await req.json();
    file_url = body.file_url;
    if (body.media_type) media_type = body.media_type;
    if (!file_url) throw new Error("missing file_url");
  } catch {
    return new Response(
      JSON.stringify({ error: "Request body must contain file_url" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let fileBase64: string;
  try {
    const fileRes = await fetch(file_url);
    if (!fileRes.ok) throw new Error("Fetch failed: " + fileRes.status);
    const buffer = await fileRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    fileBase64 = btoa(binary);
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "Could not download file: " + e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const isImage = media_type.startsWith("image/");
  const contentBlock = isImage
    ? { type: "image", source: { type: "base64", media_type, data: fileBase64 } }
    : { type: "document", source: { type: "base64", media_type, data: fileBase64 } };

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
        max_tokens: 8192,
        messages: [{ role: "user", content: [contentBlock, { type: "text", text: PROMPT }] }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error("Claude API error " + claudeRes.status + ": " + errBody);
    }

    const claudeJson = await claudeRes.json();
    const rawText: string = claudeJson.content?.[0]?.text ?? "{}";

    const fence = String.fromCharCode(96, 96, 96);
    const cleaned = rawText
      .replace(new RegExp(fence + "json\\s*", "gi"), "")
      .replace(new RegExp(fence + "\\s*", "gi"), "")
      .trim();

    const parsed = JSON.parse(cleaned);
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "AI processing failed: " + e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
