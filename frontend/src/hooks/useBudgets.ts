import { useState, useEffect, useCallback } from "react";
import { budgetsApi } from "../api/budgets";
import type { Budget } from "../types";

export function useBudgets(status?: string) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await budgetsApi.getAll(status);
      setBudgets(res.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load budgets");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (data: Parameters<typeof budgetsApi.create>[0]) => {
    const res = await budgetsApi.create(data);
    setBudgets(prev => [res.data, ...prev]);
    return res.data;
  };

  const update = async (id: string, data: Partial<Budget>) => {
    const res = await budgetsApi.update(id, data);
    setBudgets(prev => prev.map(b => b.id === id ? res.data : b));
    return res.data;
  };

  const remove = async (id: string) => {
    await budgetsApi.delete(id);
    setBudgets(prev => prev.filter(b => b.id !== id));
  };

  return { budgets, loading, error, refetch: fetch, create, update, remove };
}
