import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";

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
};
