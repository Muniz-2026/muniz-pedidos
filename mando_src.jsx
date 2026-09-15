/* ============================================================================
   MUÑIZ OPS · COMMAND CENTER · v2.1  (session auto-renew · Tex-Con in LEDGER/FUEL · >1,000-row paging)
   English. Office only. Field apps (pedidos / fuel / bandeja) are untouched.
   One data pull every 7 s feeds six rooms:
     SITUATION · ORDERS · FUEL · FLEET · PEOPLE · RULES
   ============================================================================ */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/* ---------- plumbing ---------- */
const CFG = (typeof window !== "undefined" && window.MUNIZ_CONFIG) || {};
const SB = CFG.SUPABASE || {};
const SB_URL = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/auth\/v1$/, "");
const SB_KEY = String(SB.ANON_KEY || "").trim();
const K_TOK = "muniz_office_token", K_ROOM = "muniz_ops_room";
/* Session: Supabase access tokens live ~1 h. We keep the refresh_token and renew silently before expiry
   (and once more on a 401 / "JWT expired" reply). If renewal fails, the app drops to the sign-in screen
   instead of showing red JSON in the header. */
const TOK = { cur: null, inflight: null };
const readTok = () => { try { return JSON.parse(localStorage.getItem(K_TOK) || "null"); } catch (e) { return null; } };
const saveTok = j => { const t = { access_token: j.access_token, refresh_token: j.refresh_token || TOK.cur?.refresh_token || null, email: j.user?.email || j.email || TOK.cur?.email || "", exp: Math.floor(Date.now() / 1000) + (j.expires_in || 3600) }; TOK.cur = t; localStorage.setItem(K_TOK, JSON.stringify(t)); return t; };
const signOut = () => { TOK.cur = null; localStorage.removeItem(K_TOK); window.dispatchEvent(new Event("muniz-signout")); };
const tok = () => { const t = readTok(); if (!t) return null; if (t.exp * 1000 > Date.now() || t.refresh_token) { TOK.cur = t; return t; } localStorage.removeItem(K_TOK); return null; };
async function refreshTok() {
  if (TOK.inflight) return TOK.inflight;
  const rt = TOK.cur?.refresh_token; if (!rt) { signOut(); throw new Error("Session expired — sign in again."); }
  TOK.inflight = (async () => {
    try { const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }) });
      if (!r.ok) { signOut(); throw new Error("Session expired — sign in again."); } return saveTok(await r.json()); }
    finally { TOK.inflight = null; }
  })(); return TOK.inflight;
}
async function bearer(t) { const c = TOK.cur || (typeof t === "object" && t) || null; if (!c) return typeof t === "string" ? t : ""; if (c.exp * 1000 - Date.now() < 120e3 && c.refresh_token) { try { return (await refreshTok()).access_token; } catch (e) { return c.access_token; } } return c.access_token; }
const hdr = t => ({ apikey: SB_KEY, Authorization: `Bearer ${t}` });
const expired = (r, txt) => r.status === 401 || /PGRST30[13]|JWT expired|jwt expired/i.test(txt || "");
async function call(url, init, t, retry = true) {
  const a = await bearer(t); const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), ...hdr(a) } });
  if (!r.ok) { const txt = await r.text(); if (retry && expired(r, txt)) { if (!(TOK.cur && TOK.cur.access_token !== a)) await refreshTok(); return call(url, init, t, false); } const e = new Error(txt); e.status = r.status; throw e; }
  return r;
}
async function get(path, t) { const r = await call(`${SB_URL}/rest/v1/${path}`, {}, t); return r.json(); }
/* PostgREST caps a response at 1,000 rows. getAll pages with Range until a short page comes back (max `pages`). */
async function getAll(path, t, pages = 8) { const out = []; for (let i = 0; i < pages; i++) { const r = await call(`${SB_URL}/rest/v1/${path}`, { headers: { Range: `${i * 1000}-${i * 1000 + 999}` } }, t); const x = await r.json(); if (!Array.isArray(x)) break; out.push(...x); if (x.length < 1000) break; } return out; }
async function patch(path, body, t) { await call(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(body) }, t); }
async function rpc(fn, args, t) { const r = await call(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args || {}) }, t); const x = await r.text(); return x ? JSON.parse(x) : null; }
async function login(email, password) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error("login"); const j = await r.json(); return saveTok({ ...j, email: j.user?.email || email });
}
const safe = p => p.then(x => Array.isArray(x) ? x : []).catch(() => []);

