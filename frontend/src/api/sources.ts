import { client } from "./client";
import type { ApiResponse, PaymentSource } from "../types";

export const sourcesApi = {
  getAll: () =>
    client.get<unknown, ApiResponse<PaymentSource[]>>("/sources"),

  create: (data: Omit<PaymentSource, "id"|"createdAt"|"_count">) =>
    client.post<unknown, ApiResponse<PaymentSource>>("/sources", data),

  update: (id: string, data: Partial<PaymentSource>) =>
    client.put<unknown, ApiResponse<PaymentSource>>(`/sources/${id}`, data),

  delete: (id: string) =>
    client.delete<unknown, ApiResponse<{ deleted: boolean }>>(`/sources/${id}`),
};
