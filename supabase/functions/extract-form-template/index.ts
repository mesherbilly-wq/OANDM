import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PROMPT = `You convert an existing commissioning / completion / handover form into a structured digital template.

Return ONLY a valid JSON object — no markdown, no explanation, no code fences.

JSON shape:
{
  "title": "short document title",
  "statusNotice": "one sentence that this is a company form, not an official certificate",
  "sections": [
    {
      "id": "job",
      "title": "Job, customer and site",
      "summary": "plain-language purpose",
      "customerVisible": true,
      "note": "optional instruction",
      "fields": [
        {
          "id": "job_number",
          "label": "Job number",
          "type": "text",
          "required": true,
          "customerVisible": true,
          "help": "optional short hint",
          "options": ["only for select, multiselect or test_result"],
          "unit": "optional unit",
          "sensitive": false,
          "showWhen": [{ "field": "other_field_id", "op": "eq", "values": ["Yes"] }]
        }
      ],
      "groups": [
        {
          "id": "doors",
          "title": "Doors",
          "addLabel": "Add door",
          "nameTemplate": "Door {location}",
          "identityFields": ["location"],
          "showWhen": [{ "field": "system_new_or_existing", "op": "eq", "values": ["New"] }],
          "fields": [],
          "nested": []
        }
      ]
    }
  ]
}

Field types allowed: text, textarea, number, date, tel, email, select, multiselect, test_result, photo, note, declaration, signature.

Rules:
- The source may be 20+ pages. You MUST implement EVERY page through the LAST page. Never stop after the first sections.
- You MUST include customer training, operational checklists, repeatable equipment (Add camera / Add door / Add controller), and customer / engineer / project manager sign-off when they appear in the source.
- Keep every question, instruction, choice, repeatable group and "If answer is X then…" condition from the source
- Convert "If answer is X Answer Question(s)" into showWhen on the later fields or groups
- Use repeatable groups for equipment rows (cameras, recorders, doors, controllers, readers, zones, trainees)
- A missing signature, handover declaration or checklist from later pages makes the output invalid — go back and include them
- Do not copy 25-page blank spacing
- Do not treat the form as an official NSI or MoJ certificate
- Usernames, passwords and verification codes must have "sensitive": true
- Customer-facing handover/training/signature fields should have customerVisible true
- Prefer test_result (Pass / Fail / Not tested / Not applicable) over a Yes-only tick when the source is a test
- Correct obvious spelling in labels; keep technical meaning
- ids must be snake_case and unique within a section or group
- Ignore headers, logos, page numbers and decorative branding from the scan; the app applies the company letterhead separately`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripFences(raw: string): string {
  return raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not configured." }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const text = String(body.text ?? "").trim();
  const fileName = String(body.file_name ?? "uploaded form");
  const systemType = String(body.system_type ?? "");
  const existingTitle = String(body.existing_title ?? "");
  const pageCount = Number(body.page_count ?? 0);
  const images = Array.isArray(body.images) ? body.images as Array<{ media_type?: string; data?: string }> : [];

  if (!text && images.length === 0) return json({ error: "Upload a PDF, Word file or picture of the form." }, 400);

  const content: unknown[] = [];
  for (const image of images.slice(0, 8)) {
    const data = String(image.data ?? "").replace(/\s/g, "");
    const mediaType = String(image.media_type ?? "image/jpeg");
    if (!data) continue;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(mediaType)) continue;
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
  }
  content.push({
    type: "text",
    text: `${PROMPT}

System type for this document: ${systemType || "not specified"}
Existing document title if updating: ${existingTitle || "new document"}
Source file name: ${fileName}
Source page count: ${pageCount || "unknown"} — implement every page, including training, checklists and customer sign-off at the end.

Source text:
${text.slice(0, 180000) || "(no selectable text — read the attached page images)"}`,
  });

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 24000,
        messages: [{ role: "user", content }],
      }),
    });
    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      return json({ error: `AI extract failed (${claudeRes.status}): ${errBody.slice(0, 400)}` }, 502);
    }
    const claudeJson = await claudeRes.json();
    const parsed = JSON.parse(stripFences(claudeJson.content?.[0]?.text ?? "{}"));
    if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      return json({ error: "The AI could not read a usable form structure from that file." }, 422);
    }
    return json({
      title: String(parsed.title ?? existingTitle ?? fileName),
      statusNotice: String(parsed.statusNotice ?? "Company form. This is not an official certificate."),
      sections: parsed.sections,
      reviewFlags: Array.isArray(parsed.reviewFlags) ? parsed.reviewFlags : [],
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "AI extract failed." }, 500);
  }
});
