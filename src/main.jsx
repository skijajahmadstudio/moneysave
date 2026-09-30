import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { supabase, supabaseConfigured } from "./lib/supabaseClient";

const OWNER_EMAIL = "skijajahmadstudio@gmail.com";
const SUPPORT_EMAIL = "skijajahmadsupportstudio@gmail.com";
const seedExpenses = [
  { id: "1", merchant: "Grocery", category: "Food", amount: 1450, date: "2026-09-28" },
  { id: "2", merchant: "Transport", category: "Transport", amount: 620, date: "2026-09-27" },
  { id: "3", merchant: "Online Shopping", category: "Shopping", amount: 1890, date: "2026-09-25" },
  { id: "4", merchant: "Electricity", category: "Bills", amount: 980, date: "2026-09-22" },
];
const money = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => "MS-" + Math.random().toString(36).slice(2, 10).toUpperCase();

function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("home");
  const [income, setIncome] = useState(0);
  const [expenses, setExpenses] = useState([]);
  const [coins, setCoins] = useState(0);
  const [premium, setPremium] = useState(false);
  const [userId, setUserId] = useState("");
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState(() => JSON.parse(localStorage.getItem("ms_chat") || "null") || [{ role: "ai", text: "Hello! I’m your AI Financial Friend. Ask me about spending, saving, goals, or a purchase." }]);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [research, setResearch] = useState({ type: "stock", name: "", amount: 10000, years: 5, rate: 10, risk: "medium" });
  const [business, setBusiness] = useState({ capital: 10000, skill: "online sales" });
  const [payment, setPayment] = useState({ reference: "", amount: "", file: null, status: "Not submitted" });
  const [paymentQueue, setPaymentQueue] = useState([]);
  const [challengeDays, setChallengeDays] = useState(0);
  const [checkin, setCheckin] = useState({ amount: "", purpose: "", need: "yes" });
  const [liveOpen, setLiveOpen] = useState(false);
  const [goal, setGoal] = useState(null);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !supabase) return;
    let cancelled = false;
    (async () => {
      const [profileRes, expensesRes, incomesRes, goalsRes] = await Promise.all([
        supabase.from("profiles").select("user_id,coins,subscription_tier").eq("id", session.user.id).single(),
        supabase.from("expenses").select("id,merchant,category,amount,spent_at,notes").eq("user_id", session.user.id).order("spent_at", { ascending: false }).limit(500),
        supabase.from("incomes").select("id,source,amount,received_at").eq("user_id", session.user.id).order("received_at", { ascending: false }).limit(100),
        supabase.from("savings_goals").select("id,title,target_amount,current_amount,target_date").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(1),
      ]);
      if (cancelled) return;
      if (profileRes.data) {
        setUserId(profileRes.data.user_id || ("MS-" + session.user.id.slice(0, 8).toUpperCase()));
        setCoins(Number(profileRes.data.coins || 0));
        setPremium(profileRes.data.subscription_tier === "premium");
      } else {
        setUserId("MS-" + session.user.id.slice(0, 8).toUpperCase());
      }
      if (expensesRes.data) setExpenses(expensesRes.data.map(e => ({ ...e, date: e.spent_at, amount: Number(e.amount) })));
      if (incomesRes.data) setIncome(incomesRes.data.reduce((s, e) => s + Number(e.amount || 0), 0));
      if (goalsRes.data?.[0]) setGoal(goalsRes.data[0]);
    })();
    return () => { cancelled = true; };
  }, [session]);


  const notify = text => { setToast(text); window.clearTimeout(window.__msToast); window.__msToast = window.setTimeout(() => setToast(""), 2800); };
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const savings = Math.max(income - total, 0);
  const cats = useMemo(() => expenses.reduce((a, e) => { a[e.category] = (a[e.category] || 0) + Number(e.amount); return a; }, {}), [expenses]);
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  const isOwner = session?.user?.email?.toLowerCase() === OWNER_EMAIL;
  const aiLimit = premium ? 100 : 30;
  const monthKey = today().slice(0, 7);
  const monthExpenses = expenses.filter(e => String(e.date || "").slice(0, 7) === monthKey);
  const monthTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const monthCats = monthExpenses.reduce((a, e) => { a[e.category] = (a[e.category] || 0) + Number(e.amount || 0); return a; }, {});
  const monthTop = Object.entries(monthCats).sort((a, b) => b[1] - a[1])[0];
  const monthSavingsRate = income > 0 ? Math.round(Math.max(income - monthTotal, 0) / income * 100) : 0;
  const monthTopShare = monthTotal > 0 && monthTop ? Math.round(Number(monthTop[1]) / monthTotal * 100) : 0;
  const proactiveAlerts = [];
  if (income > 0 && monthTotal >= income * 0.8) proactiveAlerts.push(`Spending has reached ${Math.round(monthTotal / income * 100)}% of income.`);
  if (income > 0 && monthSavingsRate < 20) proactiveAlerts.push(`Your current savings rate is ${monthSavingsRate}%; review discretionary spending.`);
  if (monthTop && monthTopShare >= 35) proactiveAlerts.push(`${monthTop[0]} is ${monthTopShare}% of this month’s recorded spending.`);
  const largestRecent = [...monthExpenses].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  if (largestRecent && income > 0 && Number(largestRecent.amount) >= income * 0.1) proactiveAlerts.push(`${largestRecent.merchant} is a large single expense at ${money(largestRecent.amount)}.`);
  const questionsUsed = chat.filter(x => x.role === "user").length;

  const addIncome = async () => {
    if (!session || !supabase) return notify("Please sign in first.");
    const amount = Number(window.prompt("Income amount (₹)") || 0);
    if (!amount || amount <= 0) return;
    const source = window.prompt("Income source", "Salary") || "Income";
    const { error } = await supabase.from("incomes").insert({ user_id: session.user.id, source, amount, received_at: today() });
    if (error) return notify(error.message);
    setIncome(x => x + amount);
    notify("Income saved securely.");
  };

  const addExpense = async (prefill = {}) => {
    if (!session || !supabase) return notify("Please sign in first.");
    const amount = Number(prefill.amount ?? (window.prompt("Expense amount (₹)") || 0));
    if (!amount || amount <= 0) return;
    const merchant = prefill.merchant ?? window.prompt("What was it for?") ?? "Expense";
    const category = prefill.category ?? "Other";
    const { data, error } = await supabase.from("expenses").insert({
      user_id: session.user.id, merchant, category, amount, spent_at: today()
    }).select("id,merchant,category,amount,spent_at").single();
    if (error) return notify(error.message);
    setExpenses(x => [{ ...data, date: data.spent_at, amount: Number(data.amount) }, ...x]);
    const { data: newBalance, error: coinError } = await supabase.rpc("apply_coin_ledger", {
      p_user_id: session.user.id, p_amount: 250, p_source: "saving", p_reason: "Expense logged for verified spending record", p_reference_id: data.id
    });
    if (!coinError && Number.isFinite(Number(newBalance))) setCoins(Number(newBalance));
    notify("Expense saved securely.");
  };

  const askAI = async () => {
    if (!question.trim()) return;
    if (questionsUsed >= aiLimit) return notify("Daily AI question limit reached.");

    const asked = question;
    const q = asked.toLowerCase();
    const isBengali = /[\u0980-\u09FF]/.test(asked);
    const savingsRate = income > 0 ? Math.round((savings / income) * 100) : 0;
    const topAmount = top ? Number(top[1]) : 0;
    const topShare = total > 0 ? Math.round((topAmount / total) * 100) : 0;
    const recentTotal = expenses.slice(0, 5).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const avgRecent = expenses.length ? Math.round(total / expenses.length) : 0;

    let answer = isBengali
      ? `আমি আগে আপনার বর্তমান হিসাব মিলিয়ে দেখছি: আয় ${money(income)}, রেকর্ড করা খরচ ${money(total)}, আনুমানিক সঞ্চয় ${money(savings)}, এবং সঞ্চয়ের হার ${savingsRate}%।`
      : `I checked your current numbers: income ${money(income)}, recorded spending ${money(total)}, estimated savings ${money(savings)}, and a ${savingsRate}% savings rate.`;
    if (!expenses.length) {
      answer += isBengali
        ? " নির্ভরযোগ্য খরচের ধরণ ধরতে আরও কিছু spending history দরকার।"
        : " I need a little more spending history before I can identify a reliable pattern.";
    } else if (/why|ran out|শেষ|কোথায়|কেন/.test(q)) {
      answer += top
        ? (isBengali
          ? ` এখন আপনার সবচেয়ে বড় খরচের বিভাগ ${top[0]} — ${money(topAmount)}, অর্থাৎ মোট রেকর্ড করা খরচের ${topShare}%। সাম্প্রতিক ৫টি খরচ মিলিয়ে ${money(recentTotal)}। তাই একটি মাত্র কেনাকাটাকে দোষ না দিয়ে পুনরাবৃত্ত খরচের ধরণ দেখা বেশি যুক্তিযুক্ত।`
          : ` ${top[0]} is currently your largest category at ${money(topAmount)} (${topShare}% of recorded spending). The recent 5 expenses total ${money(recentTotal)}. That suggests we should inspect repeated spending rather than blame one purchase.`)
        : (isBengali ? " আপনার খরচের ইতিহাস এখনও খুব ছোট, তাই শক্তিশালী pattern বলা যাচ্ছে না।" : " Your spending history is still too small to identify a strong pattern.");
    } else if (/save|saving|reduce|কম|বাঁচ|সঞ্চয়/.test(q)) {
      const target = Math.max(0, Math.round(income * 0.1));
      answer += isBengali
        ? ` একটি বাস্তবসম্মত পরবর্তী লক্ষ্য হলো এই মাসে discretionary খরচের আগে অন্তত ${money(target)} আলাদা করে রাখা। আগে ${top ? top[0] : "সবচেয়ে বড় খরচের বিভাগ"} দেখুন এবং সাপ্তাহিক সীমা ঠিক করুন। বর্তমানে আনুমানিক সঞ্চয় ${money(savings)}।`
        : `A practical next target is to protect at least ${money(target)} this month before discretionary spending. Start by reviewing ${top ? top[0] : "your largest category"} and setting a weekly limit. Your current savings are ${money(savings)}.`;
    } else if (/purchase|buy|কিনব|কেনা|কেনবো/.test(q)) {
      answer += isBengali
        ? " কেনাকাটার সিদ্ধান্তে দাম ও উদ্দেশ্য জানালে আমি আপনার বর্তমান cash position, সঞ্চয়ের লক্ষ্য এবং সাম্প্রতিক খরচের ধরণ মিলিয়ে দেখব—শুধু দামের ভিত্তিতে বিচার করব না।"
        : " For a purchase decision, I need the price and purpose. I will compare it with your current cash position, savings target and recent spending pattern instead of judging the purchase from price alone.";
    } else if (/budget|plan|বাজেট|পরিকল্পনা/.test(q)) {
      answer += isBengali
        ? ` প্রতি expense entry-তে গড় খরচ প্রায় ${money(avgRecent)}। essentials ও discretionary খরচ আলাদা করে সবচেয়ে বড় category-র জন্য weekly cap সেট করা ভালো পরবর্তী ধাপ।`
        : `Your recorded average expense is about ${money(avgRecent)} per entry. A useful next step is to separate essentials from discretionary spending and set a weekly cap for the largest category.`;
    } else if (/salary|income|আয়|ইনকাম|বেতন/.test(q)) {
      const suggested = Math.max(0, income - total);
      answer += isBengali
        ? `আপনার রেকর্ড অনুযায়ী আয় ${money(income)} এবং খরচ ${money(total)}; পার্থক্য ${money(suggested)}। আপনি চাইলে আমি এই টাকাটা emergency fund, goal এবং discretionary budget-এ ভাগ করে একটি মাসিক plan বানাতে পারি।`
        : `Your recorded income is ${money(income)} and spending is ${money(total)}, leaving about ${money(suggested)} before other unrecorded costs. I can turn that into a monthly emergency-fund, goal and discretionary budget plan.`;
    } else if (/emergency|জরুরি|ফান্ড/.test(q)) {
      const monthlyNeed = Math.max(monthTotal, total, 0);
      const target = Math.round(monthlyNeed * 3);
      answer += isBengali
        ? `আপনার বর্তমান recorded spending ${money(monthlyNeed)} ধরে ৩ মাসের একটি illustrative emergency-fund target প্রায় ${money(target)}। আপনার বাস্তব essential monthly cost জানলে target আরও নির্ভুল হবে।`
        : `Using your recorded spending of ${money(monthlyNeed)} as a rough baseline, a 3-month illustrative emergency-fund target is about ${money(target)}. It becomes more accurate if we separate essential monthly costs from discretionary spending.`;
    } else if (/invest|stock|mutual|fd|gold|শেয়ার|মিউচুয়াল|বিনিয়োগ/.test(q)) {
      answer += isBengali
        ? " বিনিয়োগের ক্ষেত্রে আমি return-এর পাশাপাশি downside, fees, tax, liquidity এবং আপনার সময়সীমা দেখব। শুধু একটি সম্ভাব্য return দেখে সিদ্ধান্ত নেওয়া উচিত নয়।"
        : "For investing, I would compare potential return with downside risk, fees, taxes, liquidity and your time horizon. A possible return alone is not enough to evaluate an investment.";
    } else if (/debt|loan|ঋণ|লোন|কিস্তি/.test(q)) {
      answer += isBengali
        ? " ঋণ নিয়ে বললে বাকি principal, interest rate, EMI এবং due date দরকার। এগুলো দিলে আমি interest cost, cash-flow pressure এবং repayment options তুলনা করে দেখাতে পারি।"
        : "For debt, the key inputs are outstanding principal, interest rate, EMI and due date. With those, I can compare interest cost, cash-flow pressure and repayment options.";
    } else {
      answer += top
        ? (isBengali
          ? `আপনার বর্তমান ডেটায় ${top[0]} সবচেয়ে বড় category: ${money(topAmount)} (${topShare}%)। মোট সঞ্চয় ${money(savings)}। এই তথ্য থেকে সবচেয়ে ব্যবহারযোগ্য পরবর্তী পদক্ষেপ হলো ${top[0]}-এর recurring খরচ আলাদা করে দেখা এবং একটি সীমা সেট করা।`
          : `Your largest recorded category is ${top[0]} at ${money(topAmount)} (${topShare}%), with about ${money(savings)} remaining from the recorded income. A useful next step is to identify recurring ${top[0]} spending and set a clear limit.`)
        : (isBengali ? "আপনার প্রশ্নটি বুঝেছি। নির্দিষ্ট amount, goal বা expense-এর নাম দিলে আমি সরাসরি হিসাব করে বলব।" : "I understand the question. Give me the amount, goal or expense involved and I’ll calculate the relevant trade-offs directly.");
    }

    if (supabaseConfigured && session) {
      try {
        const { data, error } = await supabase.functions.invoke("ai-assistant", {
          body: {
            question: asked,
            context: {
              income,
              totalExpenses: total,
              savings,
              savingsRate: income > 0 ? Math.round((savings / income) * 100) : 0,
              topCategory: top ? top[0] : "Other",
              categoryBreakdown: Object.fromEntries(
                Object.entries(cats).map(([name, amount]) => [name, Math.round(amount)])
              ),
              recentExpenses: expenses.slice(0, 10).map(e => ({
                merchant: e.merchant,
                category: e.category,
                amount: Number(e.amount),
                date: e.date,
              })),
              coins,
              premium,
              challengeDays,
              dailyCheckin: checkin,
              conversationMemory: chat.slice(-8),
              monthlyPattern: { month: monthKey, total: monthTotal, savingsRate: monthSavingsRate, topCategory: monthTop ? monthTop[0] : "Other", topCategoryShare: monthTopShare, alerts: proactiveAlerts },
            },
          },
        });
        if (!error && data?.answer) {
          answer = data.answer;
          setChat(x => [...x, { role: "user", text: asked }, { role: "ai", text: answer }]);
          setQuestion("");
          return;
        }
      } catch {
        // Keep the local fallback available if the Edge Function is not deployed yet.
      }
    }

    setChat(x => [...x, { role: "user", text: asked }, { role: "ai", text: answer }]);
    setQuestion("");
  };

  const logCheckin = () => {
    const amount = Number(checkin.amount);
    if (!amount || !checkin.purpose) return notify("Enter amount and purpose first.");
    addExpense({ amount, merchant: checkin.purpose, category: "Daily Check-in" });
    setCheckin({ amount: "", purpose: "", need: "yes" });
  };

  const runResearch = () => {
    const P = Number(research.amount), r = Number(research.rate) / 100, y = Number(research.years);
    const future = P * Math.pow(1 + r, y);
    const doubling = r > 0 ? Math.log(2) / Math.log(1 + r) : Infinity;
    setModal({ title: "Research estimate", body: [
      `Illustrative value after ${y} years at ${research.rate}%: ${money(future)}.`,
      `Illustrative doubling time at that rate: ${Number.isFinite(doubling) ? doubling.toFixed(1) + " years" : "not available"}.`,
      `Risk setting: ${research.risk}. Actual returns, fees, taxes and losses vary by product and market.`,
      "This is an educational calculator, not a guaranteed return or investment recommendation."
    ]});
  };

  const runBusiness = () => {
    const capital = Number(business.capital);
    const ranges = capital < 10000 ? "₹3,000–₹12,000/month potential range" : capital < 50000 ? "₹8,000–₹30,000/month potential range" : "₹15,000–₹60,000/month potential range";
    setModal({ title: "Business idea plan", body: [
      `Skill: ${business.skill || "general"}; starting capital: ${money(capital)}.`,
      `Illustrative income range: ${ranges}; this is not a promise.`,
      "Start with one small offer, validate with 5–10 customers, track acquisition cost, margin and repeat orders. Keep business money separate from personal spending.",
      "Risks: demand, competition, refunds, platform fees and working-capital needs."
    ]});
  };

  const submitPayment = async () => {
    if (!session || !supabase) return notify("Please sign in first.");
    if (!payment.reference && !payment.file) return notify("Add a transaction reference or payment screenshot.");
    const paymentAmount = Number(payment.amount || 0);
    if (!paymentAmount || paymentAmount <= 0) return notify("Enter the amount you paid.");
    let screenshotBase64 = "";
    if (payment.file) {
      if (!payment.file.type.startsWith("image/")) return notify("Please upload an image.");
      if (payment.file.size > 5 * 1024 * 1024) return notify("Screenshot must be under 5 MB.");
      screenshotBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(payment.file);
      });
    }
    setPayment(p => ({ ...p, status: "Submitting…" }));
    const { data, error } = await supabase.functions.invoke("submit-payment", {
      body: {
        plan: "premium",
        amount: paymentAmount,
        transactionReference: payment.reference,
        screenshotBase64,
        fileName: payment.file?.name || "payment.jpg",
      },
    });
    if (error) return setPayment(p => ({ ...p, status: "Submission failed" }));
    setPayment(p => ({ ...p, status: data?.submission?.status === "automated_review" ? "Automated Review → Human Review" : "Restricted" }));
    notify("Payment proof submitted securely. Approval happens only after verification.");
  };

  const claimReward = threshold => {
    if (coins < threshold) return notify(`You need ${threshold.toLocaleString()} coins for this tier.`);
    setModal({ title: "Reward verification", body: [
      `You are eligible to submit the ₹${threshold === 30000 ? 10 : 30} claim for review.`,
      "Verification asks for account-holder name, IFSC, bank account details and bank proof.",
      "Status will move through Submitted → Verified → Paid, or Pending/Rejected/Payment Failed. Eligibility does not guarantee payment."
    ]});
  };

  const scanReceipt = async file => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setReceipt({ name: file.name, url, status: "OCR running…", text: "" });
    try {
      if (!window.Tesseract) throw new Error("OCR engine unavailable");
      const result = await window.Tesseract.recognize(file, "eng");
      const text = result?.data?.text || "";
      const amounts = [...text.matchAll(/(?:₹|Rs\\.?|INR\\s*)\\s*([0-9]{1,7}(?:[,.][0-9]{1,2})?)/gi)].map(m => Number(m[1].replace(/,/g, "")));
      const totalGuess = amounts.length ? Math.max(...amounts) : "";
      setReceipt(r => ({ ...r, status: "OCR complete — confirm before saving", text, totalGuess }));
      notify(totalGuess ? `Receipt read. Suggested total ${money(totalGuess)} — confirm it.` : "Receipt text read. Confirm the total manually.");
    } catch (e) {
      setReceipt(r => ({ ...r, status: "OCR unavailable — manual confirmation needed" }));
      notify("OCR could not read this receipt; manual confirmation is available.");
    }
  };

  const nav = [["home","Home"],["expenses","Expenses"],["challenge","Challenge"],["research","Research"],["rewards","Rewards"],["live","Live"],["profile","Profile"],...(isOwner || !supabaseConfigured ? [["admin","Admin"]] : [])];

  return <div className="app">
    <header>
      <div className="brand"><div className="logo">MS</div><div><b>Money Save</b><small>Save • Secure • Grow</small></div></div>
      <div className="headerMeta"><span className={premium ? "badge premium" : "badge"}>{premium ? "PREMIUM" : "FREE"}</span><span>🪙 {coins.toLocaleString()}</span>{supabaseConfigured && session && <button className="signout" onClick={() => supabase.auth.signOut()}>Sign out</button>}</div>
    </header>

    <main>
      {supabaseConfigured && !session && <section className="authGate"><div className="panel authCard"><label>SECURE ACCOUNT</label><h1>Sign in to Money Save</h1><p>Sign in securely to keep your expenses, income, coins and rewards tied to your account.</p><button onClick={async () => { const email = window.prompt("Enter your email"); if (!email) return; const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } }); notify(error ? error.message : "Check your email for the secure sign-in link."); }}>Email sign-in link</button><button className="secondary" onClick={async () => { const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } }); if (error) notify(error.message); }}>Continue with Google</button></div></section>}

      {tab === "home" && <section className="page">
        <div className="hero"><div><label>GOOD MONEY HABITS</label><h1>Make every rupee count.</h1><p>Save your money, secure it, and watch your future savings grow.</p></div><div className="heroActions"><button onClick={() => addExpense()}>+ Add Expense</button><button className="secondary" onClick={addIncome}>+ Add Income</button></div></div>
        <div className="cards">{[["Total income",money(income),"This month"],["Total expenses",money(total),expenses.length+" recorded"],["Estimated savings",money(savings),Math.round(savings / Math.max(income,1) * 100)+"% savings rate"],["Goal progress",Math.min(100,Math.round(savings/30000*100))+"%","Goal ₹30,000"]].map(x=><div className="card" key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong><small>{x[2]}</small></div>)}</div>
        <div className="cols">
          <div className="panel"><div className="panelTitle"><h2>AI Financial Friend</h2><em>● Online</em></div><div className="chat">{chat.slice(-6).map((m,i)=><div className={"msg "+m.role} key={i}>{m.text}</div>)}</div><div className="ask"><input value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>e.key==="Enter"&&askAI()} placeholder="Ask about your money…"/><button onClick={askAI}>Ask</button></div><small className="hint">{questionsUsed}/{aiLimit} questions today</small></div>
          <div className="panel"><div className="panelTitle"><h2>AI proactive alerts</h2><span className="pill">LIVE</span></div>{proactiveAlerts.length ? <ul className="alerts">{proactiveAlerts.map((x,i)=><li key={i}>{x}</li>)}</ul> : <p>No strong warning right now. Keep logging expenses so the AI can detect patterns earlier.</p>}<hr/><div className="panelTitle"><h2>Spending insight</h2><span className="pill">AI</span></div><div className="insight"><div className="ring">{top ? Math.round(top[1]/Math.max(total,1)*100) : 0}%</div><div><b>{top ? top[0] : "No data yet"}</b><p>Your highest recorded spending category. Review non-essential purchases here first.</p></div></div><hr/><h3>Daily check-in</h3><div className="formGrid"><input value={checkin.amount} onChange={e=>setCheckin({...checkin,amount:e.target.value})} placeholder="Spent today ₹"/><input value={checkin.purpose} onChange={e=>setCheckin({...checkin,purpose:e.target.value})} placeholder="What was it for?"/></div><button className="secondary" onClick={logCheckin}>Save check-in</button></div>
        </div>
      </section>}

      {tab === "expenses" && <section className="page"><div className="titleRow"><div><label>TRACK</label><h1>Expense Tracker</h1></div><button onClick={() => addExpense()}>+ Add expense</button></div><div className="panel">{expenses.map(e=><div className="expense" key={e.id}><div><b>{e.merchant}</b><small>{e.category} • {e.date}</small></div><strong>{money(e.amount)}</strong></div>)}</div><div className="panel scanner"><div><span className="pill">RECEIPT SCANNER</span><h2>Scan a receipt</h2><p>Choose a receipt image. The app keeps it local until you confirm the extracted expense.</p><label className="upload"><input type="file" accept="image/*" capture="environment" onChange={e=>scanReceipt(e.target.files?.[0])}/>Take / choose receipt</label></div>{receipt && <div className="receiptPreview"><img src={receipt.url} alt="Receipt preview"/><small>{receipt.name} • {receipt.status}</small><button className="secondary" onClick={() => addExpense({merchant:"Receipt purchase",amount:Number(window.prompt("Confirmed total ₹", receipt.totalGuess || "")||0),category:"Receipt"})}>Confirm expense</button></div>}</div></section>}

      {tab === "challenge" && <section className="page"><label>AI SAVINGS CHALLENGE</label><h1>Build a saving habit.</h1><div className="panel challenge"><div className="check">✓</div><div className="grow"><h2>7-Day Smart Spending Challenge</h2><p>Log spending daily, avoid one unnecessary purchase, and keep your weekly cap.</p><div className="progress"><i style={{width:(challengeDays/7*100)+"%"}}/></div><small>{challengeDays} of 7 days completed</small></div><button onClick={()=>{if(challengeDays>=7)return notify("Challenge complete.");setChallengeDays(d=>d+1);setCoins(c=>Math.min(50000,c+500));notify("Challenge day recorded • 500 coins added for review")}}>Log today</button></div><div className="cols"><div className="panel"><h2>Coin rules</h2><p>Positive activity can earn coins; every award should have a reason.</p><ul><li>30,000 coins → ₹10 eligibility</li><li>50,000 coins → ₹30 eligibility</li><li>Above 50,000 → no extra cash tier</li><li>Abuse can cause restriction or denial after review</li></ul></div><div className="panel"><h2>Your coins</h2><strong className="big">{coins.toLocaleString()}</strong><p>{coins<30000 ? (30000-coins).toLocaleString()+" to first reward tier" : coins<50000 ? (50000-coins).toLocaleString()+" to second tier" : "Highest cash tier reached"}</p></div></div></section>}

      {tab === "research" && <section className="page"><label>AI RESEARCH</label><h1>Investment & income research.</h1><div className="cols"><div className="panel"><h2>Investment research calculator</h2><p>Compare a hypothetical stock, mutual fund, FD, gold or ETF scenario. No guarantees.</p><div className="formGrid"><select value={research.type} onChange={e=>setResearch({...research,type:e.target.value})}><option>stock</option><option>mutual fund</option><option>FD</option><option>gold</option><option>ETF</option></select><input value={research.name} onChange={e=>setResearch({...research,name:e.target.value})} placeholder="Name / symbol"/><input type="number" value={research.amount} onChange={e=>setResearch({...research,amount:e.target.value})} placeholder="Amount"/><input type="number" value={research.years} onChange={e=>setResearch({...research,years:e.target.value})} placeholder="Years"/><input type="number" value={research.rate} onChange={e=>setResearch({...research,rate:e.target.value})} placeholder="Illustrative %"/><select value={research.risk} onChange={e=>setResearch({...research,risk:e.target.value})}><option>low</option><option>medium</option><option>high</option></select></div><button onClick={runResearch}>Analyze scenario</button><button className="secondary" onClick={()=>window.open("https://www.google.com/search?q="+encodeURIComponent((research.name||research.type)+" latest fees risk India"),"_blank")}>Open live research</button></div><div className="panel"><h2>Business / income ideas</h2><p>Generate a practical starting plan from your capital and skills.</p><div className="formGrid"><input type="number" value={business.capital} onChange={e=>setBusiness({...business,capital:e.target.value})} placeholder="Capital ₹"/><input value={business.skill} onChange={e=>setBusiness({...business,skill:e.target.value})} placeholder="Your skill"/></div><button onClick={runBusiness}>Create plan</button></div></div></section>}

      {tab === "rewards" && <section className="page"><label>REWARDS</label><h1>Reward & verification</h1><div className="cols"><div className="panel"><h2>30,000 coins</h2><strong className="reward">₹10</strong><p>Eligibility only; verification and policy review apply.</p><button onClick={()=>claimReward(30000)}>Submit claim</button></div><div className="panel"><h2>50,000 coins</h2><strong className="reward">₹30</strong><p>No extra cash tier above 50,000 coins.</p><button onClick={()=>claimReward(50000)}>Submit claim</button></div></div><div className="panel"><h2>Premium activation</h2><p>Submit your PhonePe payment reference or screenshot. Automated review is followed by human verification.</p><div className="formGrid"><input type="number" min="1" step="0.01" value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})} placeholder="Amount paid (₹)"/><input value={payment.reference} onChange={e=>setPayment({...payment,reference:e.target.value})} placeholder="PhonePe transaction/reference ID"/><label className="upload"><input type="file" accept="image/*" onChange={e=>setPayment({...payment,file:e.target.files?.[0]})}/>Upload payment screenshot</label></div><p>Status: <b>{payment.status}</b></p><button onClick={submitPayment}>Submit for verification</button></div></section>}

      {tab === "live" && <section className="page"><label>LIVE MEETING GATEWAY</label><h1>Learn from top savers.</h1><div className="live"><div className="video liveBox">{liveOpen ? <iframe title="Money Save Live" src="https://meet.jit.si/MoneySaveCommunityRoom" allow="camera; microphone; fullscreen; display-capture" /> : <><span>LIVE</span><b>Community meeting</b><small>10:00–10:30 AM • 8:00–8:30 PM</small><button onClick={()=>setLiveOpen(true)}>Start live room</button></>}</div><div className="panel"><h2>Meeting rules</h2><p>Free: 10 minutes/day • Premium: 30 minutes/day.</p><p>Hosts are selected from contributors. Exact savings, income and balances are never displayed publicly.</p><p>AI moderation and human appeal/review are part of the planned moderation workflow.</p></div></div></section>}

      {tab === "profile" && <section className="page"><label>ACCOUNT</label><h1>Your profile</h1><div className="panel profile"><div className="avatar">MS</div><div><h2>Money Save User</h2><p>User ID: <b>{userId}</b></p><span className="badge">{premium ? "PREMIUM USER" : "FREE USER"}</span></div></div><div className="panel"><h2>Upgrade to Premium</h2><p>Premium raises AI questions from 30/day to 100/day and live access from 10 to 30 minutes/day.</p><button onClick={()=>setTab("rewards")}>Open payment verification</button></div><div className="panel"><h2>Support</h2><p>{SUPPORT_EMAIL}</p></div></section>}

      {tab === "admin" && <section className="page"><label>OWNER CONTROL</label><h1>Admin Command Center</h1><div className="notice">Owner: <b>{OWNER_EMAIL}</b> • Server-side authorization should be enforced when Supabase is connected.</div><div className="cards">{[["Users",userId],["Coins",coins.toLocaleString()],["Expenses",expenses.length],["Premium",premium?"Active":"Free"]].map(x=><div className="card" key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong><small>Live local view</small></div>)}</div><div className="panel"><h2>Verification queue</h2><p>Payment status: <b>{payment.status}</b></p><p>Payment approval is server-side only. A screenshot/reference is evidence, not proof of payment.</p><button onClick={async()=>{if(!supabase||!session)return;const {data,error}=await supabase.from("payment_submissions").select("id,user_id,plan,amount,transaction_reference,status,review_reason,created_at").order("created_at",{ascending:false}).limit(50);if(error)return notify(error.message);setPaymentQueue(data||[]);}}>Refresh payment queue</button>{paymentQueue?.map(p=><div className="panel" key={p.id}><b>{p.status}</b> • {p.transaction_reference||"No reference"}<small>{new Date(p.created_at).toLocaleString("en-IN")}</small>{["submitted","automated_review","human_review"].includes(p.status)&&<div className="heroActions"><button onClick={async()=>{const reason=window.prompt("Verification note","Payment verified after transaction/reference check.")||"";const {data,error}=await supabase.functions.invoke("review-payment",{body:{submissionId:p.id,decision:"approved",reason}});if(error)return notify(error.message);notify("Premium approved.");setPaymentQueue(q=>q.map(x=>x.id===p.id?{...x,status:data.status,review_reason:reason}:x));}}>Approve Premium</button><button className="secondary" onClick={async()=>{const reason=window.prompt("Rejection reason","Payment could not be verified.")||"Payment could not be verified.";const {error}=await supabase.functions.invoke("review-payment",{body:{submissionId:p.id,decision:"rejected",reason}});if(error)return notify(error.message);notify("Payment rejected.");setPaymentQueue(q=>q.map(x=>x.id===p.id?{...x,status:"rejected",review_reason:reason}:x));}}>Reject</button></div>}<small>{p.review_reason||""}</small></div>)}</div></section>}
    </main>

    <nav>{nav.map(([id,name])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{name}</button>)}</nav>
    {toast && <div className="toast">{toast}</div>}
    {modal && <div className="modalBackdrop" onClick={()=>setModal(null)}><div className="modal" onClick={e=>e.stopPropagation()}><h2>{modal.title}</h2>{modal.body.map((x,i)=><p key={i}>{x}</p>)}<button onClick={()=>setModal(null)}>Close</button></div></div>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
