import {
  createContext, useContext, useState, useEffect, useCallback, ReactNode
} from "react";
import { categoriesApi } from "../api/categories";
import { sourcesApi }    from "../api/sources";
import { budgetsApi }    from "../api/budgets";
import { expensesApi, ExpenseFilters } from "../api/expenses";
import type { Category, PaymentSource, Budget, Expense } from "../types";

interface DataCtx {
  categories: Category[];     catsLoading: boolean;
  sources: PaymentSource[];   srcsLoading: boolean;
  budgets: Budget[];          budgetsLoading: boolean;
  recentExpenses: Expense[];
  expenses: Expense[];        expensesTotal: number; expensesLoading: boolean;
  expenseFilters: ExpenseFilters;
  setExpenseFilters: React.Dispatch<React.SetStateAction<ExpenseFilters>>;
  refetchCategories: () => void;
  refetchSources:    () => void;
  refetchBudgets:    () => void;
  refetchExpenses:   () => void;
  createCategory: (d: Omit<Category,"id"|"createdAt"|"_count">)           => Promise<Category>;
  updateCategory: (id: string, d: Partial<Category>)                       => Promise<Category>;
  deleteCategory: (id: string)                                              => Promise<void>;
  createSource:   (d: Omit<PaymentSource,"id"|"createdAt"|"_count">)       => Promise<PaymentSource>;
  updateSource:   (id: string, d: Partial<PaymentSource>)                  => Promise<PaymentSource>;
  deleteSource:   (id: string)                                              => Promise<void>;
  createBudget:   (d: Omit<Budget,"id"|"createdAt"|"usedAmount"|"_count">) => Promise<Budget>;
  updateBudget:   (id: string, d: Partial<Budget>)                         => Promise<Budget>;
  deleteBudget:   (id: string)                                              => Promise<void>;
  createExpense:  (d: Omit<Expense,"id"|"createdAt"|"category"|"budget"|"source">) => Promise<Expense>;
  updateExpense:  (id: string, d: Partial<Expense>)                        => Promise<Expense>;
  deleteExpense:  (id: string)                                              => Promise<void>;
}

