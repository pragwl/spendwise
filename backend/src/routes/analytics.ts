import { Router } from "express";
import { analyticsController } from "../controllers/analytics";

const r = Router();
r.get("/summary",       analyticsController.getSummary);
r.get("/monthly-trend", analyticsController.getMonthlyTrend);
r.get("/daily-trend",   analyticsController.getDailyTrend);
export default r;
