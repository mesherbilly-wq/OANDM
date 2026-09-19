import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VALID_SYSTEM_TYPES = ["CCTV", "Access Control", "Intercom", "Intruder", "Networking", "Fire"];

const PROMPT = `You are extracting a security / fire project from quote, proposal, or specification documents so it can be imported the same way as a Simpro job.

Return ONLY a valid JSON object — no markdown, no explanation, no code fences.

Do NOT write method statements, risk assessments, RAMS, commissioning packs, asset registers, O&M packs, or handover certificates. Capture the data that is already in the documents.

Required JSON structure:
{
  "project_name": "concise project name (derive from client + site if not explicit)",
  "client_name": "client or customer company name, null if unknown",
  "site_name": "site or building name, null if unknown",
  "site_address": "full site address if present, null if unknown",
  "job_number": "job number if present, else null",
  "quote_number": "quote or tender number if present, else null",
  "project_number": "project number if present, else null",
  "project_manager": "project manager name if mentioned, else null",
  "engineer": "engineer name if mentioned, else null",
  "project_notes": "short factual notes from the documents, else null",
  "scope_of_works": "<p>HTML of the customer scope / description using the source wording</p>",
  "system_types": ["CCTV"],
  "devices": [
    {
      "system_type": "CCTV",
      "device_type": "IP Camera",
      "manufacturer": "Hikvision",
      "model_number": "DS-2CD2347G2-LU",
      "model_name": "4MP ColorVu Dome",
      "quantity": 10,
      "location": "Car Park Level 1",
      "notes": "IR 60m"
    }
  ]
}

Rules:
- system_type should be CCTV, Access Control, Intercom, Intruder, Networking, or Fire when that is clearly the install type; otherwise use the document section / cost centre name
- Extract EVERY product / equipment line — cameras, recorders, panels, readers, intercoms, sensors, switches, power supplies, and named materials
- Do not import labour, prelims, sundries, attendance, VAT, profit, or commercial cost-only lines
- quantity must be an integer (default 1 if not specified)
- Use null for any field that cannot be determined from the documents
- scope_of_works must be HTML (p, ul, ol, li, h2, h3, strong) that keeps the source wording and layout
- Do not put equipment schedules, part lists, prices, rates, VAT, or totals in scope_of_works
- If source HTML is provided, follow that structure; do not invent extra sections
- If multiple documents are provided, merge their information intelligently`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let documents: { name: string; content: string }[];
  try {
    const body = await req.json();
    documents = body.documents;
    if (!Array.isArray(documents) || documents.length === 0) throw new Error("no documents");
  } catch {
    return new Response(
      JSON.stringify({ error: "Request body must contain a non-empty documents array." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Combine all document texts, capped at ~120k chars total
  const MAX_CHARS = 120_000;
  let combined = "";
  for (const doc of documents) {
    const header = `\n\n--- Document: ${doc.name} ---\n`;
    const remaining = MAX_CHARS - combined.length - header.length;
    if (remaining <= 0) break;
    combined += header + String(doc.content ?? "").slice(0, remaining);
    const html = typeof doc.html === "string" ? doc.html.trim() : "";
    if (!html) continue;
    const htmlHeader = "\n\n[Source HTML for layout — copy wording and structure into scope_of_works]\n";
    const htmlRemaining = MAX_CHARS - combined.length - htmlHeader.length;
    if (htmlRemaining <= 0) break;
    combined += htmlHeader + html.slice(0, htmlRemaining);
  }

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
        messages: [
          {
            role: "user",
            content: PROMPT + "\n\nDocument content:\n" + combined,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error("Claude API error " + claudeRes.status + ": " + errBody);
    }

    const claudeJson = await claudeRes.json();
    const rawText: string = claudeJson.content?.[0]?.text ?? "{}";

    // Strip markdown fences
    const fence = String.fromCharCode(96, 96, 96);
    const cleaned = rawText
      .replace(new RegExp(fence + "json\\s*", "gi"), "")
      .replace(new RegExp(fence + "\\s*", "gi"), "")
      .trim();

    const extracted = JSON.parse(cleaned);

    // Sanitise system_types
    if (Array.isArray(extracted.system_types)) {
      extracted.system_types = extracted.system_types.filter((s: string) =>
        VALID_SYSTEM_TYPES.includes(s)
      );
    } else {
      extracted.system_types = [];
    }

    // Sanitise devices — keep the source section name when it is not a known install type
    if (Array.isArray(extracted.devices)) {
      extracted.devices = extracted.devices.map((d: any) => ({
        system_type: d.system_type ?? null,
        device_type: d.device_type ?? d.model_name ?? "Device",
        manufacturer: d.manufacturer ?? null,
        model_number: d.model_number ?? null,
        model_name: d.model_name ?? d.device_type ?? null,
        quantity: typeof d.quantity === "number" && d.quantity > 0 ? Math.round(d.quantity) : 1,
        location: d.location ?? null,
        notes: d.notes ?? null,
      }));
    } else {
      extracted.devices = [];
    }

    return new Response(JSON.stringify(extracted), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "AI extraction failed: " + e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
