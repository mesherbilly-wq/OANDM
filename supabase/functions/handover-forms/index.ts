import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function appOrigin(req: Request): string {
  const env = Deno.env.get("PUBLIC_APP_URL")?.replace(/\/$/, "");
  if (env) return env;
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  return "https://oandm-ebon.vercel.app";
}

function fillUrl(req: Request, token: string): string {
  return `${appOrigin(req)}/f/${token}`;
}

function mailtoHref(opts: {
  to: string;
  title: string;
  url: string;
  company: string;
}): string {
  const subject = encodeURIComponent(`${opts.title} — please complete and sign`);
  const body = encodeURIComponent(
    `Please complete and sign this form online:\n\n${opts.title}\n${opts.url}\n\n${opts.company}`,
  );
  return `mailto:${encodeURIComponent(opts.to)}?subject=${subject}&body=${body}`;
}

async function sendResendEmail(opts: {
  to: string;
  title: string;
  url: string;
  company: string;
}): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("HANDOVER_FORMS_FROM_EMAIL") ?? Deno.env.get("RESEND_FROM_EMAIL");
  if (!apiKey || !from) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: `${opts.title} — please complete and sign`,
      text: `Please complete and sign this form online:\n\n${opts.title}\n${opts.url}\n\n${opts.company}`,
    }),
  });
  return res.ok;
}

