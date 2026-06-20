import { Router } from "express";
import { analyticsController } from "../controllers/analytics";

const r = Router();
r.get("/summary",          analyticsController.getSummary);
r.get("/monthly-trend",    analyticsController.getMonthlyTrend);
r.get("/daily-trend",      analyticsController.getDailyTrend);
r.get("/budget-analytics", analyticsController.getBudgetAnalytics);
r.get("/dashboard",        analyticsController.getDashboard);
r.get("/report",           analyticsController.getReport);
export default r;
