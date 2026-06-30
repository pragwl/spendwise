import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";

// ── Calendar-safe date helpers (mirror the frontend's getSafeDate logic) ────
// Expense.date is stored as a Postgres DATE; Prisma returns it as a Date at
// 00:00:00 UTC, so the ISO calendar date is the authoritative day key.
const dateKey = (d: Date | string) =>
  (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

// Weekday (0=Sun..6=Sat) of a YYYY-MM-DD key, computed in UTC so it is
// timezone-independent and matches the frontend's local-midnight getDay().
const dayOfWeek = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const dayMs = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

type LeanExpense = {
  id: string;
  title: string;
  amount: unknown;
  date: Date;
  costType: string;
  budgetId: string | null;
  categoryId: string | null;
  sourceId: string | null;
  category: { id: string } | null;
  source: { id: string } | null;
};

// Pull every matching expense (no pagination cap) for server-side aggregation.
function loadExpenses(where: Record<string, unknown>) {
  return prisma.expense.findMany({
    where,
    orderBy: { date: "asc" },
    include: { category: true, source: true },
  });
}

const MONTHS_BACK = 6;

function zeroedAnalytics() {
  return {
    totalSpent: 0, totalTransactions: 0, avgPerTransaction: 0,
    avgDailySpend: 0, totalRangeDays: 0,
    categoryBreakdown: [] as unknown[], sourceBreakdown: [] as unknown[],
    monthly: [] as unknown[],
    fixedTotal: 0, fixedCount: 0, variableTotal: 0, variableCount: 0,
    dow: [] as unknown[],
    unbudgetedTotal: 0, unbudgetedPct: 0,
    spikeDays: 0, spikeDates: [] as string[],
    activeDays: 0, activeDaysPct: 0,
    weekend: { fixed: 0, variable: 0, total: 0, pct: 0, dates: [] as string[] },
    momChange: null as number | null,
    biggestFixed: null as unknown, biggestVariable: null as unknown,
    topFixedDate: null as unknown, topVarDate: null as unknown,
    topCatPct: 0,
  };
}

function emptyExpenseAnalysis() {
  return {
    count: 0, total: 0, avg: 0, max: 0, min: 0,
    maxExpense: null as { title: string; amount: number } | null,
    first: null as string | null, last: null as string | null,
    spanDays: 0, activeDays: 0, perDay: 0,
    fixedTotal: 0, variableTotal: 0,
    reimbursableTotal: 0, reimbursableCount: 0, unbudgetedTotal: 0,
    byCategory: [] as unknown[], bySource: [] as unknown[], byBudget: [] as unknown[],
  };
}

export const analyticsController = {
  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;
      const dateFilter = {
        ...(startDate ? { gte: new Date(String(startDate)) } : {}),
        ...(endDate   ? { lte: new Date(String(endDate))   } : {}),
      };

      const [
        totalExpenses,
        categoryBreakdown,
        sourceBreakdown,
        activeBudgets,
        recentExpenses,
      ] = await Promise.all([
        prisma.expense.aggregate({
          where:   Object.keys(dateFilter).length ? { date: dateFilter } : undefined,
          _sum:    { amount: true },
          _count:  true,
          _avg:    { amount: true },
        }),

        prisma.expense.groupBy({
          by:      ["categoryId"],
          where:   Object.keys(dateFilter).length ? { date: dateFilter } : undefined,
          _sum:    { amount: true },
          _count:  true,
          orderBy: { _sum: { amount: "desc" } },
        }),

        prisma.expense.groupBy({
          by:      ["sourceId"],
          where:   Object.keys(dateFilter).length ? { date: dateFilter } : undefined,
          _sum:    { amount: true },
          _count:  true,
          orderBy: { _sum: { amount: "desc" } },
        }),

        prisma.budget.findMany({
          where:   { status: "active" },
          include: { expenses: { select: { amount: true } } },
        }),

        prisma.expense.findMany({
          orderBy: { date: "desc" },
          take:    10,
          include: { category: true, source: true, budget: true },
        }),
      ]);

      const categoryIds = categoryBreakdown.map((c: { categoryId: string | null }) => c.categoryId).filter(Boolean) as string[];
      const categories  = await prisma.category.findMany({ where: { id: { in: categoryIds } } });
      const catMap      = Object.fromEntries(categories.map((c: { id: string }) => [c.id, c]));

      const sourceIds = sourceBreakdown.map((s: { sourceId: string | null }) => s.sourceId).filter(Boolean) as string[];
      const sources   = await prisma.paymentSource.findMany({ where: { id: { in: sourceIds } } });
      const srcMap    = Object.fromEntries(sources.map((s: { id: string }) => [s.id, s]));

      const enrichedCats = categoryBreakdown.map((c: { categoryId: string | null; _sum: { amount: unknown }; _count: unknown }) => ({
        category:  c.categoryId ? catMap[c.categoryId] : null,
        total:     Number(c._sum.amount || 0),
        count:     c._count,
      }));

      const enrichedSrcs = sourceBreakdown.map((s: { sourceId: string | null; _sum: { amount: unknown }; _count: unknown }) => ({
        source: s.sourceId ? srcMap[s.sourceId] : null,
        total:  Number(s._sum.amount || 0),
        count:  s._count,
      }));

      const budgetSummary = activeBudgets.map((b: typeof activeBudgets[number]) => ({
        ...b,
        usedAmount: b.expenses.reduce((s: number, e: { amount: unknown }) => s + Number(e.amount), 0),
        expenses:   undefined,
      }));

      return sendSuccess(res, {
        totalSpent:          Number(totalExpenses._sum.amount || 0),
        totalTransactions:   totalExpenses._count,
        avgTransaction:      Number(totalExpenses._avg.amount || 0),
        categoryBreakdown:   enrichedCats,
        sourceBreakdown:     enrichedSrcs,
        activeBudgets:       budgetSummary,
        recentExpenses,
      });
    } catch (err) { next(err); }
  },

  async getMonthlyTrend(req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await prisma.$queryRaw<
        { year: number; month: number; total: number; count: number }[]
      >`
        SELECT
          EXTRACT(YEAR  FROM date)::int  AS year,
          EXTRACT(MONTH FROM date)::int  AS month,
          SUM(amount)::float             AS total,
          COUNT(*)::int                  AS count
        FROM expenses
        GROUP BY year, month
        ORDER BY year DESC, month DESC
        LIMIT 12
      `;
      return sendSuccess(res, rows);
    } catch (err) { next(err); }
  },

  async getDailyTrend(req: Request, res: Response, next: NextFunction) {
    try {
      const { month, year } = req.query;
      const y = parseInt(String(year  || new Date().getFullYear()), 10);
      const m = parseInt(String(month || new Date().getMonth() + 1), 10);

      const rows = await prisma.$queryRaw<
        { day: number; total: number; count: number }[]
      >`
        SELECT
          EXTRACT(DAY FROM date)::int AS day,
          SUM(amount)::float          AS total,
          COUNT(*)::int               AS count
        FROM expenses
        WHERE EXTRACT(YEAR FROM date) = ${y}
          AND EXTRACT(MONTH FROM date) = ${m}
        GROUP BY day
        ORDER BY day
      `;
      return sendSuccess(res, rows);
    } catch (err) { next(err); }
  },

  // Full Analytics-screen payload, computed over ALL expenses of the selected
  // budgets (no row cap). Ports the logic that previously ran in the browser.
  async getBudgetAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const budgetIds = String(req.query.budgetIds || "")
        .split(",").map(s => s.trim()).filter(Boolean);

      if (budgetIds.length === 0) return sendSuccess(res, zeroedAnalytics());

      // Unbudgeted spend can't come from the budget-scoped query (every row there
      // has a budget). Measure it separately: expenses with NO budget that fall
      // inside the date window spanned by the selected budgets.
      const budgetRows = await prisma.budget.findMany({
        where:  { id: { in: budgetIds } },
        select: { startDate: true, endDate: true },
      });
      let unbudgetedTotal = 0;
      if (budgetRows.length > 0) {
        const minStart = new Date(Math.min(...budgetRows.map(b => b.startDate.getTime())));
        const maxEnd   = new Date(Math.max(...budgetRows.map(b => b.endDate.getTime())));
        const ubAgg = await prisma.expense.aggregate({
          where: { budgetId: null, date: { gte: minStart, lte: maxEnd } },
          _sum:  { amount: true },
        });
        unbudgetedTotal = Number(ubAgg._sum.amount || 0);
      }

      const expenses = (await loadExpenses({ budgetId: { in: budgetIds } })) as unknown as LeanExpense[];

      if (expenses.length === 0) {
        const z = zeroedAnalytics();
        z.unbudgetedTotal = unbudgetedTotal;
        z.unbudgetedPct   = unbudgetedTotal > 0 ? 100 : 0; // no budgeted spend in scope
        return sendSuccess(res, z);
      }

      const amt = (e: LeanExpense) => Number(e.amount);
      const total = expenses.reduce((s, e) => s + amt(e), 0);
      const txCount = expenses.length;

      // Category & source breakdowns (sorted desc by total)
      const catMap = new Map<string, { category: unknown; total: number; count: number }>();
      const srcMap = new Map<string, { source: unknown; total: number; count: number }>();
      for (const e of expenses) {
        const ck = e.categoryId || "__none__";
        const cx = catMap.get(ck);
        if (cx) { cx.total += amt(e); cx.count++; }
        else catMap.set(ck, { category: e.category || null, total: amt(e), count: 1 });
        const sk = e.sourceId || "__none__";
        const sx = srcMap.get(sk);
        if (sx) { sx.total += amt(e); sx.count++; }
        else srcMap.set(sk, { source: e.source || null, total: amt(e), count: 1 });
      }
      const categoryBreakdown = [...catMap.values()].sort((a, b) => b.total - a.total);
      const sourceBreakdown   = [...srcMap.values()].sort((a, b) => b.total - a.total);

      // Monthly trend (last 6 months present in the data)
      const monthlyMap = new Map<string, { spend: number; count: number }>();
      for (const e of expenses) {
        const k = dateKey(e.date).slice(0, 7);
        const mx = monthlyMap.get(k);
        if (mx) { mx.spend += amt(e); mx.count++; }
        else monthlyMap.set(k, { spend: amt(e), count: 1 });
      }
      const monthly = [...monthlyMap.keys()].sort().slice(-MONTHS_BACK).map(k => {
        const [year, monthNum] = k.split("-").map(Number);
        const v = monthlyMap.get(k)!;
        return { year, monthNum, spend: v.spend, count: v.count };
      });

      // Fixed vs variable
      const fixedExp    = expenses.filter(e => e.costType === "fixed");
      const variableExp = expenses.filter(e => e.costType !== "fixed");
      const fixedTotal    = fixedExp.reduce((s, e) => s + amt(e), 0);
      const variableTotal = variableExp.reduce((s, e) => s + amt(e), 0);

      // Avg daily spend + inclusive total date range
      let avgDailySpend = 0;
      let totalRangeDays = 1;
      const keys = expenses.map(e => dateKey(e.date));
      const ms = keys.map(dayMs);
      totalRangeDays = Math.max(1, Math.round((Math.max(...ms) - Math.min(...ms)) / 86400000) + 1);
      avgDailySpend = total / totalRangeDays;

      // Day-of-week breakdown
      const dow = Array.from({ length: 7 }, (_, i) => {
        const dayExp = expenses.filter(e => dayOfWeek(dateKey(e.date)) === i);
        return {
          dayIndex: i,
          fixed:    dayExp.filter(e => e.costType === "fixed").reduce((s, e) => s + amt(e), 0),
          variable: dayExp.filter(e => e.costType !== "fixed").reduce((s, e) => s + amt(e), 0),
          total:    dayExp.reduce((s, e) => s + amt(e), 0),
          count:    dayExp.length,
        };
      });

      // Daily totals → spikes, active days
      const dateTotals = new Map<string, number>();
      for (const e of expenses) {
        const k = dateKey(e.date);
        dateTotals.set(k, (dateTotals.get(k) || 0) + amt(e));
      }
      const dailyTotalsArr = [...dateTotals.values()];
      const spikeDates  = avgDailySpend > 0 ? [...dateTotals.entries()].filter(([, v]) => v > avgDailySpend * 1.5).map(([d]) => d) : [];
      const spikeDays   = avgDailySpend > 0 ? dailyTotalsArr.filter(d => d > avgDailySpend * 1.5).length : 0;
      const activeDays    = dateTotals.size;
      const activeDaysPct = Math.round(activeDays / totalRangeDays * 100);

      // Unbudgeted share = unbudgeted spend ÷ all spend in the period
      // (budgeted spend in scope + unbudgeted spend in the same window).
      const periodTotal   = total + unbudgetedTotal;
      const unbudgetedPct  = periodTotal > 0 ? Math.round(unbudgetedTotal / periodTotal * 100) : 0;

      // Weekend share (Sat=6, Sun=0)
      const weekendExp = expenses.filter(e => { const d = dayOfWeek(dateKey(e.date)); return d === 0 || d === 6; });
      const weekendFixed    = weekendExp.filter(e => e.costType === "fixed").reduce((s, e) => s + amt(e), 0);
      const weekendVariable = weekendExp.filter(e => e.costType !== "fixed").reduce((s, e) => s + amt(e), 0);
      const weekendTotal    = weekendExp.reduce((s, e) => s + amt(e), 0);
      const weekend = {
        fixed: weekendFixed, variable: weekendVariable, total: weekendTotal,
        pct: total > 0 ? Math.round(weekendTotal / total * 100) : 0,
        dates: [...new Set(weekendExp.map(e => dateKey(e.date)))],
      };

      // Month-over-month change (only if the last two months are consecutive)
      let momChange: number | null = null;
      if (monthly.length >= 2) {
        const last = monthly[monthly.length - 1];
        const prev = monthly[monthly.length - 2];
        const consecutive = (last.year === prev.year && last.monthNum === prev.monthNum + 1) ||
                            (last.year === prev.year + 1 && last.monthNum === 1 && prev.monthNum === 12);
        if (consecutive) momChange = ((last.spend - prev.spend) / Math.max(1, prev.spend)) * 100;
      }

      // Biggest single expense — fixed & variable separately
      const biggest = (set: LeanExpense[]) => set.length
        ? (() => { const e = set.reduce((a, b) => amt(b) > amt(a) ? b : a);
                   return { id: e.id, title: e.title, amount: amt(e), date: dateKey(e.date) }; })()
        : null;
      const biggestFixed    = biggest(fixedExp);
      const biggestVariable = biggest(variableExp);

      // Top spend date — fixed & variable separately
      const topDate = (set: LeanExpense[]) => {
        const m = new Map<string, number>();
        for (const e of set) { const k = dateKey(e.date); m.set(k, (m.get(k) || 0) + amt(e)); }
        const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
        return top ? { date: top[0], total: top[1] } : null;
      };
      const topFixedDate = topDate(fixedExp);
      const topVarDate   = topDate(variableExp);

      const topCatPct = categoryBreakdown.length > 0 && total > 0
        ? Math.round((categoryBreakdown[0].total / total) * 100) : 0;

      return sendSuccess(res, {
        totalSpent: total, totalTransactions: txCount,
        avgPerTransaction: txCount > 0 ? total / txCount : 0,
        avgDailySpend, totalRangeDays,
        categoryBreakdown, sourceBreakdown, monthly,
        fixedTotal, fixedCount: fixedExp.length, variableTotal, variableCount: variableExp.length,
        dow,
        unbudgetedTotal, unbudgetedPct,
        spikeDays, spikeDates, activeDays, activeDaysPct,
        weekend, momChange,
        biggestFixed, biggestVariable, topFixedDate, topVarDate, topCatPct,
      });
    } catch (err) { next(err); }
  },

  // Dashboard: at-a-glance current state — period spend (this month / last 7
  // days / today), the recent transaction list, and the standing pending-
  // reimbursement total. Period spend + recent list are scoped to the selected
  // budget (or all active budgets); pending reimbursements are global. All
  // computed server-side. (Deeper analysis — category/source/monthly trends —
  // lives on the Analytics screen.)
  async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const { budgetId } = req.query;
      let budgetIds: string[];
      if (budgetId) {
        budgetIds = [String(budgetId)];
      } else {
        const active = await prisma.budget.findMany({ where: { status: "active" }, select: { id: true } });
        budgetIds = active.map(b => b.id);
      }

      // Pending reimbursements are a standing to-do, tracked globally.
      const pendAgg = await prisma.reimbursement.aggregate({
        where: { status: "pending" }, _sum: { amount: true }, _count: true,
      });
      const pendingReimbursement = { total: Number(pendAgg._sum.amount || 0), count: pendAgg._count };

      const zeroPeriod = () => ({ spend: 0, count: 0 });
      if (budgetIds.length === 0) {
        return sendSuccess(res, {
          recentExpenses: [],
          stats: { month: zeroPeriod(), week: zeroPeriod(), today: zeroPeriod() },
          pendingReimbursement,
        });
      }

      const expenses = (await loadExpenses({ budgetId: { in: budgetIds } })) as unknown as LeanExpense[];
      const amt = (e: LeanExpense) => Number(e.amount);

      // Time-window spend (calendar-safe UTC keys — matches how dates are stored).
      const now = new Date();
      const todayKey    = now.toISOString().slice(0, 10);
      const monthKey    = todayKey.slice(0, 7);
      const todayMsVal  = dayMs(todayKey);
      const weekStartMs = todayMsVal - 6 * 86400000; // inclusive: last 7 days
      const stats = { month: zeroPeriod(), week: zeroPeriod(), today: zeroPeriod() };
      for (const e of expenses) {
        const k = dateKey(e.date); const a = amt(e); const ms = dayMs(k);
        if (k.slice(0, 7) === monthKey)        { stats.month.spend += a; stats.month.count++; }
        if (ms >= weekStartMs && ms <= todayMsVal) { stats.week.spend  += a; stats.week.count++; }
        if (k === todayKey)                    { stats.today.spend += a; stats.today.count++; }
      }

      // Five most recent transactions (full objects with category for display)
      const recentExpenses = [...expenses]
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 5);

      return sendSuccess(res, { recentExpenses, stats, pendingReimbursement });
    } catch (err) { next(err); }
  },

  // On-demand analysis over an arbitrary, user-picked set of expenses (by id).
  // Computed server-side from the authoritative rows so the figures are exact
  // (full amounts, complete relations) regardless of what the client has loaded.
  async analyzeExpenses(req: Request, res: Response, next: NextFunction) {
    try {
      const ids: string[] = Array.isArray(req.body?.ids)
        ? [...new Set((req.body.ids as unknown[]).map(x => String(x)))]
        : [];

      if (ids.length === 0) return sendSuccess(res, emptyExpenseAnalysis());

      type AnalysisRow = {
        title: string; amount: unknown; date: Date; costType: string; reimbursable: boolean;
        categoryId: string | null; sourceId: string | null; budgetId: string | null;
        category: { name: string; icon: string | null; color: string | null } | null;
        source:   { name: string; icon: string | null } | null;
        budget:   { name: string } | null;
      };
      const expenses = (await prisma.expense.findMany({
        where:   { id: { in: ids } },
        include: { category: true, source: true, budget: true },
      })) as unknown as AnalysisRow[];

      if (expenses.length === 0) return sendSuccess(res, emptyExpenseAnalysis());

      const amt   = (e: AnalysisRow) => Number(e.amount);
      const n     = expenses.length;
      const total = expenses.reduce((s, e) => s + amt(e), 0);
      const amounts = expenses.map(amt);
      const max   = Math.max(...amounts);
      const min   = Math.min(...amounts);
      const maxExp = expenses.find(e => amt(e) === max)!;

      const keys = expenses.map(e => dateKey(e.date)).sort();
      const first = keys[0];
      const last  = keys[keys.length - 1];
      const spanDays = Math.round((dayMs(last) - dayMs(first)) / 86400000) + 1;
      const activeDays = new Set(keys).size;
      const perDay = spanDays > 0 ? total / spanDays : total;

      const fixedTotal    = expenses.filter(e => e.costType === "fixed").reduce((s, e) => s + amt(e), 0);
      const variableTotal = total - fixedTotal;
      const reimb         = expenses.filter(e => e.reimbursable);
      const reimbursableTotal = reimb.reduce((s, e) => s + amt(e), 0);
      const unbudgetedTotal   = expenses.filter(e => !e.budgetId).reduce((s, e) => s + amt(e), 0);

      type Grp = { name: string; icon: string; color: string; total: number; count: number };
      const groupBy = (
        keyFn:  (e: AnalysisRow) => string,
        metaFn: (e: AnalysisRow) => { name: string; icon: string; color: string }
      ): Grp[] => {
        const m = new Map<string, Grp>();
        for (const e of expenses) {
          const k = keyFn(e);
          const cur = m.get(k) || { ...metaFn(e), total: 0, count: 0 };
          cur.total += amt(e); cur.count++;
          m.set(k, cur);
        }
        return [...m.values()].sort((a, b) => b.total - a.total);
      };

      const byCategory = groupBy(e => e.categoryId || "__none", e => ({ name: e.category?.name || "Uncategorized", icon: e.category?.icon || "💡", color: e.category?.color || "#7A6E68" }));
      const bySource   = groupBy(e => e.sourceId   || "__none", e => ({ name: e.source?.name   || "No source",      icon: e.source?.icon   || "💳", color: "#2563A8" }));
      const byBudget   = groupBy(e => e.budgetId   || "__none", e => ({ name: e.budget?.name   || "Unbudgeted",     icon: "💰",                  color: "#2E7D5E" }));

      return sendSuccess(res, {
        count: n, total, avg: total / n, max, min,
        maxExpense: { title: maxExp.title, amount: amt(maxExp) },
        first, last, spanDays, activeDays, perDay,
        fixedTotal, variableTotal,
        reimbursableTotal, reimbursableCount: reimb.length, unbudgetedTotal,
        byCategory, bySource, byBudget,
      });
    } catch (err) { next(err); }
  },

  // Monthly spend per selected category (one series per category), for the
  // dashboard's category-trend chart. Covers the most recent months present.
  async getCategoryTrend(req: Request, res: Response, next: NextFunction) {
    try {
      const categoryIds = String(req.query.categoryIds || "")
        .split(",").map(s => s.trim()).filter(Boolean);

      if (categoryIds.length === 0) return sendSuccess(res, { categories: [], monthly: [] });

      const [cats, expenses] = await Promise.all([
        prisma.category.findMany({ where: { id: { in: categoryIds } } }),
        prisma.expense.findMany({
          where:  { categoryId: { in: categoryIds } },
          select: { amount: true, date: true, categoryId: true },
        }),
      ]);

      // month "YYYY-MM" -> { categoryId -> total }
      const monthMap = new Map<string, Record<string, number>>();
      for (const e of expenses) {
        const mk = dateKey(e.date).slice(0, 7);
        let row = monthMap.get(mk);
        if (!row) { row = {}; monthMap.set(mk, row); }
        const cid = e.categoryId as string;
        row[cid] = (row[cid] || 0) + Number(e.amount);
      }

      const monthly = [...monthMap.keys()].sort().slice(-MONTHS_BACK).map(mk => {
        const [year, monthNum] = mk.split("-").map(Number);
        return { month: mk, year, monthNum, totals: monthMap.get(mk)! };
      });

      const categories = cats.map(c => ({
        id: c.id, name: c.name, color: c.color || "#C2623F", icon: c.icon || "📁",
      }));

      return sendSuccess(res, { categories, monthly });
    } catch (err) { next(err); }
  },

  // Report screen: rich, professional report over an arbitrary date range and
  // optional category / source / cost-type / text filters. ALL summary metrics
  // and breakdowns are computed server-side over the full matching set (no row
  // cap); the table is paginated for display. `format=csv` streams everything.
  //
  // Query params: startDate, endDate, categoryId, sourceId, costType, search,
  // budgetId (optional), limit, offset, format.
  async getReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { budgetId, categoryId, sourceId, costType, search, format } = req.query;
      const startDate = req.query.startDate ? String(req.query.startDate) : "";
      const endDate   = req.query.endDate   ? String(req.query.endDate)   : "";

      const where: Record<string, unknown> = {};
      if (budgetId)   where.budgetId   = String(budgetId);
      if (categoryId) where.categoryId = String(categoryId);
      if (sourceId)   where.sourceId   = String(sourceId);
      if (costType === "fixed" || costType === "variable") where.costType = String(costType);
      if (startDate || endDate) {
        where.date = {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate   ? { lte: new Date(endDate)   } : {}),
        };
      }
      if (search) {
        where.OR = [
          { title: { contains: String(search), mode: "insensitive" } },
          { notes: { contains: String(search), mode: "insensitive" } },
        ];
      }

      // One authoritative load of the full matching set — drives the summary,
      // every breakdown, the CSV, and (sliced) the paginated table.
      const rows = await prisma.expense.findMany({
        where,
        orderBy: { date: "desc" },
        include: { category: true, budget: true, source: true },
      });

      if (format === "csv") {
        const header = ["Title", "Amount", "Date", "Category", "Budget", "Source", "Cost type", "Reimbursable", "Notes"];
        const esc = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
        const csv = [
          header.map(esc).join(","),
          ...rows.map(e => [
            e.title, Number(e.amount), dateKey(e.date),
            e.category?.name || "", e.budget?.name || "", e.source?.name || "",
            e.costType || "", e.reimbursable ? "yes" : "no", e.notes || "",
          ].map(esc).join(",")),
        ].join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="spendwise-report.csv"');
        return res.status(200).send(csv);
      }

      const amt = (e: typeof rows[number]) => Number(e.amount);
      const total = rows.reduce((s, e) => s + amt(e), 0);
      const n = rows.length;
      const amounts = rows.map(amt);

      // Fixed / variable / reimbursable composition
      const fixedRows    = rows.filter(e => e.costType === "fixed");
      const variableRows = rows.filter(e => e.costType !== "fixed");
      const reimbRows    = rows.filter(e => e.reimbursable);
      const fixedTotal    = fixedRows.reduce((s, e) => s + amt(e), 0);
      const variableTotal = variableRows.reduce((s, e) => s + amt(e), 0);
      const reimbursableTotal = reimbRows.reduce((s, e) => s + amt(e), 0);

      // Date span + activity (only meaningful when there are rows)
      const keys = rows.map(e => dateKey(e.date)).sort();
      const first = keys[0] || null;
      const last  = keys[keys.length - 1] || null;
      const spanDays = first && last ? Math.round((dayMs(last) - dayMs(first)) / 86400000) + 1 : 0;
      const activeDays = new Set(keys).size;

      // Breakdown grouping (sorted desc by total, with % of grand total)
      type Grp = { name: string; icon: string; color: string; total: number; count: number; pct: number };
      const groupBy = (
        keyFn:  (e: typeof rows[number]) => string,
        metaFn: (e: typeof rows[number]) => { name: string; icon: string; color: string }
      ): Grp[] => {
        const m = new Map<string, Grp>();
        for (const e of rows) {
          const k = keyFn(e);
          const cur = m.get(k) || { ...metaFn(e), total: 0, count: 0, pct: 0 };
          cur.total += amt(e); cur.count++;
          m.set(k, cur);
        }
        return [...m.values()]
          .map(g => ({ ...g, pct: total > 0 ? Math.round((g.total / total) * 100) : 0 }))
          .sort((a, b) => b.total - a.total);
      };

      const byCategory = groupBy(e => e.categoryId || "__none", e => ({ name: e.category?.name || "Uncategorized", icon: e.category?.icon || "💡", color: e.category?.color || "#7A6E68" }));
      const bySource   = groupBy(e => e.sourceId   || "__none", e => ({ name: e.source?.name   || "No source",      icon: e.source?.icon   || "💳", color: e.source?.color || "#2563A8" }));
      const byBudget   = groupBy(e => e.budgetId   || "__none", e => ({ name: e.budget?.name   || "Unbudgeted",     icon: "💰",                  color: e.budget?.color || "#2E7D5E" }));

      // Monthly trend across the matching set (chronological)
      const monthlyMap = new Map<string, number>();
      for (const e of rows) {
        const mk = dateKey(e.date).slice(0, 7);
        monthlyMap.set(mk, (monthlyMap.get(mk) || 0) + amt(e));
      }
      const monthly = [...monthlyMap.keys()].sort().map(mk => {
        const [year, monthNum] = mk.split("-").map(Number);
        return { year, monthNum, spend: monthlyMap.get(mk)!, count: rows.filter(e => dateKey(e.date).slice(0, 7) === mk).length };
      });

      const limit  = Math.min(parseInt(String(req.query.limit || 50), 10), 200);
      const offset = parseInt(String(req.query.offset || 0), 10);
      const expenses = rows.slice(offset, offset + limit);

      return sendSuccess(res, {
        summary: {
          totalSpent: total,
          totalTransactions: n,
          avgTransaction: n > 0 ? total / n : 0,
          minTransaction: n > 0 ? Math.min(...amounts) : 0,
          maxTransaction: n > 0 ? Math.max(...amounts) : 0,
          fixedTotal, fixedCount: fixedRows.length,
          variableTotal, variableCount: variableRows.length,
          reimbursableTotal, reimbursableCount: reimbRows.length,
          firstDate: first, lastDate: last,
          spanDays, activeDays,
          avgPerActiveDay: activeDays > 0 ? total / activeDays : 0,
        },
        byCategory, bySource, byBudget, monthly,
        expenses,
      }, 200, { total: n, limit, offset });
    } catch (err) { next(err); }
  },
};
