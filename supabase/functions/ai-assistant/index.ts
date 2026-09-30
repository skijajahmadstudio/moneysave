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
  const conversationMemory = Array.isArray(context.conversationMemory) ? context.conversationMemory.slice(-8) : [];
  const monthlyPattern = context.monthlyPattern || {};

  const categoryText = Object.entries(categoryBreakdown)
    .map(([name, amount]) => `${name}: ₹${Math.round(Number(amount)).toLocaleString("en-IN")}`)
    .join(", ");
  const memoryText = conversationMemory
    .map((m: any) => `${m.role === "user" ? "User" : "AI"}: ${String(m.text || "").slice(0, 500)}`)
    .join("\\n");
  const recentText = recentExpenses
    .map((e: any) => `${e.date || "date"} — ${e.merchant || "expense"} — ${e.category || "Other"} — ₹${Math.round(Number(e.amount) || 0).toLocaleString("en-IN")}`)
    .join("\\n");

  const bengali = /[\\u0980-\\u09FF]/.test(question);
  const q = question.toLowerCase();
  const topAmount = Number(categoryBreakdown?.[topCategory] || 0);
  const topShare = total > 0 ? Math.round((topAmount / total) * 100) : 0;
  const recentSum = recentExpenses.reduce((sum: number, e: any) => sum + (Number(e.amount) || 0), 0);
  const formatMoney = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

  let answer = bengali
    ? `আপনার রেকর্ডে আয় ${formatMoney(income)}, খরচ ${formatMoney(total)}, এবং অবশিষ্ট আনুমানিক ${formatMoney(savings)}।`
    : `Your records show income of ${formatMoney(income)}, spending of ${formatMoney(total)}, and about ${formatMoney(savings)} remaining.`;

  if (/কেন|কোথায়|কোথায়|why|ran out|শেষ/.test(q)) {
    answer += topAmount > 0
      ? (bengali ? ` সবচেয়ে বড় খরচের category হলো ${topCategory} — ${formatMoney(topAmount)} (${topShare}%)। সাম্প্রতিক ১০টি খরচে মোট ${formatMoney(recentSum)} আছে।` : ` The largest category is ${topCategory} at ${formatMoney(topAmount)} (${topShare}%). Your latest 10 recorded expenses total ${formatMoney(recentSum)}.`)
      : (bengali ? " এখনও যথেষ্ট expense history নেই, তাই কারণ নির্ভরযোগ্যভাবে বলা যাবে না।" : " There is not enough expense history yet to identify the main cause reliably.");
  } else if (/save|saving|সঞ্চয়|সঞ্চয়|বাঁচ|কম খরচ|reduce/.test(q)) {
    const target = Math.max(0, Math.round(income * 0.1));
    answer += bengali
      ? ` প্রথম লক্ষ্য হিসেবে ${formatMoney(target)} আলাদা রাখার চেষ্টা করতে পারেন। সবচেয়ে বড় category ${topCategory} হলে সেটির recurring খরচ আগে পর্যালোচনা করুন।`
      : ` A useful first target is to protect about ${formatMoney(target)} for savings. If ${topCategory} is recurring, review that category first.`;
  } else if (/budget|বাজেট|plan|পরিকল্পনা/.test(q)) {
    const weekly = Math.max(0, Math.round(Math.max(income - Math.max(0, savings), 0) / 4));
    answer += bengali
      ? ` আপনার বর্তমান recorded numbers ধরে ৪ সপ্তাহে ভাগ করলে প্রায় ${formatMoney(weekly)}/সপ্তাহ spending ceiling দিয়ে শুরু করা যায়; essential খরচ আলাদা রাখবেন।`
      : ` Based on the current recorded numbers, a starting weekly spending ceiling is about ${formatMoney(weekly)} across four weeks, while keeping essential costs separate.`;
  } else if (/purchase|buy|কিনব|কেনা|কেনবো|কেনার/.test(q)) {
    answer += bengali
      ? " কেনার দাম ও কী কারণে কিনবেন—এই দুই তথ্য দিলে affordability, savings impact এবং opportunity cost মিলিয়ে হিসাব করা যাবে।"
      : " Give me the purchase price and purpose; I can compare affordability, savings impact, and opportunity cost.";
  } else if (/salary|income|আয়|আয়|ইনকাম|বেতন/.test(q)) {
    answer += bengali
      ? ` বর্তমান recorded surplus প্রায় ${formatMoney(Math.max(0, income - total))}। এটি emergency fund, goal এবং discretionary spending-এ ভাগ করা যায়।`
      : ` The current recorded surplus is about ${formatMoney(Math.max(0, income - total))}. That can be split between an emergency fund, goals, and discretionary spending.`;
  } else if (/emergency|জরুরি|emergency fund|ফান্ড/.test(q)) {
    const target = Math.max(monthlyPattern?.total || total, 0) * 3;
    answer += bengali
      ? ` recorded monthly spendingকে rough baseline ধরলে ৩ মাসের illustrative emergency fund প্রায় ${formatMoney(target)}; essential spending আলাদা করলে হিসাব আরও নির্ভুল হবে।`
      : ` Using recorded monthly spending as a rough baseline, a 3-month illustrative emergency fund is about ${formatMoney(target)}; separating essentials would make it more accurate.`;
  } else if (/invest|stock|mutual|fd|gold|etf|শেয়ার|শেয়ার|মিউচুয়াল|মিউচুয়াল|বিনিয়োগ|বিনিয়োগ/.test(q)) {
    answer += bengali
      ? " বিনিয়োগের প্রশ্নে আমি return-এর সঙ্গে risk, fees, liquidity, tax এবং time horizon মিলিয়ে দেখব। নির্দিষ্ট পণ্য/নাম দিলে আলাদা করে বিশ্লেষণ করা যাবে।"
      : " For investing, I would compare return with risk, fees, liquidity, taxes, and time horizon. Give me the specific product or name for a focused analysis.";
  } else if (/debt|loan|ঋণ|লোন|কিস্তি|emi/.test(q)) {
    answer += bengali
      ? " ঋণ বিশ্লেষণের জন্য outstanding amount, interest rate, EMI এবং due date দরকার। এগুলো দিলে repayment options তুলনা করা যাবে।"
      : " For debt analysis, I need the outstanding amount, interest rate, EMI, and due date to compare repayment options.";
  } else if (/business|income idea|ব্যবসা|আয় করার|আয় করার|side income/.test(q)) {
    answer += bengali
      ? " ব্যবসা/side-income idea দিতে আপনার budget, available time এবং skills জানা দরকার। এগুলো দিলে startup cost, সম্ভাব্য range ও risk আলাদা করে দেখাতে পারব।"
      : " For a business or side-income idea, I need your budget, available time, and skills so I can separate startup cost, potential range, and risks.";
  } else if (/hello|hi|হাই|হ্যালো|নমস্কার/.test(q)) {
    answer += bengali ? " আমি আপনার আয়-খরচের হিসাব দেখে প্রশ্নের উত্তর দিতে প্রস্তুত।" : " I’m ready to answer questions using your income and spending data.";
  } else {
    answer += bengali
      ? ` আপনার savings rate ${savingsRate}% এবং সবচেয়ে বড় category ${topCategory}। প্রশ্নটি নির্দিষ্ট amount/goal/expense দিয়ে করলে আমি সরাসরি হিসাব দেখাতে পারব।`
      : ` Your savings rate is ${savingsRate}% and your largest category is ${topCategory}. Add the amount, goal, or expense involved and I can calculate it directly.`;
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (apiKey) {
    const prompt = [
      "You are Money Save's Financial Friend: a careful, context-aware personal finance education assistant.",
      "Before answering, reason privately through the user's question, income, expenses, category mix, recent transactions, savings rate and stated context. Check arithmetic and distinguish facts from estimates.",
      "Do not reveal private chain-of-thought or hidden reasoning. Give the user the useful conclusion and a brief explanation of the key factors.",
      "Do not jump to conclusions from one transaction. Look for repeated patterns, unusually large expenses, category concentration, cash-flow pressure and goal impact when the data supports it.",
      "Do not rush to the first plausible answer. Internally work through the problem in stages: identify intent, verify the relevant numbers, inspect patterns and counterevidence, consider uncertainty and trade-offs, then answer. For substantive questions, include the conclusion, 2–3 evidence-based factors, one uncertainty or trade-off when relevant, and one practical next step.",

      "Use the recent conversation memory to keep continuity, but treat current financial numbers as the source of truth. Do not invent facts that are not in the current context.",
      "If the data is insufficient, say exactly what is missing and ask at most one focused follow-up question.",
      "Prefer concrete numbers, comparisons and small actionable next steps. For spending questions, explain WHY the pattern matters and what could change it.",
      "For purchase decisions, assess affordability, necessity, opportunity cost and effect on the user's stated savings position; do not make the final decision for them.",
      "For investing, explain risk, fees, downside and uncertainty; never guarantee returns or present an estimate as a promise.",
      "For business/income ideas, separate startup cost, potential range, assumptions and risks; never guarantee income.",
      "Be warm, non-judgmental, clear and concise. Use INR and Indian numbering.",
      "If the user's question contains Bengali, answer entirely in natural Bengali (বাংলা). Do not switch to English except for unavoidable product names, numbers, ticker symbols or standard financial terms. If the user writes in English, answer in English.",
      "Never give a rushed shallow answer when the question requires analysis; take the necessary internal reasoning time before responding.",

      `User question: ${question}`,
      `Monthly/current income: ₹${income}`,
      `Recorded expenses: ₹${total}`,
      `Estimated remaining savings: ₹${savings}`,
      `Current savings rate: ${savingsRate}%`,
      `Largest category: ${topCategory}`,
      `Category breakdown: ${categoryText || "No category breakdown available"}`,
      `Recent expenses:
${recentText || "No recent expenses available"}`,
      `Coins: ${coins}; savings challenge days completed: ${challengeDays}`,
      `Monthly pattern: ${JSON.stringify(monthlyPattern)}`,
      `Recent conversation:
${memoryText || "No prior conversation available"}`,
    ].join("\\n");

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
