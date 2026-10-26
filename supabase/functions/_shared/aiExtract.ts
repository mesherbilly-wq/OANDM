import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json, requireCompanyMember } from "./companyGate.ts";

const PROMPT = `You extract security and fire project information from drawings, schedules, specifications and equipment lists.
Return ONLY a JSON object. Do not invent model numbers, test readings, signatures, certificates or quantities that are not visible.
Leave a field null when the page does not support it.

Use this shape:
{
  "project_name": null,
  "client_name": null,
  "site_name": null,
  "site_address": null,
  "job_number": null,
  "quote_number": null,
  "project_number": null,
  "drawing_references": [],
  "project_manager": null,
  "engineer": null,
  "project_notes": null,
  "scope_of_works": null,
  "system_types": [],
  "devices": [
    {
      "system_type": "CCTV",
      "device_type": "Dome camera",
      "manufacturer": null,
      "model_number": null,
      "model_name": null,
      "quantity": null,
      "location": null,
      "zone": null,
      "notes": null,
      "quantity_basis": "counted",
      "evidence_class": "proposed",
      "view_kind": "detail",
      "source_file": "drawing.pdf",
      "source_page": 1,
      "evidence_text": "short quote or symbol description from this page",
      "confidence": 0.6
    }
  ],
  "sections": [
    { "kind": "installation", "text": null, "source_file": null, "source_page": null }
  ],
  "missing": []
}

quantity_basis is "stated" when a schedule or note gives a number, or "counted" when you count symbols on a drawing.
Set quantity to null when the page does not give a number. A camera type such as "bullet" or "dome" is not a quantity of 1.
Do not use 1 as a placeholder. A design proposal is evidence_class "proposed", never "installed" or as-fitted.
evidence_class is "quoted" for a quote or price list, "proposed" for a design drawing, or "installed" only when the page explicitly says installed or as-fitted.
view_kind is overview, detail, schedule, legend, revision, or unknown.
system_type should be CCTV, Access Control, Intercom, Intruder, Fire, or Networking when that is clear.
Count each device symbol once on the plan. Do not count the same symbol in the legend, a coverage cone, or a repeated crop.
A title-block total and a counted symbol total are separate. Do not add them together.
The company that drew the sheet is not the customer.
A quote is not installed equipment.
sections.kind may be installation, operating, maintenance, or commissioning. Copy only wording that is present.
missing lists evidence that is absent, such as manuals, test results or signatures. Do not say they exist.`;

interface IncomingPage {
  file_name?: string;
  label?: string;
  page?: number;
  text?: string;
  image_base64?: string;
  image_crops?: string[];
  media_type?: string;
}

function parseJson(raw: string): Record<string, unknown> {
  const fence = String.fromCharCode(96);
  const cleaned = raw.replace(new RegExp(fence + "{3}json\\s*", "gi"), "").replace(new RegExp(fence + "{3}", "g"), "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function handleAiExtract(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not configured." }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase service role is not configured." }, 503);
  const db = createClient(supabaseUrl, serviceKey);
  const access = await requireCompanyMember(req, db);
  if ("response" in access) return access.response;

  let pages: IncomingPage[] = [];
  try {
    const body = await req.json();
    if (!Array.isArray(body.pages) || body.pages.length === 0) {
      return json({ error: "Send the document page by page. The file itself is not uploaded to the model." }, 400);
    }
    pages = body.pages.slice(0, 6);
  } catch {
    return json({ error: "Request body must be JSON with a pages array." }, 400);
  }

  const content: unknown[] = [];
  const transcript: string[] = [];
  for (const page of pages) {
    const fileName = String(page.file_name ?? "document");
    const label = String(page.label ?? "Other");
    const pageNumber = Number(page.page ?? 1);
    const text = String(page.text ?? "").slice(0, 12000);
    transcript.push(`File: ${fileName}\nLabel: ${label}\nPage: ${pageNumber}\n${text}`);
    if (page.image_base64 && page.media_type?.startsWith("image/")) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: page.media_type, data: page.image_base64 },
      });
    }
    for (const crop of (page.image_crops ?? []).slice(0, 4)) {
      if (!crop) continue;
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: crop },
      });
    }
  }
  content.push({
    type: "text",
    text: `${PROMPT}\n\nCompany ${access.caller.companyId}. Read only these pages:\n\n${transcript.join("\n\n---\n\n")}`,
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
        max_tokens: 8000,
        messages: [{ role: "user", content }],
      }),
    });
    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      return json({ error: `Claude could not read this batch (${claudeRes.status}). ${errBody.slice(0, 400)}` }, 502);
    }
    const claudeJson = await claudeRes.json();
    const rawText = String(claudeJson.content?.[0]?.text ?? "{}");
    const parsed = parseJson(rawText);
    return json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI extraction failed";
    return json({ error: message }, 500);
  }
}
