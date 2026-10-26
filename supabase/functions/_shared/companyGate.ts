import { createClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Db = ReturnType<typeof createClient>;

export type CompanyCaller = {
  userId: string;
  role: "admin" | "staff";
  companyId: string;
};

/**
 * Service-role clients bypass row security. Call this before any company read or write.
 * Platform owner accounts are rejected: platform administration is not access to company records.
 */
export async function requireCompanyMember(
  req: Request,
  db: Db,
): Promise<{ caller: CompanyCaller } | { response: Response }> {
  const header = req.headers.get("Authorization") ?? "";
  const jwt = header.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return { response: json({ error: "Sign in required." }, 401) };

  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return { response: json({ error: "Sign in required." }, 401) };

  const { data: profile } = await db
    .from("app_profiles")
    .select("role, company_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!profile) return { response: json({ error: "No account profile." }, 403) };
  if (profile.role === "master" || !profile.company_id) {
    return { response: json({ error: "Platform owner accounts cannot open company records." }, 403) };
  }
  if (profile.role !== "admin" && profile.role !== "staff") {
    return { response: json({ error: "This action is not available for an end user." }, 403) };
  }

  const { data: company } = await db
    .from("platform_companies")
    .select("status")
    .eq("id", profile.company_id)
    .maybeSingle();
  if (!company || company.status !== "active") {
    return { response: json({ error: "This company account is suspended." }, 403) };
  }

  return {
    caller: {
      userId: data.user.id,
      role: profile.role,
      companyId: profile.company_id,
    },
  };
}

export async function projectInCompany(db: Db, projectId: number, companyId: string): Promise<boolean> {
  if (!Number.isFinite(projectId) || projectId <= 0) return false;
  const { data } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();
  return Boolean(data);
}

export async function brandForProject(db: Db, projectId: number) {
  const { data: project } = await db
    .from("projects")
    .select("company_id, contractor_profile_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project?.company_id) return null;

  if (project.contractor_profile_id) {
    const { data: assigned } = await db
      .from("contractor_profile")
      .select("company_name, logo_url, brand_primary, brand_ink, tagline, address_line1, telephone, email")
      .eq("id", project.contractor_profile_id)
      .eq("company_id", project.company_id)
      .maybeSingle();
    if (assigned) return { ...assigned, company_id: project.company_id };
  }

  const { data: fallback } = await db
    .from("contractor_profile")
    .select("company_name, logo_url, brand_primary, brand_ink, tagline, address_line1, telephone, email")
    .eq("company_id", project.company_id)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  return fallback
    ? { ...fallback, company_id: project.company_id }
    : {
      company_id: project.company_id,
      company_name: null,
      logo_url: null,
      brand_primary: null,
      brand_ink: null,
      tagline: null,
    };
}
