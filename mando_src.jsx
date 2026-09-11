import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";

/* =====================================================================
   MUÑIZ · CENTRO DE MANDO
   Laptop console. Reads the live database. Office login required.
   ===================================================================== */

const CFG = (typeof window !== "undefined" && window.MUNIZ_CONFIG) || {};
const SB = CFG.SUPABASE || {};
const SB_URL = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/auth\/v1$/, "");
const SB_KEY = String(SB.ANON_KEY || "");
const K_TOK = "muniz_office_token";
const FUELC = { DIESEL: "#16A34A", GASOLINA: "#EA580C" };

const tok = () => { try { const t = JSON.parse(localStorage.getItem(K_TOK) || "null"); return t && t.exp * 1000 > Date.now() ? t : null; } catch (e) { return null; } };
const hdr = t => { const h = { apikey: SB_KEY, "Content-Type": "application/json" }; if (t) h.Authorization = "Bearer " + t; return h; };
async function get(path, t) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: hdr(t) });
  if (!r.ok) { const e = new Error(await r.text()); e.status = r.status; throw e; }
  return r.json();
}
async function login(email, password) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error("login");
  const j = await r.json();
  const t = { access_token: j.access_token, email: (j.user || {}).email || email, exp: Math.floor(Date.now() / 1000) + (j.expires_in || 3600) };
  localStorage.setItem(K_TOK, JSON.stringify(t)); return t;
}

