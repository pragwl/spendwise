import React, { useState, useEffect, useRef, useCallback } from "react";
import { expensesApi, ExpenseFilters } from "./api/expenses";
import { sourcesApi } from "./api/sources";
import { analyticsApi } from "./api/analytics";
import type { Expense, Budget, Category, PaymentSource, PaymentType, SourceFinancials, SplitTender, BudgetSplitTenderAllocation, BudgetAnalytics, ReportSummary, DashboardData, BudgetMetrics, BudgetGuidance, Reimbursement, ExpenseAnalysis, AnalysisGroup, CategoryTrend } from "./types";
import { config as appConfig } from "./config";
import { DataProvider, useData } from "./context/DataContext";
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
} from "recharts";

// ── Helpers ──────────────────────────────────────────────────────────────
const fmt  = (n: number) => appConfig.app.currency + Math.round(n).toLocaleString(appConfig.app.locale);
const fmtS = (n: number) => n >= 100000 ? appConfig.app.currency+(n/100000).toFixed(1)+"L" : n >= 1000 ? appConfig.app.currency+(n/1000).toFixed(1)+"k" : appConfig.app.currency+Math.round(n);
const toDateStr = (d: string) => (d || "").slice(0, 10);

// Calendar-safe date parsers (Stripping time to avoid timezone offset bugs & fractional days)
const getSafeDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
// Local YYYY-MM-DD for <input type="date">. Avoids toISOString() which uses UTC and
// can roll back to "yesterday" for users east of UTC (e.g. IST) early in the day.
const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
// Inclusive number of days between two date-only strings (start & end both count).
const daysInclusive = (start: string, end: string) => {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((getSafeDate(end).getTime() - getSafeDate(start).getTime()) / 86400000) + 1);
};

const T = {
  primary:"#C2623F", primaryS:"#FAEEE9",
  danger:"#C0392B",  dangerS:"#FDECEA",
  warn:"#D4851A",    warnS:"#FEF3E2",
  sage:"#2E7D5E",    sageS:"#E8F5EF",
  sky:"#2563A8",     skyS:"#EBF2FB",
  ink:"#2D2520", muted:"#7A6E68", faint:"#B0A8A2",
  line:"#EDE8E3", paper:"#FFFFFF", cream:"#FAF7F4", raised:"#F4F0EC",
};
const toneC: Record<string,string> = { danger:T.danger, warn:T.warn, sage:T.sage, sky:T.sky, primary:T.primary };
const toneS: Record<string,string> = { danger:T.dangerS, warn:T.warnS, sage:T.sageS, sky:T.skyS, primary:T.primaryS };

function health(pct: number) {
  if (pct >= 100) return { label:"Over budget", tone:"danger" };
  if (pct >= 85)  return { label:"Watch",       tone:"warn" };
  if (pct >= 60)  return { label:"On track",    tone:"sky" };
  return { label:"Healthy", tone:"sage" };
}

const CHART_PALETTE = ["#C2623F","#3BAF7E","#9B6DBF","#5B8FD4","#E8A838","#E07B5A","#61AFEF","#E5C07B","#C678DD","#56B6C2","#E06C75","#98C379"];
// Bold, highly-saturated palette for multi-line charts — each series gets a
// distinct, dense colour so overlapping lines stay easy to tell apart.
const TREND_COLORS = ["#C0392B","#1E6FB8","#1B7F4B","#7B2FB5","#D4851A","#0E8C8C","#B5179E","#2C3E8C","#6A8C1F","#A64B00","#0B6E99","#9B1D42"];

// Presentation only — burn-rate metrics are computed server-side (Budget.metrics);
// this just formats them into the tiles the budget row renders.
function burnMetricTiles(m: BudgetMetrics) {
  const fmtRunway = (d: number | null) => {
    if (d === null) return "—";
    if (d < 14)     return `${Math.round(d)} day${Math.round(d) !== 1 ? "s" : ""}`;
    if (d < 60)     return `${(d / 7).toFixed(1)} wk`;
    return `${(d / 30.44).toFixed(1)} mo`;
  };
  return [
    { label:"Planned burn rate",    value:`${fmt(m.plannedBurn)}/day`, hi:false, tip:"How much you should spend each day to use this budget evenly by the end date." },
    { label:"Actual burn rate",     value:`${fmt(m.actualBurn)}/day`,  hi:false, tip:"How much you're actually spending per day on average since the budget started." },
    { label:"Burn rate variance",   value:`${m.variancePct >= 0 ? "+" : ""}${m.variancePct.toFixed(1)}%`, hi:m.variancePct > 10, tip:"How far off your spending pace is. Positive means you're spending faster than planned; negative means slower." },
    { label:"Remaining budget",     value:fmt(m.remaining),            hi:false, tip:"How much money is left in this budget right now." },
    { label:"Forecasted end spend", value:fmt(m.forecast),             hi:false, tip:"If you keep spending at today's daily rate, this is the total you'll have spent by the budget's end date." },
    { label:"Runway",               value:fmtRunway(m.runwayDays),     hi:false, tip:"How long the remaining budget will last if you continue spending at your current rate." },
  ];
}

const EMPTY_GUIDANCE: BudgetGuidance = {
  safeDailyLimit:0, safeWeeklyLimit:0, cutNeeded:0, projectedOver:0, paceGap:0,
  pctBudgetUsed:0, pctTimeElapsed:0, actualBurn:0, remainDays:0, rem:0, over:0, avgTx:0, txsRemaining:null,
};

function isTenderAlerted(ta: BudgetSplitTenderAllocation): boolean {
  if (ta.threshold == null || !ta.allocatedAmount) return false;
  return (ta.spentAmount / ta.allocatedAmount) * 100 >= ta.threshold;
}

// Fetch every page of a filtered expense query (the server caps each page at
// 200), so drill-through views are complete rather than silently truncated.
async function fetchAllExpenses(filters: ExpenseFilters): Promise<Expense[]> {
  const PAGE = 200;
  const out: Expense[] = [];
  let offset = 0;
  for (;;) {
    const r = await expensesApi.getAll({ ...filters, limit: PAGE, offset });
    const batch = r.data ?? [];
    out.push(...batch);
    const total = r.meta?.total ?? out.length;
    offset += batch.length;
    if (batch.length === 0 || out.length >= total) break;
  }
  return out;
}

// ── Tiny UI ───────────────────────────────────────────────────────────────
function Card({ children, style={}, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
  return <div style={{ background:T.paper, border:`1px solid ${T.line}`, borderRadius:20, padding:"20px 22px", cursor:onClick?"pointer":"default", ...style }} onClick={onClick}>{children}</div>;
}
function Btn({ children, onClick, variant="primary", full, size="md", disabled }: {
  children: React.ReactNode; onClick?: () => void; variant?: string; full?: boolean; size?: string; disabled?: boolean;
}) {
  const pad = size==="lg" ? "11px 20px" : size==="sm" ? "6px 12px" : "8px 16px";
  const vs: Record<string,React.CSSProperties> = {
    primary:{ background:T.primary, color:"#fff", border:"none", boxShadow:`0 2px 8px ${T.primary}44` },
    outline:{ background:T.paper,   color:T.ink,  border:`1px solid ${T.line}` },
    ghost:  { background:"transparent", color:T.muted, border:"none" },
    danger: { background:T.dangerS, color:T.danger, border:"none" },
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ display:"inline-flex", alignItems:"center", gap:7, padding:pad, fontSize:size==="lg"?15:13,
               fontWeight:600, borderRadius:12, cursor:disabled?"not-allowed":"pointer", opacity:disabled?.5:1,
               width:full?"100%":undefined, justifyContent:"center", fontFamily:"inherit",
               transition:"opacity .15s", ...vs[variant] }}>
      {children}
    </button>
  );
}
function Badge({ children, tone="sage" }: { children: React.ReactNode; tone?: string }) {
  return <span style={{ display:"inline-flex", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:99, background:toneS[tone], color:toneC[tone] }}>{children}</span>;
}
function Progress({ pct, tone="sage", h=8 }: { pct: number; tone?: string; h?: number }) {
  return <div style={{ height:h, borderRadius:99, background:T.line, overflow:"hidden" }}>
    <div style={{ height:"100%", borderRadius:99, width:Math.min(100,pct)+"%", background:toneC[tone], transition:"width .5s" }} />
  </div>;
}
function Spinner() {
  return <div style={{ display:"flex", justifyContent:"center", padding:40, color:T.muted }}>Loading…</div>;
}
function ErrMsg({ msg }: { msg: string }) {
  return <div style={{ padding:16, borderRadius:12, background:T.dangerS, color:T.danger, fontSize:13, margin:"12px 0" }}>⚠️ {msg}</div>;
}
function KpiInfo({ text }: { text: string }) {
  const [pos, setPos] = useState<{x:number;y:number}|null>(null);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ x: Math.min(r.left, window.innerWidth - 236), y: r.bottom + 6 });
  };
  return (
    <span style={{ display:"inline-flex", alignItems:"center" }}>
      <button onClick={toggle}
        style={{ width:15, height:15, borderRadius:99, border:`1px solid ${T.faint}`,
          background: pos ? T.ink : T.raised, color: pos ? "#fff" : T.muted,
          fontSize:9, fontWeight:700, cursor:"pointer", display:"inline-flex",
          alignItems:"center", justifyContent:"center", lineHeight:1,
          padding:0, marginLeft:4, flexShrink:0, fontFamily:"inherit",
          transition:"background .15s,color .15s" }}>
        i
      </button>
      {pos && <>
        <div onClick={() => setPos(null)} style={{ position:"fixed", inset:0, zIndex:998 }} />
        <div style={{ position:"fixed", left:pos.x, top:pos.y, zIndex:999,
          background:T.ink, color:"#fff", borderRadius:10, padding:"8px 12px",
          fontSize:12, lineHeight:1.5, width:224,
          boxShadow:"0 4px 20px rgba(0,0,0,.25)" }}>
          {text}
        </div>
      </>}
    </span>
  );
}
function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const mobile = useMobile();
  if (!open) return null;
  return <div style={{ position:"fixed", inset:0, zIndex:999, display:"flex", alignItems: mobile ? "flex-end" : "center", justifyContent:"center" }} onClick={onClose}>
    <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.4)", backdropFilter:"blur(3px)" }} />
    <div onClick={e=>e.stopPropagation()} style={{ position:"relative", width:"100%", maxWidth:480, background:T.paper, borderRadius: mobile ? "22px 22px 0 0" : 20, maxHeight: mobile ? "95vh" : "85vh", display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 18px", borderBottom:`1px solid ${T.line}`, flexShrink:0 }}>
        <span style={{ fontWeight:800, fontSize:16, color:T.ink }}>{title}</span>
        <button onClick={onClose} style={{ width:30, height:30, borderRadius:9, background:T.raised, border:`1px solid ${T.line}`, cursor:"pointer", fontSize:14 }}>✕</button>
      </div>
      <div style={{ padding: mobile ? "14px 16px" : "18px 20px", overflowY:"auto", flex:1, WebkitOverflowScrolling:"touch" } as React.CSSProperties}>{children}</div>
      {footer && <div style={{ padding: mobile ? "12px 16px" : "14px 20px", borderTop:`1px solid ${T.line}`, flexShrink:0 }}>{footer}</div>}
    </div>
  </div>;
}
function Inp({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [f,sf] = useState(false);
  return <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
    {label && <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em" }}>{label}</span>}
    <input {...props} onFocus={e=>{sf(true);props.onFocus?.(e)}} onBlur={e=>{sf(false);props.onBlur?.(e)}}
      style={{ width:"100%", padding:"10px 13px", borderRadius:13, border:`1px solid ${f?T.primary:T.line}`,
               boxShadow:f?`0 0 0 3px ${T.primaryS}`:"", background:T.cream, color:T.ink, fontSize:14,
               outline:"none", fontFamily:"inherit", ...props.style }} />
  </div>;
}
function Sel({ label, children, ...props }: { label?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
    {label && <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em" }}>{label}</span>}
    <div style={{ position:"relative" }}>
      <select {...props} style={{ width:"100%", padding:"10px 32px 10px 13px", borderRadius:13, border:`1px solid ${T.line}`, background:T.cream, color:T.ink, fontSize:14, outline:"none", cursor:"pointer", fontFamily:"inherit", appearance:"none" }}>{children}</select>
      <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", color:T.faint, pointerEvents:"none" }}>▾</span>
    </div>
  </div>;
}
function IconBtn({ icon, onClick, tone="muted" }: { icon:string; onClick:()=>void; tone?:string }) {
  const bg: Record<string,string> = { danger:T.dangerS, muted:T.raised, primary:T.primaryS };
  const fg: Record<string,string> = { danger:T.danger,  muted:T.muted,  primary:T.primary };
  return <button onClick={onClick}
    style={{ width:30, height:30, borderRadius:9, background:bg[tone]||T.raised, border:"none",
             cursor:"pointer", display:"grid", placeItems:"center", fontSize:14, color:fg[tone]||T.muted, flexShrink:0 }}>
    {icon}
  </button>;
}

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position:"relative", display:"inline-flex", verticalAlign:"middle", flexShrink:0 }}>
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={e => { e.stopPropagation(); setShow(s => !s); }}
        style={{ width:14, height:14, borderRadius:"50%", background:T.raised, border:`1px solid ${T.line}`,
                 cursor:"pointer", fontSize:8, fontWeight:800, color:T.muted,
                 display:"inline-flex", alignItems:"center", justifyContent:"center", padding:0, lineHeight:1 }}
      >i</button>
      {show && (
        <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)",
                      background:T.ink, color:"#fff", fontSize:11, lineHeight:1.5,
                      padding:"8px 10px", borderRadius:8, width:190, zIndex:200,
                      boxShadow:"0 4px 16px rgba(0,0,0,.2)", pointerEvents:"none", whiteSpace:"normal" }}>
          {text}
        </div>
      )}
    </span>
  );
}

// Threshold alert popover — wraps a "⚠️ threshold" badge; hover or click to reveal which tenders hit their alert
function ThresholdInfo({ alerts, children }: { alerts: (BudgetSplitTenderAllocation & { budgetName?: string })[]; children: React.ReactNode }) {
  const [pos, setPos] = useState<{x:number;y:number}|null>(null);
  const [pinned, setPinned] = useState(false);
  if (alerts.length === 0) return <>{children}</>;

  const locate = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(r.left, window.innerWidth - 268), y: r.bottom + 6 });
  };
  const onEnter = (e: React.MouseEvent) => { if (!pinned) locate(e.currentTarget as HTMLElement); };
  const onLeave = () => { if (!pinned) setPos(null); };
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pinned) { setPinned(false); setPos(null); }
    else { setPinned(true); locate(e.currentTarget as HTMLElement); }
  };

  return (
    <span onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onClick}
      style={{ display:"inline-flex", alignItems:"center", cursor:"pointer" }}>
      {children}
      {pos && <>
        {pinned && <div onClick={e=>{ e.stopPropagation(); setPinned(false); setPos(null); }}
          style={{ position:"fixed", inset:0, zIndex:998 }} />}
        <div style={{ position:"fixed", left:pos.x, top:pos.y, zIndex:999,
          background:T.ink, color:"#fff", borderRadius:10, padding:"10px 12px",
          fontSize:12, lineHeight:1.45, width:256, boxShadow:"0 4px 20px rgba(0,0,0,.25)" }}>
          <p style={{ fontWeight:700, marginBottom:4 }}>⚠️ Threshold{alerts.length>1?"s":""} reached</p>
          {alerts.map(ta => {
            const pct = ta.allocatedAmount ? Math.round((ta.spentAmount/ta.allocatedAmount)*100) : 0;
            return (
              <div key={`${ta.budgetName||""}-${ta.splitTenderId}`} style={{ marginTop:6 }}>
                <p style={{ fontWeight:600 }}>{ta.splitTenderName}{ta.budgetName ? ` · ${ta.budgetName}` : ""}</p>
                <p style={{ color:"#ffffffcc" }}>{fmt(ta.spentAmount)} / {fmt(ta.allocatedAmount)} ({pct}%) · alert at {ta.threshold}%</p>
              </div>
            );
          })}
        </div>
      </>}
    </span>
  );
}

