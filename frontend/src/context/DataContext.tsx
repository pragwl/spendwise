import {
  createContext, useContext, useState, useEffect, useCallback, ReactNode
} from "react";
import { categoriesApi }   from "../api/categories";
import { sourcesApi }      from "../api/sources";
import { budgetsApi }      from "../api/budgets";
import { expensesApi, ExpenseFilters } from "../api/expenses";
import { splitTendersApi } from "../api/splitTenders";
import { reimbursementsApi, ReimbursementInput } from "../api/reimbursements";
import type { Category, PaymentSource, Budget, Expense, SplitTender, Reimbursement } from "../types";

interface DataCtx {
  splitTenders: SplitTender[];   splitTendersLoading: boolean;
  categories: Category[];        catsLoading: boolean;
  sources: PaymentSource[];      srcsLoading: boolean;
  budgets: Budget[];             budgetsLoading: boolean;
  reimbursements: Reimbursement[]; reimbursementsLoading: boolean;
  expenses: Expense[];           expensesTotal: number; expensesLoading: boolean;
  expensesHasMore: boolean;      expensesLoadingMore: boolean;
  loadMoreExpenses: () => void;
  enableExpenses: () => void;
  enableCategories: () => void;
  enableSources: () => void;
  enableSplitTenders: () => void;
  enableReimbursements: () => void;
  expenseFilters: ExpenseFilters;
  setExpenseFilters: React.Dispatch<React.SetStateAction<ExpenseFilters>>;
  refetchSplitTenders: () => void;
  refetchCategories:   () => void;
  refetchSources:      () => void;
  refetchBudgets:      () => void;
  refetchReimbursements: () => void;
  createSplitTender: (d: Omit<SplitTender,"id"|"createdAt"|"_count">)         => Promise<SplitTender>;
  updateSplitTender: (id: string, d: Partial<SplitTender>)                     => Promise<SplitTender>;
  deleteSplitTender: (id: string)                                               => Promise<void>;
  createCategory: (d: Omit<Category,"id"|"createdAt"|"_count">)                => Promise<Category>;
  updateCategory: (id: string, d: Partial<Category>)                           => Promise<Category>;
  deleteCategory: (id: string)                                                  => Promise<void>;
  createSource:   (d: Omit<PaymentSource,"id"|"createdAt"|"_count">)           => Promise<PaymentSource>;
  updateSource:   (id: string, d: Partial<PaymentSource>)                      => Promise<PaymentSource>;
  deleteSource:   (id: string)                                                  => Promise<void>;
  createBudget:   (d: Omit<Budget,"id"|"createdAt"|"usedAmount"|"_count">)     => Promise<Budget>;
  updateBudget:   (id: string, d: Partial<Budget>)                             => Promise<Budget>;
  deleteBudget:   (id: string)                                                  => Promise<void>;
  createReimbursement: (d: ReimbursementInput)                                  => Promise<Reimbursement>;
  updateReimbursement: (id: string, d: Partial<ReimbursementInput>)            => Promise<Reimbursement>;
  deleteReimbursement: (id: string)                                             => Promise<void>;
  createExpense:  (d: Omit<Expense,"id"|"createdAt"|"category"|"budget"|"source">) => Promise<Expense>;
  updateExpense:  (id: string, d: Partial<Expense>)                            => Promise<Expense>;
  deleteExpense:  (id: string)                                                  => Promise<void>;
}

