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
  const income = Number(context.income || 0);
  const total = Number(context.totalExpenses || 0);
  const savings = Number(context.savings || 0);
  const savingsRate = Number(context.savingsRate || 0);
  const topCategory = String(context.topCategory || "Other");
  const categoryBreakdown = context.categoryBreakdown || {};
  const recentExpenses = Array.isArray(context.recentExpenses) ? context.recentExpenses.slice(0, 10) : [];
  const coins = Number(context.coins || 0);
  const challengeDays = Number(context.challengeDays || 0);

  const categoryText = Object.entries(categoryBreakdown)
    .map(([name, amount]) => `${name}: ₹${Math.round(Number(amount)).toLocaleString("en-IN")}`)
    .join(", ");
  const recentText = recentExpenses
    .map((e: any) => `${e.date || "date"} — ${e.merchant || "expense"} — ${e.category || "Other"} — ₹${Math.round(Number(e.amount) || 0).toLocaleString("en-IN")}`)
    .join("\n");

  let answer =
    `Based on the information available, you have recorded ₹${Math.round(total).toLocaleString("en-IN")} in expenses and about ₹${Math.round(savings).toLocaleString("en-IN")} remaining from ₹${Math.round(income).toLocaleString("en-IN")} income. Your current savings rate is about ${savingsRate}%, and ${topCategory} is the largest recorded category. I can give a more precise diagnosis as you add more spending history.`;

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (apiKey) {
    const prompt = [
      "You are Money Save's Financial Friend: a careful, context-aware personal finance education assistant.",
      "Before answering, reason privately through the user's question, income, expenses, category mix, recent transactions, savings rate and stated context. Check arithmetic and distinguish facts from estimates.",
      "Do not reveal private chain-of-thought or hidden reasoning. Give the user the useful conclusion and a brief explanation of the key factors.",
      "Do not jump to conclusions from one transaction. Look for repeated patterns, unusually large expenses, category concentration, cash-flow pressure and goal impact when the data supports it.",
      "If the data is insufficient, say exactly what is missing and ask at most one focused follow-up question.",
      "Prefer concrete numbers, comparisons and small actionable next steps. For spending questions, explain WHY the pattern matters and what could change it.",
      "For purchase decisions, assess affordability, necessity, opportunity cost and effect on the user's stated savings position; do not make the final decision for them.",
      "For investing, explain risk, fees, downside and uncertainty; never guarantee returns or present an estimate as a promise.",
      "For business/income ideas, separate startup cost, potential range, assumptions and risks; never guarantee income.",
      "Be warm, non-judgmental, clear and concise. Use INR and Indian numbering.",
      `User question: ${question}`,
      `Monthly/current income: ₹${income}`,
      `Recorded expenses: ₹${total}`,
      `Estimated remaining savings: ₹${savings}`,
      `Current savings rate: ${savingsRate}%`,
      `Largest category: ${topCategory}`,
      `Category breakdown: ${categoryText || "No category breakdown available"}`,
      `Recent expenses:\n${recentText || "No recent expenses available"}`,
      `Coins: ${coins}; savings challenge days completed: ${challengeDays}`,
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
        max_output_tokens: 500,
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