/* ---------- formatting ---------- */
const money = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = n => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");
const N = n => (n == null || n === "") ? "—" : Number(n).toLocaleString("en-US");
const ago = s => { const m = Math.round(s / 60); if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}`; return `${Math.floor(h / 24)}d`; };
const hhmm = ts => new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dt = ts => new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const first = n => String(n || "").split(" ")[0];
const title = s => String(s || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

/* ---------- palette ---------- */
const C = { bg: "#05070B", panel: "#0A0E15", line: "#1A2230", line2: "#243040", ink: "#E8ECF2", dim: "#7B8797", faint: "#3C4757",
  green: "#3DFF8F", amber: "#FFB020", red: "#FF3B3B", cyan: "#4CC9FF", violet: "#A78BFA", orange: "#FF5A00" };
const PROV = { ACE: C.orange, CMC: "#3B82F6", RSS: C.violet, WHITECAP: C.amber, TEXCON: "#D9A441", LEOS: "#8FB3FF" };
const LANE = { VERDE: C.green, AMARILLO: C.amber, ROJO: C.red, PRACTICA: C.faint };
const ORDER_STATUS = { SOLICITADO: ["AWAITING SUPERVISOR", C.amber], APROBADO: ["APPROVED · NO PO", C.cyan], PO_ASIGNADO: ["PO ISSUED", C.green], RECHAZADO: ["REJECTED", C.red] };

/* ---------- atoms ---------- */
const Tick = () => <><i className="tk tl" /><i className="tk tr" /><i className="tk bl" /><i className="tk br" /></>;
const Panel = ({ title, right, children, className = "", flush }) => (
  <section className={`panel ${className}`}><Tick />
    {title ? <header className="ph"><span className="pt">{title}</span>{right ? <span className="pr">{right}</span> : null}</header> : null}
    <div className={flush ? "" : "pb"}>{children}</div>
  </section>);
const Tag = ({ c, children, dim }) => <span className={`tag ${dim ? "dim" : ""}`} style={{ "--c": c }}>{children}</span>;
const Dot = ({ c, pulse }) => <i className={`dot ${pulse ? "pulse" : ""}`} style={{ background: c, color: c }} />;
function Metric({ label, value, unit, sub, tone, big, trend }) {
  return (
    <div className="metric"><Tick />
      <div className="ml">{label}</div>
      <div className={`mv ${big ? "big" : ""}`} style={{ color: tone || C.ink }}>{value}<span className="mu">{unit || ""}</span></div>
      {sub || trend != null ? <div className="ms">{trend != null ? <span className={`mtr ${trend >= 0 ? "up" : "down"}`}>{trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}% </span> : null}{sub}</div> : null}
    </div>);
}
function Bars({ data, color, h = 90 }) {
  const max = Math.max(...data.map(d => d.v), 1);
  return (<div className="bars" style={{ height: h }}>
    {data.map((d, i) => <div key={i} className="bar" title={`${d.label}: ${d.v}`}><div className="bv" style={{ height: `${d.v / max * 100}%`, background: color }} />{d.v && data.length <= 16 ? <span className="bnum">{d.v}</span> : null}<span className="bl">{d.label}</span></div>)}
  </div>);
}
function Ring({ pct, color, size = 64 }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
  return (<div className="ring" style={{ width: size, height: size }}>
    <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} stroke={C.line2} strokeWidth="4" fill="none" /><circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="4" fill="none" strokeDasharray={`${c * p / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} /></svg>
    <div className="rv" style={{ color }}>{pct == null ? "—" : Math.round(pct) + "%"}</div>
  </div>);
}
const Split = ({ parts }) => { const t = parts.reduce((a, p) => a + p.v, 0) || 1; return (<div className="split"><div className="sb">{parts.map((p, i) => <div key={i} style={{ width: `${p.v / t * 100}%`, background: p.c }} />)}</div><div className="sl">{parts.map((p, i) => <span key={i}><Dot c={p.c} /> {p.label} <b>{p.v}</b> <em>{Math.round(p.v / t * 100)}%</em></span>)}</div></div>); };
const Th = ({ cols }) => <thead><tr>{cols.map((c, i) => <th key={i} className={/^(\$|#|QTY|MI|GAL|IDLE|%|POs|LINES|READING)/.test(c) ? "r" : ""}>{c}</th>)}</tr></thead>;
const Empty = ({ children, ok }) => <div className={`empty ${ok ? "ok" : ""}`}>{children}</div>;

/* ============================================================================
   DATA · one pull, every 7 s
   ============================================================================ */
function useOps(t) {
  const [d, setD] = useState({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    const pull = async () => {
      try {
        const a = t.access_token;
        const [fuel, fuelTest, orders, ev, veh, ppl, tickets, fleet, fuelGps, lastPo, unitDay, oev, notif, rules, stationVisits, ledger, poLog] = await Promise.all([
          get("fuel_pos_flagged?select=*&order=created_at.desc&limit=3000", a),
          safe(get("fuel_pos?select=id,po,created_at,who,role,vehicle_id,vehicle_desc,plate,comb,reading,jobsite,station,gallons,amount,is_practice,notes&is_practice=eq.true&order=created_at.desc&limit=500", a)),
          safe(get("material_orders_full?select=*&order=created_at.desc&limit=2000", a)),
          get("events?select=ts,device_id,who,event,step,meta,app&order=ts.desc&limit=1500", a),
          get("vehicles?select=*&order=id", a),
          get("people?select=name,role,active,supervisor,pm,same_as,pin,can_order,notes,phone,email", a),
          safe(getAll("station_tickets?select=*&order=ticket_date.desc", a, 5)),
          safe(get("gps_fleet_now?select=*&order=last_seen.desc", a)),
          safe(get("fuel_gps_check?select=*&order=created_at.desc&limit=300", a)),
          safe(get("office_last_po?select=*", a)),
          safe(get("unit_day?select=*&order=day.desc&limit=3000", a)),
          safe(get("material_order_events?select=order_id,ts,stage,actor,meta&order=ts.desc&limit=400", a)),
          safe(get("notifications?select=*&order=created_at.desc&limit=200", a)),
          safe(get("rules_config?select=*", a)),
          safe(get("gps_positions?select=actsoft_id,ts,geofence,status,ignition&geofence=not.is.null&order=ts.desc&limit=600", a)),
          safe(getAll("ledger_invoices?select=*&inv_date=gte.2026-01-01&order=inv_date.desc", a, 6)),
          safe(getAll("po_log?select=po,po_date,project,creator,vendor,description&po_date=gte.2026-01-01&order=po_date.desc", a, 10)),
        ]);
        rpc("verify_pending_fuel", {}, a).catch(() => {}); rpc("escalate_pending", {}, a).catch(() => {});
        if (!on) return;
        setD({ loading: false, fuel: fuel.map(p => ({ ...p, ts: new Date(p.created_at).getTime() })), orders: orders.map(o => ({ ...o, ts: new Date(o.submitted_at || o.requested_at || o.created_at).getTime() })),
          fuelTest: fuelTest || [], ev, veh, ppl, tickets, fleet, fuelGps, lastPo: (lastPo || [])[0] || null, unitDay, oev, notif, rules, stationVisits, ledger, poLog, sync: Date.now(), err: "" });
      } catch (e) { if (on) setD(x => ({ ...x, loading: false, err: /JWT|PGRST30|Session expired/i.test(String(e.message || e)) ? "SESSION EXPIRED · renewing…" : String(e.message || e).slice(0, 160) })); }
    };
    pull(); const iv = setInterval(pull, 7000); return () => { on = false; clearInterval(iv); };
  }, [t, tick]);
  return [d, () => setTick(x => x + 1)];
}

/* ---------- derived: who decided an order (falls back to the approval/rejection event) ---------- */
function deciderMap(oev) { const m = {}; (oev || []).forEach(e => { if ((e.stage === "APROBADO" || e.stage === "RECHAZADO") && e.actor && !m[e.order_id]) m[e.order_id] = e.actor; }); return m; }
const decidedBy = (o, dm) => o.decided_by || (dm && dm[o.id]) || null;

/* ---------- derived: the signal feed ---------- */
function buildSignals(d) {
  const s = [];
  const ordersById = Object.fromEntries((d.orders || []).map(o => [o.id, o]));
  (d.oev || []).forEach(e => { const o = ordersById[e.order_id]; if (!o || o.is_practice) return;
    const m = { SOLICITADO: ["order", C.amber, `${title(o.foreman)} requested ${o.requested_lines} line${o.requested_lines === 1 ? "" : "s"} · ${o.provider}${o.est_total ? " · " + money(o.est_total) : ""}`],
      APROBADO: ["order", e.actor === "REGLAS" ? C.green : C.cyan, e.actor === "REGLAS" ? `Rules auto-approved ${o.req_no} · ${title(o.foreman)} · ${money(o.est_total)}` : `${title(e.actor)} approved ${o.req_no} · ${title(o.foreman)}${e.meta?.removed?.length ? ` · cut ${e.meta.removed.length}` : ""}`],
      RECHAZADO: ["order", C.red, e.actor === "REGLAS" ? `Rules rejected ${o.req_no} · ${title(o.foreman)}` : `${title(e.actor)} rejected ${o.req_no} · ${title(o.foreman)}`],
      TICKET: ["order", C.green, `PO ${e.meta?.po || o.po} issued · ${o.req_no} · ${title(o.foreman)}`],
      ESCALADO: ["order", C.red, `${o.req_no} escalated to ${title(e.meta?.to)} · no decision in ${e.meta?.after_min}m`],
      JUSTIFICADO: ["order", C.amber, `${title(o.foreman)} justified held equipment on ${o.req_no}`],
      CONFIRMADO: null }[e.stage];
    if (m) s.push({ ts: new Date(e.ts).getTime(), kind: m[0], c: m[1], text: m[2], ref: { room: "orders", id: o.id } }); });
  (d.fuel || []).slice(0, 150).forEach(p => s.push({ ts: p.ts, kind: "fuel", c: p.gps_check === "NO_ESTABA" ? C.red : p.gps_check === "VERIFICADO" ? C.green : C.amber,
    text: `Fuel PO ${p.po} · ${title(p.who)} · ${p.vehicle_id || p.plate || ""} · ${p.station}${p.gps_check ? " · GPS " + ({ VERIFICADO: "✓ verified", NO_ESTABA: "✗ unit not at station", SIN_GPS: "no fix", SIN_UNIDAD: "no tracker", REVISAR: "outside all fences" }[p.gps_check] || "") : ""}`, ref: { room: "fuel", id: p.id } }));
  const seen = new Set();
  (d.stationVisits || []).forEach(p => { const k = `${p.actsoft_id}|${p.geofence}|${Math.floor(new Date(p.ts).getTime() / 1800e3)}`; if (seen.has(k) || p.status !== 1) return; seen.add(k);
    const u = (d.fleet || []).find(f => f.actsoft_id === p.actsoft_id); const g = p.geofence;
    if (/Leos|Texcon|Chevron/i.test(g)) s.push({ ts: new Date(p.ts).getTime(), kind: "gps", c: C.cyan, text: `${title(u?.person || u?.assigned_to || (u?.name || "Unit").replace(/\s*VIN.*$/i, ""))} stopped at ${g}`, ref: { room: "fleet", id: p.actsoft_id } }); });
  (d.ev || []).filter(e => e.event === "error").slice(0, 20).forEach(e => s.push({ ts: new Date(e.ts).getTime(), kind: "sys", c: C.red, text: `App error · ${e.who || "unknown"} · ${[e.meta?.stage, e.meta?.status && "HTTP " + e.meta.status, e.meta?.err, e.meta?.msg, e.meta?.error].filter(Boolean).join(" · ") || JSON.stringify(e.meta || {}).slice(0, 80)}`.slice(0, 140) }));
  return s.sort((a, b) => b.ts - a.ts).slice(0, 120);
}

/* ============================================================================
   ROOM · SITUATION
   ============================================================================ */
function Situation({ d, now, go, mapNode }) {
  const orders = (d.orders || []).filter(o => !o.is_practice), fuel = d.fuel || [], fleet = d.fleet || [];
  const t0 = new Date(); t0.setHours(0, 0, 0, 0); const day0 = t0.getTime(), wk0 = now - 7 * 864e5, wk1 = now - 14 * 864e5;
  const live = a => a.filter(o => o.status !== "RECHAZADO");
  const todayO = orders.filter(o => o.ts >= day0), wkO = orders.filter(o => o.ts >= wk0), pwO = orders.filter(o => o.ts >= wk1 && o.ts < wk0);
  const todayF = fuel.filter(p => p.ts >= day0), wkF = fuel.filter(p => p.ts >= wk0), pwF = fuel.filter(p => p.ts >= wk1 && p.ts < wk0);
  const sum = (a, k) => a.reduce((x, y) => x + (Number(y[k]) || 0), 0);
  const spendWk = sum(live(wkO), "est_total") + sum(wkF, "amount"), spendPw = sum(live(pwO), "est_total") + sum(pwF, "amount");
  const trend = spendPw ? Math.round((spendWk - spendPw) / spendPw * 100) : null;
  const queue = orders.filter(o => o.status === "SOLICITADO").sort((a, b) => a.ts - b.ts), noPo = orders.filter(o => o.status === "APROBADO");
  const oldest = queue[0] ? now - queue[0].ts : 0;
  const chk = (d.fuelGps || []).filter(f => f.gps_check && f.gps_check !== "SIN_UNIDAD"), ver = chk.filter(f => f.gps_check === "VERIFICADO"), bad = chk.filter(f => f.gps_check === "NO_ESTABA");
  const fresh = fleet.filter(u => u.secs_since_seen != null && u.secs_since_seen < 3 * 3600), moving = fresh.filter(u => (u.last_speed || 0) > 3), idling = fresh.filter(u => u.last_ignition && (u.last_speed || 0) <= 3 && u.secs_in_status > 45 * 60);
  const dm = useMemo(() => deciderMap(d.oev), [d.oev]);
  const auto = wkO.filter(o => decidedBy(o, dm) === "REGLAS" && o.status !== "RECHAZADO").length, human = wkO.filter(o => { const w = decidedBy(o, dm); return w && w !== "REGLAS"; }).length;
  const tApr = wkO.map(o => o.secs_to_approve).filter(x => x > 0);
  const days = useMemo(() => { const out = []; for (let i = 13; i >= 0; i--) { const k = dayKey(now - i * 864e5); out.push({ k, o: live(orders).filter(o => dayKey(o.ts) === k).reduce((a, o) => a + (Number(o.est_total) || 0), 0), f: fuel.filter(p => dayKey(p.ts) === k).reduce((a, p) => a + (Number(p.amount) || 0), 0) }); } return out; }, [orders, fuel, now]);
  const signals = useMemo(() => buildSignals(d), [d]);
  const sup = useMemo(() => { const m = {}; wkO.forEach(o => { if (!o.supervisor || o.supervisor === "REGLAS (AUTO)") return; const k = decidedBy(o, dm) && decidedBy(o, dm) !== "REGLAS" ? decidedBy(o, dm) : o.supervisor; m[k] = m[k] || { n: 0, t: [], open: 0 }; m[k].n++; if (o.secs_to_approve > 0) m[k].t.push(o.secs_to_approve); if (o.status === "SOLICITADO") m[k].open++; }); return Object.entries(m).map(([k, v]) => ({ k, ...v, med: median(v.t) })).sort((a, b) => (b.open - a.open) || ((b.med || 0) - (a.med || 0))); }, [wkO, dm]);
  const notFound = useMemo(() => { const m = {}; wkO.forEach(o => (o.not_found || []).forEach(x => { const k = String(x).toLowerCase().trim(); if (k) m[k] = (m[k] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6); }, [wkO]);
  const dmax = Math.max(...days.map(y => y.o + y.f), 1);
  return (
    <div className="room">
      <div className="strip">
        <Metric label="COMMITTED · 7 DAYS" value={money0(spendWk)} sub={`materials ${money0(sum(live(wkO), "est_total"))} · fuel ${sum(wkF, "amount") ? money0(sum(wkF, "amount")) : wkF.length ? `${wkF.length} PO${wkF.length === 1 ? "" : "s"} · $ on the statement` : "$0"}`} trend={trend} big />
        <Metric label="TODAY" value={money0(sum(live(todayO), "est_total") + sum(todayF, "amount"))} sub={`${todayO.length} order${todayO.length === 1 ? "" : "s"} · ${todayF.length} fuel PO${todayF.length === 1 ? "" : "s"}`} />
        <Metric label="AWAITING DECISION" value={queue.length} tone={oldest > 2 * 36e5 ? C.red : queue.length ? C.amber : C.green} sub={queue.length ? `oldest ${ago(oldest / 1000)} · ${title(first(queue[0].supervisor)) || "unassigned"}` : "queue clear"} />
        <Metric label="APPROVED · NO PO" value={noPo.length} tone={noPo.length ? C.cyan : C.ink} sub="waiting on the office" />
        <Metric label="RULES vs HUMANS" value={`${auto}/${human}`} sub={auto + human ? `${Math.round(auto / (auto + human) * 100)}% by rules · median human ${tApr.length ? ago(median(tApr)) : "—"}` : "no decisions this week"} />
        <Metric label="FUEL VERIFIED BY GPS" value={chk.length ? Math.round(ver.length / chk.length * 100) + "%" : "—"} tone={bad.length ? C.red : C.green} sub={chk.length ? `${bad.length} not at station · ${chk.length} checked` : "awaiting fuel POs with GPS"} />
        <Metric label="FLEET" value={moving.length} unit=" moving" tone={moving.length ? C.green : C.ink} sub={`${idling.length} idling 45m+ · ${fleet.filter(u => (u.secs_since_seen ?? 1e9) > 86400).length} dark 24h+ · ${fleet.length} tracked`} />
      </div>
      <div className="g3">
        <Panel title="LIVE · FLEET" right={<span className="legend"><Dot c={C.green} /> moving <Dot c={C.amber} /> idling <Dot c={C.cyan} /> parked <Dot c={C.faint} /> dark</span>} className="span2" flush>{mapNode}</Panel>
        <Panel title="SIGNAL FEED" right={<span className="legend"><Dot c={C.green} pulse /> live</span>} flush>
          <div className="feed">
            {!signals.length ? <Empty>Nothing yet. Every order, decision, fuel PO and station stop lands here the second it happens.</Empty> : null}
            {signals.slice(0, 60).map((s, i) => (<div key={i} className="sig" onClick={() => s.ref && go(s.ref.room, s.ref.id)}><span className="st">{hhmm(s.ts)}</span><Dot c={s.c} /><span className="sk">{s.kind}</span><span className="sx">{s.text}</span></div>))}
          </div>
        </Panel>
      </div>
      <div className="g3">
        <Panel title="DECISIONS OUTSTANDING" right={<span className="dim">oldest first</span>}>
          {!queue.length && !noPo.length ? <Empty ok>Queue clear.</Empty> : null}
          {queue.slice(0, 8).map(o => (<div key={o.id} className="row" onClick={() => go("orders", o.id)}><span className="mono">{o.req_no}</span><Tag c={PROV[o.provider]}>{o.provider}</Tag><b>{title(o.foreman)}</b><span className="dim tr grow">{o.jobsite || "no jobsite"}</span><span className="mono r" style={{ color: now - o.ts > 2 * 36e5 ? C.red : C.amber }}>{title(first(o.supervisor)) || "—"} · {ago((now - o.ts) / 1000)}</span></div>))}
          {noPo.slice(0, 5).map(o => (<div key={o.id} className="row" onClick={() => go("orders", o.id)}><span className="mono">{o.req_no}</span><Tag c={PROV[o.provider]}>{o.provider}</Tag><b>{title(o.foreman)}</b><span className="dim tr grow">{money(o.est_total)}</span><span className="mono r" style={{ color: C.cyan }}>needs PO · {ago((now - new Date(o.approved_at).getTime()) / 1000)}</span></div>))}
        </Panel>
        <Panel title="SPEND · 14 DAYS" right={<span className="legend"><Dot c={C.orange} /> materials <Dot c={C.amber} /> fuel</span>}>
          <div className="dual">{days.map((x, i) => (<div key={i} className="dcol" title={`${x.k}: materials ${money0(x.o)} · fuel ${money0(x.f)}`}><div className="dstk"><div style={{ height: `${x.f / dmax * 100}%`, background: C.amber }} /><div style={{ height: `${x.o / dmax * 100}%`, background: C.orange }} /></div><span className="bl">{x.k.slice(8)}</span></div>))}</div>
        </Panel>
        <Panel title="SUPERVISOR RESPONSE · 7 DAYS" right={<span className="dim">cards · median · open</span>}>
          {!sup.length ? <Empty>No human decisions yet this week.</Empty> : sup.map(s => (<div key={s.k} className="row"><b className="grow">{title(s.k)}</b><span className="mono">{s.n}</span><span className="mono" style={{ color: s.med == null ? C.dim : s.med > 5400 ? C.red : s.med > 1800 ? C.amber : C.green }}>{s.med == null ? "—" : ago(s.med)}</span><span className="mono r" style={{ color: s.open ? C.amber : C.dim }}>{s.open ? `${s.open} open` : "clear"}</span></div>))}
          {notFound.length ? <div className="foot">Catalog gaps this week: {notFound.map(([k, v]) => `“${k}” ×${v}`).join(" · ")}</div> : null}
        </Panel>
      </div>
    </div>);
}


/* ============================================================================
   ROOM · LEDGER  (what vendors actually billed — invoices + PO log + station statements)
   ============================================================================ */
const VEND = { ACE: "ACE", CMC: "CMC", RSS: "RSS", WHITECAP: "White Cap", TEXCON: "Tex-Con" };
function Ledger({ d, q, t }) {
  const inv = d.ledger || [], po = d.poLog || [], tickets = d.tickets || [];
  const [lines, setLines] = useState([]);
  const months = useMemo(() => [...new Set(inv.map(i => i.month).filter(Boolean))].sort().reverse(), [inv]);
  const complete = months.find(m => m < dayKey(Date.now()).slice(0, 7)) || months[0];
  const [m, setM] = useState(null); const mo = m || complete; const [sel, setSel] = useState(null); const [tab, setTab] = useState("all");
  useEffect(() => { if (!mo) return; let on = true; getAll(`ledger_lines?select=vendor,invoice,pos,code,descr,qty,price,amount&month=eq.${mo}`, t.access_token, 3).then(r => { if (on) setLines(Array.isArray(r) ? r : []); }).catch(() => {}); return () => { on = false; }; }, [mo, d.sync]);
  const cur = inv.filter(i => i.month === mo && i.kind !== "CREDIT"), prevM = months[months.indexOf(mo) + 1], prev = inv.filter(i => i.month === prevM && i.kind !== "CREDIT");
  const amt = i => Number(i.subtotal ?? i.total) || 0;
  const sum = a => a.reduce((x, i) => x + amt(i), 0);
  const billed = sum(cur), billedPrev = sum(prev), trend = billedPrev ? Math.round((billed - billedPrev) / billedPrev * 100) : null;
  const byV = ["ACE", "CMC", "RSS", "WHITECAP", "TEXCON"].map(v => ({ v, n: cur.filter(i => i.vendor === v).length, usd: sum(cur.filter(i => i.vendor === v)) }));
  const small = cur.filter(i => amt(i) > 0 && amt(i) < 150);
  const checks = { OK: cur.filter(i => i.po_check === "OK"), NOLOG: cur.filter(i => i.po_check === "PO NO ESTÁ EN EL LOG"), NOPO: cur.filter(i => i.po_check === "SIN PO"), WRONG: cur.filter(i => /^PO EMITIDO/.test(i.po_check)) };
  const fuelT = tickets.filter(t => t.ticket_date.slice(0, 7) === mo), fuelUsd = fuelT.reduce((a, t) => a + (+t.amount || 0), 0);
  const posM = po.filter(p => p.po_date && p.po_date.slice(0, 7) === mo), fuelPOs = posM.filter(p => /fuel|leo|tex|gas|diesel/i.test(`${p.vendor} ${p.description}`)).length;
  const top = (f, arr = cur) => { const mm = {}; arr.forEach(i => { const k = f(i) || "—"; mm[k] = mm[k] || { n: 0, usd: 0 }; mm[k].n++; mm[k].usd += amt(i); }); return Object.entries(mm).sort((a, b) => b[1].usd - a[1].usd); };
  const byF = top(i => i.foreman), byP = top(i => i.project);
  const keyset = new Set(cur.map(i => i.vendor + "|" + i.invoice));
  const items = useMemo(() => { const mm = {}; lines.filter(l => keyset.has(l.vendor + "|" + l.invoice)).forEach(l => { const k = l.vendor + "|" + (l.code || l.descr); const x = mm[k] = mm[k] || { vendor: l.vendor, code: l.code, descr: l.descr, qty: 0, n: 0, usd: 0, prices: [] }; x.qty += +l.qty || 0; x.n++; x.usd += +l.amount || 0; if (l.price) x.prices.push(+l.price); }); return Object.values(mm).sort((a, b) => b.usd - a.usd).slice(0, 15); }, [lines, mo, inv]);
  const days = useMemo(() => { if (!mo) return []; const y = +mo.slice(0, 4), mth = +mo.slice(5, 7); const n = new Date(y, mth, 0).getDate(); return Array.from({ length: n }, (_, i) => { const k = `${mo}-${String(i + 1).padStart(2, "0")}`; return { label: String(i + 1), v: Math.round(sum(cur.filter(x => x.inv_date === k))) }; }); }, [cur, mo]);
  const shown = cur.filter(i => (tab === "all" || (tab === "issues" ? i.po_check !== "OK" : tab === "small" ? amt(i) < 150 : i.vendor === tab)) && (!q || `${i.invoice} ${i.po} ${i.foreman} ${i.project} ${i.job} ${i.ordered_by}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => (a.inv_date < b.inv_date ? 1 : -1));
  const label = mo ? new Date(mo + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
  const csv = () => { const cl = s => `"${String(s ?? "").replace(/"/g, '""')}"`; const H = ["vendor", "invoice", "date", "po", "po_check", "foreman", "project", "lines", "subtotal", "total"];
    const R = shown.map(i => [i.vendor, i.invoice, i.inv_date, i.po, i.po_check, i.foreman, i.project, i.n_lines, i.subtotal, i.total].map(cl).join(",")); const b = new Blob(["\uFEFF" + [H.join(","), ...R].join("\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `muniz_ledger_${mo}.csv`; a.click(); };
  if (!inv.length) return <div className="room"><Empty>No invoices loaded yet. Run supabase_fase6_ledger.sql.</Empty></div>;
  return (
    <div className="room">
      <div className="toolbar">
        <div className="segs">{months.slice(0, 9).map(x => <button key={x} className={mo === x ? "on" : ""} onClick={() => setM(x)}>{new Date(x + "-02").toLocaleDateString("en-US", { month: "short", year: "2-digit" }).toUpperCase()}</button>)}</div>
        <span className="dim xs">what the vendors billed · from {cur.length} invoices{fuelT.length ? ` · ${fuelT.length} station fuel tickets` : ""}</span>
        <button className="btn sm" onClick={csv}>↓ CSV</button>
      </div>
      <div className="strip">
        <Metric label={`BILLED · ${label.toUpperCase()}`} value={money0(billed)} trend={trend} sub={`materials ${money0(sum(cur.filter(i => i.vendor !== "TEXCON")))} · Tex-Con ${money0(sum(cur.filter(i => i.vendor === "TEXCON")))}${prevM ? ` · vs ${new Date(prevM + "-02").toLocaleDateString("en-US", { month: "short" })} ${money0(billedPrev)}` : ""}`} big />
        {byV.map(x => <Metric key={x.v} label={VEND[x.v].toUpperCase()} value={money0(x.usd)} tone={PROV[x.v]} sub={`${x.n} invoices · ${x.n ? money0(x.usd / x.n) : "—"} avg`} />)}
        <Metric label="FUEL · STATION TICKETS" value={fuelT.length ? money0(fuelUsd) : "—"} tone={C.amber} sub={fuelT.length ? `${fuelT.filter(x => x.station === "TEXCON").length} Tex-Con · ${fuelT.filter(x => x.station !== "TEXCON").length} Leo's · ${N(Math.round(fuelT.reduce((a, x) => a + (+x.gallons || 0), 0)))} gal · ${fuelPOs} fuel POs in the log` : `${fuelPOs} fuel POs in the log · no station tickets this month`} />
        <Metric label="SMALL ORDERS < $150" value={small.length} tone={small.length > cur.length * .3 ? C.amber : C.ink} sub={`${cur.length ? Math.round(small.length / cur.length * 100) : 0}% of invoices · ${money0(sum(small))} · each one carries the small-order penalty`} />
        <Metric label="PO CONTROL" value={`${cur.length ? Math.round(checks.OK.length / cur.length * 100) : 0}%`} tone={checks.WRONG.length + checks.NOPO.length ? C.red : C.green} sub={`${checks.NOPO.length} no PO · ${checks.NOLOG.length} not in log · ${checks.WRONG.length} wrong vendor · ${money0(sum([...checks.NOPO, ...checks.NOLOG, ...checks.WRONG]))}`} />
      </div>
      <div className="g3">
        <Panel title={`BILLED PER DAY · ${label.toUpperCase()}`} className="span2"><Bars data={days} color={C.orange} h={110} /></Panel>
        <Panel title="VENDOR MIX"><Split parts={byV.map(x => ({ label: VEND[x.v], v: Math.round(x.usd), c: PROV[x.v] }))} /><div className="sp" /><Split parts={[{ label: "PO ok", v: checks.OK.length, c: C.green }, { label: "Not in log", v: checks.NOLOG.length, c: C.amber }, { label: "Wrong vendor", v: checks.WRONG.length, c: C.red }, { label: "No PO", v: checks.NOPO.length, c: C.faint }]} /></Panel>
      </div>
      <div className="g3">
        <Panel title="BILLED BY FOREMAN" right={<span className="dim">from the PO owner in the log</span>}>{byF.slice(0, 10).map(([k, v], i) => <div key={k} className="row"><span className="dim mono w2">{i + 1}</span><b className="grow tr">{title(k)}</b><span className="mono dim">{v.n}</span><div className="hbar" style={{ width: `${v.usd / (byF[0][1].usd || 1) * 100}px`, background: C.cyan }} /><span className="mono r">{money0(v.usd)}</span></div>)}</Panel>
        <Panel title="BILLED BY PROJECT / JOBSITE">{byP.slice(0, 10).map(([k, v], i) => <div key={k} className="row"><span className="dim mono w2">{i + 1}</span><b className="grow tr">{k}</b><span className="mono dim">{v.n}</span><div className="hbar" style={{ width: `${v.usd / (byP[0][1].usd || 1) * 100}px`, background: C.orange }} /><span className="mono r">{money0(v.usd)}</span></div>)}</Panel>
        <Panel title="TOP ITEMS BY $" right={<span className="dim">qty · invoices · price range</span>}>{items.slice(0, 10).map((x, i) => <div key={i} className="row"><Tag c={PROV[x.vendor]}>{x.vendor}</Tag><b className="grow tr" title={x.descr}>{x.descr || x.code}</b><span className="mono dim xs">{N(Math.round(x.qty))} · {x.n}×{x.prices.length > 1 && Math.max(...x.prices) > Math.min(...x.prices) * 1.05 ? ` · ${money(Math.min(...x.prices))}–${money(Math.max(...x.prices))}` : ""}</span><span className="mono r">{money0(x.usd)}</span></div>)}</Panel>
      </div>
      <div className="toolbar"><div className="segs">{[["all", `ALL ${cur.length}`], ["issues", `PO ISSUES ${cur.length - checks.OK.length}`], ["small", `SMALL ${small.length}`], ["ACE", "ACE"], ["CMC", "CMC"], ["RSS", "RSS"], ["WHITECAP", "WHITE CAP"], ["TEXCON", "TEX-CON"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div></div>
      <Panel flush><table className="tbl big"><Th cols={["VENDOR", "INVOICE", "DATE", "PO", "PO CHECK", "FOREMAN", "PROJECT / SHIP TO", "LINES", "$ SUBTOTAL", "$ TOTAL"]} /><tbody>
        {shown.map(i => (<tr key={i.vendor + i.invoice} onClick={() => setSel(i)}>
          <td><Tag c={PROV[i.vendor]}>{VEND[i.vendor] || i.vendor}</Tag></td><td className="mono"><b>{i.invoice}</b>{i.kind === "CREDIT" ? <Tag c={C.cyan} dim>CREDIT</Tag> : null}</td><td className="dim">{i.inv_date}</td><td className="mono">{i.po || <span className="red">—</span>}</td>
          <td>{i.po_check === "OK" ? <Dot c={C.green} /> : <Tag c={/EMITIDO/.test(i.po_check) ? C.red : i.po_check === "SIN PO" ? C.red : C.amber} dim>{({ "SIN PO": "no PO", "PO NO ESTÁ EN EL LOG": "not in log" })[i.po_check] || i.po_check.replace("PO EMITIDO PARA", "PO issued to")}</Tag>}</td>
          <td><b>{title(i.foreman) || <span className="dim">—</span>}</b></td><td className="dim tr">{i.project || i.job || "—"}</td><td className="mono r">{i.n_lines}</td><td className="mono r">{i.subtotal != null ? money(i.subtotal) : "—"}</td><td className="mono r">{i.total != null ? money(i.total) : "—"}</td>
        </tr>))}
        {!shown.length ? <tr><td colSpan={10}><Empty>Nothing matches.</Empty></td></tr> : null}
      </tbody></table></Panel>
      {sel ? (<div className="drawer-bg" onClick={() => setSel(null)}><aside className="drawer" onClick={e => e.stopPropagation()}><Tick />
        <header className="dh"><div><div className="ml">{(VEND[sel.vendor] || sel.vendor).toUpperCase()} · INVOICE</div><div className="dn">{sel.invoice}</div></div><div className="tags"><Tag c={PROV[sel.vendor]}>{sel.vendor}</Tag>{sel.po_check !== "OK" ? <Tag c={C.red}>{sel.po_check}</Tag> : <Tag c={C.green}>PO OK</Tag>}</div></header>
        <div className="db">
          <div className="kv">{[["Date", sel.inv_date], ["PO", sel.po || "—"], ["PO owner (log)", title(sel.foreman) || "—"], ["PO date (log)", sel.po_date || "—"], ["PO description (log)", sel.po_descr || "—"], ["Project / ship to", sel.project || sel.job || "—"], ["Ordered by (invoice)", title(sel.ordered_by) || "—"], ["Subtotal / Total", `${sel.subtotal != null ? money(sel.subtotal) : "—"} / ${sel.total != null ? money(sel.total) : "—"}`], ...(sel.vendor === "TEXCON" ? [["Terms / due", `${sel.terms || "—"} · ${sel.due_date || "—"}`], ["Vendor balance on invoice", sel.vendor_balance != null ? money(sel.vendor_balance) : "—"]] : [])].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
          <table className="tbl"><Th cols={["#", "QTY", "ITEM", "CODE", "$ UNIT", "$ LINE"]} /><tbody>
            {lines.filter(l => l.vendor === sel.vendor && l.invoice === sel.invoice).sort((a, b) => a.pos - b.pos).map(l => <tr key={l.pos}><td className="dim">{l.pos}</td><td className="mono r">{l.qty ?? "—"}</td><td>{l.descr}</td><td className="mono dim">{l.code}</td><td className="mono r">{l.price != null ? money(l.price) : "—"}</td><td className="mono r">{l.amount != null ? money(l.amount) : "—"}</td></tr>)}
          </tbody></table>
          <div className="dim xs">File: {sel.file}</div>
        </div>
        <footer className="df"><button className="btn" onClick={() => setSel(null)}>CLOSE</button></footer>
      </aside></div>) : null}
    </div>);
}

/* ============================================================================
   ROOM · ORDERS
   ============================================================================ */
function OrderDrawer({ o, t, d, onClose, onChanged }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [po, setPo] = useState(""); const [poOpen, setPoOpen] = useState(false);
  const lastPo = d?.lastPo?.po; const nextPo = lastPo && /^\d+$/.test(lastPo) ? String(Number(lastPo) + 1) : "";
  const act = async (action, label, extra) => {
    if (!window.confirm(`${label} · ${o.req_no} · ${title(o.foreman)} · ${o.provider}?`)) return;
    setBusy(true); setErr("");
    try { const r = await rpc("office_act", { p_order_id: o.id, p_action: action, p_po: extra?.po || null, p_note: extra?.note || null, p_lines: null }, t);
      if (r && r.note && !/^(APROBADO|RECHAZADO|PO_ASIGNADO)$/.test(r.status || "")) setErr(r.note); onChanged(); onClose(); }
    catch (e) { let m = String(e.message || e); try { m = JSON.parse(m).message || m; } catch (x) {} setErr(m.slice(0, 240)); } finally { setBusy(false); }
  };
  const stages = ["SOLICITADO", "APROBADO", "TICKET"].filter(s => (o.lines || []).some(l => l.stage === s));
  const [st, setSt] = useState(stages[stages.length - 1] || "SOLICITADO");
  const lines = (o.lines || []).filter(l => l.stage === st);
  const mark = async (body, label) => { if (!window.confirm(`${label} · ${o.req_no} · ${o.foreman}?`)) return; setBusy(true); setErr(""); try { await patch(`material_orders?id=eq.${o.id}`, body, t.access_token); onChanged(); onClose(); } catch (e) { setErr(String(e.message || e).slice(0, 200)); } finally { setBusy(false); } };
  const [lbl, c] = ORDER_STATUS[o.status] || ["", C.dim];
  const tl = [["Requested", o.submitted_at || o.requested_at, o.foreman], ["Confirmed text", o.confirmed_at, o.foreman], ["Approved", o.approved_at, o.supervisor === "REGLAS (AUTO)" ? "Rules" : o.supervisor], ["Rejected", o.rejected_at, o.decided_by || o.supervisor], ["PO issued", o.po_at, o.po]].filter(x => x[1]);
  return (
    <div className="drawer-bg" onClick={onClose}><aside className="drawer" onClick={e => e.stopPropagation()}><Tick />
      <header className="dh"><div><div className="ml">MATERIAL ORDER{o.is_practice ? " · TEST" : ""}</div><div className="dn">{o.req_no}{o.po ? <span style={{ color: C.green }}> PO {o.po}</span> : null}</div></div>
        <div className="tags"><Tag c={PROV[o.provider]}>{o.provider}</Tag><Tag c={c}>{lbl}</Tag>{o.lane ? <Tag c={LANE[o.lane]}>{({ VERDE: "GREEN", AMARILLO: "AMBER", ROJO: "RED", PRACTICA: "TEST" })[o.lane]} LANE</Tag> : null}</div></header>
      <div className="db">
        <div className="kv">
          {[["Requested by", `${title(o.foreman)} · ${o.foreman_role || "—"}`], ["Jobsite", (o.jobsite || "—") + (o.jobsite && !o.jobsite_known ? " (typed)" : "")], ["Rostered", o.jobsite_week || "—"], ["Supervisor", o.supervisor === "REGLAS (AUTO)" ? "Rules (auto)" : o.supervisor ? title(o.supervisor) + (o.self_approved ? " (self)" : "") : "—"], ["Driver", title(o.driver) || "—"], ["Catalog value", o.est_total ? money(o.est_total) : "— (unpriced)"], ["Decided by", o.decided_by === "REGLAS" ? "Rules engine" : o.decided_by ? `${title(o.decided_by)} via ${({ TARJETA: "card", MANDO: "ops", REGLAS: "rules", APP: "app" })[o.decided_via] || (o.decided_via || "").toLowerCase()}` : "—"], ["Time to decision", o.secs_to_approve ? ago(o.secs_to_approve) : "—"]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
        {o.lane_note ? <div className="note" style={{ borderColor: LANE[o.lane] }}><span className="dim xs">Foreman saw: </span>{o.lane_note}</div> : null}
        {(o.lane_reasons || []).length ? <div className="tags">{o.lane_reasons.map((r, i) => <Tag key={i} c={r.level === "ROJO" ? C.red : C.amber} dim>{r.text}</Tag>)}</div> : null}
        {o.justification ? <div className="note" style={{ borderColor: C.cyan }}><span className="dim">Foreman's justification: </span>“{o.justification}”</div> : null}
        <div className="tl">{tl.map(([k, x, who], i) => <div key={i}><span className="dim">{k}</span> <b>{dt(x)}</b> {who ? <em>{title(who)}</em> : null}</div>)}</div>
        <div className="segs">{stages.map(s => <button key={s} className={st === s ? "on" : ""} onClick={() => setSt(s)}>{({ SOLICITADO: "REQUESTED", APROBADO: "APPROVED", TICKET: "TICKET" })[s]}</button>)}</div>
        <table className="tbl"><Th cols={["#", "QTY", "ITEM", "CODE", "RULE", "$ UNIT", "$ LINE"]} /><tbody>
          {lines.map(l => { const dead = l.removed || l.authorized === false; return (
            <tr key={l.pos} className={dead ? "dead" : ""}>
              <td className="dim">{l.pos}</td><td className="mono r">{dead ? l.qty_requested : l.qty}{!dead && l.qty_requested != null && Number(l.qty_requested) !== Number(l.qty) ? <em className="dim"> ({l.qty_requested})</em> : null}</td>
              <td>{l.descr || "—"}{l.custom ? <Tag c={C.amber} dim>OFF-CATALOG</Tag> : null}{l.removed ? <Tag c={C.red} dim>CUT</Tag> : null}{l.authorized === false ? <Tag c={C.red} dim>NOT AUTHORIZED</Tag> : null}</td>
              <td className="mono dim">{l.code || "—"}</td><td className="mono dim">{({ RUTINA: "routine", RESTRINGIDO: "tool-bag", TRAILER_SI: "on trailer", FUERA_LISTA: "review", SIN_PRECIO: "unpriced" })[l.rule] || ""}</td>
              <td className="mono r">{l.unit_price != null ? money(l.unit_price) : "—"}</td><td className="mono r">{!dead && l.unit_price != null ? money(l.line_total) : "—"}</td>
            </tr>); })}
        </tbody></table>
        {(o.server_flags || []).length ? <div className="tags">{o.server_flags.map((f, i) => <Tag key={i} c={/2 h\+|4 h\+|sí mismo|no confirmó/.test(f) ? C.red : C.amber} dim>{f}</Tag>)}</div> : null}
        {o.notes ? <div className="dim">{o.notes}</div> : null}
        {err ? <div className="err">{err}</div> : null}
      </div>
      <footer className="df">
        <button className="btn" onClick={onClose}>CLOSE</button>
        {o.is_practice ? <button className="btn" disabled={busy} onClick={() => mark({ is_practice: false }, "Count as real")}>COUNT AS REAL</button>
          : <button className="btn amber" disabled={busy} onClick={() => mark({ is_practice: true, notes: ((o.notes || "") + " · marked TEST from Ops").trim() }, "Mark as TEST (excluded from all numbers)")}>MARK TEST</button>}
        {o.status === "SOLICITADO" ? <>
          <button className="btn red" disabled={busy} onClick={() => act("RECHAZAR", "Reject")}>REJECT</button>
          <button className="btn green" disabled={busy} onClick={() => act("APROBAR", "Approve as requested (tool-bag items are cut automatically)")}>APPROVE</button>
          <button className="btn green" disabled={busy} onClick={() => setPoOpen(v => !v)}>APPROVE + ISSUE PO…</button>
        </> : null}
        {o.status === "APROBADO" ? <>
          <button className="btn red" disabled={busy} onClick={() => act("RECHAZAR", "Reject")}>REJECT</button>
          <button className="btn green" disabled={busy} onClick={() => setPoOpen(v => !v)}>ISSUE PO…</button>
        </> : null}
        {poOpen && (o.status === "SOLICITADO" || o.status === "APROBADO") ? (
          <div className="po-issue" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%" }}>
            <span className="dim xs">PO #</span>
            <input className="inp mono" style={{ width: 120 }} autoFocus value={po} onChange={e => setPo(e.target.value.replace(/[^0-9A-Za-z\-]/g, "").toUpperCase())} placeholder={nextPo || "number"}
              onKeyDown={e => { if (e.key === "Enter" && (po || nextPo)) act(o.status === "SOLICITADO" ? "APROBAR_Y_EMITIR" : "EMITIR_PO", `Issue PO ${po || nextPo}`, { po: po || nextPo }); }} />
            {nextPo ? <button className="btn sm" onClick={() => setPo(nextPo)}>use {nextPo}</button> : null}
            <button className="btn green" disabled={busy || !(po || nextPo)} onClick={() => act(o.status === "SOLICITADO" ? "APROBAR_Y_EMITIR" : "EMITIR_PO", `Issue PO ${po || nextPo}`, { po: po || nextPo })}>
              {o.status === "SOLICITADO" ? "APPROVE + ISSUE" : "ISSUE"} PO {po || nextPo}
            </button>
            {lastPo ? <span className="dim xs">last issued: {lastPo}</span> : null}
          </div>) : null}
      </footer>
    </aside></div>);
}
function Orders({ d, now, t, q, focus, clearFocus, onChanged }) {
  const [tab, setTab] = useState("all"); const [sel, setSel] = useState(null); const [range, setRange] = useState(7);
  const dm = useMemo(() => deciderMap(d.oev), [d.oev]);
  useEffect(() => { if (focus) { const o = (d.orders || []).find(x => x.id === focus); if (o) setSel(o); clearFocus(); } }, [focus, d.orders]);
  const all = (d.orders || []).filter(o => !o.is_practice && (range === 0 || o.ts >= now - range * 864e5));
  const shown = all.filter(o => (tab === "all" || (tab === "open" ? (o.status === "SOLICITADO" || o.status === "APROBADO") : tab === "auto" ? decidedBy(o, dm) === "REGLAS" : o.status === tab))
    && (!q || `${o.req_no} ${o.po || ""} ${o.foreman} ${o.jobsite || ""} ${o.supervisor || ""} ${o.provider} ${(o.lines || []).map(l => (l.code || "") + " " + (l.descr || "")).join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const top = (f, val) => { const m = {}; all.forEach(o => { if (o.status === "RECHAZADO") return; const k = f(o) || "—"; m[k] = (m[k] || 0) + val(o); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const byJob = top(o => o.jobsite, o => Number(o.est_total) || 0), byWho = top(o => o.foreman, o => Number(o.est_total) || 0);
  const items = useMemo(() => { const m = {}; all.forEach(o => (o.lines || []).filter(l => l.stage === (o.approved_at ? "APROBADO" : "SOLICITADO") && !l.removed && l.qty > 0).forEach(l => { const k = (l.code || "") + "|" + (l.descr || ""); const x = m[k] = m[k] || { code: l.code, descr: l.descr, qty: 0, n: 0, usd: 0 }; x.qty += +l.qty || 0; x.n++; x.usd += +l.line_total || 0; })); return Object.values(m).sort((a, b) => b.usd - a.usd).slice(0, 10); }, [all]);
  const csv = () => { const cl = s => `"${String(s ?? "").replace(/"/g, '""')}"`; const H = ["req_no", "date", "foreman", "role", "provider", "jobsite", "rostered", "supervisor", "status", "lane", "decided_by", "po", "lines_requested", "lines_approved", "value_usd", "min_to_decision", "flags", "lines"];
    const R = shown.map(o => [o.req_no, new Date(o.ts).toLocaleString("en-US"), o.foreman, o.foreman_role, o.provider, o.jobsite, o.jobsite_week, o.supervisor, o.status, o.lane, decidedBy(o, dm), o.po, o.requested_lines, o.approved_lines, o.est_total, o.secs_to_approve ? Math.round(o.secs_to_approve / 60) : "", (o.server_flags || []).join(" | "), (o.lines || []).filter(l => l.stage === (o.approved_at ? "APROBADO" : "SOLICITADO")).map(l => `${l.qty}x ${l.descr || l.code}${l.removed ? " (CUT)" : ""}`).join(" | ")].map(cl).join(","));
    const b = new Blob(["\uFEFF" + [H.join(","), ...R].join("\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `muniz_orders_${dayKey(now)}.csv`; a.click(); };
  return (
    <div className="room">
      <div className="toolbar">
        <div className="segs">{[["all", `ALL ${all.length}`], ["open", `OPEN ${all.filter(o => o.status === "SOLICITADO" || o.status === "APROBADO").length}`], ["auto", `RULES ${all.filter(o => decidedBy(o, dm) === "REGLAS").length}`], ["PO_ASIGNADO", `PO ${all.filter(o => o.status === "PO_ASIGNADO").length}`], ["RECHAZADO", `REJECTED ${all.filter(o => o.status === "RECHAZADO").length}`]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div className="segs">{[[1, "24H"], [7, "7D"], [30, "30D"], [0, "ALL"]].map(([k, l]) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{l}</button>)}</div>
        <button className="btn sm" onClick={csv}>↓ CSV</button>
      </div>
      <div className="g3">
        <Panel title="SPEND BY JOBSITE" right={<span className="dim">catalog value</span>}>{byJob.slice(0, 8).map(([k, v], i) => <div key={k} className="row"><span className="dim mono w2">{i + 1}</span><b className="grow tr">{k}</b><div className="hbar" style={{ width: `${v / (byJob[0][1] || 1) * 100}px`, background: C.orange }} /><span className="mono r">{money0(v)}</span></div>)}{!byJob.length ? <Empty>No orders in range.</Empty> : null}</Panel>
        <Panel title="SPEND BY FOREMAN">{byWho.slice(0, 8).map(([k, v], i) => <div key={k} className="row"><span className="dim mono w2">{i + 1}</span><b className="grow tr">{title(k)}</b><div className="hbar" style={{ width: `${v / (byWho[0][1] || 1) * 100}px`, background: C.cyan }} /><span className="mono r">{money0(v)}</span></div>)}{!byWho.length ? <Empty>No orders in range.</Empty> : null}</Panel>
        <Panel title="TOP ITEMS BY VALUE">{items.map((x, i) => <div key={i} className="row"><span className="mono dim w6 tr">{x.code || "off-cat"}</span><b className="grow tr">{x.descr}</b><span className="mono dim">{x.n}×</span><span className="mono r">{money0(x.usd)}</span></div>)}{!items.length ? <Empty>No lines in range.</Empty> : null}</Panel>
      </div>
      <Panel flush>
        <table className="tbl big"><Th cols={["REQ", "WHEN", "FOREMAN", "PROV", "JOBSITE", "SUPERVISOR", "LINES", "$ VALUE", "STATUS", "LANE", "DECIDED", "PO"]} /><tbody>
          {shown.map(o => { const [lbl, c] = ORDER_STATUS[o.status] || ["", C.dim]; return (
            <tr key={o.id} onClick={() => setSel(o)}>
              <td className="mono"><b>{o.req_no}</b>{o.is_addon ? <Tag c={C.amber} dim>+ADD</Tag> : null}</td><td className="dim">{dt(o.ts)}</td><td><b>{title(o.foreman)}</b></td><td><Tag c={PROV[o.provider]}>{o.provider}</Tag></td>
              <td className={o.jobsite_known ? "" : "amber"}>{o.jobsite || <span className="red">none</span>}</td><td className="dim">{o.supervisor === "REGLAS (AUTO)" ? "rules" : title(o.supervisor) || "—"}</td>
              <td className="mono r">{o.approved_lines != null ? <>{o.requested_lines}<span className="dim">→</span>{o.approved_lines}{o.removed_lines && o.removed_lines === o.requested_lines - o.approved_lines ? <span className="red"> −{o.removed_lines}</span> : null}</> : o.requested_lines}</td>
              <td className="mono r">{o.est_total ? money(o.est_total) : "—"}</td><td><Tag c={c}>{lbl}</Tag></td><td>{o.lane ? <Dot c={LANE[o.lane]} /> : null}</td>
              <td className="dim">{decidedBy(o, dm) === "REGLAS" ? <span style={{ color: C.green }}>rules</span> : title(decidedBy(o, dm)) || "—"}{o.secs_to_approve ? <span className="mono"> · {ago(o.secs_to_approve)}</span> : null}</td><td className="mono"><b>{o.po || "—"}</b></td>
            </tr>); })}
          {!shown.length ? <tr><td colSpan={12}><Empty>Nothing matches.</Empty></td></tr> : null}
        </tbody></table>
      </Panel>
      {sel ? <OrderDrawer o={sel} t={t} d={d} onClose={() => setSel(null)} onChanged={onChanged} /> : null}
    </div>);
}

/* ============================================================================
   ROOM · FUEL
   ============================================================================ */
function Fuel({ d, now, q, mapGo, t, onChanged }) {
  const [busy, setBusy] = useState("");
  const markTest = async (p, test) => {
    if (p.statement) return;  // statement tickets aren't app POs
    const id = String(p.id).replace(/^t/, "");
    if (!window.confirm(`${test ? "Mark as TEST" : "Count as real"} · ${p.po} · ${title(p.who)}?\n${test ? "It stops counting toward any total, flag, or the truck's odometer check." : ""}`)) return;
    setBusy(p.id); try { await patch(`fuel_pos?id=eq.${id}`, { is_practice: test, notes: test ? ((p.notes || "") + " · TEST from Ops").trim() : (p.notes || null) }, t.access_token); onChanged(); } catch (e) { window.alert(String(e.message || e).slice(0, 200)); } finally { setBusy(""); }
  };
  const [range, setRange] = useState(7); const [tab, setTab] = useState("pos");
  const gps = Object.fromEntries((d.fuelGps || []).map(f => [f.id, f]));
  const veh = d.veh || [], tickets = d.tickets || [];
  const tMonths = useMemo(() => [...new Set(tickets.map(x => x.ticket_date.slice(0, 7)))].sort().reverse(), [tickets]);
  const monthMode = typeof range === "string";
  const plateVeh = useMemo(() => Object.fromEntries(veh.filter(v => v.plate).map(v => [v.plate, v])), [veh]);
  // station statement tickets in the same shape as an app fuel PO
  const asRow = x => { const v = plateVeh[x.plate]; return { id: "t" + x.id, po: x.po_raw || "—", ts: new Date(x.ticket_date + "T12:00:00").getTime(), who: x.creator || "(no PO owner)", vehicle_id: v?.id || null, vehicle_desc: v?.descr || x.plate || "", plate: x.plate, comb: /DIESEL/.test(x.fuel_type || "") ? "DIESEL" : "GASOLINA", reading: null, jobsite: x.project || x.job_hand || "", station: x.station === "LEOS" ? "LEO'S" : x.station === "TEXCON" ? "TEX-CON" : x.station, gallons: x.gallons, amount: x.amount, flags: x.flags || [], statement: true }; };
  const fuel = useMemo(() => {
    if (monthMode) return tickets.filter(x => x.ticket_date.slice(0, 7) === range).map(asRow);
    const pos = (d.fuel || []).filter(p => range === 0 || p.ts >= now - range * 864e5).map(p => ({ ...p }));
    const byPo = Object.fromEntries(pos.map(p => [String(p.po).toUpperCase(), p]));
    const extra = [];
    tickets.filter(x => range === 0 || new Date(x.ticket_date + "T12:00:00").getTime() >= now - range * 864e5).forEach(x => {
      const hit = x.po_raw && byPo[String(x.po_raw).toUpperCase()];
      if (hit) { hit.gallons = (Number(hit.gallons) || 0) + (Number(x.gallons) || 0) || hit.gallons; hit.amount = (Number(hit.amount) || 0) + (Number(x.amount) || 0) || hit.amount; hit.plate = hit.plate || x.plate; hit.reconciled = true; if (x.fuel_type && hit.comb && (/DIESEL/.test(x.fuel_type || "")) !== (hit.comb === "DIESEL") && (x.gallons || 0) > 12) hit.flags = [...(hit.flags || []), `Statement says ${x.fuel_type}, PO says ${hit.comb}`]; }
      else extra.push(asRow(x));
    });
    const test = (d.fuelTest || []).filter(x => range === 0 || new Date(x.created_at).getTime() >= now - range * 864e5).map(x => ({ id: x.id, po: x.po, ts: new Date(x.created_at).getTime(), who: x.who, role: x.role, vehicle_id: x.vehicle_id, vehicle_desc: x.vehicle_desc, plate: x.plate, comb: x.comb, reading: x.reading, jobsite: x.jobsite, station: x.station, gallons: x.gallons, amount: x.amount, flags: [], is_practice: true, notes: x.notes }));
    return [...pos, ...extra, ...(monthMode ? [] : test)].sort((a, b) => b.ts - a.ts);
  }, [d.fuel, d.fuelTest, tickets, range, now, plateVeh, monthMode]);
  const nStmt = fuel.filter(p => p.statement).length, nRec = fuel.filter(p => p.reconciled).length;
  const gal = fuel.reduce((a, p) => a + (+p.gallons || 0), 0), usd = fuel.reduce((a, p) => a + (+p.amount || 0), 0);
  const months = [...new Set(tickets.map(x => x.ticket_date.slice(0, 7)))].sort().reverse(); const m = months[0]; const tm = tickets.filter(x => x.ticket_date.slice(0, 7) === m);
  const bad = tm.filter(x => (x.flags || []).some(f => /no existe|SIN PO|no para Leo|SIN_PO|PO_NO_ESTA_EN_LOG|PO_SERIE_93XX|PO_ES_NOMBRE|PO_EMITIDO_A_OTRO/.test(f)));
  const per = {}; tm.forEach(x => { const k = x.creator || "(no PO owner)"; per[k] = per[k] || { n: 0, usd: 0, gal: 0, plates: new Set() }; per[k].n++; per[k].usd += +x.amount || 0; per[k].gal += +x.gallons || 0; if (x.plate) per[k].plates.add(x.plate); });
  const perL = Object.entries(per).sort((a, b) => b[1].usd - a[1].usd);
  const chk = fuel.map(p => gps[p.id] || p).filter(p => p.gps_check);
  const shown = fuel.filter(p => !q || `${p.po} ${p.who} ${p.plate} ${p.jobsite} ${p.vehicle_desc} ${p.station}`.toLowerCase().includes(q.toLowerCase()));
  const byUnit = useMemo(() => { const mm = {}; fuel.forEach(p => { const k = p.vehicle_id || p.plate || "?"; mm[k] = mm[k] || { n: 0, gal: 0, usd: 0, who: k === "?" ? null : p.who, desc: k === "?" ? "no unit or plate on the PO" : p.vehicle_desc }; mm[k].n++; mm[k].gal += +p.gallons || 0; mm[k].usd += +p.amount || 0; }); return Object.entries(mm).sort((a, b) => b[1].usd - a[1].usd).slice(0, 10); }, [fuel]);
  const days = useMemo(() => { const out = [];
    if (monthMode) { const y = +range.slice(0, 4), mth = +range.slice(5, 7), n = new Date(y, mth, 0).getDate(); for (let i = 1; i <= n; i++) { const k = `${range}-${String(i).padStart(2, "0")}`; out.push({ label: String(i), v: fuel.filter(p => dayKey(p.ts) === k).length }); } return out; }
    const n = range === 0 ? 30 : Math.min(range, 30); for (let i = n - 1; i >= 0; i--) { const k = dayKey(now - i * 864e5); out.push({ label: k.slice(5), v: (d.fuel || []).filter(p => dayKey(p.ts) === k).length }); } return out; }, [d.fuel, fuel, range, now]);
  const INFO_FLAG = /^(MIXTO_GAS_Y_DIESEL|SABADO|PO_PROVEEDOR_VARIANTE|TERMINOS_NET15)$/; const realFlags = p => (p.flags || []).filter(f => !INFO_FLAG.test(f));
  const verdict = { VERIFICADO: [C.green, "✓ AT STATION"], NO_ESTABA: [C.red, "✗ NOT THERE"], REVISAR: [C.amber, "? OUTSIDE FENCES"], SIN_GPS: [C.faint, "NO FIX"], SIN_UNIDAD: [C.faint, "NO TRACKER"] };
  return (
    <div className="room">
      <div className="strip">
        <Metric label={monthMode ? `STATION TICKETS · ${new Date(range + "-02").toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase()}` : range === 0 ? "FUEL POs · ALL" : `FUEL POs · ${range}D`} value={fuel.length} sub={`${money0(usd)} · ${N(Math.round(gal))} gal${monthMode ? " · from the station statement" : nStmt || nRec ? ` · ${fuel.length - nStmt} app POs + ${nStmt} statement tickets${nRec ? ` · ${nRec} reconciled` : ""}` : ""}`} big />
        <Metric label="$ / GALLON" value={gal ? money(usd / gal) : "—"} sub="blended, from POs with amounts" />
        {monthMode ? <Metric label="PO PROBLEMS" value={fuel.filter(p => (p.flags || []).some(f => /no existe|SIN PO|no para Leo|SIN_PO|PO_NO_ESTA_EN_LOG|PO_SERIE_93XX|PO_ES_NOMBRE|PO_EMITIDO_A_OTRO/.test(f))).length} tone={fuel.some(p => (p.flags || []).some(f => /no existe|SIN PO|no para Leo|SIN_PO|PO_NO_ESTA_EN_LOG|PO_SERIE_93XX|PO_ES_NOMBRE|PO_EMITIDO_A_OTRO/.test(f))) ? C.red : C.green} sub={`${money0(fuel.filter(p => (p.flags || []).some(f => /no existe|SIN PO|no para Leo|SIN_PO|PO_NO_ESTA_EN_LOG|PO_SERIE_93XX|PO_ES_NOMBRE|PO_EMITIDO_A_OTRO/.test(f))).reduce((a, p) => a + +p.amount, 0))} · PO missing, not in log, or issued to another vendor`} />
          : <Metric label="GPS VERIFIED" value={chk.length ? Math.round(chk.filter(p => p.gps_check === "VERIFICADO").length / chk.length * 100) + "%" : "—"} tone={chk.some(p => p.gps_check === "NO_ESTABA") ? C.red : C.green} sub={`${chk.filter(p => p.gps_check === "NO_ESTABA").length} unit not at station`} />}
        <Metric label="FLAGGED" value={fuel.filter(p => realFlags(p).length).length} tone={fuel.some(p => realFlags(p).length) ? C.amber : C.green} sub={monthMode ? "PO, plate, big fills, tools on fuel POs" : "odometer, frequency, GPS, statement flags"} />
        <Metric label={`STATION STATEMENTS · ${m ? new Date(m + "-02").toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase() : "—"}`} value={tm.length ? money0(tm.reduce((a, x) => a + +x.amount, 0)) : "—"} tone={bad.length ? C.red : C.ink} sub={tm.length ? `${tm.filter(x => x.station === "TEXCON").length} Tex-Con lines · ${tm.filter(x => x.station !== "TEXCON").length} Leo's · ${N(Math.round(tm.reduce((a, x) => a + (+x.gallons || 0), 0)))} gal · ${bad.length} with a PO problem · ${money0(bad.reduce((a, x) => a + +x.amount, 0))}` : "upload the monthly sheet"} />
      </div>
      <div className="toolbar">
        <div className="segs">{[["pos", "PURCHASE ORDERS"], ["gps", "GPS WITNESS"], ["leos", "STATION STATEMENTS"], ["units", "BY UNIT"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
        <div className="segs">{[[1, "24H"], [7, "7D"], [30, "30D"], [0, "ALL"]].map(([k, l]) => <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{l}</button>)}{tMonths.slice(0, 6).map(x => <button key={x} className={range === x ? "on" : ""} onClick={() => { setRange(x); if (tab === "gps") setTab("pos"); }}>{new Date(x + "-02").toLocaleDateString("en-US", { month: "short", year: "2-digit" }).toUpperCase()}</button>)}</div>
      </div>
      {tab === "pos" ? (<>
        <div className="g3"><Panel title="FUEL POs PER DAY" className="span2"><Bars data={days} color={C.amber} /></Panel>
          <Panel title="MIX"><Split parts={[{ label: "Diesel", v: fuel.filter(p => p.comb === "DIESEL").length, c: C.green }, { label: "Gasoline", v: fuel.filter(p => p.comb !== "DIESEL").length, c: C.orange }]} /><div className="sp" /><Split parts={[{ label: "Tex-Con", v: fuel.filter(p => /TEX/i.test(p.station)).length, c: "#3B82F6" }, { label: "Leo's", v: fuel.filter(p => /LEO/i.test(p.station)).length, c: C.amber }, { label: "Other", v: fuel.filter(p => !/TEX|LEO/i.test(p.station)).length, c: C.faint }]} /></Panel></div>
        <Panel flush><table className="tbl big"><Th cols={["PO", "WHEN", "WHO", "UNIT", "FUEL", "READING", "JOBSITE", "STATION", "GAL", "$", "GPS", "FLAGS"]} /><tbody>
          {shown.map(p => { const g = gps[p.id]; const v = g?.gps_check ? verdict[g.gps_check] : null; return (<tr key={p.id} style={p.is_practice ? { opacity: .5 } : null} onClick={() => g?.gps_lat && mapGo(g.gps_lat, g.gps_lon, `${p.po} · ${title(p.who)}`)}>
            <td className="mono"><b>{p.po}</b>{p.is_practice ? <Tag c={C.faint}>TEST</Tag> : null}</td><td className="dim">{dt(p.ts)}</td><td><b>{title(p.who)}</b></td><td className="mono">{p.vehicle_id || p.plate || "—"}<span className="dim"> {p.vehicle_desc}</span></td><td><Tag c={p.comb === "DIESEL" ? C.green : C.orange}>{p.comb}</Tag></td>
            <td className="mono r">{N(p.reading)}</td><td className="dim">{p.jobsite}</td><td>{p.station}</td><td className="mono r">{p.gallons ?? "—"}</td><td className="mono r">{p.amount ? money(p.amount) : "—"}</td>
            <td>{v ? <Tag c={v[0]}>{v[1]}</Tag> : p.statement ? <span className="dim xs">statement</span> : <span className="dim">—</span>}{p.reconciled ? <Tag c={C.green} dim>reconciled</Tag> : null}</td>
            <td onClick={e => e.stopPropagation()}><div className="tags">{(p.flags || []).slice(0, 2).map((f, i) => <Tag key={i} c={/GPS|retroced|24 h|no existe|SIN PO|no para Leo|SIN_PO|PO_NO_ESTA_EN_LOG|PO_SERIE_93XX|PO_ES_NOMBRE|PO_EMITIDO_A_OTRO/.test(f) ? C.red : C.amber} dim>{f}</Tag>)}{!p.statement ? <button disabled={busy === p.id} onClick={() => markTest(p, !p.is_practice)} style={{ fontSize: 10, padding: "0 6px", cursor: "pointer", borderColor: p.is_practice ? C.green : C.faint, color: p.is_practice ? C.green : C.dim }}>{busy === p.id ? "…" : p.is_practice ? "count as real" : "mark test"}</button> : null}</div></td>
          </tr>); })}
          {!shown.length ? <tr><td colSpan={12}><Empty>{monthMode ? "No station tickets loaded for this month." : "No fuel POs in range. Pick a month tab to see the station statement."}</Empty></td></tr> : null}
        </tbody></table></Panel></>) : null}
      {tab === "gps" ? (
        <Panel title="EVERY FUEL PO AGAINST THE TRUCK'S POSITION ±20 MIN" right={<span className="dim">click a row to see it on the map</span>} flush>
          <table className="tbl big"><Th cols={["PO", "WHEN", "WHO", "UNIT", "STATION", "GAL", "VERDICT", "GPS SAID"]} /><tbody>
            {(d.fuelGps || []).filter(f => f.gps_check).map(f => { const v = verdict[f.gps_check] || [C.faint, f.gps_check]; return (<tr key={f.id} onClick={() => f.gps_lat && mapGo(f.gps_lat, f.gps_lon, `${f.po} · ${title(f.who)} · ${f.gps_note}`)}>
              <td className="mono"><b>{f.po}</b></td><td className="dim">{dt(f.created_at)}</td><td><b>{title(f.who)}</b></td><td className="mono">{f.vehicle_id || f.plate}</td><td>{f.station}</td><td className="mono r">{f.gallons ?? "—"}</td><td><Tag c={v[0]}>{v[1]}</Tag></td><td className="dim">{f.gps_note}</td>
            </tr>); })}
            {!(d.fuelGps || []).some(f => f.gps_check) ? <tr><td colSpan={8}><Empty>The first fuel PO created while its truck reports GPS will appear here with a verdict within minutes.</Empty></td></tr> : null}
          </tbody></table>
        </Panel>) : null}
      {tab === "leos" ? (
        <div className="g3">
          <Panel title="BY PERSON · WHO OWNS THE PO" right={<span className="dim">{m}</span>}>{perL.slice(0, 30).map(([k, v]) => <div key={k} className="row"><b className="grow tr">{title(k)}</b><span className="mono dim">{v.n}</span><span className="mono">{money(v.usd)}</span><span className="mono dim">{N(Math.round(v.gal))} gal</span><span className="mono faint xs">{[...v.plates].join(" ")}</span></div>)}{!perL.length ? <Empty>No station statement loaded.</Empty> : null}</Panel>
          <Panel title={`${bad.length} TICKETS · PO MISSING, NOT IN LOG, OR ISSUED TO ANOTHER VENDOR · ${money0(bad.reduce((a, x) => a + +x.amount, 0))}`} className="span2">
            {bad.slice(0, 120).map(x => <div key={x.id} className="row"><Tag c={PROV[x.station] || C.faint}>{x.station === "TEXCON" ? "TEX-CON" : x.station === "LEOS" ? "LEO'S" : x.station}</Tag><span className="mono dim">{x.ticket_date.slice(5)}</span><span className="mono">{money(x.amount)}</span><span className="mono dim">{x.plate || "—"}</span><span className="mono">{x.po_raw || "no PO"}</span><b className="w40">{title(x.creator) || "—"}</b><span className="red grow xs">{(x.flags || []).join(" · ")}</span></div>)}
            {tm.filter(x => (x.flags || []).length && !bad.includes(x)).length ? <div className="foot">+ {tm.filter(x => (x.flags || []).length && !bad.includes(x)).length} minor (plate misread, date drift, gas cans on a diesel truck)</div> : null}
          </Panel>
        </div>) : null}
      {tab === "units" ? (
        <Panel title="FUEL BY UNIT" right={<span className="dim">POs in range</span>} flush><table className="tbl big"><Th cols={["UNIT", "DESCRIPTION", "DRIVER", "POs", "GAL", "$", "$ / FILL"]} /><tbody>
          {byUnit.map(([k, v]) => { const vv = veh.find(x => x.id === k); return (<tr key={k}><td className="mono"><b>{k}</b>{vv?.plate ? <span className="dim"> {vv.plate}</span> : null}</td><td className="dim">{v.desc || vv?.descr}</td><td>{k === "?" ? <span className="dim">— {v.n} POs with no unit</span> : title(vv?.assigned_to || v.who)}</td><td className="mono r">{v.n}</td><td className="mono r">{N(Math.round(v.gal))}</td><td className="mono r">{money0(v.usd)}</td><td className="mono r">{money0(v.usd / v.n)}</td></tr>); })}
          {!byUnit.length ? <tr><td colSpan={7}><Empty>No fuel POs in range.</Empty></td></tr> : null}
        </tbody></table></Panel>) : null}
    </div>);
}

/* ============================================================================
   ROOM · FLEET
   ============================================================================ */
function Fleet({ d, now, q, mapNode, mapGo }) {
  const fleet = d.fleet || [], ud = d.unitDay || [];
  const wk = ud.filter(u => new Date(u.day).getTime() >= now - 8 * 864e5);
  const agg = useMemo(() => { const m = {}; wk.forEach(u => { const k = u.who; m[k] = m[k] || { who: k, unit: u.vehicle_id, mi: 0, idle: 0, drive: 0 }; m[k].mi += +u.miles || 0; m[k].idle += +u.idle_min || 0; m[k].drive += +u.drive_min || 0; }); return Object.values(m).map(x => ({ ...x, pct: x.drive ? Math.round(x.idle / x.drive * 100) : 0 })).sort((a, b) => b.idle - a.idle); }, [wk]);
  const trucks = agg.filter(a => /^V-|^P-/.test(a.unit || ""));
  const idleH = trucks.reduce((a, x) => a + x.idle, 0) / 60, gal = idleH * 0.7;
  const dsl = (d.tickets || []).filter(x => /^DIESEL$/.test(x.fuel_type || "") && new Date(x.ticket_date + "T12:00:00").getTime() >= now - 60 * 864e5); const dslG = dsl.reduce((a, x) => a + (+x.gallons || 0), 0); const dslPrice = dslG ? dsl.reduce((a, x) => a + (+x.amount || 0), 0) / dslG : 3.4;
  const shown = fleet.filter(u => !q || `${u.name} ${u.person || ""} ${u.assigned_to || ""} ${u.plate || ""} ${u.vin || ""} ${u.last_geofence || ""}`.toLowerCase().includes(q.toLowerCase()));
  const label = u => title(u.person || u.assigned_to || (u.name || "").replace(/\s*VIN.*$/i, ""));
  const state = u => (u.secs_since_seen ?? 1e9) > 86400 ? [C.faint, "dark"] : (u.last_speed || 0) > 3 ? [C.green, `${Math.round(u.last_speed)} mph`] : u.last_ignition ? [C.amber, `idling ${ago(u.secs_in_status || 0)}`] : [C.cyan, `parked ${ago(u.secs_in_status || 0)}`];
  const seen = u => (u.secs_since_seen ?? 1e9);
  return (
    <div className="room">
      <div className="strip">
        <Metric label="TRACKED UNITS" value={fleet.length} sub={`${fleet.filter(u => u.vehicle_id).length} linked · ${fleet.filter(u => !u.vehicle_id).length} unlinked`} />
        <Metric label="MOVING NOW" value={fleet.filter(u => seen(u) < 10800 && (u.last_speed || 0) > 3).length} tone={C.green} />
        <Metric label="IDLING 45M+" value={fleet.filter(u => seen(u) < 10800 && u.last_ignition && (u.last_speed || 0) <= 3 && u.secs_in_status > 2700).length} tone={C.amber} />
        <Metric label="DARK 24H+" value={fleet.filter(u => seen(u) > 86400).length} tone={fleet.some(u => seen(u) > 86400) ? C.red : C.green} sub="check the tracker" />
        <Metric label="TRUCK IDLE · 7 DAYS" value={Math.round(idleH)} unit=" h" tone={C.amber} sub={`≈ ${Math.round(gal)} gal burned standing still · ≈ ${money0(gal * dslPrice)} at ${money(dslPrice)}/gal`} big />
        <Metric label="TRUCK MILES · 7 DAYS" value={N(Math.round(trucks.reduce((a, x) => a + x.mi, 0)))} sub={`${trucks.length} trucks with trips`} />
      </div>
      <div className="g3">
        <Panel title="LIVE · WHERE EVERY UNIT IS" className="span2" flush>{mapNode}</Panel>
        <Panel title="IDLE LEADERBOARD · 7 DAYS" right={<span className="dim">miles · idle min · % of engine time</span>}>
          {trucks.slice(0, 14).map(x => (<div key={x.who} className="row" onClick={() => { const u = fleet.find(f => f.vehicle_id === x.unit); if (u?.last_lat) mapGo(u.last_lat, u.last_lon, label(u)); }}>
            <b className="grow tr">{title(x.who)}</b><span className="mono dim">{N(Math.round(x.mi))} mi</span><span className="mono" style={{ color: x.pct > 60 ? C.red : x.pct > 45 ? C.amber : C.green }}>{N(Math.round(x.idle))}</span><Ring pct={x.pct} color={x.pct > 60 ? C.red : x.pct > 45 ? C.amber : C.green} size={34} />
          </div>))}
          {!trucks.length ? <Empty>Trips not loaded yet.</Empty> : null}
        </Panel>
      </div>
      <Panel flush><table className="tbl big"><Th cols={["", "UNIT (ACTSOFT)", "PERSON", "FLEET ID", "PLATE", "GROUP", "WHERE", "STATE", "SEEN", "VIN"]} /><tbody>
        {shown.map(u => { const [c, s] = state(u); return (<tr key={u.actsoft_id} onClick={() => u.last_lat && mapGo(u.last_lat, u.last_lon, label(u))}>
          <td><Dot c={c} /></td><td><b>{(u.name || "").replace(/\s+/g, " ")}</b></td><td>{label(u)}</td><td className="mono">{u.vehicle_id || <span className="amber">unlinked</span>}</td><td className="mono">{u.plate || "—"}</td><td className="dim">{u.group_name}</td>
          <td className="tr">{u.last_geofence || u.at_jobsite || <span className="dim mono">{u.last_lat ? `${u.last_lat.toFixed(4)}, ${u.last_lon.toFixed(4)}` : "—"}</span>}</td><td style={{ color: c }}>{s}</td><td className="mono dim">{u.secs_since_seen != null ? ago(u.secs_since_seen) : "—"}</td><td className="mono faint xs">{u.vin || "—"}</td>
        </tr>); })}
        {!shown.length ? <tr><td colSpan={10}><Empty>No units. Run the actsoft-gps backfill.</Empty></td></tr> : null}
      </tbody></table></Panel>
    </div>);
}

/* ============================================================================
   ROOM · PEOPLE
   ============================================================================ */
function People({ d, t, onChanged }) {
  const ppl = d.ppl || []; const sups = ppl.filter(p => p.role === "SUPERVISOR" && p.active).map(p => p.name); const pms = ppl.filter(p => p.role === "GERENTE" && p.active).map(p => p.name);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const set = async (name, body) => { setBusy(name); setErr(""); try { await patch(`people?name=eq.${encodeURIComponent(name)}`, body, t.access_token); onChanged(); } catch (e) { setErr(String(e.message || e).slice(0, 160)); } finally { setBusy(""); } };
  const foremen = ppl.filter(p => p.role === "MAYORDOMO" && p.active).sort((a, b) => (a.supervisor || "zz").localeCompare(b.supervisor || "zz") || a.name.localeCompare(b.name));
  const byS = {}; foremen.forEach(f => { (byS[f.supervisor || "UNASSIGNED"] = byS[f.supervisor || "UNASSIGNED"] || []).push(f); });
  const fleetBy = Object.fromEntries((d.fleet || []).filter(u => u.person).map(u => [u.person, u]));
  return (
    <div className="room">
      <div className="strip">
        <Metric label="FOREMEN" value={foremen.length} sub={`${foremen.filter(f => !f.supervisor).length} without a supervisor`} tone={foremen.some(f => !f.supervisor) ? C.red : C.ink} />
        <Metric label="SUPERVISORS" value={sups.length} sub={Object.keys(byS).filter(k => k !== "UNASSIGNED").map(k => `${first(title(k))} ${byS[k].length}`).join(" · ")} />
        <Metric label="PROJECT MANAGERS" value={pms.length} />
        <Metric label="CAN DECIDE" value={ppl.filter(p => p.pin).length} sub="people holding a Bandeja PIN" />
        <Metric label="BLOCKED FROM ORDERING" value={ppl.filter(p => !p.can_order).length} sub={ppl.filter(p => !p.can_order).map(p => title(p.name)).join(", ")} tone={C.red} />
      </div>
      {err ? <div className="err">{err}</div> : null}
      <Panel title="ROUTING TABLE · WHO DECIDES FOR WHOM" right={<span className="dim">changes apply to the next order</span>} flush>
        <table className="tbl big"><Th cols={["FOREMAN", "SUPERVISOR", "PROJECT MANAGER", "TRUCK", "NOW", "CAN ORDER", "NOTES"]} /><tbody>
          {foremen.map(f => { const u = fleetBy[f.name] || fleetBy[f.same_as]; return (
            <tr key={f.name}>
              <td><b>{title(f.name)}</b>{f.same_as ? <span className="dim xs"> = {title(f.same_as)}</span> : null}</td>
              <td><select className="sel" value={f.supervisor || ""} disabled={busy === f.name} onChange={e => set(f.name, { supervisor: e.target.value || null })}><option value="">— unassigned —</option>{sups.map(s => <option key={s} value={s}>{title(s)}</option>)}</select></td>
              <td><select className="sel" value={f.pm || ""} disabled={busy === f.name} onChange={e => set(f.name, { pm: e.target.value || null })}><option value="">—</option>{pms.map(s => <option key={s} value={s}>{title(s)}</option>)}</select></td>
              <td className="mono">{u?.vehicle_id || "—"}{u?.plate ? <span className="dim"> {u.plate}</span> : null}</td>
              <td className="dim tr">{u ? (u.last_geofence || u.at_jobsite || `${(u.last_speed || 0) > 3 ? Math.round(u.last_speed) + " mph" : u.last_ignition ? "idling" : "parked"}`) : "—"}</td>
              <td><button className={`sw ${f.can_order ? "on" : ""}`} disabled={busy === f.name} onClick={() => set(f.name, { can_order: !f.can_order })}>{f.can_order ? "YES" : "NO"}</button></td>
              <td className="dim xs">{f.notes || ""}</td>
            </tr>); })}
        </tbody></table>
      </Panel>
      <Panel title="EVERYONE ELSE" flush><table className="tbl"><Th cols={["NAME", "ROLE", "PIN", "EMAIL", "NOTES"]} /><tbody>
        {ppl.filter(p => p.role !== "MAYORDOMO").sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)).map(p => <tr key={p.name}><td><b>{title(p.name)}</b></td><td className="dim">{p.role}</td><td className="mono">{p.pin ? "••••" : "—"}</td><td className="dim">{p.email || ""}</td><td className="dim xs">{p.notes || ""}</td></tr>)}
      </tbody></table></Panel>
    </div>);
}

/* ============================================================================
   ROOM · RULES
   ============================================================================ */
function Rules({ d, t, onChanged }) {
  const rules = d.rules || []; const [edit, setEdit] = useState({}); const [err, setErr] = useState("");
  const labels = { green_ceiling_usd: "Auto-approve ceiling ($)", backup_person: "Backup decider", office_person: "Office owner", escalate_backup_min: "Escalate to backup after (min)", escalate_office_min: "Escalate to office after (min)", po_reminder_min: "Remind office of missing PO after (min)", roles_can_order: "Roles allowed to order", excluded_people: "Excluded from everything", nearmap_cap_mb: "Nearmap monthly cap (MB)" };
  const g = k => rules.find(r => r.key === k)?.value;
  const save = async k => { try { await patch(`rules_config?key=eq.${k}`, { value: edit[k] }, t.access_token); setEdit(e => { const x = { ...e }; delete x[k]; return x; }); onChanged(); } catch (e) { setErr(String(e.message || e).slice(0, 160)); } };
  return (
    <div className="room">
      <div className="g3">
        <Panel title="THE KNOBS" right={<span className="dim">effective on the next order</span>} className="span2">
          {rules.map(r => (<div key={r.key} className="krow"><div><b>{labels[r.key] || r.key}</b><div className="dim xs">{r.descr}</div></div>
            <input className="inp" value={edit[r.key] ?? r.value} onChange={e => setEdit(x => ({ ...x, [r.key]: e.target.value }))} />
            {edit[r.key] != null && edit[r.key] !== r.value ? <button className="btn sm green" onClick={() => save(r.key)}>SAVE</button> : <span className="w6" />}</div>))}
          {!rules.length ? <Empty>rules_config not loaded.</Empty> : null}
          {err ? <div className="err">{err}</div> : null}
        </Panel>
        <Panel title="HOW A REQUEST IS DECIDED">
          <ol className="steps">
            <li><Dot c={C.red} /> Requester not on the roster, or blocked → <b>rejected</b>.</li>
            <li><Dot c={C.red} /> Tool-bag item (20 patterns) → <b>line struck</b>, never approvable. All lines struck → rejected.</li>
            <li><Dot c={C.red} /> Equipment already SI on the trailer inspection → <b>held</b> until the foreman explains.</li>
            <li><Dot c={C.amber} /> Off-catalog, unpriced, wrong jobsite for today, over ${g("green_ceiling_usd") || 100}, self-approved → <b>card to the supervisor</b>.</li>
            <li><Dot c={C.green} /> Everything routine, at today's jobsite, under the ceiling → <b>approved instantly</b>; office notified for PO.</li>
            <li><Dot c={C.cyan} /> No decision in {g("escalate_backup_min") || 90}m → {title(g("backup_person") || "backup")}; in {g("escalate_office_min") || 180}m → office.</li>
          </ol>
        </Panel>
      </div>
    </div>);
}

/* ============================================================================
   MAP (shared)
   ============================================================================ */
function useMap(fleet, t) {
  // The Leaflet map lives on a DOM node WE own. React destroys and recreates the panel every time the
  // room changes; we just re-append our node into the new panel, so the map (tiles, markers, zoom) survives.
  const holder = useRef(null); if (!holder.current) { const el = document.createElement("div"); el.className = "map"; holder.current = el; }
  const map = useRef(null), layer = useRef(null), pin = useRef(null);
  const [nm, setNm] = useState(null);
  const fix = () => { try { if (map.current) map.current.invalidateSize(); } catch (e) {} };
  const attach = el => { if (!el) return; if (holder.current.parentNode !== el) el.appendChild(holder.current); setTimeout(fix, 60); setTimeout(fix, 400); };
  useEffect(() => {
    const L = window.L; if (!L || !holder.current.isConnected) return;
    if (!map.current) {
      map.current = L.map(holder.current, { zoomControl: false, attributionControl: false }).setView([30.27, -97.74], 10);
      L.control.zoom({ position: "bottomright" }).addTo(map.current);
      const dark = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 16 });
      const labels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 16, pane: "overlayPane", opacity: .9 });
      const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: "osm-dim" });
      const aerial = L.tileLayer(`${SB_URL}/functions/v1/nearmap?z={z}&x={x}&y={y}`, { maxZoom: 21, minZoom: 15 }); aerial.getTileUrl = c => `${SB_URL}/functions/v1/nearmap?z=${c.z}&x=${c.x}&y=${c.y}&t=${(TOK.cur || t).access_token}`;
      dark.addTo(map.current); labels.addTo(map.current);
      L.control.layers({ "DARK": dark, "STREETS (OSM)": streets, "NEARMAP AERIAL": aerial }, { "LABELS": labels }, { position: "topright", collapsed: true }).addTo(map.current);
      let idle; const back = () => { if (map.current.hasLayer(aerial)) { map.current.removeLayer(aerial); dark.addTo(map.current); } };
      map.current.on("baselayerchange moveend zoomend", () => { clearTimeout(idle); if (map.current.hasLayer(aerial)) idle = setTimeout(back, 180e3); });
      map.current.on("baselayerchange", e => { if (/NEARMAP/.test(e.name)) { if (map.current.getZoom() < 16) map.current.setZoom(16); fetch(`${SB_URL}/functions/v1/nearmap?op=usage&t=${(TOK.cur || t).access_token}`).then(r => r.json()).then(setNm).catch(() => {}); } });
      layer.current = L.layerGroup().addTo(map.current);
      setTimeout(fix, 60); setTimeout(fix, 500); if (window.ResizeObserver) new ResizeObserver(fix).observe(holder.current);
    }
    layer.current.clearLayers(); const pts = [];
    fleet.filter(u => u.last_lat && u.last_lon).forEach(u => {
      const dark = (u.secs_since_seen ?? 1e9) > 86400, mv = (u.last_speed || 0) > 3;
      const col = dark ? C.faint : mv ? C.green : u.last_ignition ? C.amber : C.cyan;
      const m = window.L.circleMarker([u.last_lat, u.last_lon], { radius: mv ? 6 : 5, color: "#05070B", weight: 1, fillColor: col, fillOpacity: dark ? .5 : .95 }).addTo(layer.current);
      m.bindTooltip(`<b>${title(u.person || u.assigned_to || (u.name || "").replace(/\s*VIN.*$/i, ""))}</b><br>${u.last_geofence || ""} ${mv ? Math.round(u.last_speed) + " mph" : u.last_ignition ? "idling" : "parked"}<br>${ago(u.secs_since_seen || 0)} ago`, { className: "tip" });
      pts.push([u.last_lat, u.last_lon]);
    });
    if (pin.current) pin.current.addTo(layer.current);
    if (pts.length && !map.current._fit) { map.current._fit = true; setTimeout(() => { try { map.current.invalidateSize(); map.current.fitBounds(pts, { padding: [24, 24], maxZoom: 12 }); } catch (e) {} }, 120); }
  }, [fleet]);
  const go = (lat, lon, text) => { if (!map.current) return; map.current.setView([lat, lon], 18); if (pin.current) layer.current.removeLayer(pin.current); pin.current = window.L.circleMarker([lat, lon], { radius: 12, color: C.red, weight: 2, fillOpacity: .15 }).bindTooltip(text, { permanent: true, className: "tip" }); pin.current.addTo(layer.current); holder.current?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const node = <div className="mapwrap" ref={attach}>{nm ? <div className={`nmu ${nm.allowed ? "" : "red"}`}>NEARMAP {nm.mb} / {nm.cap_mb} MB THIS MONTH{nm.allowed ? "" : " · CAP REACHED"}</div> : null}</div>;
  return [node, go];
}

/* ============================================================================
   SHELL
   ============================================================================ */
const ROOMS = [["situation", "SITUATION", "◉"], ["ledger", "LEDGER", "≡"], ["orders", "ORDERS", "▤"], ["fuel", "FUEL", "◈"], ["fleet", "FLEET", "◬"], ["people", "PEOPLE", "◭"], ["rules", "RULES", "◫"]];
function Ops({ t, onOut }) {
  const [d, refresh] = useOps(t);
  const [room, setRoom] = useState(() => localStorage.getItem(K_ROOM) || "situation");
  const [q, setQ] = useState(""); const [focus, setFocus] = useState(null); const [now, setNow] = useState(Date.now()); const [clock, setClock] = useState(new Date());
  useEffect(() => { const i = setInterval(() => { setNow(Date.now()); setClock(new Date()); }, 15000); const c = setInterval(() => setClock(new Date()), 1000); return () => { clearInterval(i); clearInterval(c); }; }, []);
  useEffect(() => { localStorage.setItem(K_ROOM, room); }, [room]);
  useEffect(() => { const h = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.getElementById("q")?.focus(); } if (e.key === "Escape") setQ(""); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);
  const [mapNode, mapGo] = useMap(d.fleet || [], t);
  const go = (r, id) => { setRoom(r); setFocus(id); };
  const openOrders = (d.orders || []).filter(o => !o.is_practice && o.status === "SOLICITADO").length;
  const badFuel = (d.fuelGps || []).filter(f => f.gps_check === "NO_ESTABA").length;
  return (
    <div className="ops">
      <nav className="rail">
        <div className="brand"><div className="bm">M</div><div><div className="bn">MUÑIZ</div><div className="bs">OPS · COMMAND</div></div></div>
        {ROOMS.map(([k, l, ic]) => <button key={k} className={`rb ${room === k ? "on" : ""}`} onClick={() => setRoom(k)}><span className="ri">{ic}</span>{l}{k === "orders" && openOrders ? <span className="badge amber">{openOrders}</span> : null}{k === "fuel" && badFuel ? <span className="badge red">{badFuel}</span> : null}</button>)}
        <div className="grow" />
        <div className="rf"><div className="mono clock">{clock.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</div><div className="dim xs">{clock.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div></div>
      </nav>
      <main className="stage">
        <header className="cmd">
          <div className="crumb"><span className="dim">MUÑIZ CONCRETE &amp; CONTRACTING</span><span className="sep">/</span><b>{q.trim().length >= 2 ? "SEARCH" : ROOMS.find(r => r[0] === room)[1]}</b></div>
          <div className="search"><span className="dim">⌕</span><input id="q" value={q} onChange={e => setQ(e.target.value)} placeholder="Search — req, PO, name, plate, jobsite, item…   ⌘K" /></div>
          <div className="stat">{d.err ? <span className="red">{d.err}</span> : d.loading ? <span className="dim">CONNECTING…</span> : <><Dot c={C.green} pulse /><span className="mono">LIVE · {d.sync ? hhmm(d.sync) : ""}</span></>}</div>
          <div className="who mono dim">{t.email}</div><button className="btn sm" onClick={onOut}>SIGN OUT</button>
        </header>
        {q.trim().length >= 2 ? <SearchResults d={d} q={q} now={now} mapGo={mapGo}
            onGo={r => { setQ(""); setRoom(r); }}
            onFocusOrder={id => { setQ(""); setRoom("orders"); setFocus(id); }} /> : null}
        {q.trim().length >= 2 ? null : <>
        {room === "situation" ? <Situation d={d} now={now} go={go} mapNode={mapNode} /> : null}
        {room === "ledger" ? <Ledger d={d} q={q} t={t} /> : null}
        {room === "orders" ? <Orders d={d} now={now} t={t} q={q} focus={focus} clearFocus={() => setFocus(null)} onChanged={refresh} /> : null}
        {room === "fuel" ? <Fuel d={d} now={now} q={q} t={t} onChanged={refresh} mapGo={(a, b, c) => { setRoom("fleet"); setTimeout(() => mapGo(a, b, c), 250); }} /> : null}
        {room === "fleet" ? <Fleet d={d} now={now} q={q} mapNode={mapNode} mapGo={mapGo} /> : null}
        {room === "people" ? <People d={d} t={t} onChanged={refresh} /> : null}
        {room === "rules" ? <Rules d={d} t={t} onChanged={refresh} /> : null}
        </>}
      </main>
    </div>);
}
/* ---------- GLOBAL SEARCH: one box, every room ---------- */
function SearchResults({ d, q, now, onGo, onFocusOrder, mapGo }) {
  const k = q.trim().toLowerCase(); const has = s => String(s || "").toLowerCase().includes(k);
  const orders = (d.orders || []).filter(o => !o.is_practice && [o.req_no, o.po, o.foreman, o.jobsite, o.supervisor, o.provider, ...(o.lines || []).map(l => (l.code || "") + " " + (l.descr || ""))].some(has)).slice(0, 12);
  const fuel = (d.fuel || []).filter(p => [p.po, p.who, p.plate, p.vehicle_id, p.vehicle_desc, p.jobsite, p.station].some(has)).slice(0, 12);
  const fleet = (d.fleet || []).filter(u => [u.name, u.person, u.assigned_to, u.vehicle_id, u.plate, u.vin, u.last_geofence].some(has)).slice(0, 12);
  const inv = (d.ledger || []).filter(i => [i.invoice, i.po, i.foreman, i.project, i.vendor, i.po_descr].some(has)).slice(0, 12);
  const ppl = (d.ppl || []).filter(x => [x.name, x.role, x.supervisor, x.pm, x.same_as, x.notes].some(has)).slice(0, 12);
  const tix = (d.tickets || []).filter(x => [x.po_raw, x.creator, x.plate, x.station, x.project].some(has)).slice(0, 8);
  const total = orders.length + fuel.length + fleet.length + inv.length + ppl.length + tix.length;
  const Sec = ({ label, n, room, children }) => n ? (
    <Panel title={`${label} · ${n}`} right={<button className="btn sm" onClick={() => onGo(room)}>open {label.toLowerCase()} →</button>}>{children}</Panel>) : null;
  const R = ({ onClick, children }) => <div className="recent srch" onClick={onClick} style={{ cursor: "pointer" }}>{children}</div>;
  if (!total) return <div className="room"><Empty>Nothing matches “{q}” across orders, fuel POs, trucks, invoices, people or statement tickets.</Empty></div>;
  return (
    <div className="room">
      <div className="dim xs" style={{ margin: "0 0 10px 2px" }}>{total} result{total === 1 ? "" : "s"} for <b className="ink">“{q}”</b> · Esc clears</div>
      <Sec label="ORDERS" n={orders.length} room="orders">
        {orders.map(o => <R key={o.id} onClick={() => onFocusOrder(o.id)}><span className="mono">{o.req_no}</span><span className="rf">{title(o.foreman)}</span><Tag c={PROV[o.provider] || C.dim}>{o.provider}</Tag><span className="dim">{o.jobsite || "—"}</span><span className="mono dim">{money0(o.est_total)}</span><Tag c={(ORDER_STATUS[o.status] || ["", C.dim])[1]} dim>{(ORDER_STATUS[o.status] || [o.status])[0]}</Tag>{o.po ? <span className="mono">PO {o.po}</span> : null}</R>)}
      </Sec>
      <Sec label="FUEL POs" n={fuel.length} room="fuel">
        {fuel.map(p => <R key={p.id} onClick={() => onGo("fuel")}><span className="mono">{p.po}</span><span className="rf">{title(p.who)}</span><span className="mono">{p.vehicle_id || p.plate || "—"}</span><span className="dim">{p.jobsite}</span><Tag c={PROV[p.station] || C.dim}>{p.station}</Tag><span className="dim mono">{dt(p.ts)}</span></R>)}
      </Sec>
      <Sec label="FLEET" n={fleet.length} room="fleet">
        {fleet.map(u => <R key={u.actsoft_id} onClick={() => { onGo("fleet"); if (u.last_lat) setTimeout(() => mapGo(u.last_lat, u.last_lon, title(u.person || u.assigned_to || u.name)), 250); }}><span className="rf">{title(u.person || u.assigned_to || (u.name || "").replace(/\s*VIN.*$/i, ""))}</span><span className="mono">{u.vehicle_id || "unlinked"}</span><span className="mono dim">{u.plate || ""}</span><span className="dim">{u.last_geofence || (u.last_lat ? `${(+u.last_lat).toFixed(4)}, ${(+u.last_lon).toFixed(4)}` : "—")}</span><span className="dim mono">{u.secs_since_seen != null ? ago(u.secs_since_seen) + " ago" : ""}</span></R>)}
      </Sec>
      <Sec label="INVOICES" n={inv.length} room="ledger">
        {inv.map(i => <R key={i.vendor + i.invoice} onClick={() => onGo("ledger")}><Tag c={PROV[i.vendor] || C.dim}>{i.vendor}</Tag><span className="mono">{i.invoice}</span><span className="mono">PO {i.po || "—"}</span><span className="rf">{title(i.foreman)}</span><span className="dim">{i.project || ""}</span><span className="mono dim">{money0(i.total)}</span><span className={i.po_check === "OK" ? "dim" : "red"}>{i.po_check}</span></R>)}
      </Sec>
      <Sec label="STATEMENT TICKETS" n={tix.length} room="fuel">
        {tix.map(x => <R key={x.id} onClick={() => onGo("fuel")}><Tag c={PROV[x.station] || C.dim}>{x.station}</Tag><span className="mono">{x.ticket_date}</span><span className="mono">PO {x.po_raw || "—"}</span><span className="rf">{title(x.creator)}</span><span className="dim">{x.fuel_type} · {x.gallons ? Math.round(x.gallons) + " gal" : ""}</span><span className="mono dim">{money0(x.amount)}</span></R>)}
      </Sec>
      <Sec label="PEOPLE" n={ppl.length} room="people">
        {ppl.map(x => <R key={x.name} onClick={() => onGo("people")}><span className="rf">{title(x.name)}</span><Tag c={C.dim} dim>{x.role}</Tag><span className="dim">{x.supervisor ? "→ " + title(x.supervisor) : ""}</span><span className="dim">{x.pm ? "PM " + title(x.pm) : ""}</span>{x.same_as ? <span className="dim">= {title(x.same_as)}</span> : null}</R>)}
      </Sec>
    </div>);
}

function Gate({ onIn }) {
  const [e, setE] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(""); try { onIn(await login(e.trim(), p)); } catch (x) { setErr("Sign-in failed. Office accounts only."); } finally { setBusy(false); } };
  return (<div className="gate"><div className="gcard"><Tick /><div className="bm big">M</div><div className="bn">MUÑIZ OPS</div><div className="bs">COMMAND CENTER · OFFICE ACCESS</div>
    <input className="inp" placeholder="email" value={e} onChange={x => setE(x.target.value)} autoFocus /><input className="inp" type="password" placeholder="password" value={p} onChange={x => setP(x.target.value)} onKeyDown={x => x.key === "Enter" && go()} />
    {err ? <div className="err">{err}</div> : null}<button className="btn green big" disabled={busy || !e || !p} onClick={go}>ENTER</button>
    <div className="dim xs">Every order, fuel PO and truck movement in one place.</div></div></div>);
}
function App() { const [t, setT] = useState(() => tok()); useEffect(() => { const h = () => setT(null); window.addEventListener("muniz-signout", h); return () => window.removeEventListener("muniz-signout", h); }, []); if (!SB_URL || !SB_KEY) return <div className="gate"><div className="err">SUPABASE.URL / ANON_KEY missing in config.js</div></div>; return t ? <Ops t={t} onOut={() => { signOut(); setT(null); }} /> : <Gate onIn={setT} />; }
createRoot(document.getElementById("root")).render(<App />);
