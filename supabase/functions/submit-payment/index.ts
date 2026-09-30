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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Invalid session" }, 401);

  const body = await req.json().catch(() => ({}));
  const plan = String(body.plan || "premium").slice(0, 40);
  const reference = String(body.transactionReference || "").trim().slice(0, 120);
  const screenshot = String(body.screenshotBase64 || "");
  const fileName = String(body.fileName || "payment.jpg").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);

  if (!reference && !screenshot) return reply({ error: "Transaction reference or screenshot is required" }, 400);
  if (screenshot && screenshot.length > 8_000_000) return reply({ error: "Screenshot is too large" }, 413);

  let screenshotPath: string | null = null;
  if (screenshot) {
    const match = screenshot.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
    if (!match) return reply({ error: "Only PNG, JPEG or WEBP screenshots are allowed" }, 400);
    const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
    screenshotPath = `${user.id}/${crypto.randomUUID()}-${fileName}`;
    const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(screenshotPath, bytes, {
      contentType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
      upsert: false,
    });
    if (uploadError) return reply({ error: "Could not securely store payment proof" }, 500);
  }

  const automated = reference.length >= 8 && /^[A-Za-z0-9._-]+$/.test(reference) && Boolean(screenshotPath || reference);
  const status = automated ? "automated_review" : "restricted";
  const reason = automated
    ? "Submitted for automated checks and human verification. Payment is not considered approved yet."
    : "Payment proof did not pass the initial format checks.";

  const { data, error } = await supabase.from("payment_submissions").insert({
    user_id: user.id,
    plan,
    amount: Number(body.amount || 0),
    transaction_reference: reference || null,
    screenshot_path: screenshotPath,
    status,
    review_reason: reason,
  }).select("id,status,review_reason,created_at").single();

  if (error) return reply({ error: error.message }, 500);
  return reply({ submission: data });
});
