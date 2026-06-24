import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VALID_SYSTEM_TYPES = ["CCTV", "Access Control", "Intercom", "Intruder", "Networking"];

const PROMPT = `You are analysing security integration project documents (quotes, proposals, scope of works, design specifications).

Extract all relevant project information and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

Required JSON structure:
{
  "project_name": "concise project name (derive from client + site if not explicit)",
  "client_name": "client or customer company name, null if unknown",
  "site_name": "site address or building name, null if unknown",
  "project_manager": "project manager name if mentioned, else null",
  "project_summary": "2-3 sentences describing the project scope and objectives",
  "system_types": ["CCTV"],
  "devices": [
    {
      "system_type": "CCTV",
      "device_type": "IP Camera",
      "manufacturer": "Hikvision",
      "model_number": "DS-2CD2347G2-LU",
      "quantity": 10,
      "location": "Car Park Level 1",
      "notes": "4MP ColorVu, IR 60m"
    }
  ]
}

Rules:
- system_types must only contain values from: CCTV, Access Control, Intercom, Intruder, Networking
- Each device's system_type must also be one of those five values
- Extract EVERY device/equipment item mentioned — cameras, recorders, access panels, readers, intercoms, sensors, switches, power supplies if itemised
- quantity must be an integer (default 1 if not specified)
- Use null for any field that cannot be determined from the documents
- Be thorough — extract all line items from schedules, bill of materials, and equipment lists
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
    combined += header + doc.content.slice(0, remaining);
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

    // Sanitise devices
    if (Array.isArray(extracted.devices)) {
      extracted.devices = extracted.devices.map((d: any) => ({
        system_type: VALID_SYSTEM_TYPES.includes(d.system_type) ? d.system_type : "CCTV",
        device_type: d.device_type ?? "Device",
        manufacturer: d.manufacturer ?? null,
        model_number: d.model_number ?? null,
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
