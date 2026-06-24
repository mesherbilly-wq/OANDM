import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_PDF_BYTES = 30 * 1024 * 1024; // 30 MB cap

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({ error: "Supabase credentials not configured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { url, manufacturer, model } = await req.json();
  if (!url || !manufacturer || !model) {
    return new Response(
      JSON.stringify({ error: "url, manufacturer and model are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Download the PDF
  let pdfBytes: Uint8Array;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/pdf,*/*",
      },
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching PDF`);

    const contentLength = parseInt(res.headers.get("content-length") ?? "0");
    if (contentLength > MAX_PDF_BYTES) throw new Error("PDF exceeds 30 MB size limit");

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_BYTES) throw new Error("PDF exceeds 30 MB size limit");

    pdfBytes = new Uint8Array(buffer);

    // Verify it's actually a PDF (%PDF header)
    const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
    if (!header.startsWith("%PDF")) throw new Error("URL does not point to a valid PDF file");
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "Failed to download PDF: " + e.message }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Build a safe storage path
  const safeMfr = manufacturer.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const safeMdl = model.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  const fileName = `${safeMfr}_${safeMdl}_datasheet.pdf`;
  const storagePath = `${safeMfr}/${safeMdl}/${Date.now()}_${fileName}`;

  // Upload to Supabase storage via REST API
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/user-datasheets/${storagePath}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/pdf",
        "x-upsert": "false",
      },
      body: pdfBytes,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return new Response(
      JSON.stringify({ error: "Storage upload failed: " + err.substring(0, 200) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/user-datasheets/${storagePath}`;

  // Upsert datasheets table
  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/datasheets`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "apikey": SERVICE_ROLE,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      manufacturer: manufacturer.trim(),
      model_number: model.trim(),
      file_name: fileName,
      datasheet_url: publicUrl,
    }),
  });

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return new Response(
      JSON.stringify({ error: "Database save failed: " + err.substring(0, 200) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const [datasheet] = await upsertRes.json();

  // Backfill datasheet_found on all matching devices
  await fetch(
    `${SUPABASE_URL}/rest/v1/devices?manufacturer=ilike.${encodeURIComponent(manufacturer.trim())}&model_number=ilike.${encodeURIComponent(model.trim())}`,
    {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "apikey": SERVICE_ROLE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ datasheet_found: true }),
    }
  );

  return new Response(
    JSON.stringify({ publicUrl, datasheet, fileName, sizeKb: Math.round(pdfBytes.byteLength / 1024) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
