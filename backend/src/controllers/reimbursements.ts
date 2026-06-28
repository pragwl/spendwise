import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";
import { NotFoundError } from "../utils/errors";
import { z } from "zod";

const ReimbursementSchema = z.object({
  amount:              z.number().positive("Amount must be positive"),
  date:                z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  notes:               z.string().max(500).optional(),
  status:              z.enum(["pending", "received"]).optional().default("received"),
  expenseId:           z.string().uuid().optional().nullable(),
  destinationSourceId: z.string().uuid().optional().nullable(),
});

const include = {
  expense:           { select: { id: true, title: true, amount: true, sourceId: true,
                                 source: { select: { id: true, name: true, icon: true } } } },
  destinationSource: { select: { id: true, name: true, icon: true } },
};

export const reimbursementController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, expenseId, destinationSourceId } = req.query;
      const where: Record<string, unknown> = {};
      if (status)              where.status              = String(status);
      if (expenseId)           where.expenseId           = String(expenseId);
      if (destinationSourceId) where.destinationSourceId = String(destinationSourceId);

      const items = await prisma.reimbursement.findMany({
        where,
        orderBy: { date: "desc" },
        include,
      });
      return sendSuccess(res, items);
    } catch (err) { next(err); }
  },

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await prisma.reimbursement.findUnique({ where: { id: req.params.id }, include });
      if (!item) throw new NotFoundError("Reimbursement", req.params.id);
      return sendSuccess(res, item);
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = ReimbursementSchema.parse(req.body);
      const item = await prisma.reimbursement.create({
        data:    { ...data, date: new Date(data.date) },
        include,
      });
      return sendSuccess(res, item, 201);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = ReimbursementSchema.partial().parse(req.body);
      const item = await prisma.reimbursement.update({
        where:   { id: req.params.id },
        data:    { ...data, ...(data.date ? { date: new Date(data.date) } : {}) },
        include,
      });
      return sendSuccess(res, item);
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.reimbursement.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    } catch (err) { next(err); }
  },
};
