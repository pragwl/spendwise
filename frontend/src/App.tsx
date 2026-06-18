import React, { useState, useEffect, useRef } from "react";
import { expensesApi } from "./api/expenses";
import type { Expense, Budget, Category, PaymentSource, SplitTender, BudgetSplitTenderAllocation } from "./types";
import { config as appConfig } from "./config";
import { DataProvider, useData } from "./context/DataContext";
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area,
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
const getTodaySafe = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
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

function calcBurnMetrics(amt: number, used: number, startDate: string, endDate: string) {
  const today       = getTodaySafe();
  const start       = getSafeDate(startDate);
  const end         = getSafeDate(endDate);
  // +1 added for inclusive days calculation
  const totalDays   = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const elapsedDays = Math.max(1, Math.min(totalDays, Math.round((today.getTime() - start.getTime()) / 86400000) + 1));
  const remainDays  = Math.max(0, totalDays - elapsedDays);
  
  const rem         = Math.max(0, amt - used);
  const plannedBurn = amt / totalDays;
  const actualBurn  = used / elapsedDays;
  const variancePct = plannedBurn > 0 ? ((actualBurn - plannedBurn) / plannedBurn) * 100 : 0;
  const forecast    = used + actualBurn * remainDays;
  const runwayDays  = actualBurn > 0 ? rem / actualBurn : null;
  const fmtRunway   = (d: number | null) => {
    if (d === null) return "—";
    if (d < 14)     return `${Math.round(d)} day${Math.round(d) !== 1 ? "s" : ""}`;
    if (d < 60)     return `${(d / 7).toFixed(1)} wk`;
    return `${(d / 30.44).toFixed(1)} mo`;
  };
  return [
    { label:"Planned burn rate",    value:`${fmt(plannedBurn)}/day`,   hi:false, tip:"How much you should spend each day to use this budget evenly by the end date." },
    { label:"Actual burn rate",     value:`${fmt(actualBurn)}/day`,    hi:false, tip:"How much you're actually spending per day on average since the budget started." },
    { label:"Burn rate variance",   value:`${variancePct >= 0 ? "+" : ""}${variancePct.toFixed(1)}%`, hi:variancePct > 10, tip:"How far off your spending pace is. Positive means you're spending faster than planned; negative means slower." },
    { label:"Remaining budget",     value:fmt(rem),                    hi:false, tip:"How much money is left in this budget right now." },
    { label:"Forecasted end spend", value:fmt(forecast),               hi:false, tip:"If you keep spending at today's daily rate, this is the total you'll have spent by the budget's end date." },
    { label:"Runway",               value:fmtRunway(runwayDays),       hi:false, tip:"How long the remaining budget will last if you continue spending at your current rate." },
  ];
}

function calcSpendingGuidance(amt: number, used: number, startDate: string, endDate: string, txCount?: number) {
  const today       = getTodaySafe();
  const start       = getSafeDate(startDate);
  const end         = getSafeDate(endDate);
  
  const totalDays   = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const elapsedDays = Math.max(1, Math.min(totalDays, Math.round((today.getTime() - start.getTime()) / 86400000) + 1));
  const remainDays  = Math.max(0, totalDays - elapsedDays);
  
  const rem         = Math.max(0, amt - used);
  const over        = Math.max(0, used - amt);
  const actualBurn  = used / elapsedDays;
  const forecast    = used + actualBurn * remainDays;
  // Safe daily limit: how much can be spent per remaining day without exceeding budget
  const safeDailyLimit   = remainDays > 0 ? rem / remainDays : 0;
  const safeWeeklyLimit  = safeDailyLimit * 7;
  // How much the current daily pace needs to drop to stay within budget
  const cutNeeded        = remainDays > 0 ? Math.max(0, actualBurn - safeDailyLimit) : 0;
  // Projected overshoot if current pace continues
  const projectedOver    = Math.max(0, forecast - amt);
  // Pace: % of budget used vs % of period elapsed
  const pctTimeElapsed   = (elapsedDays / totalDays) * 100;
  const pctBudgetUsed    = amt > 0 ? (used / amt) * 100 : 0;
  const paceGap          = pctBudgetUsed - pctTimeElapsed;
  // Transactions remaining
  const avgTx            = txCount && txCount > 0 ? used / txCount : 0;
  const txsRemaining     = avgTx > 0 && rem > 0 ? Math.floor(rem / avgTx) : null;
  
  return { safeDailyLimit, safeWeeklyLimit, cutNeeded, projectedOver, paceGap, pctBudgetUsed, pctTimeElapsed, actualBurn, remainDays, rem, over, avgTx, txsRemaining };
}

function isTenderAlerted(ta: BudgetSplitTenderAllocation): boolean {
  if (ta.threshold == null || !ta.allocatedAmount) return false;
  return (ta.spentAmount / ta.allocatedAmount) * 100 >= ta.threshold;
}

