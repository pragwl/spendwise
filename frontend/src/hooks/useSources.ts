import { useState, useEffect, useCallback } from "react";
import { sourcesApi } from "../api/sources";
import type { PaymentSource } from "../types";

export function useSources() {
  const [sources,  setSources]  = useState<PaymentSource[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    sourcesApi.getAll()
      .then(res => setSources(res.data))
      .catch(e  => setError(e instanceof Error ? e.message : "Failed to load sources"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const create = async (data: Parameters<typeof sourcesApi.create>[0]) => {
    const res = await sourcesApi.create(data);
    setSources(prev => [...prev, res.data]);
    return res.data;
  };

  const update = async (id: string, data: Partial<PaymentSource>) => {
    const res = await sourcesApi.update(id, data);
    setSources(prev => prev.map(s => s.id === id ? res.data : s));
    return res.data;
  };

  const remove = async (id: string) => {
    await sourcesApi.delete(id);
    setSources(prev => prev.filter(s => s.id !== id));
  };

  return { sources, loading, error, refetch, create, update, remove };
}
