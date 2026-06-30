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

export type PaymentType = "credit" | "debit" | "cash" | "wallet";

export interface SourceFinancials {
  // Spend/bill figures respect the budget filter ("All time" filters nothing).
  spent:                number;
  reimbursableSpent:    number;
  claimedBack:          number;
  billToPay:            number;
  netOutOfPocket:       number;
  pendingReimbursement: number;
  // Balance figures are always all-time (the money on the source right now).
  receivedAll:          number;
  openingBalance:       number;
  currentBalance:       number;
}

export interface PaymentSource {
  id:             string;
  name:           string;
  type?:          string;
  paymentType?:   PaymentType;
  icon?:          string;
  color?:         string;
  balance?:       number | null;
  createdAt:      string;
  _count?:        { expenses: number };
  splitTenderId?: string | null;
  splitTender?:   { id: string; name: string } | null;
  financials?:    SourceFinancials;
}

export interface Reimbursement {
  id:                  string;
  amount:              number;
  date:                string;
  notes?:              string;
  status:              "pending" | "received";
  expenseId?:          string | null;
  destinationSourceId?: string | null;
  expense?:            { id: string; title: string; amount: number; sourceId?: string | null;
                         source?: { id: string; name: string; icon?: string } | null } | null;
  destinationSource?:  { id: string; name: string; icon?: string } | null;
  createdAt:           string;
}

export interface BudgetMetrics {
  plannedBurn: number;
  actualBurn:  number;
  variancePct: number;
  remaining:   number;
  forecast:    number;
  runwayDays:  number | null;
}

export interface BudgetGuidance {
  safeDailyLimit:  number;
  safeWeeklyLimit: number;
  cutNeeded:       number;
  projectedOver:   number;
  paceGap:         number;
  pctBudgetUsed:   number;
  pctTimeElapsed:  number;
  actualBurn:      number;
  remainDays:      number;
  rem:             number;
  over:            number;
  avgTx:           number;
  txsRemaining:    number | null;
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
  metrics?:         BudgetMetrics;
  guidance?:        BudgetGuidance;
}

export interface Expense {
  id:          string;
  title:       string;
  amount:      number;
  date:        string;
  notes?:      string;
  tags:        string[];
  costType?:   "fixed" | "variable";
  reimbursable?: boolean;
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

export interface BudgetAnalytics {
  totalSpent:        number;
  totalTransactions: number;
  avgPerTransaction: number;
  avgDailySpend:     number;
  totalRangeDays:    number;
  categoryBreakdown: { category: Category | null; total: number; count: number }[];
  sourceBreakdown:   { source: PaymentSource | null; total: number; count: number }[];
  monthly:           { year: number; monthNum: number; spend: number; count: number }[];
  fixedTotal:        number;
  fixedCount:        number;
  variableTotal:     number;
  variableCount:     number;
  dow:               { dayIndex: number; fixed: number; variable: number; total: number; count: number }[];
  unbudgetedTotal:   number;
  unbudgetedPct:     number;
  spikeDays:         number;
  spikeDates:        string[];
  activeDays:        number;
  activeDaysPct:     number;
  weekend:           { fixed: number; variable: number; total: number; pct: number; dates: string[] };
  momChange:         number | null;
  biggestFixed:      { id: string; title: string; amount: number; date: string } | null;
  biggestVariable:   { id: string; title: string; amount: number; date: string } | null;
  topFixedDate:      { date: string; total: number } | null;
  topVarDate:        { date: string; total: number } | null;
  topCatPct:         number;
}

export interface ReportSummary {
  totalSpent:        number;
  totalTransactions: number;
  avgTransaction:    number;
  minTransaction:    number;
  maxTransaction:    number;
  fixedTotal:        number;
  fixedCount:        number;
  variableTotal:     number;
  variableCount:     number;
  reimbursableTotal: number;
  reimbursableCount: number;
  firstDate:         string | null;
  lastDate:          string | null;
  spanDays:          number;
  activeDays:        number;
  avgPerActiveDay:   number;
}

export interface ReportGroup {
  name:  string;
  icon:  string;
  color: string;
  total: number;
  count: number;
  pct:   number;
}

export interface ReportFilters {
  startDate?:  string;
  endDate?:    string;
  categoryId?: string;
  sourceId?:   string;
  costType?:   "fixed" | "variable";
  search?:     string;
}

export interface ReportResponse {
  summary:    ReportSummary;
  byCategory: ReportGroup[];
  bySource:   ReportGroup[];
  byBudget:   ReportGroup[];
  monthly:    { year: number; monthNum: number; spend: number; count: number }[];
  expenses:   Expense[];
}

export interface AnalysisGroup {
  name:  string;
  icon:  string;
  color: string;
  total: number;
  count: number;
}

export interface ExpenseAnalysis {
  count:             number;
  total:             number;
  avg:               number;
  max:               number;
  min:               number;
  maxExpense:        { title: string; amount: number } | null;
  first:             string | null;
  last:              string | null;
  spanDays:          number;
  activeDays:        number;
  perDay:            number;
  fixedTotal:        number;
  variableTotal:     number;
  reimbursableTotal: number;
  reimbursableCount: number;
  unbudgetedTotal:   number;
  byCategory:        AnalysisGroup[];
  bySource:          AnalysisGroup[];
  byBudget:          AnalysisGroup[];
}

export interface CategoryTrend {
  categories: { id: string; name: string; color: string; icon: string }[];
  monthly:    { month: string; year: number; monthNum: number; totals: Record<string, number> }[];
}

export interface DashboardData {
  categoryBreakdown: { category: Category | null; total: number; count: number }[];
  recentExpenses:    Expense[];
  monthly:           { year: number; monthNum: number; spend: number; count: number }[];
}
