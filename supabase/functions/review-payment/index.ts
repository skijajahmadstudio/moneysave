import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return reply({ error: "Authentication required" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user } } = await admin.auth.getUser();
  if (!user) return reply({ error: "Invalid session" }, 401);

  const { data: actor } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!actor || !["owner", "verification"].includes(actor.role)) return reply({ error: "Verification access required" }, 403);

  const body = await req.json().catch(() => ({}));
  const submissionId = String(body.submissionId || "");
  const decision = String(body.decision || "");
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (!submissionId || !["approved", "rejected", "restricted"].includes(decision)) return reply({ error: "Invalid review request" }, 400);

  const { data: submission } = await admin.from("payment_submissions").select("*").eq("id", submissionId).single();
  if (!submission) return reply({ error: "Submission not found" }, 404);

  if (decision === "approved") {
    const { error: profileError } = await admin.from("profiles").update({
      subscription_tier: "premium",
      premium_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq("id", submission.user_id);
    if (profileError) return reply({ error: profileError.message }, 500);
  }

  const { error } = await admin.from("payment_submissions").update({
    status: decision,
    review_reason: reason || (decision === "approved" ? "Payment verified by authorized reviewer." : "Payment not approved."),
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", submissionId);

  if (error) return reply({ error: error.message }, 500);

  await admin.from("audit_logs").insert({
    actor_user_id: user.id,
    action: `payment_${decision}`,
    target_user_id: submission.user_id,
    metadata: { submission_id: submissionId, reason },
  });

  return reply({ ok: true, status: decision });
});
