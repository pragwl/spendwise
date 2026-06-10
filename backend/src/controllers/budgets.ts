import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";
import { NotFoundError } from "../utils/errors";
import { z } from "zod";

const BudgetSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  amount:      z.number().positive("Amount must be positive"),
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  endDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  color:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  status:      z.enum(["active", "completed", "paused"]).optional(),
});

export const budgetController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.query;
      const budgets = await prisma.budget.findMany({
        where:   status ? { status: String(status) } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          expenses: { select: { amount: true, source: { select: { type: true } } } },
          _count:   { select: { expenses: true } },
        },
      });

      type ExpRow = { amount: unknown; source: { type: string | null } | null };
      const enriched = budgets.map((b: typeof budgets[number]) => ({
        ...b,
        usedAmount:  b.expenses.reduce((s: number, e: ExpRow) => s + Number(e.amount), 0),
        cashSpent:   b.expenses.filter((e: ExpRow) => e.source?.type?.toLowerCase() === "cash")  .reduce((s: number, e: ExpRow) => s + Number(e.amount), 0),
        walletSpent: b.expenses.filter((e: ExpRow) => e.source?.type?.toLowerCase() === "wallet").reduce((s: number, e: ExpRow) => s + Number(e.amount), 0),
        expenses: undefined,
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
            include: { category: true, source: true },
          },
        },
      });
      if (!budget) throw new NotFoundError("Budget", req.params.id);

      const usedAmount = budget.expenses.reduce((s: number, e: { amount: unknown }) => s + Number(e.amount), 0);
      return sendSuccess(res, { ...budget, usedAmount });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data   = BudgetSchema.parse(req.body);
      const budget = await prisma.budget.create({
        data: {
          ...data,
          startDate: new Date(data.startDate),
          endDate:   new Date(data.endDate),
          status:    data.status || "active",
        },
      });
      return sendSuccess(res, budget, 201);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data   = BudgetSchema.partial().parse(req.body);
      const budget = await prisma.budget.update({
        where: { id: req.params.id },
        data:  {
          ...data,
          ...(data.startDate ? { startDate: new Date(data.startDate) } : {}),
          ...(data.endDate   ? { endDate:   new Date(data.endDate) }   : {}),
        },
      });
      return sendSuccess(res, budget);
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.budget.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    } catch (err) { next(err); }
  },
};
