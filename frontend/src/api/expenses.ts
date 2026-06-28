import { client } from "./client";
import type { ApiResponse, Expense } from "../types";

export interface ExpenseFilters {
  budgetId?:   string;
  categoryId?: string;
  sourceId?:   string;
  startDate?:  string;
  endDate?:    string;
  search?:     string;
  sortBy?:     "date" | "amount";
  order?:      "asc" | "desc";
  limit?:      number;
  offset?:     number;
  costType?:   "fixed" | "variable";
  reimbursable?: boolean;
}

export const expensesApi = {
  getAll: (filters?: ExpenseFilters) =>
    client.get<unknown, ApiResponse<Expense[]>>("/expenses", { params: filters }),

  getOne: (id: string) =>
    client.get<unknown, ApiResponse<Expense>>(`/expenses/${id}`),

  create: (data: Omit<Expense, "id"|"createdAt"|"category"|"budget"|"source">) =>
    client.post<unknown, ApiResponse<Expense>>("/expenses", data),

  update: (id: string, data: Partial<Expense>) =>
    client.put<unknown, ApiResponse<Expense>>(`/expenses/${id}`, data),

  delete: (id: string) =>
    client.delete<unknown, ApiResponse<{ deleted: boolean }>>(`/expenses/${id}`),

  bulkDelete: (ids: string[]) =>
    client.delete<unknown, ApiResponse<{ deleted: number }>>("/expenses/bulk", { data: { ids } }),
};
