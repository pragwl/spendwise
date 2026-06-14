import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";
import { NotFoundError } from "../utils/errors";
import { z } from "zod";

const SplitTenderSchema = z.object({
  name:        z.string().min(1).max(80),
  description: z.string().max(300).optional(),
});

export const splitTenderController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const tenders = await prisma.splitTender.findMany({
        orderBy: { name: "asc" },
        include: {
          _count: { select: { sources: true, budgetTenders: true } },
        },
      });
      return sendSuccess(res, tenders);
    } catch (err) { next(err); }
  },

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const tender = await prisma.splitTender.findUnique({
        where:   { id: req.params.id },
        include: {
          sources:       { select: { id: true, name: true, type: true, icon: true, color: true } },
          budgetTenders: { include: { budget: { select: { id: true, name: true } } } },
          _count:        { select: { sources: true, budgetTenders: true } },
        },
      });
      if (!tender) throw new NotFoundError("Split tender", req.params.id);
      return sendSuccess(res, tender);
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data   = SplitTenderSchema.parse(req.body);
      const tender = await prisma.splitTender.create({ data });
      return sendSuccess(res, tender, 201);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data   = SplitTenderSchema.partial().parse(req.body);
      const tender = await prisma.splitTender.update({
        where: { id: req.params.id },
        data,
      });
      return sendSuccess(res, tender);
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const tender = await prisma.splitTender.findUnique({ where: { id: req.params.id } });
      if (!tender) throw new NotFoundError("Split tender", req.params.id);
      await prisma.splitTender.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    } catch (err) { next(err); }
  },
};
