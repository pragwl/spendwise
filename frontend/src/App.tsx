import { useState, useEffect } from "react";
import { analyticsApi } from "./api/analytics";
import type { Expense, Budget, Category, PaymentSource, AnalyticsSummary } from "./types";
import { config as appConfig } from "./config";
import { DataProvider, useData } from "./context/DataContext";
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area,
} from "recharts";

// ── Helpers ──────────────────────────────────────────────────────────────
const fmt  = (n: number) => appConfig.app.currency + Math.round(n).toLocaleString(appConfig.app.locale);
const fmtS = (n: number) => n >= 100000 ? appConfig.app.currency+(n/100000).toFixed(1)+"L" : n >= 1000 ? appConfig.app.currency+(n/1000).toFixed(1)+"k" : appConfig.app.currency+Math.round(n);
const toDateStr = (d: string) => (d || "").slice(0, 10);
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

// ── Tiny UI ───────────────────────────────────────────────────────────────
function Card({ children, style={} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background:T.paper, border:`1px solid ${T.line}`, borderRadius:20, padding:"20px 22px", ...style }}>{children}</div>;
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
function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return <div style={{ position:"fixed", inset:0, zIndex:999, display:"flex", alignItems:"flex-end", justifyContent:"center" }} onClick={onClose}>
    <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.4)", backdropFilter:"blur(3px)" }} />
    <div onClick={e=>e.stopPropagation()} style={{ position:"relative", width:"100%", maxWidth:480, background:T.paper, borderRadius:"22px 22px 0 0", maxHeight:"90vh", display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 20px", borderBottom:`1px solid ${T.line}`, flexShrink:0 }}>
        <span style={{ fontWeight:800, fontSize:17, color:T.ink }}>{title}</span>
        <button onClick={onClose} style={{ width:30, height:30, borderRadius:9, background:T.raised, border:`1px solid ${T.line}`, cursor:"pointer", fontSize:14 }}>✕</button>
      </div>
      <div style={{ padding:"18px 20px", overflowY:"auto", flex:1 }}>{children}</div>
      {footer && <div style={{ padding:"14px 20px", borderTop:`1px solid ${T.line}` }}>{footer}</div>}
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
  { id:"dashboard",  label:"Dashboard",       emoji:"🏠" },
  { id:"budgets",    label:"Budgets",         emoji:"💰" },
  { id:"expenses",   label:"Expenses",        emoji:"📋" },
  { id:"categories", label:"Categories",      emoji:"🏷️" },
  { id:"sources",    label:"Payment Sources", emoji:"💳" },
  { id:"analytics",  label:"Analytics",       emoji:"📊" },
  { id:"reports",    label:"Reports",         emoji:"📁" },
];

// ── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ onAdd, goTo }: { onAdd:()=>void; goTo:(r:string)=>void }) {
  const mobile = useMobile();
  const { budgets, budgetsLoading, recentExpenses } = useData();
  const [summary, setSummary] = useState<AnalyticsSummary|null>(null);
  const [trendData, setTrend] = useState<{month:string;spend:number}[]>([]);

  useEffect(() => {
    analyticsApi.getSummary().then(r=>setSummary(r.data)).catch(console.error);
    analyticsApi.getMonthlyTrend().then(r=>{
      setTrend(r.data.slice(0,6).reverse().map(d=>({
        month:["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.month],
        spend:d.total,
      })));
    }).catch(console.error);
  }, []);

  const active   = budgets.filter(b => b.status === "active");
  const totalBud = active.reduce((s,b) => s + Number(b.amount  || 0), 0);
  const totalSp  = active.reduce((s,b) => s + Number(b.usedAmount || 0), 0);
  const left     = totalBud - totalSp;
  const pct      = totalBud ? (totalSp/totalBud)*100 : 0;
  const h        = health(pct);

  if (budgetsLoading) return <Spinner />;

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <div>
        <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Good morning 👋</h1>
        <p style={{ fontSize:13, color:T.muted, marginTop:5 }}>Here's where your money stands today.</p>
      </div>
      {!mobile && <Btn size="lg" onClick={onAdd}>+ Add expense</Btn>}
    </div>

    {/* Overview card */}
    <Card style={{ marginBottom:18, padding:"26px 28px", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", right:-30, top:-30, width:180, height:180, borderRadius:"50%", background:toneC[h.tone], opacity:.06 }} />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <p style={{ fontSize:13, color:T.muted }}>Budget left this period</p>
          <p style={{ fontWeight:800, fontSize:"clamp(28px,5vw,48px)", color:T.ink, lineHeight:1, marginTop:7 }}>{fmt(left)}</p>
          <p style={{ fontSize:13, color:T.muted, marginTop:7 }}>of {fmt(totalBud)} across {active.length} active budgets</p>
        </div>
        <Badge tone={h.tone}>{h.label}</Badge>
      </div>
      <div style={{ marginTop:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, fontWeight:600, color:T.muted, marginBottom:7 }}>
          <span>Spent {fmt(totalSp)} · {Math.round(pct)}%</span>
        </div>
        <Progress pct={pct} tone={h.tone} h={11} />
      </div>
      {summary && <div style={{ display:"grid", gridTemplateColumns:mobile?"repeat(2,1fr)":"repeat(3,1fr)", gap:mobile?8:11, marginTop:18 }}>
        {[
          { label:"Transactions",    value:summary.totalTransactions },
          { label:"Avg transaction", value:fmt(summary.avgTransaction) },
          { label:"Active budgets",  value:active.length },
        ].map(s=><div key={s.label} style={{ borderRadius:14, background:T.cream, border:`1px solid ${T.line}`, padding:mobile?"10px 12px":"12px 14px" }}>
          <p style={{ fontSize:11, color:T.muted, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.label}</p>
          <p style={{ fontWeight:700, fontSize:mobile?16:19, color:T.ink, marginTop:4 }}>{s.value}</p>
        </div>)}
      </div>}
    </Card>

    {/* Active budgets — individual cards */}
    {active.length > 0 && <div style={{ marginBottom:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <span style={{ fontWeight:700, fontSize:16, color:T.ink }}>Active budgets</span>
        <button onClick={()=>goTo("budgets")} style={{ fontSize:12, fontWeight:700, color:T.primary, background:"none", border:"none", cursor:"pointer" }}>View all →</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr":"repeat(auto-fill,minmax(260px,1fr))", gap:12 }}>
        {active.map(b => {
          const amt  = Number(b.amount || 0);
          const used = Number(b.usedAmount || 0);
          const p    = amt ? (used/amt)*100 : 0;
          const hh   = health(p);
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
                <Badge tone={hh.tone}>{hh.label}</Badge>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:8 }}>
                <div>
                  <p style={{ fontSize:11, color:T.muted }}>Remaining</p>
                  <p style={{ fontWeight:800, fontSize:22, color:T.ink }}>{fmt(amt-used)}</p>
                </div>
                <p style={{ fontSize:12, color:T.muted }}>{fmt(used)} / {fmt(amt)}</p>
              </div>
              <Progress pct={p} tone={hh.tone} h={8} />
              <p style={{ fontSize:11, color:T.faint, marginTop:6 }}>{Math.round(p)}% used</p>
              {(Number(b.cashSpent||0) > 0 || Number(b.walletSpent||0) > 0) && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7, marginTop:10 }}>
                  <div style={{ borderRadius:10, background:T.raised, padding:"8px 10px" }}>
                    <p style={{ fontSize:10, color:T.muted, marginBottom:3 }}>💵 Cash</p>
                    <p style={{ fontSize:13, fontWeight:700, color:T.ink }}>{fmt(Number(b.cashSpent||0))}</p>
                  </div>
                  <div style={{ borderRadius:10, background:T.raised, padding:"8px 10px" }}>
                    <p style={{ fontSize:10, color:T.muted, marginBottom:3 }}>👛 Wallet</p>
                    <p style={{ fontSize:13, fontWeight:700, color:T.ink }}>{fmt(Number(b.walletSpent||0))}</p>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>}

    {/* Pie + Recent */}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:18, marginBottom:18 }}>
      {summary && summary.categoryBreakdown.length>0 && (
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
            <span style={{ fontWeight:700, fontSize:16, color:T.ink }}>By category</span>
            <button onClick={()=>goTo("analytics")} style={{ fontSize:12, fontWeight:700, color:T.primary, background:"none", border:"none", cursor:"pointer" }}>Details →</button>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={summary.categoryBreakdown.map(c=>({name:c.category?.name||"Other",value:c.total}))}
                cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                {summary.categoryBreakdown.map((c,i)=>(
                  <Cell key={i} fill={c.category?.color||T.muted} />
                ))}
              </Pie>
              <Tooltip formatter={(v:unknown)=>fmt(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      )}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
          <span style={{ fontWeight:700, fontSize:16, color:T.ink }}>Recent expenses</span>
          <button onClick={()=>goTo("expenses")} style={{ fontSize:12, fontWeight:700, color:T.primary, background:"none", border:"none", cursor:"pointer" }}>All →</button>
        </div>
        {recentExpenses.map(e=><div key={e.id} style={{ display:"flex", alignItems:"center", gap:11, padding:"9px 0", borderBottom:`1px solid ${T.line}` }}>
          <div style={{ width:36, height:36, borderRadius:11, background:(e.category?.color||T.muted)+"22", display:"grid", placeItems:"center", fontSize:18 }}>{e.category?.icon||"💡"}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontSize:13, fontWeight:600, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.title}</p>
            <p style={{ fontSize:11, color:T.faint }}>{new Date(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</p>
          </div>
          <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{fmt(Number(e.amount))}</span>
        </div>)}
      </Card>
    </div>

    {trendData.length>0 && <Card>
      <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>Monthly trend</span>
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
function ExpensesScreen({ onOpenExpense }: { onOpenExpense:(e?:Expense)=>void }) {
  const mobile = useMobile();
  const { expenses, expensesLoading, deleteExpense, categories, budgets, setExpenseFilters } = useData();
  const [q, setQ] = useState("");

  const filtered = expenses.filter(e => !q || e.title.toLowerCase().includes(q.toLowerCase()));
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
    <Card style={{ marginBottom:18 }}>
      <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:T.faint }}>🔍</span>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search expenses…"
            style={{ width:"100%", padding:"10px 13px 10px 36px", borderRadius:13, border:`1px solid ${T.line}`, background:T.cream, color:T.ink, fontSize:14, outline:"none", fontFamily:"inherit" }} />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr":"1fr 1fr", gap:8 }}>
          <div style={{ position:"relative" }}>
            <select onChange={e=>setExpenseFilters(f=>({...f,categoryId:e.target.value||undefined}))}
              style={{ width:"100%", padding:"9px 28px 9px 12px", borderRadius:11, border:`1px solid ${T.line}`, background:T.cream, color:T.ink, fontSize:13, cursor:"pointer", outline:"none", fontFamily:"inherit", appearance:"none" }}>
              <option value="">All categories</option>
              {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select><span style={{ position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", color:T.faint, pointerEvents:"none" }}>▾</span>
          </div>
          <div style={{ position:"relative" }}>
            <select onChange={e=>setExpenseFilters(f=>({...f,budgetId:e.target.value||undefined}))}
              style={{ width:"100%", padding:"9px 28px 9px 12px", borderRadius:11, border:`1px solid ${T.line}`, background:T.cream, color:T.ink, fontSize:13, cursor:"pointer", outline:"none", fontFamily:"inherit", appearance:"none" }}>
              <option value="">All budgets</option>
              {budgets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select><span style={{ position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", color:T.faint, pointerEvents:"none" }}>▾</span>
          </div>
        </div>
      </div>
    </Card>
    {expensesLoading ? <Spinner /> : (
      <Card>
        {Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,items])=>(
          <div key={date} style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:7 }}>
              <span style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em" }}>
                {new Date(date).toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"short"})}
              </span>
              <span style={{ fontSize:11, fontWeight:700, color:T.faint }}>{fmt(items.reduce((s,e)=>s+Number(e.amount),0))}</span>
            </div>
            {items.map(e=>(
              <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:`1px solid ${T.line}` }}>
                <div style={{ width:42, height:42, borderRadius:13, background:(e.category?.color||T.muted)+"22", display:"grid", placeItems:"center", fontSize:20, flexShrink:0 }}>{e.category?.icon||"💡"}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:14, fontWeight:600, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.title}</p>
                  <p style={{ fontSize:11, color:T.muted }}>{e.category?.name}{e.source?` · ${e.source.icon} ${e.source.name}`:""}</p>
                </div>
                <div style={{ textAlign:"right" }}>
                  <p style={{ fontWeight:700, color:T.ink }}>{fmt(Number(e.amount))}</p>
                  <p style={{ fontSize:11, color:T.faint }}>{new Date(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</p>
                </div>
                <IconBtn icon="✏️" onClick={()=>onOpenExpense(e)} tone="primary" />
                <IconBtn icon="🗑️" onClick={()=>deleteExpense(e.id)} tone="danger" />
              </div>
            ))}
          </div>
        ))}
      </Card>
    )}
  </div>;
}

// ── EXPENSE FORM MODAL (add + edit) ───────────────────────────────────────
function ExpenseFormModal({ open, onClose, expense }: { open:boolean; onClose:()=>void; expense?:Expense }) {
  const { categories, budgets, sources, createExpense, updateExpense, updateSource } = useData();
  const isEdit = !!expense;
  const blank = { title:"", amount:"", date:new Date().toISOString().slice(0,10), categoryId:"", budgetId:"", sourceId:"", notes:"" };
  const [f, sf] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const selectedSource = sources.find(s => s.id === f.sourceId);

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
      };
      if (isEdit) await updateExpense(expense!.id, payload);
      else         await createExpense(payload);

      // Add expense amount to source balance (tracks total spent on this source)
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:7 }}>
            {categories.map(c=>{ const a=f.categoryId===c.id; return (
              <button key={c.id} onClick={()=>sf(p=>({...p,categoryId:c.id}))}
                style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, padding:"9px 5px", borderRadius:13,
                         border:a?`1.5px solid ${c.color||T.primary}`:`1.5px solid ${T.line}`,
                         background:a?(c.color||T.primary)+"18":T.raised, cursor:"pointer", fontFamily:"inherit" }}>
                <span style={{ fontSize:20 }}>{c.icon||"📁"}</span>
                <span style={{ fontSize:10, fontWeight:600, color:a?c.color||T.primary:T.muted }}>{c.name.split(" ")[0]}</span>
              </button>
            ); })}
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
          <Sel label="Budget" value={f.budgetId} onChange={e=>sf(p=>({...p,budgetId:e.target.value}))}>
            <option value="">No budget</option>
            {budgets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </Sel>
          <Sel label="Paid with" value={f.sourceId} onChange={e=>sf(p=>({...p,sourceId:e.target.value}))}>
            <option value="">Select source</option>
            {sources.map(s=><option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </Sel>
        </div>

        {/* Spending preview when source has balance tracking */}
        {selectedSource && selectedSource.balance != null && f.amount && !isEdit && (
          <div style={{ padding:"10px 14px", borderRadius:12, background:T.primaryS, border:`1px solid ${T.primary}22`, fontSize:12, color:T.primary, fontWeight:600 }}>
            Total spent on {selectedSource.name}: {fmt(Number(selectedSource.balance) + Number(f.amount))}
          </div>
        )}

        <Inp label="Notes (optional)" value={f.notes} onChange={e=>sf(p=>({...p,notes:e.target.value}))} placeholder="Add a note" />
      </div>
    </Modal>
  );
}

// ── BUDGETS SCREEN ────────────────────────────────────────────────────────
type BudgetForm = { name:string; description:string; amount:string; startDate:string; endDate:string; color:string; status:string };
const BCOLORS = ["#C2623F","#E8A838","#2E9E6B","#9B6DBF","#5B8FD4","#3BAF7E"];
const blankBudget: BudgetForm = { name:"", description:"", amount:"", startDate:"", endDate:"", color:"#C2623F", status:"active" };

function BudgetsScreen() {
  const { budgets, budgetsLoading, createBudget, updateBudget, deleteBudget } = useData();
  const [modal, setModal] = useState<{open:boolean; budget?:Budget}>({open:false});
  const [form, setForm] = useState<BudgetForm>(blankBudget);
  const [saving, setSaving] = useState(false);
  const isEdit = !!modal.budget;

  useEffect(()=>{
    if (modal.open) {
      setForm(modal.budget ? {
        name:        modal.budget.name,
        description: modal.budget.description || "",
        amount:      String(Number(modal.budget.amount)),
        startDate:   toDateStr(modal.budget.startDate),
        endDate:     toDateStr(modal.budget.endDate),
        color:       modal.budget.color || "#C2623F",
        status:      modal.budget.status,
      } : blankBudget);
    }
  }, [modal]);

  const save = async () => {
    if (!form.name || !form.amount) return;
    try {
      setSaving(true);
      const payload = { ...form, amount:Number(form.amount), status:form.status as Budget["status"] };
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
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:18 }}>
        {budgets.map(b=>{
          const amt=Number(b.amount||0), used=Number(b.usedAmount||0), p=amt?(used/amt)*100:0, hh=health(p);
          return (
          <Card key={b.id}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <div style={{ width:42, height:42, borderRadius:13, background:(b.color||T.primary)+"22", color:b.color||T.primary, display:"grid", placeItems:"center", fontSize:22 }}>💰</div>
                <div><p style={{ fontSize:14, fontWeight:700, color:T.ink }}>{b.name}</p><p style={{ fontSize:11, color:T.muted }}>{b.description}</p></div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <IconBtn icon="✏️" onClick={()=>setModal({open:true,budget:b})} tone="primary" />
                <IconBtn icon="🗑️" onClick={()=>deleteBudget(b.id)} tone="danger" />
              </div>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:7 }}>
              <div><p style={{ fontSize:11, color:T.muted }}>Remaining</p><p style={{ fontWeight:800, fontSize:24, color:T.ink }}>{fmt(amt-used)}</p></div>
              <Badge tone={hh.tone}>{hh.label}</Badge>
            </div>
            <Progress pct={p} tone={hh.tone} h={9} />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.muted, marginTop:7 }}>
              <span>{fmt(used)} spent · {Math.round(p)}%</span><span>{fmt(amt)} total</span>
            </div>
          </Card>
        ); })}
      </div>
    )}
    <Modal open={modal.open} onClose={()=>setModal({open:false})} title={isEdit?"Edit Budget":"New Budget"}
      footer={<div style={{ display:"flex", gap:10 }}>
        <Btn variant="ghost" onClick={()=>setModal({open:false})} full>Cancel</Btn>
        <Btn onClick={save} full disabled={saving}>{saving?"Saving…":isEdit?"Save changes":"Create"}</Btn>
      </div>}>
      <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
        <Inp label="Budget name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. July 2025 Budget" />
        <Inp label="Description" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Optional" />
        <Inp label="Amount (₹)" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="50000" />
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
                <p style={{ fontSize:11, color:T.muted }}>{c._count?.expenses||0} expenses</p>
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(10,1fr)", gap:6, marginBottom:8 }}>
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
type SrcForm = { name:string; type:string; icon:string; color:string; balance:string };
const blankSrc: SrcForm = { name:"", type:"Cash", icon:"💵", color:"#5B8FD4", balance:"" };
const SRC_TYPES = [{ value:"Cash", label:"💵 Cash" }, { value:"Wallet", label:"👛 Wallet" }];

