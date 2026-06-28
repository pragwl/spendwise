import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";
import { NotFoundError } from "../utils/errors";
import { z } from "zod";

const SplitTenderAllocationSchema = z.object({
  splitTenderId:   z.string().uuid(),
  allocatedAmount: z.number().positive(),
  threshold:       z.number().min(0).max(100).nullable().optional(),
});

const BudgetSchema = z.object({
  name:         z.string().min(1).max(100),
  description:  z.string().max(300).optional(),
  startDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  endDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  color:        z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  status:       z.enum(["active", "completed", "paused"]).optional(),
  splitTenders: z.array(SplitTenderAllocationSchema).min(1, "At least one split tender allocation is required"),
});

type ExpRow = { amount: unknown; source: { splitTenderId: string | null } | null };

const DAY_MS = 86400000;
// Reduce a date-only value to a UTC-midnight epoch for tz-independent day math.
const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

// Burn-rate metrics + spending guidance for a budget, computed over its full
// expense set (usedAmount/txCount are aggregated from all linked expenses).
function computeBudgetMetrics(amt: number, used: number, startDate: Date, endDate: Date, txCount: number) {
  const now   = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = utcMidnight(startDate);
  const end   = utcMidnight(endDate);

  const totalDays   = Math.max(1, Math.round((end - start) / DAY_MS) + 1); // inclusive
  const elapsedDays = Math.max(1, Math.min(totalDays, Math.round((today - start) / DAY_MS) + 1));
  const remainDays  = Math.max(0, totalDays - elapsedDays);

  const rem  = Math.max(0, amt - used);
  const over = Math.max(0, used - amt);

  const plannedBurn = amt / totalDays;
  const actualBurn  = used / elapsedDays;
  const variancePct = plannedBurn > 0 ? ((actualBurn - plannedBurn) / plannedBurn) * 100 : 0;
  const forecast    = used + actualBurn * remainDays;
  const runwayDays  = actualBurn > 0 ? rem / actualBurn : null;

  const safeDailyLimit  = remainDays > 0 ? rem / remainDays : 0;
  const safeWeeklyLimit = safeDailyLimit * 7;
  const cutNeeded       = remainDays > 0 ? Math.max(0, actualBurn - safeDailyLimit) : 0;
  const projectedOver   = Math.max(0, forecast - amt);
  const pctTimeElapsed  = (elapsedDays / totalDays) * 100;
  const pctBudgetUsed   = amt > 0 ? (used / amt) * 100 : 0;
  const paceGap         = pctBudgetUsed - pctTimeElapsed;
  const avgTx           = txCount > 0 ? used / txCount : 0;
  const txsRemaining    = avgTx > 0 && rem > 0 ? Math.floor(rem / avgTx) : null;

  return {
    metrics:  { plannedBurn, actualBurn, variancePct, remaining: rem, forecast, runwayDays },
    guidance: {
      safeDailyLimit, safeWeeklyLimit, cutNeeded, projectedOver, paceGap,
      pctBudgetUsed, pctTimeElapsed, actualBurn, remainDays, rem, over, avgTx, txsRemaining,
    },
  };
}

function buildTenderAnalytics(
  budgetTenders: Array<{ splitTenderId: string; allocatedAmount: unknown; threshold: unknown; splitTender: { name: string } }>,
  expenses: ExpRow[]
) {
  return budgetTenders.map((bst) => ({
    splitTenderId:   bst.splitTenderId,
    splitTenderName: bst.splitTender.name,
    allocatedAmount: Number(bst.allocatedAmount),
    threshold:       bst.threshold != null ? Number(bst.threshold) : null,
    spentAmount:     expenses
      .filter((e) => e.source?.splitTenderId === bst.splitTenderId)
      .reduce((s, e) => s + Number(e.amount), 0),
  }));
}

