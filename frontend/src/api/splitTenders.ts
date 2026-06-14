import { client } from "./client";
import type { ApiResponse, SplitTender } from "../types";

export const splitTendersApi = {
  getAll: () =>
    client.get<unknown, ApiResponse<SplitTender[]>>("/split-tenders"),

  getOne: (id: string) =>
    client.get<unknown, ApiResponse<SplitTender>>(`/split-tenders/${id}`),

  create: (data: Omit<SplitTender, "id" | "createdAt" | "_count">) =>
    client.post<unknown, ApiResponse<SplitTender>>("/split-tenders", data),

  update: (id: string, data: Partial<Omit<SplitTender, "id" | "createdAt" | "_count">>) =>
    client.put<unknown, ApiResponse<SplitTender>>(`/split-tenders/${id}`, data),

  delete: (id: string) =>
    client.delete<unknown, ApiResponse<{ deleted: boolean }>>(`/split-tenders/${id}`),
};
