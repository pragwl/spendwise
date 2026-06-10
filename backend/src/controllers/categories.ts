import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";
import { NotFoundError } from "../utils/errors";
import { z } from "zod";

const CategorySchema = z.object({
  name:  z.string().min(1).max(50),
  icon:  z.string().max(10).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color").optional(),
});

export const categoryController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await prisma.category.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { expenses: true } } },
      });
      return sendSuccess(res, categories);
    } catch (err) { next(err); }
  },

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const cat = await prisma.category.findUnique({
        where: { id: req.params.id },
        include: { expenses: { orderBy: { date: "desc" }, take: 10 } },
      });
      if (!cat) throw new NotFoundError("Category", req.params.id);
      return sendSuccess(res, cat);
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = CategorySchema.parse(req.body);
      const cat  = await prisma.category.create({ data });
      return sendSuccess(res, cat, 201);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = CategorySchema.partial().parse(req.body);
      const cat  = await prisma.category.update({
        where: { id: req.params.id },
        data,
      });
      return sendSuccess(res, cat);
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.expense.updateMany({
        where: { categoryId: req.params.id },
        data:  { categoryId: null },
      });
      await prisma.category.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    } catch (err) { next(err); }
  },
};
