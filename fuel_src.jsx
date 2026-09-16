import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";

/* =====================================================================
   MUÑIZ COMBUSTIBLE · v3.6
   Lives INSIDE the orders app. One header, one back arrow, no messages:
   create_fuel_po issues the number on the spot.
     · a truck's fuel type comes from the registry, so the plate must
       resolve to a real unit
     · a machine is always diésel rojo, so the person just types the number
       painted on it - first time included. That number IS the unit: its own
       hour counter from day one, and two machines never share one
     · the reading guard runs against the unit the PO will carry and waits
       for the server's last reading ("REVISANDO…")
     · if the server still rejects, plain Spanish and a button back to fix it
   ===================================================================== */

const CFG  = (typeof window !== "undefined" && window.MUNIZ_CONFIG) || {};
const FUEL = CFG.COMBUSTIBLE || {};

/* ---------- backend (Supabase: Postgres + REST). No SDK: plain fetch, ~40 lines. ---------- */
const SB = CFG.SUPABASE || {};
const SB_URL = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/auth\/v1$/, "");
const SB_KEY = String(SB.ANON_KEY || "");
const HAS_BACKEND = !!(SB_URL && SB_KEY);
const K_TOKEN = "muniz_office_token", K_DEV = "muniz_device_id";
const deviceId = () => { try { let d = localStorage.getItem(K_DEV); if (!d) { d = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2); localStorage.setItem(K_DEV, d); } return d; } catch (e) { return "nodev"; } };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const officeToken = () => { try { const t = JSON.parse(localStorage.getItem(K_TOKEN) || "null"); return t && t.exp * 1000 > Date.now() ? t : null; } catch (e) { return null; } };
const hdr = tok => { const h = { apikey: SB_KEY, "Content-Type": "application/json" };
  if (tok) h.Authorization = "Bearer " + tok;
  return h; };
async function sbGet(path, tok) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: hdr(tok) });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbInsert(table, row, tok) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: { ...hdr(tok), Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!r.ok) { const e = new Error(`POST ${table}: ${r.status}`); e.status = r.status; e.body = await r.text(); throw e; }
  const j = await r.json(); return Array.isArray(j) ? j[0] : j;
}
async function sbRpc(fn, args, tok) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: hdr(tok), body: JSON.stringify(args || {}) });
  if (!r.ok) {
    /* surface the database's own message - that is what makes a problem fixable */
    let msg = "";
    try { const j = await r.json(); msg = j.message || j.hint || j.error_description || j.error || JSON.stringify(j); }
    catch (e) { try { msg = await r.text(); } catch (e2) { msg = ""; } }
    const err = new Error(msg ? msg : `${fn}: HTTP ${r.status}`);
    err.status = r.status; err.body = msg;
    throw err;
  }
  return r.json();
}
async function sbLogin(email, password) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error("login");
  const j = await r.json();
  const tok = { access_token: j.access_token, email: (j.user || {}).email || email, exp: Math.floor(Date.now() / 1000) + (j.expires_in || 3600) };
  try { localStorage.setItem(K_TOKEN, JSON.stringify(tok)); } catch (e) {}
  return tok;
}
/* fire-and-forget telemetry: every step is an event with a timestamp */
function logEvent(event, extra) {
  if (!HAS_BACKEND) return;
  try { fetch(`${SB_URL}/rest/v1/events`, { method: "POST", headers: hdr(null), body: JSON.stringify({ device_id: deviceId(), app: "fuel", event, ...(extra || {}) }) }).catch(() => {}); } catch (e) {}
}
const APP_URL = "https://muniz-2026.github.io/muniz-pedidos/";
const VERSION = "3.6";

const up = s => String(s || "").toUpperCase().trim();
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/* ---------- people ---------- */
const FOREMEN_BASE = ["ALVARO AGUIRRE","FRANCISCO AGUIRRE","ENRIQUE ALVARADO","FRANCISCO BOCANEGRA","RUBEN CANO","CARLOS DIAZ",
  "JULIAN GONZALEZ","OMAR ALFREDO HERNANDEZ","JOSE GUADALUPE JUAREZ","PEDRO LIMON","DAVID MOLINA","SERGIO NINO","DANIEL ORTEGA",
  "JUAN PEREZ","HERVEY QUINTERO","GIOVANNI RODRIGUEZ","GERARDO SANCHEZ","ISIDRO SANCHEZ","RICARDO SANCHEZ","VICTOR SANCHEZ",
  "DIEGO VAZQUEZ","JOSE ZAMARRIPA"];
const SUPS = Object.keys(CFG.SUPERVISORES || {}).map(up);
const PMS  = Object.keys(CFG.GERENTES || {}).map(up);
const DRIVERS = Object.keys(CFG.CHOFERES || {}).map(up);
const EXTRA = (FUEL.USUARIOS_EXTRA || []).map(up);
const PERSONAL_CFG = (CFG.PERSONAL || []).map(up);
const OFICINA = (() => { const o = {}; const m = CFG.OFICINA || {};
  for (const k in m) o[up(k)] = String(m[k] || ""); return o; })();
/* ---------- name key: the same person no matter how the name is spelled.
   Gonzales/González/Gonzalez, Nino/Niño, Perez/Peres, Hernandez/Ernandez,
   Vazquez/Bazquez all collapse to one key. Checked against the whole roster: no two different
   people collide. Lookups try the exact spelling first, then the key. -------- */
const nk = s => String(s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Z ]/g, " ").replace(/H/g, "").replace(/C([EI])/g, "S$1").replace(/Z/g, "S")
  .replace(/V/g, "B").replace(/Y/g, "I").replace(/(.)\1+/g, "$1").replace(/\s+/g, " ").trim()
  .split(" ").map(w => (w.length > 3 ? w.replace(/S$/, "") : w)).join(" ");
const nEq = (a, b) => { const x = nk(a); return !!x && x === nk(b); };
const nGet = (m, n) => { if (!m) return undefined; const k = up(n); if (Object.prototype.hasOwnProperty.call(m, k)) return m[k];
  const t = nk(n); if (!t) return undefined; for (const x in m) if (nk(x) === t) return m[x]; return undefined; };
const nHas = (a, n) => (a || []).some(x => nEq(x, n));
const nUniq = list => { const seen = {}, out = []; list.forEach(x => { const k = nk(x); if (!k || seen[k]) return; seen[k] = 1; out.push(x); }); return out; };
const lastName = s => { const p = up(s).split(/\s+/); return p[p.length - 1] + " " + p.slice(0, -1).join(" "); };
const everyone = () => nUniq(PEOPLE_DB ? PEOPLE_DB.map(p => up(p.name))
  : [...FOREMEN_BASE, ...PERSONAL_CFG, ...SUPS, ...PMS, ...DRIVERS, ...EXTRA, ...Object.keys(OFICINA)])
  .sort((a, b) => lastName(a).localeCompare(lastName(b), "es"));
const roleOf = n => { if (PEOPLE_DB) { const p = PEOPLE_DB.find(x => nEq(x.name, n)); if (p) return up(p.role); }
  return nGet(OFICINA, n) !== undefined ? "OFICINA" : nHas(SUPS, n) ? "SUPERVISOR" : nHas(PMS, n) ? "GERENTE"
  : nHas(DRIVERS, n) ? "CHOFER" : nHas(FOREMEN_BASE, n) ? "MAYORDOMO" : "PERSONAL"; };

/* ---------- fleet / stations / jobsites ---------- */
let FLOTA = (FUEL.FLOTA || []).map(v => ({ ...v, de: up(v.de), comb: up(v.comb), tipo: up(v.tipo), placa: up(v.placa) }));
let STATIONS = FUEL.ESTACIONES || {};
let OBRAS = FUEL.OBRAS || [];
let OBRA_SEMANA = (() => { const o = {}; const m = FUEL.OBRA_SEMANA || {}; for (const k in m) o[up(k)] = m[k]; return o; })();
let PEOPLE_DB = null;
const K_REF = "muniz_fuel_ref";
function applyRef(ref) {
  if (!ref) return;
  if (ref.vehicles && ref.vehicles.length) FLOTA = ref.vehicles.filter(v => v.active !== false).map(v => ({ id: v.id, placa: up(v.plate || ""), desc: v.descr, tipo: up(v.tipo), comb: up(v.comb), de: up(v.assigned_to || "") }));
  if (ref.stations && ref.stations.length) { const o = {}; ref.stations.filter(s => s.active !== false).forEach(s => { o[s.code] = { nombre: s.name, corto: s.short, tel: s.phone || "", color: s.color }; }); STATIONS = o; }
  if (ref.jobsites && ref.jobsites.length) OBRAS = ref.jobsites.filter(j => j.active !== false).map(j => j.name);
  if (ref.roster && ref.roster.length) { const o = {}; ref.roster.forEach(r => { o[up(r.person)] = r.jobsite; }); OBRA_SEMANA = o; }
  if (ref.people && ref.people.length) PEOPLE_DB = ref.people.filter(p => p.active !== false);
}
try { applyRef(JSON.parse(localStorage.getItem(K_REF) || "null")); } catch (e) {}
async function refreshRef() {
  if (!HAS_BACKEND) return false;
  const monday = (() => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); })();
  const [vehicles, stations, jobsites, roster, people] = await Promise.all([
    sbGet("vehicles?select=*&order=id"), sbGet("stations?select=*"), sbGet("jobsites?select=*&order=name"),
    sbGet(`roster?select=person,jobsite,week_start&week_start=lte.${monday}&order=week_start.desc`), sbGet("people?select=name,role,active&order=name")]);
  const seen = {}; const latest = roster.filter(r => { if (seen[r.person]) return false; seen[r.person] = 1; return true; });
  const ref = { vehicles, stations, jobsites, roster: latest, people, at: Date.now() };
  try { localStorage.setItem(K_REF, JSON.stringify(ref)); } catch (e) {}
  applyRef(ref); return true;
}
const AL = Object.assign({ HORAS_MIN_ENTRE_CARGAS: 6, CARGAS_MAX_7DIAS: 4, MILLAS_MIN_ENTRE_CARGAS: 40 }, FUEL.ALERTAS || {});
/* ---------- storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const K_ME = "muniz_fuel_me", K_HIST = "muniz_fuel_hist", K_LOG = "muniz_fuel_log", K_PLATES = "muniz_fuel_plates", K_OF = "muniz_oficina";
const K_PEND = "muniz_fuel_pend";     /* POs generated but not yet registered */
const K_SHAPE = "muniz_fuel_shape";   /* que forma de payload acepta create_fuel_po en este servidor */
const WEBHOOK = String(FUEL.WEBHOOK || "");
const officeUnlocked = () => { try { return localStorage.getItem(K_OF) === "1"; } catch (e) { return false; } };
/* ---------- encoding (same as the orders app) ---------- */
const b64e = o => { const s = JSON.stringify(o); const b = btoa(unescape(encodeURIComponent(s))); return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64d = t => { try { let s = t.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - s.length % 4) % 4); return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; } };
const smsHref = (tels, body) => { const to = (Array.isArray(tels) ? tels : [tels]).filter(Boolean).map(t => "+" + String(t).replace(/\D/g, "")).join(","); return "sms:" + to + "?&body=" + encodeURIComponent(body); };