const N = n => (n == null || n === "") ? "—" : Number(n).toLocaleString("en-US");
const money = n => n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mmss = s => s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const dt = ts => new Date(ts).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const hhmm = ts => new Date(ts).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayLabel = k => { const [y, m, d] = k.split("-"); return `${d}/${m}`; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

/* ---------- atoms ---------- */
const Card = ({ title, right, children, className = "" }) => (
  <div className={`bg-[#111823] border border-[#1E2A38] rounded-2xl ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="text-[11px] font-black tracking-[0.16em] text-[#7C8A9C]">{title}</div>
        {right}
      </div>)}
    <div className="px-4 pb-4">{children}</div>
  </div>);

const Kpi = ({ label, value, sub, tone }) => (
  <div className="bg-[#111823] border border-[#1E2A38] rounded-2xl px-4 py-3">
    <div className="text-[10px] font-black tracking-[0.16em] text-[#7C8A9C]">{label}</div>
    <div className="display text-[30px] leading-none mt-1.5" style={tone ? { color: tone } : undefined}>{value}</div>
    {sub ? <div className="text-[11px] text-[#7C8A9C] mt-1">{sub}</div> : null}
  </div>);

/* hand-rolled charts: no CDN, no dependency */
function Bars({ data, height = 130, color = "#F5B800", fmt = N }) {
  const max = Math.max(1, ...data.map(d => d.v));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
          <div className="absolute -top-1 opacity-0 group-hover:opacity-100 text-[10px] font-black bg-[#0B0F14] px-1.5 py-0.5 rounded border border-[#1E2A38] whitespace-nowrap z-10">{d.label}: {fmt(d.v)}</div>
          <div className="w-full rounded-t transition-all" style={{ height: `${Math.max(2, d.v / max * (height - 22))}px`, background: d.color || color, opacity: d.v ? 1 : .25 }} />
          <div className="text-[9px] text-[#5E6B7D] mt-1 whitespace-nowrap">{d.label}</div>
        </div>))}
    </div>);
}
function Split({ parts }) {
  const tot = parts.reduce((a, b) => a + b.v, 0) || 1;
  return (<>
    <div className="flex h-3.5 rounded-full overflow-hidden bg-[#0B0F14]">
      {parts.map((p, i) => <div key={i} style={{ width: `${p.v / tot * 100}%`, background: p.color }} />)}
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
      {parts.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-[12px] font-bold">{p.label}</span>
          <span className="text-[12px] text-[#7C8A9C]">{p.v} · {Math.round(p.v / tot * 100)}%</span>
        </div>))}
    </div></>);
}

/* ---------- flags (same rules as the database view) ---------- */
const AL = { MIN_H: 6, MAX_7D: 4, MIN_MI: 40 };
function flagsFor(e, all) {
  const f = [];
  if (e.srvFlags && e.srvFlags.length) e.srvFlags.forEach(t => f.push({ lvl: "amber", t }));
  const prev = all.filter(x => x.vid === e.vid && x.ts < e.ts).sort((a, b) => b.ts - a.ts);
  const last = prev[0];
  if (e.plateTyped) f.push({ lvl: "amber", t: "Placa dictada" });
  if (e.obraOtra) f.push({ lvl: "amber", t: "Obra a mano" });
  if (e.obraSemana && e.obra !== e.obraSemana) f.push({ lvl: "amber", t: `Obra ≠ rol (${e.obraSemana})` });
  if (last) {
    const h = Math.abs(e.ts - last.ts) / 36e5;
    if (h < 24 && e.tipo !== "PIPA") f.push({ lvl: "red", t: `2ª carga en ${h < 1 ? "<1" : Math.round(h)} h` });
    if (e.lectura !== "" && last.lectura !== "" && e.lectura != null && last.lectura != null) {
      const d = Number(e.lectura) - Number(last.lectura);
      if (d < 0) f.push({ lvl: "red", t: "Lectura retrocedió" });
      else if (e.tipo === "CAMIONETA" && d < AL.MIN_MI) f.push({ lvl: "amber", t: `${d} mi desde la última` });
    }
  }
  const w = prev.filter(x => e.ts - x.ts < 7 * 864e5).length + 1;
  if (w > AL.MAX_7D && e.tipo !== "PIPA") f.push({ lvl: "amber", t: `${w} cargas/7d` });
  const d = new Date(e.ts), hr = d.getHours();
  if (d.getDay() === 0) f.push({ lvl: "amber", t: "Domingo" });
  if (hr < 5 || hr >= 20) f.push({ lvl: "amber", t: "Fuera de horario" });
  const seen = new Set(all.filter(x => x.who === e.who && Math.abs(x.ts - e.ts) < 864e5 && x.vid !== e.vid).map(x => x.vid));
  if (seen.size >= 2) f.push({ lvl: "amber", t: `${seen.size + 1} vehículos en un día` });
  const u = {}; return f.filter(x => u[x.t] ? false : (u[x.t] = 1));
}

/* ===================================================================== LOGIN */
function Login({ onOk }) {
  const [e, setE] = useState(""), [p, setP] = useState(""), [err, setErr] = useState(""), [b, setB] = useState(false);
  const go = async () => { setB(true); setErr(""); try { onOk(await login(e.trim(), p)); } catch (x) { setErr("Correo o contraseña incorrectos"); } finally { setB(false); } };
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#F5B800] flex items-center justify-center text-2xl">⛽</div>
          <div>
            <div className="text-[10px] font-black tracking-[0.2em] text-[#7C8A9C]">MUÑIZ CONCRETE &amp; CONTRACTING</div>
            <div className="display text-[24px] leading-tight">Centro de mando</div>
          </div>
        </div>
        <input value={e} onChange={x => setE(x.target.value)} placeholder="correo" type="email" autoCapitalize="none"
          className="mt-6 w-full h-12 rounded-xl bg-[#111823] border border-[#1E2A38] px-4 text-[15px] outline-none focus:border-[#F5B800]" />
        <input value={p} onChange={x => setP(x.target.value)} placeholder="contraseña" type="password" onKeyDown={x => x.key === "Enter" && go()}
          className="mt-2 w-full h-12 rounded-xl bg-[#111823] border border-[#1E2A38] px-4 text-[15px] outline-none focus:border-[#F5B800]" />
        {err ? <div className="mt-3 text-[#F87171] text-[13px] font-bold">{err}</div> : null}
        <button onClick={go} disabled={b || !e || !p} className="mt-4 w-full py-3 rounded-xl bg-[#F5B800] text-[#0B0F14] font-black disabled:opacity-40">{b ? "ENTRANDO…" : "ENTRAR"}</button>
        <div className="mt-6 text-[11px] text-[#5E6B7D] leading-snug">Solo los correos autorizados en la base de datos pueden entrar. Los mayordomos no tienen acceso a esta pantalla.</div>
      </div>
    </div>);
}

/* ===================================================================== PEDIDOS DE MATERIAL (Fase 2) */
const PROVC = { ACE: "#FF5A00", CMC: "#2E5C8A", RSS: "#A78BFA", WHITECAP: "#F5B800" };
const STC = { SOLICITADO: { c: "#F5B800", l: "ESPERA SUPERVISOR" }, APROBADO: { c: "#38BDF8", l: "APROBADO · SIN PO" }, PO_ASIGNADO: { c: "#4ADE80", l: "PO ASIGNADO" }, RECHAZADO: { c: "#F87171", l: "RECHAZADO" } };
const ago = ms => { const m = Math.round(ms / 60e3); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")}`; return `${Math.floor(h / 24)} d`; };
const Pill = ({ color, children }) => <span className="px-1.5 py-0.5 rounded text-[10px] font-black text-white whitespace-nowrap" style={{ background: color }}>{children}</span>;

function orderFlags(o) {
  const f = (o.server_flags || []).map(t => ({ lvl: /Sin respuesta|sin PO|a sí mismo|no confirmó/.test(t) ? "red" : "amber", t }));
  const u = {}; return f.filter(x => u[x.t] ? false : (u[x.t] = 1));
}

function Pedidos({ orders, range, q, setQ, live, now, onCsvRef }) {
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState("todos");
  const real = useMemo(() => orders.filter(o => !o.is_practice), [orders]);
  const practice = orders.length - real.length;
  const cut = range === 0 ? 0 : now - range * 864e5;
  const inRange = useMemo(() => real.filter(o => o.ts >= cut), [real, cut]);
  const flagged = useMemo(() => inRange.map(o => ({ ...o, flags: orderFlags(o) })), [inRange]);
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const todayL = real.filter(o => o.ts >= today0.getTime());
  const queue = useMemo(() => real.filter(o => o.status === "SOLICITADO" || o.status === "APROBADO").sort((a, b) => a.ts - b.ts), [real]);
  const tApr = inRange.map(o => o.secs_to_approve).filter(s => s != null && s > 0);
  const tPo = inRange.map(o => o.secs_to_po).filter(s => s != null && s > 0);
  const est = inRange.reduce((a, o) => a + (Number(o.est_total) || 0), 0);
  const reds = flagged.filter(o => o.flags.some(f => f.lvl === "red"));

  const days = useMemo(() => {
    const d = []; const n = range === 0 ? 30 : Math.min(range, 30);
    for (let i = n - 1; i >= 0; i--) { const x = new Date(now - i * 864e5); const k = dayKey(x); d.push({ label: dayLabel(k), key: k, v: 0 }); }
    const idx = {}; d.forEach((x, i) => idx[x.key] = i);
    real.forEach(o => { const i = idx[dayKey(o.ts)]; if (i != null) d[i].v++; });
    return d;
  }, [real, range, now]);

  const top = (f, val = () => 1) => { const m = {}; inRange.forEach(o => { const k = f(o) || "—"; m[k] = (m[k] || 0) + val(o); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const byObra = top(o => o.jobsite);
  const byWho = top(o => o.foreman);
  const byWhoUsd = {}; inRange.forEach(o => { byWhoUsd[o.foreman] = (byWhoUsd[o.foreman] || 0) + (Number(o.est_total) || 0); });
  const notFound = useMemo(() => { const m = {}; inRange.forEach(o => (o.not_found || []).forEach(t => { const k = String(t).toLowerCase().trim(); if (k) m[k] = (m[k] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12); }, [inRange]);
  const topItems = useMemo(() => {
    const m = {};
    inRange.forEach(o => (o.lines || []).filter(l => l.stage === (o.approved_at ? "APROBADO" : "SOLICITADO") && !l.removed && l.qty > 0).forEach(l => {
      const k = (l.code || "") + "|" + (l.descr || ""); const x = m[k] = m[k] || { code: l.code, descr: l.descr, custom: l.custom, qty: 0, n: 0, usd: 0 };
      x.qty += Number(l.qty) || 0; x.n++; x.usd += Number(l.line_total) || 0; }));
    return Object.values(m).sort((a, b) => b.n - a.n || b.qty - a.qty).slice(0, 12);
  }, [inRange]);

  const csv = () => {
    const cl = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const H = ["folio", "fecha", "hora", "quien", "rol", "proveedor", "obra", "obra_rol", "supervisor", "chofer", "estado", "po", "lineas_pedidas", "lineas_aprobadas", "ajustadas", "quitadas", "fuera_catalogo", "estimado_usd", "min_a_aprobar", "min_a_po", "agregado", "no_encontrado", "alertas", "lineas"];
    const R = flagged.map(o => { const d = new Date(o.ts); const st = o.approved_at ? "APROBADO" : "SOLICITADO";
      const L = (o.lines || []).filter(l => l.stage === st).map(l => `${l.qty}x ${l.descr || l.code}${l.code ? " [" + l.code + "]" : ""}${l.removed ? " (QUITADO)" : ""}`).join(" | ");
      return [o.req_no, d.toLocaleDateString("es-MX"), hhmm(o.ts), o.foreman, o.foreman_role, o.provider, o.jobsite, o.jobsite_week, o.supervisor, o.driver, o.status, o.po, o.requested_lines, o.approved_lines, o.adjusted_lines, o.removed_lines, o.custom_lines, o.est_total, o.secs_to_approve != null ? Math.round(o.secs_to_approve / 60) : "", o.secs_to_po != null ? Math.round(o.secs_to_po / 60) : "", o.is_addon ? 1 : 0, (o.not_found || []).join(" | "), o.flags.map(f => f.t).join(" | "), L].map(cl).join(","); });
    const b = new Blob(["\uFEFF" + [H.join(","), ...R].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `pedidos_${dayKey(now)}.csv`; a.click();
  };
  useEffect(() => { if (onCsvRef) onCsvRef.current = csv; });

  const shown = flagged.filter(o => (tab === "todos" || (tab === "pendientes" ? (o.status === "SOLICITADO" || o.status === "APROBADO") : o.status === tab))
    && (!q || `${o.req_no} ${o.po || ""} ${o.foreman} ${o.jobsite || ""} ${o.supervisor || ""} ${o.provider} ${o.driver || ""} ${(o.lines || []).map(l => (l.code || "") + " " + (l.descr || "")).join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const Flag = ({ f }) => <span className={`text-[10px] font-black px-1.5 py-0.5 rounded whitespace-nowrap ${f.lvl === "red" ? "bg-[#DC2626] text-white" : "bg-[#78350F] text-[#FDE68A]"}`}>{f.t}</span>;
  const livePed = live.filter(x => x.app === "pedidos");

  return (<>
    <div className="px-5 py-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi label="HOY" value={todayL.length} sub={`${todayL.filter(o => o.status === "PO_ASIGNADO").length} con PO · ${todayL.filter(o => o.status === "RECHAZADO").length} rechazados`} />
        <Kpi label={range === 0 ? "TOTAL" : `${range} DÍA${range > 1 ? "S" : ""}`} value={inRange.length} sub={`${(inRange.length / Math.max(1, range === 0 ? 30 : range)).toFixed(1)} por día${practice ? ` · ${practice} de práctica (no cuentan)` : ""}`} />
        <Kpi label="ESPERAN SUPERVISOR" value={queue.filter(o => o.status === "SOLICITADO").length} tone={queue.some(o => o.status === "SOLICITADO" && now - o.ts > 2 * 36e5) ? "#F87171" : queue.some(o => o.status === "SOLICITADO") ? "#F5B800" : undefined} sub={queue.some(o => o.status === "SOLICITADO") ? `el más viejo: ${ago(now - queue.find(o => o.status === "SOLICITADO").ts)}` : "nada pendiente"} />
        <Kpi label="APROBADOS SIN PO" value={queue.filter(o => o.status === "APROBADO").length} tone={queue.some(o => o.status === "APROBADO") ? "#38BDF8" : undefined} sub="te toca a ti" />
        <Kpi label="TIEMPO A APROBAR" value={tApr.length ? ago(median(tApr) * 1000) : "—"} tone="#F5B800" sub={tApr.length ? `mediana de ${tApr.length}` : "sin datos"} />
        <Kpi label="ESTIMADO" value={est ? money(est) : "—"} sub="a precio de catálogo" />
        <Kpi label="EN EL APP AHORA" value={livePed.length} tone={livePed.length ? "#4ADE80" : undefined} sub={livePed.length ? livePed.slice(0, 2).map(x => (x.who || "").split(" ")[0]).join(", ") : "nadie"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="POR ATENDER" right={<span className="text-[10px] text-[#5E6B7D]">más viejo primero</span>} className="xl:col-span-1">
          {queue.length ? (
            <div className="space-y-1.5 max-h-[260px] overflow-auto">
              {queue.map(o => (
                <div key={o.id} onClick={() => setSel({ ...o, flags: orderFlags(o) })} className="flex items-center gap-2 text-[12px] rounded-lg px-2.5 py-2 cursor-pointer border" style={{ borderColor: STC[o.status].c + "55", background: STC[o.status].c + "12" }}>
                  <span className="mono font-black">{o.req_no}</span>
                  <Pill color={PROVC[o.provider]}>{o.provider}</Pill>
                  <span className="font-bold truncate">{o.foreman}</span>
                  <span className="text-[#7C8A9C] truncate hidden md:inline">{o.jobsite || "sin obra"}</span>
                  <span className="ml-auto shrink-0 font-black" style={{ color: STC[o.status].c }}>{o.status === "SOLICITADO" ? "supervisor" : "PO"} · {ago(now - (o.status === "APROBADO" && o.approved_at ? new Date(o.approved_at).getTime() : o.ts))}</span>
                </div>))}
            </div>) : <div className="text-[12px] text-[#4ADE80] py-6 text-center font-bold">Todo atendido. Nada esperando.</div>}
        </Card>
        <Card title="PEDIDOS POR DÍA" className="xl:col-span-2"><Bars data={days} color="#FF5A00" /></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="PROVEEDOR">
          <Split parts={["ACE", "CMC", "RSS", "WHITECAP"].map(p => ({ label: p === "WHITECAP" ? "White Cap" : p, v: inRange.filter(o => o.provider === p).length, color: PROVC[p] }))} />
        </Card>
        <Card title="ESTADO">
          <Split parts={Object.keys(STC).map(s => ({ label: STC[s].l, v: inRange.filter(o => o.status === s).length, color: STC[s].c }))} />
        </Card>
        <Card title="QUIÉN APRUEBA">
          <Split parts={[{ label: "Supervisor", v: inRange.filter(o => o.approved_at && !o.self_approved).length, color: "#38BDF8" },
                          { label: "Directo (sup./gerente)", v: inRange.filter(o => o.self_approved).length, color: "#A78BFA" },
                          { label: "Sin aprobar", v: inRange.filter(o => !o.approved_at).length, color: "#5E6B7D" }]} />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="PEDIDOS POR OBRA" right={<span className="text-[10px] text-[#5E6B7D]">top 10</span>}>
          {byObra.slice(0, 10).map(([k, v], i) => (
            <div key={k} className="flex items-center gap-2 py-1">
              <div className="text-[12px] w-6 text-[#5E6B7D]">{i + 1}</div>
              <div className="text-[12px] font-bold truncate flex-1">{k}</div>
              <div className="h-2 rounded-full bg-[#FF5A00]" style={{ width: `${v / byObra[0][1] * 110}px` }} />
              <div className="text-[12px] font-black w-8 text-right">{v}</div>
            </div>))}
          {!inRange.length ? <div className="text-[12px] text-[#5E6B7D] py-6 text-center">Sin pedidos en este rango.</div> : null}
        </Card>
        <Card title="POR MAYORDOMO" right={<span className="text-[10px] text-[#5E6B7D]">pedidos · estimado</span>}>
          {byWho.slice(0, 10).map(([k, v], i) => (
            <div key={k} className="flex items-center gap-2 py-1">
              <div className="text-[12px] w-6 text-[#5E6B7D]">{i + 1}</div>
              <div className="text-[12px] font-bold truncate flex-1">{k}</div>
              <div className="text-[12px] font-black w-8 text-right">{v}</div>
              <div className="text-[12px] mono text-[#7C8A9C] w-20 text-right">{byWhoUsd[k] ? money(byWhoUsd[k]) : "—"}</div>
            </div>))}
          {!inRange.length ? <div className="text-[12px] text-[#5E6B7D] py-6 text-center">Sin pedidos en este rango.</div> : null}
        </Card>
        <Card title="BUSCARON Y NO ENCONTRARON" right={<span className="text-[10px] text-[#5E6B7D]">para Claudia · catálogo</span>}>
          {notFound.length ? notFound.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 py-1 text-[12px]"><span className="font-bold flex-1 truncate">“{k}”</span><span className="font-black text-[#FDE68A]">{v}×</span></div>)) :
            <div className="text-[12px] text-[#5E6B7D] py-6 text-center">Nada pendiente de agregar al catálogo.</div>}
        </Card>
      </div>

      {topItems.length ? (
        <Card title="LO MÁS PEDIDO" right={<span className="text-[10px] text-[#5E6B7D]">líneas vivas del rango</span>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {topItems.map((it, i) => (
              <div key={i} className="flex items-center gap-2 py-1 text-[12px] border-b border-[#1E2A38]/50">
                <span className="mono text-[#7C8A9C] w-24 truncate">{it.code || <span className="text-[#FDE68A]">fuera cat.</span>}</span>
                <span className="font-bold flex-1 truncate">{it.descr || "—"}</span>
                <span className="text-[#7C8A9C] w-14 text-right">{it.n} ped.</span>
                <span className="font-black w-12 text-right">{N(it.qty)}</span>
                <span className="mono text-[#7C8A9C] w-20 text-right">{it.usd ? money(it.usd) : "—"}</span>
              </div>))}
          </div>
        </Card>) : null}

      {reds.length ? (
        <Card title="ALERTAS ROJAS · REVISAR" right={<span className="text-[10px] font-black text-[#F87171]">{reds.length}</span>}>
          <div className="space-y-1.5">
            {reds.slice(0, 8).map(o => (
              <div key={o.id} onClick={() => setSel(o)} className="flex items-center gap-3 text-[12px] bg-[#1A0E0E] border border-[#DC2626]/40 rounded-lg px-3 py-2 cursor-pointer">
                <span className="mono font-black">{o.req_no}</span>
                <span className="font-bold">{o.foreman}</span>
                <span className="text-[#7C8A9C] truncate">{o.provider} · {o.jobsite || "sin obra"}</span>
                <span className="ml-auto flex gap-1 flex-wrap justify-end">{o.flags.filter(f => f.lvl === "red").map((f, i) => <Flag key={i} f={f} />)}</span>
              </div>))}
          </div>
        </Card>) : null}

      <div className="flex items-center gap-2 flex-wrap">
        {[["todos", `TODOS · ${flagged.length}`], ["pendientes", `PENDIENTES · ${flagged.filter(o => o.status === "SOLICITADO" || o.status === "APROBADO").length}`], ["PO_ASIGNADO", `CON PO · ${flagged.filter(o => o.status === "PO_ASIGNADO").length}`], ["RECHAZADO", `RECHAZADOS · ${flagged.filter(o => o.status === "RECHAZADO").length}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded-lg text-[12px] font-black ${tab === k ? "bg-white text-[#0B0F14]" : "bg-[#111823] text-[#7C8A9C] border border-[#1E2A38]"}`}>{l}</button>))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar folio, PO, nombre, obra, artículo…"
          className="ml-auto w-80 h-9 rounded-lg bg-[#111823] border border-[#1E2A38] px-3 text-[13px] outline-none focus:border-[#FF5A00]" />
      </div>

      <Card>
        <div className="overflow-auto -mx-1">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] font-black tracking-wider text-[#7C8A9C] border-b border-[#1E2A38]">
                {["FOLIO", "FECHA", "QUIÉN", "PROV", "OBRA", "SUPERVISOR", "LÍNEAS", "EST. $", "ESTADO", "A APROBAR", "PO", "ALERTAS"].map(h => <th key={h} className="text-left px-2 py-2 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map(o => (
                <tr key={o.id} onClick={() => setSel(o)} className="border-b border-[#1E2A38]/60 hover:bg-[#141C28] cursor-pointer">
                  <td className="px-2 py-2 mono font-black whitespace-nowrap">{o.req_no}{o.is_addon ? <span className="ml-1 text-[9px] text-[#FDE68A]">+AGR</span> : null}</td>
                  <td className="px-2 py-2 text-[#7C8A9C] whitespace-nowrap">{dt(o.ts)}</td>
                  <td className="px-2 py-2 font-bold whitespace-nowrap">{o.foreman}{o.driver ? <span className="text-[#7C8A9C] font-normal"> · recoge {o.driver.split(" ")[0]}</span> : null}</td>
                  <td className="px-2 py-2"><Pill color={PROVC[o.provider]}>{o.provider}</Pill></td>
                  <td className={`px-2 py-2 max-w-[170px] truncate ${!o.jobsite_known ? "text-[#FDE68A]" : ""}`}>{o.jobsite || <span className="text-[#F87171]">sin obra</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-[#B6C0CE]">{o.supervisor || (o.status === "SOLICITADO" ? <span className="text-[#5E6B7D]">esperando…</span> : "—")}{o.self_approved ? <span className="text-[9px] text-[#A78BFA] ml-1">directo</span> : null}</td>
                  <td className="px-2 py-2 mono whitespace-nowrap">{o.approved_lines != null ? <>{o.requested_lines}<span className="text-[#5E6B7D]">→</span>{o.approved_lines}{o.removed_lines ? <span className="text-[#F87171]"> −{o.removed_lines}</span> : null}{o.adjusted_lines ? <span className="text-[#FDE68A]"> ~{o.adjusted_lines}</span> : null}</> : o.requested_lines}{o.custom_lines ? <span className="text-[9px] text-[#FDE68A] ml-1">{o.custom_lines} fc</span> : null}</td>
                  <td className="px-2 py-2 mono whitespace-nowrap">{o.est_total ? money(o.est_total) : "—"}</td>
                  <td className="px-2 py-2"><Pill color={STC[o.status].c}>{STC[o.status].l}</Pill></td>
                  <td className="px-2 py-2 mono whitespace-nowrap">{o.secs_to_approve != null ? ago(o.secs_to_approve * 1000) : "—"}</td>
                  <td className="px-2 py-2 mono font-black whitespace-nowrap">{o.po || "—"}</td>
                  <td className="px-2 py-2 min-w-[220px]"><div className="flex gap-1 flex-wrap">{o.flags.slice(0, 3).map((f, i) => <Flag key={i} f={f} />)}{o.flags.length > 3 ? <span className="text-[10px] text-[#7C8A9C]">+{o.flags.length - 3}</span> : null}</div></td>
                </tr>))}
              {!shown.length ? <tr><td colSpan={12} className="text-center text-[#5E6B7D] py-8">Sin pedidos en este rango.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="text-[10px] text-[#3E4A5A] text-center pt-2 pb-6">
        Muñiz Centro de Mando · pedidos de material en vivo · cada toque en MANDAR / APROBAR / TICKET queda aquí en el instante
      </div>
    </div>

    {sel ? <OrderDetail o={sel} onClose={() => setSel(null)} /> : null}
  </>);
}

function OrderDetail({ o, onClose }) {
  const stages = ["SOLICITADO", "APROBADO", "TICKET"].filter(s => (o.lines || []).some(l => l.stage === s));
  const [st, setSt] = useState(stages[stages.length - 1] || "SOLICITADO");
  const lines = (o.lines || []).filter(l => l.stage === st);
  const tl = [["Pidió", o.submitted_at || o.requested_at, o.foreman], ["Confirmó el texto", o.confirmed_at, o.foreman], ["Aprobó", o.approved_at, o.supervisor], ["Rechazó", o.rejected_at, o.supervisor], ["PO en ticket", o.po_at, o.po]].filter(x => x[1]);
  return (
    <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-5" onClick={onClose}>
      <div className="bg-[#111823] border border-[#1E2A38] rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#1E2A38] flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black tracking-[0.16em] text-[#7C8A9C]">PEDIDO DE MATERIAL{o.is_practice ? " · PRÁCTICA" : ""}</div>
            <div className="mono display text-[26px] leading-none mt-1">{o.req_no}{o.po ? <span className="text-[#4ADE80] text-[16px] ml-3">PO {o.po}</span> : null}</div>
          </div>
          <div className="flex gap-2"><Pill color={PROVC[o.provider]}>{o.provider}</Pill><Pill color={STC[o.status].c}>{STC[o.status].l}</Pill></div>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-auto">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
            {[["Quién", `${o.foreman} · ${o.foreman_role || "—"}`], ["Obra", (o.jobsite || "—") + (!o.jobsite_known && o.jobsite ? " (a mano)" : "")], ["Obra del rol", o.jobsite_week || "—"], ["Supervisor", o.supervisor ? o.supervisor + (o.self_approved ? " (directo)" : "") : "—"],
              ["Chofer", o.driver || "—"], ["Estimado", o.est_total ? money(o.est_total) : "— (sin precio de catálogo)"], ["Agregado", o.is_addon ? "Sí · mismo PO que el anterior" : "No"], ["Tiempo a aprobar", o.secs_to_approve != null ? ago(o.secs_to_approve * 1000) : "—"]]
              .map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-[#1E2A38]/60 pb-1"><span className="text-[#7C8A9C]">{k}</span><span className="font-bold text-right truncate">{v}</span></div>)}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
            {tl.map(([k, t, who], i) => <div key={i}><span className="text-[#7C8A9C]">{k}</span> <span className="font-bold">{dt(t)}</span>{who ? <span className="text-[#5E6B7D]"> · {who}</span> : null}</div>)}
          </div>
          {o.not_found && o.not_found.length ? <div className="text-[12px] text-[#FDE68A]">Buscó y no encontró: {o.not_found.map(t => `“${t}”`).join(", ")}</div> : null}
          <div className="flex items-center gap-2">
            {stages.map(s => <button key={s} onClick={() => setSt(s)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black ${st === s ? "bg-white text-[#0B0F14]" : "bg-[#0B0F14] text-[#7C8A9C] border border-[#1E2A38]"}`}>{s === "SOLICITADO" ? "LO QUE PIDIÓ" : s === "APROBADO" ? "LO QUE APROBÓ EL SUPERVISOR" : "TICKET"}</button>)}
            <span className="ml-auto text-[11px] text-[#5E6B7D]">{lines.filter(l => !l.removed && l.authorized !== false).length} línea(s)</span>
          </div>
          <table className="w-full text-[12px]">
            <thead><tr className="text-[10px] font-black tracking-wider text-[#7C8A9C] border-b border-[#1E2A38]">{["#", "CANT", "ARTÍCULO", "CÓDIGO", "PRECIO", "TOTAL"].map(h => <th key={h} className="text-left px-2 py-1.5">{h}</th>)}</tr></thead>
            <tbody>
              {lines.map(l => {
                const dead = l.removed || l.authorized === false;
                return (
                  <tr key={l.pos} className={`border-b border-[#1E2A38]/50 ${dead ? "text-[#5E6B7D] line-through" : ""}`}>
                    <td className="px-2 py-1.5 text-[#5E6B7D]">{l.pos}</td>
                    <td className="px-2 py-1.5 mono font-black">{dead ? l.qty_requested : l.qty}{!dead && l.qty_requested != null && Number(l.qty_requested) !== Number(l.qty) ? <span className="text-[#FDE68A] font-normal"> (pidió {l.qty_requested})</span> : null}</td>
                    <td className="px-2 py-1.5">{l.descr || "—"}{l.custom ? <span className="ml-1.5 text-[9px] font-black text-[#FDE68A] no-underline">FUERA DE CATÁLOGO</span> : null}{l.removed ? <span className="ml-1.5 text-[9px] font-black text-[#F87171]">QUITADO</span> : null}{l.authorized === false ? <span className="ml-1.5 text-[9px] font-black text-[#F87171]">NO AUTORIZADO</span> : null}</td>
                    <td className="px-2 py-1.5 mono text-[#7C8A9C]">{l.code || "—"}</td>
                    <td className="px-2 py-1.5 mono">{l.unit_price != null ? money(l.unit_price) : "—"}</td>
                    <td className="px-2 py-1.5 mono">{!dead && l.unit_price != null ? money(l.line_total) : "—"}</td>
                  </tr>);
              })}
              {!lines.length ? <tr><td colSpan={6} className="text-center text-[#5E6B7D] py-6">Sin líneas en esta etapa.</td></tr> : null}
            </tbody>
          </table>
          {o.flags && o.flags.length ? <div className="pt-1 flex flex-wrap gap-1.5">{o.flags.map((f, i) => <span key={i} className={`text-[10px] font-black px-1.5 py-0.5 rounded ${f.lvl === "red" ? "bg-[#DC2626] text-white" : "bg-[#78350F] text-[#FDE68A]"}`}>{f.t}</span>)}</div> : <div className="pt-1 text-[12px] text-[#4ADE80] font-bold">Sin alertas.</div>}
          {o.notes ? <div className="text-[12px] text-[#7C8A9C]">{o.notes}</div> : null}
        </div>
        <div className="px-5 pb-4 pt-2"><button onClick={onClose} className="w-full py-2.5 rounded-xl bg-[#1A2230] font-black text-[13px]">CERRAR</button></div>
      </div>
    </div>);
}

/* ===================================================================== DASHBOARD */
function Mando({ t, onOut }) {
  const [pos, setPos] = useState([]);
  const [ev, setEv] = useState([]);
  const [veh, setVeh] = useState([]);
  const [ppl, setPpl] = useState([]);
  const [err, setErr] = useState("");
  const [sync, setSync] = useState(0);
  const [range, setRange] = useState(7);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("pos");
  const [sel, setSel] = useState(null);
  const [mode, setMode] = useState(() => { try { return localStorage.getItem("muniz_mando_mode") || "pedidos"; } catch (e) { return "pedidos"; } });
  const [orders, setOrders] = useState([]);
  const pedCsv = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    let on = true;
    const pull = async () => {
      try {
        const [p, mo, e, v, pe] = await Promise.all([
          get("fuel_pos?select=*&order=created_at.desc&limit=3000", t.access_token),
          get("material_orders_full?select=*&order=created_at.desc&limit=2000", t.access_token).catch(x => { if (x.status === 404 || /material_orders_full/.test(String(x.message))) return "__nofase2__"; throw x; }),
          get("events?select=ts,device_id,who,event,step,meta,app&order=ts.desc&limit=1200", t.access_token),
          get("vehicles?select=*&order=id", t.access_token),
          get("people?select=name,role,active", t.access_token)]);
        if (!on) return;
        setPos(p.map(r => ({
          po: r.po, ts: new Date(r.created_at).getTime(), who: r.who, role: r.role, vid: r.vehicle_id,
          veh: r.vehicle_desc, tipo: r.tipo, comb: r.comb, placa: r.plate || "", equipo: r.equipo || "",
          lectura: r.reading, obra: r.jobsite, obraOtra: r.jobsite_other, obraSemana: r.jobsite_week || "",
          est: r.station, plateTyped: r.plate_typed, secs: r.seconds_to_po, srvFlags: r.flags || [],
          gal: r.gallons, amt: r.amount, dev: r.device_id })));
        setOrders(mo === "__nofase2__" ? [] : mo.map(r => ({ ...r, ts: new Date(r.submitted_at || r.requested_at || r.created_at).getTime() })));
        setEv(e); setVeh(v); setPpl(pe); setErr(mo === "__nofase2__" ? "Falta correr supabase_fase2.sql (pedidos)" : ""); setSync(Date.now()); first.current = false;
      } catch (x) { if (on) setErr(x.status === 401 ? "Sesión expirada — vuelve a entrar" : String(x.message || x).slice(0, 160)); }
    };
    pull(); const iv = setInterval(pull, 7000);
    return () => { on = false; clearInterval(iv); };
  }, [t]);

  const now = Date.now();
  const cut = range === 0 ? 0 : now - range * 864e5;
  const inRange = useMemo(() => pos.filter(p => p.ts >= cut), [pos, range]);
  const flagged = useMemo(() => inRange.map(p => ({ ...p, flags: flagsFor(p, pos) })), [inRange, pos]);
  const reds = flagged.filter(p => p.flags.some(f => f.lvl === "red"));
  const ambers = flagged.filter(p => p.flags.length && !p.flags.some(f => f.lvl === "red"));

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const todayL = pos.filter(p => p.ts >= today0.getTime());
  const secs = inRange.map(p => p.secs).filter(s => s != null && s > 0);

  /* live: last event per device in the past 6 minutes */
  const live = useMemo(() => {
    const m = {}; const c = now - 6 * 60e3;
    ev.forEach(e => { const ts = new Date(e.ts).getTime(); if (ts > c) { const k = e.device_id || e.who; if (!m[k] || m[k].ts < ts) m[k] = { ts, who: e.who, step: e.step, event: e.event, app: e.app || "fuel" }; } });
    return Object.values(m).sort((a, b) => b.ts - a.ts);
  }, [ev, now]);

  /* per-day volume */
  const days = useMemo(() => {
    const d = []; const n = range === 0 ? 30 : Math.min(range, 30);
    for (let i = n - 1; i >= 0; i--) { const x = new Date(now - i * 864e5); const k = dayKey(x); d.push({ label: dayLabel(k), key: k, v: 0 }); }
    const idx = {}; d.forEach((x, i) => idx[x.key] = i);
    pos.forEach(p => { const i = idx[dayKey(p.ts)]; if (i != null) d[i].v++; });
    return d;
  }, [pos, range, now]);

  /* step timings from the event stream: where people actually spend time */
  const stepTimes = useMemo(() => {
    const byDev = {};
    [...ev].reverse().forEach(e => { if (e.event !== "step" || !e.device_id) return; (byDev[e.device_id] = byDev[e.device_id] || []).push(e); });
    const acc = {};
    Object.values(byDev).forEach(list => {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        if (b.step !== a.step + 1) continue;
        const d = (new Date(b.ts) - new Date(a.ts)) / 1000;
        if (d <= 0 || d > 600) continue;
        (acc[a.step] = acc[a.step] || []).push(d);
      }
    });
    const names = { 1: "Nombre", 2: "Vehículo", 3: "Placa/equipo", 4: "Lectura", 5: "Obra", 6: "Estación" };
    return Object.keys(acc).sort().map(k => ({ step: k, name: names[k] || "Paso " + k, med: median(acc[k]), n: acc[k].length }));
  }, [ev]);

  const byKey = (arr, f) => { const m = {}; arr.forEach(x => { const k = f(x) || "—"; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };

  const fleet = useMemo(() => veh.map(v => {
    const h = pos.filter(p => p.vid === v.id).sort((a, b) => b.ts - a.ts);
    const l = h[0];
    const wk = h.filter(p => now - p.ts < 7 * 864e5).length;
    let miles = null;
    if (h.length >= 2 && h[0].lectura != null && h[1].lectura != null) miles = Number(h[0].lectura) - Number(h[1].lectura);
    const typed = (h.find(p => p.plateTyped && p.placa) || {}).placa;
    return { ...v, fills: h.length, last: l, wk, miles, typed, all: h };
  }).sort((a, b) => b.fills - a.fills), [veh, pos, now]);

  const people = useMemo(() => {
    const m = {};
    inRange.forEach(p => { const x = (m[p.who] = m[p.who] || { who: p.who, n: 0, secs: [], flags: 0, vids: new Set(), est: {} });
      x.n++; if (p.secs) x.secs.push(p.secs); x.vids.add(p.vid); x.est[p.est] = (x.est[p.est] || 0) + 1; });
    flagged.forEach(p => { if (p.flags.length && m[p.who]) m[p.who].flags += p.flags.length; });
    return Object.values(m).map(x => ({ ...x, med: median(x.secs), vehicles: x.vids.size })).sort((a, b) => b.n - a.n);
  }, [inRange, flagged]);

  const csv = () => {
    const cl = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const H = ["po", "fecha", "hora", "quien", "rol", "vehiculo_id", "vehiculo", "tipo", "combustible", "placa", "equipo", "lectura", "obra", "obra_rol", "estacion", "segundos_al_po", "galones", "importe", "alertas"];
    const R = flagged.map(p => { const d = new Date(p.ts); return [p.po, d.toLocaleDateString("es-MX"), hhmm(p.ts), p.who, p.role, p.vid, p.veh, p.tipo, p.comb, p.placa, p.equipo, p.lectura, p.obra, p.obraSemana, p.est, p.secs, p.gal, p.amt, p.flags.map(f => f.t).join(" | ")].map(cl).join(","); });
    const b = new Blob(["\uFEFF" + [H.join(","), ...R].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `combustible_${dayKey(now)}.csv`; a.click();
  };

  const shown = flagged.filter(p => !q || `${p.po} ${p.who} ${p.placa} ${p.obra} ${p.veh} ${p.equipo}`.toLowerCase().includes(q.toLowerCase()));

  const Flag = ({ f }) => <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${f.lvl === "red" ? "bg-[#DC2626] text-white" : "bg-[#78350F] text-[#FDE68A]"}`}>{f.t}</span>;

  return (
    <div className="min-h-screen">
      {/* top bar */}
      <div className="sticky top-0 z-20 bg-[#0B0F14]/95 backdrop-blur border-b border-[#1E2A38] px-5 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${mode === "pedidos" ? "bg-[#FF5A00]" : "bg-[#F5B800]"}`}>{mode === "pedidos" ? "🧱" : "⛽"}</div>
          <div className="mr-auto">
            <div className="text-[9px] font-black tracking-[0.2em] text-[#7C8A9C]">MUÑIZ CONCRETE &amp; CONTRACTING</div>
            <div className="display text-[19px] leading-tight">Centro de mando · {mode === "pedidos" ? "Pedidos de material" : "Combustible"}</div>
          </div>
          <div className="flex items-center gap-1 bg-[#111823] border border-[#1E2A38] rounded-lg p-0.5">
            {[["pedidos", "🧱 PEDIDOS"], ["fuel", "⛽ COMBUSTIBLE"]].map(([k, l]) => (
              <button key={k} onClick={() => { setMode(k); try { localStorage.setItem("muniz_mando_mode", k); } catch (e) {} }} className={`px-3 py-1.5 rounded-md text-[11px] font-black ${mode === k ? "bg-white text-[#0B0F14]" : "text-[#7C8A9C]"}`}>{l}</button>))}
          </div>
          <div className="flex items-center gap-1.5">
            {[[1, "HOY"], [7, "7 DÍAS"], [30, "30 DÍAS"], [0, "TODO"]].map(([v, l]) => (
              <button key={v} onClick={() => setRange(v)} className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black ${range === v ? "bg-[#F5B800] text-[#0B0F14]" : "bg-[#111823] text-[#7C8A9C] border border-[#1E2A38]"}`}>{l}</button>))}
          </div>
          <div className={`text-[11px] font-black ${err ? "text-[#F87171]" : "text-[#4ADE80]"}`}>{err ? "⚠ " + err : `● EN VIVO · ${sync ? hhmm(sync) : "…"}`}</div>
          <button onClick={() => mode === "pedidos" ? (pedCsv.current && pedCsv.current()) : csv()} className="px-3 py-1.5 rounded-lg bg-[#111823] border border-[#1E2A38] text-[11px] font-black">⬇ CSV</button>
          <div className="text-[11px] text-[#5E6B7D]">{t.email}</div>
          <button onClick={onOut} className="text-[11px] font-black text-[#7C8A9C]">SALIR</button>
        </div>
      </div>

      {mode === "pedidos" ? <Pedidos orders={orders} range={range} q={q} setQ={setQ} live={live} now={now} onCsvRef={pedCsv} /> : null}

      {mode === "fuel" ? <><div className="px-5 py-4 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Kpi label="HOY" value={todayL.length} sub={`${todayL.filter(p => p.comb === "DIESEL").length} diésel · ${todayL.filter(p => p.comb === "GASOLINA").length} gas`} />
          <Kpi label={range === 0 ? "TOTAL" : `${range} DÍA${range > 1 ? "S" : ""}`} value={inRange.length} sub={`${(inRange.length / Math.max(1, range === 0 ? 30 : range)).toFixed(1)} por día`} />
          <Kpi label="TIEMPO POR PO" value={mmss(median(secs))} sub={secs.length ? `mediana de ${secs.length}` : "sin datos"} tone="#F5B800" />
          <Kpi label="ALERTAS ROJAS" value={reds.length} tone={reds.length ? "#F87171" : undefined} sub={`${ambers.length} ámbar`} />
          <Kpi label="EN EL APP AHORA" value={live.length} sub={live.length ? live.slice(0, 2).map(x => (x.who || "").split(" ")[0]).join(", ") : "nadie"} tone={live.length ? "#4ADE80" : undefined} />
          <Kpi label="PERSONAS" value={people.length} sub={`de ${ppl.filter(p => p.active).length} activas`} />
          <Kpi label="VEHÍCULOS" value={fleet.filter(f => f.fills).length} sub={`de ${veh.length} en la flota`} />
        </div>

        {/* live + volume */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card title="ACTIVIDAD EN VIVO" right={<span className="text-[10px] text-[#5E6B7D]">últimos 6 min</span>} className="xl:col-span-1">
            {live.length ? (
              <div className="space-y-1.5 max-h-[190px] overflow-auto">
                {live.map((x, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] shrink-0" />
                    <span className="font-black truncate">{x.who || "—"}</span>
                    <span className="text-[#7C8A9C] ml-auto shrink-0">
                      {x.app === "pedidos" ? "🧱 " : ""}{x.event === "po_created" ? "✓ generó PO" : x.event === "sent" ? "✓ mandó pedido" : x.event === "aprobado" ? "✓ aprobó" : x.event === "ticket" ? "✓ ticket" : x.event === "error" ? "⚠ error" : x.step ? `paso ${x.step}` : "abrió"} · {hhmm(x.ts)}
                    </span>
                  </div>))}
              </div>) : <div className="text-[12px] text-[#5E6B7D] py-6 text-center">Nadie en el app en este momento.</div>}
          </Card>
          <Card title="POs POR DÍA" className="xl:col-span-2">
            <Bars data={days} />
          </Card>
        </div>

        {/* splits */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card title="COMBUSTIBLE">
            <Split parts={[{ label: "Diésel", v: inRange.filter(p => p.comb === "DIESEL").length, color: FUELC.DIESEL },
                            { label: "Gasolina", v: inRange.filter(p => p.comb === "GASOLINA").length, color: FUELC.GASOLINA }]} />
          </Card>
          <Card title="ESTACIÓN">
            <Split parts={[{ label: "Tex-Con", v: inRange.filter(p => p.est === "TEXCON").length, color: "#1D4ED8" },
                            { label: "Leo's", v: inRange.filter(p => p.est === "LEOS").length, color: "#F5B800" }]} />
          </Card>
          <Card title="TIPO DE UNIDAD">
            <Split parts={[{ label: "Camioneta", v: inRange.filter(p => p.tipo === "CAMIONETA").length, color: "#38BDF8" },
                            { label: "Maquinaria", v: inRange.filter(p => p.tipo === "MAQUINARIA").length, color: "#A78BFA" },
                            { label: "Tambo", v: inRange.filter(p => p.tipo === "TAMBO").length, color: "#FB7185" },
                            { label: "Pipa", v: inRange.filter(p => p.tipo === "PIPA").length, color: "#34D399" }]} />
          </Card>
        </div>

        {/* jobsites + step timing */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="CARGAS POR OBRA" right={<span className="text-[10px] text-[#5E6B7D]">top 10</span>}>
            {byKey(inRange, p => p.obra).slice(0, 10).map(([k, v], i) => (
              <div key={k} className="flex items-center gap-2 py-1">
                <div className="text-[12px] w-6 text-[#5E6B7D]">{i + 1}</div>
                <div className="text-[12px] font-bold truncate flex-1">{k}</div>
                <div className="h-2 rounded-full bg-[#F5B800]" style={{ width: `${v / byKey(inRange, p => p.obra)[0][1] * 120}px` }} />
                <div className="text-[12px] font-black w-8 text-right">{v}</div>
              </div>))}
            {!inRange.length ? <div className="text-[12px] text-[#5E6B7D] py-6 text-center">Sin datos todavía.</div> : null}
          </Card>
          <Card title="DÓNDE SE TARDAN (mediana por paso)" right={<span className="text-[10px] text-[#5E6B7D]">del flujo real</span>}>
            {stepTimes.length ? stepTimes.map(s => (
              <div key={s.step} className="flex items-center gap-2 py-1">
                <div className="text-[12px] w-6 text-[#5E6B7D]">{s.step}</div>
                <div className="text-[12px] font-bold flex-1">{s.name}</div>
                <div className="h-2 rounded-full bg-[#38BDF8]" style={{ width: `${Math.min(140, (s.med || 0) * 4)}px` }} />
                <div className="text-[12px] font-black w-14 text-right">{s.med ? s.med.toFixed(0) + "s" : "—"}</div>
                <div className="text-[10px] text-[#5E6B7D] w-8 text-right">n={s.n}</div>
              </div>)) : <div className="text-[12px] text-[#5E6B7D] py-6 text-center">Se llena conforme la gente use el app.</div>}
          </Card>
        </div>

        {/* alerts */}
        {reds.length ? (
          <Card title="ALERTAS ROJAS · REVISAR" right={<span className="text-[10px] font-black text-[#F87171]">{reds.length}</span>}>
            <div className="space-y-1.5">
              {reds.slice(0, 8).map(p => (
                <div key={p.po} className="flex items-center gap-3 text-[12px] bg-[#1A0E0E] border border-[#DC2626]/40 rounded-lg px-3 py-2">
                  <span className="mono font-black">{p.po}</span>
                  <span className="font-bold">{p.who}</span>
                  <span className="text-[#7C8A9C] truncate">{p.veh}{p.placa ? " · " + p.placa : ""}</span>
                  <span className="ml-auto flex gap-1 flex-wrap justify-end">{p.flags.filter(f => f.lvl === "red").map((f, i) => <Flag key={i} f={f} />)}</span>
                </div>))}
            </div>
          </Card>) : null}

        {/* tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {[["pos", `POs · ${flagged.length}`], ["fleet", `FLOTA · ${veh.length}`], ["people", `PERSONAS · ${people.length}`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded-lg text-[12px] font-black ${tab === k ? "bg-white text-[#0B0F14]" : "bg-[#111823] text-[#7C8A9C] border border-[#1E2A38]"}`}>{l}</button>))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar PO, nombre, placa, obra…"
            className="ml-auto w-72 h-9 rounded-lg bg-[#111823] border border-[#1E2A38] px-3 text-[13px] outline-none focus:border-[#F5B800]" />
        </div>

        {tab === "pos" ? (
          <Card>
            <div className="overflow-auto -mx-1">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] font-black tracking-wider text-[#7C8A9C] border-b border-[#1E2A38]">
                    {["PO", "FECHA", "QUIÉN", "UNIDAD", "COMB", "LECTURA", "OBRA", "EST", "TIEMPO", "ALERTAS"].map(h => <th key={h} className="text-left px-2 py-2 whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(p => (
                    <tr key={p.po} onClick={() => setSel(p)} className="border-b border-[#1E2A38]/60 hover:bg-[#141C28] cursor-pointer">
                      <td className="px-2 py-2 mono font-black whitespace-nowrap">{p.po}</td>
                      <td className="px-2 py-2 text-[#7C8A9C] whitespace-nowrap">{dt(p.ts)}</td>
                      <td className="px-2 py-2 font-bold whitespace-nowrap">{p.who}</td>
                      <td className="px-2 py-2 text-[#B6C0CE] max-w-[190px] truncate">{p.placa || p.equipo || p.vid}</td>
                      <td className="px-2 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-black text-white" style={{ background: FUELC[p.comb] }}>{p.comb}</span></td>
                      <td className="px-2 py-2 mono whitespace-nowrap">{N(p.lectura)}</td>
                      <td className="px-2 py-2 max-w-[170px] truncate">{p.obra}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{p.est === "LEOS" ? "Leo's" : "Tex-Con"}</td>
                      <td className="px-2 py-2 mono whitespace-nowrap">{mmss(p.secs)}</td>
                      <td className="px-2 py-2"><div className="flex gap-1 flex-wrap">{p.flags.slice(0, 3).map((f, i) => <Flag key={i} f={f} />)}{p.flags.length > 3 ? <span className="text-[10px] text-[#7C8A9C]">+{p.flags.length - 3}</span> : null}</div></td>
                    </tr>))}
                  {!shown.length ? <tr><td colSpan={10} className="text-center text-[#5E6B7D] py-8">Sin POs en este rango.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Card>) : null}

        {tab === "fleet" ? (
          <Card>
            <div className="overflow-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-[10px] font-black tracking-wider text-[#7C8A9C] border-b border-[#1E2A38]">
                  {["UNIDAD", "ASIGNADA A", "COMB", "PLACA", "CARGAS", "7 DÍAS", "ÚLTIMA LECTURA", "Δ ÚLTIMA", "ÚLTIMA CARGA"].map(h => <th key={h} className="text-left px-2 py-2 whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {fleet.map(v => (
                    <tr key={v.id} className="border-b border-[#1E2A38]/60 hover:bg-[#141C28]">
                      <td className="px-2 py-2 mono font-black">{v.id}</td>
                      <td className="px-2 py-2 max-w-[200px] truncate">{v.assigned_to || <span className="text-[#5E6B7D]">compartido</span>}</td>
                      <td className="px-2 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-black text-white" style={{ background: FUELC[v.comb] }}>{v.comb}</span></td>
                      <td className="px-2 py-2 mono">{v.plate ? v.plate : v.typed ? <span className="text-[#FDE68A]">{v.typed} (dictada)</span> : <span className="text-[#F87171]">falta</span>}</td>
                      <td className="px-2 py-2 font-black">{v.fills}</td>
                      <td className={`px-2 py-2 font-black ${v.wk > AL.MAX_7D ? "text-[#FDE68A]" : ""}`}>{v.wk}</td>
                      <td className="px-2 py-2 mono">{v.last ? N(v.last.lectura) : "—"}</td>
                      <td className={`px-2 py-2 mono ${v.miles != null && v.miles < AL.MIN_MI ? "text-[#FDE68A]" : ""}`}>{v.miles == null ? "—" : N(v.miles)}</td>
                      <td className="px-2 py-2 text-[#7C8A9C] whitespace-nowrap">{v.last ? dt(v.last.ts) : "nunca"}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
          </Card>) : null}

        {tab === "people" ? (
          <Card>
            <div className="overflow-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-[10px] font-black tracking-wider text-[#7C8A9C] border-b border-[#1E2A38]">
                  {["PERSONA", "CARGAS", "VEHÍCULOS", "TIEMPO POR PO", "TEX-CON", "LEO'S", "ALERTAS"].map(h => <th key={h} className="text-left px-2 py-2 whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody>
                  {people.map(p => (
                    <tr key={p.who} className="border-b border-[#1E2A38]/60 hover:bg-[#141C28]">
                      <td className="px-2 py-2 font-bold">{p.who}</td>
                      <td className="px-2 py-2 font-black">{p.n}</td>
                      <td className={`px-2 py-2 ${p.vehicles > 2 ? "text-[#FDE68A] font-black" : ""}`}>{p.vehicles}</td>
                      <td className="px-2 py-2 mono">{mmss(p.med)}</td>
                      <td className="px-2 py-2">{p.est.TEXCON || 0}</td>
                      <td className="px-2 py-2">{p.est.LEOS || 0}</td>
                      <td className={`px-2 py-2 font-black ${p.flags ? "text-[#FDE68A]" : "text-[#5E6B7D]"}`}>{p.flags}</td>
                    </tr>))}
                  {!people.length ? <tr><td colSpan={7} className="text-center text-[#5E6B7D] py-8">Sin datos en este rango.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Card>) : null}

        <div className="text-[10px] text-[#3E4A5A] text-center pt-2 pb-6">
          Muñiz Centro de Mando · datos en vivo de la base de datos · se actualiza cada 7 segundos
        </div>
      </div>

      {/* PO detail */}
      {sel ? (
        <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-5" onClick={() => setSel(null)}>
          <div className="bg-[#111823] border border-[#1E2A38] rounded-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#1E2A38] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black tracking-[0.16em] text-[#7C8A9C]">PO DE COMBUSTIBLE</div>
                <div className="mono display text-[26px] leading-none mt-1">{sel.po}</div>
              </div>
              <span className="px-2.5 py-1 rounded-lg text-[12px] font-black text-white" style={{ background: FUELC[sel.comb] }}>{sel.comb}</span>
            </div>
            <div className="px-5 py-4 space-y-2">
              {[["Fecha", dt(sel.ts)], ["Quién", `${sel.who} · ${sel.role || "—"}`], ["Unidad", `${sel.veh} (${sel.vid})`],
                ["Placa / equipo", sel.placa || sel.equipo || "—"], [sel.tipo === "MAQUINARIA" ? "Horas" : "Odómetro", N(sel.lectura)],
                ["Obra", sel.obra], ["Obra del rol", sel.obraSemana || "—"], ["Estación", sel.est === "LEOS" ? "Leo's Service Station" : "Tex-Con Oil"],
                ["Tiempo en el app", mmss(sel.secs)], ["Galones", sel.gal == null ? "— (de la factura)" : N(sel.gal)], ["Importe", sel.amt == null ? "— (de la factura)" : money(sel.amt)]]
                .map(([k, v]) => <div key={k} className="flex justify-between gap-4 text-[13px] border-b border-[#1E2A38]/60 pb-1.5"><span className="text-[#7C8A9C]">{k}</span><span className="font-bold text-right">{v}</span></div>)}
              {sel.flags.length ? <div className="pt-2 flex flex-wrap gap-1.5">{sel.flags.map((f, i) => <Flag key={i} f={f} />)}</div> : <div className="pt-2 text-[12px] text-[#4ADE80] font-bold">Sin alertas.</div>}
            </div>
            <div className="px-5 pb-4"><button onClick={() => setSel(null)} className="w-full py-2.5 rounded-xl bg-[#1A2230] font-black text-[13px]">CERRAR</button></div>
          </div>
        </div>) : null}</> : null}
    </div>);
}

function App() {
  const [t, setT] = useState(tok());
  if (!SB_URL || !SB_KEY) return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div><div className="text-5xl">🔌</div>
        <div className="display text-[22px] mt-3">Falta conectar la base de datos</div>
        <div className="text-[13px] text-[#7C8A9C] mt-2">Pon URL y ANON_KEY en config.js → SUPABASE.</div></div>
    </div>);
  if (!t) return <Login onOk={setT} />;
  return <Mando t={t} onOut={() => { localStorage.removeItem(K_TOK); setT(null); }} />;
}

createRoot(document.getElementById("root")).render(<App />);