const Ctx = createContext<DataCtx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [splitTenders, setSplitTenders] = useState<SplitTender[]>([]);
  const [splitTendersLoading, setSplitTendersLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [sources, setSources] = useState<PaymentSource[]>([]);
  const [srcsLoading, setSrcsLoading] = useState(true);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetsLoading, setBudgetsLoading] = useState(true);
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>([]);
  const [reimbursementsLoading, setReimbursementsLoading] = useState(true);
  const [reimbursementsActive, setReimbursementsActive] = useState(false);
  const enableReimbursements = useCallback(() => setReimbursementsActive(true), []);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesLoadingMore, setExpensesLoadingMore] = useState(false);
  // The main expense list is only fetched once a screen that needs it (Expenses)
  // activates it — Dashboard/Analytics/Reports never load it.
  const [expensesActive, setExpensesActive] = useState(false);
  const [expenseFilters, setExpenseFilters] = useState<ExpenseFilters>({
    limit: 50, sortBy: "date", order: "desc",
  });

  const expensesHasMore = expenses.length < expensesTotal;
  const enableExpenses = useCallback(() => setExpensesActive(true), []);

  // Reference collections are loaded on demand by the screens/modal that use
  // them, so screens like Dashboard/Analytics/Reports don't trigger their
  // fetches. (Budgets stays eager — almost every screen needs it.)
  const [catsActive, setCatsActive]               = useState(false);
  const [srcsActive, setSrcsActive]               = useState(false);
  const [splitTendersActive, setSplitTendersActive] = useState(false);
  const enableCategories   = useCallback(() => setCatsActive(true), []);
  const enableSources      = useCallback(() => setSrcsActive(true), []);
  const enableSplitTenders = useCallback(() => setSplitTendersActive(true), []);

  const refetchSplitTenders = useCallback(() => {
    setSplitTendersLoading(true);
    splitTendersApi.getAll().then(r => setSplitTenders(r.data ?? [])).catch(console.error).finally(() => setSplitTendersLoading(false));
  }, []);

  const refetchCategories = useCallback(() => {
    setCatsLoading(true);
    categoriesApi.getAll().then(r => setCategories(r.data ?? [])).catch(console.error).finally(() => setCatsLoading(false));
  }, []);

  const refetchSources = useCallback(() => {
    setSrcsLoading(true);
    sourcesApi.getAll().then(r => setSources(r.data ?? [])).catch(console.error).finally(() => setSrcsLoading(false));
  }, []);

  const refetchBudgets = useCallback(() => {
    setBudgetsLoading(true);
    budgetsApi.getAll().then(r => setBudgets(r.data ?? [])).catch(console.error).finally(() => setBudgetsLoading(false));
  }, []);

  const refetchReimbursements = useCallback(() => {
    setReimbursementsLoading(true);
    reimbursementsApi.getAll().then(r => setReimbursements(r.data ?? [])).catch(console.error).finally(() => setReimbursementsLoading(false));
  }, []);

  // Budgets eager; the rest load only once a consumer activates them.
  useEffect(() => { refetchBudgets(); }, [refetchBudgets]);
  useEffect(() => { if (splitTendersActive) refetchSplitTenders(); }, [splitTendersActive, refetchSplitTenders]);
  useEffect(() => { if (catsActive) refetchCategories(); },          [catsActive, refetchCategories]);
  useEffect(() => { if (srcsActive) refetchSources(); },             [srcsActive, refetchSources]);
  useEffect(() => { if (reimbursementsActive) refetchReimbursements(); }, [reimbursementsActive, refetchReimbursements]);

  // Main expense list — fetches the first page once activated, and re-fetches
  // when filters change (replaces the list and resets pagination to offset 0).
  useEffect(() => {
    if (!expensesActive) return;
    let live = true;
    setExpensesLoading(true);
    expensesApi.getAll({ ...expenseFilters, offset: 0 })
      .then(r => { if (live) { setExpenses(r.data ?? []); setExpensesTotal(r.meta?.total ?? r.data?.length ?? 0); } })
      .catch(console.error)
      .finally(() => { if (live) setExpensesLoading(false); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(expenseFilters), expensesActive]);

  // Fetch the next page and append it (infinite scroll).
  const loadMoreExpenses = useCallback(() => {
    if (expensesLoadingMore || expenses.length >= expensesTotal) return;
    setExpensesLoadingMore(true);
    expensesApi.getAll({ ...expenseFilters, offset: expenses.length })
      .then(r => {
        const incoming = r.data ?? [];
        // Dedupe in case the list shifted between pages
        setExpenses(prev => {
          const seen = new Set(prev.map(e => e.id));
          return [...prev, ...incoming.filter(e => !seen.has(e.id))];
        });
        if (r.meta?.total != null) setExpensesTotal(r.meta.total);
      })
      .catch(console.error)
      .finally(() => setExpensesLoadingMore(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses.length, expensesTotal, expensesLoadingMore, JSON.stringify(expenseFilters)]);

  // ── Split Tender CRUD ──────────────────────────────────────────────────
  const createSplitTender = async (d: Omit<SplitTender,"id"|"createdAt"|"_count">) => {
    const r = await splitTendersApi.create(d);
    setSplitTenders(p => [...p, r.data].sort((a, b) => a.name.localeCompare(b.name)));
    return r.data;
  };
  const updateSplitTender = async (id: string, d: Partial<SplitTender>) => {
    const r = await splitTendersApi.update(id, d);
    setSplitTenders(p => p.map(t => t.id === id ? r.data : t));
    return r.data;
  };
  const deleteSplitTender = async (id: string) => {
    await splitTendersApi.delete(id);
    setSplitTenders(p => p.filter(t => t.id !== id));
  };

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

  // ── Reimbursement CRUD ─────────────────────────────────────────────────
  // Reimbursements change per-source figures (bill to pay, available, etc.),
  // so refresh sources after each mutation.
  const createReimbursement = async (d: ReimbursementInput) => {
    const r = await reimbursementsApi.create(d);
    setReimbursements(p => [r.data, ...p]);
    refetchSources();
    return r.data;
  };
  const updateReimbursement = async (id: string, d: Partial<ReimbursementInput>) => {
    const r = await reimbursementsApi.update(id, d);
    setReimbursements(p => p.map(x => x.id === id ? r.data : x));
    refetchSources();
    return r.data;
  };
  const deleteReimbursement = async (id: string) => {
    await reimbursementsApi.delete(id);
    setReimbursements(p => p.filter(x => x.id !== id));
    refetchSources();
  };

  // ── Expense CRUD ───────────────────────────────────────────────────────
  const createExpense = async (d: Omit<Expense,"id"|"createdAt"|"category"|"budget"|"source">) => {
    const r = await expensesApi.create(d);
    const e = r.data;
    setExpenses(p => [e, ...p]);
    setExpensesTotal(p => p + 1);
    refetchBudgets();
    refetchSources();
    return e;
  };
  const updateExpense = async (id: string, d: Partial<Expense>) => {
    const r = await expensesApi.update(id, d);
    const e = r.data;
    setExpenses(p => p.map(x => x.id === id ? e : x));
    refetchBudgets();
    refetchSources();
    return e;
  };
  const deleteExpense = async (id: string) => {
    await expensesApi.delete(id);
    setExpenses(p => p.filter(x => x.id !== id));
    setExpensesTotal(p => Math.max(0, p - 1));
    refetchBudgets();
    refetchSources();
    // A deleted expense cascade-deletes its reimbursement(s); refresh so they drop from the list.
    setReimbursements(p => p.filter(r => r.expenseId !== id));
    if (reimbursementsActive) refetchReimbursements();
  };

  return (
    <Ctx.Provider value={{
      splitTenders, splitTendersLoading,
      categories, catsLoading, sources, srcsLoading,
      budgets, budgetsLoading,
      reimbursements, reimbursementsLoading,
      expenses, expensesTotal, expensesLoading,
      expensesHasMore, expensesLoadingMore, loadMoreExpenses, enableExpenses,
      enableCategories, enableSources, enableSplitTenders, enableReimbursements,
      expenseFilters, setExpenseFilters,
      refetchSplitTenders, refetchCategories, refetchSources, refetchBudgets, refetchReimbursements,
      createSplitTender, updateSplitTender, deleteSplitTender,
      createCategory, updateCategory, deleteCategory,
      createSource, updateSource, deleteSource,
      createBudget, updateBudget, deleteBudget,
      createReimbursement, updateReimbursement, deleteReimbursement,
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