function computeCategoryBreakdown(expenses: Expense[]) {
  const map = new Map<string, { category: Category | null; total: number; count: number }>();
  for (const e of expenses) {
    const key = e.categoryId || "__none__";
    const ex = map.get(key);
    if (ex) { ex.total += Number(e.amount); ex.count++; }
    else map.set(key, { category: e.category || null, total: Number(e.amount), count: 1 });
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function computeSourceBreakdown(expenses: Expense[]) {
  const map = new Map<string, { source: PaymentSource | null; total: number; count: number }>();
  for (const e of expenses) {
    const key = e.sourceId || "__none__";
    const ex = map.get(key);
    if (ex) { ex.total += Number(e.amount); ex.count++; }
    else map.set(key, { source: e.source || null, total: Number(e.amount), count: 1 });
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
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
function ThresholdInfo({ alerts, children }: { alerts: BudgetSplitTenderAllocation[]; children: React.ReactNode }) {
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
              <div key={ta.splitTenderId} style={{ marginTop:6 }}>
                <p style={{ fontWeight:600 }}>{ta.splitTenderName}</p>
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
  { id:"analytics",     label:"Analytics",       emoji:"📊" },
  { id:"reports",       label:"Reports",         emoji:"📁" },
];

// ── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ onAdd, goTo }: { onAdd:()=>void; goTo:(r:string)=>void }) {
  const mobile = useMobile();
  const { budgets, budgetsLoading } = useData();
  const [scopedExp, setScopedExp] = useState<Expense[]>([]);
  const [selBudgetId, setSelBudgetId] = useState("");

  const active = budgets.filter(b => b.status === "active");
  const selectedBudget = selBudgetId ? active.find(b => b.id === selBudgetId) : null;

  // Spending data is scoped to the selected budget, or all active budgets by default
  useEffect(() => {
    const ids = selBudgetId ? [selBudgetId] : active.map(b => b.id);
    if (ids.length === 0) { setScopedExp([]); return; }
    Promise.all(ids.map(id => expensesApi.getAll({ budgetId:id, limit:1000 }).then(r=>r.data??[])))
      .then(arrs => setScopedExp(arrs.flat()))
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selBudgetId, budgets]);

  // Aggregate or single-budget metrics
  const totalBud = active.reduce((s,b) => s + Number(b.amount || 0), 0);
  const totalSp  = active.reduce((s,b) => s + Number(b.usedAmount || 0), 0);
  const budAmt   = selectedBudget ? Number(selectedBudget.amount || 0) : totalBud;
  const budSp    = selectedBudget ? Number(selectedBudget.usedAmount || 0) : totalSp;
  const left       = Math.max(0, budAmt - budSp);
  const overBudget = Math.max(0, budSp - budAmt);
  const pct        = budAmt ? (budSp / budAmt) * 100 : 0;
  const h          = health(pct);

  const alertedTenders = selectedBudget
    ? (selectedBudget.tenderAnalytics || []).filter(isTenderAlerted)
    : active.flatMap(b => (b.tenderAnalytics || []).filter(isTenderAlerted));

  const overviewTone = overBudget > 0 ? "danger" : alertedTenders.length > 0 ? "warn" : h.tone;

  // Category breakdown, recent list, and monthly trend — all from the scoped expenses
  const cats = computeCategoryBreakdown(scopedExp);
  const filteredRecent = [...scopedExp]
    .sort((a,b) => getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime())
    .slice(0, 5);

  const MONTHS = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const trendMap = new Map<string, number>();
  for (const e of scopedExp) {
    const k = e.date.slice(0, 7);
    trendMap.set(k, (trendMap.get(k) || 0) + Number(e.amount));
  }
  const trendData = [...trendMap.keys()].sort().slice(-6).map(k => {
    const [, m] = k.split("-").map(Number);
    return { month: MONTHS[m], spend: trendMap.get(k)! };
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
          <div key={ta.splitTenderId} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:8, marginBottom:4, flexWrap:"wrap" }}>
            <span style={{ fontSize:12, color:T.warn, fontWeight:600 }}>· {ta.splitTenderName}</span>
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

    {/* Active budgets grid (only when no budget selected) */}
    {!selectedBudget && active.length > 0 && (
      <div style={{ marginBottom:18 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <span style={{ fontWeight:700, fontSize:16, color:T.ink }}>Active budgets</span>
          <button onClick={()=>goTo("budgets")} style={{ fontSize:12, fontWeight:700, color:T.primary, background:"none", border:"none", cursor:"pointer" }}>View all →</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr":"repeat(auto-fill,minmax(260px,1fr))", gap:12 }}>
          {active.map(b => {
            const amt = Number(b.amount || 0);
            const used = Number(b.usedAmount || 0);
            const rem  = Math.max(0, amt - used);
            const over = Math.max(0, used - amt);
            const p    = amt ? (used/amt)*100 : 0;
            const hh   = health(p);
            const budgetAlerts = (b.tenderAnalytics || []).filter(isTenderAlerted);
            const cardTone   = over > 0 ? "danger" : budgetAlerts.length > 0 ? "warn" : hh.tone;
            return (
              <Card key={b.id}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:10, height:36, borderRadius:99, background:b.color||T.primary, flexShrink:0 }} />
                    <div>
                      <p style={{ fontSize:14, fontWeight:700, color:T.ink }}>{b.name}</p>
                      {b.description && <p style={{ fontSize:11, color:T.muted }}>{b.description}</p>}
                    </div>
                  </div>
                  <ThresholdInfo alerts={over > 0 ? [] : budgetAlerts}>
                    <Badge tone={cardTone}>
                      {over > 0 ? "Over budget" : budgetAlerts.length > 0 ? `⚠️ ${budgetAlerts.length} threshold` : hh.label}
                    </Badge>
                  </ThresholdInfo>
                </div>
                <div style={{
                  display:"flex", justifyContent:"space-between", alignItems:"flex-end",
                  borderRadius: cardTone !== hh.tone ? 12 : 0,
                  background:   cardTone !== hh.tone ? toneS[cardTone] : "transparent",
                  border:       cardTone !== hh.tone ? `1.5px solid ${toneC[cardTone]}44` : "none",
                  padding:      cardTone !== hh.tone ? "10px 12px" : "0 0 8px",
                  marginBottom: 8,
                }}>
                  <div>
                    <p style={{ fontSize:11, color: cardTone !== hh.tone ? toneC[cardTone] : T.muted, display:"flex", alignItems:"center" }}>
                      {over > 0 ? "Over budget" : "Remaining"}
                      <KpiInfo text={over > 0 ? "This budget has been exceeded. This is how much over the limit you are." : "How much money is still available in this budget."} />
                    </p>
                    <p style={{ fontWeight:800, fontSize: cardTone !== hh.tone ? (mobile?20:26) : (mobile?18:22), color: toneC[cardTone], lineHeight:1.1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {over > 0 ? fmt(over) : fmt(rem)}
                    </p>
                    {over > 0 && <p style={{ fontSize:10, color:T.danger, marginTop:3, fontWeight:600 }}>₹0 remaining</p>}
                    {over === 0 && budgetAlerts.length > 0 && (
                      <p style={{ fontSize:10, color:T.warn, marginTop:3, fontWeight:600 }}>
                        ⚠️ {budgetAlerts.length} tender{budgetAlerts.length > 1 ? "s" : ""} hit threshold
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <p style={{ fontSize:11, color:T.muted, display:"flex", alignItems:"center" }}>Spent<KpiInfo text="Total amount spent against this budget so far." /></p>
                    <p style={{ fontSize:13, fontWeight:700, color:T.ink }}>{fmt(used)}</p>
                    <p style={{ fontSize:10, color:T.faint }}>of {fmt(amt)}</p>
                  </div>
                </div>
                <Progress pct={p} tone={cardTone} h={8} />
                <p style={{ fontSize:11, color:T.faint, marginTop:5, display:"flex", alignItems:"center" }}>{Math.round(p)}% used<KpiInfo text="What share of this budget's total amount has been spent so far." /></p>
                  {(() => {
                  const dg = calcSpendingGuidance(amt, used, b.startDate, b.endDate, b._count?.expenses);
                  if (!dg.remainDays || p < 60) return null;
                  const alertColor = dg.projectedOver > 0 || over > 0 ? T.danger : T.warn;
                  const alertBg    = dg.projectedOver > 0 || over > 0 ? T.dangerS : T.warnS;
                  const vSize      = mobile ? 14 : 17;
                  const tPad       = mobile ? "8px 10px" : "10px 12px";
                  const GuideTile  = ({ bg=T.paper, border=`1px solid ${T.line}`, label, labelColor=T.muted, value, valueColor=T.ink, sub, tip }: { bg?:string; border?:string; label:string; labelColor?:string; value:string; valueColor?:string; sub:string; tip:string }) => (
                    <div style={{ background:bg, borderRadius:10, padding:tPad, border, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:3, marginBottom:4 }}>
                        <p style={{ fontSize:10, color:labelColor, fontWeight:700, textTransform:"uppercase", letterSpacing:".03em", lineHeight:1.3, flex:1 }}>{label}</p>
                        <InfoTip text={tip} />
                      </div>
                      <p style={{ fontSize:vSize, fontWeight:800, color:valueColor, lineHeight:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{value}</p>
                      <p style={{ fontSize:10, color:T.faint, marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sub}</p>
                    </div>
                  );
                  return (
                    <div style={{ marginTop:14, borderRadius:12, border:`1.5px solid ${alertColor}44`, background:alertBg, padding:mobile?"10px 12px":"12px 14px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap" }}>
                        <span style={{ fontSize:mobile?11:13, fontWeight:700, color:alertColor }}>🎯 Spending limits to stay on budget</span>
                        <InfoTip text="These figures show how much you can afford to spend going forward without exceeding your total budget by the end date." />
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:mobile?6:8 }}>
                        <GuideTile
                          label="Max per day" labelColor={dg.cutNeeded > 0 ? T.danger : T.sage}
                          value={dg.safeDailyLimit > 0 ? `${fmt(dg.safeDailyLimit)}/d` : "₹0"}
                          valueColor={dg.cutNeeded > 0 ? T.danger : T.sage}
                          sub={`${Math.round(dg.remainDays)} days left`}
                          tip={`Remaining (${fmt(dg.rem)}) ÷ ${Math.round(dg.remainDays)} days left. Stay at or below this daily to avoid going over budget.`} />
                        <GuideTile
                          label="Max per week"
                          value={dg.safeWeeklyLimit > 0 ? fmt(dg.safeWeeklyLimit) : "₹0"}
                          sub="weekly target"
                          tip="Safe daily limit × 7. Use this as your weekly budget target so you don't need to check numbers every day." />
                        {dg.cutNeeded > 0 && (
                          <GuideTile
                            bg={T.warnS} border={`1px solid ${T.warn}44`}
                            label="Reduce daily by" labelColor={T.warn}
                            value={`${fmt(dg.cutNeeded)}/d`} valueColor={T.warn}
                            sub={`vs ${fmt(dg.actualBurn)}/d pace`}
                            tip={`Your current pace is ${fmt(dg.actualBurn)}/day. Cut by ${fmt(dg.cutNeeded)}/day to reach the safe limit.`} />
                        )}
                        {dg.projectedOver > 0 && (
                          <GuideTile
                            bg={T.dangerS} border={`1px solid ${T.danger}44`}
                            label="Overshoot risk" labelColor={T.danger}
                            value={`+${fmt(dg.projectedOver)}`} valueColor={T.danger}
                            sub="at current pace"
                            tip="If you keep spending at today's daily rate until the end date, you will exceed the total budget by this amount." />
                        )}
                        <GuideTile
                          bg={dg.paceGap > 15 ? T.dangerS : dg.paceGap > 5 ? T.warnS : T.sageS}
                          border={`1px solid ${dg.paceGap > 15 ? T.danger : dg.paceGap > 5 ? T.warn : T.sage}44`}
                          label="Pace vs plan" labelColor={dg.paceGap > 15 ? T.danger : dg.paceGap > 5 ? T.warn : T.sage}
                          value={`${dg.paceGap >= 0 ? "+" : ""}${dg.paceGap.toFixed(0)}%`}
                          valueColor={dg.paceGap > 5 ? T.danger : T.sage}
                          sub={`${Math.round(dg.pctBudgetUsed)}% budget · ${Math.round(dg.pctTimeElapsed)}% time`}
                          tip={`You have used ${Math.round(dg.pctBudgetUsed)}% of the budget but ${Math.round(dg.pctTimeElapsed)}% of the time has passed. Positive = spending ahead of pace.`} />
                        {dg.txsRemaining !== null && (
                          <GuideTile
                            label="Purchases left"
                            value={`~${dg.txsRemaining}`}
                            sub={`avg ${fmt(dg.avgTx)}/tx`}
                            tip={`Based on your average transaction of ${fmt(dg.avgTx)}, you can make about ${dg.txsRemaining} more purchases before exhausting this budget.`} />
                        )}
                      </div>

                      {/* Per-tender limits — only for tenders at risk (TIME INDEPENDENT) */}
                      {b.tenderAnalytics && b.tenderAnalytics.length > 0 && (() => {
                        const atRisk = b.tenderAnalytics!.filter(ta => {
                          const tPct = ta.allocatedAmount > 0 ? (ta.spentAmount / ta.allocatedAmount) * 100 : 0;
                          const isOverThreshold = ta.threshold != null ? tPct >= ta.threshold : tPct >= 90;
                          return isOverThreshold || ta.spentAmount > ta.allocatedAmount;
                        });
                        
                        if (atRisk.length === 0) return null;
                        
                        return (
                          <div style={{ marginTop:10 }}>
                            <p style={{ fontSize:11, fontWeight:700, color:alertColor, textTransform:"uppercase", letterSpacing:".04em", marginBottom:6 }}>Per tender</p>
                            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                              {atRisk.map(ta => {
                                const tOver  = Math.max(0, ta.spentAmount - ta.allocatedAmount);
                                const tRem   = Math.max(0, ta.allocatedAmount - ta.spentAmount);
                                const tPct   = ta.allocatedAmount > 0 ? (ta.spentAmount / ta.allocatedAmount) * 100 : 0;
                                const tShare = used > 0 ? (ta.spentAmount / used) * 100 : 0;
                                const tTone  = tOver > 0 ? "danger" : "warn";
                                
                                return (
                                  <div key={ta.splitTenderId} style={{ background:T.paper, borderRadius:10, padding:mobile?"8px 10px":"10px 12px", border:`1px solid ${toneC[tTone]}33` }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                                      <span style={{ fontSize:11 }}>{tOver > 0 ? "🔴" : "⚠️"}</span>
                                      <span style={{ fontSize:12, fontWeight:700, color:T.ink, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ta.splitTenderName}</span>
                                      <span style={{ fontSize:10, color:T.faint }}>{fmt(ta.spentAmount)} / {fmt(ta.allocatedAmount)}</span>
                                    </div>
                                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:mobile?4:6 }}>
                                      {/* 1. Remaining / Over Limit */}
                                      <div style={{ minWidth:0 }}>
                                        <p style={{ fontSize:9, color:toneC[tTone], fontWeight:700, textTransform:"uppercase" }}>{tOver > 0 ? "Over Limit" : "Remaining"}</p>
                                        <p style={{ fontSize:mobile?12:13, fontWeight:800, color:toneC[tTone], overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{tOver > 0 ? `+${fmt(tOver)}` : fmt(tRem)}</p>
                                      </div>
                                      {/* 2. Share of total budget spending */}
                                      <div style={{ minWidth:0 }}>
                                        <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                                          <p style={{ fontSize:9, color:T.muted, fontWeight:700, textTransform:"uppercase" }}>Spend Share</p>
                                          <InfoTip text={`Out of the ${fmt(used)} you've spent across this entire budget, ${Math.round(tShare)}% was paid using ${ta.splitTenderName}.`} />
                                        </div>
                                        <p style={{ fontSize:mobile?12:13, fontWeight:800, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{Math.round(tShare)}%</p>
                                      </div>
                                      {/* 3. Tender usage / Exhaustion */}
                                      <div style={{ minWidth:0 }}>
                                        <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                                          <p style={{ fontSize:9, color:T.muted, fontWeight:700, textTransform:"uppercase" }}>Alloc. Used</p>
                                          <InfoTip text={`You have exhausted ${Math.round(tPct)}% of the limit assigned specifically to ${ta.splitTenderName}.`} />
                                        </div>
                                        <p style={{ fontSize:mobile?12:13, fontWeight:800, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{Math.round(tPct)}%</p>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {b.tenderAnalytics && b.tenderAnalytics.length > 0 && (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))", gap:7, marginTop:10 }}>
                    {b.tenderAnalytics.map(ta => {
                      const tRem  = Math.max(0, ta.allocatedAmount - ta.spentAmount);
                      const tOver = Math.max(0, ta.spentAmount - ta.allocatedAmount);
                      const tal   = isTenderAlerted(ta);
                      const tTone = tOver > 0 ? "danger" : tal ? "warn" : "sky";
                      return (
                        <div key={ta.splitTenderId} style={{ borderRadius:10, background:toneS[tTone]||T.raised, padding:"8px 10px", border:`1px solid ${toneC[tTone]||T.line}44` }}>
                          <p style={{ fontSize:10, color:toneC[tTone]||T.muted, marginBottom:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {tOver > 0 ? "🔴" : tal ? "⚠️" : "🗂️"} {ta.splitTenderName}
                          </p>
                          <p style={{ fontSize:14, fontWeight:800, color:toneC[tTone]||T.ink, lineHeight:1 }}>
                            {tOver > 0 ? fmt(tOver) : fmt(tRem)}
                          </p>
                          <p style={{ fontSize:10, color:toneC[tTone]||T.faint }}>
                            {tOver > 0 ? "over" : "left"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
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
  </div>;
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
  const { expenses, expensesLoading, deleteExpense, categories, budgets, sources, setExpenseFilters } = useData();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<ExpFilters>(defaultExpFilters);
  const [localExp, setLocalExp] = useState<Expense[]|null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [activeDowFilter, setActiveDowFilter] = useState<number|null>(null);
  const [navLabel, setNavLabel] = useState("");
  const [navCostType, setNavCostType]     = useState<"fixed"|"variable"|null>(null);
  const [navUnbudgeted, setNavUnbudgeted] = useState(false);
  const [navSpikeDates, setNavSpikeDates] = useState<Set<string>|null>(null);

  const activeBudgets = budgets.filter(b => b.status === "active");

  // Reset filters on mount; if arriving via drill-through, apply navFilters
  useEffect(() => {
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
        limit: 1000, sortBy:"date" as const, order:"desc" as const,
        categoryId: navFilters.categoryId || undefined,
        sourceId:   navFilters.sourceId   || undefined,
        startDate:  navFilters.startDate  || undefined,
        endDate:    navFilters.endDate    || undefined,
      };

      if (navFilters.budgetIds && navFilters.budgetIds.length > 1) {
        // Multi-budget: parallel fetch per budget, then merge
        setLocalLoading(true);
        Promise.all(navFilters.budgetIds.map(id =>
          expensesApi.getAll({ ...apiFilters, budgetId:id }).then(r => r.data ?? [])
        )).then(arrs => {
          const merged = arrs.flat().sort((a,b) => getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime());
          setLocalExp(merged);
        }).catch(console.error)
          .finally(() => setLocalLoading(false));
      } else {
        // Single budget or none: let DataContext handle it
        setExpenseFilters({ ...apiFilters, budgetId: singleBudget || undefined });
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

    {(expensesLoading || localLoading) ? <Spinner /> : (
      <Card>
        {filtered.length === 0 && <p style={{ fontSize:13, color:T.muted, padding:8 }}>No expenses found.</p>}
        {filters.sortBy === "amount" ? (
          // Flat list sorted by amount
          [...filtered].sort((a,b)=>filters.order==="asc"?Number(a.amount)-Number(b.amount):Number(b.amount)-Number(a.amount)).map(e=>(
            <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:`1px solid ${T.line}` }}>
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
                <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:`1px solid ${T.line}` }}>
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
      </Card>
    )}
  </div>;
}

// ── EXPENSE FORM MODAL (add + edit) ───────────────────────────────────────
function ExpenseFormModal({ open, onClose, expense }: { open:boolean; onClose:()=>void; expense?:Expense }) {
  const { categories, budgets, sources, splitTenders, createExpense, updateExpense, updateSource } = useData();
  const mobile = useMobile();
  const isEdit = !!expense;
  const blank = { title:"", amount:"", date:getTodaySafe().toISOString().slice(0,10), categoryId:"", budgetId:"", sourceId:"", notes:"", costType:"variable" as "fixed"|"variable" };
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
      sf(expense ? {
        title:      expense.title,
        amount:     String(Number(expense.amount)),
        date:       toDateStr(expense.date),
        categoryId: expense.categoryId || "",
        budgetId:   expense.budgetId   || "",
        sourceId:   expense.sourceId   || "",
        notes:      expense.notes      || "",
        costType:   (expense.costType || "variable") as "fixed"|"variable",
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
      };
      if (isEdit) await updateExpense(expense!.id, payload);
      else         await createExpense(payload);

      if (!isEdit && selectedSource && selectedSource.balance != null) {
        await updateSource(selectedSource.id, { balance: Number(selectedSource.balance) + expAmt });
      }
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
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
          <Sel label="Budget" value={f.budgetId} onChange={e=>sf(p=>({...p,budgetId:e.target.value}))}>
            <option value="">No budget</option>
            {activeBudgets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </Sel>
          <Sel label="Paid with" value={f.sourceId} onChange={e=>sf(p=>({...p,sourceId:e.target.value}))}>
            <option value="">Select source</option>
            {sources.map(s=><option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </Sel>
        </div>

        {selectedSource && selectedSource.balance != null && f.amount && !isEdit && (
          <div style={{ padding:"10px 14px", borderRadius:12, background:T.primaryS, border:`1px solid ${T.primary}22`, fontSize:12, color:T.primary, fontWeight:600 }}>
            Total spent on {selectedSource.name}: {fmt(Number(selectedSource.balance) + Number(f.amount))}
          </div>
        )}

        {tenderWarning && <ErrMsg msg={tenderWarning} />}

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

function BudgetsScreen() {
  const mobile = useMobile();
  const { budgets, budgetsLoading, splitTenders, createBudget, updateBudget, deleteBudget } = useData();
  const [modal, setModal] = useState<{open:boolean; budget?:Budget}>({open:false});
  const [form, setForm] = useState<BudgetForm>(blankBudget);
  const [saving, setSaving] = useState(false);
  const isEdit = !!modal.budget;

  const computedTotal = form.tenders.reduce((s, t) => s + (Number(t.allocatedAmount) || 0), 0);

  // Sorted lists
  const sortedByCreated = [...budgets].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const activeBudgets   = sortedByCreated.filter(b => b.status === "active");
  const inactiveBudgets = sortedByCreated.filter(b => b.status !== "active");

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

  const renderBudgetRow = (b: Budget) => {
    const amt  = Number(b.amount || 0);
    const used = Number(b.usedAmount || 0);
    const rem  = Math.max(0, amt - used);
    const over = Math.max(0, used - amt);
    const p    = amt ? (used / amt) * 100 : 0;
    const hh   = health(p);

    const budgetAlerts = (b.tenderAnalytics || []).filter(isTenderAlerted);
    const rowTone     = over > 0 ? "danger" : budgetAlerts.length > 0 ? "warn" : hh.tone;
    const burnMetrics = calcBurnMetrics(amt, used, b.startDate, b.endDate);
    const showBlock   = over > 0 || budgetAlerts.length > 0;
    const txCount     = b._count?.expenses;
    const guide       = calcSpendingGuidance(amt, used, b.startDate, b.endDate, txCount);
    const showGuide   = guide.remainDays > 0 && (p >= 60 || guide.projectedOver > 0 || over > 0);
    return (
      <Card key={b.id} style={{ marginBottom:12, padding:"16px 18px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
          <div style={{ width:6, height:"100%", minHeight:40, borderRadius:99, background:b.color||T.primary, flexShrink:0, alignSelf:"stretch" }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8, flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <p style={{ fontSize:15, fontWeight:700, color:T.ink }}>{b.name}</p>
                  {b.status !== "active" && <Badge tone="sky">{b.status}</Badge>}
                </div>
                {b.description && <p style={{ fontSize:11, color:T.muted, marginTop:2 }}>{b.description}</p>}
                <p style={{ fontSize:11, color:T.faint, marginTop:2 }}>{toDateStr(b.startDate)} → {toDateStr(b.endDate)}</p>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <ThresholdInfo alerts={over > 0 ? [] : budgetAlerts}>
                  <Badge tone={rowTone}>
                    {over > 0 ? "Over budget" : budgetAlerts.length > 0 ? `⚠️ ${budgetAlerts.length} threshold` : hh.label}
                  </Badge>
                </ThresholdInfo>
                <IconBtn icon="✏️" onClick={()=>setModal({open:true,budget:b})} tone="primary" />
                <IconBtn icon="🗑️" onClick={()=>deleteBudget(b.id)} tone="danger" />
              </div>
            </div>
            {showBlock ? (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderRadius:10, background:toneS[rowTone], border:`1.5px solid ${toneC[rowTone]}44`, padding:"10px 14px", marginBottom:8, gap:8 }}>
                <div style={{ minWidth:0, flex:1 }}>
                  <p style={{ fontSize:10, fontWeight:700, color:toneC[rowTone], letterSpacing:".06em", textTransform:"uppercase" }}>
                    {over > 0 ? "Over budget" : "Remaining"}
                  </p>
                  <p style={{ fontSize:mobile?20:26, fontWeight:800, color:toneC[rowTone], lineHeight:1.1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {over > 0 ? fmt(over) : fmt(rem)}
                  </p>
                  {over > 0
                    ? <p style={{ fontSize:10, color:T.danger, marginTop:3 }}>₹0 remaining · {Math.round(p)}% used</p>
                    : <p style={{ fontSize:10, color:T.warn, marginTop:3 }}>⚠️ {budgetAlerts.length} threshold alert{budgetAlerts.length > 1 ? "s" : ""}</p>
                  }
                </div>
                <div style={{ textAlign:"right", fontSize:12, color:T.muted, flexShrink:0 }}>
                  <p style={{ fontWeight:600 }}>{fmt(used)} spent</p>
                  <p>of {fmt(amt)}</p>
                  {over === 0 && <p style={{ marginTop:4 }}>{Math.round(p)}% used</p>}
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:T.muted, marginBottom:6, gap:8, flexWrap:"wrap" }}>
                <span>{fmt(used)} spent</span>
                <span style={{ fontWeight:700, color:T.ink }}>{fmt(rem)} left of {fmt(amt)}</span>
              </div>
            )}
            <Progress pct={p} tone={rowTone} h={7} />
            <div style={{ display:"grid", gridTemplateColumns:mobile?"repeat(2,1fr)":"repeat(3,1fr)", gap:7, marginTop:10 }}>
              {burnMetrics.map(m => (
                <div key={m.label} style={{ background:T.cream, border:`1px solid ${T.line}`, borderRadius:10, padding:"8px 10px", position:"relative", minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:3, marginBottom:3 }}>
                    <p style={{ fontSize:10, color:T.muted, textTransform:"uppercase", letterSpacing:".03em", lineHeight:1.3, flex:1 }}>{m.label}</p>
                    <InfoTip text={m.tip} />
                  </div>
                  <p style={{ fontSize:mobile?12:13, fontWeight:700, color:m.hi ? T.danger : T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.value}</p>
                </div>
              ))}
            </div>
            {showGuide && (() => {
              const alertColor = guide.projectedOver > 0 || over > 0 ? T.danger : T.warn;
              const alertBg    = guide.projectedOver > 0 || over > 0 ? T.dangerS : T.warnS;
              const vSize      = mobile ? 14 : 17;
              const tPad       = mobile ? "8px 10px" : "10px 12px";
              const GuideTile  = ({ bg=T.paper, border=`1px solid ${T.line}`, label, labelColor=T.muted, value, valueColor=T.ink, sub, tip }: { bg?:string; border?:string; label:string; labelColor?:string; value:string; valueColor?:string; sub:string; tip:string }) => (
                <div style={{ background:bg, borderRadius:10, padding:tPad, border, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:3, marginBottom:4 }}>
                    <p style={{ fontSize:10, color:labelColor, fontWeight:700, textTransform:"uppercase", letterSpacing:".03em", lineHeight:1.3, flex:1 }}>{label}</p>
                    <InfoTip text={tip} />
                  </div>
                  <p style={{ fontSize:vSize, fontWeight:800, color:valueColor, lineHeight:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{value}</p>
                  <p style={{ fontSize:10, color:T.faint, marginTop:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sub}</p>
                </div>
              );
              return (
                <div style={{ marginTop:14, borderRadius:12, border:`1.5px solid ${alertColor}44`, background:alertBg, padding:mobile?"10px 12px":"12px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap" }}>
                    <span style={{ fontSize:mobile?11:13, fontWeight:700, color:alertColor }}>🎯 Spending limits to stay on budget</span>
                    <InfoTip text="These figures show how much you can afford to spend going forward without exceeding your total budget by the end date." />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:mobile?6:8 }}>
                    <GuideTile
                      label="Max per day" labelColor={guide.cutNeeded > 0 ? T.danger : T.sage}
                      value={guide.safeDailyLimit > 0 ? `${fmt(guide.safeDailyLimit)}/d` : "₹0"}
                      valueColor={guide.cutNeeded > 0 ? T.danger : T.sage}
                      sub={`${Math.round(guide.remainDays)} days left`}
                      tip={`Remaining (${fmt(guide.rem)}) ÷ ${Math.round(guide.remainDays)} days left. Stay at or below this daily to avoid going over budget.`} />
                    <GuideTile
                      label="Max per week"
                      value={guide.safeWeeklyLimit > 0 ? fmt(guide.safeWeeklyLimit) : "₹0"}
                      sub="weekly target"
                      tip="Safe daily limit × 7. Use this as your weekly budget target so you don't need to check numbers every day." />
                    {guide.cutNeeded > 0 && (
                      <GuideTile
                        bg={T.warnS} border={`1px solid ${T.warn}44`}
                        label="Reduce daily by" labelColor={T.warn}
                        value={`${fmt(guide.cutNeeded)}/d`} valueColor={T.warn}
                        sub={`vs ${fmt(guide.actualBurn)}/d pace`}
                        tip={`Your current pace is ${fmt(guide.actualBurn)}/day. Cut by ${fmt(guide.cutNeeded)}/day to reach the safe limit.`} />
                    )}
                    {guide.projectedOver > 0 && (
                      <GuideTile
                        bg={T.dangerS} border={`1px solid ${T.danger}44`}
                        label="Overshoot risk" labelColor={T.danger}
                        value={`+${fmt(guide.projectedOver)}`} valueColor={T.danger}
                        sub="at current pace"
                        tip="If you keep spending at today's daily rate until the end date, you will exceed the total budget by this amount." />
                    )}
                    <GuideTile
                      bg={guide.paceGap > 15 ? T.dangerS : guide.paceGap > 5 ? T.warnS : T.sageS}
                      border={`1px solid ${guide.paceGap > 15 ? T.danger : guide.paceGap > 5 ? T.warn : T.sage}44`}
                      label="Pace vs plan" labelColor={guide.paceGap > 15 ? T.danger : guide.paceGap > 5 ? T.warn : T.sage}
                      value={`${guide.paceGap >= 0 ? "+" : ""}${guide.paceGap.toFixed(0)}%`}
                      valueColor={guide.paceGap > 5 ? T.danger : T.sage}
                      sub={`${Math.round(guide.pctBudgetUsed)}% budget · ${Math.round(guide.pctTimeElapsed)}% time`}
                      tip={`You have used ${Math.round(guide.pctBudgetUsed)}% of the budget but ${Math.round(guide.pctTimeElapsed)}% of the time has passed. Positive = spending ahead of pace.`} />
                    {guide.txsRemaining !== null && (
                      <GuideTile
                        label="Purchases left"
                        value={`~${guide.txsRemaining}`}
                        sub={`avg ${fmt(guide.avgTx)}/tx`}
                        tip={`Based on your average transaction of ${fmt(guide.avgTx)}, you can make about ${guide.txsRemaining} more purchases before exhausting this budget.`} />
                    )}
                  </div>

                  {/* Per-tender limits — only for tenders at risk (TIME INDEPENDENT) */}
                  {b.tenderAnalytics && b.tenderAnalytics.length > 0 && (() => {
                    const atRisk = b.tenderAnalytics!.filter(ta => {
                      const tPct = ta.allocatedAmount > 0 ? (ta.spentAmount / ta.allocatedAmount) * 100 : 0;
                      const isOverThreshold = ta.threshold != null ? tPct >= ta.threshold : tPct >= 90;
                      return isOverThreshold || ta.spentAmount > ta.allocatedAmount;
                    });
                    
                    if (atRisk.length === 0) return null;
                    
                    return (
                      <div style={{ marginTop:10 }}>
                        <p style={{ fontSize:11, fontWeight:700, color:alertColor, textTransform:"uppercase", letterSpacing:".04em", marginBottom:6 }}>Per tender</p>
                        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                          {atRisk.map(ta => {
                            const tOver  = Math.max(0, ta.spentAmount - ta.allocatedAmount);
                            const tRem   = Math.max(0, ta.allocatedAmount - ta.spentAmount);
                            const tPct   = ta.allocatedAmount > 0 ? (ta.spentAmount / ta.allocatedAmount) * 100 : 0;
                            const tShare = used > 0 ? (ta.spentAmount / used) * 100 : 0;
                            const tTone  = tOver > 0 ? "danger" : "warn";
                            
                            return (
                              <div key={ta.splitTenderId} style={{ background:T.paper, borderRadius:10, padding:mobile?"8px 10px":"10px 12px", border:`1px solid ${toneC[tTone]}33` }}>
                                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                                  <span style={{ fontSize:11 }}>{tOver > 0 ? "🔴" : "⚠️"}</span>
                                  <span style={{ fontSize:12, fontWeight:700, color:T.ink, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ta.splitTenderName}</span>
                                  <span style={{ fontSize:10, color:T.faint }}>{fmt(ta.spentAmount)} / {fmt(ta.allocatedAmount)}</span>
                                </div>
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:mobile?4:6 }}>
                                  {/* 1. Remaining / Over Limit */}
                                  <div style={{ minWidth:0 }}>
                                    <p style={{ fontSize:9, color:toneC[tTone], fontWeight:700, textTransform:"uppercase" }}>{tOver > 0 ? "Over Limit" : "Remaining"}</p>
                                    <p style={{ fontSize:mobile?12:13, fontWeight:800, color:toneC[tTone], overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{tOver > 0 ? `+${fmt(tOver)}` : fmt(tRem)}</p>
                                  </div>
                                  {/* 2. Share of total budget spending */}
                                  <div style={{ minWidth:0 }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                                      <p style={{ fontSize:9, color:T.muted, fontWeight:700, textTransform:"uppercase" }}>Spend Share</p>
                                      <InfoTip text={`Out of the ${fmt(used)} you've spent across this entire budget, ${Math.round(tShare)}% was paid using ${ta.splitTenderName}.`} />
                                    </div>
                                    <p style={{ fontSize:mobile?12:13, fontWeight:800, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{Math.round(tShare)}%</p>
                                  </div>
                                  {/* 3. Tender usage / Exhaustion */}
                                  <div style={{ minWidth:0 }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                                      <p style={{ fontSize:9, color:T.muted, fontWeight:700, textTransform:"uppercase" }}>Alloc. Used</p>
                                      <InfoTip text={`You have exhausted ${Math.round(tPct)}% of the limit assigned specifically to ${ta.splitTenderName}.`} />
                                    </div>
                                    <p style={{ fontSize:mobile?12:13, fontWeight:800, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{Math.round(tPct)}%</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {b.tenderAnalytics && b.tenderAnalytics.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:10 }}>
                {b.tenderAnalytics.map(ta => {
                  const tp    = ta.allocatedAmount ? (ta.spentAmount/ta.allocatedAmount)*100 : 0;
                  const tRem  = Math.max(0, ta.allocatedAmount - ta.spentAmount);
                  const tOver = Math.max(0, ta.spentAmount - ta.allocatedAmount);
                  const al    = isTenderAlerted(ta);
                  const tTone = tOver > 0 ? "danger" : al ? "warn" : health(tp).tone;
                  return (
                    <div key={ta.splitTenderId} style={{ display:"flex", alignItems:"center", gap:mobile?6:8 }}>
                      <span style={{ fontSize:11, color:toneC[tTone]||T.muted, width:mobile?70:90, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flexShrink:0 }}>
                        {tOver > 0 ? "🔴" : al ? "⚠️" : "🗂️"} {ta.splitTenderName}
                      </span>
                      <div style={{ flex:1, minWidth:0 }}><Progress pct={tp} tone={tTone} h={5} /></div>
                      <div style={{ textAlign:"right", flexShrink:0, minWidth:mobile?80:100 }}>
                        <p style={{ fontSize:mobile?11:12, fontWeight:700, color:toneC[tTone]||T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {tOver > 0 ? `+${fmt(tOver)} over` : `${fmt(tRem)} left`}
                        </p>
                        <p style={{ fontSize:10, color:T.faint, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fmt(ta.spentAmount)}/{fmt(ta.allocatedAmount)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Budgets</h1>
      <Btn size="lg" onClick={()=>setModal({open:true})}>+ New budget</Btn>
    </div>

    {budgetsLoading ? <Spinner /> : (
      <>
        {activeBudgets.length > 0 && (
          <div style={{ marginBottom:24 }}>
            <p style={{ fontSize:12, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>Active</p>
            {activeBudgets.map(renderBudgetRow)}
          </div>
        )}
        {inactiveBudgets.length > 0 && (
          <div>
            <p style={{ fontSize:12, fontWeight:700, color:T.faint, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>Inactive / Completed</p>
            {inactiveBudgets.map(renderBudgetRow)}
          </div>
        )}
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
  </div>;
}

// ── CATEGORIES SCREEN ─────────────────────────────────────────────────────
const CAT_COLORS = ["#C2623F","#E8A838","#2E9E6B","#9B6DBF","#5B8FD4","#3BAF7E","#E07B5A","#4A90D9"];
const CAT_EMOJIS = ["🛒","🍔","🚗","🏠","🎮","💊","✈️","👗","📚","💡","🎬","☕","🐾","🎓","⚽","🎵","💼","🛠️","🌿","💰"];
type CatForm = { name:string; icon:string; color:string };
const blankCat: CatForm = { name:"", icon:"", color:"#C2623F" };

function CategoriesScreen() {
  const { categories, catsLoading, createCategory, updateCategory, deleteCategory } = useData();
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
type SrcForm = { name:string; type:string; icon:string; color:string; balance:string; splitTenderId:string };
const blankSrc: SrcForm = { name:"", type:"Cash", icon:"💵", color:"#5B8FD4", balance:"", splitTenderId:"" };
const SRC_TYPES = [{ value:"Cash", label:"💵 Cash" }, { value:"Wallet", label:"👛 Wallet" }];

function SourcesScreen() {
  const { sources, srcsLoading, splitTenders, createSource, updateSource, deleteSource } = useData();
  const [modal, setModal] = useState<{open:boolean; source?:PaymentSource}>({open:false});
  const [form, setForm] = useState<SrcForm>(blankSrc);
  const [saving, setSaving] = useState(false);
  const isEdit = !!modal.source;

  useEffect(()=>{
    if (modal.open) {
      if (modal.source) {
        setForm({
          name:          modal.source.name,
          type:          modal.source.type === "Cash" || modal.source.type === "Wallet" ? modal.source.type : "Cash",
          icon:          modal.source.icon    || "💵",
          color:         modal.source.color   || "#5B8FD4",
          balance:       modal.source.balance != null ? String(Number(modal.source.balance)) : "",
          splitTenderId: modal.source.splitTenderId || "",
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
        icon:          form.icon || undefined,
        color:         form.color || undefined,
        balance:       form.balance ? Number(form.balance) : null,
        splitTenderId: form.splitTenderId || undefined,
      };
      if (isEdit) await updateSource(modal.source!.id, payload);
      else         await createSource(payload);
      setModal({open:false});
    } catch(e:unknown) { alert(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  };

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Payment Sources</h1>
      <Btn size="lg" onClick={()=>setModal({open:true})}>+ New source</Btn>
    </div>
    {srcsLoading ? <Spinner /> : (
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
        {sources.map(s=>{
          const bal = s.balance != null ? Number(s.balance) : null;
          return (
          <Card key={s.id}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                <div style={{ width:44, height:44, borderRadius:13, background:(s.color||T.primary)+"22", display:"grid", placeItems:"center", fontSize:22, flexShrink:0 }}>{s.icon||"💳"}</div>
                <div>
                  <p style={{ fontWeight:700, color:T.ink, fontSize:14 }}>{s.name}</p>
                  <p style={{ fontSize:11, color:T.muted }}>{s.type||"—"}{s.splitTender ? ` · 🗂️ ${s.splitTender.name}` : ""}</p>
                </div>
              </div>
              <div style={{ display:"flex", gap:6, alignSelf:"flex-start" }}>
                <IconBtn icon="✏️" onClick={()=>setModal({open:true,source:s})} tone="primary" />
                <IconBtn icon="✕" onClick={()=>deleteSource(s.id)} tone="danger" />
              </div>
            </div>
            {bal != null && (
              <div style={{ marginBottom:6 }}>
                <p style={{ fontSize:11, color:T.muted }}>Total spent</p>
                <p style={{ fontSize:16, fontWeight:800, color:T.primary }}>{fmt(bal)}</p>
              </div>
            )}
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
        <Inp label="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. PhonePe Wallet" />
        <Sel label="Type" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
          {SRC_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
        </Sel>
        <Sel label="Split Tender" value={form.splitTenderId} onChange={e=>setForm(f=>({...f,splitTenderId:e.target.value}))}>
          <option value="">— Select tender —</option>
          {splitTenders.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </Sel>
        <Inp label="Icon (emoji)" value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))} placeholder="💵" />
        <Inp label="Balance (₹, optional)" type="number" value={form.balance} onChange={e=>setForm(f=>({...f,balance:e.target.value}))} placeholder="Leave blank if unknown" />
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
  const { splitTenders, splitTendersLoading, createSplitTender, updateSplitTender, deleteSplitTender } = useData();
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
  const [filteredExp, setFilteredExp] = useState<Expense[]|null>(null);
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

  useEffect(()=>{
    if (selBudgets.length === 0) { setFilteredExp(null); return; }
    setExpLoading(true);
    Promise.all(selBudgets.map(id=>expensesApi.getAll({ budgetId:id, limit:1000 }).then(r=>r.data??[])))
      .then(arrs=>setFilteredExp(arrs.flat()))
      .catch(e=>setError(e instanceof Error?e.message:"Error"))
      .finally(()=>setExpLoading(false));
  }, [selBudgets]);

  const toggleBudget = (id:string) => setSelBudgets(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  if (error) return <ErrMsg msg={error} />;

  // All metrics are scoped to the selected budget(s); no selection → no data
  const scoped  = filteredExp ?? [];
  const cats    = computeCategoryBreakdown(scoped);
  const srcs    = computeSourceBreakdown(scoped);
  const total   = scoped.reduce((s,e)=>s+Number(e.amount),0);
  const txCount = scoped.length;
  const expSet  = scoped;

  // Monthly trend computed from the selected budgets' expenses (last 6 months)
  const MONTHS = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyMap = new Map<string,{spend:number;count:number}>();
  for (const e of scoped) {
    const k  = e.date.slice(0,7);
    const ex = monthlyMap.get(k);
    if (ex) { ex.spend += Number(e.amount); ex.count++; }
    else monthlyMap.set(k, { spend:Number(e.amount), count:1 });
  }
  const monthly = [...monthlyMap.keys()].sort().slice(-6).map(k=>{
    const [y,m] = k.split("-").map(Number);
    const v = monthlyMap.get(k)!;
    return { month:MONTHS[m], year:y, monthNum:m, spend:v.spend, count:v.count };
  });

  // Fixed vs variable split
  const fixedExp    = expSet.filter(e => e.costType === "fixed");
  const variableExp = expSet.filter(e => e.costType !== "fixed"); // variable or undefined
  const fixedTotal    = fixedExp.reduce((s,e)=>s+Number(e.amount),0);
  const variableTotal = variableExp.reduce((s,e)=>s+Number(e.amount),0);

  // Avg per transaction
  const avgPerTx = txCount > 0 ? total / txCount : 0;

  // Avg daily spend + total date range (shared base for multiple metrics)
  let avgDaily = 0;
  let totalRangeDays = 1;
  if (expSet.length > 0) {
    const ms = expSet.map(e=>getSafeDate(e.date).getTime());
    totalRangeDays = Math.max(1, Math.round((Math.max(...ms) - Math.min(...ms)) / 86400000) + 1);
    avgDaily = expSet.reduce((s,e)=>s+Number(e.amount),0) / totalRangeDays;
  }

  // Day-of-week breakdown (split by cost type)
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dowData = DOW.map((day,i)=>{
    const dayExp  = expSet.filter(e=>getSafeDate(e.date).getDay()===i);
    const dayFix  = dayExp.filter(e=>e.costType==="fixed");
    const dayVar  = dayExp.filter(e=>e.costType!=="fixed");
    return {
      day,
      fixed:    dayFix.reduce((s,e)=>s+Number(e.amount),0),
      variable: dayVar.reduce((s,e)=>s+Number(e.amount),0),
      total:    dayExp.reduce((s,e)=>s+Number(e.amount),0),
      count:    dayExp.length,
    };
  });
  const topDow = dowData.reduce((a,b)=>b.total>a.total?b:a, dowData[0]);

  // Top spending calendar date (specific day, not day-of-week)
  const dateMap = expSet.reduce((m:Record<string,number>, e) => {
    const d = e.date.slice(0,10); m[d] = (m[d]||0) + Number(e.amount); return m;
  }, {});

  // ── Root-cause metrics ──────────────────────────────────────────────────
  // Unbudgeted spend (no budget linked)
  const unbudgetedTotal = expSet.filter(e=>!e.budgetId).reduce((s,e)=>s+Number(e.amount),0);
  const unbudgetedPct   = total > 0 ? Math.round(unbudgetedTotal/total*100) : 0;

  // Spike days: days where spend > 1.5× avg daily
  const dailyTotalsArr = Object.values(dateMap);
  const spikeDays      = avgDaily > 0 ? dailyTotalsArr.filter(d=>d > avgDaily*1.5).length : 0;
  const spikeDatesList = avgDaily > 0 ? Object.entries(dateMap).filter(([,v])=>v > avgDaily*1.5).map(([d])=>d) : [];

  // Spending frequency: % of days in range with ≥1 expense
  const activeDays    = Object.keys(dateMap).length;
  const activeDaysPct = Math.round(activeDays / totalRangeDays * 100);

  // Weekend share: Sat (6) + Sun (0), split by cost type
  const weekendExp      = expSet.filter(e=>{ const d=getSafeDate(e.date).getDay(); return d===0||d===6; });
  const weekendFixed    = weekendExp.filter(e=>e.costType==="fixed").reduce((s,e)=>s+Number(e.amount),0);
  const weekendVariable = weekendExp.filter(e=>e.costType!=="fixed").reduce((s,e)=>s+Number(e.amount),0);
  const weekendTotal    = weekendExp.reduce((s,e)=>s+Number(e.amount),0);
  const weekendPct      = total > 0 ? Math.round(weekendTotal/total*100) : 0;
  const weekendDatesList = [...new Set(weekendExp.map(e=>e.date.slice(0,10)))];

  // Month-over-month change (last two months of trend, strictly checking if consecutive)
  let momChange: number | null = null;
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const isConsecutive = (last.year === prev.year && last.monthNum === prev.monthNum + 1) ||
                          (last.year === prev.year + 1 && last.monthNum === 1 && prev.monthNum === 12);
    if (isConsecutive) {
      momChange = ((last.spend - prev.spend) / Math.max(1, prev.spend)) * 100;
    }
  }

  // Largest single expense — fixed and variable separately
  const maxFixedExp = fixedExp.length > 0    ? fixedExp.reduce((a,b)=>Number(b.amount)>Number(a.amount)?b:a)    : null;
  const maxVarExp   = variableExp.length > 0 ? variableExp.reduce((a,b)=>Number(b.amount)>Number(a.amount)?b:a) : null;

  // Top spend date — fixed and variable separately
  const fixedDateMap = fixedExp.reduce((m:Record<string,number>, e) => {
    const d = e.date.slice(0,10); m[d] = (m[d]||0) + Number(e.amount); return m;
  }, {});
  const varDateMap = variableExp.reduce((m:Record<string,number>, e) => {
    const d = e.date.slice(0,10); m[d] = (m[d]||0) + Number(e.amount); return m;
  }, {});
  const topFixedDateEntry = Object.entries(fixedDateMap).sort((a,b)=>b[1]-a[1])[0] as [string,number]|undefined;
  const topVarDateEntry   = Object.entries(varDateMap).sort((a,b)=>b[1]-a[1])[0]   as [string,number]|undefined;

  // Top category share
  const topCatPct = cats.length > 0 && total > 0 ? Math.round((cats[0].total/total)*100) : 0;

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
    {!expLoading && selBudgets.length > 0 && expSet.length === 0 && (
      <Card style={{ padding:"44px 20px", textAlign:"center" }}>
        <p style={{ fontSize:30, marginBottom:8 }}>🗒️</p>
        <p style={{ fontSize:15, fontWeight:700, color:T.ink, marginBottom:4 }}>No expenses yet</p>
        <p style={{ fontSize:13, color:T.muted }}>The selected budget{selBudgets.length>1?"s have":" has"} no expenses to analyze.</p>
      </Card>
    )}

    {/* Cost type split */}
    {expSet.length > 0 && (
      <Card style={{ marginBottom:18 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
          <span style={{ fontWeight:700, fontSize:15, color:T.ink }}>Fixed vs Variable</span>
          <InfoTip text="Fixed costs are predictable recurring expenses (rent, EMI, subscriptions). Variable costs fluctuate each month. Understanding the split helps you know how much of your spending is controllable." />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr 1fr":"repeat(4,1fr)", gap:10 }}>
          {[
            { label:"Total (all)",    value:fmtS(total),         sub:`${txCount} transactions`,             tone:"primary", tip:"All expenses combined — fixed + variable." },
            { label:"Fixed costs",    value:fmtS(fixedTotal),    sub:`${fixedExp.length} transactions`,     tone:"sky",     tip:"Predictable, recurring expenses like rent, EMI, or subscriptions. Hard to reduce short-term.",
              onClick: onDrillTo && fixedExp.length > 0 ? ()=>onDrillTo!({ costType:"fixed", budgetIds:selBudgets.length?selBudgets:undefined, label:"Fixed expenses" }) : undefined },
            { label:"Variable costs", value:fmtS(variableTotal), sub:`${variableExp.length} transactions`,  tone:"warn",    tip:"Discretionary or irregular expenses. This is where you have the most room to cut.",
              onClick: onDrillTo && variableExp.length > 0 ? ()=>onDrillTo!({ costType:"variable", budgetIds:selBudgets.length?selBudgets:undefined, label:"Variable expenses" }) : undefined },
            { label:"Variable share", value:total>0?`${Math.round(variableTotal/total*100)}%`:"—",
              sub:`${fmt(variableTotal)} of ${fmt(total)}`, tone: total>0&&variableTotal/total>0.7?"danger":"sage",
              tip:"What percentage of your total spend is variable (controllable). Above 70% means most of your spending is flexible — you have leverage to reduce it.",
              onClick: onDrillTo && variableExp.length > 0 ? ()=>onDrillTo!({ costType:"variable", budgetIds:selBudgets.length?selBudgets:undefined, label:"Variable expenses" }) : undefined },
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
        {fixedExp.length > 0 && variableExp.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:10 }}>
            <div onClick={onDrillTo ? ()=>onDrillTo!({ costType:"fixed", budgetIds:selBudgets.length?selBudgets:undefined, label:"Fixed expenses" }) : undefined}
              style={{ background:T.cream, borderRadius:10, padding:"10px 12px", border:`1px solid ${T.line}`, cursor:onDrillTo?"pointer":"default" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <p style={{ fontSize:10, color:T.muted, fontWeight:700, marginBottom:3 }}>Avg fixed / tx</p>
                {onDrillTo && <span style={{ fontSize:11, color:T.muted }}>→</span>}
              </div>
              <p style={{ fontSize:mobile?13:15, fontWeight:800, color:T.ink }}>{fmtS(fixedTotal/fixedExp.length)}</p>
            </div>
            <div onClick={onDrillTo ? ()=>onDrillTo!({ costType:"variable", budgetIds:selBudgets.length?selBudgets:undefined, label:"Variable expenses" }) : undefined}
              style={{ background:T.cream, borderRadius:10, padding:"10px 12px", border:`1px solid ${T.line}`, cursor:onDrillTo?"pointer":"default" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <p style={{ fontSize:10, color:T.muted, fontWeight:700, marginBottom:3 }}>Avg variable / tx</p>
                {onDrillTo && <span style={{ fontSize:11, color:T.muted }}>→</span>}
              </div>
              <p style={{ fontSize:mobile?13:15, fontWeight:800, color:T.ink }}>{fmtS(variableTotal/variableExp.length)}</p>
            </div>
          </div>
        )}
      </Card>
    )}

    {/* Stats grid — 2×2 on mobile, 4-col on desktop */}
    {expSet.length > 0 && (
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
    {expSet.length > 0 && insights.length > 0 && (
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
    {expSet.length > 0 && (
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
    {expSet.length > 0 && (
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
function ReportsScreen() {
  const { budgets } = useData();
  const [selBudgetId, setSelBudgetId] = useState("");
  const [reportExp, setReportExp]     = useState<Expense[]>([]);
  const [loading, setLoading]         = useState(false);
  const didInit = useRef(false);

  const allBudgets = budgets;

  // Default to the first budget once budgets have loaded
  useEffect(()=>{
    if (!didInit.current && allBudgets.length > 0) {
      didInit.current = true;
      setSelBudgetId(allBudgets[0].id);
    }
  }, [allBudgets]);

  useEffect(()=>{
    if (!selBudgetId) { setReportExp([]); setLoading(false); return; }
    setLoading(true);
    expensesApi.getAll({ limit:1000, budgetId:selBudgetId, sortBy:"date", order:"desc" })
      .then(r => setReportExp(r.data ?? []))
      .catch(console.error)
      .finally(()=>setLoading(false));
  }, [selBudgetId]);

  const total = reportExp.reduce((s,e)=>s+Number(e.amount),0);

  const downloadCSV = () => {
    const rows = [
      ["Title","Amount","Date","Category","Budget","Source","Notes"],
      ...reportExp.map(e=>[e.title,e.amount,e.date.slice(0,10),e.category?.name||"",e.budget?.name||"",e.source?.name||"",e.notes||""]),
    ];
    const csv  = rows.map(r=>r.map(x=>`"${x}"`).join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href=url; a.download="spendwise-export.csv"; a.click();
  };

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Reports</h1>
      <Btn size="lg" onClick={downloadCSV}>⬇ Export CSV</Btn>
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
      {[{l:"Total spent",v:fmt(total),t:"primary"},{l:"Transactions",v:String(reportExp.length),t:"sky"},{l:"Avg/transaction",v:fmt(total/Math.max(reportExp.length,1)),t:"sage"}].map(s=>
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
            {reportExp.slice(0,200).map(e=>(
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
      </Card>
    )}
    </>)}
  </div>;
}

// ── APP SHELL ─────────────────────────────────────────────────────────────
const LEFT_TABS  = [
  { id:"dashboard", emoji:"🏠", label:"Home" },
  { id:"expenses",  emoji:"📋", label:"Expenses" },
];
const RIGHT_TABS = [
  { id:"budgets",   emoji:"💰", label:"Budgets" },
  { id:"analytics", emoji:"📊", label:"Analytics" },
];
const MORE_NAV = [
  { id:"categories",    emoji:"🏷️", label:"Categories" },
  { id:"sources",       emoji:"💳", label:"Sources" },
  { id:"split-tenders", emoji:"🗂️", label:"Tenders" },
  { id:"reports",       emoji:"📁", label:"Reports" },
];
const MORE_IDS = MORE_NAV.map(m => m.id);
const PAGE_TITLE: Record<string,string> = {
  dashboard:"Dashboard", budgets:"Budgets", expenses:"Expenses",
  categories:"Categories", sources:"Sources", analytics:"Analytics", reports:"Reports",
  "split-tenders":"Split Tenders",
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
        }
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
