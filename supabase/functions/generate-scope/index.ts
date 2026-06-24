import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Allowed URL schemes and block-list for private/internal IP ranges
function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    // Block localhost, private RFC-1918 ranges, link-local, metadata endpoints
    if (
      h === 'localhost' ||
      h === '0.0.0.0' ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^169\.254\./.test(h) ||
      h === '::1' ||
      h.endsWith('.internal') ||
      h.endsWith('.local')
    ) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchFileBase64(url: string): Promise<{ data: string; ok: boolean }> {
  if (!isSafeUrl(url)) return { data: "", ok: false };
  try {
    const res = await fetch(url);
    if (!res.ok) return { data: "", ok: false };
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_BYTES) return { data: "", ok: false };
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return { data: btoa(binary), ok: true };
  } catch {
    return { data: "", ok: false };
  }
}

function formatDevicesAsText(devices: any[]): string {
  const bySystem: Record<string, any[]> = {};
  for (const d of devices) {
    const sys = d.system_type ?? "General";
    if (!bySystem[sys]) bySystem[sys] = [];
    bySystem[sys].push(d);
  }
  return Object.entries(bySystem).map(([sys, devs]) => {
    const lines = devs.map(d => {
      const parts = [
        d.device_type,
        d.manufacturer && d.model_number ? `${d.manufacturer} ${d.model_number}` : (d.manufacturer || d.model_number || null),
        d.location ? `at ${d.location}` : null,
        d.notes ? `(${d.notes})` : null,
      ].filter(Boolean);
      return `  - ${parts.join(", ")}`;
    });
    return `${sys} (${devs.length} device${devs.length !== 1 ? "s" : ""}):\n${lines.join("\n")}`;
  }).join("\n\n");
}

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

  let project: any;
  let sources: Array<{ system_type: string; file_name: string; file_url: string; media_type: string }>;
  let devices: any[];

  try {
    const body = await req.json();
    project = body.project ?? {};
    sources = body.sources ?? [];
    devices = body.devices ?? [];
    if (!Array.isArray(sources)) sources = [];
    if (!Array.isArray(devices)) devices = [];
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const contentBlocks: any[] = [];
  const usedFiles: string[] = [];
  const systemList = sources.length > 0
    ? [...new Set(sources.map(s => s.system_type))].join(", ")
    : [...new Set(devices.map(d => d.system_type).filter(Boolean))].join(", ");

  // ── Path A: re-process original uploaded source documents ──────────────────
  if (sources.length > 0) {
    const seen = new Set<string>();
    const unique = sources.filter(s => {
      if (seen.has(s.file_url)) return false;
      seen.add(s.file_url);
      return true;
    }).slice(0, 5);

    for (const src of unique) {
      const isImage = src.media_type?.startsWith("image/");
      const mimeType = src.media_type || "application/pdf";

      contentBlocks.push({
        type: "text",
        text: `\n=== Document: "${src.file_name}" | System: ${src.system_type} ===`,
      });

      const fetched = await fetchFileBase64(src.file_url);
      if (fetched.ok) {
        usedFiles.push(src.file_name);
        contentBlocks.push(
          isImage
            ? { type: "image", source: { type: "base64", media_type: mimeType, data: fetched.data } }
            : { type: "document", source: { type: "base64", media_type: mimeType, data: fetched.data } }
        );
      } else {
        contentBlocks.push({ type: "text", text: `[Could not load: ${src.file_name}]` });
      }
    }

    contentBlocks.push({
      type: "text",
      text: `
You are a professional UK security systems documentation writer.

Using the documents provided above, write a professional Scope of Works for this security installation project.

Project details:
- Name: ${project.project_name ?? "TBC"}
- Client: ${project.client_name ?? "TBC"}
- Site: ${project.site_name ?? "TBC"}
- Project Manager: ${project.project_manager ?? "TBC"}
- Systems covered: ${systemList}

Write a comprehensive Scope of Works as a Markdown document covering:
1. **Overview** — What was installed, where, and the purpose of each system
2. **Systems Summary** — One section per system with actual device types, quantities, manufacturers, locations and specifications from the documents
3. **Scope of Supply** — Equipment provided, cable infrastructure, containment, power
4. **Deliverables** — Documents included in this O&M pack
5. **Standards & Compliance** — British Standards applicable to each system
6. **Exclusions** — Items not covered
7. **Warranty & Support** — Manufacturer warranty information from the documents

Be specific — reference actual products, quantities and locations found in the documents. Return ONLY the Markdown text, no JSON, no code fences.`,
    });
  }

  // ── Path B: generate scope from device list ────────────────────────────────
  else if (devices.length > 0) {
    const deviceText = formatDevicesAsText(devices);

    contentBlocks.push({
      type: "text",
      text: `
You are a professional UK security systems documentation writer.

Write a professional Scope of Works for the following security installation project based on the device schedule below.

Project details:
- Name: ${project.project_name ?? "TBC"}
- Client: ${project.client_name ?? "TBC"}
- Site: ${project.site_name ?? "TBC"}
- Project Manager: ${project.project_manager ?? "TBC"}
- Systems installed: ${systemList}

INSTALLED DEVICES:
${deviceText}

Write a comprehensive Scope of Works as a Markdown document covering:
1. **Overview** — What was installed, where, and the purpose of each system
2. **Systems Summary** — One section per system type listing device types, quantities, manufacturers, and key locations from the device schedule above
3. **Scope of Supply** — Equipment provided, cable infrastructure, containment, power
4. **Deliverables** — Documents included in this O&M pack
5. **Standards & Compliance** — British Standards applicable to each system (e.g. BS EN 50132 for CCTV, BS EN 50131 for Intruder, BS 7671 for Electrical)
6. **Exclusions** — Items not covered by this scope
7. **Warranty & Support** — Standard warranty terms

Reference actual device types, manufacturers and quantities from the device schedule. Write professionally in third person. Return ONLY the Markdown text, no JSON, no code fences.`,
    });
  } else {
    return new Response(
      JSON.stringify({ error: "Either sources (file URLs) or devices must be provided." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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
        max_tokens: 4096,
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error("Claude API error " + claudeRes.status + ": " + errBody.substring(0, 500));
    }

    const claudeJson = await claudeRes.json();
    const scope: string = claudeJson.content?.[0]?.text ?? "";

    if (!scope.trim()) throw new Error("Empty response from Claude");

    return new Response(JSON.stringify({ scope, source: usedFiles.length > 0 ? "documents" : "devices" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "Scope generation failed: " + e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
