import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";
import { NotFoundError } from "../utils/errors";
import { z } from "zod";

const SourceSchema = z.object({
  name:    z.string().min(1).max(80),
  type:    z.string().max(40).optional(),
  icon:    z.string().max(10).optional(),
  color:   z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  balance: z.number().nullable().optional(),
});

export const sourceController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const sources = await prisma.paymentSource.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { expenses: true } } },
      });
      return sendSuccess(res, sources);
    } catch (err) { next(err); }
  },

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const src = await prisma.paymentSource.findUnique({
        where: { id: req.params.id },
        include: { expenses: { orderBy: { date: "desc" }, take: 10 } },
      });
      if (!src) throw new NotFoundError("Payment source", req.params.id);
      return sendSuccess(res, src);
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = SourceSchema.parse(req.body);
      const src  = await prisma.paymentSource.create({ data });
      return sendSuccess(res, src, 201);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = SourceSchema.partial().parse(req.body);
      const src  = await prisma.paymentSource.update({
        where: { id: req.params.id },
        data,
      });
      return sendSuccess(res, src);
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.paymentSource.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    } catch (err) { next(err); }
  },
};
