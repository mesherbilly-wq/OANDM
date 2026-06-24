import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PROMPT = [
  "You are analysing a security system drawing, floor plan, or schedule.",
  "Extract every device reference and return ONLY a valid JSON array — no markdown, no explanation, no code fences.",
  "",
  "Each object must have these exact fields:",
  '- "device_name": string  (the reference label on the drawing, e.g. "CAM-01", "DR-03", "ACR-B1")',
  '- "manufacturer": string | null',
  '- "model_number": string | null',
  '- "device_type": one of "Camera" | "Door Controller" | "Access Reader" | "Recorder" | "Sensor" | "Intercom" | "Network Switch" | "Other"',
  '- "system_type": one of "CCTV" | "Access Control" | "Intercom" | "Intruder" | "Networking"',
  '- "location": string | null  (room name, level, zone, or area description from the drawing)',
  '- "notes": string | null',
  '- "confidence": number  (0.0 to 1.0, how confident you are this is a real device reference)',
  '- "position_x": number  (0 to 100, estimated percentage from the LEFT edge of the drawing where this device symbol or label physically appears)',
  '- "position_y": number  (0 to 100, estimated percentage from the TOP edge of the drawing where this device symbol or label physically appears)',
  "",
  "For position_x and position_y: give your best estimate of where the device symbol or label physically appears on the page. Top-left corner = (0,0), bottom-right = (100,100). If multiple instances exist, use the first occurrence.",
  "",
  "Focus on: cameras, door contacts, access readers, motion detectors, intercoms, network switches, recorders.",
  "If you find nothing, return [].",
].join("\n");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured. Add it in Supabase Edge Functions Secrets." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let drawing_id: number;
  try {
    const body = await req.json();
    drawing_id = Number(body.drawing_id);
    if (!drawing_id) throw new Error("missing drawing_id");
  } catch {
    return new Response(
      JSON.stringify({ error: "Request body must contain drawing_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: drawing, error: drawingErr } = await supabase
    .from("drawings")
    .select("*")
    .eq("id", drawing_id)
    .single();

  if (drawingErr || !drawing) {
    return new Response(
      JSON.stringify({ error: "Drawing not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!drawing.file_url) {
    return new Response(
      JSON.stringify({ error: "Drawing has no file URL" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let fileBase64: string;
  let mediaType: string;
  try {
    const fileRes = await fetch(drawing.file_url);
    if (!fileRes.ok) throw new Error("Failed to fetch file: " + fileRes.status);
    const buffer = await fileRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    fileBase64 = btoa(binary);
    const ext = (drawing.file_type ?? "pdf").toLowerCase();
    mediaType = ext === "pdf" ? "application/pdf"
      : ext === "png" ? "image/png"
      : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "tiff" ? "image/tiff"
      : ext === "webp" ? "image/webp"
      : "application/pdf";
  } catch (e: any) {
    await supabase.from("drawings").update({ processing_status: "failed" }).eq("id", drawing_id);
    return new Response(
      JSON.stringify({ error: "Could not download drawing: " + e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let proposals: any[] = [];
  try {
    const isImage = mediaType.startsWith("image/");
    const contentBlock = isImage
      ? { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } }
      : { type: "document", source: { type: "base64", media_type: mediaType, data: fileBase64 } };

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
    const rawText: string = claudeJson.content?.[0]?.text ?? "[]";

    // Strip markdown fences without using backtick literals in regex
    const fence = String.fromCharCode(96, 96, 96);
    const cleaned = rawText
      .replace(new RegExp(fence + "json\\s*", "gi"), "")
      .replace(new RegExp(fence + "\\s*", "gi"), "")
      .trim();

    proposals = JSON.parse(cleaned);
    if (!Array.isArray(proposals)) proposals = [];
  } catch (e: any) {
    await supabase.from("drawings").update({ processing_status: "failed" }).eq("id", drawing_id);
    return new Response(
      JSON.stringify({ error: "AI processing failed: " + e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await supabase.from("drawing_proposals").delete().eq("drawing_id", drawing_id).eq("status", "pending");

  if (proposals.length > 0) {
    const rows = proposals.map((p: any) => ({
      drawing_id,
      project_id: drawing.project_id,
      device_name: p.device_name ?? null,
      manufacturer: p.manufacturer ?? null,
      model_number: p.model_number ?? null,
      device_type: p.device_type ?? null,
      system_type: p.system_type ?? null,
      location: p.location ?? null,
      notes: p.notes ?? null,
      raw_reference: p.device_name ?? null,
      confidence: typeof p.confidence === "number" ? p.confidence : 0.8,
      status: "pending",
      position_x: typeof p.position_x === "number" ? Math.min(100, Math.max(0, p.position_x)) : null,
      position_y: typeof p.position_y === "number" ? Math.min(100, Math.max(0, p.position_y)) : null,
    }));
    await supabase.from("drawing_proposals").insert(rows);
  }

  await supabase.from("drawings").update({ processing_status: "completed" }).eq("id", drawing_id);

  return new Response(
    JSON.stringify({ ok: true, proposals_created: proposals.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
