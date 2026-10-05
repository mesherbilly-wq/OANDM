import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SHAPE = `JSON shape:
{
  "title": "short document title",
  "statusNotice": "one sentence that this is a company form, not an official certificate",
  "sections": [
    {
      "id": "job",
      "title": "Job, customer and site",
      "summary": "plain-language purpose",
      "customerVisible": true,
      "fields": [
        {
          "id": "job_number",
          "label": "Job number",
          "type": "text",
          "required": true,
          "customerVisible": true,
          "help": "optional short hint",
          "options": ["Yes", "No"],
          "unit": "optional",
          "sensitive": false,
          "showWhen": [{ "field": "other_field_id", "op": "eq", "values": ["Yes"], "scope": "section" }]
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

Field types: text, textarea, number, date, tel, email, select, multiselect, test_result, photo, note, declaration, signature.`;

const RULES = `Rules:
- Finish the whole form. Do not stop after the first pages.
- Include every question, choice, instruction, repeatable group, checklist, training block, declaration and signature from the source pages you are given.
- Convert "If answer is X Answer Question(s)" into showWhen.
- Repeat sections become groups with an Add button (Add camera, Add door, Add controller, Add trainee).
- Nested repeats (readers on a controller) become nested groups.
- Usernames, passwords and codes: sensitive true.
- Customer handover, training and signatures: customerVisible true.
- Tests: prefer test_result. Tick lists: select or multiselect with the printed choices.
- Correct obvious spelling; keep technical meaning.
- ids snake_case, unique within a section or group.
- Not an official NSI or MoJ certificate.
- Ignore logos, headers and page numbers.`;

type Extracted = {
  title?: string;
  statusNotice?: string;
  sections?: unknown[];
  reviewFlags?: unknown[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripFences(raw: string): string {
  return raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function parseJsonObject(raw: string): Extracted {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned) as Extracted;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as Extracted;
    throw new Error("The AI did not return usable JSON.");
  }
}

function textFromClaude(payload: { content?: Array<{ type?: string; text?: string }> }): string {
  return (payload.content ?? [])
    .filter(block => block.type === "text" && block.text)
    .map(block => block.text ?? "")
    .join("\n")
    .trim();
}

function splitPageChunks(text: string, pageCount: number): string[] {
  const matches = [...text.matchAll(/--- Page (\d+) of (\d+) ---/g)];
  if (matches.length < 2) {
    if (text.length <= 14000) return [text];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 12000) chunks.push(text.slice(i, i + 14000));
    return chunks;
  }
  const pages: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    pages.push(text.slice(start, end).trim());
  }
  const size = pageCount > 16 ? 6 : 8;
  const chunks: string[] = [];
  for (let i = 0; i < pages.length; i += size) {
    chunks.push(pages.slice(i, i + size).join("\n\n"));
  }
  return chunks.filter(Boolean);
}

function asSections(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === "object") as Array<Record<string, unknown>>;
}

function mergeExtracted(base: Extracted | null, next: Extracted): Extracted {
  if (!base) return { ...next, sections: asSections(next.sections) };
  const sections = [...asSections(base.sections)];
  for (const incoming of asSections(next.sections)) {
    const id = String(incoming.id ?? "");
    const title = String(incoming.title ?? "");
    const index = sections.findIndex(section =>
      (id && String(section.id) === id) || String(section.title ?? "").toLowerCase() === title.toLowerCase(),
    );
    if (index < 0) {
      sections.push(incoming);
      continue;
    }
    const current = sections[index];
    const fields = [...(Array.isArray(current.fields) ? current.fields : []), ...(Array.isArray(incoming.fields) ? incoming.fields : [])];
    const groups = [...(Array.isArray(current.groups) ? current.groups : []), ...(Array.isArray(incoming.groups) ? incoming.groups : [])];
    sections[index] = { ...current, ...incoming, fields, groups };
  }
  return {
    title: base.title || next.title,
    statusNotice: base.statusNotice || next.statusNotice,
    sections,
    reviewFlags: [...(Array.isArray(base.reviewFlags) ? base.reviewFlags : []), ...(Array.isArray(next.reviewFlags) ? next.reviewFlags : [])],
  };
}

function inventory(extracted: Extracted): string {
  const lines: string[] = [];
  for (const section of asSections(extracted.sections)) {
    lines.push(`Section: ${section.title} (${section.id})`);
    for (const field of Array.isArray(section.fields) ? section.fields as Array<Record<string, unknown>> : []) {
      lines.push(`  - field ${field.id}: ${field.label} [${field.type}]`);
    }
    for (const group of Array.isArray(section.groups) ? section.groups as Array<Record<string, unknown>> : []) {
      lines.push(`  - group ${group.id}: ${group.title} add="${group.addLabel}"`);
      for (const field of Array.isArray(group.fields) ? group.fields as Array<Record<string, unknown>> : []) {
        lines.push(`      field ${field.id}: ${field.label} [${field.type}]`);
      }
      for (const nested of Array.isArray(group.nested) ? group.nested as Array<Record<string, unknown>> : []) {
        lines.push(`      nested ${nested.id}: ${nested.title} add="${nested.addLabel}"`);
        for (const field of Array.isArray(nested.fields) ? nested.fields as Array<Record<string, unknown>> : []) {
          lines.push(`          field ${field.id}: ${field.label} [${field.type}]`);
        }
      }
    }
  }
  return lines.join("\n") || "(empty)";
}

