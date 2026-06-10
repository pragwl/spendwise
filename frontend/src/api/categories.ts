import { client } from "./client";
import type { ApiResponse, Category } from "../types";

export const categoriesApi = {
  getAll: () =>
    client.get<unknown, ApiResponse<Category[]>>("/categories"),

  create: (data: Omit<Category, "id"|"createdAt"|"_count">) =>
    client.post<unknown, ApiResponse<Category>>("/categories", data),

  update: (id: string, data: Partial<Category>) =>
    client.put<unknown, ApiResponse<Category>>(`/categories/${id}`, data),

  delete: (id: string) =>
    client.delete<unknown, ApiResponse<{ deleted: boolean }>>(`/categories/${id}`),
};
