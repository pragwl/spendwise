import { Router } from "express";
import expenseRoutes      from "./expenses";
import budgetRoutes       from "./budgets";
import categoryRoutes     from "./categories";
import sourceRoutes       from "./sources";
import analyticsRoutes    from "./analytics";
import splitTenderRoutes  from "./splitTenders";

const router = Router();

router.use("/expenses",      expenseRoutes);
router.use("/budgets",       budgetRoutes);
router.use("/categories",    categoryRoutes);
router.use("/sources",       sourceRoutes);
router.use("/analytics",     analyticsRoutes);
router.use("/split-tenders", splitTenderRoutes);

router.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

export default router;
