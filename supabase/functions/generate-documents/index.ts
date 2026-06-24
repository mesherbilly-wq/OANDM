import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DOCUMENT_TYPES = [
  "scope_of_works",
  "method_statement",
  "risk_assessment",
  "health_safety_summary",
  "commissioning_pack",
  "asset_register",
  "om_pack",
  "handover_certificate",
];

function buildAssetTable(devices: any[]): string {
  if (!devices.length) return "No devices extracted.";
  const header = "| # | Device Type | System | Manufacturer | Model | Location | Notes |\n|---|---|---|---|---|---|---|";
  const rows = devices.map((d, i) =>
    `| ${String(i + 1).padStart(2, "0")} | ${d.device_type ?? "-"} | ${d.system_type ?? "-"} | ${d.manufacturer ?? "-"} | ${d.model_number ?? "-"} | ${d.location ?? "-"} | ${[d.quantity > 1 ? `Qty: ${d.quantity}` : null, d.notes].filter(Boolean).join("; ") || "-"} |`
  );
  return [header, ...rows].join("\n");
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
  try {
    const body = await req.json();
    project = body.project;
    if (!project) throw new Error("missing project");
  } catch {
    return new Response(
      JSON.stringify({ error: "Request body must contain a project object." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const assetTable = buildAssetTable(project.devices ?? []);
  const systemsList = (project.system_types ?? []).join(", ") || "Security Systems";
  const deviceCount = (project.devices ?? []).reduce((s: number, d: any) => s + (d.quantity ?? 1), 0);

  const PROMPT = `You are generating professional project documentation for a UK security integration project.

Return ONLY a valid JSON object with exactly these 8 keys. Each value is the full document as a markdown string. Escape newlines as \\n within the JSON string values.

{
  "scope_of_works": "...",
  "method_statement": "...",
  "risk_assessment": "...",
  "health_safety_summary": "...",
  "commissioning_pack": "...",
  "asset_register": "...",
  "om_pack": "...",
  "handover_certificate": "..."
}

PROJECT INFORMATION:
- Project Name: ${project.project_name ?? "TBC"}
- Client: ${project.client_name ?? "TBC"}
- Site: ${project.site_name ?? "TBC"}
- Project Manager: ${project.project_manager ?? "TBC"}
- Systems: ${systemsList}
- Total Devices: ${deviceCount}
- Summary: ${project.project_summary ?? "Security systems installation project."}

DEVICE LIST:
${assetTable}

DOCUMENT REQUIREMENTS:

scope_of_works (300-400 words): Professional scope covering — project description, systems being installed (${systemsList}), locations and areas covered, deliverables, exclusions, relevant standards (BS EN 50132 for CCTV, BS EN 50131 for intruder, BS EN 50133 for access control as applicable).

method_statement (300-400 words): Step-by-step installation methodology — pre-works and surveys, cable containment installation, equipment installation sequence, testing and commissioning stages, site clearance.

risk_assessment: A markdown table with header row: | Hazard | Who at Risk | Likelihood (1-5) | Severity (1-5) | Control Measures | Residual Risk (L×S) |
Include 8 relevant hazards for a security installation (working at height, electrical, manual handling, drilling/cutting, lone working, etc.).

health_safety_summary (200-300 words): PPE requirements, RAMS review requirement, site induction, COSHH, waste disposal, emergency procedures, welfare facilities, relevant legislation (Health and Safety at Work Act 1974, CDM 2015 if applicable).

commissioning_pack: System-by-system commissioning checklists. For each system in ${systemsList}, provide a numbered checklist (10-15 items per system) using [ ] checkbox format. Include: cable testing, power-up, configuration, functional testing, recording/reporting verification.

asset_register: A complete markdown table using EXACTLY this data — do not invent devices:
${assetTable}

om_pack (300-400 words): Operations and Maintenance guide — system overview, user operation guide (key functions per system), maintenance schedule (monthly/quarterly/annual tasks), fault reporting procedure, emergency contacts template, software/firmware notes.

handover_certificate: Formal handover document — Project Details section (client, site, date, PM), Systems Handed Over checklist (one line per system type), Documentation Provided checklist (as-built drawings, O&M manual, commissioning records, warranties, training records), Client Acceptance section with placeholder signature lines and date fields.`;

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
        messages: [{ role: "user", content: PROMPT }],
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

    let docs: Record<string, string>;
    try {
      docs = JSON.parse(cleaned);
    } catch {
      // Fallback: return empty stubs if JSON parse fails
      docs = Object.fromEntries(DOCUMENT_TYPES.map((t) => [t, `# ${t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}\n\nGeneration failed — please edit this document manually.`]));
    }

    // Ensure all 8 keys are present
    for (const key of DOCUMENT_TYPES) {
      if (!docs[key]) docs[key] = `# ${key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}\n\nContent not generated — please edit manually.`;
    }

    return new Response(JSON.stringify({ documents: docs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "Document generation failed: " + e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
