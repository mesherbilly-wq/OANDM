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
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function appOrigin(req: Request): string {
  const env = Deno.env.get("PUBLIC_APP_URL")?.replace(/\/$/, "");
  if (env) return env;
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  return "https://oandm-ebon.vercel.app";
}

function formUrl(req: Request, token: string): string {
  return `${appOrigin(req)}/c/${token}`;
}

async function sendResendEmail(opts: { to: string; subject: string; text: string }): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("HANDOVER_FORMS_FROM_EMAIL") ?? Deno.env.get("RESEND_FROM_EMAIL");
  if (!apiKey || !from) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, text: opts.text }),
  });
  return res.ok;
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
  const token = String(body.token ?? "").trim();

  async function loadToken() {
    if (!token || token.length < 32) return { error: json({ error: "This form link is not valid." }, 404) };
    const { data: row, error } = await db
      .from("completion_form_tokens")
      .select("id, form_id, role, expires_at, revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (error) return { error: json({ error: error.message }, 500) };
    if (!row || row.revoked_at) return { error: json({ error: "This form link is not valid." }, 404) };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return { error: json({ error: "This form link has expired." }, 410) };
    }
    const { data: form } = await db.from("completion_forms").select("*").eq("id", row.form_id).maybeSingle();
    if (!form || form.status === "revoked") return { error: json({ error: "This form link is not valid." }, 404) };
    return { row, form };
  }

  async function loadRevision(formId: number, revisionNo: number) {
    const { data } = await db
      .from("completion_form_revisions")
      .select("*")
      .eq("form_id", formId)
      .eq("revision_no", revisionNo)
      .maybeSingle();
    return data;
  }

  async function loadAssets(formId: number, revisionNo: number) {
    const { data } = await db
      .from("completion_form_assets")
      .select("*")
      .eq("form_id", formId)
      .eq("revision_no", revisionNo)
      .order("id");
    const photos = [];
    for (const asset of data ?? []) {
      let signedUrl: string | undefined;
      if (asset.status === "ready") {
        const signed = await db.storage.from("completion-form-files").createSignedUrl(asset.storage_path, 60 * 30);
        signedUrl = signed.data?.signedUrl;
      }
      photos.push({
        id: String(asset.id),
        fieldPath: asset.field_path,
        fileName: asset.file_name,
        caption: asset.caption,
        contentType: asset.content_type,
        status: asset.status,
        error: asset.error,
        signedUrl,
      });
    }
    return photos;
  }

  if (action === "get_form") {
    const loaded = await loadToken();
    if ("error" in loaded && loaded.error) return loaded.error;
    const { row, form } = loaded as { row: { form_id: number; role: string }; form: Record<string, unknown> };
    await db.from("completion_form_tokens").update({ last_seen_at: new Date().toISOString() }).eq("token", token);
    const now = new Date().toISOString();
    if (form.status === "issued") {
      await db.from("completion_forms").update({ status: "opened", opened_at: form.opened_at ?? now, updated_at: now }).eq("id", form.id);
      form.status = "opened";
      form.opened_at = form.opened_at ?? now;
    }
    const revision = await loadRevision(Number(form.id), Number(form.current_revision_no));
    const { data: project } = await db
      .from("projects")
      .select("job_number, project_number, project_name, client_name, site_name, site_address, project_manager, engineer")
      .eq("id", form.project_id)
      .maybeSingle();
    const { data: profile } = await db.from("contractor_profile").select("company_name").limit(1).maybeSingle();
    return json({
      token,
      role: row.role,
      status: form.status,
      title: form.title,
      schema: form.schema_json,
      answers: revision?.answers ?? {},
      photos: await loadAssets(Number(form.id), Number(form.current_revision_no)),
      revisionNo: form.current_revision_no,
      revisionLocked: Boolean(revision?.locked),
      project: {
        jobNumber: project?.job_number || project?.project_number || "",
        projectName: project?.project_name || "",
        clientName: project?.client_name || "",
        siteName: project?.site_name || "",
        siteAddress: project?.site_address || "",
        projectManager: project?.project_manager || "",
        engineer: project?.engineer || "",
      },
      companyName: profile?.company_name || "Pacific",
      assignedName: form.assigned_name,
      expiresAt: form.expires_at,
      reviewNote: form.review_note,
      outstandingHandoverAuthorised: Boolean(form.outstanding_handover_authorised),
      offlineSupported: false,
      signatureNotice: "Drawn electronic signature with an audit record. Not a certificate-backed digital signature.",
    });
  }

  if (action === "save_draft") {
    const loaded = await loadToken();
    if ("error" in loaded && loaded.error) return loaded.error;
    const { row, form } = loaded as { row: { role: string }; form: Record<string, unknown> };
    if (row.role !== "engineer") return json({ error: "This link cannot save the technical record." }, 403);
    if (["complete", "revoked"].includes(String(form.status))) return json({ error: "This form is closed." }, 409);
    const revision = await loadRevision(Number(form.id), Number(form.current_revision_no));
    if (!revision || revision.locked) return json({ error: "This revision is locked. A new revision is needed after a material change." }, 409);
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const now = new Date().toISOString();
    await db.from("completion_form_revisions").update({ answers }).eq("id", revision.id);
    const nextStatus = form.status === "opened" || form.status === "issued" || form.status === "returned" ? "in_progress" : form.status;
    await db.from("completion_forms").update({ status: nextStatus, updated_at: now }).eq("id", form.id);
    return json({ ok: true, savedAt: now, status: nextStatus });
  }

  if (action === "create_upload") {
    const loaded = await loadToken();
    if ("error" in loaded && loaded.error) return loaded.error;
    const { row, form } = loaded as { row: { role: string }; form: Record<string, unknown> };
    if (row.role !== "engineer") return json({ error: "This link cannot upload evidence." }, 403);
    const fieldPath = String(body.field_path ?? "").trim();
    const fileName = String(body.file_name ?? "photo.jpg").replace(/[^\w.\-]+/g, "_");
    const contentType = String(body.content_type ?? "image/jpeg");
    if (!fieldPath) return json({ error: "Missing photo field." }, 400);
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(contentType)) return json({ error: "Only JPEG, PNG, WebP or GIF photos can be attached." }, 400);
    const revisionNo = Number(form.current_revision_no);
    const path = `${form.id}/${revisionNo}/${crypto.randomUUID()}_${fileName}`;
    const { data: inserted, error } = await db.from("completion_form_assets").insert({
      form_id: form.id,
      revision_no: revisionNo,
      field_path: fieldPath,
      file_name: fileName,
      caption: String(body.caption ?? ""),
      content_type: contentType,
      storage_path: path,
      status: "uploading",
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    const signed = await db.storage.from("completion-form-files").createSignedUploadUrl(path);
    if (signed.error || !signed.data) return json({ error: signed.error?.message ?? "Could not prepare the upload." }, 500);
    return json({ assetId: inserted.id, path, token: signed.data.token, signedUrl: signed.data.signedUrl });
  }

  if (action === "confirm_upload") {
    const loaded = await loadToken();
    if ("error" in loaded && loaded.error) return loaded.error;
    const assetId = Number(body.asset_id ?? 0);
    const ok = body.ok !== false;
    const { data: asset } = await db.from("completion_form_assets").select("*").eq("id", assetId).maybeSingle();
    if (!asset || Number(asset.form_id) !== Number((loaded as { form: { id: number } }).form.id)) {
      return json({ error: "Photo not found." }, 404);
    }
    await db.from("completion_form_assets").update({
      status: ok ? "ready" : "failed",
      error: ok ? null : String(body.error ?? "Upload failed"),
      caption: String(body.caption ?? asset.caption ?? ""),
    }).eq("id", assetId);
    return json({ ok: true });
  }

  if (action === "submit_engineer") {
    const loaded = await loadToken();
    if ("error" in loaded && loaded.error) return loaded.error;
    const { row, form } = loaded as { row: { role: string }; form: Record<string, unknown> };
    if (row.role !== "engineer") return json({ error: "This link cannot submit the technical record." }, 403);
    const revision = await loadRevision(Number(form.id), Number(form.current_revision_no));
    if (!revision || revision.locked) return json({ ok: true, alreadySubmitted: true, revisionNo: form.current_revision_no });
    const answers = body.answers && typeof body.answers === "object" ? body.answers : revision.answers;
    const signature = body.signature && typeof body.signature === "object" ? body.signature : null;
    if (!signature) return json({ error: "Engineer signature is required." }, 400);
    const now = new Date().toISOString();
    const signed = { ...signature as Record<string, unknown>, signedAt: now, revisionNo: form.current_revision_no };
    await db.from("completion_form_revisions").update({
      answers,
      locked: true,
      engineer_signature: signed,
      engineer_signed_at: now,
    }).eq("id", revision.id);
    await db.from("completion_forms").update({
      status: "awaiting_review",
      submitted_at: now,
      updated_at: now,
    }).eq("id", form.id);
    await db.from("completion_form_events").insert({
      form_id: form.id,
      revision_no: form.current_revision_no,
      event_type: "engineer_submitted",
      detail: String((signature as { name?: string }).name ?? ""),
    });
    return json({ ok: true, revisionNo: form.current_revision_no, signedAt: now });
  }

  if (action === "customer_sign") {
    const loaded = await loadToken();
    if ("error" in loaded && loaded.error) return loaded.error;
    const { form } = loaded as { form: Record<string, unknown> };
    if (String(form.status) !== "awaiting_customer") {
      return json({ error: "This handover is not ready for the customer signature." }, 409);
    }
    const revision = await loadRevision(Number(form.id), Number(form.current_revision_no));
    if (!revision?.engineer_signature) return json({ error: "The engineer has not signed this revision." }, 409);
    if (revision.customer_signed_at) return json({ ok: true, alreadySigned: true });
    const signature = body.signature && typeof body.signature === "object" ? body.signature : null;
    if (!signature) return json({ error: "Customer signature is required." }, 400);
    const now = new Date().toISOString();
    const signed = { ...signature as Record<string, unknown>, signedAt: now, revisionNo: form.current_revision_no };
    await db.from("completion_form_revisions").update({
      customer_signature: signed,
      customer_signed_at: now,
    }).eq("id", revision.id);
    await db.from("completion_forms").update({
      status: "complete",
      completed_at: now,
      updated_at: now,
    }).eq("id", form.id);
    await db.from("completion_form_events").insert({
      form_id: form.id,
      revision_no: form.current_revision_no,
      event_type: "customer_signed",
      detail: String((signature as { name?: string }).name ?? ""),
    });
    return json({ ok: true, signedAt: now, revisionNo: form.current_revision_no });
  }

  if (action === "customer_correction") {
    const loaded = await loadToken();
    if ("error" in loaded && loaded.error) return loaded.error;
    const comment = String(body.comment ?? "").trim();
    if (!comment) return json({ error: "Say what needs to change." }, 400);
    const now = new Date().toISOString();
    await db.from("completion_forms").update({
      status: "returned",
      review_note: comment,
      updated_at: now,
    }).eq("id", (loaded as { form: { id: number } }).form.id);
    await db.from("completion_form_events").insert({
      form_id: (loaded as { form: { id: number } }).form.id,
      revision_no: (loaded as { form: { current_revision_no: number } }).form.current_revision_no,
      event_type: "customer_requested_correction",
      detail: comment,
    });
    return json({ ok: true });
  }

  if (action === "send_email") {
    const to = String(body.to ?? "").trim();
    const title = String(body.title ?? "CCTV completion form");
    const url = String(body.url ?? "");
    const company = String(body.company ?? "Pacific");
    if (!to || !url) return json({ error: "Recipient and link are required." }, 400);
    const emailed = await sendResendEmail({
      to,
      subject: `${title} — please complete`,
      text: `Please complete this form on your phone or tablet:\n\n${title}\n${url}\n\n${company}\nThis link is unique to this job.`,
    });
    return json({ emailed, provider: emailed ? "resend" : "not_configured" });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