function lastPages(text: string, count = 8): string {
  const matches = [...text.matchAll(/--- Page (\d+) of (\d+) ---/g)];
  if (matches.length <= count) return text;
  const start = matches[Math.max(0, matches.length - count)].index ?? 0;
  return text.slice(start);
}

async function callClaude(
  apiKey: string,
  content: unknown[],
  opts?: { maxTokens?: number; think?: boolean },
): Promise<string> {
  const body: Record<string, unknown> = {
    model: "claude-opus-4-5",
    max_tokens: opts?.maxTokens ?? 20000,
    messages: [{ role: "user", content }],
  };
  if (opts?.think) {
    body.thinking = { type: "enabled", budget_tokens: 6000 };
    body.max_tokens = Math.max(Number(body.max_tokens), 16000);
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errBody = await response.text();
    if (opts?.think && /thinking|budget_tokens/i.test(errBody)) {
      return callClaude(apiKey, content, { maxTokens: opts.maxTokens, think: false });
    }
    throw new Error(`AI extract failed (${response.status}): ${errBody.slice(0, 400)}`);
  }
  const payload = await response.json();
  const text = textFromClaude(payload);
  if (!text) throw new Error("The AI returned an empty response.");
  return text;
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

  const imageBlocks: unknown[] = [];
  for (const image of images.slice(0, 8)) {
    const data = String(image.data ?? "").replace(/\s/g, "");
    const mediaType = String(image.media_type ?? "image/jpeg");
    if (!data) continue;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(mediaType)) continue;
    imageBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
  }

  const chunks = splitPageChunks(text, pageCount);
  const context = `System type: ${systemType || "not specified"}
Existing title: ${existingTitle || "new document"}
Source file: ${fileName}
Page count: ${pageCount || chunks.length || "unknown"}`;

  try {
    let merged: Extracted | null = null;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const content: unknown[] = [];
      if (i === 0) content.push(...imageBlocks);
      content.push({
        type: "text",
        text: `You convert an existing commissioning / completion / handover form into a structured digital template.
This is pass ${i + 1} of ${chunks.length}. Extract ONLY the questions on these pages. Later or earlier pages are handled in other passes.

Return ONLY valid JSON. No markdown.

${SHAPE}

${RULES}

${context}

Source pages for this pass:
${chunk || "(no selectable text — read attached images)"}`,
      });
      const raw = await callClaude(apiKey, content, { maxTokens: 20000 });
      merged = mergeExtracted(merged, parseJsonObject(raw));
    }

    if (!merged || asSections(merged.sections).length === 0) {
      return json({ error: "The AI could not read a usable form structure from that file." }, 422);
    }

    const completeContent: unknown[] = [{
      type: "text",
      text: `You already converted most of a handover / commissioning form. Now finish the job.

Compare the source with the inventory. Add anything missing: later pages, checklists, training, extra works, repeatable Add-item groups, customer/engineer/project manager signatures, declarations, and "if Yes then…" questions.

Do not remove existing sections. Merge new fields/groups into the right section, or add new sections for later pages.
Keep the same JSON shape. Return the FULL completed template JSON only.

${SHAPE}

${RULES}

${context}

Inventory already extracted:
${inventory(merged)}

Last pages of the source (must be represented):
${lastPages(text || "(images only)", 10)}

Full source (use this to find gaps):
${text.slice(0, 160000) || "(no selectable text)"}`,
    }];

    try {
      const filledRaw = await callClaude(apiKey, completeContent, { maxTokens: 24000, think: true });
      const filled = parseJsonObject(filledRaw);
      if (asSections(filled.sections).length > 0) merged = mergeExtracted(merged, filled);
    } catch {
      // Keep the chunked extract if the completeness pass fails.
    }

    const sections = asSections(merged.sections);
    if (!sections.length) {
      return json({ error: "The AI could not read a usable form structure from that file." }, 422);
    }

    return json({
      title: String(merged.title ?? existingTitle ?? fileName),
      statusNotice: String(merged.statusNotice ?? "Company form. This is not an official certificate."),
      sections,
      reviewFlags: Array.isArray(merged.reviewFlags) ? merged.reviewFlags : [],
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "AI extract failed." }, 500);
  }
});