/* ---------- PO number: F + YYMMDD + - + 4 chars from the clock. Unique, readable, unmistakably fuel ---------- */
function makePO(d) {
  const y = String(d.getFullYear()).slice(2), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  const secs = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  const code = (secs * 36 + Math.floor(Math.random() * 36)).toString(36).toUpperCase().padStart(4, "0").slice(-4);
  return `F${y}${m}${dd}-${code}`;
}
const fmtNum = n => (n === "" || n == null) ? "—" : Number(n).toLocaleString("en-US");
const fmtDT = ts => { const d = new Date(ts); return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); };
const hoursBetween = (a, b) => Math.abs(a - b) / 36e5;
/* ---------- red flags: one function, used live and in the office ---------- */
function flagsFor(e, history) {
  const f = [];
  const prev = history.filter(h => h.vid === e.vid && h.ts < e.ts).sort((a, b) => b.ts - a.ts);
  const last = prev[0];
  if (e.manualVeh) f.push({ lvl: "red", t: "Vehículo fuera del registro" });
  if (e.plateTyped) f.push({ lvl: "amber", t: "Placa dictada por la persona (no registrada)" });
  if (e.obraOtra) f.push({ lvl: "amber", t: "Obra escrita a mano" });
  if (e.obraSemana && e.obra && e.obra !== e.obraSemana) f.push({ lvl: "amber", t: `Obra distinta al rol (${e.obraSemana})` });
  if (last) {
    const h = hoursBetween(e.ts, last.ts);
    if (h < 24 && e.tipo !== "PIPA") f.push({ lvl: "red", t: `Mismo vehículo cargó hace ${h < 1 ? "menos de 1 h" : Math.round(h) + " h"}` });
    if (e.tipo === "CAMIONETA" && e.lectura !== "" && last.lectura !== "") {
      const diff = Number(e.lectura) - Number(last.lectura);
      if (diff < 0) f.push({ lvl: "red", t: `Odómetro retrocedió (${fmtNum(last.lectura)} → ${fmtNum(e.lectura)})` });
      else if (diff < AL.MILLAS_MIN_ENTRE_CARGAS) f.push({ lvl: "amber", t: `Solo ${diff} mi desde la última carga` });
    }
    if (e.tipo === "MAQUINARIA" && e.lectura !== "" && last.lectura !== "" && Number(e.lectura) < Number(last.lectura))
      f.push({ lvl: "red", t: `Horas retrocedieron (${fmtNum(last.lectura)} → ${fmtNum(e.lectura)})` });
  }
  const week = prev.filter(h => e.ts - h.ts < 7 * 864e5).length + 1;
  if (week > AL.CARGAS_MAX_7DIAS && e.tipo !== "PIPA") f.push({ lvl: "amber", t: `${week} cargas en 7 días` });
  const d = new Date(e.ts), hr = d.getHours(), wd = d.getDay();
  if (wd === 0) f.push({ lvl: "amber", t: "Domingo" });
  if (hr < 5 || hr >= 20) f.push({ lvl: "amber", t: "Fuera de horario" });
  const sameDayVeh = new Set(history.filter(h => h.who === e.who && Math.abs(h.ts - e.ts) < 864e5 && h.vid !== e.vid).map(h => h.vid));
  if (sameDayVeh.size >= 2) f.push({ lvl: "amber", t: `${e.who.split(" ")[0]} cargó ${sameDayVeh.size + 1} vehículos distintos hoy` });
  return f;
}
const OShell = ({ children, dark = true }) => (
  <div className={`min-h-screen ${dark ? "bg-[#0B0F14] text-white" : "bg-[#F4F1EA] text-[#141414]"}`}
       style={{ fontFamily: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" }}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@700&display=swap');
      .display{font-family:'Archivo Black',system-ui,sans-serif;letter-spacing:-0.02em}
      .mono{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace}
      .card{background:#121822;border:1px solid #1E2733;border-radius:20px}
      .card-light{background:#fff;border:1px solid #E6E1D8;border-radius:20px}
      .btn{border-radius:16px;font-weight:900;transition:transform .08s ease}
      .btn:active{transform:scale(.97)}
      .stripe{background:repeating-linear-gradient(135deg,#F5B800 0 14px,#111 14px 28px)}
      .perf{background-image:radial-gradient(circle,#0B0F14 6px,transparent 7px);background-size:22px 22px;background-position:center;height:22px}
      @keyframes pop{0%{transform:scale(.96);opacity:0}100%{transform:scale(1);opacity:1}}
      .pop{animation:pop .22s ease-out}
    `}</style>
    {children}
  </div>
);

const OTop = ({ step, total, onBack, title, sub }) => (
  <div className="px-4 pt-4 pb-2">
    <div className="flex items-center gap-3">
      {onBack ? <button onClick={onBack} aria-label="Atrás" className="w-11 h-11 rounded-2xl bg-[#1A2230] text-white text-xl font-black">←</button>
               : <div className="w-11 h-11 rounded-2xl bg-[#F5B800] text-[#0B0F14] flex items-center justify-center text-2xl">⛽</div>}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-black tracking-[0.18em] text-[#8B95A5]">MUÑIZ COMBUSTIBLE{step ? ` · PASO ${step} DE ${total}` : ""}</div>
        <div className="display text-[24px] leading-tight text-white truncate">{title}</div>
        {sub ? <div className="text-[13px] text-[#B4BCC8] mt-0.5">{sub}</div> : null}
      </div>
    </div>
    {step ? <div className="mt-3 h-1.5 rounded-full bg-[#1A2230] overflow-hidden">
      <div className="h-full bg-[#F5B800] transition-all" style={{ width: `${Math.round(step / total * 100)}%` }} /></div> : null}
  </div>
);

const OBig = ({ children, onClick, color = "#F5B800", text = "#0B0F14", disabled }) => (
  <button onClick={disabled ? undefined : onClick} disabled={disabled}
    className={`btn w-full py-4 text-[18px] ${disabled ? "opacity-40" : ""}`} style={{ background: color, color: text }}>{children}</button>
);

const OFuelBadge = ({ comb, big }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full font-black ${big ? "px-4 py-2 text-[16px]" : "px-2.5 py-1 text-[11px]"}`}
        style={{ background: FUEL_COLOR[comb] || "#374151", color: "#fff" }}>
    {comb === "DIESEL" ? "🟢" : "🟠"} {comb}
  </span>
);
/* ===================================================================== PIN */
function PinGate({ onOk, onCancel }) {
  const [pin, setPin] = useState(""); const [bad, setBad] = useState(false);
  const try_ = v => { for (const k in OFICINA) if (OFICINA[k] && OFICINA[k] === v) { try { localStorage.setItem(K_OF, "1"); } catch (e) {} onOk(k); return; } setBad(true); setPin(""); setTimeout(() => setBad(false), 1200); };
  const tap = d => { const v = (pin + d).slice(0, 4); setPin(v); if (v.length === 4) setTimeout(() => try_(v), 100); };
  return (
    <div className="fixed inset-0 z-50 bg-[#0B0F14] flex flex-col items-center justify-center px-6">
      <div className="text-white text-[15px] font-black tracking-[0.2em]">CLAVE</div>
      <div className={`mt-4 flex gap-3 ${bad ? "animate-pulse" : ""}`}>{[0,1,2,3].map(i => <div key={i} className={`w-5 h-5 rounded-full border-2 ${i < pin.length ? "bg-white border-white" : "border-[#4B5563]"}`} />)}</div>
      {bad ? <div className="mt-3 text-[#F87171] text-[14px] font-black">CLAVE INCORRECTA</div> : null}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {["1","2","3","4","5","6","7","8","9"].map(d => <button key={d} onClick={() => tap(d)} className="w-20 h-20 rounded-full bg-[#1A2230] text-white text-3xl font-black">{d}</button>)}
        <button onClick={() => setPin("")} className="w-20 h-20 rounded-full text-[#8B95A5] text-[13px] font-black">BORRAR</button>
        <button onClick={() => tap("0")} className="w-20 h-20 rounded-full bg-[#1A2230] text-white text-3xl font-black">0</button>
        <button onClick={onCancel} className="w-20 h-20 rounded-full text-[#8B95A5] text-[13px] font-black">SALIR</button>
      </div>
    </div>);
}
/* ===================================================================== OFFICE CONSOLE */
function Login({ onOk, onCancel }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(""); try { const t = await sbLogin(email.trim(), pw); onOk(t); } catch (e) { setErr("Correo o contraseña incorrectos"); } finally { setBusy(false); } };
  return (
    <OShell>
      <OTop title="Oficina" sub="Entra con tu correo de Muñiz" />
      <div className="px-4 pb-8">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="correo" type="email" autoCapitalize="none"
          className="w-full h-14 rounded-2xl bg-[#121822] border border-[#1E2733] px-4 text-[17px] text-white outline-none" />
        <input value={pw} onChange={e => setPw(e.target.value)} placeholder="contraseña" type="password" onKeyDown={e => e.key === "Enter" && go()}
          className="mt-2 w-full h-14 rounded-2xl bg-[#121822] border border-[#1E2733] px-4 text-[17px] text-white outline-none" />
        {err ? <div className="mt-3 text-[#F87171] text-[14px] font-black">{err}</div> : null}
        <div className="mt-5"><OBig onClick={go} disabled={busy || !email || !pw}>{busy ? "ENTRANDO…" : "ENTRAR"}</OBig></div>
        <button onClick={onCancel} className="mt-4 w-full text-[12px] font-black text-[#5B6572]">CANCELAR</button>
      </div>
    </OShell>);
}

function Office({ whoOf, onExit, onNew, token }) {
  const [log, setLog] = useState(HAS_BACKEND ? [] : LS.get(K_LOG, []));
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState("");
  const [syncAt, setSyncAt] = useState(0);
  useEffect(() => {
    if (!HAS_BACKEND) { const f = () => setLog(LS.get(K_LOG, [])); window.addEventListener("hashchange", f); const t = setInterval(f, 1500); return () => { window.removeEventListener("hashchange", f); clearInterval(t); }; }
    let alive = true;
    const pull = async () => {
      try {
        const tok = token && token.access_token;
        const [rows, ev] = await Promise.all([
          sbGet("fuel_pos?select=*&order=created_at.desc&limit=1000", tok),
          sbGet("events?select=ts,device_id,who,event,step,meta&order=ts.desc&limit=400", tok)]);
        if (!alive) return;
        setLog(rows.map(r => ({ po: r.po, ts: new Date(r.created_at).getTime(), who: r.who, role: r.role, vid: r.vehicle_id, veh: r.vehicle_desc, tipo: r.tipo, comb: r.comb,
          placa: r.plate || "", equipo: r.equipo || "", lectura: r.reading == null ? "" : String(r.reading), obra: r.jobsite, obraOtra: r.jobsite_other,
          obraSemana: r.jobsite_week || "", est: r.station, plateTyped: r.plate_typed, manualVeh: false, secs: r.seconds_to_po, srvFlags: r.flags || [] })));
        setEvents(ev); setErr(""); setSyncAt(Date.now());
      } catch (e) { if (alive) setErr(String(e.message || e)); }
    };
    pull(); const t = setInterval(pull, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);
  const live = useMemo(() => { const cut = Date.now() - 5 * 60e3; const m = {}; events.forEach(e => { const t = new Date(e.ts).getTime(); if (t > cut && e.who) { if (!m[e.who] || m[e.who].t < t) m[e.who] = { t, step: e.step, event: e.event }; } }); return Object.entries(m).sort((a, b) => b[1].t - a[1].t); }, [events]);
  const avgSecs = useMemo(() => { const x = log.filter(e => e.secs).map(e => e.secs); return x.length ? Math.round(x.reduce((a, b) => a + b, 0) / x.length) : null; }, [log]);
  const [tab, setTab] = useState("hoy");
  const [filter, setFilter] = useState("");
  const sorted = useMemo(() => [...log].sort((a, b) => b.ts - a.ts), [log]);
  const withFlags = useMemo(() => sorted.map(e => ({ ...e, flags: flagsFor(e, log) })), [sorted, log]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const wk = Date.now() - 7 * 864e5;
  const stat = (fn) => withFlags.filter(fn);
  const todayL = stat(e => e.ts >= today.getTime()), weekL = stat(e => e.ts >= wk);
  const alerts = withFlags.filter(e => e.flags.some(f => f.lvl === "red")), ambers = withFlags.filter(e => e.flags.length && !e.flags.some(f => f.lvl === "red"));
  const byVeh = useMemo(() => { const m = {}; log.forEach(e => { (m[e.vid] = m[e.vid] || []).push(e); }); return m; }, [log]);

  const csv = () => {
    const cl = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const H = ["po","fecha","hora","quien","rol","vehiculo","tipo","combustible","placa","equipo","lectura","obra","obra_rol_semana","estacion","alertas"];
    const R = withFlags.map(e => { const d = new Date(e.ts); return [e.po, d.toLocaleDateString("es-MX"), d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }), e.who, e.role, e.veh, e.tipo, e.comb, e.placa, e.equipo, e.lectura, e.obra, e.obraSemana, (STATIONS[e.est] || {}).nombre || e.est, e.flags.map(f => f.t).join(" | ")].map(cl).join(","); });
    const blob = new Blob(["\uFEFF" + [H.join(","), ...R].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `combustible_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  const Row = ({ e }) => {
    const s = STATIONS[e.est] || {}; const red = e.flags.some(f => f.lvl === "red");
    return (
      <div className={`card-light px-4 py-3 ${red ? "border-[#DC2626] border-2" : e.flags.length ? "border-[#F59E0B] border-2" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="mono text-[15px] font-black">{e.po}</div>
          <div className="flex items-center gap-1.5"><OFuelBadge comb={e.comb} /><span className="text-[10px] font-black px-2 py-1 rounded-full" style={{ background: s.color || "#ddd", color: e.est === "LEOS" ? "#0B0F14" : "#fff" }}>{s.corto || e.est}</span></div>
        </div>
        <div className="mt-1.5 text-[15px] font-black">{e.who} <span className="text-[#6B7280] font-bold text-[13px]">· {e.veh}{e.placa ? ` · ${e.placa}` : ""}{e.equipo ? ` · ${e.equipo}` : ""}</span></div>
        <div className="text-[12px] text-[#6B7280] mt-0.5">{fmtDT(e.ts)} · {e.obra}{e.lectura !== "" ? ` · ${e.tipo === "MAQUINARIA" ? "hrs" : "mi"} ${fmtNum(e.lectura)}` : ""}</div>
        {e.flags.length ? <div className="mt-2 flex flex-wrap gap-1">{e.flags.map((f, i) => <span key={i} className={`text-[11px] font-black px-2 py-0.5 rounded-full ${f.lvl === "red" ? "bg-[#DC2626] text-white" : "bg-[#FDE68A] text-[#78350F]"}`}>{f.lvl === "red" ? "🔴" : "🟠"} {f.t}</span>)}</div> : null}
      </div>);
  };
  const Stat = ({ n, l }) => <div className="card-light px-3 py-3 text-center"><div className="display text-[28px] leading-none">{n}</div><div className="text-[10px] font-black tracking-widest text-[#6B7280] mt-1">{l}</div></div>;
  const list = tab === "hoy" ? todayL : tab === "semana" ? weekL : tab === "alertas" ? [...alerts, ...ambers] : withFlags;
  const shown = list.filter(e => !filter || norm(e.who + " " + e.placa + " " + e.po + " " + e.obra + " " + e.veh).includes(norm(filter)));

  return (
    <OShell dark={false}>
      <div className="bg-[#0B0F14] text-white px-4 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div><div className="text-[11px] font-black tracking-[0.18em] text-[#8B95A5]">MUÑIZ COMBUSTIBLE · OFICINA</div><div className="display text-[24px]">Registro de combustible</div><div className="text-[12px] text-[#B4BCC8]">{whoOf}</div></div>
          <button onClick={onExit} className="text-[11px] font-black text-[#8B95A5]">SALIR</button>
        </div>
        {HAS_BACKEND ? (
          <div className="mt-3 flex items-center justify-between text-[11px] font-black">
            <span className={err ? "text-[#F87171]" : "text-[#86EFAC]"}>{err ? "⚠ sin conexión con la base de datos" : `● EN VIVO · ${syncAt ? fmtDT(syncAt) : "…"}`}</span>
            <span className="text-[#8B95A5]">{live.length} en el app ahora{avgSecs != null ? ` · ${Math.floor(avgSecs / 60)}:${String(avgSecs % 60).padStart(2, "0")} por PO` : ""}</span>
          </div>) : null}
        {live.length ? (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {live.slice(0, 8).map(([n, x]) => <span key={n} className="shrink-0 text-[11px] font-black px-2.5 py-1 rounded-full bg-[#1A2230] text-white">● {n.split(" ")[0]}{x.event === "po_created" ? " ✓" : x.step ? ` · paso ${x.step}` : ""}</span>)}
          </div>) : null}
        <div className="grid grid-cols-4 gap-2 mt-4 text-[#141414]">
          <Stat n={todayL.length} l="HOY" /><Stat n={weekL.length} l="7 DÍAS" />
          <Stat n={weekL.filter(e => e.est === "TEXCON").length} l="TEX-CON" /><Stat n={weekL.filter(e => e.est === "LEOS").length} l="LEO'S" />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2 text-[#141414]">
          <div className="card-light px-3 py-2 flex items-center justify-between"><span className="text-[11px] font-black text-[#6B7280]">7 DÍAS · DIÉSEL</span><span className="display text-[20px]">{weekL.filter(e => e.comb === "DIESEL").length}</span></div>
          <div className="card-light px-3 py-2 flex items-center justify-between"><span className="text-[11px] font-black text-[#6B7280]">7 DÍAS · GASOLINA</span><span className="display text-[20px]">{weekL.filter(e => e.comb === "GASOLINA").length}</span></div>
        </div>
        {alerts.length ? <div className="mt-3 rounded-2xl bg-[#DC2626] px-4 py-3 font-black text-[14px]">🔴 {alerts.length} PO(s) con alerta roja — revisar hoy</div> : null}
      </div>
      <div className="px-4 pt-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[["hoy", "HOY"], ["semana", "7 DÍAS"], ["alertas", `ALERTAS${alerts.length + ambers.length ? " · " + (alerts.length + ambers.length) : ""}`], ["todo", "TODO"], ["flota", "FLOTA"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`shrink-0 px-3 py-2 rounded-full text-[12px] font-black ${tab === k ? "bg-[#0B0F14] text-white" : "bg-white text-[#6B7280] border border-[#E6E1D8]"}`}>{l}</button>))}
        </div>
        {tab !== "flota" ? (<>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar por nombre, placa, PO u obra…" className="mt-3 w-full h-12 rounded-2xl bg-white border border-[#E6E1D8] px-4 text-[15px] outline-none" />
          <div className="mt-3 space-y-2 pb-6">
            {shown.length ? shown.map(e => <Row key={e.po + e.ts} e={e} />) : <div className="card-light px-4 py-8 text-center text-[#6B7280] font-bold">Nada aquí todavía.<br /><span className="text-[12px] font-normal">Los PO llegan cuando abres el link REGISTRO del texto.</span></div>}
          </div>
        </>) : (
          <div className="mt-3 space-y-2 pb-6">
            {FLOTA.map(v => { const h = (byVeh[v.id] || []).sort((a, b) => b.ts - a.ts); const l = h[0]; const typed = (h.find(x => x.plateTyped && x.placa) || {}).placa;
              return (<div key={v.id} className="card-light px-4 py-3 flex items-center gap-3">
                <OFuelBadge comb={v.comb} />
                <div className="flex-1 min-w-0"><div className="text-[14px] font-black truncate">{v.desc} <span className="text-[#6B7280] font-bold">· {v.de || "compartido"}</span></div>
                  <div className="mono text-[12px] text-[#6B7280]">{v.placa || (typed ? `${typed} (dictada)` : "sin placa")} · {h.length} carga(s){l && l.lectura !== "" ? ` · última ${fmtNum(l.lectura)}` : ""}</div></div>
              </div>); })}
          </div>)}
        <div className="pb-10 grid grid-cols-2 gap-2">
          <button onClick={csv} className="btn py-3.5 bg-[#0B0F14] text-white text-[14px]">⬇ EXPORTAR CSV</button>
          <button onClick={onNew} className="btn py-3.5 bg-[#F5B800] text-[#0B0F14] text-[14px]">⛽ NUEVO PO</button>
        </div>
      </div>
    </OShell>);
}

/* =====================================================================
   UI · same design system as MUÑIZ PEDIDOS (app.js): #EDEBE6 background,
   white cards with #D8D4CB borders, black square ←, Archivo Black titles,
   the hazard stripe on top. Hand-written CSS (no Tailwind dependency) so
   the wizard renders identically inside index.html and in fuel.html.
   ===================================================================== */
const C = { bg: "#EDEBE6", ink: "#17181A", line: "#D8D4CB", mute: "#6B675E", faint: "#8A867C", orange: "#FF5A00",
            blue: "#2E5C8A", green: "#1F8A3B", red: "#C81E1E", amber: "#FFB800", fuel: "#1E3A8A", paper: "#F5F3EE" };
const FUEL_COLOR = { DIESEL: C.green, GASOLINA: C.orange, "DIESEL ROJO": C.red };
const FUEL_LABEL = { DIESEL: "DIÉSEL", GASOLINA: "GASOLINA", "DIESEL ROJO": "DIÉSEL ROJO" };
const TIPO_LABEL = { CAMIONETA: "Camioneta", MAQUINARIA: "Maquinaria", TAMBO: "Tambo / tanque", PIPA: "Camión de combustible" };

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap');
.mzf{height:100%;display:flex;flex-direction:column;background:${C.bg};color:${C.ink};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.mzf,.mzf *{box-sizing:border-box}
.mzf button{font-family:inherit;border:0;background:none;padding:0;margin:0;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
.mzf input{font-family:inherit;-webkit-user-select:text;user-select:text}
.mzf-display{font-family:'Archivo Black',system-ui,sans-serif}
.mzf-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mzf-stripe{height:8px;background:repeating-linear-gradient(45deg,${C.ink} 0 14px,${C.amber} 14px 28px)}
.mzf-head{flex:none;z-index:2}
.mzf-bar{background:#fff;border-bottom:1px solid ${C.line};padding:6px 8px;display:flex;align-items:center;gap:8px}
.mzf .mzf-back{width:48px;height:48px;flex:none;border-radius:12px;background:${C.ink};color:#fff;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;transition:transform .08s}
.mzf .mzf-back:active{transform:scale(.95)}
.mzf-title{font-size:15px;font-weight:900;letter-spacing:-.025em;line-height:1.2}
.mzf-sub{font-size:10px;color:${C.mute};line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mzf-strip{color:#fff;padding:4px 8px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:11px;font-weight:900;letter-spacing:.1em}
.mzf-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:12px 12px 24px}
.mzf-label{font-size:10px;font-weight:900;letter-spacing:.1em;color:${C.mute};margin:0 2px 6px}
.mzf-card{background:#fff;border:2px solid ${C.line};border-radius:12px}
.mzf .mzf-choice{display:block;width:100%;text-align:left;background:#fff;border:4px solid;border-radius:16px;padding:14px 16px;transition:transform .08s}
.mzf .mzf-choice:active{transform:scale(.98)}
.mzf .mzf-choice .t{font-size:30px;line-height:1;letter-spacing:-.02em}
.mzf .mzf-choice .s{font-size:12px;font-weight:700;color:${C.ink};margin-top:4px;line-height:1.3}
.mzf-cta{display:inline-block;color:#fff;font-size:12px;font-weight:900;padding:6px 10px;border-radius:8px;margin-top:10px;letter-spacing:.02em}
.mzf .mzf-pick{display:block;width:100%;text-align:left;background:#fff;border:2px solid ${C.line};border-radius:12px;padding:12px;min-height:60px;font-size:14px;font-weight:900;line-height:1.2;transition:transform .08s}
.mzf .mzf-pick:active{transform:scale(.98)}
.mzf .mzf-pick.on{border-color:${C.orange};box-shadow:inset 0 0 0 2px ${C.orange}}
.mzf-input{width:100%;height:56px;border:2px solid ${C.ink};border-radius:12px;padding:0 12px;font-size:22px;font-weight:700;background:#fff;color:${C.ink};outline:none;appearance:none}
.mzf-input::placeholder{color:#B9B4A9;font-weight:600}
.mzf-input.big{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;text-align:center;font-size:30px;height:68px}
.mzf-input.num{text-align:center;font-size:30px;height:68px;letter-spacing:.04em}
.mzf .mzf-btn{display:block;width:100%;border-radius:12px;padding:15px 12px;text-align:center;font-weight:900;font-size:18px;color:#fff;letter-spacing:-.01em;transition:transform .08s,filter .08s}
.mzf .mzf-btn:active{transform:scale(.98);filter:brightness(.95)}
.mzf .mzf-btn:disabled{background:${C.line}!important;color:${C.faint}!important;transform:none;filter:none}
.mzf .mzf-btn.lite{background:${C.bg};color:${C.ink};border:2px solid ${C.line};font-size:15px;padding:12px}
.mzf-badge{display:inline-flex;align-items:center;border-radius:6px;padding:4px 7px;font-size:10px;font-weight:900;color:#fff;letter-spacing:.04em;white-space:nowrap}
.mzf-grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.mzf-fixed{flex:none;background:#fff;border-top:1px solid ${C.line};padding:8px 8px calc(8px + env(safe-area-inset-bottom,0px))}
.mzf-fixed .hint{text-align:center;font-size:12px;font-weight:700;color:${C.mute};padding:6px 0 2px}
.mzf-warn{border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;line-height:1.35}
.mzf-warn.red{background:${C.red};color:#fff}
.mzf-warn.amber{background:${C.amber};color:${C.ink}}
.mzf-warn.blue{background:#EAF1F8;color:${C.blue};border:2px solid ${C.blue}}
.mzf-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid ${C.bg}}
.mzf-row:last-child{border-bottom:0}
.mzf-row .k{font-size:12px;color:${C.mute};font-weight:700}
.mzf-row .v{font-size:14px;font-weight:900;text-align:right}
.mzf-yn{display:flex;gap:6px}
.mzf-yn button{flex:1;padding:14px 0;border-radius:12px;border:2px solid ${C.line};background:#fff;font-size:16px;font-weight:900;color:${C.ink}}
.mzf-yn button.on{background:${C.ink};color:#fff;border-color:${C.ink}}
.mzf-names{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.mzf-names button{min-height:52px;border-radius:12px;padding:8px 6px;font-size:12px;font-weight:900;line-height:1.2;border:2px solid ${C.line};background:#fff;color:${C.ink}}
.mzf-names button:active{transform:scale(.97)}
@keyframes mzfspin{to{transform:rotate(360deg)}}
.mzf-spin{display:inline-block;width:18px;height:18px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:mzfspin .8s linear infinite;vertical-align:-3px;margin-right:8px}
`;

const Shell = ({ children }) => (
  <div className="mzf"><style>{CSS}</style>{children}</div>);

/* the ONE header — identical geometry to the materials screens */
const Head = ({ title, who, onBack, strip, stripColor }) => (
  <div className="mzf-head">
    <div className="mzf-stripe" />
    <div className="mzf-bar">
      {onBack ? <button className="mzf-back" aria-label="Atrás" onClick={onBack}>←</button> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mzf-title mzf-display">{title}</div>
        {who ? <div className="mzf-sub">{who}</div> : null}
      </div>
    </div>
    {strip ? <div className="mzf-strip" style={{ background: stripColor || C.fuel }}>{strip}</div> : null}
  </div>);

const Badge = ({ comb, style }) => (
  <span className="mzf-badge" style={{ background: FUEL_COLOR[comb] || C.mute, ...(style || {}) }}>{FUEL_LABEL[comb] || comb}</span>);

const Bottom = ({ children, hint }) => (
  <div className="mzf-fixed">{children}{hint ? <div className="hint">{hint}</div> : null}</div>);

const numOr0 = v => { const n = Number(String(v).replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0; };
const digits = s => String(s || "").replace(/\D/g, "");
const plateClean = s => up(s).replace(/[^A-Z0-9]/g, "");

/* ===================================================================== THE WIZARD
   Screens (the list adapts to the choice; every screen is one decision):
     what      ¿QUÉ VAS A CARGAR?      VEHÍCULO · MAQUINARIA · LOS DOS
     veh       TU CAMIONETA            placa (+ odómetro)     — only if VEHÍCULO or LOS DOS
     mach      LA MÁQUINA              número + horas         — only if MAQUINARIA or LOS DOS
     obra      ¿EN QUÉ OBRA ESTÁS?     rol de la semana primero
     est       ¿DÓNDE VAS A CARGAR?    estación + ¿también gasolina? SÍ/NO
     po        the PO, registered the instant the server answers
   ===================================================================== */
function Wizard({ who, embedded, onClose, onChangeWho, refTick }) {
  const [screen, setScreen] = useState("what");
  const [mode, setMode] = useState("");              // VEH | MACH | BOTH
  const [veh, setVeh] = useState(null);              // registry truck
  const [plate, setPlate] = useState("");
  const [odo, setOdo] = useState("");
  const [equipNo, setEquipNo] = useState("");
  const [hrs, setHrs] = useState("");
  const [obra, setObra] = useState("");
  const [obraOtra, setObraOtra] = useState("");
  const [otraOpen, setOtraOpen] = useState(false);
  const [station, setStation] = useState("");
  const [gas, setGas] = useState(null);              // true | false | null (not answered)
  const [srvVeh, setSrvVeh] = useState(null);        // server: last reading for the truck
  const [srvMach, setSrvMach] = useState(null);      // server: last reading for the machine
  const [equipKey, setEquipKey] = useState("");     // el número ya "asentado" (deja de teclear)
  const [pickOpen, setPickOpen] = useState(false);   // solo para quien no tiene camioneta registrada
  const [vehWait, setVehWait] = useState(false);    // esperando la última lectura del servidor
  const [machWait, setMachWait] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const [ticket, setTicket] = useState(null);
  const t0 = useRef(Date.now());
  const hist = LS.get(K_HIST, []);
  const plates = LS.get(K_PLATES, {});

  useEffect(() => { logEvent("open", { who: who || null }); }, []);
  useEffect(() => { logEvent("step", { who: who || null, step: ["what", "veh", "mach", "obra", "est", "po"].indexOf(screen) + 1, meta: { screen, mode } }); }, [screen]);

  /* registry: this person's truck (CAMIONETA or PIPA). Fuel type comes from here, never from the person. */
  const mine = useMemo(() => FLOTA.filter(v => nEq(v.de, who) && (v.tipo === "CAMIONETA" || v.tipo === "PIPA")), [who, refTick]);
  /* todo lo que no es camioneta ni pipa: bobcat, rodillo, compactador, generador,
     dump truck, tambo. Cada unidad lleva SU propio contador de horas. */
  const machines = useMemo(() => FLOTA.filter(v => v.tipo !== "CAMIONETA" && v.tipo !== "PIPA"), [refTick]);
  const allTrucks = useMemo(() => FLOTA.filter(v => v.tipo === "CAMIONETA" || v.tipo === "PIPA"), [refTick]);
  const hasVeh = mode === "VEH" || mode === "BOTH", hasMach = mode === "MACH" || mode === "BOTH";
  const steps = useMemo(() => ["what", ...(hasVeh ? ["veh"] : []), ...(hasMach ? ["mach"] : []), "obra", "est"], [mode]);
  const stepNo = steps.indexOf(screen) + 1, TOTAL = steps.length;
  const obraSemana = nGet(OBRA_SEMANA, who) || "";

  /* plate typed by the person → is it a truck we know? (covers people without an assigned truck, or driving another one) */
  const plateMatch = useMemo(() => { const p = plateClean(plate); if (p.length < 5) return null;
    return FLOTA.find(v => (v.tipo === "CAMIONETA" || v.tipo === "PIPA") && (plateClean(v.placa) === p || plateClean(plates[v.id]) === p)) || null; }, [plate, refTick]);
  const truck = veh || plateMatch || null;
  const truckComb = truck ? truck.comb : "";
  const regPlate = truck ? (truck.placa || plates[truck.id] || "") : "";
  const effPlate = plateClean(plate) || plateClean(regPlate);
  const plateTyped = !!truck && plateClean(plate) !== "" && plateClean(plate) !== plateClean(truck.placa);
  const noTruck = hasVeh && !truck;          // no tiene camioneta en el registro y la placa no coincide

  /* machine typed → known unit? */
  /* El número que trae pintado la máquina ES la unidad. Si ya está en la flota
     usamos su id para no partirle el historial; si no, el número mismo hace su
     propia cuenta de horas desde la primera vez. Nunca se juntan dos máquinas. */
  const machKey = n => "M-" + up(n).replace(/[^A-Z0-9]/g, "");
  const findMach = q0 => { const q = up(q0).replace(/[^A-Z0-9]/g, ""); if (!q) return null; const d = digits(q);
    return machines.find(v => up(v.id).replace(/[^A-Z0-9]/g, "") === q)
      || (d ? machines.find(v => digits(v.desc) === d || digits(v.id) === d) : null)
      || (d.length >= 3 ? machines.find(v => digits(v.desc).endsWith(d)) : null)
      || (q.length >= 3 ? machines.find(v => up(v.desc).replace(/[^A-Z0-9]/g, "").indexOf(q) >= 0) : null)
      || null; };
  const machMatch = useMemo(() => findMach(equipKey), [equipKey, machines]);
  const machine = useMemo(() => { const q = up(equipKey).replace(/[^A-Z0-9]/g, ""); if (!q) return null;
    return machMatch || { id: machKey(equipKey), desc: "Máquina " + up(equipKey), tipo: "MAQUINARIA", comb: "DIESEL", de: "", nuevo: true }; }, [equipKey, machMatch]);
  /* deja de teclear -> se asienta el número y se le pregunta al servidor por sus horas */
  useEffect(() => { const t = setTimeout(() => setEquipKey(equipNo.trim()), 350); return () => clearTimeout(t); }, [equipNo]);
  const typing = hasMach && up(equipNo).replace(/[^A-Z0-9]/g, "") !== up(equipKey).replace(/[^A-Z0-9]/g, "");

  useEffect(() => { setSrvVeh(null); if (!HAS_BACKEND || !truck) { setVehWait(false); return; } let ok = true; setVehWait(true);
    sbRpc("vehicle_status", { vid: truck.id }).then(r => { const x = Array.isArray(r) ? r[0] : r; if (ok) { if (x) setSrvVeh(x); setVehWait(false); } })
      .catch(() => { if (ok) setVehWait(false); }); return () => { ok = false; }; }, [truck && truck.id]);
  useEffect(() => { setSrvMach(null); if (!HAS_BACKEND || !machine) { setMachWait(false); return; } let ok = true; setMachWait(true);
    sbRpc("vehicle_status", { vid: machine.id }).then(r => { const x = Array.isArray(r) ? r[0] : r; if (ok) { if (x) setSrvMach(x); setMachWait(false); } })
      .catch(() => { if (ok) setMachWait(false); }); return () => { ok = false; }; }, [machine && machine.id]);

  const lastOf = (vid, srv) => { if (srv && srv.last_at) return { lectura: srv.last_reading == null ? "" : String(srv.last_reading), ts: new Date(srv.last_at).getTime() };
    return hist.filter(h => h.vid === vid).sort((a, b) => b.ts - a.ts)[0] || null; };
  const lastVeh = truck ? lastOf(truck.id, srvVeh) : null;
  const lastMach = machine ? lastOf(machine.id, srvMach) : null;

  const odoProblem = (() => { if (!hasVeh || odo === "" || !lastVeh || lastVeh.lectura === "") return null; const d = Number(odo) - Number(lastVeh.lectura);
    if (d < 0) return { block: true, t: `El odómetro no puede bajar. Última carga: ${fmtNum(lastVeh.lectura)} mi` };
    if (d > 3000) return { block: false, t: `Son ${fmtNum(d)} millas desde la última carga. Revisa el número.` }; return null; })();
  const hrsProblem = (() => { if (!hasMach || hrs === "" || !lastMach || lastMach.lectura === "") return null;
    if (Number(hrs) < Number(lastMach.lectura)) return { block: true, t: `Las horas no pueden bajar. Última carga: ${fmtNum(lastMach.lectura)} h` }; return null; })();

  const vehOk = !hasVeh || (!!truck && effPlate.length >= 5 && odo !== "" && !(odoProblem && odoProblem.block) && !vehWait);
  const machOk = !hasMach || (!!machine && up(equipNo).trim().length >= 1 && hrs !== "" && !(hrsProblem && hrsProblem.block) && !machWait && !typing);

  const pickTruck = v => { setVeh(v); setPlate(v ? (v.placa || plates[v.id] || "") : ""); };
  const go = s => { setScreen(s); try { requestAnimationFrame(() => { document.querySelectorAll(".mzf-body").forEach(b => { b.scrollTop = 0; }); }); } catch (e) {} };
  const next = () => { const i = steps.indexOf(screen); if (i >= 0 && i < steps.length - 1) go(steps[i + 1]); };
  const back = () => { if (screen === "po") { done(); return; } if (failed) { setFailed(null); return; }
    const i = steps.indexOf(screen); if (i > 0) go(steps[i - 1]); else if (embedded) onClose(); else if (onChangeWho) onChangeWho(); };
  const done = () => { if (embedded) onClose(); else if (onChangeWho) onChangeWho(true); };
  const another = () => { setScreen("what"); setMode(""); setVeh(null); setPlate(""); setOdo(""); setEquipNo(""); setEquipKey(""); setHrs(""); setObra(""); setObraOtra(""); setOtraOpen(false); setStation(""); setGas(null); setTicket(null); t0.current = Date.now(); go("what"); };

  /* -------- the PO: server assigns the number, the row is the record -------- */
  const buildRow = (ref, shape) => {
    const main = hasVeh ? truck : machine;
    const comb = hasVeh ? main.comb : "DIESEL";
    const flags = [];
    if (hasVeh && plateTyped) flags.push("Placa dictada por la persona");
    if (obraOtra) flags.push("Obra escrita a mano");
    if (obraSemana && (obraOtra || obra) !== obraSemana) flags.push(`Obra distinta al rol (${obraSemana})`);
    if (hasVeh && lastVeh && hoursBetween(Date.now(), lastVeh.ts) < AL.HORAS_MIN_ENTRE_CARGAS && main.tipo !== "PIPA") flags.push(`Mismo vehículo cargó hace ${Math.max(1, Math.round(hoursBetween(Date.now(), lastVeh.ts)))} h`);
    if (odoProblem && !odoProblem.block) flags.push(`Salto de ${fmtNum(Number(odo) - Number(lastVeh.lectura))} mi`);
    if (hasMach && hasVeh) flags.push(`+ Maquinaria ${up(equipNo)} · ${fmtNum(hrs)} h · diésel rojo`);
    if (hasMach && machine && machine.nuevo) flags.push(`Máquina ${up(equipNo)} no está en la flota`);
    if (gas) flags.push("+ Gasolina (garrafas / equipo chico)");
    /* shape 0 = todo. shape 1 = solo las columnas que el servidor ya conocía
       (la maquinaria y la gasolina siguen viajando en flags, que es texto). */
    const row = {
      client_ref: ref, device_id: deviceId(), who, role: roleOf(who),
      vehicle_id: main.id, vehicle_desc: main.desc, tipo: main.tipo, comb,
      plate: hasVeh ? effPlate : null, plate_typed: hasVeh ? plateTyped : false,
      equipo: hasMach ? up(equipNo) : null,
      reading: hasVeh ? Number(odo) : Number(hrs),
      jobsite: obraOtra || obra, jobsite_other: !!obraOtra, jobsite_week: obraSemana || null,
      station, seconds_to_po: Math.round((Date.now() - t0.current) / 1000),
      extra_gas_gal: null, extra_dyed_gal: null,
      flags,
    };
    if (!shape) { row.extra_gas = !!gas; row.machine_id = hasMach && hasVeh ? machine.id : null;
      row.machine_equipo = hasMach && hasVeh ? up(equipNo) : null; row.machine_hours = hasMach && hasVeh ? Number(hrs) : null; }
    return row;
  };
  const generate = async () => {
    if (!HAS_BACKEND) { setFailed({ __err: "Falta SUPABASE en config.js" }); return; }
    if (hasVeh && !truck) { setFailed({ __err: "Escoge la camioneta de la flota antes de generar el PO." }); return; }
    if (hasMach && !machine) { setFailed({ __err: "Escribe el número de la máquina antes de generar el PO." }); return; }
    setBusy(true); setFailed(null);
    const ref = uuid();                                   /* el mismo en los dos intentos: el servidor no duplica */
    const order = Number(LS.get(K_SHAPE, 0)) ? [1, 0] : [0, 1];
    let row = null, saved = null, lastErr = null;
    for (const shape of order) {
      row = buildRow(ref, shape);
      try {
        const res = await sbRpc("create_fuel_po", { payload: row });
        saved = Array.isArray(res) ? res[0] : res;
        if (!saved || !saved.po) throw new Error("respuesta sin PO: " + JSON.stringify(res).slice(0, 160));
        LS.set(K_SHAPE, shape); break;
      } catch (err) { lastErr = err; saved = null; logEvent("error", { who, meta: { where: "insert", shape, msg: String((err && (err.body || err.message)) || err).slice(0, 180) } }); }
    }
    try {
      if (!saved) throw lastErr || new Error("no se pudo registrar");
      const e = { po: saved.po, ts: new Date(saved.created_at || Date.now()).getTime(), who, role: row.role, vid: row.vehicle_id, veh: row.vehicle_desc, tipo: row.tipo, comb: row.comb,
        placa: row.plate || "", equipo: row.equipo || "", lectura: String(row.reading), obra: row.jobsite, obraOtra: row.jobsite_other, obraSemana: row.jobsite_week || "",
        est: station, plateTyped: row.plate_typed, srv: true, v: 3, mode, gas: !!gas, hrs: hasMach ? String(hrs) : "", odo: hasVeh ? String(odo) : "", flags: row.flags };
      const h = LS.get(K_HIST, []); h.push(e); if (hasMach && hasVeh) h.push({ ...e, vid: machine.id, lectura: String(hrs) }); LS.set(K_HIST, h.slice(-400));
      if (truck && !truck.placa && effPlate) { const p = LS.get(K_PLATES, {}); p[truck.id] = effPlate; LS.set(K_PLATES, p); }
      logEvent("po_created", { who, meta: { po: saved.po, seconds: row.seconds_to_po, station, mode } });
      setTicket(e); go("po");
    } catch (err) {
      const q = LS.get("muniz_fuel_queue", []); q.push(row); LS.set("muniz_fuel_queue", q.slice(-50));
      setFailed({ ...row, __err: String((err && (err.body || err.message)) || err).slice(0, 400) });
    } finally { setBusy(false); }
  };

  const strip = screen === "po" ? null : screen === "what" ? "COMBUSTIBLE" : `COMBUSTIBLE · PASO ${stepNo} DE ${TOTAL}`;
  const titles = { what: "¿QUÉ VAS A CARGAR?", veh: "TU CAMIONETA", mach: "LA MÁQUINA", obra: "¿EN QUÉ OBRA ESTÁS?", est: "¿DÓNDE VAS A CARGAR?", po: "PO DE COMBUSTIBLE" };

  /* -------- the server rejected the reading: send them back to fix it -------- */
  const unknownUnit = failed && /foreign key|not present in table|no existe|unknown vehicle|vehicles/i.test(String(failed.__err || ""));
  const readingErr = failed && !unknownUnit && /lectura|reading|menor|odom|hora/i.test(String(failed.__err || ""));
  if (failed && unknownUnit) return (
    <Shell>
      <Head title="FALTA DAR DE ALTA" who={who} onBack={() => setFailed(null)} strip="COMBUSTIBLE" stripColor={C.amber} />
      <div className="mzf-body">
        <div className="mzf-card" style={{ padding: 18, textAlign: "center", borderColor: C.amber }}>
          <div style={{ fontSize: 52 }}>🚜</div>
          <div className="mzf-display" style={{ fontSize: 22, marginTop: 8 }}>Esta unidad no está dada de alta</div>
          <div style={{ fontSize: 15, marginTop: 8, lineHeight: 1.4, fontWeight: 700 }}>Mándale a Tito el número <b className="mzf-mono">{hasMach ? up(equipNo) : effPlate}</b> para que la registre. Mientras, usa otra unidad.</div>
        </div>
      </div>
      <Bottom>
        <button className="mzf-btn mzf-display" style={{ background: C.ink }} onClick={() => { setFailed(null); go(hasMach ? "mach" : "veh"); }}>REGRESAR →</button>
      </Bottom>
    </Shell>);
  if (failed && readingErr) {
    const nums = String(failed.__err).match(/\d[\d,.]*/g) || [];
    return (
      <Shell>
        <Head title="REVISA LA LECTURA" who={who} onBack={() => setFailed(null)} strip="COMBUSTIBLE" stripColor={C.red} />
        <div className="mzf-body">
          <div className="mzf-card" style={{ padding: 18, textAlign: "center", borderColor: C.red }}>
            <div style={{ fontSize: 52 }}>🔢</div>
            <div className="mzf-display" style={{ fontSize: 22, marginTop: 8 }}>El número no puede ir para atrás</div>
            <div style={{ fontSize: 15, color: C.ink, marginTop: 8, lineHeight: 1.4, fontWeight: 700 }}>
              {nums.length >= 2 ? <>Pusiste <b style={{ color: C.red }}>{nums[0]}</b> y la última carga fue <b>{nums[1]}</b>.</> : "La lectura que pusiste es menor que la última registrada."}
            </div>
            <div style={{ fontSize: 13, color: C.mute, marginTop: 8, lineHeight: 1.4, fontWeight: 600 }}>Vuelve a ver el tablero y escríbelo otra vez. Si de veras marca menos, habla con Tito — no le des vuelta.</div>
          </div>
        </div>
        <Bottom>
          {hasVeh ? <button className="mzf-btn mzf-display" style={{ background: C.blue }} onClick={() => { setOdo(""); setFailed(null); go("veh"); }}>CORREGIR EL ODÓMETRO →</button> : null}
          {hasMach ? <button className="mzf-btn mzf-display" style={{ background: C.red, marginTop: hasVeh ? 6 : 0 }} onClick={() => { setHrs(""); setFailed(null); go("mach"); }}>CORREGIR LAS HORAS →</button> : null}
        </Bottom>
      </Shell>);
  }

  /* -------- no signal -------- */
  if (failed) return (
    <Shell>
      <Head title="SIN SEÑAL" who={who} onBack={back} strip="COMBUSTIBLE" />
      <div className="mzf-body">
        <div className="mzf-card" style={{ padding: 20, textAlign: "center" }}>
          <div style={{ fontSize: 56 }}>📡</div>
          <div className="mzf-display" style={{ fontSize: 22, marginTop: 8 }}>No se pudo registrar</div>
          <div style={{ fontSize: 14, color: C.mute, marginTop: 8, lineHeight: 1.4, fontWeight: 600 }}>El número de PO lo da la oficina en el momento. Tu solicitud quedó guardada en el teléfono: acércate a donde haya señal y toca reintentar.</div>
          {failed.__err ? <div className="mzf-mono" style={{ fontSize: 12, color: C.red, marginTop: 10, wordBreak: "break-word", textAlign: "left", background: C.paper, borderRadius: 8, padding: 8 }}>{String(failed.__err).slice(0, 400)}</div> : null}
          {failed.__err ? <button className="mzf-btn lite" style={{ marginTop: 8 }} onClick={() => { try { navigator.clipboard.writeText("COMBUSTIBLE v" + VERSION + " · " + who + "\n" + String(failed.__err)); } catch (e) {} }}>COPIAR EL ERROR (para Tito)</button> : null}
        </div>
      </div>
      <Bottom>
        <button className="mzf-btn mzf-display" style={{ background: C.ink }} disabled={busy} onClick={() => { setFailed(null); generate(); }}>{busy ? <><span className="mzf-spin" />REINTENTANDO…</> : "REINTENTAR ↻"}</button>
      </Bottom>
    </Shell>);

  /* -------- 1 · WHAT -------- */
  if (screen === "what") {
    const Choice = ({ color, icon, title, sub, cta, onClick }) => (
      <button className="mzf-choice" style={{ borderColor: color }} onClick={onClick}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 34, lineHeight: 1 }}>{icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t mzf-display" style={{ color }}>{title}</div>
            <div className="s">{sub}</div>
          </div>
        </div>
        <div className="mzf-cta" style={{ background: color }}>{cta}</div>
      </button>);
    const truckSub = mine.length ? `${mine[0].desc}${mine[0].placa ? " · " + mine[0].placa : ""}` : "Pide la placa y el odómetro";
    return (
      <Shell>
        <Head title={titles.what} who={who} onBack={back} strip={strip} />
        <div className="mzf-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Choice color={C.blue} icon="🛻" title="VEHÍCULO" sub={truckSub} cta="PLACA + ODÓMETRO →" onClick={() => { setMode("VEH"); pickTruck(mine[0] || null); go("veh"); }} />
          <Choice color={C.red} icon="🚜" title="MAQUINARIA" sub="Bobcat, rodillo, compactador, generador… · diésel rojo" cta="NÚMERO + HORAS →" onClick={() => { setMode("MACH"); setVeh(null); go("mach"); }} />
          <Choice color={C.ink} icon="🛻🚜" title="LOS DOS" sub="Camioneta y maquinaria en el mismo PO" cta="PLACA + HORAS →" onClick={() => { setMode("BOTH"); pickTruck(mine[0] || null); go("veh"); }} />
          <div style={{ textAlign: "center", fontSize: 11, color: C.faint, fontWeight: 700, paddingTop: 8 }}>El tipo de combustible lo pone el registro de la flota, no la persona.</div>
        </div>
      </Shell>);
  }

  /* -------- 2 · TRUCK: plate + odometer -------- */
  if (screen === "veh") return (
    <Shell>
      <Head title={titles.veh} who={who} onBack={back} strip={strip} />
      <div className="mzf-body">
        <div className="mzf-card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, flex: "none" }}>🛻</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.2 }}>{truck ? truck.desc : "¿Cuál camioneta?"}</div>
            <div style={{ fontSize: 11, color: C.mute, fontWeight: 700, marginTop: 2 }}>{truck ? (nEq(truck.de, who) ? "Tu camioneta según el registro" : `Registrada a ${truck.de || "la empresa"}`) : "Escógela de la lista de abajo"}</div>
            {truck ? (vehWait ? <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, marginTop: 2 }}>Revisando la última lectura…</div>
              : lastVeh ? <div style={{ fontSize: 11, color: C.faint, fontWeight: 700, marginTop: 2 }}>Última carga {fmtDT(lastVeh.ts)}{lastVeh.lectura !== "" ? ` · ${fmtNum(lastVeh.lectura)} mi` : ""}</div>
              : <div style={{ fontSize: 11, color: C.faint, fontWeight: 700, marginTop: 2 }}>Primera carga registrada</div>) : null}
          </div>
          {truck ? <Badge comb={truck.comb} /> : null}
        </div>

        <div className="mzf-label" style={{ marginTop: 16 }}>PLACA</div>
        <input className="mzf-input big" value={plate} onChange={e => setPlate(up(e.target.value).replace(/[^A-Z0-9 -]/g, "").slice(0, 10))}
          placeholder={regPlate || "EJ. RTX4821"} autoCapitalize="characters" autoCorrect="off" spellCheck={false} inputMode="text" />
        {regPlate && plateClean(plate) === plateClean(regPlate) ? <div style={{ fontSize: 12, color: C.mute, fontWeight: 700, marginTop: 6, textAlign: "center" }}>Placa registrada · si traes otra camioneta, cámbiala</div> : null}
        {!regPlate && !plate && !noTruck ? <div style={{ fontSize: 12, color: C.mute, fontWeight: 700, marginTop: 6, textAlign: "center" }}>Como aparece en la placa. Se guarda para la próxima vez.</div> : null}
        {noTruck ? (
          <div style={{ marginTop: 12 }}>
            <div className="mzf-warn blue">{plateClean(plate).length >= 5 ? "Esa placa no está en la flota." : "No tienes camioneta asignada."} Toca cuál es — el tipo de combustible lo pone el registro.</div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {(pickOpen || plateClean(plate).length >= 2 ? allTrucks : allTrucks.slice(0, 6)).map(v => (
                <button key={v.id} className="mzf-pick" onClick={() => { setVeh(v); setPlate(v.placa || plates[v.id] || plate); }}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 24 }}>{v.tipo === "PIPA" ? "🚛" : "🛻"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 15 }}>{v.de || v.desc}</span>
                    <span style={{ display: "block", fontSize: 11, color: C.mute, fontWeight: 700 }}>{v.desc}{(v.placa || plates[v.id]) ? " · " + (v.placa || plates[v.id]) : ""}</span>
                  </span>
                  <Badge comb={v.comb} />
                </button>))}
              {!pickOpen && plateClean(plate).length < 2 && allTrucks.length > 6 ?
                <button className="mzf-btn lite" onClick={() => setPickOpen(true)}>VER TODA LA FLOTA ({allTrucks.length})</button> : null}
              {!allTrucks.length ? <div className="mzf-warn amber">La flota no cargó. Revisa la señal y vuelve a entrar.</div> : null}
            </div>
          </div>) : null}

        <div className="mzf-label" style={{ marginTop: 16 }}>ODÓMETRO · millas que marca el tablero</div>
        <input className="mzf-input num" value={odo ? fmtNum(odo) : ""} onChange={e => setOdo(digits(e.target.value).slice(0, 7))} placeholder="0" inputMode="numeric" pattern="[0-9]*" />
        {odoProblem ? <div className={`mzf-warn ${odoProblem.block ? "red" : "amber"}`} style={{ marginTop: 8 }}>{odoProblem.block ? "⛔ " : "⚠ "}{odoProblem.t}</div> : null}
      </div>
      <Bottom hint={truck && vehWait ? "Revisando la última lectura de esta camioneta…" : hasMach ? "Después: la máquina" : null}>
        <button className="mzf-btn mzf-display" style={{ background: C.blue }} disabled={!vehOk} onClick={next}>{truck && vehWait ? "REVISANDO…" : "CONTINUAR →"}</button>
      </Bottom>
    </Shell>);

  /* -------- 3 · MACHINE: number + hours -------- */
  if (screen === "mach") return (
    <Shell>
      <Head title={titles.mach} who={who} onBack={back} strip={strip} />
      <div className="mzf-body">
        <div className="mzf-card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, flex: "none" }}>🚜</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.2 }}>{machine ? machine.desc : "Maquinaria"}</div>
            <div style={{ fontSize: 11, color: C.mute, fontWeight: 700, marginTop: 2 }}>{!machine ? "Bobcat, rodillo, compactador, generador, dump truck…" : machMatch ? "Equipo de la flota" : "Máquina nueva · queda registrada con este número"}</div>
            {machine ? ((machWait || typing) ? <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, marginTop: 2 }}>Revisando sus horas…</div>
              : lastMach && lastMach.lectura !== "" ? <div style={{ fontSize: 11, color: C.faint, fontWeight: 700, marginTop: 2 }}>Última carga {fmtDT(lastMach.ts)} · {fmtNum(lastMach.lectura)} h</div>
              : <div style={{ fontSize: 11, color: C.green, fontWeight: 700, marginTop: 2 }}>Primera vez que se carga · pon las horas que marque</div>) : null}
          </div>
          <Badge comb="DIESEL ROJO" />
        </div>

        <div className="mzf-label" style={{ marginTop: 16 }}>NÚMERO DE LA MÁQUINA · el que trae pintado</div>
        <input className="mzf-input big" value={equipNo} onChange={e => { setEquipNo(up(e.target.value).replace(/[^A-Z0-9 -]/g, "").slice(0, 12)); setHrs(""); }}
          placeholder="EJ. 0415" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />

        <div className="mzf-label" style={{ marginTop: 16 }}>HORAS · lo que marca el horómetro</div>
        <input className="mzf-input num" value={hrs ? fmtNum(hrs) : ""} onChange={e => setHrs(digits(e.target.value).slice(0, 6))} placeholder="0" inputMode="numeric" pattern="[0-9]*" />
        {hrsProblem ? <div className={`mzf-warn ${hrsProblem.block ? "red" : "amber"}`} style={{ marginTop: 8 }}>{hrsProblem.block ? "⛔ " : "⚠ "}{hrsProblem.t}</div> : null}
      </div>
      <Bottom hint={(typing || machWait) ? "Cada máquina lleva su propia cuenta de horas." : null}>
        <button className="mzf-btn mzf-display" style={{ background: C.red }} disabled={!machOk} onClick={next}>{(typing || machWait) ? "REVISANDO…" : "CONTINUAR →"}</button>
      </Bottom>
    </Shell>);

  /* -------- 4 · JOBSITE -------- */
  if (screen === "obra") return (
    <Shell>
      <Head title={titles.obra} who={who} onBack={back} strip={strip} />
      <div className="mzf-body">
        {obraSemana ? (
          <button className="mzf-choice" style={{ borderColor: C.orange }} onClick={() => { setObra(obraSemana); setObraOtra(""); next(); }}>
            <div className="mzf-label" style={{ color: C.orange, margin: 0 }}>SEGÚN EL ROL DE ESTA SEMANA</div>
            <div className="mzf-display" style={{ fontSize: 24, lineHeight: 1.1, marginTop: 4 }}>{obraSemana}</div>
            <div className="mzf-cta" style={{ background: C.orange }}>AQUÍ ESTOY →</div>
          </button>) : null}
        <div className="mzf-label" style={{ marginTop: 16 }}>{obraSemana ? "¿ESTÁS EN OTRA OBRA? TÓCALA" : "TOCA LA OBRA"}</div>
        <div className="mzf-grid2">
          {OBRAS.filter(o => o !== obraSemana).map(o => (
            <button key={o} className="mzf-pick" onClick={() => { setObra(o); setObraOtra(""); next(); }}>{o}</button>))}
        </div>
        <div className="mzf-card" style={{ padding: 10, marginTop: 12 }}>
          {!otraOpen ? <button style={{ width: "100%", textAlign: "center", fontSize: 12, fontWeight: 900, color: C.mute, padding: 6 }} onClick={() => setOtraOpen(true)}>¿NO ESTÁ TU OBRA? Escribe el lugar</button> : (
            <>
              <div className="mzf-label">OTRA UBICACIÓN · queda marcada para la oficina</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="mzf-input" style={{ height: 48, fontSize: 16 }} value={obraOtra} onChange={e => setObraOtra(e.target.value.slice(0, 40))} placeholder="Calle o lugar…" />
                <button className="mzf-btn mzf-display" style={{ width: "auto", padding: "0 18px", background: C.ink, fontSize: 15 }} disabled={obraOtra.trim().length < 3} onClick={() => { setObra(""); next(); }}>OK</button>
              </div>
            </>)}
        </div>
      </div>
    </Shell>);

  /* -------- 5 · STATION + gasolina? + review -------- */
  if (screen === "est") {
    const comb = hasVeh ? truckComb : "DIESEL";
    const rows = [
      hasVeh ? ["Camioneta", `${truck ? truck.desc : "Camioneta"} · ${effPlate}`] : null,
      hasVeh ? ["Odómetro", `${fmtNum(odo)} mi`] : null,
      hasMach ? ["Máquina", up(equipNo) + (machMatch ? " · " + machMatch.desc : "")] : null,
      hasMach ? ["Horas", `${fmtNum(hrs)} h`] : null,
      ["Obra", obraOtra || obra],
    ].filter(Boolean);
    const ready = !!station && gas !== null && !busy;
    return (
      <Shell>
        <Head title={titles.est} who={who} onBack={back} strip={strip} />
        <div className="mzf-body">
          <div className="mzf-label">ESTACIÓN</div>
          <div className="mzf-grid2">
            {Object.entries(STATIONS).map(([k, s]) => {
              const on = station === k, dark = k === "LEOS";
              return (
                <button key={k} className="mzf-choice" style={{ borderColor: on ? C.ink : s.color, background: on ? s.color : "#fff", padding: "14px 12px" }} onClick={() => setStation(k)}>
                  <div className="mzf-display" style={{ fontSize: 22, lineHeight: 1, color: on ? (dark ? C.ink : "#fff") : s.color }}>{s.corto}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, color: on ? (dark ? C.ink : "#fff") : C.mute }}>{s.nombre}</div>
                  <div style={{ fontSize: 11, fontWeight: 900, marginTop: 8, color: on ? (dark ? C.ink : "#fff") : s.color }}>{on ? "✓ AQUÍ CARGO" : "TOCAR"}</div>
                </button>);
            })}
          </div>

          <div className="mzf-label" style={{ marginTop: 16 }}>¿NECESITAS GASOLINA PARA TU GENERADOR?</div>
          <div className="mzf-yn">
            <button className={gas === false ? "on" : ""} onClick={() => setGas(false)}>NO</button>
            <button className={gas === true ? "on" : ""} onClick={() => setGas(true)}>SÍ, GASOLINA</button>
          </div>

          <div className="mzf-card" style={{ padding: "6px 12px", marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0 4px" }}>
              <div className="mzf-label" style={{ margin: 0 }}>RESUMEN</div>
              <div style={{ display: "flex", gap: 4 }}><Badge comb={comb} />{hasMach && hasVeh ? <Badge comb="DIESEL ROJO" /> : null}{gas ? <Badge comb="GASOLINA" style={{ background: C.orange }} /> : null}</div>
            </div>
            {rows.map(([k, v]) => <div key={k} className="mzf-row"><span className="k">{k}</span><span className="v">{v}</span></div>)}
          </div>
          {hasVeh && lastVeh && hoursBetween(Date.now(), lastVeh.ts) < AL.HORAS_MIN_ENTRE_CARGAS && truck && truck.tipo !== "PIPA" ? (
            <div className="mzf-warn amber" style={{ marginTop: 10 }}>⚠ Esta camioneta cargó hace {Math.max(1, Math.round(hoursBetween(Date.now(), lastVeh.ts)))} h. Queda marcado para la oficina.</div>) : null}
        </div>
        <Bottom hint={!station ? "Toca la estación" : gas === null ? "Contesta si necesitas gasolina" : "El PO se registra en la oficina en este instante"}>
          <button className="mzf-btn mzf-display" style={{ background: C.green, fontSize: 20 }} disabled={!ready} onClick={generate}>{busy ? <><span className="mzf-spin" />REGISTRANDO…</> : "GENERAR PO ⛽"}</button>
        </Bottom>
      </Shell>);
  }

  /* -------- 6 · THE PO -------- */
  if (screen === "po" && ticket) {
    const s = STATIONS[ticket.est] || { nombre: ticket.est, corto: ticket.est, color: C.mute };
    const dark = ticket.est === "LEOS";
    const both = ticket.mode === "BOTH", machOnly = ticket.mode === "MACH";
    const mainComb = machOnly ? "DIESEL ROJO" : ticket.comb;
    const cell = (k, v, mono) => <div><div className="mzf-label" style={{ margin: "0 0 2px" }}>{k}</div><div className={mono ? "mzf-mono" : ""} style={{ fontSize: mono ? 22 : 16, fontWeight: 900, lineHeight: 1.1 }}>{v}</div></div>;
    return (
      <Shell>
        <Head title={titles.po} who={who} onBack={back} strip="✓ REGISTRADO EN LA OFICINA" stripColor={C.green} />
        <div className="mzf-body">
          <div className="mzf-card" style={{ overflow: "hidden", borderColor: C.ink, borderWidth: 3 }}>
            <div style={{ background: FUEL_COLOR[mainComb] || C.mute, color: "#fff", padding: "14px 16px" }}>
              <div className="mzf-label" style={{ color: "rgba(255,255,255,.85)", margin: 0 }}>TIPO DE COMBUSTIBLE</div>
              <div className="mzf-display" style={{ fontSize: 40, lineHeight: 1, marginTop: 4 }}>{FUEL_LABEL[mainComb]}</div>
              {(both || ticket.gas) ? <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                {both ? <span className="mzf-badge" style={{ background: "rgba(0,0,0,.28)", fontSize: 12 }}>+ DIÉSEL ROJO · máquina {ticket.equipo}</span> : null}
                {ticket.gas ? <span className="mzf-badge" style={{ background: "rgba(0,0,0,.28)", fontSize: 12 }}>+ GASOLINA · generador</span> : null}
              </div> : null}
            </div>
            <div style={{ padding: "14px 16px" }}>
              <div className="mzf-label" style={{ margin: 0 }}>NÚMERO DE PO</div>
              <div className="mzf-mono mzf-display" style={{ fontSize: 38, lineHeight: 1, marginTop: 4, letterSpacing: "-.02em" }}>{ticket.po}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 10px", marginTop: 16 }}>
                {!machOnly ? cell("PLACA", ticket.placa || "—", true) : cell("MÁQUINA", ticket.equipo || "—", true)}
                {!machOnly ? cell("ODÓMETRO", `${fmtNum(ticket.odo)} mi`, true) : cell("HORAS", `${fmtNum(ticket.hrs)} h`, true)}
                {both ? cell("MÁQUINA", ticket.equipo, true) : null}
                {both ? cell("HORAS", `${fmtNum(ticket.hrs)} h`, true) : null}
                <div style={{ gridColumn: "1 / -1" }}>{cell("NOMBRE", ticket.who)}</div>
                <div style={{ gridColumn: "1 / -1" }}>{cell(machOnly ? "EQUIPO" : "VEHÍCULO", ticket.veh)}</div>
                <div style={{ gridColumn: "1 / -1" }}>{cell("OBRA", ticket.obra)}</div>
              </div>
            </div>
            <div style={{ background: s.color, color: dark ? C.ink : "#fff", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div><div className="mzf-label" style={{ color: "inherit", opacity: .8, margin: 0 }}>ESTACIÓN</div><div className="mzf-display" style={{ fontSize: 22, lineHeight: 1 }}>{s.corto}</div></div>
              <div style={{ textAlign: "right" }}><div className="mzf-label" style={{ color: "inherit", opacity: .8, margin: 0 }}>FECHA</div><div style={{ fontSize: 14, fontWeight: 900 }}>{fmtDT(ticket.ts)}</div></div>
            </div>
          </div>
          <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: C.mute, marginTop: 14, lineHeight: 1.4 }}>Muestra esta pantalla en la bomba.<br />{machOnly ? "PO, número de máquina y nombre" : "PO, placa y nombre"} — aquí están. No hay que mandar nada.</div>
        </div>
        <Bottom>
          <button className="mzf-btn mzf-display" style={{ background: C.ink }} onClick={done}>LISTO</button>
          <button className="mzf-btn lite" style={{ marginTop: 6 }} onClick={another}>OTRO PO DE COMBUSTIBLE</button>
        </Bottom>
      </Shell>);
  }
  return null;
}

/* ===================================================================== standalone WHO (fuel.html only) */
function Who({ onPick, onOffice }) {
  const [q, setQ] = useState("");
  const list = everyone().filter(n => !q || norm(n).includes(norm(q)));
  return (
    <Shell>
      <Head title="¿QUIÉN ERES?" strip="COMBUSTIBLE" />
      <div className="mzf-body">
        <input className="mzf-input" style={{ height: 48, fontSize: 16, marginBottom: 10 }} value={q} onChange={e => setQ(e.target.value)} placeholder="🔍  Buscar nombre…" />
        <div className="mzf-names">{list.map(n => <button key={n} onClick={() => onPick(n)}>{n}</button>)}</div>
        <button onClick={onOffice} style={{ width: "100%", textAlign: "center", fontSize: 11, fontWeight: 900, letterSpacing: ".1em", color: C.faint, padding: "24px 0 8px" }}>OFICINA</button>
      </div>
    </Shell>);
}

/* ===================================================================== embedded (inside MUÑIZ PEDIDOS) */
const REF_FRESH_MS = 5 * 60e3;
const refAge = () => { try { const r = JSON.parse(localStorage.getItem(K_REF) || "null"); return r && r.at ? Date.now() - r.at : Infinity; } catch (e) { return Infinity; } };
function Embedded({ who, onClose }) {
  const [refTick, setRefTick] = useState(0);
  useEffect(() => { if (HAS_BACKEND && refAge() > REF_FRESH_MS) refreshRef().then(() => setRefTick(t => t + 1)).catch(() => {}); flushQueue(); }, []);
  return <Wizard who={who} embedded onClose={onClose} refTick={refTick} />;
}
function flushQueue() {
  if (!HAS_BACKEND) return;
  const q = LS.get("muniz_fuel_queue", []);
  if (q.length) (async () => { const left = []; for (const row of q) { const r = { ...row }; delete r.__err;
    try { await sbRpc("create_fuel_po", { payload: r }); } catch (e) { left.push(r); } } LS.set("muniz_fuel_queue", left); })();
}

/* ===================================================================== standalone APP (fuel.html) */
function App() {
  const [mode, setMode] = useState("boot");
  const [pin, setPin] = useState(false);
  const [login, setLogin] = useState(false);
  const [token, setToken] = useState(officeToken());
  const [ofName, setOfName] = useState("");
  const [refTick, setRefTick] = useState(0);
  const [me, setMe] = useState(LS.get(K_ME, ""));
  const [logged, setLogged] = useState(null);
  useEffect(() => { if (!HAS_BACKEND) return; refreshRef().then(() => setRefTick(t => t + 1)).catch(() => {}); flushQueue(); }, []);
  useEffect(() => {
    const route = () => {
      const h = window.location.hash || "";
      if (h.startsWith("#f=")) {
        const raw = b64d(h.slice(3));
        const batch = raw && Array.isArray(raw.multi) ? raw.multi : (raw && raw.po ? [raw] : null);
        if (batch) { if (officeUnlocked()) { const L = LS.get(K_LOG, []); batch.forEach(e => { if (!L.some(x => x.po === e.po)) L.push(e); }); LS.set(K_LOG, L); setLogged(batch[0]); setMode("office"); setOfName(n => n || "OFICINA"); }
          else { setLogged(batch); setPin(true); } return; }
      }
      if (h === "#oficina") { if (HAS_BACKEND) { officeToken() ? setMode("office") : setLogin(true); } else setPin(true); return; }
      setMode("wizard");
    };
    route(); window.addEventListener("hashchange", route); return () => window.removeEventListener("hashchange", route);
  }, []);
  const office = () => { if (HAS_BACKEND) { officeToken() ? setMode("office") : setLogin(true); } else setPin(true); };
  if (login) return <Login onOk={t => { setToken(t); setOfName(t.email); setLogin(false); setMode("office"); }} onCancel={() => { setLogin(false); window.location.hash = ""; setMode("wizard"); }} />;
  if (pin) return <PinGate onOk={n => { setOfName(n); setPin(false); if (logged) { const L = LS.get(K_LOG, []); (Array.isArray(logged) ? logged : [logged]).forEach(e => { if (e && e.po && !L.some(x => x.po === e.po)) L.push(e); }); LS.set(K_LOG, L); } setMode("office"); }} onCancel={() => { setPin(false); setLogged(null); window.location.hash = ""; setMode("wizard"); }} />;
  if (mode === "office") return <Office key={refTick} token={token} whoOf={ofName || (token && token.email) || "OFICINA"} onExit={() => { window.location.hash = ""; setMode("wizard"); }} onNew={() => { window.location.hash = ""; setMode("wizard"); }} />;
  if (mode === "wizard") {
    if (!me) return <Who onPick={n => { LS.set(K_ME, n); setMe(n); }} onOffice={office} />;
    return <Wizard key={me} who={me} refTick={refTick} onChangeWho={() => { LS.set(K_ME, ""); setMe(""); }} />;
  }
  return <Shell><div style={{ padding: 32, textAlign: "center", color: C.faint, fontWeight: 700 }}>Cargando…</div></Shell>;
}

/* ---------- mount API: the orders app opens the wizard in place, same document, no iframe ---------- */
if (typeof window !== "undefined") {
  window.MunizFuel = {
    version: VERSION,
    mount(el, opts) {
      const root = createRoot(el);
      root.render(<Embedded who={up((opts && opts.who) || LS.get(K_ME, ""))} onClose={() => { try { opts && opts.onClose && opts.onClose(); } catch (e) {} }} />);
      return { unmount() { try { root.unmount(); } catch (e) {} } };
    },
  };
  const standalone = document.getElementById("fuel-root");
  if (standalone) createRoot(standalone).render(<App />);
  else if (HAS_BACKEND) setTimeout(() => { refreshRef().catch(() => {}); }, 1500);   // inside pedidos: warm the fleet cache before anyone taps COMBUSTIBLE
}
