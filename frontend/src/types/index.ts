export interface SplitTender {
  id:           string;
  name:         string;
  description?: string;
  createdAt:    string;
  _count?:      { sources: number; budgetTenders: number };
}

export interface BudgetSplitTenderAllocation {
  splitTenderId:   string;
  splitTenderName: string;
  allocatedAmount: number;
  spentAmount:     number;
  threshold?:      number | null;
}

export interface Category {
  id:        string;
  name:      string;
  icon?:     string;
  color?:    string;
  createdAt: string;
  _count?:   { expenses: number };
}

export interface PaymentSource {
  id:             string;
  name:           string;
  type?:          string;
  icon?:          string;
  color?:         string;
  balance?:       number | null;
  createdAt:      string;
  _count?:        { expenses: number };
  splitTenderId?: string | null;
  splitTender?:   { id: string; name: string } | null;
}

export interface Budget {
  id:               string;
  name:             string;
  description?:     string;
  amount:           number;
  usedAmount?:      number;
  startDate:        string;
  endDate:          string;
  color?:           string;
  status:           "active" | "completed" | "paused";
  createdAt:        string;
  _count?:          { expenses: number };
  tenderAnalytics?: BudgetSplitTenderAllocation[];
}

export interface Expense {
  id:          string;
  title:       string;
  amount:      number;
  date:        string;
  notes?:      string;
  tags:        string[];
  costType?:   "fixed" | "variable";
  categoryId?: string;
  budgetId?:   string;
  sourceId?:   string;
  category?:   Category;
  budget?:     Budget;
  source?:     PaymentSource;
  createdAt:   string;
}

export interface ApiResponse<T> {
  success:   boolean;
  data:      T;
  meta?:     { total: number; limit: number; offset: number };
  timestamp: string;
}

export interface ApiError {
  success: false;
  error:   { message: string; code: string };
}

export interface AnalyticsSummary {
  totalSpent:        number;
  totalTransactions: number;
  avgTransaction:    number;
  categoryBreakdown: { category: Category | null; total: number; count: number }[];
  sourceBreakdown:   { source: PaymentSource | null; total: number; count: number }[];
  activeBudgets:     Budget[];
  recentExpenses:    Expense[];
}

export interface MonthlyTrend {
  year:  number;
  month: number;
  total: number;
  count: number;
}
