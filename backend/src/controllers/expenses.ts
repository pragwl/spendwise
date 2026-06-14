import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";
import { NotFoundError, ValidationError } from "../utils/errors";
import { config } from "../config";
import { z } from "zod";

const ExpenseSchema = z.object({
  title:      z.string().min(1).max(200),
  amount:     z.number().positive("Amount must be positive"),
  date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  notes:      z.string().max(500).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  budgetId:   z.string().uuid().optional().nullable(),
  sourceId:   z.string().uuid().optional().nullable(),
  tags:       z.array(z.string()).optional(),
  costType:   z.enum(["fixed", "variable"]).optional().default("variable"),
});

async function validateSplitTenderMatch(budgetId: string, sourceId: string): Promise<void> {
  const source = await prisma.paymentSource.findUnique({
    where:  { id: sourceId },
    select: { splitTenderId: true, name: true },
  });
  if (!source) throw new NotFoundError("Payment source", sourceId);

  // If source has no split tender assigned, skip validation
  if (!source.splitTenderId) return;

  const link = await prisma.budgetSplitTender.findUnique({
    where: { budgetId_splitTenderId: { budgetId, splitTenderId: source.splitTenderId } },
  });

  if (!link) {
    throw new ValidationError(
      `Mismatch: the payment source "${source.name}" belongs to a split tender that is not linked to the selected budget. ` +
      "Add the corresponding split tender to the budget first."
    );
  }
}

export const expenseController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        budgetId, categoryId, sourceId,
        startDate, endDate, search,
        sortBy = "date", order = "desc",
        limit, offset,
      } = req.query;

      const take = Math.min(
        parseInt(String(limit  || config.pagination.defaultLimit), 10),
        config.pagination.maxLimit
      );
      const skip = parseInt(String(offset || 0), 10);

      const where: Record<string, unknown> = {};
      if (budgetId)   where.budgetId   = String(budgetId);
      if (categoryId) where.categoryId = String(categoryId);
      if (sourceId)   where.sourceId   = String(sourceId);
      if (startDate || endDate) {
        where.date = {
          ...(startDate ? { gte: new Date(String(startDate)) } : {}),
          ...(endDate   ? { lte: new Date(String(endDate))   } : {}),
        };
      }
      if (req.query.costType) where.costType = String(req.query.costType);
      if (search) {
        where.OR = [
          { title: { contains: String(search), mode: "insensitive" } },
          { notes: { contains: String(search), mode: "insensitive" } },
        ];
      }

      const [expenses, total] = await Promise.all([
        prisma.expense.findMany({
          where,
          orderBy: { [String(sortBy)]: String(order) },
          take,
          skip,
          include: { category: true, budget: true, source: true },
        }),
        prisma.expense.count({ where }),
      ]);

      return sendSuccess(res, expenses, 200, { total, limit: take, offset: skip });
    } catch (err) { next(err); }
  },

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const expense = await prisma.expense.findUnique({
        where:   { id: req.params.id },
        include: { category: true, budget: true, source: true },
      });
      if (!expense) throw new NotFoundError("Expense", req.params.id);
      return sendSuccess(res, expense);
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = ExpenseSchema.parse(req.body);

      if (data.budgetId && data.sourceId) {
        await validateSplitTenderMatch(data.budgetId, data.sourceId);
      }

      const expense = await prisma.expense.create({
        data:    { ...data, date: new Date(data.date), tags: data.tags || [] },
        include: { category: true, budget: true, source: true },
      });
      return sendSuccess(res, expense, 201);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = ExpenseSchema.partial().parse(req.body);

      // Merge with existing values to validate the final state
      const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new NotFoundError("Expense", req.params.id);

      const mergedBudgetId = data.budgetId  !== undefined ? data.budgetId  : existing.budgetId;
      const mergedSourceId = data.sourceId  !== undefined ? data.sourceId  : existing.sourceId;

      if (mergedBudgetId && mergedSourceId) {
        await validateSplitTenderMatch(mergedBudgetId, mergedSourceId);
      }

      const expense = await prisma.expense.update({
        where:   { id: req.params.id },
        data:    { ...data, ...(data.date ? { date: new Date(data.date) } : {}) },
        include: { category: true, budget: true, source: true },
      });
      return sendSuccess(res, expense);
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.expense.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    } catch (err) { next(err); }
  },

  async bulkDelete(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body);
      const { count } = await prisma.expense.deleteMany({ where: { id: { in: ids } } });
      return sendSuccess(res, { deleted: count });
    } catch (err) { next(err); }
  },
};
