import { useState, useEffect, useCallback } from "react";
import { categoriesApi } from "../api/categories";
import type { Category } from "../types";

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    categoriesApi.getAll()
      .then(res => setCategories(res.data))
      .catch(e  => setError(e instanceof Error ? e.message : "Failed to load categories"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const create = async (data: Parameters<typeof categoriesApi.create>[0]) => {
    const res = await categoriesApi.create(data);
    setCategories(prev => [...prev, res.data]);
    return res.data;
  };

  const update = async (id: string, data: Partial<Category>) => {
    const res = await categoriesApi.update(id, data);
    setCategories(prev => prev.map(c => c.id === id ? res.data : c));
    return res.data;
  };

  const remove = async (id: string) => {
    await categoriesApi.delete(id);
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  return { categories, loading, error, refetch, create, update, remove };
}
