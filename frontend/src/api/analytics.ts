import { client } from "./client";
import { config } from "../config";
import type { ApiResponse, AnalyticsSummary, MonthlyTrend, BudgetAnalytics, ReportResponse, DashboardData, ExpenseAnalysis, CategoryTrend } from "../types";

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

  // Full Analytics-screen metrics computed server-side over all expenses
  // of the selected budgets (no row cap).
  getBudgetAnalytics: (budgetIds: string[]) =>
    client.get<unknown, ApiResponse<BudgetAnalytics>>("/analytics/budget-analytics", {
      params: { budgetIds: budgetIds.join(",") },
    }),

  // Dashboard widgets (category breakdown, recent list, monthly trend) scoped
  // to a budget, or all active budgets when budgetId is omitted.
  getDashboard: (budgetId?: string) =>
    client.get<unknown, ApiResponse<DashboardData>>("/analytics/dashboard", {
      params: { budgetId: budgetId || undefined },
    }),

  // Accurate analysis over a hand-picked set of expenses (computed server-side).
  analyzeExpenses: (ids: string[]) =>
    client.post<unknown, ApiResponse<ExpenseAnalysis>>("/analytics/analyze-expenses", { ids }),

  // Monthly spend per selected category, for the dashboard category-trend chart.
  getCategoryTrend: (categoryIds: string[]) =>
    client.get<unknown, ApiResponse<CategoryTrend>>("/analytics/category-trend", {
      params: { categoryIds: categoryIds.join(",") },
    }),

  // Report summary + a paginated page of rows for the table.
  getReport: (budgetId: string, limit = 50, offset = 0) =>
    client.get<unknown, ApiResponse<ReportResponse>>("/analytics/report", {
      params: { budgetId, limit, offset },
    }),

  // Direct download URL for the full CSV export (bypasses the page cap).
  reportCsvUrl: (budgetId: string) =>
    `${config.api.baseUrl}/analytics/report?budgetId=${encodeURIComponent(budgetId)}&format=csv`,
};