function SourcesScreen() {
  const { sources, srcsLoading, createSource, updateSource, deleteSource } = useData();
  const [modal, setModal] = useState<{open:boolean; source?:PaymentSource}>({open:false});
  const [form, setForm] = useState<SrcForm>(blankSrc);
  const [saving, setSaving] = useState(false);
  const isEdit = !!modal.source;

  useEffect(()=>{
    if (modal.open) setForm(modal.source ? {
      name:    modal.source.name,
      type:    modal.source.type === "Cash" || modal.source.type === "Wallet" ? modal.source.type : "Cash",
      icon:    modal.source.icon    || "💵",
      color:   modal.source.color   || "#5B8FD4",
      balance: modal.source.balance != null ? String(Number(modal.source.balance)) : "",
    } : blankSrc);
  }, [modal]);

  const save = async () => {
    if (!form.name) return;
    try {
      setSaving(true);
      const payload = { name:form.name, type:form.type||undefined, icon:form.icon||undefined, color:form.color||undefined, balance:form.balance?Number(form.balance):null };
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
                  <p style={{ fontSize:11, color:T.muted }}>{s.type||"—"}</p>
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

            <p style={{ fontSize:11, color:T.muted }}>{s._count?.expenses||0} expenses</p>
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

// ── ANALYTICS SCREEN ──────────────────────────────────────────────────────
function AnalyticsScreen() {
  const [summary, setSummary] = useState<AnalyticsSummary|null>(null);
  const [monthly, setMonthly] = useState<{month:string;spend:number;count:number}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(()=>{
    Promise.all([analyticsApi.getSummary(), analyticsApi.getMonthlyTrend()])
      .then(([s,m])=>{
        setSummary(s.data);
        setMonthly(m.data.slice(0,6).reverse().map(d=>({
          month:["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.month],
          spend:d.total, count:d.count,
        })));
      }).catch(e=>setError(e instanceof Error?e.message:"Error"))
       .finally(()=>setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error)   return <ErrMsg msg={error} />;
  if (!summary) return null;

  const cats  = summary.categoryBreakdown;
  const srcs  = summary.sourceBreakdown;
  const total = summary.totalSpent;

  const stats = [
    { label:"Total spent",        value:fmtS(total),                      icon:"💸", tone:"primary" },
    { label:"Total transactions", value:summary.totalTransactions,         icon:"🧾", tone:"sky" },
    { label:"Avg transaction",    value:fmtS(summary.avgTransaction),      icon:"📐", tone:"sage" },
    { label:"Active budgets",     value:summary.activeBudgets.length,      icon:"💰", tone:"warn" },
  ];

  return <div>
    <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em", marginBottom:24 }}>Analytics</h1>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:15, marginBottom:18 }}>
      {stats.map(s=><Card key={s.label}>
        <div style={{ width:36, height:36, borderRadius:11, background:toneS[s.tone], display:"grid", placeItems:"center", fontSize:18, marginBottom:10 }}>{s.icon}</div>
        <p style={{ fontSize:12, color:T.muted }}>{s.label}</p>
        <p style={{ fontWeight:800, fontSize:24, color:T.ink, marginTop:4 }}>{s.value}</p>
      </Card>)}
    </div>
    {monthly.length>0 && <Card style={{ marginBottom:18 }}>
      <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>Monthly spending</span>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={monthly}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
          <XAxis dataKey="month" tick={{fontSize:11,fill:T.muted}} axisLine={false} tickLine={false} />
          <YAxis tick={{fontSize:10,fill:T.muted}} axisLine={false} tickLine={false} tickFormatter={fmtS} />
          <Tooltip formatter={(v:unknown)=>fmt(Number(v))} contentStyle={{borderRadius:12,border:"none",fontSize:12}} />
          <Bar dataKey="spend" name="Spent" fill={T.primary} radius={[5,5,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:18 }}>
      {cats.length>0 && <Card>
        <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>By category</span>
        {cats.map((c,i)=>{
          const max=cats[0].total;
          return <div key={i} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <span style={{ fontSize:20, flexShrink:0 }}>{c.category?.icon||"💡"}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:13, color:T.ink, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.category?.name||"Other"}</span>
                <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{fmt(c.total)}</span>
              </div>
              <div style={{ height:6, borderRadius:99, background:T.line, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:99, width:(c.total/max)*100+"%", background:c.category?.color||T.muted }} />
              </div>
            </div>
            <span style={{ fontSize:11, fontWeight:700, color:T.faint, width:30, textAlign:"right" }}>{total?Math.round(c.total/total*100):0}%</span>
          </div>;
        })}
      </Card>}
      {srcs.length>0 && <Card>
        <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>By payment source</span>
        {srcs.map((s,i)=>(
          <div key={i} style={{ display:"flex", alignItems:"center", gap:9, marginBottom:10 }}>
            <span style={{ fontSize:20 }}>{s.source?.icon||"💳"}</span>
            <span style={{ fontSize:13, color:T.muted, flex:1 }}>{s.source?.name||"Unknown"}</span>
            <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{fmt(s.total)}</span>
          </div>
        ))}
      </Card>}
    </div>
  </div>;
}

// ── REPORTS SCREEN ────────────────────────────────────────────────────────
function ReportsScreen() {
  const { expenses, expensesLoading } = useData();
  const total = expenses.reduce((s,e)=>s+Number(e.amount),0);

  const downloadCSV = () => {
    const rows = [
      ["Title","Amount","Date","Category","Budget","Source","Notes"],
      ...expenses.map(e=>[e.title,e.amount,e.date.slice(0,10),e.category?.name||"",e.budget?.name||"",e.source?.name||"",e.notes||""]),
    ];
    const csv  = rows.map(r=>r.map(x=>`"${x}"`).join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href=url; a.download="spendwise-export.csv"; a.click();
  };

  if (expensesLoading) return <Spinner />;

  return <div>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
      <h1 style={{ fontWeight:800, fontSize:"clamp(22px,4vw,30px)", color:T.ink, letterSpacing:"-.02em" }}>Reports</h1>
      <Btn size="lg" onClick={downloadCSV}>⬇ Export CSV</Btn>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:13, marginBottom:18 }}>
      {[{l:"Total spent",v:fmt(total),t:"primary"},{l:"Transactions",v:String(expenses.length),t:"sky"},{l:"Avg/transaction",v:fmt(total/Math.max(expenses.length,1)),t:"sage"}].map(s=>
        <div key={s.l} style={{ borderRadius:16, border:`1px solid ${T.line}`, padding:"14px 16px", background:T.paper }}>
          <p style={{ fontSize:11, color:T.muted }}>{s.l}</p>
          <p style={{ fontWeight:800, fontSize:22, color:toneC[s.t], marginTop:4 }}>{s.v}</p>
        </div>
      )}
    </div>
    <Card>
      <span style={{ fontWeight:700, fontSize:16, color:T.ink, display:"block", marginBottom:14 }}>All expenses</span>
      <div className="sw-table-wrap">
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:380 }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.line}` }}>
            {["Title","Category","Amount","Date"].map(h=><th key={h} style={{ textAlign:h==="Amount"||h==="Date"?"right":"left", padding:"7px 4px", fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em" }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {expenses.slice(0,50).map(e=>(
            <tr key={e.id} style={{ borderBottom:`1px solid ${T.line}` }}>
              <td style={{ padding:"10px 4px", fontWeight:600, color:T.ink }}>{e.title}</td>
              <td style={{ padding:"10px 4px", color:T.muted }}>{e.category?.name||"—"}</td>
              <td style={{ padding:"10px 4px", textAlign:"right", fontWeight:700, color:T.ink }}>{fmt(Number(e.amount))}</td>
              <td style={{ padding:"10px 4px", textAlign:"right", color:T.muted }}>{new Date(e.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"2-digit"})}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Card>
  </div>;
}

// ── APP SHELL ─────────────────────────────────────────────────────────────
const BOTTOM_TABS = [
  { id:"dashboard", emoji:"🏠", label:"Home" },
  { id:"expenses",  emoji:"📋", label:"Expenses" },
  { id:"budgets",   emoji:"💰", label:"Budgets" },
  { id:"analytics", emoji:"📊", label:"Analytics" },
];
const MORE_NAV = [
  { id:"categories", emoji:"🏷️", label:"Categories" },
  { id:"sources",    emoji:"💳", label:"Sources" },
  { id:"reports",    emoji:"📁", label:"Reports" },
];
const MORE_IDS = MORE_NAV.map(m => m.id);
const PAGE_TITLE: Record<string,string> = {
  dashboard:"Dashboard", budgets:"Budgets", expenses:"Expenses",
  categories:"Categories", sources:"Sources", analytics:"Analytics", reports:"Reports",
};

function AppShell() {
  const mobile = useMobile();
  const [route, setRoute] = useState(()=>localStorage.getItem("sw_route")||"dashboard");
  const [expModal, setExpModal] = useState<{open:boolean; expense?:Expense}>({open:false});
  const [showMore, setShowMore] = useState(false);

  const goTo = (r:string) => { setRoute(r); localStorage.setItem("sw_route",r); window.scrollTo(0,0); setShowMore(false); };
  const openExpense = (e?:Expense) => setExpModal({open:true, expense:e});

  const screens: Record<string,React.ReactNode> = {
    dashboard:  <Dashboard onAdd={openExpense} goTo={goTo} />,
    budgets:    <BudgetsScreen />,
    expenses:   <ExpensesScreen onOpenExpense={openExpense} />,
    categories: <CategoriesScreen />,
    sources:    <SourcesScreen />,
    analytics:  <AnalyticsScreen />,
    reports:    <ReportsScreen />,
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
          <header style={{ position:"sticky", top:0, zIndex:30, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px 12px", background:T.paper, borderBottom:`1px solid ${T.line}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:28, height:28, borderRadius:9, background:T.primary, display:"grid", placeItems:"center", fontSize:14 }}>🐷</div>
              <span style={{ fontWeight:800, fontSize:16, color:T.ink, letterSpacing:"-.02em" }}>{appConfig.app.name}</span>
            </div>
            <span style={{ fontWeight:700, fontSize:14, color:T.muted }}>{PAGE_TITLE[route]}</span>
          </header>
        )}

        <main style={{ flex:1, padding:mobile?"14px 14px 100px":"22px 32px 40px", maxWidth:1280, width:"100%", margin:"0 auto" }}>
          {screens[route]||screens.dashboard}
        </main>
      </div>

      {/* ── Mobile bottom navigation ── */}
      {mobile && (
        <>
          {/* "More" sheet overlay */}
          {showMore && (
            <div style={{ position:"fixed", inset:0, zIndex:60 }} onClick={()=>setShowMore(false)}>
              <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.35)", backdropFilter:"blur(3px)" }} />
              <div onClick={e=>e.stopPropagation()}
                style={{ position:"absolute", bottom:70, left:12, right:12, background:T.paper, borderRadius:22, padding:"16px 8px", boxShadow:"0 -4px 32px rgba(0,0,0,.12)" }}>
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

          {/* Bottom tab bar */}
          <nav style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:50, background:T.paper, borderTop:`1px solid ${T.line}`, display:"flex", alignItems:"center", height:64, paddingBottom:"env(safe-area-inset-bottom)" }}>
            {BOTTOM_TABS.map((tab, i) => {
              const a = route === tab.id && !moreActive;
              /* Insert FAB in the middle (after index 1) */
              const fabSlot = i === 2;
              return (
                <div key={tab.id} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
                  {fabSlot && (
                    <button onClick={()=>openExpense()}
                      style={{ width:50, height:50, borderRadius:99, background:T.primary, border:"none", cursor:"pointer",
                               display:"grid", placeItems:"center", fontSize:24, color:"#fff",
                               boxShadow:`0 4px 16px ${T.primary}66`, marginBottom:2 }}>
                      +
                    </button>
                  )}
                  {!fabSlot && (
                    <button onClick={()=>goTo(tab.id)}
                      style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"6px 10px", border:"none",
                               background:"transparent", cursor:"pointer", color:a?T.primary:T.faint, fontFamily:"inherit", minWidth:52 }}>
                      <span style={{ fontSize:20 }}>{tab.emoji}</span>
                      <span style={{ fontSize:10, fontWeight:700 }}>{tab.label}</span>
                    </button>
                  )}
                </div>
              );
            })}
            {/* More tab */}
            <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center" }}>
              <button onClick={()=>setShowMore(p=>!p)}
                style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"6px 10px", border:"none",
                         background:"transparent", cursor:"pointer", color:(moreActive||showMore)?T.primary:T.faint, fontFamily:"inherit", minWidth:52 }}>
                <span style={{ fontSize:20 }}>☰</span>
                <span style={{ fontSize:10, fontWeight:700 }}>More</span>
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
        body{font-family:'Plus Jakarta Sans',sans-serif;-webkit-font-smoothing:antialiased}
        select,input,button{font-family:'Plus Jakarta Sans',sans-serif}
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