const Ctx = createContext<DataCtx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [sources, setSources] = useState<PaymentSource[]>([]);
  const [srcsLoading, setSrcsLoading] = useState(true);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetsLoading, setBudgetsLoading] = useState(true);
  const [recentExpenses, setRecent] = useState<Expense[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expenseFilters, setExpenseFilters] = useState<ExpenseFilters>({
    limit: 50, sortBy: "date", order: "desc",
  });
  const [fetchKey, setFetchKey] = useState(0);

  const refetchCategories = useCallback(() => {
    setCatsLoading(true);
    categoriesApi.getAll().then(r => setCategories(r.data)).catch(console.error).finally(() => setCatsLoading(false));
  }, []);

  const refetchSources = useCallback(() => {
    setSrcsLoading(true);
    sourcesApi.getAll().then(r => setSources(r.data)).catch(console.error).finally(() => setSrcsLoading(false));
  }, []);

  const refetchBudgets = useCallback(() => {
    setBudgetsLoading(true);
    budgetsApi.getAll().then(r => setBudgets(r.data)).catch(console.error).finally(() => setBudgetsLoading(false));
  }, []);

  const refetchExpenses = useCallback(() => setFetchKey(k => k + 1), []);

  useEffect(() => { refetchCategories(); }, [refetchCategories]);
  useEffect(() => { refetchSources(); },    [refetchSources]);
  useEffect(() => { refetchBudgets(); },    [refetchBudgets]);

  // Recent expenses for dashboard — fetched once, updated locally
  useEffect(() => {
    expensesApi.getAll({ limit: 5, sortBy: "date", order: "desc" })
      .then(r => setRecent(r.data)).catch(console.error);
  }, []);

  // Main expense list — re-fetches when filters or fetchKey change
  useEffect(() => {
    let live = true;
    setExpensesLoading(true);
    expensesApi.getAll(expenseFilters)
      .then(r => { if (live) { setExpenses(r.data); setExpensesTotal(r.meta?.total ?? r.data.length); } })
      .catch(console.error)
      .finally(() => { if (live) setExpensesLoading(false); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(expenseFilters), fetchKey]);

  // ── Category CRUD ──────────────────────────────────────────────────────
  const createCategory = async (d: Omit<Category,"id"|"createdAt"|"_count">) => {
    const r = await categoriesApi.create(d);
    setCategories(p => [...p, r.data]);
    return r.data;
  };
  const updateCategory = async (id: string, d: Partial<Category>) => {
    const r = await categoriesApi.update(id, d);
    setCategories(p => p.map(c => c.id === id ? r.data : c));
    return r.data;
  };
  const deleteCategory = async (id: string) => {
    await categoriesApi.delete(id);
    setCategories(p => p.filter(c => c.id !== id));
  };

  // ── Source CRUD ────────────────────────────────────────────────────────
  const createSource = async (d: Omit<PaymentSource,"id"|"createdAt"|"_count">) => {
    const r = await sourcesApi.create(d);
    setSources(p => [...p, r.data]);
    return r.data;
  };
  const updateSource = async (id: string, d: Partial<PaymentSource>) => {
    const r = await sourcesApi.update(id, d);
    setSources(p => p.map(s => s.id === id ? r.data : s));
    return r.data;
  };
  const deleteSource = async (id: string) => {
    await sourcesApi.delete(id);
    setSources(p => p.filter(s => s.id !== id));
  };

  // ── Budget CRUD ────────────────────────────────────────────────────────
  const createBudget = async (d: Omit<Budget,"id"|"createdAt"|"usedAmount"|"_count">) => {
    const r = await budgetsApi.create(d);
    setBudgets(p => [r.data, ...p]);
    return r.data;
  };
  const updateBudget = async (id: string, d: Partial<Budget>) => {
    const r = await budgetsApi.update(id, d);
    setBudgets(p => p.map(b => b.id === id ? { ...b, ...r.data } : b));
    return r.data;
  };
  const deleteBudget = async (id: string) => {
    await budgetsApi.delete(id);
    setBudgets(p => p.filter(b => b.id !== id));
  };

  // ── Expense CRUD ───────────────────────────────────────────────────────
  const createExpense = async (d: Omit<Expense,"id"|"createdAt"|"category"|"budget"|"source">) => {
    const r = await expensesApi.create(d);
    const e = r.data;
    setRecent(p => [e, ...p].slice(0, 5));
    setExpenses(p => [e, ...p]);
    setExpensesTotal(p => p + 1);
    refetchBudgets();
    return e;
  };
  const updateExpense = async (id: string, d: Partial<Expense>) => {
    const r = await expensesApi.update(id, d);
    const e = r.data;
    setRecent(p => p.map(x => x.id === id ? e : x));
    setExpenses(p => p.map(x => x.id === id ? e : x));
    refetchBudgets();
    return e;
  };
  const deleteExpense = async (id: string) => {
    await expensesApi.delete(id);
    setRecent(p => p.filter(x => x.id !== id));
    setExpenses(p => p.filter(x => x.id !== id));
    setExpensesTotal(p => Math.max(0, p - 1));
    refetchBudgets();
  };

  return (
    <Ctx.Provider value={{
      categories, catsLoading, sources, srcsLoading,
      budgets, budgetsLoading, recentExpenses,
      expenses, expensesTotal, expensesLoading,
      expenseFilters, setExpenseFilters,
      refetchCategories, refetchSources, refetchBudgets, refetchExpenses,
      createCategory, updateCategory, deleteCategory,
      createSource, updateSource, deleteSource,
      createBudget, updateBudget, deleteBudget,
      createExpense, updateExpense, deleteExpense,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be inside DataProvider");
  return ctx;
}
