import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

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
  const question = String(body.question || "").trim();
  if (!question) return reply({ error: "Question is required" }, 400);

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier,daily_ai_questions,daily_ai_reset_date")
    .eq("id", user.id)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const premium = profile?.subscription_tier === "premium";
  const limit = premium ? 100 : 30;
  const used = profile?.daily_ai_reset_date === today
    ? Number(profile?.daily_ai_questions || 0)
    : 0;

  if (used >= limit) return reply({ error: "Daily AI question limit reached", limit }, 429);

  const context = body.context || {};
  const total = Number(context.totalExpenses || 0);
  const savings = Number(context.savings || 0);
  const topCategory = String(context.topCategory || "Other");

  let answer =
    `You have recorded ₹${Math.round(total).toLocaleString("en-IN")} in expenses and about ₹${Math.round(savings).toLocaleString("en-IN")} remains. Your largest recorded category is ${topCategory}. Add complete daily spending so I can spot patterns.`;

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (apiKey) {
    const prompt = [
      "You are Money Save's friendly financial education assistant.",
      "Be concise, non-judgmental and practical.",
      "Do not promise returns or make final financial decisions for the user.",
      `User question: ${question}`,
      `Expense total: ₹${total}`,
      `Estimated savings: ₹${savings}`,
      `Largest category: ${topCategory}`,
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-5-mini",
        input: prompt,
        max_output_tokens: 350,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.output_text) answer = data.output_text;
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ daily_ai_questions: used + 1, daily_ai_reset_date: today })
    .eq("id", user.id);

  if (error) return reply({ error: "Could not update AI usage" }, 500);
  return reply({ answer, used: used + 1, limit });
});
