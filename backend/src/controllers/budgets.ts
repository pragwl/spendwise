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

      const enriched = budgets.map((b) => ({
        ...b,
        usedAmount:     b.expenses.reduce((s, e) => s + Number(e.amount), 0),
        tenderAnalytics: buildTenderAnalytics(b.splitTenders, b.expenses),
        expenses:        undefined,
      }));

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

      return sendSuccess(res, { ...budget, usedAmount, tenderAnalytics });
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
      return sendSuccess(res, { ...result, tenderAnalytics, usedAmount: 0 }, 201);
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

      return sendSuccess(res, { ...result, usedAmount, tenderAnalytics, expenses: undefined });
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.budget.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    } catch (err) { next(err); }
  },
};
