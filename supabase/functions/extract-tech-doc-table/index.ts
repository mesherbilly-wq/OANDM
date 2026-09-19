import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const PROMPT = `You are reading a photograph or screenshot of a technical schedule used in security / fire O&M packs (door schedule, camera schedule, zone list, password schedule, IP address table, port/patch schedule, cable schedule, device configuration, network table).

Extract the main data table and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

Required JSON structure:
{
  "headers": ["Zone", "Device", "Location"],
  "rows": [
    { "Zone": "1", "Device": "PIR", "Location": "Kitchen" }
  ]
}

If the picture clearly has more than one separate table, return:
{
  "tables": [
    { "label": "Ground floor zones", "headers": ["Zone", "Device"], "rows": [{ "Zone": "1", "Device": "PIR" }] }
  ]
}

Rules:
- Use the printed column headings when they are visible
- If headings are missing, invent short factual names from the cell contents
- Extract every data row you can read. Skip title bars, totals, and notes that are not table rows
- Do not invent rows that are not in the picture
- Empty cells must be ""
- Keep values as written, including IPs, MACs, part numbers, and passwords if they appear
- Do not write method statements or extra commentary`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripFences(raw: string): string {
  const fence = String.fromCharCode(96, 96, 96);
  return raw
    .replace(new RegExp(fence + "json\\s*", "gi"), "")
    .replace(new RegExp(fence + "\\s*", "gi"), "")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uniquifyHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function coerceTable(raw: unknown, fallbackLabel: string): { label: string; headers: string[]; rows: Record<string, string>[] } | null {
  const record = asRecord(raw);
  if (!record) return null;

  let headers = Array.isArray(record.headers) ? record.headers.map(cellText) : [];
  const rawRows = Array.isArray(record.rows) ? record.rows : [];
  if (headers.length === 0 && rawRows.length > 0) {
    const first = rawRows[0];
    if (asRecord(first)) headers = Object.keys(first as object);
    else if (Array.isArray(first)) headers = (first as unknown[]).map((_, i) => `Column ${i + 1}`);
  }
  headers = uniquifyHeaders(headers);
  if (headers.length === 0) return null;

  const rows = rawRows.map((row) => {
    const out: Record<string, string> = {};
    if (Array.isArray(row)) {
      headers.forEach((header, i) => {
        out[header] = cellText(row[i]);
      });
      return out;
    }
    const obj = asRecord(row) ?? {};
    const values = Object.values(obj);
    headers.forEach((header, i) => {
      const match = Object.keys(obj).find((key) => key.trim().toLowerCase() === header.toLowerCase());
      out[header] = cellText(match ? obj[match] : values[i]);
    });
    return out;
  }).filter((row) => Object.values(row).some(Boolean));

  if (rows.length === 0) return null;
  return {
    label: cellText(record.label) || fallbackLabel,
    headers,
    rows,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY is not configured." }, 503);
  }

  let mediaType = "image/jpeg";
  let fileBase64 = "";
  try {
    const body = await req.json();
    mediaType = typeof body.media_type === "string" ? body.media_type : mediaType;
    if (typeof body.image_base64 === "string" && body.image_base64.trim()) {
      fileBase64 = body.image_base64.replace(/^data:[^;]+;base64,/, "").trim();
    } else if (typeof body.file_url === "string" && body.file_url) {
      const fileRes = await fetch(body.file_url);
      if (!fileRes.ok) throw new Error("Fetch failed: " + fileRes.status);
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      fileBase64 = btoa(binary);
      if (body.media_type) mediaType = body.media_type;
    } else {
      throw new Error("missing image");
    }
  } catch {
    return jsonResponse({ error: "Request body must contain image_base64 or file_url." }, 400);
  }

  if (!ALLOWED_MEDIA.has(mediaType)) {
    return jsonResponse({ error: "Use a JPG, PNG or WebP picture." }, 400);
  }
  if (!fileBase64) {
    return jsonResponse({ error: "Picture data was empty." }, 400);
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
        max_tokens: 12000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error("Claude API error " + claudeRes.status + ": " + errBody);
    }

    const claudeJson = await claudeRes.json();
    const parsed = JSON.parse(stripFences(claudeJson.content?.[0]?.text ?? "{}"));
    const tables = Array.isArray(parsed?.tables)
      ? parsed.tables.map((table: unknown, i: number) => coerceTable(table, `Table ${i + 1}`)).filter(Boolean)
      : [coerceTable(parsed, "Extracted table")].filter(Boolean);

    if (tables.length === 0) {
      return jsonResponse({ error: "No table could be read from that picture." }, 422);
    }

    return jsonResponse({
      headers: tables[0].headers,
      rows: tables[0].rows,
      tables,
    });
  } catch (e: any) {
    return jsonResponse({ error: "AI table extraction failed: " + e.message }, 500);
  }
});
