import { client } from "./client";
import type { ApiResponse, Budget } from "../types";

export const budgetsApi = {
  getAll: (status?: string) =>
    client.get<unknown, ApiResponse<Budget[]>>("/budgets", { params: status ? { status } : undefined }),

  getOne: (id: string) =>
    client.get<unknown, ApiResponse<Budget>>(`/budgets/${id}`),

  create: (data: Omit<Budget, "id"|"createdAt"|"usedAmount"|"_count">) =>
    client.post<unknown, ApiResponse<Budget>>("/budgets", data),

  update: (id: string, data: Partial<Budget>) =>
    client.put<unknown, ApiResponse<Budget>>(`/budgets/${id}`, data),

  delete: (id: string) =>
    client.delete<unknown, ApiResponse<{ deleted: boolean }>>(`/budgets/${id}`),
};
