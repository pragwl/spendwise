import { client } from "./client";
import type { ApiResponse, Reimbursement } from "../types";

export type ReimbursementInput = {
  amount:               number;
  date:                 string;
  notes?:               string;
  status?:              "pending" | "received";
  expenseId?:           string | null;
  destinationSourceId?: string | null;
};

export const reimbursementsApi = {
  getAll: (params?: { status?: string; expenseId?: string; destinationSourceId?: string }) =>
    client.get<unknown, ApiResponse<Reimbursement[]>>("/reimbursements", { params }),

  create: (data: ReimbursementInput) =>
    client.post<unknown, ApiResponse<Reimbursement>>("/reimbursements", data),

  update: (id: string, data: Partial<ReimbursementInput>) =>
    client.put<unknown, ApiResponse<Reimbursement>>(`/reimbursements/${id}`, data),

  delete: (id: string) =>
    client.delete<unknown, ApiResponse<{ deleted: boolean }>>(`/reimbursements/${id}`),
};