export const budgetController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.query;
      const budgets = await prisma.budget.findMany({
        where:   status ? { status: String(status) } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          expenses:     { select: { amount: true, source: { select: { splitTenderId: true } } } },
          splitTenders: { include: { splitTender: { select: { id: true, name: true } } }, orderBy: { allocatedAmount: "desc" } },
          _count:       { select: { expenses: true } },
        },
      });

      const enriched = budgets.map((b) => {
        const usedAmount = b.expenses.reduce((s, e) => s + Number(e.amount), 0);
        const { metrics, guidance } = computeBudgetMetrics(
          Number(b.amount), usedAmount, b.startDate, b.endDate, b._count.expenses
        );
        return {
          ...b,
          usedAmount,
          tenderAnalytics: buildTenderAnalytics(b.splitTenders, b.expenses),
          metrics,
          guidance,
          expenses: undefined,
        };
      });

      return sendSuccess(res, enriched);
    } catch (err) { next(err); }
  },

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const budget = await prisma.budget.findUnique({
        where:   { id: req.params.id },
        include: {
          expenses: {
            orderBy: { date: "desc" },
            include: { category: true, source: { include: { splitTender: true } } },
          },
          splitTenders: { include: { splitTender: { select: { id: true, name: true } } }, orderBy: { allocatedAmount: "desc" } },
        },
      });
      if (!budget) throw new NotFoundError("Budget", req.params.id);

      const usedAmount     = budget.expenses.reduce((s, e) => s + Number(e.amount), 0);
      const tenderAnalytics = buildTenderAnalytics(budget.splitTenders, budget.expenses);
      const { metrics, guidance } = computeBudgetMetrics(
        Number(budget.amount), usedAmount, budget.startDate, budget.endDate, budget.expenses.length
      );

      return sendSuccess(res, { ...budget, usedAmount, tenderAnalytics, metrics, guidance });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { splitTenders: tenderInputs, ...rest } = BudgetSchema.parse(req.body);

      const amount = tenderInputs.reduce((s, t) => s + t.allocatedAmount, 0);

      const result = await prisma.$transaction(async (tx) => {
        const budget = await tx.budget.create({
          data: {
            ...rest,
            amount,
            startDate: new Date(rest.startDate),
            endDate:   new Date(rest.endDate),
            status:    rest.status || "active",
          },
        });

        await tx.budgetSplitTender.createMany({
          data: tenderInputs.map((t) => ({
            budgetId:        budget.id,
            splitTenderId:   t.splitTenderId,
            allocatedAmount: t.allocatedAmount,
            threshold:       t.threshold ?? null,
          })),
        });

        return tx.budget.findUnique({
          where:   { id: budget.id },
          include: { splitTenders: { include: { splitTender: { select: { id: true, name: true } } } } },
        });
      });

      const tenderAnalytics = buildTenderAnalytics(result!.splitTenders, []);
      const { metrics, guidance } = computeBudgetMetrics(
        Number(result!.amount), 0, result!.startDate, result!.endDate, 0
      );
      return sendSuccess(res, { ...result, tenderAnalytics, usedAmount: 0, metrics, guidance }, 201);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { splitTenders: tenderInputs, ...rest } = BudgetSchema.partial().parse(req.body);

      const result = await prisma.$transaction(async (tx) => {
        const updateData: Record<string, unknown> = { ...rest };
        if (rest.startDate) updateData.startDate = new Date(rest.startDate);
        if (rest.endDate)   updateData.endDate   = new Date(rest.endDate);

        if (tenderInputs && tenderInputs.length > 0) {
          updateData.amount = tenderInputs.reduce((s, t) => s + t.allocatedAmount, 0);
          await tx.budgetSplitTender.deleteMany({ where: { budgetId: req.params.id } });
          await tx.budgetSplitTender.createMany({
            data: tenderInputs.map((t) => ({
              budgetId:        req.params.id,
              splitTenderId:   t.splitTenderId,
              allocatedAmount: t.allocatedAmount,
              threshold:       t.threshold ?? null,
            })),
          });
        }

        await tx.budget.update({
          where: { id: req.params.id },
          data:  updateData,
        });

        return tx.budget.findUnique({
          where:   { id: req.params.id },
          include: {
            expenses:     { select: { amount: true, source: { select: { splitTenderId: true } } } },
            splitTenders: { include: { splitTender: { select: { id: true, name: true } } }, orderBy: { allocatedAmount: "desc" } },
          },
        });
      });

      if (!result) throw new NotFoundError("Budget", req.params.id);

      const usedAmount     = result.expenses.reduce((s, e) => s + Number(e.amount), 0);
      const tenderAnalytics = buildTenderAnalytics(result.splitTenders, result.expenses);
      const { metrics, guidance } = computeBudgetMetrics(
        Number(result.amount), usedAmount, result.startDate, result.endDate, result.expenses.length
      );

      return sendSuccess(res, { ...result, usedAmount, tenderAnalytics, metrics, guidance, expenses: undefined });
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const budget = await prisma.budget.findUnique({
        where:  { id: req.params.id },
        select: { id: true },
      });
      if (!budget) throw new NotFoundError("Budget", req.params.id);

      // Full cascade: deleting a budget removes the budget itself, every expense
      // assigned to it, and everything those expenses carry. Expense.budgetId is
      // onDelete:SetNull, so we must delete the expenses explicitly first;
      // their reimbursements then cascade automatically
      // (Reimbursement.expenseId onDelete:Cascade). The budget's split-tender
      // allocations cascade on the budget delete itself.
      const result = await prisma.$transaction(async (tx) => {
        const { count: expensesDeleted } = await tx.expense.deleteMany({
          where: { budgetId: req.params.id },
        });
        await tx.budget.delete({ where: { id: req.params.id } });
        return { expensesDeleted };
      });

      return sendSuccess(res, { deleted: true, ...result });
    } catch (err) { next(err); }
  },
};
