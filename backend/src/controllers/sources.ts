import { Request, Response, NextFunction } from "express";
import prisma from "../db";
import { sendSuccess } from "../utils/response";
import { NotFoundError } from "../utils/errors";
import { z } from "zod";

const SourceSchema = z.object({
  name:          z.string().min(1).max(80),
  type:          z.string().max(40).optional(),
  paymentType:   z.enum(["credit", "debit", "cash", "wallet"]).optional(),
  icon:          z.string().max(10).optional(),
  color:         z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  balance:       z.number().nullable().optional(),
  splitTenderId: z.string().uuid().nullable().optional(),
});

const num = (d: unknown): number => (d == null ? 0 : Number(d));

/**
 * Computes per-source financial figures.
 *
 * SPEND/BILL figures respect the optional budget filter (a flow is "in scope" when
 * its expense is ASSIGNED to a selected budget; for a reimbursement, that's its origin
 * expense). With no budget selected ("All time") nothing is filtered out:
 *   spent, reimbursableSpent, claimedBack, billToPay, netOutOfPocket, pendingReimbursement
 *
 * BALANCE figures are ALWAYS all-time — the actual money on the source right now is not
 * a per-budget concept:
 *   receivedAll, openingBalance, currentBalance = openingBalance + receivedAll - spentAll
 */
async function computeFinancials(budgetIds?: string[]) {
  const scoped    = Array.isArray(budgetIds) && budgetIds.length > 0;
  const budgetSet = scoped ? new Set(budgetIds) : null;
  const inScope   = (bid: string | null | undefined) => !scoped || (bid != null && budgetSet!.has(bid));

  const [sources, expenses, reimbursements] = await Promise.all([
    prisma.paymentSource.findMany({ select: { id: true, paymentType: true, balance: true } }),
    prisma.expense.findMany({
      where:  { sourceId: { not: null } },
      select: { sourceId: true, amount: true, reimbursable: true, budgetId: true },
    }),
    prisma.reimbursement.findMany({
      where:  { status: "received" },
      select: { amount: true, destinationSourceId: true, expense: { select: { sourceId: true, budgetId: true } } },
    }),
  ]);

  type Agg = {
    spent: number; reimbursableSpent: number; claimedBack: number; // scoped
    spentAll: number; receivedAll: number;                         // all-time (for balance)
  };
  const blank = (): Agg => ({ spent: 0, reimbursableSpent: 0, claimedBack: 0, spentAll: 0, receivedAll: 0 });
  const map = new Map<string, Agg>();
  const get = (id: string) => map.get(id) ?? map.set(id, blank()).get(id)!;

  for (const e of expenses) {
    if (!e.sourceId) continue;
    const a = get(e.sourceId);
    a.spentAll += num(e.amount);                 // all-time, drives currentBalance
    if (inScope(e.budgetId)) {
      a.spent += num(e.amount);
      if (e.reimbursable) a.reimbursableSpent += num(e.amount);
    }
  }
  for (const r of reimbursements) {
    if (r.destinationSourceId) get(r.destinationSourceId).receivedAll += num(r.amount); // all-time, drives balance
    const originId = r.expense?.sourceId;
    if (originId && inScope(r.expense?.budgetId)) get(originId).claimedBack += num(r.amount);
  }

  const result: Record<string, Record<string, number>> = {};
  for (const s of sources) {
    const a = map.get(s.id) ?? blank();
    const opening = num(s.balance);
    result[s.id] = {
      spent:                a.spent,
      reimbursableSpent:    a.reimbursableSpent,
      claimedBack:          a.claimedBack,
      billToPay:            s.paymentType === "credit" ? a.spent : 0,
      netOutOfPocket:       a.spent - a.claimedBack,
      pendingReimbursement: Math.max(0, a.reimbursableSpent - a.claimedBack),
      receivedAll:          a.receivedAll,
      openingBalance:       opening,
      currentBalance:       opening + a.receivedAll - a.spentAll,
    };
  }
  return result;
}

// Parse `budgetIds` query param: comma-separated string or repeated values.
function parseBudgetIds(q: unknown): string[] | undefined {
  if (Array.isArray(q)) return q.map(String);
  if (typeof q === "string" && q.trim()) return q.split(",").map(s => s.trim()).filter(Boolean);
  return undefined;
}

export const sourceController = {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const budgetIds = parseBudgetIds(req.query.budgetIds);
      const [sources, financials] = await Promise.all([
        prisma.paymentSource.findMany({
          orderBy: { name: "asc" },
          include: {
            _count:      { select: { expenses: true } },
            splitTender: { select: { id: true, name: true } },
          },
        }),
        computeFinancials(budgetIds),
      ]);
      const withFinancials = sources.map(s => ({ ...s, financials: financials[s.id] }));
      return sendSuccess(res, withFinancials);
    } catch (err) { next(err); }
  },

  async getOne(req: Request, res: Response, next: NextFunction) {
    try {
      const src = await prisma.paymentSource.findUnique({
        where:   { id: req.params.id },
        include: {
          expenses:    { orderBy: { date: "desc" }, take: 10 },
          splitTender: { select: { id: true, name: true } },
        },
      });
      if (!src) throw new NotFoundError("Payment source", req.params.id);
      const financials = await computeFinancials(parseBudgetIds(req.query.budgetIds));
      return sendSuccess(res, { ...src, financials: financials[src.id] });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { splitTenderId = null, ...rest } = SourceSchema.parse(req.body);

      const src = await prisma.paymentSource.create({
        data:    { ...rest, splitTenderId },
        include: { splitTender: { select: { id: true, name: true } } },
      });
      return sendSuccess(res, src, 201);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = SourceSchema.partial().parse(req.body);
      const src  = await prisma.paymentSource.update({
        where:   { id: req.params.id },
        data,
        include: { splitTender: { select: { id: true, name: true } } },
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