function decodePdf(base64: string): Uint8Array {
  const cleaned = base64.includes(",") ? base64.split(",").pop() ?? "" : base64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action ?? "");

  if (action === "get_form") {
    const token = String(body.token ?? "").trim();
    if (!token) return json({ error: "Missing form token" }, 400);

    const { data: invite, error } = await db
      .from("handover_form_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (error) return json({ error: error.message }, 500);
    if (!invite) return json({ error: "This form link is not valid." }, 404);

    const { data: project } = await db
      .from("projects")
      .select("project_name, client_name, job_number, site_name, site_address, project_manager")
      .eq("id", invite.project_id)
      .maybeSingle();

    const { data: profile } = await db
      .from("contractor_profile")
      .select("company_name")
      .limit(1)
      .maybeSingle();

    const prefill = {
      job_number: project?.job_number ?? "",
      project_name: project?.project_name ?? "",
      client_name: project?.client_name ?? "",
      site_name: project?.site_name ?? "",
      site_address: project?.site_address ?? "",
      project_manager: project?.project_manager ?? "",
      document_title: invite.document_title,
      ...(invite.prefill ?? {}),
    };

    return json({
      token: invite.token,
      status: invite.status,
      document_title: invite.document_title,
      form_template_key: invite.form_template_key,
      company_name: profile?.company_name ?? null,
      recipient_name: invite.recipient_name,
      recipient_email: invite.recipient_email,
      prefill,
    });
  }

  if (action === "submit_form") {
    const token = String(body.token ?? "").trim();
    const signerName = String(body.signer_name ?? "").trim();
    const pdfBase64 = String(body.pdf_base64 ?? "");
    const fileName = String(body.file_name ?? `handover-form-${Date.now()}.pdf`);
    const answers = (body.answers ?? {}) as Record<string, unknown>;
    if (!token || !signerName || !pdfBase64) {
      return json({ error: "Signature, answers and PDF are required." }, 400);
    }

    const { data: invite, error } = await db
      .from("handover_form_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!invite) return json({ error: "This form link is not valid." }, 404);
    if (invite.status === "completed") {
      return json({ error: "This form has already been completed." }, 409);
    }

    const path = `${invite.project_id}/${invite.document_id}/${fileName}`;
    const bytes = decodePdf(pdfBase64);
    const { error: uploadError } = await db.storage.from("om-uploads").upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (uploadError) return json({ error: `Could not save PDF: ${uploadError.message}` }, 500);

    const { data: publicUrlData } = db.storage.from("om-uploads").getPublicUrl(path);
    const fileUrl = publicUrlData.publicUrl;

    const handoverPayload = {
      project_id: invite.project_id,
      document_type: invite.document_id,
      title: invite.document_title,
      status: "completed",
      sc_inspection_id: token,
      sc_template_id: invite.form_template_key,
      sc_inspection_name: `${invite.document_title} — signed form`,
      sc_result: "pass",
      sc_engineer_name: signerName,
      sc_completion_date: new Date().toISOString(),
      sc_imported_at: new Date().toISOString(),
      file_name: fileName,
      file_url: fileUrl,
      system_type: invite.system_type,
      project_system_id: invite.project_system_id,
    };

    const { data: savedDoc, error: docError } = await db
      .from("project_handover_docs")
      .upsert(handoverPayload, { onConflict: "project_id,document_type,system_type" })
      .select("id")
      .maybeSingle();

    if (docError) return json({ error: `Could not save document: ${docError.message}` }, 500);

    const { error: inviteError } = await db
      .from("handover_form_invites")
      .update({
        status: "completed",
        answers,
        signer_name: signerName,
        completed_at: new Date().toISOString(),
        handover_doc_id: savedDoc?.id ?? null,
      })
      .eq("id", invite.id);

    if (inviteError) return json({ error: inviteError.message }, 500);

    return json({ ok: true, file_url: fileUrl });
  }

  if (action === "create_invite") {
    const projectId = Number(body.project_id);
    const documentId = String(body.document_id ?? "").trim();
    const documentTitle = String(body.document_title ?? "").trim();
    const formTemplateKey = String(body.form_template_key ?? "").trim();
    const recipientEmail = String(body.recipient_email ?? "").trim();
    const recipientName = String(body.recipient_name ?? "").trim();
    if (!projectId || !documentId || !documentTitle || !formTemplateKey) {
      return json({ error: "project_id, document_id, document_title and form_template_key are required." }, 400);
    }

    const token = randomToken();
    const { data: profile } = await db
      .from("contractor_profile")
      .select("company_name")
      .limit(1)
      .maybeSingle();
    const company = profile?.company_name || "O&M Builder";
    const url = fillUrl(req, token);

    const { error } = await db.from("handover_form_invites").insert({
      token,
      project_id: projectId,
      document_id: documentId,
      document_title: documentTitle,
      form_template_key: formTemplateKey,
      recipient_email: recipientEmail || null,
      recipient_name: recipientName || null,
      status: recipientEmail ? "sent" : "pending",
      prefill: body.prefill ?? {},
      system_type: body.system_type ?? null,
      project_system_id: body.project_system_id ?? null,
    });

    if (error) {
      if (/schema cache|does not exist|handover_form_invites/i.test(error.message)) {
        return json({
          error:
            "Handover web forms table is missing. Run migration 025_handover_web_forms.sql in the Supabase SQL editor, then try again.",
        }, 400);
      }
      return json({ error: error.message }, 500);
    }

    let emailed = false;
    if (recipientEmail) {
      emailed = await sendResendEmail({
        to: recipientEmail,
        title: documentTitle,
        url,
        company,
      });
    }

    return json({
      token,
      fill_url: url,
      mailto_href: mailtoHref({
        to: recipientEmail || "",
        title: documentTitle,
        url,
        company,
      }),
      status: recipientEmail ? "sent" : "pending",
      recipient_email: recipientEmail || null,
      emailed,
    });
  }

  if (action === "send_pack") {
    const to = String(body.to ?? "").trim();
    const subject = String(body.subject ?? "Completion pack");
    const text = String(body.body ?? "");
    if (!to) return json({ error: "Missing recipient" }, 400);
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("HANDOVER_FORMS_FROM_EMAIL") ?? Deno.env.get("RESEND_FROM_EMAIL");
    if (!apiKey || !from) {
      return json({ ok: false, emailed: false, reason: "RESEND_API_KEY or from address is not configured" });
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    return json({ ok: res.ok, emailed: res.ok, status: res.status });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