// Inline filter select (no label, compact)
function FSel({ value, onChange, children }: { value:string; onChange:(v:string)=>void; children:React.ReactNode }) {
  return <div style={{ position:"relative" }}>
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{ width:"100%", padding:"9px 28px 9px 12px", borderRadius:11, border:`1px solid ${T.line}`, background:T.cream, color:T.ink, fontSize:13, cursor:"pointer", outline:"none", fontFamily:"inherit", appearance:"none" }}>
      {children}
    </select>
    <span style={{ position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", color:T.faint, pointerEvents:"none" }}>▾</span>
  </div>;
}

// ── Mobile detection ─────────────────────────────────────────────────────
function useMobile() {
  const [m, setM] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
}

// ── NAV ───────────────────────────────────────────────────────────────────
const NAV = [
  { id:"dashboard",     label:"Dashboard",       emoji:"🏠" },
  { id:"budgets",       label:"Budgets",         emoji:"💰" },
  { id:"expenses",      label:"Expenses",        emoji:"📋" },
  { id:"categories",    label:"Categories",      emoji:"🏷️" },
  { id:"sources",       label:"Payment Sources", emoji:"💳" },
  { id:"split-tenders", label:"Split Tenders",   emoji:"🗂️" },
  { id:"reimbursements",label:"Reimbursements",  emoji:"🔄" },
  { id:"analytics",     label:"Analytics",       emoji:"📊" },
  { id:"reports",       label:"Reports",         emoji:"📁" },
];

// ── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ onAdd, goTo }: { onAdd:()=>void; goTo:(r:string)=>void }) {
  const mobile = useMobile();
  const { budgets, budgetsLoading, categories, enableCategories } = useData();
  const [dash, setDash] = useState<DashboardData|null>(null);
  const [selBudgetId, setSelBudgetId] = useState("");

  // Category-trend chart: user picks one or more categories; we plot each one's
  // monthly spend as its own line. Data comes from /analytics/category-trend.
  useEffect(() => { enableCategories(); }, [enableCategories]);
  const [selCats, setSelCats] = useState<string[]>([]);
  const [catTrend, setCatTrend] = useState<CategoryTrend|null>(null);
  const catTrendInit = useRef(false);
  // Seed with the first few categories once they load, for a useful default view.
  useEffect(() => {
    if (!catTrendInit.current && categories.length > 0) {
      catTrendInit.current = true;
      setSelCats(categories.slice(0, 3).map(c => c.id));
    }
  }, [categories]);
  useEffect(() => {
    if (selCats.length === 0) { setCatTrend(null); return; }
    let live = true;
    analyticsApi.getCategoryTrend(selCats)
      .then(r => { if (live) setCatTrend(r.data); })
      .catch(console.error);
    return () => { live = false; };
  }, [selCats]);
  const toggleCat = (id: string) => setSelCats(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const active = budgets.filter(b => b.status === "active");
  const selectedBudget = selBudgetId ? active.find(b => b.id === selBudgetId) : null;

  // Category breakdown, recent list, and monthly trend are computed server-side
  // (scoped to the selected budget, or all active budgets by default).
  useEffect(() => {
    if (budgetsLoading) return; // wait for budgets to resolve — avoids a duplicate empty-state fetch
    analyticsApi.getDashboard(selBudgetId || undefined)
      .then(r => setDash(r.data))
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selBudgetId, budgets, budgetsLoading]);

  // Aggregate or single-budget metrics
  const totalBud = active.reduce((s,b) => s + Number(b.amount || 0), 0);
  const totalSp  = active.reduce((s,b) => s + Number(b.usedAmount || 0), 0);
  const budAmt   = selectedBudget ? Number(selectedBudget.amount || 0) : totalBud;
  const budSp    = selectedBudget ? Number(selectedBudget.usedAmount || 0) : totalSp;
  const left       = Math.max(0, budAmt - budSp);
  const overBudget = Math.max(0, budSp - budAmt);
  const pct        = budAmt ? (budSp / budAmt) * 100 : 0;
  const h          = health(pct);

  // Keep the budget each alerted tender belongs to, so alerts can name it.
  const alertedTenders: (BudgetSplitTenderAllocation & { budgetName: string })[] = selectedBudget
    ? (selectedBudget.tenderAnalytics || []).filter(isTenderAlerted).map(ta => ({ ...ta, budgetName: selectedBudget.name }))
    : active.flatMap(b => (b.tenderAnalytics || []).filter(isTenderAlerted).map(ta => ({ ...ta, budgetName: b.name })));

  const overviewTone = overBudget > 0 ? "danger" : alertedTenders.length > 0 ? "warn" : h.tone;

  // Category breakdown, recent list, and monthly trend — computed server-side
  const MONTHS = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const cats = dash?.categoryBreakdown ?? [];
  const filteredRecent = dash?.recentExpenses ?? [];
  const trendData = (dash?.monthly ?? []).map(m => ({ month: `${MONTHS[m.monthNum]} '${String(m.year).slice(2)}`, spend: m.spend }));

  // Reshape the category trend into recharts rows: one row per month with a
  // keyed value per selected category.
  const catTrendRows = (catTrend?.monthly ?? []).map(m => {
    const row: Record<string, string|number> = { month: `${MONTHS[m.monthNum]} '${String(m.year).slice(2)}` };
    (catTrend?.categories ?? []).forEach(c => { row[c.name] = m.totals[c.id] || 0; });
    return row;
  });

  if (budgetsLoading) return <Spinner />;

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Dashboard</h1>
      <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <FSel value={selBudgetId} onChange={setSelBudgetId}>
          <option value="">All budgets</option>
          {active.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </FSel>
        {!mobile && <Btn size="lg" onClick={()=>onAdd()}>+ Add expense</Btn>}
      </div>
    </div>

    {/* Threshold alerts */}
    {alertedTenders.length > 0 && (
      <div style={{ marginBottom:16, padding:"12px 16px", borderRadius:14, background:T.warnS, border:`1px solid ${T.warn}55` }}>
        <p style={{ fontSize:13, fontWeight:700, color:T.warn, marginBottom:6 }}>⚠️ Tender threshold alerts</p>
        {alertedTenders.map(ta => (
          <div key={`${ta.budgetName}-${ta.splitTenderId}`} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8, marginBottom:4, flexWrap:"wrap" }}>
            <span style={{ fontSize:12, color:T.warn, fontWeight:600 }}>· {ta.splitTenderName} <span style={{ fontWeight:500, color:T.warn, opacity:.8 }}>in {ta.budgetName}</span></span>
            <span style={{ fontSize:11, color:T.warn }}>{fmt(ta.spentAmount)} / {fmt(ta.allocatedAmount)} ({Math.round((ta.spentAmount/ta.allocatedAmount)*100)}%) — at {ta.threshold}%</span>
          </div>
        ))}
      </div>
    )}

    {/* Overview card */}
    <Card style={{ marginBottom:18, padding:"26px 28px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", right:-30, top:-30, width:180, height:180, borderRadius:"50%", background:toneC[h.tone], opacity:.06 }} />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:8 }}>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ fontSize:13, color:T.muted, display:"flex", alignItems:"center" }}>
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>{overBudget > 0 ? "Over budget" : "Budget left"}{selectedBudget ? ` · ${selectedBudget.name}` : " · all active"}</span>
            <KpiInfo text={overBudget > 0 ? "You've spent more than your total budget. This is how much you've exceeded your limit." : "How much money you can still spend across all your active budgets before hitting the limit."} />
          </div>
          {overBudget > 0 ? (
            <>
              <p style={{ fontWeight:800, fontSize:"clamp(24px,5vw,48px)", color:T.danger, lineHeight:1, marginTop:7 }}>₹0</p>
              <p style={{ fontSize:mobile?13:16, fontWeight:700, color:T.danger, marginTop:6 }}>+{fmt(overBudget)} over budget</p>
            </>
          ) : (
            <p style={{ fontWeight:800, fontSize:"clamp(24px,5vw,48px)", color:toneC[overviewTone], lineHeight:1, marginTop:7 }}>{fmt(left)}</p>
          )}
          <p style={{ fontSize:12, color:T.muted, marginTop:7 }}>
            {selectedBudget
              ? `of ${fmt(budAmt)} total · ${fmt(budSp)} spent`
              : `of ${fmt(totalBud)} across ${active.length} active budgets`}
          </p>
        </div>
        <ThresholdInfo alerts={overBudget > 0 ? [] : alertedTenders}>
          <Badge tone={overviewTone}>
            {overBudget > 0 ? "Over budget" : alertedTenders.length > 0 ? `⚠️ ${alertedTenders.length} threshold` : h.label}
          </Badge>
        </ThresholdInfo>
      </div>
      <div style={{ marginTop:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, fontWeight:600, color:T.muted, marginBottom:7 }}>
          <span style={{ display:"flex", alignItems:"center" }}>Spent {fmt(budSp)} · {Math.round(pct)}%<KpiInfo text="Total amount spent so far and the percentage of your total budget that has been used." /></span>
        </div>
        <Progress pct={pct} tone={overviewTone} h={11} />
      </div>
    </Card>

    {/* Selected budget tender breakdown */}
    {selectedBudget && selectedBudget.tenderAnalytics && selectedBudget.tenderAnalytics.length > 0 && (
      <Card style={{ marginBottom:18 }}>
        <div style={{ display:"flex", alignItems:"center", marginBottom:12 }}>
          <span style={{ fontWeight:700, fontSize:15, color:T.ink }}>Split tenders · {selectedBudget.name}</span>
          <KpiInfo text="Shows how your spending is split across different payment methods assigned to this budget." />
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {selectedBudget.tenderAnalytics.map(ta => {
            const tp    = ta.allocatedAmount ? (ta.spentAmount/ta.allocatedAmount)*100 : 0;
            const tRem  = Math.max(0, ta.allocatedAmount - ta.spentAmount);
            const tOver = Math.max(0, ta.spentAmount - ta.allocatedAmount);
            const al    = isTenderAlerted(ta);
            const tTone = tOver > 0 ? "danger" : al ? "warn" : health(tp).tone;
            return (
              <div key={ta.splitTenderId} style={{ borderRadius:12, background:toneS[tTone]||T.raised, padding:"10px 12px", border:`1px solid ${toneC[tTone]||T.line}33` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6, gap:6, flexWrap:"wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0, flex:1 }}>
                    <span style={{ fontSize:13, flexShrink:0 }}>{tOver > 0 ? "🔴" : al ? "⚠️" : "🗂️"}</span>
                    <span style={{ fontSize:13, fontWeight:700, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ta.splitTenderName}</span>
                    {tOver > 0 && <Badge tone="danger">Over budget</Badge>}
                    {tOver === 0 && al && <Badge tone="warn">Threshold</Badge>}
                  </div>
                  <span style={{ fontSize:12, color:T.muted, flexShrink:0 }}>{fmt(ta.spentAmount)} / {fmt(ta.allocatedAmount)}</span>
                </div>
                <Progress pct={tp} tone={tTone} h={6} />
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, alignItems:"center" }}>
                  <div>
                    <p style={{ fontSize:13, fontWeight:800, color:toneC[tTone] }}>
                      {tOver > 0 ? `+${fmt(tOver)} over` : `${fmt(tRem)} left`}
                    </p>
                    {tOver > 0 && <p style={{ fontSize:10, color:T.danger }}>₹0 remaining</p>}
                  </div>
                  <div style={{ textAlign:"right", fontSize:11, color:T.faint }}>
                    <p style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>{Math.round(tp)}% used{al && tOver === 0 ? " · threshold reached" : ""}<KpiInfo text="What percentage of this payment method's allocation has been spent." /></p>
                    {ta.threshold != null && <p style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>Alert at {ta.threshold}%<KpiInfo text="A warning triggers when spending on this payment method reaches this percentage of its allocation." /></p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    )}

    {/* Pie + Recent */}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:18, marginBottom:18 }}>
      {cats.length>0 && (
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
            <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"flex", alignItems:"center" }}>By category<KpiInfo text="How your spending across the selected budget(s) is divided between expense categories." /></span>
            <button onClick={()=>goTo("analytics")} style={{ fontSize:12, fontWeight:700, color:T.primary, background:"none", border:"none", cursor:"pointer" }}>Details →</button>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={cats.map(c=>({name:c.category?.name||"Other",value:c.total}))}
                cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                {cats.map((_c,i)=>(
                  <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v:unknown)=>fmt(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 14px", marginTop:10 }}>
            {cats.slice(0,8).map((c,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:5 }}>
                <div style={{ width:8, height:8, borderRadius:99, background:CHART_PALETTE[i%CHART_PALETTE.length], flexShrink:0 }} />
                <span style={{ fontSize:11, color:T.muted }}>{c.category?.name||"Other"}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
          <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"flex", alignItems:"center" }}>Recent expenses{selBudgetId ? " · filtered" : ""}<KpiInfo text="Your latest recorded transactions, sorted by most recent date." /></span>
          <button onClick={()=>goTo("expenses")} style={{ fontSize:12, fontWeight:700, color:T.primary, background:"none", border:"none", cursor:"pointer" }}>All →</button>
        </div>
        {filteredRecent.length === 0
          ? <p style={{ fontSize:13, color:T.muted, padding:"8px 0" }}>No recent expenses.</p>
          : filteredRecent.map(e=><div key={e.id} style={{ display:"flex", alignItems:"center", gap:11, padding:"9px 0", borderBottom:`1px solid ${T.line}` }}>
            <div style={{ width:36, height:36, borderRadius:11, background:(e.category?.color||T.muted)+"22", display:"grid", placeItems:"center", fontSize:18 }}>{e.category?.icon||"💡"}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <p style={{ fontSize:13, fontWeight:600, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.title}</p>
              <p style={{ fontSize:11, color:T.faint }}>{getSafeDate(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</p>
            </div>
            <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{fmt(Number(e.amount))}</span>
          </div>)
        }
      </Card>
    </div>

    {trendData.length>0 && <Card>
      <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"flex", alignItems:"center", marginBottom:14 }}>Monthly trend<KpiInfo text="How your spending has changed month by month over the past 6 months." /></span>
      <ResponsiveContainer width="100%" height={mobile?140:180}>
        <AreaChart data={trendData}>
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.primary} stopOpacity={.2}/><stop offset="95%" stopColor={T.primary} stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
          <XAxis dataKey="month" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false} />
          <YAxis tick={{fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} tickFormatter={fmtS} />
          <Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={{borderRadius:12,border:"none",fontSize:12}} />
          <Area type="monotone" dataKey="spend" name="Spent" stroke={T.primary} strokeWidth={2.5} fill="url(#g)" />
        </AreaChart>
      </ResponsiveContainer>
    </Card>}

    {/* Category spend by month — pick one or more categories to compare. */}
    <Card style={{ marginTop:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:14 }}>
        <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"flex", alignItems:"center" }}>Category spend by month<KpiInfo text="Monthly spend for each category you select, so you can compare how categories trend over time." /></span>
      </div>
      {categories.length === 0 ? (
        <p style={{ fontSize:13, color:T.muted, padding:"8px 0" }}>Add categories to compare their monthly spend.</p>
      ) : (
        <>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
            {categories.map(c => {
              const on = selCats.includes(c.id);
              // Match each selected chip to its line colour (same palette + order).
              const idx = (catTrend?.categories ?? []).findIndex(t => t.id === c.id);
              const col = on && idx >= 0 ? TREND_COLORS[idx % TREND_COLORS.length] : (c.color || T.primary);
              return (
                <button key={c.id} onClick={()=>toggleCat(c.id)}
                  style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 12px", borderRadius:20, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600,
                           border:`1.5px solid ${on?col:T.line}`, background:on?col+"22":"transparent", color:on?col:T.muted }}>
                  <span>{c.icon||"📁"}</span>{c.name}
                </button>
              );
            })}
          </div>
          {selCats.length === 0 ? (
            <p style={{ fontSize:13, color:T.muted, padding:"8px 0" }}>Select one or more categories above to see their monthly trend.</p>
          ) : catTrendRows.length === 0 ? (
            <p style={{ fontSize:13, color:T.muted, padding:"8px 0" }}>No spending recorded for the selected categories.</p>
          ) : (
            <ResponsiveContainer width="100%" height={mobile?180:240}>
              <LineChart data={catTrendRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                <XAxis dataKey="month" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false} />
                <YAxis tick={{fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} tickFormatter={fmtS} />
                <Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={{borderRadius:12,border:"none",fontSize:12}} />
                <Legend wrapperStyle={{fontSize:12}} />
                {(catTrend?.categories ?? []).map((c,i) => {
                  const col = TREND_COLORS[i % TREND_COLORS.length];
                  return <Line key={c.id} type="monotone" dataKey={c.name} stroke={col} strokeWidth={3} dot={{r:3,fill:col}} activeDot={{r:5}} />;
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </Card>
  </div>;
}

// Small square checkbox used to pick expenses for analysis.
function Check({ on, onClick }: { on:boolean; onClick:()=>void }) {
  return (
    <button onClick={e=>{ e.stopPropagation(); onClick(); }}
      style={{ width:22, height:22, borderRadius:7, flexShrink:0, cursor:"pointer",
               border:`1.5px solid ${on?T.primary:T.faint}`, background:on?T.primary:"transparent",
               color:"#fff", display:"grid", placeItems:"center", fontSize:12, fontFamily:"inherit", padding:0 }}>
      {on ? "✓" : ""}
    </button>
  );
}

// ── EXPENSE ANALYSIS MODAL ────────────────────────────────────────────────
// On-screen analytics over a hand-picked set of expenses. The figures are
// computed server-side (POST /analytics/analyze-expenses) so they're exact —
// full amounts and complete relations, not whatever the client happens to hold.
function ExpenseAnalysisModal({ open, onClose, ids }: { open:boolean; onClose:()=>void; ids:string[] }) {
  const [data, setData] = useState<ExpenseAnalysis|null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setData(null); setErr(""); setLoading(true);
    analyticsApi.analyzeExpenses(ids)
      .then(r => setData(r.data))
      .catch(e => setErr(e instanceof Error ? e.message : "Failed to analyze"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const Stat = ({ label, value, sub, tone=T.ink }: { label:string; value:string; sub?:string; tone?:string }) => (
    <div style={{ background:T.cream, border:`1px solid ${T.line}`, borderRadius:12, padding:"12px 14px", flex:"1 1 120px", minWidth:120 }}>
      <p style={{ fontSize:10, color:T.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:".04em" }}>{label}</p>
      <p style={{ fontSize:19, fontWeight:800, color:tone, lineHeight:1.15, marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{value}</p>
      {sub && <p style={{ fontSize:10, color:T.faint, marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sub}</p>}
    </div>
  );

  const Breakdown = ({ title, rows, total }: { title:string; rows:AnalysisGroup[]; total:number }) => rows.length===0 ? null : (
    <div style={{ marginTop:18 }}>
      <p style={{ fontSize:12, fontWeight:700, color:T.ink, marginBottom:10 }}>{title}</p>
      <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
        {rows.slice(0,6).map((r,i)=>{
          const pct = total>0 ? (r.total/total)*100 : 0;
          return (
            <div key={i}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8, marginBottom:4 }}>
                <span style={{ fontSize:12, color:T.ink, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.icon} {r.name} <span style={{ color:T.faint, fontWeight:500 }}>· {r.count}</span></span>
                <span style={{ fontSize:12, fontWeight:700, color:T.ink, flexShrink:0 }}>{fmt(r.total)} <span style={{ color:T.faint, fontWeight:500 }}>{Math.round(pct)}%</span></span>
              </div>
              <div style={{ height:6, borderRadius:99, background:T.line, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${Math.min(100,pct)}%`, background:r.color, borderRadius:99 }} />
              </div>
            </div>
          );
        })}
        {rows.length>6 && <p style={{ fontSize:11, color:T.faint }}>+ {rows.length-6} more</p>}
      </div>
    </div>
  );

  const dateLabel = (k:string|null) => k ? getSafeDate(k).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"}) : "—";

  return (
    <Modal open={open} onClose={onClose} title={`Analysis · ${ids.length} expense${ids.length===1?"":"s"}`}
      footer={<Btn onClick={onClose} full>Done</Btn>}>
      {loading ? <Spinner />
        : err ? <ErrMsg msg={err} />
        : !data || data.count === 0 ? <p style={{ fontSize:13, color:T.muted, padding:8 }}>Nothing to analyze.</p>
        : (
        <div>
          {/* Headline */}
          <div style={{ background:T.primary+"12", border:`1px solid ${T.primary}33`, borderRadius:14, padding:"16px 18px", marginBottom:14 }}>
            <p style={{ fontSize:11, color:T.primary, fontWeight:700, textTransform:"uppercase", letterSpacing:".05em" }}>Total selected</p>
            <p style={{ fontSize:32, fontWeight:800, color:T.primary, lineHeight:1.1, marginTop:4 }}>{fmt(data.total)}</p>
            <p style={{ fontSize:12, color:T.muted, marginTop:4 }}>{data.count} transaction{data.count===1?"":"s"} · avg {fmt(data.avg)} each</p>
          </div>

          {/* Core stats */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
            <Stat label="Largest" value={fmt(data.max)} sub={data.maxExpense?.title} tone={T.danger} />
            <Stat label="Smallest" value={fmt(data.min)} />
            <Stat label="Average" value={fmt(data.avg)} sub="per transaction" />
            <Stat label="Per day" value={fmt(data.perDay)} sub={data.spanDays>0?`over ${data.spanDays} day${data.spanDays===1?"":"s"}`:undefined} />
            <Stat label="Date range" value={dateLabel(data.first)} sub={`→ ${dateLabel(data.last)}`} />
            <Stat label="Active days" value={String(data.activeDays)} sub={data.spanDays>0?`of ${data.spanDays} in range`:undefined} />
          </div>

          {/* Composition */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginTop:10 }}>
            <Stat label="Fixed" value={fmt(data.fixedTotal)} sub={`${data.total>0?Math.round(data.fixedTotal/data.total*100):0}% of total`} />
            <Stat label="Variable" value={fmt(data.variableTotal)} sub={`${data.total>0?Math.round(data.variableTotal/data.total*100):0}% of total`} />
            {data.reimbursableTotal>0 && <Stat label="Reimbursable" value={fmt(data.reimbursableTotal)} sub={`${data.reimbursableCount} expense${data.reimbursableCount===1?"":"s"}`} tone={T.sage} />}
            {data.unbudgetedTotal>0 && <Stat label="Unbudgeted" value={fmt(data.unbudgetedTotal)} sub={`${data.total>0?Math.round(data.unbudgetedTotal/data.total*100):0}% of total`} tone={T.warn} />}
          </div>

          <Breakdown title="By category" rows={data.byCategory} total={data.total} />
          <Breakdown title="By payment source" rows={data.bySource} total={data.total} />
          {data.byBudget.length>1 && <Breakdown title="By budget" rows={data.byBudget} total={data.total} />}
        </div>
      )}
    </Modal>
  );
}

// ── EXPENSES SCREEN ───────────────────────────────────────────────────────
type ExpFilters = { categoryId:string; budgetId:string; sourceId:string; startDate:string; endDate:string; sortBy:"date"|"amount"; order:"asc"|"desc" };
const defaultExpFilters: ExpFilters = { categoryId:"", budgetId:"", sourceId:"", startDate:"", endDate:"", sortBy:"date", order:"desc" };
type NavFilters = { categoryId?:string; sourceId?:string; budgetIds?:string[]; startDate?:string; endDate?:string; dayOfWeek?:number; label?:string; costType?:"fixed"|"variable"; unbudgeted?:boolean; spikeDates?:string[] };

function ExpensesScreen({ onOpenExpense, navFilters, onNavFiltersConsumed }: {
  onOpenExpense:(e?:Expense)=>void;
  navFilters?:NavFilters;
  onNavFiltersConsumed?:()=>void;
}) {
  const mobile = useMobile();
  const { expenses, expensesLoading, expensesTotal, expensesHasMore, expensesLoadingMore, loadMoreExpenses,
          enableExpenses, enableCategories, enableSources,
          deleteExpense, categories, budgets, sources, setExpenseFilters } = useData();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<ExpFilters>(defaultExpFilters);
  const [localExp, setLocalExp] = useState<Expense[]|null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [activeDowFilter, setActiveDowFilter] = useState<number|null>(null);
  const [navLabel, setNavLabel] = useState("");
  const [navCostType, setNavCostType]     = useState<"fixed"|"variable"|null>(null);
  const [navUnbudgeted, setNavUnbudgeted] = useState(false);
  const [navSpikeDates, setNavSpikeDates] = useState<Set<string>|null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAnalysis, setShowAnalysis] = useState(false);
  const toggleSel = (id:string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const activeBudgets = budgets.filter(b => b.status === "active");

  // Reset filters on mount; if arriving via drill-through, apply navFilters
  useEffect(() => {
    enableExpenses(); enableCategories(); enableSources(); // activate lazy data this screen needs
    if (navFilters) {
      const singleBudget = navFilters.budgetIds?.length === 1 ? navFilters.budgetIds[0] : "";
      const f: ExpFilters = {
        ...defaultExpFilters,
        categoryId: navFilters.categoryId || "",
        sourceId:   navFilters.sourceId   || "",
        budgetId:   singleBudget,
        startDate:  navFilters.startDate  || "",
        endDate:    navFilters.endDate    || "",
      };
      setFilters(f);
      setQ("");
      if (navFilters.label) setNavLabel(navFilters.label);
      if (navFilters.dayOfWeek !== undefined) setActiveDowFilter(navFilters.dayOfWeek);
      if (navFilters.costType) setNavCostType(navFilters.costType);
      if (navFilters.unbudgeted) setNavUnbudgeted(true);
      if (navFilters.spikeDates?.length) setNavSpikeDates(new Set(navFilters.spikeDates));
      onNavFiltersConsumed?.();

      const apiFilters = {
        sortBy:"date" as const, order:"desc" as const,
        categoryId: navFilters.categoryId || undefined,
        sourceId:   navFilters.sourceId   || undefined,
        startDate:  navFilters.startDate  || undefined,
        endDate:    navFilters.endDate    || undefined,
      };

      if (navFilters.budgetIds && navFilters.budgetIds.length > 1) {
        // Multi-budget: fetch all pages per budget, then merge
        setLocalLoading(true);
        Promise.all(navFilters.budgetIds.map(id =>
          fetchAllExpenses({ ...apiFilters, budgetId:id })
        )).then(arrs => {
          const merged = arrs.flat().sort((a,b) => getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime());
          setLocalExp(merged);
        }).catch(console.error)
          .finally(() => setLocalLoading(false));
      } else {
        // Single budget or none: let DataContext handle it (with infinite scroll)
        setExpenseFilters({ ...apiFilters, budgetId: singleBudget || undefined, limit:50 });
        setLocalExp(null);
      }
    } else {
      setFilters(defaultExpFilters);
      setQ("");
      setNavLabel("");
      setActiveDowFilter(null);
      setNavCostType(null);
      setNavUnbudgeted(false);
      setNavSpikeDates(null);
      setLocalExp(null);
      setExpenseFilters({ limit:50, sortBy:"date", order:"desc" as const });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync filter state → DataContext
  useEffect(() => {
    setExpenseFilters(f => ({
      ...f,
      categoryId: filters.categoryId  || undefined,
      budgetId:   filters.budgetId    || undefined,
      sourceId:   filters.sourceId    || undefined,
      startDate:  filters.startDate   || undefined,
      endDate:    filters.endDate     || undefined,
      sortBy:     filters.sortBy,
      order:      filters.order,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const hasFilter = !!(filters.categoryId || filters.budgetId || filters.sourceId || filters.startDate || filters.endDate || q || activeDowFilter !== null || navCostType || navUnbudgeted || navSpikeDates);
  // Use locally fetched set (multi-budget drill) or DataContext
  const baseExp = localExp ?? expenses;
  // Client-side post-filters applied in sequence
  const dowExp      = activeDowFilter !== null ? baseExp.filter(e => getSafeDate(e.date).getDay() === activeDowFilter) : baseExp;
  const costExp     = navCostType ? dowExp.filter(e => navCostType === "fixed" ? e.costType === "fixed" : e.costType !== "fixed") : dowExp;
  const unbudgExp   = navUnbudgeted ? costExp.filter(e => !e.budgetId) : costExp;
  const spikeExp    = navSpikeDates ? unbudgExp.filter(e => navSpikeDates!.has(e.date.slice(0,10))) : unbudgExp;
  const filtered    = spikeExp.filter(e => !q || e.title.toLowerCase().includes(q.toLowerCase()));
  const groups = filtered.reduce((m:Record<string,typeof expenses>, e)=>{
    const d = e.date.slice(0,10); if (!m[d]) m[d]=[]; m[d].push(e); return m;
  }, {});

  // Multi-select analytics — operates on the currently filtered set.
  const selectedExpenses = filtered.filter(e => selected.has(e.id));
  const selSum = selectedExpenses.reduce((s,e)=>s+Number(e.amount),0);
  const allSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id));
  const toggleAll = () => setSelected(prev => {
    const n = new Set(prev);
    if (allSelected) filtered.forEach(e => n.delete(e.id));
    else filtered.forEach(e => n.add(e.id));
    return n;
  });

  // Infinite scroll — only for the DataContext-driven list (not multi-budget
  // drill-throughs, which fetch their full set up front).
  const usingLocal  = localExp !== null;
  const canPaginate = !usingLocal && expensesHasMore;
  const sentinelRef = useRef<HTMLDivElement|null>(null);
  useEffect(() => {
    if (!canPaginate) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) loadMoreExpenses();
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [canPaginate, loadMoreExpenses]);

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <div>
        <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Expenses</h1>
        <p style={{ fontSize:13, color:T.muted, marginTop:5 }}>{filtered.length} transactions</p>
      </div>
      {!mobile && <Btn size="lg" onClick={()=>onOpenExpense()}>+ Add expense</Btn>}
    </div>

    {navLabel && (
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:12, background:T.primary+"18", border:`1px solid ${T.primary}44`, marginBottom:14, flexWrap:"wrap" }}>
        <span style={{ fontSize:13 }}>📊</span>
        <span style={{ fontSize:13, fontWeight:600, color:T.primary, flex:1 }}>From Analytics: {navLabel}</span>
        <button onClick={()=>{ setNavLabel(""); setActiveDowFilter(null); setNavCostType(null); setNavUnbudgeted(false); setNavSpikeDates(null); setLocalExp(null); setFilters(f=>({...defaultExpFilters,sortBy:f.sortBy,order:f.order})); setQ(""); setExpenseFilters({ limit:50, sortBy:"date", order:"desc" as const }); }}
          style={{ fontSize:12, color:T.primary, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", padding:0, fontWeight:600 }}>✕ Clear</button>
      </div>
    )}

    <Card style={{ marginBottom:18 }}>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:T.faint }}>🔍</span>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search expenses…"
            style={{ width:"100%", padding:"10px 13px 10px 36px", borderRadius:13, border:`1px solid ${T.line}`, background:T.cream, color:T.ink, fontSize:14, outline:"none", fontFamily:"inherit" }} />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr":"1fr 1fr", gap:8 }}>
          <FSel value={filters.categoryId} onChange={v=>setFilters(f=>({...f,categoryId:v}))}>
            <option value="">All categories</option>
            {categories.map(c=><option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </FSel>
          <FSel value={filters.budgetId} onChange={v=>setFilters(f=>({...f,budgetId:v}))}>
            <option value="">Active budgets</option>
            {activeBudgets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </FSel>
          <FSel value={filters.sourceId} onChange={v=>setFilters(f=>({...f,sourceId:v}))}>
            <option value="">All sources</option>
            {sources.map(s=><option key={s.id} value={s.id}>{s.icon||"💳"} {s.name}</option>)}
          </FSel>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            <input type="date" value={filters.startDate} onChange={e=>setFilters(f=>({...f,startDate:e.target.value}))}
              placeholder="From"
              style={{ padding:"9px 10px", borderRadius:11, border:`1px solid ${T.line}`, background:T.cream, color:filters.startDate?T.ink:T.faint, fontSize:12, outline:"none", fontFamily:"inherit", width:"100%" }} />
            <input type="date" value={filters.endDate} onChange={e=>setFilters(f=>({...f,endDate:e.target.value}))}
              placeholder="To"
              style={{ padding:"9px 10px", borderRadius:11, border:`1px solid ${T.line}`, background:T.cream, color:filters.endDate?T.ink:T.faint, fontSize:12, outline:"none", fontFamily:"inherit", width:"100%" }} />
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:T.muted, fontWeight:600 }}>Sort by:</span>
          {(["date","amount"] as const).map(s=>(
            <button key={s} onClick={()=>setFilters(f=>({...f,sortBy:s}))}
              style={{ padding:"5px 12px", borderRadius:20, border:`1.5px solid ${filters.sortBy===s?T.primary:T.line}`, background:filters.sortBy===s?T.primary+"22":"transparent", color:filters.sortBy===s?T.primary:T.muted, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
              {s==="date"?"📅 Date":"💰 Amount"}
            </button>
          ))}
          <button onClick={()=>setFilters(f=>({...f,order:f.order==="desc"?"asc":"desc"}))}
            style={{ marginLeft:"auto", padding:"5px 12px", borderRadius:20, border:`1.5px solid ${T.line}`, background:"transparent", color:T.muted, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
            {filters.order==="desc"?"↓":"↑"} {filters.sortBy==="date"?(filters.order==="desc"?"Newest first":"Oldest first"):(filters.order==="desc"?"Highest first":"Lowest first")}
          </button>
        </div>
        {hasFilter && (
          <button onClick={()=>{ setFilters(f=>({...defaultExpFilters,sortBy:f.sortBy,order:f.order})); setQ(""); setActiveDowFilter(null); setNavCostType(null); setNavUnbudgeted(false); setNavSpikeDates(null); setLocalExp(null); setNavLabel(""); setExpenseFilters({ limit:50, sortBy:"date", order:"desc" as const }); }}
            style={{ fontSize:12, color:T.primary, background:"none", border:"none", cursor:"pointer", textAlign:"left", fontFamily:"inherit", padding:0 }}>
            ✕ Clear all filters
          </button>
        )}
      </div>
    </Card>

    {/* Selection / analysis bar — tick expenses below, then analyze the slice. */}
    {!(expensesLoading || localLoading) && filtered.length > 0 && (
      <div style={{ position:"sticky", top:8, zIndex:20, display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:13, marginBottom:12, flexWrap:"wrap",
                    background: selectedExpenses.length ? T.primary+"14" : T.paper, border:`1px solid ${selectedExpenses.length ? T.primary+"66" : T.line}` }}>
        <Check on={allSelected} onClick={toggleAll} />
        <span style={{ fontSize:13, fontWeight:600, color:T.ink }}>
          {selectedExpenses.length > 0
            ? <>{selectedExpenses.length} selected · <span style={{ color:T.primary, fontWeight:800 }}>{fmt(selSum)}</span></>
            : "Select expenses to analyze"}
        </span>
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
          {selectedExpenses.length > 0 && (
            <button onClick={()=>setSelected(new Set())}
              style={{ fontSize:12, fontWeight:600, color:T.muted, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>Clear</button>
          )}
          <Btn size="sm" onClick={()=>setShowAnalysis(true)} disabled={selectedExpenses.length===0}>📊 Analyze{selectedExpenses.length>0?` (${selectedExpenses.length})`:""}</Btn>
        </div>
      </div>
    )}

    {(expensesLoading || localLoading) ? <Spinner /> : (
      <Card>
        {filtered.length === 0 && <p style={{ fontSize:13, color:T.muted, padding:8 }}>No expenses found.</p>}
        {filters.sortBy === "amount" ? (
          // Flat list sorted by amount
          [...filtered].sort((a,b)=>filters.order==="asc"?Number(a.amount)-Number(b.amount):Number(b.amount)-Number(a.amount)).map(e=>(
            <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:`1px solid ${T.line}`, background: selected.has(e.id) ? T.primary+"0D" : undefined }}>
              <Check on={selected.has(e.id)} onClick={()=>toggleSel(e.id)} />
              <div style={{ width:42, height:42, borderRadius:13, background:(e.category?.color||T.muted)+"22", display:"grid", placeItems:"center", fontSize:20, flexShrink:0 }}>{e.category?.icon||"💡"}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:14, fontWeight:600, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.title}</p>
                <p style={{ fontSize:11, color:T.muted }}>{e.category?.name}{e.source?` · ${e.source.icon||""} ${e.source.name}`:""}</p>
              </div>
              <div style={{ textAlign:"right" }}>
                <p style={{ fontWeight:700, color:T.ink }}>{fmt(Number(e.amount))}</p>
                <p style={{ fontSize:11, color:T.faint }}>{getSafeDate(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</p>
              </div>
              <IconBtn icon="✏️" onClick={()=>onOpenExpense(e)} tone="primary" />
              <IconBtn icon="🗑️" onClick={()=>deleteExpense(e.id)} tone="danger" />
            </div>
          ))
        ) : (
          // Grouped by date
          Object.entries(groups).sort((a,b)=>filters.order==="asc"?a[0].localeCompare(b[0]):b[0].localeCompare(a[0])).map(([date,items])=>(
            <div key={date} style={{ marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:7 }}>
                <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em" }}>
                  {getSafeDate(date).toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"short"})}
                </span>
                <span style={{ fontSize:11, fontWeight:700, color:T.faint }}>{fmt(items.reduce((s,e)=>s+Number(e.amount),0))}</span>
              </div>
              {items.map(e=>(
                <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:`1px solid ${T.line}`, background: selected.has(e.id) ? T.primary+"0D" : undefined }}>
                  <Check on={selected.has(e.id)} onClick={()=>toggleSel(e.id)} />
                  <div style={{ width:42, height:42, borderRadius:13, background:(e.category?.color||T.muted)+"22", display:"grid", placeItems:"center", fontSize:20, flexShrink:0 }}>{e.category?.icon||"💡"}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:14, fontWeight:600, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.title}</p>
                    <p style={{ fontSize:11, color:T.muted }}>{e.category?.name}{e.source?` · ${e.source.icon||""} ${e.source.name}`:""}</p>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <p style={{ fontWeight:700, color:T.ink }}>{fmt(Number(e.amount))}</p>
                    <p style={{ fontSize:11, color:T.faint }}>{getSafeDate(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</p>
                  </div>
                  <IconBtn icon="✏️" onClick={()=>onOpenExpense(e)} tone="primary" />
                  <IconBtn icon="🗑️" onClick={()=>deleteExpense(e.id)} tone="danger" />
                </div>
              ))}
            </div>
          ))
        )}
        {/* Infinite-scroll sentinel + status footer */}
        {!usingLocal && filtered.length > 0 && (
          <div ref={sentinelRef} style={{ padding:"14px 0 4px", textAlign:"center" }}>
            {expensesLoadingMore
              ? <span style={{ fontSize:12, color:T.muted }}>Loading more…</span>
              : expensesHasMore
                ? <span style={{ fontSize:12, color:T.faint }}>Scroll for more</span>
                : <span style={{ fontSize:12, color:T.faint }}>All {expensesTotal} loaded</span>}
          </div>
        )}
      </Card>
    )}

    <ExpenseAnalysisModal open={showAnalysis} onClose={()=>setShowAnalysis(false)} ids={selectedExpenses.map(e=>e.id)} />
  </div>;
}

// ── EXPENSE FORM MODAL (add + edit) ───────────────────────────────────────
function ExpenseFormModal({ open, onClose, expense }: { open:boolean; onClose:()=>void; expense?:Expense }) {
  const { categories, budgets, sources, splitTenders, createExpense, updateExpense,
          enableCategories, enableSources, enableSplitTenders } = useData();
  const mobile = useMobile();
  const isEdit = !!expense;
  const blank = { title:"", amount:"", date:todayStr(), categoryId:"", budgetId:"", sourceId:"", notes:"", costType:"variable" as "fixed"|"variable", reimbursable:false };
  const [f, sf] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const activeBudgets = budgets.filter(b => b.status === "active");
  const selectedSource = sources.find(s => s.id === f.sourceId);
  const selectedBudget = budgets.find(b => b.id === f.budgetId);

  let tenderWarning = "";
  if (f.budgetId && f.sourceId && selectedSource?.splitTenderId && selectedBudget?.tenderAnalytics) {
    const linked = selectedBudget.tenderAnalytics.some(ta => ta.splitTenderId === selectedSource.splitTenderId);
    if (!linked) {
      const tenderName = splitTenders.find(t => t.id === selectedSource.splitTenderId)?.name || "unknown tender";
      tenderWarning = `Mismatch: "${selectedSource.name}" belongs to tender "${tenderName}" which is not linked to budget "${selectedBudget.name}". Saving will fail.`;
    }
  }

  useEffect(()=>{
    if (open) {
      enableCategories(); enableSources(); enableSplitTenders(); // load dropdown data on first open
      sf(expense ? {
        title:      expense.title,
        amount:     String(Number(expense.amount)),
        date:       toDateStr(expense.date),
        categoryId: expense.categoryId || "",
        budgetId:   expense.budgetId   || "",
        sourceId:   expense.sourceId   || "",
        notes:      expense.notes      || "",
        costType:   (expense.costType || "variable") as "fixed"|"variable",
        reimbursable: !!expense.reimbursable,
      } : blank);
      setErr("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id]);

  const save = async () => {
    if (!f.title || !f.amount) return;
    try {
      setSaving(true); setErr("");
      const expAmt = Number(f.amount);
      const payload = {
        title:f.title, amount:expAmt, date:f.date,
        notes:f.notes||undefined,
        categoryId:f.categoryId||undefined,
        budgetId:  f.budgetId  ||undefined,
        sourceId:  f.sourceId  ||undefined,
        tags: expense?.tags || [],
        costType: f.costType,
        reimbursable: f.reimbursable,
      };
      if (isEdit) await updateExpense(expense!.id, payload);
      else         await createExpense(payload);
      onClose();
    } catch(e:unknown) { setErr(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit Expense" : "Add Expense"}
      footer={<div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {err && <ErrMsg msg={err} />}
        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" onClick={onClose} full>Cancel</Btn>
          <Btn onClick={save} full disabled={saving||!f.title||!f.amount}>{saving?"Saving…":isEdit?"Save changes":"Add expense"}</Btn>
        </div>
      </div>}>
      <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
        <Inp label="What did you spend on?" value={f.title} onChange={e=>sf(p=>({...p,title:e.target.value}))} placeholder="e.g. Zomato order" />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
          <Inp label="Amount (₹)" type="number" value={f.amount} onChange={e=>sf(p=>({...p,amount:e.target.value}))} placeholder="0" />
          <Inp label="Date" type="date" value={f.date} onChange={e=>sf(p=>({...p,date:e.target.value}))} />
        </div>
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", display:"block", marginBottom:8 }}>Category</span>
          <div style={{ display:"grid", gridTemplateColumns:`repeat(${mobile?3:4},1fr)`, gap:7 }}>
            {categories.map(c=>{ const a=f.categoryId===c.id; return (
              <button key={c.id} onClick={()=>sf(p=>({...p,categoryId:c.id}))}
                style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"9px 5px", borderRadius:13,
                         border:a?`1.5px solid ${c.color||T.primary}`:`1.5px solid ${T.line}`,
                         background:a?(c.color||T.primary)+"18":T.raised, cursor:"pointer", fontFamily:"inherit" }}>
                <span style={{ fontSize:20 }}>{c.icon||"📁"}</span>
                <span style={{ fontSize:10, fontWeight:600, color:a?c.color||T.primary:T.muted, textAlign:"center", lineHeight:1.3, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden", wordBreak:"break-word" }}>{c.name}</span>
              </button>
            ); })}
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns: mobile?"1fr":"1fr 1fr", gap:11 }}>
          <Sel label="Budget" value={f.budgetId} onChange={e=>sf(p=>({...p,budgetId:e.target.value}))}>
            <option value="">No budget</option>
            {activeBudgets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </Sel>
          <Sel label="Paid with" value={f.sourceId} onChange={e=>sf(p=>({...p,sourceId:e.target.value}))}>
            <option value="">Select source</option>
            {sources.map(s=><option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </Sel>
        </div>

        {tenderWarning && <ErrMsg msg={tenderWarning} />}

        {/* Reimbursable toggle — flags a spend you expect back (e.g. fuel charged to a card, claimed later). */}
        <button onClick={()=>sf(p=>({...p,reimbursable:!p.reimbursable}))}
          style={{ display:"flex", alignItems:"center", gap:11, padding:"11px 14px", borderRadius:12, cursor:"pointer", fontFamily:"inherit", textAlign:"left", width:"100%",
                   border:`1.5px solid ${f.reimbursable?T.sage:T.line}`, background:f.reimbursable?T.sageS:T.cream }}>
          <span style={{ width:20, height:20, borderRadius:6, display:"grid", placeItems:"center", flexShrink:0, fontSize:13,
                         background:f.reimbursable?T.sage:"transparent", border:`1.5px solid ${f.reimbursable?T.sage:T.faint}`, color:"#fff" }}>{f.reimbursable?"✓":""}</span>
          <span style={{ minWidth:0 }}>
            <span style={{ display:"block", fontSize:13, fontWeight:700, color:f.reimbursable?T.sage:T.ink }}>🔄 Reimbursable spend</span>
            <span style={{ display:"block", fontSize:10, color:T.muted, marginTop:2 }}>I expect this money back (e.g. fuel I'll claim). Record the payback under Reimbursements.</span>
          </span>
        </button>

        {/* Cost type toggle */}
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", display:"block", marginBottom:8 }}>Cost type</span>
          <div style={{ display:"flex", gap:8 }}>
            {(["variable","fixed"] as const).map(ct=>(
              <button key={ct} onClick={()=>sf(p=>({...p,costType:ct}))}
                style={{ flex:1, padding:"9px 0", borderRadius:11, border:`1.5px solid ${f.costType===ct?T.primary:T.line}`,
                         background:f.costType===ct?T.primaryS:T.cream, color:f.costType===ct?T.primary:T.muted,
                         fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit", textTransform:"capitalize" }}>
                {ct==="variable"?"📊 Variable":"📌 Fixed"}
              </button>
            ))}
          </div>
          <p style={{ fontSize:10, color:T.faint, marginTop:5 }}>Fixed: rent, subscriptions, EMI. Variable: everything else.</p>
        </div>

        <Inp label="Notes (optional)" value={f.notes} onChange={e=>sf(p=>({...p,notes:e.target.value}))} placeholder="Add a note" />
      </div>
    </Modal>
  );
}

// ── BUDGETS SCREEN ────────────────────────────────────────────────────────
type BudgetTenderRow = { splitTenderId: string; allocatedAmount: string; threshold: string };
type BudgetForm = { name:string; description:string; startDate:string; endDate:string; color:string; status:string; tenders:BudgetTenderRow[] };
const BCOLORS = ["#C2623F","#E8A838","#2E9E6B","#9B6DBF","#5B8FD4","#3BAF7E"];
const blankBudget: BudgetForm = { name:"", description:"", startDate:"", endDate:"", color:"#C2623F", status:"active", tenders:[] };

// A single budget rendered as a collapsible card: the header + headline progress
// are always visible; clicking the card reveals the full detail (burn metrics,
// spending guidance, at-risk tenders, allocation status).
function BudgetCard({ b, onEdit, onDelete }: { b: Budget; onEdit: () => void; onDelete: () => void }) {
  const mobile = useMobile();
  const [open, setOpen] = useState(false);

  const amt  = Number(b.amount || 0);
  const used = Number(b.usedAmount || 0);
  const rem  = Math.max(0, amt - used);
  const over = Math.max(0, used - amt);
  const p    = amt ? (used / amt) * 100 : 0;
  const hh   = health(p);

  const budgetAlerts = (b.tenderAnalytics || []).filter(isTenderAlerted);
  const rowTone     = over > 0 ? "danger" : budgetAlerts.length > 0 ? "warn" : hh.tone;
  // Burn metrics + spending guidance are computed on the backend over all expenses
  const burnMetrics = b.metrics ? burnMetricTiles(b.metrics) : [];
  const guide       = b.guidance ?? EMPTY_GUIDANCE;
  const showGuide   = guide.remainDays > 0 && (p >= 60 || guide.projectedOver > 0 || over > 0);

  const GuideTile  = ({ bg=T.paper, border=`1px solid ${T.line}`, label, labelColor=T.muted, value, valueColor=T.ink, sub, tip }: { bg?:string; border?:string; label:string; labelColor?:string; value:string; valueColor?:string; sub:string; tip:string }) => (
    <div style={{ background:bg, borderRadius:10, padding:mobile?"10px 12px":"12px 14px", border, minWidth: 140, flex: "1 1 auto" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:3, marginBottom:4 }}>
        <p style={{ fontSize:10, color:labelColor, fontWeight:700, textTransform:"uppercase", letterSpacing:".03em", lineHeight:1.3, flex:1 }}>{label}</p>
        <InfoTip text={tip} />
      </div>
      <p style={{ fontSize:mobile?15:18, fontWeight:800, color:valueColor, lineHeight:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{value}</p>
      <p style={{ fontSize:10, color:T.faint, marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sub}</p>
    </div>
  );

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <Card style={{ marginBottom: 0, padding: mobile ? "16px" : "24px 28px", width: "100%" }}>
      {/* Header Row — click anywhere to expand/collapse detail */}
      <div onClick={() => setOpen(o => !o)} style={{ cursor: "pointer", display: "flex", flexDirection: mobile ? "column" : "row", gap: 16, justifyContent: "space-between", alignItems: mobile ? "flex-start" : "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: T.faint, flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
          <div style={{ width: 6, height: 44, borderRadius: 99, background: b.color || T.primary, flexShrink: 0 }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <p style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>{b.name}</p>
              {b.status !== "active" && <Badge tone={b.status === "completed" ? "sage" : "sky"}>{b.status}</Badge>}
            </div>
            <p style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
              {toDateStr(b.startDate)} → {toDateStr(b.endDate)}
              <span style={{ color: T.faint }}> · {daysInclusive(toDateStr(b.startDate), toDateStr(b.endDate))} days</span>
              {b.description && <span style={{ color: T.faint }}> · {b.description}</span>}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", width: mobile ? "100%" : "auto", justifyContent: mobile ? "space-between" : "flex-end" }}>
          <ThresholdInfo alerts={over > 0 ? [] : budgetAlerts}>
            <Badge tone={rowTone}>
              {over > 0 ? "Over budget" : budgetAlerts.length > 0 ? `⚠️ ${budgetAlerts.length} threshold alert${budgetAlerts.length > 1 ? 's' : ''}` : hh.label}
            </Badge>
          </ThresholdInfo>
          <div style={{ display: "flex", gap: 6 }} onClick={stop}>
            <IconBtn icon="✏️" onClick={onEdit} tone="primary" />
            <IconBtn icon="🗑️" onClick={onDelete} tone="danger" />
          </div>
        </div>
      </div>

      {/* Progress Bar Row — always visible summary */}
      <div onClick={() => setOpen(o => !o)} style={{ cursor: "pointer", marginBottom: open ? 20 : 0, padding: "14px 18px", borderRadius: 14, background: toneS[rowTone], border: `1px solid ${toneC[rowTone]}44` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
          <div>
            <p style={{ fontSize: 11, color: toneC[rowTone], fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
              {over > 0 ? "Over budget" : "Remaining"}
            </p>
            <p style={{ fontSize: mobile ? 22 : 28, fontWeight: 800, color: toneC[rowTone], lineHeight: 1.1 }}>
              {over > 0 ? fmt(over) : fmt(rem)}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{fmt(used)} spent</p>
            <p style={{ fontSize: 12, color: T.muted }}>of {fmt(amt)} · {Math.round(p)}% used</p>
          </div>
        </div>
        <Progress pct={p} tone={rowTone} h={8} />
        {!open && (
          <p style={{ fontSize: 11, color: toneC[rowTone], fontWeight: 600, marginTop: 8, textAlign: "center", opacity: .8 }}>
            Tap to see burn rate, spending limits & tenders ▾
          </p>
        )}
      </div>

      {open && <>
        {/* Metrics Grid (Horizontal wrap for infinite scaling) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {burnMetrics.map(m => (
            <div key={m.label} style={{ background: T.cream, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px", flex: "1 1 auto", minWidth: 150 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 4, marginBottom: 4 }}>
                <p style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: ".03em", flex: 1 }}>{m.label}</p>
                <InfoTip text={m.tip} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 800, color: m.hi ? T.danger : T.ink }}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Guidance Block */}
        {showGuide && (() => {
          const alertColor = guide.projectedOver > 0 || over > 0 ? T.danger : T.warn;
          const alertBg    = guide.projectedOver > 0 || over > 0 ? T.dangerS : T.warnS;
          return (
            <div style={{ marginTop: 14, borderRadius: 12, border: `1.5px solid ${alertColor}44`, background: alertBg, padding: mobile ? "14px" : "18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: alertColor }}>🎯 Spending limits to stay on budget</span>
                <InfoTip text="These figures show how much you can afford to spend going forward without exceeding your total budget by the end date." />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <GuideTile label="Max per day" labelColor={guide.cutNeeded > 0 ? T.danger : T.sage} value={guide.safeDailyLimit > 0 ? `${fmt(guide.safeDailyLimit)}/d` : "₹0"} valueColor={guide.cutNeeded > 0 ? T.danger : T.sage} sub={`${Math.round(guide.remainDays)} days left`} tip="Stay at or below this daily to avoid going over budget." />
                <GuideTile label="Max per week" value={guide.safeWeeklyLimit > 0 ? fmt(guide.safeWeeklyLimit) : "₹0"} sub="weekly target" tip="Safe daily limit × 7." />
                {guide.cutNeeded > 0 && <GuideTile bg={T.warnS} border={`1px solid ${T.warn}44`} label="Reduce daily by" labelColor={T.warn} value={`${fmt(guide.cutNeeded)}/d`} valueColor={T.warn} sub={`vs ${fmt(guide.actualBurn)}/d pace`} tip={`Cut by ${fmt(guide.cutNeeded)}/day to reach safe limit.`} />}
                {guide.projectedOver > 0 && <GuideTile bg={T.dangerS} border={`1px solid ${T.danger}44`} label="Overshoot risk" labelColor={T.danger} value={`+${fmt(guide.projectedOver)}`} valueColor={T.danger} sub="at current pace" tip="If you keep spending at today's rate, you will exceed total budget." />}
                <GuideTile bg={guide.paceGap > 15 ? T.dangerS : guide.paceGap > 5 ? T.warnS : T.sageS} border={`1px solid ${guide.paceGap > 15 ? T.danger : guide.paceGap > 5 ? T.warn : T.sage}44`} label="Pace vs plan" labelColor={guide.paceGap > 15 ? T.danger : guide.paceGap > 5 ? T.warn : T.sage} value={`${guide.paceGap >= 0 ? "+" : ""}${guide.paceGap.toFixed(0)}%`} valueColor={guide.paceGap > 5 ? T.danger : T.sage} sub={`${Math.round(guide.pctBudgetUsed)}% budget · ${Math.round(guide.pctTimeElapsed)}% time`} tip="Positive = spending ahead of pace." />
                {guide.txsRemaining !== null && <GuideTile label="Purchases left" value={`~${guide.txsRemaining}`} sub={`avg ${fmt(guide.avgTx)}/tx`} tip={`Based on your avg transaction of ${fmt(guide.avgTx)}.`} />}
              </div>
            </div>
          );
        })()}

        {/* At-Risk Split Tenders */}
        {b.tenderAnalytics && b.tenderAnalytics.length > 0 && (() => {
          const atRisk = b.tenderAnalytics!.filter(ta => {
            const tPct = ta.allocatedAmount > 0 ? (ta.spentAmount / ta.allocatedAmount) * 100 : 0;
            return (ta.threshold != null ? tPct >= ta.threshold : tPct >= 90) || ta.spentAmount > ta.allocatedAmount;
          });
          if (atRisk.length === 0) return null;

          return (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: T.danger, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>⚠️ At Risk Payment Tenders</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {atRisk.map(ta => {
                  const tOver  = Math.max(0, ta.spentAmount - ta.allocatedAmount);
                  const tRem   = Math.max(0, ta.allocatedAmount - ta.spentAmount);
                  const tPct   = ta.allocatedAmount > 0 ? (ta.spentAmount / ta.allocatedAmount) * 100 : 0;
                  const tShare = used > 0 ? (ta.spentAmount / used) * 100 : 0;
                  const tTone  = tOver > 0 ? "danger" : "warn";
                  const tMaxDaily = guide.remainDays > 0 ? tRem / guide.remainDays : 0;

                  return (
                    <div key={ta.splitTenderId} style={{ background: toneS[tTone], borderRadius: 12, padding: "14px", border: `1px solid ${toneC[tTone]}44`, flex: "1 1 auto", minWidth: 260 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 16 }}>{tOver > 0 ? "🔴" : "⚠️"}</span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: toneC[tTone], flex: 1 }}>{ta.splitTenderName}</span>
                        <span style={{ fontSize: 12, color: T.ink, fontWeight: 700 }}>{fmt(ta.spentAmount)} / {fmt(ta.allocatedAmount)}</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                        <div style={{ minWidth: 0, flex: "1 1 80px" }}>
                          <p style={{ fontSize: 10, color: toneC[tTone], fontWeight: 700, textTransform: "uppercase" }}>{tOver > 0 ? "Over Limit" : "Remaining"}</p>
                          <p style={{ fontSize: 15, fontWeight: 800, color: toneC[tTone] }}>{tOver > 0 ? `+${fmt(tOver)}` : fmt(tRem)}</p>
                        </div>
                        <div style={{ minWidth: 0, flex: "1 1 80px" }}>
                          <p style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Spend Share</p>
                          <p style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{Math.round(tShare)}%</p>
                        </div>
                        <div style={{ minWidth: 0, flex: "1 1 80px" }}>
                          <p style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Alloc. Used</p>
                          <p style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{Math.round(tPct)}%</p>
                        </div>
                        {guide.remainDays > 0 && tRem > 0 && (
                          <div style={{ minWidth: 0, flex: "1 1 80px" }}>
                            <p style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase" }}>Max/day</p>
                            <p style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{fmt(tMaxDaily)}/d</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* All Tenders Progress Bars (Horizontal Grid) */}
        {b.tenderAnalytics && b.tenderAnalytics.length > 0 && (
          <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${T.line}` }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 12 }}>Tender Allocation Status</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px 32px" }}>
              {b.tenderAnalytics.map(ta => {
                const tp    = ta.allocatedAmount ? (ta.spentAmount/ta.allocatedAmount)*100 : 0;
                const tRem  = Math.max(0, ta.allocatedAmount - ta.spentAmount);
                const tOver = Math.max(0, ta.spentAmount - ta.allocatedAmount);
                const al    = isTenderAlerted(ta);
                const tTone = tOver > 0 ? "danger" : al ? "warn" : health(tp).tone;
                return (
                  <div key={ta.splitTenderId} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: toneC[tTone] || T.ink, width: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {tOver > 0 ? "🔴" : al ? "⚠️" : "🗂️"} {ta.splitTenderName}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}><Progress pct={tp} tone={tTone} h={6} /></div>
                    <div style={{ textAlign: "right", flexShrink: 0, minWidth: 80 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: toneC[tTone] || T.ink }}>
                        {tOver > 0 ? `+${fmt(tOver)}` : fmt(tRem)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>}
    </Card>
  );
}

// A collapsible budget group. The Active section opens by default; Paused and
// Completed start collapsed and expand when their header is clicked.
function BudgetSection({ title, emoji, budgets, defaultOpen, tone, onEdit, onDelete }: {
  title: string; emoji: string; budgets: Budget[]; defaultOpen?: boolean; tone: string;
  onEdit: (b: Budget) => void; onDelete: (b: Budget) => void;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (budgets.length === 0) return null;
  const totalSpent = budgets.reduce((s, b) => s + Number(b.usedAmount || 0), 0);
  const totalAmt   = budgets.reduce((s, b) => s + Number(b.amount || 0), 0);
  return (
    <div style={{ marginBottom: 24 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 16px", borderRadius: 14,
                 border: `1px solid ${T.line}`, background: T.paper, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: 12, color: T.faint, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
        <span style={{ fontSize: 16 }}>{emoji}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: T.ink, textTransform: "uppercase", letterSpacing: ".04em" }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: toneC[tone], background: toneS[tone], borderRadius: 99, padding: "2px 9px" }}>{budgets.length}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: T.muted, fontWeight: 600 }}>{fmt(totalSpent)} / {fmt(totalAmt)}</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 14 }}>
          {budgets.map(b => <BudgetCard key={b.id} b={b} onEdit={() => onEdit(b)} onDelete={() => onDelete(b)} />)}
        </div>
      )}
    </div>
  );
}

function BudgetsScreen() {
  const mobile = useMobile();
  const { budgets, budgetsLoading, splitTenders, createBudget, updateBudget, deleteBudget, enableSplitTenders } = useData();
  useEffect(() => { enableSplitTenders(); }, [enableSplitTenders]);
  const [modal, setModal] = useState<{open:boolean; budget?:Budget}>({open:false});
  const [form, setForm] = useState<BudgetForm>(blankBudget);
  const [saving, setSaving] = useState(false);
  const [delModal, setDelModal] = useState<{open:boolean; budget?:Budget}>({open:false});
  const [delName, setDelName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const isEdit = !!modal.budget;

  const computedTotal = form.tenders.reduce((s, t) => s + (Number(t.allocatedAmount) || 0), 0);

  // Sorted lists, split into the three status sections
  const sortedByCreated  = [...budgets].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const activeBudgets    = sortedByCreated.filter(b => b.status === "active");
  const pausedBudgets    = sortedByCreated.filter(b => b.status === "paused");
  const completedBudgets = sortedByCreated.filter(b => b.status === "completed");

  const openDelete = (b: Budget) => { setDelName(""); setDelModal({ open:true, budget:b }); };
  const confirmDelete = async () => {
    if (!delModal.budget || delName.trim() !== delModal.budget.name) return;
    try {
      setDeleting(true);
      await deleteBudget(delModal.budget.id);
      setDelModal({ open:false });
      setDelName("");
    } catch(e:unknown) { alert(e instanceof Error ? e.message : "Error"); }
    finally { setDeleting(false); }
  };

  useEffect(()=>{
    if (modal.open) {
      if (modal.budget) {
        const existingTenders: BudgetTenderRow[] = (modal.budget.tenderAnalytics || []).map(ta => ({
          splitTenderId:   ta.splitTenderId,
          allocatedAmount: String(ta.allocatedAmount),
          threshold:       ta.threshold != null ? String(ta.threshold) : "",
        }));
        setForm({
          name:        modal.budget.name,
          description: modal.budget.description || "",
          startDate:   toDateStr(modal.budget.startDate),
          endDate:     toDateStr(modal.budget.endDate),
          color:       modal.budget.color || "#C2623F",
          status:      modal.budget.status,
          tenders:     existingTenders.length > 0 ? existingTenders : [{ splitTenderId:"", allocatedAmount:"", threshold:"" }],
        });
      } else {
        setForm({ ...blankBudget, tenders:[{ splitTenderId:"", allocatedAmount:"", threshold:"" }] });
      }
    }
  }, [modal, splitTenders]);

  const addTenderRow    = () => setForm(f => ({ ...f, tenders:[...f.tenders, { splitTenderId:"", allocatedAmount:"", threshold:"" }] }));
  const removeTenderRow = (i: number) => setForm(f => ({ ...f, tenders:f.tenders.filter((_,idx)=>idx!==i) }));
  const updateTenderRow = (i: number, field: keyof BudgetTenderRow, val: string) =>
    setForm(f => ({ ...f, tenders:f.tenders.map((t,idx)=>idx===i ? { ...t, [field]:val } : t) }));

  const save = async () => {
    if (!form.name) return;
    const validTenders = form.tenders.filter(t => t.splitTenderId && Number(t.allocatedAmount) > 0);
    if (validTenders.length === 0) { alert("Add at least one split tender allocation with a positive amount."); return; }
    try {
      setSaving(true);
      const splitTenderPayload = validTenders.map(t => ({
        splitTenderId:   t.splitTenderId,
        allocatedAmount: Number(t.allocatedAmount),
        threshold:       t.threshold ? Number(t.threshold) : undefined,
      }));
      const payload = {
        name:        form.name,
        description: form.description || undefined,
        startDate:   form.startDate,
        endDate:     form.endDate,
        color:       form.color || undefined,
        status:      form.status as Budget["status"],
        splitTenders: splitTenderPayload,
      } as unknown as Omit<Budget,"id"|"createdAt"|"usedAmount"|"_count">;
      if (isEdit) await updateBudget(modal.budget!.id, payload);
      else         await createBudget(payload);
      setModal({open:false});
    } catch(e:unknown) { alert(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  };


  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Budgets</h1>
      <Btn size="lg" onClick={()=>setModal({open:true})}>+ New budget</Btn>
    </div>

    {budgetsLoading ? <Spinner /> : (
      <>
        {/* Active opens by default; Paused (middle) and Completed (last) start
            collapsed and expand on click. Click any budget to see its detail. */}
        <BudgetSection title="Active"    emoji="🟢" tone="sage"    budgets={activeBudgets}    defaultOpen onEdit={b=>setModal({open:true,budget:b})} onDelete={openDelete} />
        <BudgetSection title="Paused"    emoji="⏸️" tone="sky"     budgets={pausedBudgets}                onEdit={b=>setModal({open:true,budget:b})} onDelete={openDelete} />
        <BudgetSection title="Completed" emoji="✅" tone="primary"  budgets={completedBudgets}             onEdit={b=>setModal({open:true,budget:b})} onDelete={openDelete} />
        {budgets.length === 0 && <p style={{ color:T.muted, fontSize:14, padding:16 }}>No budgets yet. Create one to get started.</p>}
      </>
    )}
    <Modal open={modal.open} onClose={()=>setModal({open:false})} title={isEdit?"Edit Budget":"New Budget"}
      footer={<div style={{ display:"flex", gap:10 }}>
        <Btn variant="ghost" onClick={()=>setModal({open:false})} full>Cancel</Btn>
        <Btn onClick={save} full disabled={saving||!form.name||form.tenders.filter(t=>t.splitTenderId&&Number(t.allocatedAmount)>0).length===0}>{saving?"Saving…":isEdit?"Save changes":"Create"}</Btn>
      </div>}>
      <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
        <Inp label="Budget name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. July 2025 Budget" />
        <Inp label="Description" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Optional" />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
          <Inp label="Start date" type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} />
          <Inp label="End date"   type="date" value={form.endDate}   onChange={e=>setForm(f=>({...f,endDate:e.target.value}))} />
        </div>
        <Sel label="Status" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
        </Sel>
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", display:"block", marginBottom:8 }}>Color</span>
          <div style={{ display:"flex", gap:9 }}>{BCOLORS.map(c=><button key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{ width:30, height:30, borderRadius:99, background:c, border:form.color===c?`3px solid ${T.ink}`:"3px solid transparent", cursor:"pointer" }} />)}</div>
        </div>

        {/* Split tender allocations */}
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", display:"block", marginBottom:8 }}>Split Tender Allocations</span>
          <p style={{ fontSize:11, color:T.faint, marginBottom:10 }}>Distribute budget across tenders. Optional alert threshold (%) per tender.</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {form.tenders.map((row, i) => (
              <div key={i} style={{ display:"flex", flexDirection:mobile?"column":"row", gap:6 }}>
                <div style={{ flex:2 }}>
                  <Sel value={row.splitTenderId} onChange={e=>updateTenderRow(i,"splitTenderId",e.target.value)}>
                    <option value="">Select tender</option>
                    {splitTenders.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                  </Sel>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"flex-end" }}>
                  <div style={{ flex:1 }}>
                    <Inp type="number" value={row.allocatedAmount} onChange={e=>updateTenderRow(i,"allocatedAmount",e.target.value)} placeholder="Amount" />
                  </div>
                  <div style={{ width:72 }}>
                    <Inp type="number" value={row.threshold} onChange={e=>updateTenderRow(i,"threshold",e.target.value)} placeholder="Alert%" min="0" max="100" />
                  </div>
                  {form.tenders.length > 1 && (
                    <IconBtn icon="✕" onClick={()=>removeTenderRow(i)} tone="danger" />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <Btn variant="ghost" size="sm" onClick={addTenderRow}>+ Add tender</Btn>
            <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>Total: {fmt(computedTotal)}</span>
          </div>
        </div>
      </div>
    </Modal>

    {/* Delete confirmation — requires typing the exact budget name. Deleting a
        budget removes it AND every expense (plus their reimbursements) in it. */}
    <Modal open={delModal.open} onClose={()=>{ setDelModal({open:false}); setDelName(""); }} title="Delete budget"
      footer={<div style={{ display:"flex", gap:10 }}>
        <Btn variant="ghost" onClick={()=>{ setDelModal({open:false}); setDelName(""); }} full>Cancel</Btn>
        <Btn variant="danger" onClick={confirmDelete} full disabled={deleting || delName.trim() !== (delModal.budget?.name || "")}>
          {deleting ? "Deleting…" : "Delete permanently"}
        </Btn>
      </div>}>
      {delModal.budget && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ padding:"12px 14px", borderRadius:12, background:T.dangerS, border:`1px solid ${T.danger}44` }}>
            <p style={{ fontSize:13, fontWeight:700, color:T.danger, marginBottom:6 }}>⚠️ This can't be undone</p>
            <p style={{ fontSize:13, color:T.ink, lineHeight:1.5 }}>
              Deleting <b>{delModal.budget.name}</b> will permanently remove the budget,
              {" "}<b>all {delModal.budget._count?.expenses ?? 0} expense{(delModal.budget._count?.expenses ?? 0) === 1 ? "" : "s"}</b> assigned to it,
              {" "}and any reimbursements tied to those expenses.
            </p>
          </div>
          <div>
            <p style={{ fontSize:12, color:T.muted, marginBottom:8 }}>
              Type the budget name <b style={{ color:T.ink }}>{delModal.budget.name}</b> to confirm:
            </p>
            <Inp value={delName} onChange={e=>setDelName(e.target.value)} placeholder={delModal.budget.name} autoFocus />
          </div>
        </div>
      )}
    </Modal>
  </div>;
}

// ── CATEGORIES SCREEN ─────────────────────────────────────────────────────
const CAT_COLORS = ["#C2623F","#E8A838","#2E9E6B","#9B6DBF","#5B8FD4","#3BAF7E","#E07B5A","#4A90D9"];
const CAT_EMOJIS = ["🛒","🍔","🚗","🏠","🎮","💊","✈️","👗","📚","💡","🎬","☕","🐾","🎓","⚽","🎵","💼","🛠️","🌿","💰"];
type CatForm = { name:string; icon:string; color:string };
const blankCat: CatForm = { name:"", icon:"", color:"#C2623F" };

function CategoriesScreen() {
  const { categories, catsLoading, createCategory, updateCategory, deleteCategory, enableCategories } = useData();
  useEffect(() => { enableCategories(); }, [enableCategories]);
  const [modal, setModal] = useState<{open:boolean; category?:Category}>({open:false});
  const [form, setForm] = useState<CatForm>(blankCat);
  const [saving, setSaving] = useState(false);
  const isEdit = !!modal.category;

  useEffect(()=>{
    if (modal.open) setForm(modal.category
      ? { name:modal.category.name, icon:modal.category.icon||"", color:modal.category.color||"#C2623F" }
      : blankCat);
  }, [modal]);

  const save = async () => {
    if (!form.name) return;
    try {
      setSaving(true);
      if (isEdit) await updateCategory(modal.category!.id, form);
      else         await createCategory(form);
      setModal({open:false});
    } catch(e:unknown) { alert(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  };

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Categories</h1>
      <Btn size="lg" onClick={()=>setModal({open:true})}>+ New category</Btn>
    </div>
    {catsLoading ? <Spinner /> : (
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:14 }}>
        {categories.map(c=>(
          <Card key={c.id} style={{ padding:"14px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:40, height:40, borderRadius:12, background:(c.color||T.primary)+"22", display:"grid", placeItems:"center", fontSize:20, flexShrink:0 }}>
                {c.icon||"📁"}
              </div>
              <div style={{ flex:1, minWidth:0, overflow:"hidden" }}>
                <p style={{ fontWeight:700, color:T.ink, fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</p>
              </div>
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                <IconBtn icon="✏️" onClick={()=>setModal({open:true,category:c})} tone="primary" />
                <IconBtn icon="✕" onClick={()=>deleteCategory(c.id)} tone="danger" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    )}
    <Modal open={modal.open} onClose={()=>setModal({open:false})} title={isEdit?"Edit Category":"New Category"}
      footer={<div style={{ display:"flex", gap:10 }}>
        <Btn variant="ghost" onClick={()=>setModal({open:false})} full>Cancel</Btn>
        <Btn onClick={save} full disabled={saving}>{saving?"Saving…":isEdit?"Save changes":"Create"}</Btn>
      </div>}>
      <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
        <Inp label="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Groceries" />
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", display:"block", marginBottom:8 }}>Emoji</span>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(38px,1fr))", gap:6, marginBottom:8 }}>
            {CAT_EMOJIS.map(e=>(
              <button key={e} onClick={()=>setForm(f=>({...f,icon:f.icon===e?"":e}))}
                style={{ height:36, borderRadius:9, fontSize:18, border:`1.5px solid ${form.icon===e?T.primary:T.line}`,
                         background:form.icon===e?T.primaryS:T.raised, cursor:"pointer" }}>
                {e}
              </button>
            ))}
          </div>
          <Inp value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))} placeholder="Or type any emoji / leave blank" />
        </div>
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", display:"block", marginBottom:8 }}>Color</span>
          <div style={{ display:"flex", gap:9, flexWrap:"wrap" }}>{CAT_COLORS.map(c=><button key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{ width:30, height:30, borderRadius:99, background:c, border:form.color===c?`3px solid ${T.ink}`:"3px solid transparent", cursor:"pointer" }} />)}</div>
        </div>
      </div>
    </Modal>
  </div>;
}

// ── SOURCES SCREEN ────────────────────────────────────────────────────────
const SRC_COLORS = ["#C2623F","#E8A838","#2E9E6B","#9B6DBF","#5B8FD4","#3BAF7E","#E07B5A","#9E9389"];
type SrcForm = { name:string; type:string; paymentType:PaymentType; icon:string; color:string; splitTenderId:string; balance:string };
const blankSrc: SrcForm = { name:"", type:"Cash", paymentType:"debit", icon:"💵", color:"#5B8FD4", splitTenderId:"", balance:"" };
// How a source settles. Only "credit" accrues a bill you must pay back later.
const PAYMENT_TYPES: { value:PaymentType; label:string; hint:string }[] = [
  { value:"credit", label:"💳 Credit card", hint:"Spends accrue a bill you pay the bank later" },
  { value:"debit",  label:"🏦 Debit card",  hint:"Money leaves immediately; can receive reimbursements" },
  { value:"cash",   label:"💵 Cash",        hint:"Paid on the spot" },
  { value:"wallet", label:"👛 Wallet",      hint:"Prepaid wallet balance" },
];

// Renders the computed money figures for a payment source. The headline figure
// for a credit card is the bill you still owe the bank, even after a reimbursement
// has landed in a different source.
// `scoped` = budget(s) selected, so `fin.spent` is this source's expense total within those budgets.
function SourceFigures({ fin, paymentType, scoped, budgetLabel }: { fin: SourceFinancials; paymentType: PaymentType; scoped:boolean; budgetLabel:string }) {
  const rows: { label:string; value:number; tone:string; big?:boolean; hint?:string }[] = [];

  if (paymentType === "credit") {
    // A credit card's headline is the bill you owe the bank — scoped to the selected budget(s).
    rows.push({ label:scoped?`Bill to pay · ${budgetLabel}`:"Bill to pay", value:fin.billToPay, tone:fin.billToPay>0?"danger":"sage", big:true,
                hint:"What you owe the bank for spends on this card" + (scoped?" assigned to the selected budget(s)":"") });
    if (fin.reimbursableSpent > 0 || fin.claimedBack > 0) {
      rows.push({ label:"Reimbursed back", value:fin.claimedBack, tone:"sage" });
      rows.push({ label:"Net out-of-pocket", value:fin.netOutOfPocket, tone:fin.netOutOfPocket>0?"warn":"sage",
                  hint:"Spent minus what's been reimbursed to you" });
    }
    if (fin.pendingReimbursement > 0)
      rows.push({ label:"Pending claim", value:fin.pendingReimbursement, tone:"warn",
                  hint:"Reimbursable spend not yet returned" });
  } else {
    // Debit / cash / wallet. Balance is ALWAYS all-time (the money on the card now);
    // only the Expenses line follows the budget filter.
    const hasBalance = fin.openingBalance > 0 || fin.receivedAll > 0;
    if (hasBalance) {
      rows.push({ label:"Current balance", value:fin.currentBalance, tone:fin.currentBalance>=0?"sage":"danger", big:true,
                  hint:"Money on this source now = opening balance + all reimbursements received − all spending" });
      if (fin.openingBalance > 0) rows.push({ label:"Opening balance", value:fin.openingBalance, tone:"muted" });
      if (fin.receivedAll   > 0)  rows.push({ label:"Reimbursement received", value:fin.receivedAll, tone:"sage" });
    }
    rows.push({ label:scoped?`Expenses · ${budgetLabel}`:"Expenses", value:fin.spent, tone:hasBalance?"muted":"primary", big:!hasBalance,
                hint:"Total expenses on this source" + (scoped?" assigned to the selected budget(s)":"") });
  }

  if (rows.length === 0)
    return <p style={{ fontSize:11, color:T.faint, marginTop:4 }}>Select a budget to see its expenses, or set an opening balance.</p>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:7, marginTop:4 }}>
      {rows.map((r,i)=>(
        <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8 }}>
          <span style={{ fontSize:11, color:T.muted, display:"flex", alignItems:"center" }}>
            {r.label}{r.hint && <InfoTip text={r.hint} />}
          </span>
          <span style={{ fontSize:r.big?16:13, fontWeight:r.big?800:600, color:r.tone==="muted"?T.muted:(toneC[r.tone]||T.ink) }}>{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function SourcesScreen() {
  const { budgets, splitTenders, createSource, updateSource, deleteSource, enableSources, enableSplitTenders } = useData();
  useEffect(() => { enableSources(); enableSplitTenders(); }, [enableSources, enableSplitTenders]);
  const [modal, setModal] = useState<{open:boolean; source?:PaymentSource}>({open:false});
  const [form, setForm] = useState<SrcForm>(blankSrc);
  const [saving, setSaving] = useState(false);
  const isEdit = !!modal.source;

  // This screen owns its own source fetch so the figures can be scoped to a budget
  // period, independent of the all-time `sources` the rest of the app uses.
  const [rows, setRows] = useState<PaymentSource[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [budgetIds, setBudgetIds] = useState<string[]>([]); // empty = all time

  const activeBudgets = budgets.filter(b => b.status === "active");
  const selected = budgets.filter(b => budgetIds.includes(b.id));
  const scoped = selected.length > 0;
  const budgetLabel = selected.length === 1 ? selected[0].name : `${selected.length} budgets`;

  const idsKey = budgetIds.join(",");
  const loadRows = useCallback(() => {
    setRowsLoading(true);
    sourcesApi.getAll({ budgetIds }).then(r => setRows(r.data ?? [])).catch(console.error).finally(() => setRowsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const toggleBudget = (id: string) => setBudgetIds(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]);

  useEffect(()=>{
    if (modal.open) {
      if (modal.source) {
        setForm({
          name:          modal.source.name,
          type:          modal.source.type === "Cash" || modal.source.type === "Wallet" ? modal.source.type : "Cash",
          paymentType:   modal.source.paymentType || "debit",
          icon:          modal.source.icon    || "💵",
          color:         modal.source.color   || "#5B8FD4",
          splitTenderId: modal.source.splitTenderId || "",
          balance:       modal.source.financials ? String(modal.source.financials.openingBalance)
                       : modal.source.balance != null ? String(Number(modal.source.balance)) : "",
        });
      } else {
        setForm({ ...blankSrc, splitTenderId: "" });
      }
    }
  }, [modal, splitTenders]);

  const save = async () => {
    if (!form.name) return;
    try {
      setSaving(true);
      const payload = {
        name:          form.name,
        type:          form.type || undefined,
        paymentType:   form.paymentType,
        icon:          form.icon || undefined,
        color:         form.color || undefined,
        splitTenderId: form.splitTenderId || undefined,
        // Opening balance only applies to non-credit sources.
        balance:       isCredit ? undefined : (form.balance !== "" ? Number(form.balance) : null),
      };
      if (isEdit) await updateSource(modal.source!.id, payload);
      else         await createSource(payload);
      setModal({open:false});
      loadRows(); // refresh scoped figures after a source change
    } catch(e:unknown) { alert(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  };

  const removeSource = async (id: string) => { await deleteSource(id); loadRows(); };

  const isCredit = form.paymentType === "credit";

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Payment Sources</h1>
      <Btn size="lg" onClick={()=>setModal({open:true})}>+ New source</Btn>
    </div>

    {/* Budget period filter — scopes the bill/spend figures. Balances stay all-time. */}
    {activeBudgets.length > 0 && (
      <div style={{ marginBottom:18 }}>
        <p style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", marginBottom:8 }}>
          Show bills & spend for {scoped ? `${selected.length} budget${selected.length>1?"s":""}` : "all time"}
        </p>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button onClick={()=>setBudgetIds([])}
            style={{ padding:"6px 13px", borderRadius:20, border:`1.5px solid ${!scoped?T.primary:T.line}`, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600,
                     background:!scoped?T.primary+"22":"transparent", color:!scoped?T.primary:T.muted }}>All time</button>
          {activeBudgets.map(b=>{ const on = budgetIds.includes(b.id); return (
            <button key={b.id} onClick={()=>toggleBudget(b.id)}
              style={{ padding:"6px 13px", borderRadius:20, border:`1.5px solid ${on?T.primary:T.line}`, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600,
                       background:on?T.primary+"22":"transparent", color:on?T.primary:T.muted }}>
              {on?"✓ ":""}{b.name}
            </button>
          ); })}
        </div>
      </div>
    )}

    {rowsLoading ? <Spinner /> : (
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
        {rows.map(s=>{
          const pt = s.paymentType || "debit";
          const ptLabel = PAYMENT_TYPES.find(p=>p.value===pt)?.label || pt;
          return (
          <Card key={s.id}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                <div style={{ width:44, height:44, borderRadius:13, background:(s.color||T.primary)+"22", display:"grid", placeItems:"center", fontSize:22, flexShrink:0 }}>{s.icon||"💳"}</div>
                <div>
                  <p style={{ fontWeight:700, color:T.ink, fontSize:14 }}>{s.name}</p>
                  <p style={{ fontSize:11, color:T.muted }}>{ptLabel}{s.splitTender ? ` · 🗂️ ${s.splitTender.name}` : ""}</p>
                </div>
              </div>
              <div style={{ display:"flex", gap:6, alignSelf:"flex-start" }}>
                <IconBtn icon="✏️" onClick={()=>setModal({open:true,source:s})} tone="primary" />
                <IconBtn icon="✕" onClick={()=>removeSource(s.id)} tone="danger" />
              </div>
            </div>
            {s.financials && <SourceFigures fin={s.financials} paymentType={pt} scoped={scoped} budgetLabel={budgetLabel} />}
          </Card>
        ); })}
      </div>
    )}
    <Modal open={modal.open} onClose={()=>setModal({open:false})} title={isEdit?"Edit Source":"New Payment Source"}
      footer={<div style={{ display:"flex", gap:10 }}>
        <Btn variant="ghost" onClick={()=>setModal({open:false})} full>Cancel</Btn>
        <Btn onClick={save} full disabled={saving}>{saving?"Saving…":isEdit?"Save changes":"Create"}</Btn>
      </div>}>
      <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
        <Inp label="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. HDFC Credit Card" />
        <div>
          <Sel label="Payment type" value={form.paymentType} onChange={e=>setForm(f=>({...f,paymentType:e.target.value as PaymentType}))}>
            {PAYMENT_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
          </Sel>
          <p style={{ fontSize:10, color:T.faint, marginTop:5 }}>{PAYMENT_TYPES.find(p=>p.value===form.paymentType)?.hint}</p>
        </div>
        <Sel label="Split Tender" value={form.splitTenderId} onChange={e=>setForm(f=>({...f,splitTenderId:e.target.value}))}>
          <option value="">— Select tender —</option>
          {splitTenders.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </Sel>
        <Inp label="Icon (emoji)" value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))} placeholder="💳" />
        {!isCredit && (
          <div>
            <Inp label="Opening balance (₹)" type="number" value={form.balance} onChange={e=>setForm(f=>({...f,balance:e.target.value}))} placeholder="Money on this source right now" />
            <p style={{ fontSize:10, color:T.faint, marginTop:5 }}>Current balance = opening balance + reimbursements received − spending. Leave blank if you don't track a balance here.</p>
          </div>
        )}
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", display:"block", marginBottom:8 }}>Color</span>
          <div style={{ display:"flex", gap:9, flexWrap:"wrap" }}>{SRC_COLORS.map(c=><button key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{ width:30, height:30, borderRadius:99, background:c, border:form.color===c?`3px solid ${T.ink}`:"3px solid transparent", cursor:"pointer" }} />)}</div>
        </div>
      </div>
    </Modal>
  </div>;
}

// ── SPLIT TENDERS SCREEN ─────────────────────────────────────────────────
type SplitTenderForm = { name:string; description:string };
const blankTender: SplitTenderForm = { name:"", description:"" };

function SplitTendersScreen() {
  const { splitTenders, splitTendersLoading, createSplitTender, updateSplitTender, deleteSplitTender, enableSplitTenders } = useData();
  useEffect(() => { enableSplitTenders(); }, [enableSplitTenders]);
  const [modal, setModal] = useState<{open:boolean; tender?:SplitTender}>({open:false});
  const [form, setForm] = useState<SplitTenderForm>(blankTender);
  const [saving, setSaving] = useState(false);
  const isEdit = !!modal.tender;

  useEffect(()=>{
    if (modal.open) setForm(modal.tender
      ? { name:modal.tender.name, description:modal.tender.description||"" }
      : blankTender);
  }, [modal]);

  const save = async () => {
    if (!form.name) return;
    try {
      setSaving(true);
      if (isEdit) await updateSplitTender(modal.tender!.id, form);
      else         await createSplitTender(form);
      setModal({open:false});
    } catch(e:unknown) { alert(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  };

  const handleDelete = (t: SplitTender) => {
    if ((t._count?.budgetTenders||0) > 0) {
      if (!window.confirm(`"${t.name}" is still linked to ${t._count?.budgetTenders} budget(s). Remove those links first.`)) return;
    }
    deleteSplitTender(t.id).catch((e:unknown) => alert(e instanceof Error ? e.message : "Error"));
  };

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <div>
        <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Split Tenders</h1>
        <p style={{ fontSize:13, color:T.muted, marginTop:5 }}>Group payment sources into tender types for budget tracking.</p>
      </div>
      <Btn size="lg" onClick={()=>setModal({open:true})}>+ New tender</Btn>
    </div>
    {splitTendersLoading ? <Spinner /> : (
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
        {splitTenders.map(t=>(
          <Card key={t.id} style={{ padding:"14px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:40, height:40, borderRadius:12, background:T.primaryS, display:"grid", placeItems:"center", fontSize:20, flexShrink:0 }}>🗂️</div>
              <div style={{ flex:1, minWidth:0, overflow:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <p style={{ fontWeight:700, color:T.ink, fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.name}</p>
                </div>
                {t.description && <p style={{ fontSize:11, color:T.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.description}</p>}
                <p style={{ fontSize:11, color:T.faint, marginTop:3 }}>{t._count?.sources||0} sources · {t._count?.budgetTenders||0} budgets</p>
              </div>
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                <IconBtn icon="✏️" onClick={()=>setModal({open:true,tender:t})} tone="primary" />
                <IconBtn icon="✕" onClick={()=>handleDelete(t)} tone="danger" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    )}
    <Modal open={modal.open} onClose={()=>setModal({open:false})} title={isEdit?"Edit Split Tender":"New Split Tender"}
      footer={<div style={{ display:"flex", gap:10 }}>
        <Btn variant="ghost" onClick={()=>setModal({open:false})} full>Cancel</Btn>
        <Btn onClick={save} full disabled={saving||!form.name}>{saving?"Saving…":isEdit?"Save changes":"Create"}</Btn>
      </div>}>
      <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
        <Inp label="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Digital Payments" />
        <Inp label="Description (optional)" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Brief description" />
      </div>
    </Modal>
  </div>;
}

// ── ANALYTICS SCREEN ──────────────────────────────────────────────────────
function AnalyticsScreen({ onDrillTo }: { onDrillTo?:(f:NavFilters)=>void }) {
  const mobile = useMobile();
  const { budgets } = useData();
  const [error,   setError]           = useState("");
  const [selBudgets, setSelBudgets]   = useState<string[]>([]);
  const [data, setData]               = useState<BudgetAnalytics|null>(null);
  const [expLoading, setExpLoading]   = useState(false);
  const didInit = useRef(false);

  const activeBudgets = budgets.filter(b => b.status === "active");

  // Default to the first active budget once budgets have loaded
  useEffect(()=>{
    if (!didInit.current && activeBudgets.length > 0) {
      didInit.current = true;
      setSelBudgets([activeBudgets[0].id]);
    }
  }, [activeBudgets]);

  // Fetch server-computed metrics for the selected budget(s) — all aggregation
  // happens in the backend over the full expense set (no row cap).
  useEffect(()=>{
    if (selBudgets.length === 0) { setData(null); return; }
    setExpLoading(true);
    analyticsApi.getBudgetAnalytics(selBudgets)
      .then(r=>setData(r.data))
      .catch(e=>setError(e instanceof Error?e.message:"Error"))
      .finally(()=>setExpLoading(false));
  }, [selBudgets]);

  const toggleBudget = (id:string) => setSelBudgets(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  if (error) return <ErrMsg msg={error} />;

  const MONTHS = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // ── Map the server payload onto the names the JSX/stat builders expect ────
  const total          = data?.totalSpent        ?? 0;
  const txCount        = data?.totalTransactions ?? 0;
  const avgPerTx       = data?.avgPerTransaction ?? 0;
  const avgDaily       = data?.avgDailySpend     ?? 0;
  const totalRangeDays = data?.totalRangeDays    ?? 1;
  const cats           = data?.categoryBreakdown ?? [];
  const srcs           = data?.sourceBreakdown   ?? [];
  const fixedTotal     = data?.fixedTotal        ?? 0;
  const variableTotal  = data?.variableTotal     ?? 0;
  const fixedCount     = data?.fixedCount        ?? 0;
  const variableCount  = data?.variableCount     ?? 0;

  const monthly = (data?.monthly ?? []).map(m => ({ ...m, month: MONTHS[m.monthNum] }));

  const dowData = DOW.map((day,i)=>{
    const d = data?.dow.find(x=>x.dayIndex===i);
    return { day, fixed:d?.fixed??0, variable:d?.variable??0, total:d?.total??0, count:d?.count??0 };
  });
  const topDow = dowData.reduce((a,b)=>b.total>a.total?b:a, dowData[0]);

  const unbudgetedTotal = data?.unbudgetedTotal ?? 0;
  const unbudgetedPct   = data?.unbudgetedPct   ?? 0;
  const spikeDays       = data?.spikeDays        ?? 0;
  const spikeDatesList  = data?.spikeDates        ?? [];
  const activeDays      = data?.activeDays        ?? 0;
  const activeDaysPct   = data?.activeDaysPct     ?? 0;
  const weekendFixed    = data?.weekend.fixed     ?? 0;
  const weekendVariable = data?.weekend.variable  ?? 0;
  const weekendTotal    = data?.weekend.total     ?? 0;
  const weekendPct      = data?.weekend.pct       ?? 0;
  const weekendDatesList = data?.weekend.dates    ?? [];
  const momChange: number | null = data?.momChange ?? null;

  const maxFixedExp = data?.biggestFixed    ?? null;
  const maxVarExp   = data?.biggestVariable ?? null;
  const topFixedDateEntry = data?.topFixedDate ? [data.topFixedDate.date, data.topFixedDate.total] as [string,number] : undefined;
  const topVarDateEntry   = data?.topVarDate   ? [data.topVarDate.date,   data.topVarDate.total]   as [string,number] : undefined;
  const topCatPct = data?.topCatPct ?? 0;

  type StatItemRow = { icon:string; label:string; amount:string; tone:string; onClick?:()=>void };
  type StatItem = { label:string; value:string; icon:string; tone:string; tip:string; sub?:string; onClick?:()=>void; rows?:StatItemRow[] };
  const stats: StatItem[] = [
    { label:"Total spent",         value:fmtS(total),                   icon:"💸", tone:"primary",
      tip:"Sum of all recorded expenses in scope. Use the budget filter above to narrow to a specific budget's expenses." },
    { label:"Transactions",        value:String(txCount),                icon:"🧾", tone:"sky",
      tip:"Count of individual expense entries. Pair with Avg per transaction to understand whether overruns come from more purchases or larger ones." },
    { label:"Avg per transaction", value:avgPerTx>0?fmtS(avgPerTx):"—", icon:"📊", tone:"sage",
      tip:"Total spent ÷ number of transactions. A rising average signals fewer but larger purchases — often impulse or discretionary spending." },
    { label:"Avg daily spend",     value:avgDaily>0?fmtS(avgDaily):"—", icon:"📅", tone:"warn",
      tip:"Total expenses ÷ days from first to last recorded expense. Unlike budget burn rate (scoped to each budget's period and only counting its linked expenses), this reflects your overall daily spending pattern across all recorded data." },
  ];

  const behaviourStats: StatItem[] = [
    { label:"Unbudgeted spend",    value:fmtS(unbudgetedTotal),         icon:"🔓",
      tone: unbudgetedPct>30?"danger":unbudgetedPct>10?"warn":"sage",
      tip:"Total spent outside any budget. High unbudgeted spend means you're regularly spending beyond your planned categories — a direct root cause of budget overruns.",
      sub:`${unbudgetedPct}% of total spend`,
      onClick: onDrillTo && unbudgetedTotal > 0 ? ()=>onDrillTo({ unbudgeted:true, budgetIds:selBudgets.length?selBudgets:undefined, label:"Unbudgeted expenses" }) : undefined },
    { label:"Spike days",          value:String(spikeDays),              icon:"⚡",
      tone: spikeDays>5?"danger":spikeDays>2?"warn":"sage",
      tip:"Days where you spent 1.5× or more above your daily average. Frequent spikes point to impulsive or event-driven spending that is hard to budget for.",
      sub: spikeDays>0 ? `vs ${fmtS(avgDaily)} avg/day` : "none detected",
      onClick: onDrillTo && spikeDays > 0 ? ()=>onDrillTo({ spikeDates:spikeDatesList, budgetIds:selBudgets.length?selBudgets:undefined, label:`Spike day expenses (${spikeDays} days)` }) : undefined },
    { label:"Spending frequency",  value:`${activeDaysPct}%`,            icon:"🗓️",
      tone: activeDaysPct>80?"warn":activeDaysPct>50?"sky":"sage",
      tip:"% of days in your expense history where you made at least one purchase. Very high frequency (>80%) suggests habitual daily spending as the root cause rather than one-time events.",
      sub:`${activeDays} of ${totalRangeDays} days` },
    { label:"Weekend share",       value:`${weekendPct}%`,               icon:"🌅",
      tone: weekendPct>45?"warn":"sky",
      tip:"Share of your total spending that happened on weekends (Sat & Sun). A high weekend share (>40%) often points to dining, entertainment, and leisure as the key budget pressure areas.",
      sub:`${fmtS(weekendTotal)} on Sat/Sun`,
      onClick: onDrillTo && weekendTotal > 0 ? ()=>onDrillTo({ spikeDates:weekendDatesList, budgetIds:selBudgets.length?selBudgets:undefined, label:"Weekend expenses" }) : undefined,
      rows: [
        { icon:"📌", label:"Fixed",    amount:fmtS(weekendFixed),    tone:"sky",
          onClick: onDrillTo && weekendFixed > 0 ? ()=>onDrillTo({ costType:"fixed",    spikeDates:weekendDatesList, budgetIds:selBudgets.length?selBudgets:undefined, label:"Weekend fixed expenses" })    : undefined },
        { icon:"📊", label:"Variable", amount:fmtS(weekendVariable), tone:"warn",
          onClick: onDrillTo && weekendVariable > 0 ? ()=>onDrillTo({ costType:"variable", spikeDates:weekendDatesList, budgetIds:selBudgets.length?selBudgets:undefined, label:"Weekend variable expenses" }) : undefined },
      ] },
  ];

  type InsightRow = { icon:string; label:string; amount:string; detail:string; rowTone:string; onClick?:()=>void };
  type InsightItem = { icon:string; label:string; value?:string; sub?:string; rows?:InsightRow[]; tone:string; tip:string; onClick?:()=>void };
  const insights: InsightItem[] = ([
    momChange !== null && (() => {
      const lastMonth = monthly[monthly.length-2];
      const curMonth  = monthly[monthly.length-1];
      return {
        icon: momChange >= 0 ? "📈" : "📉",
        label: "vs last month",
        value: `${momChange >= 0 ? "+" : ""}${momChange.toFixed(0)}%`,
        tone: momChange > 15 ? "danger" : momChange < -5 ? "sage" : "sky",
        tip: "Month-over-month change in total spending. Above +15% is a warning sign of accelerating spend; negative means you are cutting back.",
        onClick: onDrillTo && curMonth ? ()=>onDrillTo({
          startDate: `${curMonth.year}-${String(curMonth.monthNum).padStart(2,"0")}-01`,
          endDate:   `${curMonth.year}-${String(curMonth.monthNum).padStart(2,"0")}-${String(new Date(curMonth.year,curMonth.monthNum,0).getDate()).padStart(2,"0")}`,
          budgetIds: selBudgets.length?selBudgets:undefined,
          label: `${curMonth.month} ${curMonth.year} expenses (vs ${lastMonth?.month??""})`,
        }) : undefined,
      };
    })(),
    cats.length > 0 && {
      icon: cats[0].category?.icon || "📁",
      label: "top category",
      value: `${cats[0].category?.name || "Other"} · ${topCatPct}%`,
      tone: "primary",
      tip: "The single category consuming the largest share of total spend. If it is discretionary (dining, entertainment), it is likely the root cause of budget pressure.",
      onClick: onDrillTo && cats[0].category?.id ? ()=>onDrillTo({ categoryId:cats[0].category!.id, budgetIds:selBudgets.length?selBudgets:undefined, label:`${cats[0].category?.name||"Other"} expenses` }) : undefined,
    },
    (maxFixedExp || maxVarExp) && {
      icon: "🔝",
      label: "biggest expense",
      tone: "warn",
      tip: "Fixed: largest single fixed-cost transaction (rent, EMI, subscriptions). Variable: largest discretionary transaction — this is where you have the most room to cut.",
      rows: [
        ...(maxFixedExp ? [{ icon:"📌", label:"Fixed",    amount:fmt(Number(maxFixedExp.amount)), detail:maxFixedExp.title,  rowTone:"sky",
          onClick: onDrillTo ? ()=>onDrillTo({ costType:"fixed", startDate:maxFixedExp.date.slice(0,10), endDate:maxFixedExp.date.slice(0,10), budgetIds:selBudgets.length?selBudgets:undefined, label:"Biggest fixed expense" }) : undefined }] : []),
        ...(maxVarExp   ? [{ icon:"📊", label:"Variable", amount:fmt(Number(maxVarExp.amount)),   detail:maxVarExp.title,    rowTone:"warn",
          onClick: onDrillTo ? ()=>onDrillTo({ costType:"variable", startDate:maxVarExp.date.slice(0,10), endDate:maxVarExp.date.slice(0,10), budgetIds:selBudgets.length?selBudgets:undefined, label:"Biggest variable expense" }) : undefined }] : []),
      ],
    },
    (topFixedDateEntry || topVarDateEntry) && {
      icon: "📆",
      label: "top spend date",
      tone: "sky",
      tip: "Fixed: the date with the highest fixed-cost spend. Variable: the date with the highest discretionary spend — tap to drill into those expenses.",
      rows: [
        ...(topFixedDateEntry ? [{ icon:"📌", label:"Fixed",    amount:fmt(topFixedDateEntry[1]), detail:getSafeDate(topFixedDateEntry[0]).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"}), rowTone:"sky",
          onClick: onDrillTo ? ()=>onDrillTo({ costType:"fixed", startDate:topFixedDateEntry[0], endDate:topFixedDateEntry[0], budgetIds:selBudgets.length?selBudgets:undefined, label:`Top fixed spend · ${getSafeDate(topFixedDateEntry[0]).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}` }) : undefined }] : []),
        ...(topVarDateEntry   ? [{ icon:"📊", label:"Variable", amount:fmt(topVarDateEntry[1]),   detail:getSafeDate(topVarDateEntry[0]).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"}),   rowTone:"warn",
          onClick: onDrillTo ? ()=>onDrillTo({ costType:"variable", startDate:topVarDateEntry[0], endDate:topVarDateEntry[0], budgetIds:selBudgets.length?selBudgets:undefined, label:`Top variable spend · ${getSafeDate(topVarDateEntry[0]).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}` }) : undefined }] : []),
      ],
    },
  ] as (false|InsightItem)[]).filter((x): x is InsightItem => !!x);

  return <div>
    <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em", marginBottom:20 }}>Analytics</h1>

    {/* Budget filter */}
    {activeBudgets.length > 0 && (
      <Card style={{ marginBottom:18 }}>
        <p style={{ fontSize:12, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>Filter by budget</p>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {activeBudgets.map(b=>{
            const sel = selBudgets.includes(b.id);
            return (
              <button key={b.id} onClick={()=>toggleBudget(b.id)}
                style={{ padding:"7px 14px", borderRadius:99, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                         background:sel?(b.color||T.primary):T.raised, color:sel?"#fff":T.muted,
                         border:sel?`1px solid ${b.color||T.primary}`:`1px solid ${T.line}` }}>
                {b.name}
              </button>
            );
          })}
          {selBudgets.length > 0 && (
            <button onClick={()=>setSelBudgets([])}
              style={{ padding:"7px 14px", borderRadius:99, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", background:"transparent", color:T.primary, border:`1px solid ${T.primary}` }}>
              ✕ Clear
            </button>
          )}
        </div>
        {selBudgets.length > 0 && <p style={{ fontSize:11, color:T.muted, marginTop:8 }}>Combined data for {selBudgets.length} budget{selBudgets.length>1?"s":""}</p>}
      </Card>
    )}

    {expLoading && <Spinner />}

    {/* No budget selected → no data */}
    {!expLoading && selBudgets.length === 0 && (
      <Card style={{ padding:"44px 20px", textAlign:"center" }}>
        <p style={{ fontSize:30, marginBottom:8 }}>📊</p>
        <p style={{ fontSize:15, fontWeight:700, color:T.ink, marginBottom:4 }}>No budget selected</p>
        <p style={{ fontSize:13, color:T.muted }}>Select a budget above to view its analytics.</p>
      </Card>
    )}

    {/* Budget selected but no expenses */}
    {!expLoading && selBudgets.length > 0 && txCount === 0 && (
      <Card style={{ padding:"44px 20px", textAlign:"center" }}>
        <p style={{ fontSize:30, marginBottom:8 }}>🗒️</p>
        <p style={{ fontSize:15, fontWeight:700, color:T.ink, marginBottom:4 }}>No expenses yet</p>
        <p style={{ fontSize:13, color:T.muted }}>The selected budget{selBudgets.length>1?"s have":" has"} no expenses to analyze.</p>
      </Card>
    )}

    {/* Cost type split */}
    {txCount > 0 && (
      <Card style={{ marginBottom:18 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
          <span style={{ fontWeight:700, fontSize:15, color:T.ink }}>Fixed vs Variable</span>
          <InfoTip text="Fixed costs are predictable recurring expenses (rent, EMI, subscriptions). Variable costs fluctuate each month. Understanding the split helps you know how much of your spending is controllable." />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr 1fr":"repeat(4,1fr)", gap:10 }}>
          {[
            { label:"Total (all)",    value:fmtS(total),         sub:`${txCount} transactions`,             tone:"primary", tip:"All expenses combined — fixed + variable." },
            { label:"Fixed costs",    value:fmtS(fixedTotal),    sub:`${fixedCount} transactions`,     tone:"sky",     tip:"Predictable, recurring expenses like rent, EMI, or subscriptions. Hard to reduce short-term.",
              onClick: onDrillTo && fixedCount > 0 ? ()=>onDrillTo!({ costType:"fixed", budgetIds:selBudgets.length?selBudgets:undefined, label:"Fixed expenses" }) : undefined },
            { label:"Variable costs", value:fmtS(variableTotal), sub:`${variableCount} transactions`,  tone:"warn",    tip:"Discretionary or irregular expenses. This is where you have the most room to cut.",
              onClick: onDrillTo && variableCount > 0 ? ()=>onDrillTo!({ costType:"variable", budgetIds:selBudgets.length?selBudgets:undefined, label:"Variable expenses" }) : undefined },
            { label:"Variable share", value:total>0?`${Math.round(variableTotal/total*100)}%`:"—",
              sub:`${fmt(variableTotal)} of ${fmt(total)}`, tone: total>0&&variableTotal/total>0.7?"danger":"sage",
              tip:"What percentage of your total spend is variable (controllable). Above 70% means most of your spending is flexible — you have leverage to reduce it.",
              onClick: onDrillTo && variableCount > 0 ? ()=>onDrillTo!({ costType:"variable", budgetIds:selBudgets.length?selBudgets:undefined, label:"Variable expenses" }) : undefined },
          ].map(s=>(
            <div key={s.label} onClick={s.onClick}
              style={{ borderRadius:14, background:toneS[s.tone], border:`1px solid ${toneC[s.tone]}33`, padding:"12px 14px", cursor:s.onClick?"pointer":"default" }}>
              <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:4 }}>
                <p style={{ fontSize:10, color:toneC[s.tone], fontWeight:700, textTransform:"uppercase", letterSpacing:".04em", flex:1 }}>{s.label}</p>
                <InfoTip text={s.tip} />
                {s.onClick && <span style={{ fontSize:11, color:toneC[s.tone] }}>→</span>}
              </div>
              <p style={{ fontSize:mobile?16:20, fontWeight:800, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.value}</p>
              <p style={{ fontSize:10, color:T.faint, marginTop:2 }}>{s.sub}</p>
            </div>
          ))}
        </div>
        {/* Avg per tx split */}
        {fixedCount > 0 && variableCount > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:10 }}>
            <div onClick={onDrillTo ? ()=>onDrillTo!({ costType:"fixed", budgetIds:selBudgets.length?selBudgets:undefined, label:"Fixed expenses" }) : undefined}
              style={{ background:T.cream, borderRadius:10, padding:"10px 12px", border:`1px solid ${T.line}`, cursor:onDrillTo?"pointer":"default" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <p style={{ fontSize:10, color:T.muted, fontWeight:700, marginBottom:3 }}>Avg fixed / tx</p>
                {onDrillTo && <span style={{ fontSize:11, color:T.muted }}>→</span>}
              </div>
              <p style={{ fontSize:mobile?13:15, fontWeight:800, color:T.ink }}>{fmtS(fixedTotal/fixedCount)}</p>
            </div>
            <div onClick={onDrillTo ? ()=>onDrillTo!({ costType:"variable", budgetIds:selBudgets.length?selBudgets:undefined, label:"Variable expenses" }) : undefined}
              style={{ background:T.cream, borderRadius:10, padding:"10px 12px", border:`1px solid ${T.line}`, cursor:onDrillTo?"pointer":"default" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <p style={{ fontSize:10, color:T.muted, fontWeight:700, marginBottom:3 }}>Avg variable / tx</p>
                {onDrillTo && <span style={{ fontSize:11, color:T.muted }}>→</span>}
              </div>
              <p style={{ fontSize:mobile?13:15, fontWeight:800, color:T.ink }}>{fmtS(variableTotal/variableCount)}</p>
            </div>
          </div>
        )}
      </Card>
    )}

    {/* Stats grid — 2×2 on mobile, 4-col on desktop */}
    {txCount > 0 && (
    <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr 1fr":"repeat(4,1fr)", gap:12, marginBottom:18 }}>
      {stats.map(s=>(
        <Card key={s.label} style={{ padding:"14px 16px" }} onClick={s.onClick}>
          <div style={{ width:34, height:34, borderRadius:10, background:toneS[s.tone], display:"grid", placeItems:"center", fontSize:17, marginBottom:9 }}>{s.icon}</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <p style={{ fontSize:11, color:T.muted, flex:1 }}>{s.label}</p>
            {s.tip && <InfoTip text={s.tip} />}
            {s.onClick && <span style={{ fontSize:11, color:toneC[s.tone] }}>→</span>}
          </div>
          <p style={{ fontWeight:800, fontSize:mobile?18:22, color:T.ink, marginTop:3 }}>{s.value}</p>
        </Card>
      ))}
    </div>
    )}

    {/* Insight chips — 2-col on mobile, auto-fill grid on desktop */}
    {txCount > 0 && insights.length > 0 && (
      <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr 1fr":"repeat(auto-fill, minmax(200px, 1fr))", gap:mobile?8:10, marginBottom:18 }}>
        {insights.map((ins,i)=>(
          <div key={i} onClick={ins.onClick}
            style={{ background:toneS[ins.tone]||T.raised, border:`1px solid ${toneC[ins.tone]||T.line}44`,
                     borderRadius:14, padding:"10px 12px", cursor:ins.onClick?"pointer":"default", minWidth:0 }}>
            {/* chip header */}
            <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:ins.rows?8:5 }}>
              <span style={{ fontSize:15 }}>{ins.icon}</span>
              <span style={{ fontSize:9, fontWeight:700, color:toneC[ins.tone]||T.muted, textTransform:"uppercase", letterSpacing:".05em", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ins.label}</span>
              <InfoTip text={ins.tip} />
              {ins.onClick && <span style={{ fontSize:10, color:toneC[ins.tone]||T.muted, flexShrink:0 }}>→</span>}
            </div>
            {/* structured rows (fixed / variable) */}
            {ins.rows ? (
              <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
                {ins.rows.map((row, ri) => (
                  <div key={ri} onClick={row.onClick ? e=>{e.stopPropagation();row.onClick!();} : undefined} style={{ cursor:row.onClick?"pointer":"default", borderRadius:8, padding:row.onClick?"2px 0":0 }}>
                    {ri > 0 && <div style={{ height:1, background:T.line, margin:"7px 0" }} />}
                    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:6 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:3, minWidth:0 }}>
                        <span style={{ fontSize:11, flexShrink:0 }}>{row.icon}</span>
                        <span style={{ fontSize:9, fontWeight:700, color:toneC[row.rowTone], textTransform:"uppercase", letterSpacing:".05em", whiteSpace:"nowrap" }}>{row.label}</span>
                        {row.onClick && <span style={{ fontSize:9, color:toneC[row.rowTone] }}>→</span>}
                      </div>
                      <span style={{ fontSize:mobile?13:14, fontWeight:800, color:T.ink, flexShrink:0 }}>{row.amount}</span>
                    </div>
                    <p style={{ fontSize:mobile?10:11, color:T.faint, marginTop:2, lineHeight:1.3, wordBreak:"break-word" }}>{row.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <p style={{ fontSize:mobile?12:13, fontWeight:700, color:T.ink, lineHeight:1.35, wordBreak:"break-word" }}>{ins.value}</p>
                {ins.sub && <p style={{ fontSize:mobile?10:11, color:T.muted, marginTop:4, lineHeight:1.35, wordBreak:"break-word" }}>{ins.sub}</p>}
              </>
            )}
          </div>
        ))}
      </div>
    )}

    {/* Spending behaviour — root-cause metrics */}
    {txCount > 0 && (
      <div style={{ marginBottom:18 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
          <span style={{ fontWeight:700, fontSize:15, color:T.ink }}>Spending behaviour</span>
          <InfoTip text="These metrics help identify the root cause of budget overruns — whether it's frequency, size, timing, or unplanned spending." />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr 1fr":"repeat(4,1fr)", gap:12 }}>
          {behaviourStats.map(s=>(
            <Card key={s.label} style={{ padding:"14px 16px" }} onClick={s.rows ? undefined : s.onClick}>
              <div style={{ width:34, height:34, borderRadius:10, background:toneS[s.tone], display:"grid", placeItems:"center", fontSize:17, marginBottom:9 }}>{s.icon}</div>
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <p style={{ fontSize:11, color:T.muted, flex:1 }}>{s.label}</p>
                <InfoTip text={s.tip} />
                {!s.rows && s.onClick && <span style={{ fontSize:11, color:toneC[s.tone] }}>→</span>}
              </div>
              <p style={{ fontWeight:800, fontSize:mobile?18:22, color:T.ink, marginTop:3 }}>{s.value}</p>
              {s.sub && <p style={{ fontSize:10, color:T.faint, marginTop:2 }}>{s.sub}</p>}
              {s.rows && (
                <div style={{ marginTop:10, borderTop:`1px solid ${T.line}`, paddingTop:8, display:"flex", flexDirection:"column", gap:6 }}>
                  {s.rows.map((row,ri)=>(
                    <div key={ri} onClick={row.onClick ? e=>{e.stopPropagation();row.onClick!();} : undefined}
                      style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6,
                               cursor:row.onClick?"pointer":"default", borderRadius:8, padding:"4px 6px",
                               background:row.onClick?toneS[row.tone]:"transparent", border:row.onClick?`1px solid ${toneC[row.tone]}33`:"none" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <span style={{ fontSize:11 }}>{row.icon}</span>
                        <span style={{ fontSize:10, fontWeight:700, color:toneC[row.tone], textTransform:"uppercase", letterSpacing:".04em" }}>{row.label}</span>
                        {row.onClick && <span style={{ fontSize:9, color:toneC[row.tone] }}>→</span>}
                      </div>
                      <span style={{ fontSize:12, fontWeight:800, color:T.ink }}>{row.amount}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    )}

    {/* Monthly spending chart */}
    {monthly.length > 0 && (
      <Card style={{ marginBottom:18 }}>
        <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>Monthly spending</span>
        <ResponsiveContainer width="100%" height={mobile?150:200}>
          <BarChart data={monthly} style={{ cursor:"pointer" }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
            <XAxis dataKey="month" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false} />
            <YAxis tick={{fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} tickFormatter={fmtS} width={40} />
            <Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={{borderRadius:12,border:"none",fontSize:12}} />
            <Bar dataKey="spend" name="Spent" fill={T.primary} radius={[5,5,0,0]}
              onClick={(barData:{month:string;year:number;monthNum:number;spend:number})=>{
                const y = barData.year, m = barData.monthNum;
                const start = `${y}-${String(m).padStart(2,"0")}-01`;
                const lastDay = new Date(y, m, 0).getDate();
                const end = `${y}-${String(m).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;
                onDrillTo?.({ startDate:start, endDate:end, budgetIds:selBudgets.length?selBudgets:undefined, label:`${barData.month} ${y} expenses` });
              }} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    )}

    {/* Day-of-week chart */}
    {txCount > 0 && (
      <Card style={{ marginBottom:18 }}>
        <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:4 }}>Spending by day of week</span>
        <p style={{ fontSize:12, color:T.muted, marginBottom:14 }}>Fixed vs variable spend per day</p>
        <ResponsiveContainer width="100%" height={mobile?140:180}>
          <BarChart data={dowData} barSize={mobile?11:16} barGap={2} barCategoryGap="25%" style={{ cursor:"pointer" }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
            <XAxis dataKey="day" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false} />
            <YAxis tick={{fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} tickFormatter={fmtS} width={40} />
            <Tooltip formatter={(v:unknown, name:string)=>[fmt(Number(v)), name]} contentStyle={{borderRadius:12,border:"none",fontSize:12}} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11,paddingTop:8}} />
            <Bar dataKey="fixed" name="Fixed" fill={T.sky} radius={[4,4,0,0]}
              onClick={(barData:{day:string})=>{
                const dowIdx = DOW.indexOf(barData.day);
                onDrillTo?.({ dayOfWeek:dowIdx, costType:"fixed", budgetIds:selBudgets.length?selBudgets:undefined, label:`${barData.day} fixed expenses` });
              }} />
            <Bar dataKey="variable" name="Variable" fill={T.warn} radius={[4,4,0,0]}
              onClick={(barData:{day:string})=>{
                const dowIdx = DOW.indexOf(barData.day);
                onDrillTo?.({ dayOfWeek:dowIdx, costType:"variable", budgetIds:selBudgets.length?selBudgets:undefined, label:`${barData.day} variable expenses` });
              }} />
          </BarChart>
        </ResponsiveContainer>
        <p style={{ fontSize:11, color:T.muted, marginTop:6 }}>
          Highest total: <span style={{ fontWeight:700, color:T.ink }}>{topDow.day}</span> · {fmt(topDow.fixed)} fixed + {fmt(topDow.variable)} variable · {topDow.count} tx
        </p>
      </Card>
    )}

    {/* By category + By source */}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:18 }}>
      {cats.length > 0 && (
        <Card>
          <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>By category</span>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={cats.map(c=>({name:c.category?.name||"Other",value:c.total}))}
                cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}
                style={{ cursor:"pointer" }}
                onClick={(_d:unknown, index:number)=>{
                  const cat = cats[index];
                  if (!cat) return;
                  onDrillTo?.({ categoryId:cat.category?.id, budgetIds:selBudgets.length?selBudgets:undefined, label:`${cat.category?.name||"Other"} category` });
                }}>
                {cats.map((_c,i)=><Cell key={i} fill={CHART_PALETTE[i%CHART_PALETTE.length]} />)}
              </Pie>
              <Tooltip formatter={(v:unknown)=>fmt(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"6px 12px", marginTop:10, marginBottom:14 }}>
            {cats.slice(0,8).map((c,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer" }}
                onClick={()=>onDrillTo?.({ categoryId:c.category?.id, budgetIds:selBudgets.length?selBudgets:undefined, label:`${c.category?.name||"Other"} category` })}>
                <div style={{ width:8,height:8,borderRadius:99,background:CHART_PALETTE[i%CHART_PALETTE.length],flexShrink:0 }} />
                <span style={{ fontSize:11, color:T.muted }}>{c.category?.name||"Other"}</span>
              </div>
            ))}
          </div>
          {cats.map((c,i)=>{
            const max = cats[0].total;
            return (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, marginTop:10, cursor:"pointer", borderRadius:8, padding:"4px 0" }}
                onClick={()=>onDrillTo?.({ categoryId:c.category?.id, budgetIds:selBudgets.length?selBudgets:undefined, label:`${c.category?.name||"Other"} category` })}>
                <span style={{ fontSize:18, flexShrink:0 }}>{c.category?.icon||"💡"}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:13, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, marginRight:8 }}>{c.category?.name||"Other"}</span>
                    <span style={{ fontSize:13, fontWeight:700, color:T.ink, flexShrink:0 }}>{fmt(c.total)}</span>
                  </div>
                  <div style={{ height:5, borderRadius:99, background:T.line, overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:99, width:(c.total/max)*100+"%", background:CHART_PALETTE[i%CHART_PALETTE.length] }} />
                  </div>
                </div>
                <span style={{ fontSize:11, fontWeight:700, color:T.faint, width:30, textAlign:"right", flexShrink:0 }}>{total?Math.round(c.total/total*100):0}%</span>
              </div>
            );
          })}
        </Card>
      )}

      {srcs.length > 0 && (
        <Card>
          <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>By payment source</span>
          {srcs.map((s,i)=>{
            const max  = srcs[0].total;
            const pct  = total > 0 ? Math.round((s.total/total)*100) : 0;
            return (
              <div key={i} style={{ marginBottom:12, cursor:"pointer", borderRadius:8, padding:"4px 0" }}
                onClick={()=>onDrillTo?.({ sourceId:s.source?.id, budgetIds:selBudgets.length?selBudgets:undefined, label:`${s.source?.name||"Unknown"} source` })}>
                <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:5 }}>
                  <span style={{ fontSize:18, flexShrink:0 }}>{s.source?.icon||"💳"}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:13, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, marginRight:8 }}>{s.source?.name||"Unknown"}</span>
                      <span style={{ fontSize:13, fontWeight:700, color:T.ink, flexShrink:0 }}>{fmt(s.total)}</span>
                    </div>
                    <div style={{ height:5, borderRadius:99, background:T.line, overflow:"hidden" }}>
                      <div style={{ height:"100%", borderRadius:99, width:(s.total/max)*100+"%", background:CHART_PALETTE[i%CHART_PALETTE.length] }} />
                    </div>
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color:T.faint, width:30, textAlign:"right", flexShrink:0 }}>{pct}%</span>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop:10, paddingTop:12, borderTop:`1px solid ${T.line}`, display:"flex", justifyContent:"space-between" }}>
            <span style={{ fontSize:12, color:T.muted }}>{srcs.length} source{srcs.length!==1?"s":""} · {txCount} transactions</span>
            <span style={{ fontSize:12, fontWeight:700, color:T.ink }}>{fmt(total)}</span>
          </div>
        </Card>
      )}
    </div>
  </div>;
}

// ── REPORTS SCREEN ────────────────────────────────────────────────────────
const REPORT_PAGE = 50;
function ReportsScreen() {
  const { budgets } = useData();
  const [selBudgetId, setSelBudgetId] = useState("");
  const [summary, setSummary]         = useState<ReportSummary|null>(null);
  const [reportExp, setReportExp]     = useState<Expense[]>([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const didInit = useRef(false);

  const allBudgets = budgets;

  // Default to the first budget once budgets have loaded
  useEffect(()=>{
    if (!didInit.current && allBudgets.length > 0) {
      didInit.current = true;
      setSelBudgetId(allBudgets[0].id);
    }
  }, [allBudgets]);

  // Summary metrics (over ALL rows) + first page of the table, computed server-side
  useEffect(()=>{
    if (!selBudgetId) { setSummary(null); setReportExp([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    analyticsApi.getReport(selBudgetId, REPORT_PAGE, 0)
      .then(r => { setSummary(r.data.summary); setReportExp(r.data.expenses); setTotal(r.meta?.total ?? r.data.expenses.length); })
      .catch(console.error)
      .finally(()=>setLoading(false));
  }, [selBudgetId]);

  const hasMore = reportExp.length < total;
  const loadMore = useCallback(()=>{
    if (loadingMore || !selBudgetId || reportExp.length >= total) return;
    setLoadingMore(true);
    analyticsApi.getReport(selBudgetId, REPORT_PAGE, reportExp.length)
      .then(r => setReportExp(prev => {
        const seen = new Set(prev.map(e=>e.id));
        return [...prev, ...r.data.expenses.filter(e=>!seen.has(e.id))];
      }))
      .catch(console.error)
      .finally(()=>setLoadingMore(false));
  }, [loadingMore, selBudgetId, reportExp.length, total]);

  const sentinelRef = useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(es => { if (es[0]?.isIntersecting) loadMore(); }, { rootMargin:"300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore]);

  // CSV export streams the FULL dataset straight from the backend (no page cap)
  const downloadCSV = () => {
    if (!selBudgetId) return;
    const a = document.createElement("a");
    a.href = analyticsApi.reportCsvUrl(selBudgetId);
    a.download = "spendwise-export.csv";
    document.body.appendChild(a); a.click(); a.remove();
  };

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Reports</h1>
      <Btn size="lg" onClick={downloadCSV} disabled={!selBudgetId}>⬇ Export CSV</Btn>
    </div>

    {/* Budget filter */}
    <Card style={{ marginBottom:18 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <span style={{ fontSize:12, fontWeight:700, color:T.muted }}>Filter by budget:</span>
        <div style={{ position:"relative", flex:1, minWidth:180 }}>
          <select value={selBudgetId} onChange={e=>setSelBudgetId(e.target.value)}
            style={{ width:"100%", padding:"9px 28px 9px 12px", borderRadius:11, border:`1px solid ${T.line}`, background:T.cream, color:T.ink, fontSize:13, cursor:"pointer", outline:"none", fontFamily:"inherit", appearance:"none" }}>
            <option value="">Select a budget…</option>
            {allBudgets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <span style={{ position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", color:T.faint, pointerEvents:"none" }}>▾</span>
        </div>
      </div>
    </Card>

    {!selBudgetId ? (
      <Card style={{ padding:"44px 20px", textAlign:"center" }}>
        <p style={{ fontSize:30, marginBottom:8 }}>📁</p>
        <p style={{ fontSize:15, fontWeight:700, color:T.ink, marginBottom:4 }}>No budget selected</p>
        <p style={{ fontSize:13, color:T.muted }}>Select a budget above to view its report.</p>
      </Card>
    ) : (<>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:13, marginBottom:18 }}>
      {[{l:"Total spent",v:fmt(summary?.totalSpent??0),t:"primary"},{l:"Transactions",v:String(summary?.totalTransactions??0),t:"sky"},{l:"Avg/transaction",v:fmt(summary?.avgTransaction??0),t:"sage"}].map(s=>
        <div key={s.l} style={{ borderRadius:16, border:`1px solid ${T.line}`, padding:"14px 16px", background:T.paper }}>
          <p style={{ fontSize:11, color:T.muted }}>{s.l}</p>
          <p style={{ fontWeight:800, fontSize:22, color:toneC[s.t], marginTop:4 }}>{s.v}</p>
        </div>
      )}
    </div>

    {loading ? <Spinner /> : (
      <Card>
        <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>All expenses{selBudgetId ? ` · ${allBudgets.find(b=>b.id===selBudgetId)?.name||""}` : ""}</span>
        <div className="sw-table-wrap">
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:380 }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.line}` }}>
              {["Title","Category","Budget","Amount","Date"].map(h=><th key={h} style={{ textAlign:h==="Amount"||h==="Date"?"right":"left", padding:"7px 4px", fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {reportExp.map(e=>(
              <tr key={e.id} style={{ borderBottom:`1px solid ${T.line}` }}>
                <td style={{ padding:"10px 4px", fontWeight:600, color:T.ink }}>{e.title}</td>
                <td style={{ padding:"10px 4px", color:T.muted }}>{e.category?.name||"—"}</td>
                <td style={{ padding:"10px 4px", color:T.muted }}>{e.budget?.name||"—"}</td>
                <td style={{ padding:"10px 4px", textAlign:"right", fontWeight:700, color:T.ink }}>{fmt(Number(e.amount))}</td>
                <td style={{ padding:"10px 4px", textAlign:"right", color:T.muted }}>{getSafeDate(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"})}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {reportExp.length === 0 && <p style={{ fontSize:13, color:T.muted, padding:8 }}>No expenses found.</p>}
        {reportExp.length > 0 && (
          <div ref={sentinelRef} style={{ padding:"14px 0 4px", textAlign:"center" }}>
            {loadingMore
              ? <span style={{ fontSize:12, color:T.muted }}>Loading more…</span>
              : hasMore
                ? <span style={{ fontSize:12, color:T.faint }}>Scroll for more</span>
                : <span style={{ fontSize:12, color:T.faint }}>All {total} loaded</span>}
          </div>
        )}
      </Card>
    )}
    </>)}
  </div>;
}

// ── REIMBURSEMENTS SCREEN ─────────────────────────────────────────────────
type ReimbForm = { amount:string; date:string; status:"pending"|"received"; expenseId:string; destinationSourceId:string; notes:string };
const blankReimb: ReimbForm = { amount:"", date:todayStr(), status:"received", expenseId:"", destinationSourceId:"", notes:"" };

function ReimbursementsScreen() {
  const { reimbursements, reimbursementsLoading, sources, createReimbursement, updateReimbursement,
          deleteReimbursement, enableReimbursements, enableSources } = useData();
  const [claimable, setClaimable] = useState<Expense[]>([]);
  const [modal, setModal] = useState<{open:boolean; item?:Reimbursement}>({open:false});
  const [form, setForm] = useState<ReimbForm>(blankReimb);
  const [saving, setSaving] = useState(false);
  const isEdit = !!modal.item;

  useEffect(() => { enableReimbursements(); enableSources(); }, [enableReimbursements, enableSources]);

  // Load reimbursable expenses so a payback can be linked to its origin spend.
  const loadClaimable = useCallback(() => {
    expensesApi.getAll({ reimbursable: true, limit: 200, sortBy: "date", order: "desc" })
      .then(r => setClaimable(r.data ?? [])).catch(console.error);
  }, []);
  useEffect(() => { loadClaimable(); }, [loadClaimable]);

  useEffect(() => {
    if (!modal.open) return;
    loadClaimable();
    setForm(modal.item ? {
      amount:              String(Number(modal.item.amount)),
      date:                toDateStr(modal.item.date),
      status:              modal.item.status,
      expenseId:           modal.item.expenseId || "",
      destinationSourceId: modal.item.destinationSourceId || "",
      notes:               modal.item.notes || "",
    } : blankReimb);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  // Picking an origin expense pre-fills the claim amount with what's left to reclaim.
  const onPickExpense = (id: string) => {
    const exp = claimable.find(e => e.id === id);
    setForm(f => ({ ...f, expenseId: id, amount: exp && !f.amount ? String(Number(exp.amount)) : f.amount }));
  };

  // Hide expenses that already have a RECEIVED reimbursement — they're settled.
  // (Keep the one this reimbursement is editing so it still shows as selected.)
  const settledExpenseIds = new Set(
    reimbursements.filter(r => r.status === "received" && r.expenseId).map(r => r.expenseId as string)
  );
  const selectableExpenses = claimable.filter(e => !settledExpenseIds.has(e.id) || e.id === modal.item?.expenseId);

  const save = async () => {
    if (!form.amount) return;
    try {
      setSaving(true);
      const payload = {
        amount:              Number(form.amount),
        date:                form.date,
        status:              form.status,
        expenseId:           form.expenseId || null,
        destinationSourceId: form.destinationSourceId || null,
        notes:               form.notes || undefined,
      };
      if (isEdit) await updateReimbursement(modal.item!.id, payload);
      else        await createReimbursement(payload);
      setModal({open:false});
    } catch(e:unknown) { alert(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  };

  const received = reimbursements.filter(r => r.status === "received").reduce((s,r)=>s+Number(r.amount),0);
  const pending  = reimbursements.filter(r => r.status === "pending").reduce((s,r)=>s+Number(r.amount),0);

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Reimbursements</h1>
      <Btn size="lg" onClick={()=>setModal({open:true})}>+ Record reimbursement</Btn>
    </div>
    <p style={{ fontSize:13, color:T.muted, marginBottom:18, maxWidth:680 }}>
      A reimbursement is money coming <b>back</b> to you for a spend you flagged as reimbursable — e.g. fuel charged to a
      credit card, then refunded onto a fuel debit card. It never counts as an expense, so your budgets stay accurate.
    </p>

    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12, marginBottom:20 }}>
      <Card><p style={{ fontSize:11, color:T.muted }}>Received</p><p style={{ fontSize:20, fontWeight:800, color:T.sage }}>{fmt(received)}</p></Card>
      <Card><p style={{ fontSize:11, color:T.muted }}>Pending claims</p><p style={{ fontSize:20, fontWeight:800, color:T.warn }}>{fmt(pending)}</p></Card>
    </div>

    {reimbursementsLoading ? <Spinner /> : reimbursements.length === 0 ? (
      <Card><p style={{ fontSize:13, color:T.muted, textAlign:"center", padding:"20px 0" }}>No reimbursements yet. Record one when money lands back.</p></Card>
    ) : (
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {reimbursements.map(r=>(
          <Card key={r.id}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <span style={{ fontSize:16, fontWeight:800, color:T.sage }}>{fmt(Number(r.amount))}</span>
                  <Badge tone={r.status==="received"?"sage":"warn"}>{r.status==="received"?"✓ Received":"⏳ Pending"}</Badge>
                  <span style={{ fontSize:11, color:T.faint }}>{toDateStr(r.date)}</span>
                </div>
                <p style={{ fontSize:12, color:T.muted, marginTop:6 }}>
                  {r.expense ? <>For: <b>{r.expense.title}</b>{r.expense.source ? ` (${r.expense.source.icon||""} ${r.expense.source.name})` : ""}</> : "No linked expense"}
                </p>
                <p style={{ fontSize:12, color:T.muted, marginTop:2 }}>
                  {r.destinationSource ? <>Into: {r.destinationSource.icon||"💳"} <b>{r.destinationSource.name}</b></> : "No destination set"}
                </p>
                {r.notes && <p style={{ fontSize:11, color:T.faint, marginTop:4 }}>{r.notes}</p>}
              </div>
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                <IconBtn icon="✏️" onClick={()=>setModal({open:true,item:r})} tone="primary" />
                <IconBtn icon="✕" onClick={()=>deleteReimbursement(r.id)} tone="danger" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    )}

    <Modal open={modal.open} onClose={()=>setModal({open:false})} title={isEdit?"Edit Reimbursement":"Record Reimbursement"}
      footer={<div style={{ display:"flex", gap:10 }}>
        <Btn variant="ghost" onClick={()=>setModal({open:false})} full>Cancel</Btn>
        <Btn onClick={save} full disabled={saving||!form.amount}>{saving?"Saving…":isEdit?"Save changes":"Record"}</Btn>
      </div>}>
      <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
        <Sel label="For which reimbursable expense?" value={form.expenseId} onChange={e=>onPickExpense(e.target.value)}>
          <option value="">— None / lump sum —</option>
          {selectableExpenses.map(e=><option key={e.id} value={e.id}>{toDateStr(e.date)} · {e.title} · {fmt(Number(e.amount))}{e.source?` (${e.source.name})`:""}</option>)}
        </Sel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
          <Inp label="Amount (₹)" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0" />
          <Inp label="Date" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
        </div>
        <Sel label="Received into (destination source)" value={form.destinationSourceId} onChange={e=>setForm(f=>({...f,destinationSourceId:e.target.value}))}>
          <option value="">— Select source —</option>
          {sources.map(s=><option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
        </Sel>
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", display:"block", marginBottom:8 }}>Status</span>
          <div style={{ display:"flex", gap:8 }}>
            {(["received","pending"] as const).map(st=>(
              <button key={st} onClick={()=>setForm(f=>({...f,status:st}))}
                style={{ flex:1, padding:"9px 0", borderRadius:11, border:`1.5px solid ${form.status===st?T.primary:T.line}`,
                         background:form.status===st?T.primaryS:T.cream, color:form.status===st?T.primary:T.muted,
                         fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit", textTransform:"capitalize" }}>
                {st==="received"?"✓ Received":"⏳ Pending"}
              </button>
            ))}
          </div>
          <p style={{ fontSize:10, color:T.faint, marginTop:5 }}>Only <b>received</b> reimbursements offset your source figures.</p>
        </div>
        <Inp label="Notes (optional)" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. June fuel claim" />
      </div>
    </Modal>
  </div>;
}

// ── APP SHELL ─────────────────────────────────────────────────────────────
const LEFT_TABS  = [
  { id:"dashboard", emoji:"🏠", label:"Home" },
  { id:"expenses",  emoji:"📋", label:"Expenses" },
];
// Mobile bottom bar: 2 tabs · [ + ] · 2 tabs, so the add button is dead-centre.
// Right side = Budgets + the More button (rendered after the loop).
const RIGHT_TABS = [
  { id:"budgets",   emoji:"💰", label:"Budgets" },
];
const MORE_NAV = [
  { id:"analytics",     emoji:"📊", label:"Analytics" },
  { id:"categories",    emoji:"🏷️", label:"Categories" },
  { id:"sources",       emoji:"💳", label:"Sources" },
  { id:"split-tenders", emoji:"🗂️", label:"Tenders" },
  { id:"reimbursements",emoji:"🔄", label:"Reimbursements" },
  { id:"reports",       emoji:"📁", label:"Reports" },
];
const MORE_IDS = MORE_NAV.map(m => m.id);
const PAGE_TITLE: Record<string,string> = {
  dashboard:"Dashboard", budgets:"Budgets", expenses:"Expenses",
  categories:"Categories", sources:"Sources", analytics:"Analytics", reports:"Reports",
  "split-tenders":"Split Tenders", reimbursements:"Reimbursements",
};

function AppShell() {
  const mobile = useMobile();
  const [route, setRoute] = useState(() => {
    const hash = window.location.hash.slice(1);
    if (hash && PAGE_TITLE[hash]) return hash;
    return localStorage.getItem("sw_route") || "dashboard";
  });
  const [expModal, setExpModal] = useState<{open:boolean; expense?:Expense}>({open:false});
  const [showMore, setShowMore] = useState(false);
  const [expNavFilters, setExpNavFilters] = useState<NavFilters|null>(null);

  const goTo = (r:string) => {
    setRoute(r);
    localStorage.setItem("sw_route", r);
    window.history.pushState({ route: r }, '', '#' + r);
    window.scrollTo(0, 0);
    setShowMore(false);
  };
  const openExpense = (e?:Expense) => setExpModal({open:true, expense:e});
  const drillTo = (f:NavFilters) => { setExpNavFilters(f); goTo("expenses"); };

  useEffect(() => {
    window.history.replaceState({ route }, '', '#' + route);
    const onPop = (e: PopStateEvent) => {
      const r = (e.state?.route as string) || window.location.hash.slice(1) || "dashboard";
      const valid = PAGE_TITLE[r] ? r : "dashboard";
      setRoute(valid);
      localStorage.setItem("sw_route", valid);
      setExpModal({ open: false });
      setShowMore(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const screens: Record<string,React.ReactNode> = {
    dashboard:       <Dashboard onAdd={openExpense} goTo={goTo} />,
    budgets:         <BudgetsScreen />,
    expenses:        <ExpensesScreen onOpenExpense={openExpense} navFilters={expNavFilters??undefined} onNavFiltersConsumed={()=>setExpNavFilters(null)} />,
    categories:      <CategoriesScreen />,
    sources:         <SourcesScreen />,
    "split-tenders": <SplitTendersScreen />,
    reimbursements:  <ReimbursementsScreen />,
    analytics:       <AnalyticsScreen onDrillTo={drillTo} />,
    reports:         <ReportsScreen />,
  };

  const moreActive = MORE_IDS.includes(route);

  return (
    <div style={{ minHeight:"100vh", display:"flex", background:T.cream, fontFamily:"'Plus Jakarta Sans',sans-serif" }}>

      {/* ── Desktop sidebar ── */}
      {!mobile && (
        <aside style={{ width:240, flexShrink:0, borderRight:`1px solid ${T.line}`, background:T.paper, position:"sticky", top:0, height:"100vh", overflowY:"auto", display:"flex", flexDirection:"column" }}>
          <div style={{ padding:"20px 16px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:9 }}>
              <div style={{ width:33, height:33, borderRadius:10, background:T.primary, display:"grid", placeItems:"center", fontSize:17 }}>🐷</div>
              <span style={{ fontWeight:800, fontSize:18, color:T.ink, letterSpacing:"-.02em" }}>{appConfig.app.name}</span>
            </div>
          </div>
          <nav style={{ flex:1, padding:"0 8px", display:"flex", flexDirection:"column", gap:2 }}>
            {NAV.map(n=>{ const a=route===n.id; return (
              <button key={n.id} onClick={()=>goTo(n.id)}
                style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:12, border:"none", cursor:"pointer",
                         background:a?T.primaryS:"transparent", color:a?T.primary:T.muted, fontWeight:600, fontSize:13,
                         transition:"all .15s", textAlign:"left", width:"100%", fontFamily:"inherit" }}>
                <span style={{ fontSize:16 }}>{n.emoji}</span>{n.label}
              </button>
            ); })}
          </nav>
        </aside>
      )}

      {/* ── Main column ── */}
      <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column" }}>

        {/* Desktop top bar */}
        {!mobile && (
          <header style={{ position:"sticky", top:0, zIndex:30, display:"flex", alignItems:"center", padding:"12px 32px", background:"#FAF7F4CC", backdropFilter:"blur(10px)", borderBottom:`1px solid ${T.line}` }}>
            <div style={{ marginLeft:"auto" }}>
              <Btn size="sm" onClick={()=>openExpense()}>+ Quick add</Btn>
            </div>
          </header>
        )}

        {/* Mobile top bar */}
        {mobile && (
          <header className="sw-header-mobile" style={{ position:"sticky", top:0, zIndex:30, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px 12px", background:T.paper, borderBottom:`1px solid ${T.line}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:28, height:28, borderRadius:9, background:T.primary, display:"grid", placeItems:"center", fontSize:14 }}>🐷</div>
              <span style={{ fontWeight:800, fontSize:16, color:T.ink, letterSpacing:"-.02em" }}>{appConfig.app.name}</span>
            </div>
            <span style={{ fontWeight:700, fontSize:14, color:T.muted }}>{PAGE_TITLE[route]}</span>
          </header>
        )}

        <main className={mobile?"sw-main-mobile":""} style={{ flex:1, padding:mobile?"14px 14px 0":"22px 32px 40px", maxWidth:1280, width:"100%", margin:"0 auto" }}>
          {screens[route]||screens.dashboard}
        </main>
      </div>

      {/* ── Mobile bottom navigation ── */}
      {mobile && (
        <>
          {showMore && (
            <div style={{ position:"fixed", inset:0, zIndex:60 }} onClick={()=>setShowMore(false)}>
              <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.35)", backdropFilter:"blur(3px)" }} />
              <div onClick={e=>e.stopPropagation()}
                className="sw-more-drawer" style={{ position:"absolute", left:12, right:12, background:T.paper, borderRadius:22, padding:"16px 8px", boxShadow:"0 -4px 32px rgba(0,0,0,.12)" }}>
                <p style={{ fontSize:11, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:".08em", padding:"0 12px 10px" }}>More</p>
                {MORE_NAV.map(n=>{ const a=route===n.id; return (
                  <button key={n.id} onClick={()=>goTo(n.id)}
                    style={{ display:"flex", alignItems:"center", gap:14, padding:"13px 16px", borderRadius:14, border:"none", cursor:"pointer",
                             background:a?T.primaryS:"transparent", color:a?T.primary:T.ink, fontWeight:600, fontSize:15,
                             width:"100%", fontFamily:"inherit" }}>
                    <span style={{ fontSize:22 }}>{n.emoji}</span>{n.label}
                  </button>
                ); })}
              </div>
            </div>
          )}

          <nav className="sw-nav" style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:50, background:T.paper, borderTop:`1px solid ${T.line}`, display:"flex", alignItems:"center" }}>
            {[...LEFT_TABS, ...RIGHT_TABS].map((tab) => {
              const a = route === tab.id && !moreActive;
              const isCenter = tab.id === "budgets"; // FAB goes before budgets
              return (
                <React.Fragment key={tab.id}>
                  {isCenter && (
                    <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <button onClick={()=>openExpense()}
                        style={{ width:46, height:46, borderRadius:99, background:T.primary, border:"none", cursor:"pointer",
                                 display:"grid", placeItems:"center", fontSize:22, color:"#fff",
                                 boxShadow:`0 4px 16px ${T.primary}66`, marginBottom:2 }}>
                        +
                      </button>
                    </div>
                  )}
                  <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
                    <button onClick={()=>goTo(tab.id)}
                      style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"5px 6px", border:"none",
                               background:"transparent", cursor:"pointer", color:a?T.primary:T.faint, fontFamily:"inherit", minWidth:44 }}>
                      <span style={{ fontSize:19 }}>{tab.emoji}</span>
                      <span style={{ fontSize:9, fontWeight:700 }}>{tab.label}</span>
                    </button>
                  </div>
                </React.Fragment>
              );
            })}
            <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
              <button onClick={()=>setShowMore(p=>!p)}
                style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"5px 6px", border:"none",
                         background:"transparent", cursor:"pointer", color:(moreActive||showMore)?T.primary:T.faint, fontFamily:"inherit", minWidth:44 }}>
                <span style={{ fontSize:19 }}>☰</span>
                <span style={{ fontSize:9, fontWeight:700 }}>More</span>
              </button>
            </div>
          </nav>
        </>
      )}

      <ExpenseFormModal
        open={expModal.open}
        onClose={()=>setExpModal({open:false})}
        expense={expModal.expense}
      />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%}
        body{font-family:'Plus Jakarta Sans',sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior:none}
        select,input,button{font-family:'Plus Jakarta Sans',sans-serif}
        button{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
        .sw-nav{
          min-height:64px;
          padding-top:8px;
          padding-bottom:max(8px,env(safe-area-inset-bottom,0px));
        }
        .sw-header-mobile{
          padding-top:max(14px,calc(env(safe-area-inset-top,0px) + 10px)) !important;
        }
        .sw-more-drawer{
          bottom:calc(max(0px,env(safe-area-inset-bottom,0px)) + 72px);
        }
        .sw-main-mobile{
          padding-bottom:calc(max(0px,env(safe-area-inset-bottom,0px)) + 88px) !important;
        }
        @media(max-width:767px){
          .sw-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
          /* iOS Safari auto-zooms when a focused control has font-size < 16px.
             Force 16px on mobile so tapping a field never zooms the page. */
          input,select,textarea{font-size:16px !important}
        }
        /* Never let any screen scroll sideways on mobile. */
        html,body{max-width:100%;overflow-x:hidden}
      `}</style>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <DataProvider>
      <AppShell />
    </DataProvider>
  );
}
