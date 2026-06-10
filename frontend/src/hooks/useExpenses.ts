import { useState, useEffect, useCallback } from "react";
import { expensesApi, ExpenseFilters } from "../api/expenses";
import type { Expense } from "../types";

export function useExpenses(filters?: ExpenseFilters) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await expensesApi.getAll(filters);
      setExpenses(res.data);
      setTotal(res.meta?.total ?? res.data.length);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (data: Parameters<typeof expensesApi.create>[0]) => {
    const res = await expensesApi.create(data);
    setExpenses(prev => [res.data, ...prev]);
    return res.data;
  };

  const update = async (id: string, data: Partial<Expense>) => {
    const res = await expensesApi.update(id, data);
    setExpenses(prev => prev.map(e => e.id === id ? res.data : e));
    return res.data;
  };

  const remove = async (id: string) => {
    await expensesApi.delete(id);
    setExpenses(prev => prev.filter(e => e.id !== id));
  };

  return { expenses, total, loading, error, refetch: fetch, create, update, remove };
}
