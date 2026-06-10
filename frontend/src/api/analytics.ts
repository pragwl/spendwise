import { client } from "./client";
import type { ApiResponse, AnalyticsSummary, MonthlyTrend } from "../types";

export const analyticsApi = {
  getSummary: (startDate?: string, endDate?: string) =>
    client.get<unknown, ApiResponse<AnalyticsSummary>>("/analytics/summary", {
      params: { startDate, endDate },
    }),

  getMonthlyTrend: () =>
    client.get<unknown, ApiResponse<MonthlyTrend[]>>("/analytics/monthly-trend"),

  getDailyTrend: (year?: number, month?: number) =>
    client.get<unknown, ApiResponse<{ day: number; total: number }[]>>(
      "/analytics/daily-trend", { params: { year, month } }
    ),
};
