import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";

/* =====================================================================
   MUÑIZ COMBUSTIBLE
   One question per screen. The registry decides the fuel type, not the
   person. Every PO lands in the office log automatically. No supervisor.
   ===================================================================== */

const CFG  = (typeof window !== "undefined" && window.MUNIZ_CONFIG) || {};
const FUEL = CFG.COMBUSTIBLE || {};

/* ---------- backend (Supabase: Postgres + REST). No SDK: plain fetch, ~40 lines. ---------- */
const SB = CFG.SUPABASE || {};
const SB_URL = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/auth\/v1$/, "");
const SB_KEY = String(SB.ANON_KEY || "");
const HAS_BACKEND = !!(SB_URL && SB_KEY);
/* embebido dentro del app de pedidos (pedidos_menu.js lo abre en un panel): el nombre ya viene puesto y "atrás" regresa al menú */
const EMBED = (() => { try { return window.parent !== window || /embed/.test(window.location.hash); } catch (e) { return false; } })();
const closeEmbed = () => { try { window.parent.postMessage({ type: "muniz-fuel-close" }, "*"); } catch (e) {} };
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
const VERSION = "2.3";

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
const OFICINA = (() => { const o = {}; const m = CFG.OFICINA || {};
  for (const k in m) o[up(k)] = String(m[k] || ""); return o; })();
const lastName = s => { const p = up(s).split(/\s+/); return p[p.length - 1] + " " + p.slice(0, -1).join(" "); };
const everyone = () => (PEOPLE_DB ? PEOPLE_DB.map(p => up(p.name))
  : Array.from(new Set([...FOREMEN_BASE, ...SUPS, ...PMS, ...DRIVERS, ...EXTRA, ...Object.keys(OFICINA)])))
  .sort((a, b) => lastName(a).localeCompare(lastName(b), "es"));
const roleOf = n => { if (PEOPLE_DB) { const p = PEOPLE_DB.find(x => up(x.name) === n); if (p) return up(p.role); }
  return OFICINA[n] !== undefined ? "OFICINA" : SUPS.includes(n) ? "SUPERVISOR" : PMS.includes(n) ? "GERENTE"
  : DRIVERS.includes(n) ? "CHOFER" : FOREMEN_BASE.includes(n) ? "MAYORDOMO" : "PERSONAL"; };

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
const FUEL_COLOR = { DIESEL: "#16A34A", GASOLINA: "#EA580C" };
const TIPO_LABEL = { CAMIONETA: "Camioneta", MAQUINARIA: "Maquinaria", TAMBO: "Tambo / tanque", PIPA: "Camión de combustible" };

/* ---------- storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const K_ME = "muniz_fuel_me", K_HIST = "muniz_fuel_hist", K_LOG = "muniz_fuel_log", K_PLATES = "muniz_fuel_plates", K_OF = "muniz_oficina";
const K_PEND = "muniz_fuel_pend";     /* POs generated but not yet registered */
const WEBHOOK = String(FUEL.WEBHOOK || "");

/* Fire-and-forget server log. An image beacon needs no CORS and no keys, so it
   works from a static page. If it fails we keep the PO pending and the SMS
   backlog picks it up. */
function beacon(e) {
  if (!WEBHOOK) return false;
  try {
    const q = new URLSearchParams({ po: e.po, ts: String(e.ts), who: e.who, vid: e.vid, veh: e.veh,
      tipo: e.tipo, comb: e.comb, placa: e.placa || "", equipo: e.equipo || "",
      lectura: String(e.lectura ?? ""), obra: e.obra, obraSemana: e.obraSemana || "",
      est: e.est, flags: (e.autoFlags || []).join("|") }).toString();
    const img = new Image(); img.src = WEBHOOK + (WEBHOOK.indexOf("?") >= 0 ? "&" : "?") + q;
    try { fetch(WEBHOOK, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(e) }); } catch (x) {}
    return true;
  } catch (x) { return false; }
}
const pendList = () => LS.get(K_PEND, []);
const pendAdd  = e => { const p = pendList(); if (!p.some(x => x.po === e.po)) { p.push(e); LS.set(K_PEND, p.slice(-40)); } };
const pendClear = pos => { LS.set(K_PEND, pendList().filter(x => pos.indexOf(x.po) < 0)); };
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

/* One SMS can register several POs: any that never got sent ride along. */
function pendBody(list) {
  const L = list.slice(0, 8);
  const head = L.length > 1 ? [`⛽ ${L.length} POs DE COMBUSTIBLE`, ""] : [];
  const blocks = L.map(e => {
    const s = (FUEL.ESTACIONES || {})[e.est] || {};
    return [`PO ${e.po} · ${e.comb}`, e.who,
      `${e.veh}${e.placa ? " · Placa " + e.placa : ""}${e.equipo ? " · Equipo " + e.equipo : ""}`,
      e.lectura !== "" && e.lectura != null ? `${e.tipo === "MAQUINARIA" ? "Horas" : "Odómetro"}: ${Number(e.lectura).toLocaleString("en-US")}` : null,
      `Obra: ${e.obra}`, `${s.nombre || e.est}`].filter(x => x !== null).join("\n");
  });
  const link = APP_URL + "fuel.html#f=" + b64e(L.length === 1 ? L[0] : { multi: L });
  return [...head, blocks.join("\n\n"), "", "REGISTRO:", link].join("\n");
}

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

/* ===================================================================== UI atoms */
const Shell = ({ children, dark = true }) => (
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

const Top = ({ step, total, onBack, title, sub }) => (
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

const Big = ({ children, onClick, color = "#F5B800", text = "#0B0F14", disabled }) => (
  <button onClick={disabled ? undefined : onClick} disabled={disabled}
    className={`btn w-full py-4 text-[18px] ${disabled ? "opacity-40" : ""}`} style={{ background: color, color: text }}>{children}</button>
);

const FuelBadge = ({ comb, big }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full font-black ${big ? "px-4 py-2 text-[16px]" : "px-2.5 py-1 text-[11px]"}`}
        style={{ background: FUEL_COLOR[comb] || "#374151", color: "#fff" }}>
    {comb === "DIESEL" ? "🟢" : "🟠"} {comb}
  </span>
);

/* ===================================================================== keypad */
function Keypad({ value, onChange, maxLen = 7 }) {
  const tap = d => { if (value.length >= maxLen) return; onChange((value === "0" ? "" : value) + d); };
  return (
    <div className="grid grid-cols-3 gap-2 mt-4">
      {["1","2","3","4","5","6","7","8","9"].map(d => (
        <button key={d} onClick={() => tap(d)} className="btn h-16 rounded-2xl bg-[#1A2230] text-white text-3xl">{d}</button>))}
      <button onClick={() => onChange(value.slice(0, -1))} className="btn h-16 rounded-2xl bg-[#1A2230] text-[#8B95A5] text-[14px]">BORRAR</button>
      <button onClick={() => tap("0")} className="btn h-16 rounded-2xl bg-[#1A2230] text-white text-3xl">0</button>
      <button onClick={() => onChange("")} className="btn h-16 rounded-2xl bg-[#1A2230] text-[#8B95A5] text-[14px]">LIMPIAR</button>
    </div>);
}

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

/* ===================================================================== THE WIZARD */
const numOr0 = v => { const n = Number(String(v).replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0; };
const extrasText = (g, d) => [g ? `+ Gasolina ${g} gal (garrafas/equipo)` : null, d ? `+ Diésel rojo ${d} gal (equipo)` : null].filter(Boolean);
function ExtraRow({ label, hint, color, value, onChange, presets }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-[#1E2733] last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-black" style={{ color }}>{label}</div>
        <div className="text-[11px] text-[#8B95A5] leading-tight">{hint}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {presets.map(n => <button key={n} onClick={() => onChange(String(n))} className={`btn h-9 px-2 rounded-lg text-[12px] font-black ${String(value) === String(n) ? "bg-white text-[#0B0F14]" : "bg-[#1A2230] text-white"}`}>{n}</button>)}
        <input inputMode="decimal" value={value} onChange={e => onChange(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} placeholder="gal"
          className="w-16 h-9 rounded-lg bg-[#0B0F14] border border-[#1E2733] px-2 text-[14px] text-white text-right outline-none" />
        {value ? <button onClick={() => onChange("")} className="btn h-9 w-9 rounded-lg bg-[#1A2230] text-[#8B95A5] text-[14px]">×</button> : null}
      </div>
    </div>);
}

function Wizard({ initialWho, onDone, onOffice }) {
  const [step, setStep] = useState(initialWho ? 2 : 1);
  const [who, setWho] = useState(initialWho || "");
  const [q, setQ] = useState("");
  const [veh, setVeh] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [plate, setPlate] = useState("");
  const [equipNo, setEquipNo] = useState("");
  const [lectura, setLectura] = useState("");
  const [obra, setObra] = useState("");
  const [obraOtra, setObraOtra] = useState("");
  const [station, setStation] = useState("");
  const [xGas, setXGas] = useState("");    // gal de gasolina para garrafas / equipo (además del vehículo)
  const [xDyed, setXDyed] = useState("");  // gal de diésel rojo para equipo
  const [ticket, setTicket] = useState(null);
  const [sent, setSent] = useState(false);
  const [asked, setAsked] = useState(false);
  const [askedP, setAskedP] = useState(false);
  const [tick, setTick] = useState(0);
  const [srvLast, setSrvLast] = useState(null);      // what the server knows about this vehicle
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const t0 = useRef(Date.now());
  useEffect(() => { logEvent("open", { who: initialWho || null }); }, []);
  useEffect(() => { logEvent("step", { who: who || null, step }); }, [step]);
  const [warn, setWarn] = useState(null);
  const hist = LS.get(K_HIST, []);
  const plates = LS.get(K_PLATES, {});
  const TOTAL = 6;

  const mine = useMemo(() => FLOTA.filter(v => v.de === who), [who]);
  const shared = useMemo(() => FLOTA.filter(v => !v.de), []);
  const others = useMemo(() => FLOTA.filter(v => v.de && v.de !== who), [who]);
  const lastFor = vid => hist.filter(h => h.vid === vid).sort((a, b) => b.ts - a.ts)[0];

  const needsPlate = veh && (veh.tipo === "CAMIONETA" || veh.tipo === "PIPA") && !veh.placa && !plates[veh.id];
  const needsEquip = veh && veh.tipo === "MAQUINARIA";
  const needsLectura = veh && (veh.tipo === "CAMIONETA" || veh.tipo === "MAQUINARIA" || veh.tipo === "PIPA");
  const effPlate = veh ? (veh.placa || plates[veh.id] || plate) : "";
  const localLast = veh ? lastFor(veh.id) : null;
  const last = (srvLast && srvLast.last_at) ? { lectura: srvLast.last_reading == null ? "" : String(srvLast.last_reading), ts: new Date(srvLast.last_at).getTime(), po: srvLast.last_po } : localLast;
  const obraSemana = OBRA_SEMANA[who] || "";

  /* live validation on the reading */
  const lecturaProblem = (() => {
    if (!needsLectura || lectura === "") return null;
    if (last && last.lectura !== "" && Number(lectura) < Number(last.lectura))
      return { block: true, t: `${veh.tipo === "MAQUINARIA" ? "Las horas no pueden bajar" : "El odómetro no puede bajar"}. Última lectura: ${fmtNum(last.lectura)}` };
    if (veh.tipo === "CAMIONETA" && last && last.lectura !== "" && Number(lectura) - Number(last.lectura) > 3000)
      return { block: false, t: `Son ${fmtNum(Number(lectura) - Number(last.lectura))} millas desde la última carga. ¿Seguro?` };
    return null;
  })();

  const go = n => { setWarn(null); setStep(n); window.scrollTo(0, 0); };

  const generate = () => {
    if (HAS_BACKEND) return generateServer();
    const now = new Date();
    const e = { po: makePO(now), ts: now.getTime(), who, role: roleOf(who),
      vid: veh.id, veh: veh.desc, tipo: veh.tipo, comb: veh.comb,
      placa: effPlate || "", equipo: equipNo || "", lectura: needsLectura ? lectura : "",
      obra: obraOtra || obra, obraOtra: !!obraOtra, obraSemana,
      est: station, plateTyped: !!(veh && !veh.placa && (plates[veh.id] || plate) && (veh.tipo === "CAMIONETA" || veh.tipo === "PIPA")), manualVeh: false, v: 1, xGas: numOr0(xGas), xDyed: numOr0(xDyed) };
    e.autoFlags = flagsFor(e, LS.get(K_HIST, [])).map(f => f.t);
    const h = LS.get(K_HIST, []); h.push(e); LS.set(K_HIST, h.slice(-400));
    if (veh && !veh.placa && plate) { const p = LS.get(K_PLATES, {}); p[veh.id] = up(plate); LS.set(K_PLATES, p); }
    pendAdd(e);
    e.srv = beacon(e);          /* server log attempted */
    setTicket(e); setSent(false); go(7);
  };

  const buildRow = () => ({
    client_ref: uuid(), device_id: deviceId(), who, role: roleOf(who),
    vehicle_id: veh.id, vehicle_desc: veh.desc, tipo: veh.tipo, comb: veh.comb,
    plate: effPlate || null, plate_typed: !!(veh && !veh.placa && (plates[veh.id] || plate) && (veh.tipo === "CAMIONETA" || veh.tipo === "PIPA")),
    equipo: equipNo || null, reading: needsLectura && lectura !== "" ? Number(lectura) : null,
    jobsite: obraOtra || obra, jobsite_other: !!obraOtra, jobsite_week: obraSemana || null,
    station, seconds_to_po: Math.round((Date.now() - t0.current) / 1000),
    extra_gas_gal: numOr0(xGas) || null, extra_dyed_gal: numOr0(xDyed) || null,
    flags: flagsFor({ vid: veh.id, tipo: veh.tipo, ts: Date.now(), lectura: needsLectura ? lectura : "", who, obra: obraOtra || obra, obraOtra: !!obraOtra, obraSemana, plateTyped: false, manualVeh: false }, LS.get(K_HIST, [])).map(f => f.t),
  });
  const generateServer = async () => {
    setBusy(true); setFailed(null);
    const row = buildRow();
    try {
      const res = await sbRpc("create_fuel_po", { payload: row });
      const saved = Array.isArray(res) ? res[0] : res;
      if (!saved || !saved.po) throw new Error("respuesta sin PO: " + JSON.stringify(res).slice(0, 160));
      const e = { po: saved.po, ts: new Date(saved.created_at).getTime(), who, role: row.role, vid: veh.id, veh: veh.desc, tipo: veh.tipo, comb: veh.comb,
        placa: row.plate || "", equipo: row.equipo || "", lectura: row.reading == null ? "" : String(row.reading), obra: row.jobsite, obraOtra: row.jobsite_other,
        obraSemana: row.jobsite_week || "", est: station, plateTyped: row.plate_typed, manualVeh: false, srv: true, v: 2, xGas: numOr0(xGas), xDyed: numOr0(xDyed) };
      const h = LS.get(K_HIST, []); h.push(e); LS.set(K_HIST, h.slice(-400));
      if (veh && !veh.placa && plate) { const p = LS.get(K_PLATES, {}); p[veh.id] = up(plate); LS.set(K_PLATES, p); }
      logEvent("po_created", { who, meta: { po: saved.po, seconds: row.seconds_to_po, station } });
      setTicket(e); setSent(true); go(7);
    } catch (err) {
      /* no signal or server down: keep it, retry, never lose it — but no PO until the server says so */
      const q = LS.get("muniz_fuel_queue", []); q.push(row); LS.set("muniz_fuel_queue", q.slice(-50));
      const msg = String((err && (err.body || err.message)) || err).slice(0, 300);
      logEvent("error", { who, meta: { where: "insert", msg: msg.slice(0, 200) } });
      setFailed({ ...row, __err: msg });
    } finally { setBusy(false); }
  };

  const filtered = everyone().filter(n => !q || norm(n).includes(norm(q)));

  /* ---------- 0 · an unregistered PO blocks everything ---------- */
  const pend = useMemo(() => (HAS_BACKEND ? [] : pendList()), [tick, step]);
  if (pend.length && step < 7) {
    const p = pend[0];
    const s0 = STATIONS[p.est] || {};
    const body = pendBody(pend);
    const tels = [FUEL.LOG_TEL, s0.tel].filter(Boolean);
    return (
      <Shell>
        <Top title="Falta registrar un PO" sub="No se puede sacar otro hasta que este quede registrado" />
        <div className="px-4 pb-8">
          <div className="rounded-2xl bg-[#7F1D1D] px-4 py-4">
            <div className="text-[12px] font-black tracking-widest opacity-90">PO SIN REGISTRAR{pend.length > 1 ? ` (${pend.length})` : ""}</div>
            <div className="mono display text-[30px] leading-none mt-1">{p.po}</div>
            <div className="text-[13px] font-bold mt-2">{p.who} · {p.veh}{p.placa ? " · " + p.placa : ""}</div>
            <div className="text-[13px] mt-0.5 opacity-90">{p.obra} · {(STATIONS[p.est] || {}).corto || p.est} · {fmtDT(p.ts)}</div>
          </div>
          <div className="mt-4 text-[14px] text-[#B4BCC8] leading-snug">
            Este PO ya está en la bomba pero la oficina todavía no lo tiene. Mándalo y ya puedes seguir.
          </div>
          <div className="mt-4">
            <a href={smsHref(tels, body)} onClick={() => setAskedP(true)}
               className="btn block w-full py-4 text-center text-[18px] bg-[#F5B800] text-[#0B0F14]">MANDAR REGISTRO ➤</a>
          </div>
          {askedP ? (
            <div className="mt-4 card px-4 py-4 pop">
              <div className="text-[15px] font-black text-center">¿Ya tocaste enviar en Mensajes?</div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button onClick={() => { pend.forEach(x => beacon(x)); pendClear(pend.map(x => x.po)); setAskedP(false); setTick(t => t + 1); }}
                  className="btn py-3.5 bg-[#16A34A] text-white text-[15px]">SÍ, YA LO MANDÉ</button>
                <button onClick={() => setAskedP(false)} className="btn py-3.5 bg-[#1A2230] text-white text-[15px]">TODAVÍA NO</button>
              </div>
            </div>) : null}
        </div>
      </Shell>);
  }

  /* ---------- no signal: the server assigns the PO, so without the server there is no PO yet ---------- */
  if (failed) return (
    <Shell>
      <Top title="Sin señal" sub="El PO lo asigna la oficina en el momento. Sin señal no hay número todavía." />
      <div className="px-4 pb-8">
        <div className="card px-5 py-6 text-center">
          <div className="text-6xl">📡</div>
          <div className="display text-[22px] mt-3">No se pudo registrar</div>
          <div className="text-[14px] text-[#B4BCC8] mt-2 leading-snug">Tu solicitud quedó guardada en el teléfono. Acércate a donde haya señal y toca reintentar. Se registra solita y te da el PO.</div>
          {failed.__err ? <div className="mt-3 mono text-[11px] text-[#F87171] break-all">{String(failed.__err).slice(0, 220)}</div> : null}
        </div>
        <div className="mt-5"><Big onClick={() => { setFailed(null); generateServer(); }} disabled={busy}>{busy ? "REINTENTANDO…" : "REINTENTAR ↻"}</Big></div>
        <button onClick={() => { setFailed(null); go(6); }} className="mt-3 w-full py-3 text-[12px] font-black text-[#5B6572]">REGRESAR</button>
      </div>
    </Shell>);

  /* ---------- 1 · WHO ---------- */
  if (step === 1) return (
    <Shell>
      <Top title="¿Quién eres?" sub="Toca tu nombre. El teléfono lo va a recordar." step={1} total={TOTAL} />
      <div className="px-4 pb-6">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre…" autoFocus={false}
          className="w-full h-14 rounded-2xl bg-[#121822] border border-[#1E2733] px-4 text-[17px] text-white placeholder-[#5B6572] outline-none" />
        <div className="mt-3 grid grid-cols-1 gap-2">
          {filtered.map(n => (
            <button key={n} onClick={() => { setWho(n); LS.set(K_ME, n); setQ(""); go(2); }}
              className="btn card px-4 py-4 text-left">
              <span className="text-[17px] font-black">{n}</span>
            </button>))}
        </div>
        <button onClick={onOffice} className="mt-8 w-full text-[11px] font-black tracking-widest text-[#5B6572]">OFICINA</button>
      </div>
    </Shell>);

  /* ---------- 2 · WHAT ---------- */
  if (step === 2) {
    const VehCard = ({ v }) => {
      const l = lastFor(v.id);
      return (
        <button onClick={() => { setVeh(v); setPlate(""); setEquipNo(""); setLectura(""); setSrvLast(null);
            if (HAS_BACKEND) sbRpc("vehicle_status", { vid: v.id }).then(r => { const x = Array.isArray(r) ? r[0] : r; if (x) setSrvLast(x); }).catch(() => {});
            go(3); }}
          className="btn card w-full text-left px-4 py-4 flex items-center gap-3 pop">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0" style={{ background: FUEL_COLOR[v.comb] + "22" }}>
            {v.tipo === "CAMIONETA" ? "🛻" : v.tipo === "MAQUINARIA" ? "🚜" : v.tipo === "PIPA" ? "🚛" : "🛢️"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-black leading-tight">{v.desc}</div>
            <div className="mono text-[13px] text-[#B4BCC8] mt-0.5">{v.placa || plates[v.id] || (v.tipo === "CAMIONETA" || v.tipo === "PIPA" ? "placa pendiente" : v.tipo === "MAQUINARIA" ? "pide # de equipo" : "sin lectura")}</div>
            {l ? <div className="text-[11px] text-[#5B6572] mt-0.5">Última carga {fmtDT(l.ts)}{l.lectura !== "" ? ` · ${fmtNum(l.lectura)}` : ""}</div> : null}
          </div>
          <FuelBadge comb={v.comb} />
        </button>);
    };
    return (
      <Shell>
        <Top title="¿Qué vas a cargar?" sub={`${who} · el tipo de combustible lo pone el registro`} step={2} total={TOTAL} onBack={() => EMBED ? closeEmbed() : go(1)} />
        <div className="px-4 pb-8 space-y-2">
          {mine.length ? <><div className="text-[11px] font-black tracking-widest text-[#8B95A5] pt-2">TU VEHÍCULO</div>{mine.map(v => <VehCard key={v.id} v={v} />)}</> : null}
          <div className="text-[11px] font-black tracking-widest text-[#8B95A5] pt-3">EQUIPO COMPARTIDO</div>
          {shared.map(v => <VehCard key={v.id} v={v} />)}
          {!showAll ? <button onClick={() => setShowAll(true)} className="w-full mt-3 py-3 text-[13px] font-black text-[#F5B800]">OTRO VEHÍCULO DE LA FLOTA ▾</button>
            : <><div className="text-[11px] font-black tracking-widest text-[#8B95A5] pt-3">TODA LA FLOTA</div>
                {others.map(v => <div key={v.id}><div className="text-[10px] text-[#5B6572] font-bold px-1 pt-2">{v.de}</div><VehCard v={v} /></div>)}</>}
          <div className="mt-6 text-center text-[11px] text-[#5B6572] leading-snug">¿No está tu vehículo? Habla con Tito para que lo dé de alta.<br />No se puede cargar un vehículo que no esté en la flota.</div>
        </div>
      </Shell>);
  }

  /* ---------- 3 · PLATE / EQUIPMENT # (only when needed) ---------- */
  if (step === 3) {
    if (!needsPlate && !needsEquip) { go(4); return null; }
    const isEq = needsEquip;
    const val = isEq ? equipNo : plate;
    const ok = isEq ? val.trim().length >= 1 : val.replace(/[^A-Z0-9]/g, "").length >= 5;
    return (
      <Shell>
        <Top title={isEq ? "Número de equipo" : "Placa del vehículo"} sub={isEq ? "El número pintado en la máquina" : "Como aparece en la placa. Solo esta vez — se guarda."} step={3} total={TOTAL} onBack={() => go(2)} />
        <div className="px-4 pb-8">
          <input value={val} onChange={e => (isEq ? setEquipNo : setPlate)(up(e.target.value).replace(/[^A-Z0-9 -]/g, "").slice(0, 12))}
            placeholder={isEq ? "EJ. BC-14" : "EJ. RTX4821"} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            className="mono w-full h-20 rounded-2xl bg-[#121822] border-2 border-[#1E2733] px-4 text-[34px] tracking-widest text-center text-white placeholder-[#3B4553] outline-none focus:border-[#F5B800]" />
          {!isEq ? <div className="mt-3 rounded-2xl bg-[#1A2230] px-4 py-3 text-[12px] text-[#B4BCC8]">Esta placa se va a guardar para <b className="text-white">{veh.desc}</b> y la oficina la va a verificar. Si te equivocas, la oficina lo va a ver.</div> : null}
          <div className="mt-6"><Big onClick={() => go(4)} disabled={!ok}>CONTINUAR →</Big></div>
        </div>
      </Shell>);
  }

  /* ---------- 4 · ODOMETER / HOURS ---------- */
  if (step === 4) {
    if (!needsLectura) { go(5); return null; }
    const isHrs = veh.tipo === "MAQUINARIA";
    return (
      <Shell>
        <Top title={isHrs ? "Horas de la máquina" : "Odómetro"} sub={isHrs ? "Lo que marca el horómetro ahora" : "Las millas que marca el tablero ahora"} step={4} total={TOTAL} onBack={() => go(needsPlate || needsEquip ? 3 : 2)} />
        <div className="px-4 pb-8">
          <div className="card px-4 py-5 text-center">
            <div className="mono text-[44px] leading-none text-white">{lectura ? fmtNum(lectura) : <span className="text-[#3B4553]">0</span>}</div>
            <div className="text-[12px] font-black tracking-widest text-[#8B95A5] mt-1">{isHrs ? "HORAS" : "MILLAS"}</div>
            {last && last.lectura !== "" ? <div className="mt-2 text-[12px] text-[#B4BCC8]">Última carga: <b className="mono text-white">{fmtNum(last.lectura)}</b> · {fmtDT(last.ts)}</div> : null}
          </div>
          {lecturaProblem ? <div className={`mt-3 rounded-2xl px-4 py-3 text-[13px] font-bold ${lecturaProblem.block ? "bg-[#7F1D1D] text-white" : "bg-[#78350F] text-white"}`}>{lecturaProblem.block ? "⛔ " : "⚠ "}{lecturaProblem.t}</div> : null}
          <Keypad value={lectura} onChange={setLectura} />
          <div className="mt-5"><Big onClick={() => go(5)} disabled={!lectura || (lecturaProblem && lecturaProblem.block)}>CONTINUAR →</Big></div>
        </div>
      </Shell>);
  }

  /* ---------- 5 · JOBSITE ---------- */
  if (step === 5) return (
    <Shell>
      <Top title="¿En qué obra estás?" sub="El lugar, no el número de contrato" step={5} total={TOTAL} onBack={() => go(needsLectura ? 4 : (needsPlate || needsEquip ? 3 : 2))} />
      <div className="px-4 pb-8">
        {obraSemana ? (
          <button onClick={() => { setObra(obraSemana); setObraOtra(""); go(6); }}
            className="btn w-full text-left rounded-2xl px-4 py-4 border-2 border-[#F5B800] bg-[#F5B800]/10">
            <div className="text-[10px] font-black tracking-widest text-[#F5B800]">SEGÚN EL ROL DE ESTA SEMANA</div>
            <div className="display text-[22px] text-white mt-0.5">{obraSemana}</div>
            <div className="text-[12px] text-[#B4BCC8] mt-1">Toca para confirmar</div>
          </button>) : null}
        <div className="text-[11px] font-black tracking-widest text-[#8B95A5] pt-4 pb-2">{obraSemana ? "¿ESTÁS EN OTRA OBRA?" : "ESCOGE LA OBRA"}</div>
        <div className="grid grid-cols-2 gap-2">
          {OBRAS.filter(o => o !== obraSemana).map(o => (
            <button key={o} onClick={() => { setObra(o); setObraOtra(""); go(6); }} className="btn card px-3 py-3.5 text-left text-[14px] font-black leading-tight min-h-[60px]">{o}</button>))}
        </div>
        <div className="mt-4 card px-4 py-3">
          <div className="text-[11px] font-black tracking-widest text-[#8B95A5]">OTRA UBICACIÓN (queda marcada)</div>
          <div className="flex gap-2 mt-2">
            <input value={obraOtra} onChange={e => setObraOtra(e.target.value.slice(0, 40))} placeholder="Calle o lugar…"
              className="flex-1 h-12 rounded-xl bg-[#0B0F14] border border-[#1E2733] px-3 text-[15px] text-white outline-none" />
            <button onClick={() => { if (obraOtra.trim().length >= 3) { setObra(""); go(6); } }} className="btn px-4 rounded-xl bg-[#1A2230] text-white text-[13px]">OK</button>
          </div>
        </div>
      </div>
    </Shell>);

  /* ---------- 6 · STATION + REVIEW ---------- */
  if (step === 6) {
    const rows = [
      ["Quién", who], ["Vehículo", veh.desc + (effPlate ? ` · ${effPlate}` : "") + (equipNo ? ` · ${equipNo}` : "")],
      needsLectura ? [veh.tipo === "MAQUINARIA" ? "Horas" : "Odómetro", fmtNum(lectura)] : null,
      ["Obra", obraOtra || obra],
      ...(numOr0(xGas) ? [["+ Gasolina", `${numOr0(xGas)} gal · garrafas/equipo`]] : []),
      ...(numOr0(xDyed) ? [["+ Diésel rojo", `${numOr0(xDyed)} gal · equipo`]] : []),
    ].filter(Boolean);
    return (
      <Shell>
        <Top title="¿Dónde vas a cargar?" sub="Escoge la estación, di qué más cargas y revisa" step={6} total={TOTAL} onBack={() => go(5)} />
        <div className="px-4 pb-8">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(STATIONS).map(([k, s]) => (
              <button key={k} onClick={() => setStation(k)} className={`btn rounded-2xl px-3 py-5 text-left border-2 ${station === k ? "border-white" : "border-transparent"}`} style={{ background: s.color, color: k === "LEOS" ? "#0B0F14" : "#fff" }}>
                <div className="display text-[20px] leading-tight">{s.corto}</div>
                <div className="text-[12px] font-bold mt-1 opacity-90">{s.nombre}</div>
              </button>))}
          </div>
          <div className="mt-4 card px-4 py-3">
            <div className="text-[11px] font-black tracking-widest text-[#8B95A5]">¿QUÉ MÁS CARGAS EN ESTE PO?</div>
            <div className="text-[12px] text-[#B4BCC8] mt-0.5 mb-1">Además del {veh.comb === "DIESEL" ? "diésel" : "gasolina"} del vehículo. Déjalo vacío si nada más.</div>
            <ExtraRow label="Gasolina" hint="garrafas · equipo chico" color="#FB923C" value={xGas} onChange={setXGas} presets={[5, 10]} />
            <ExtraRow label="Diésel rojo" hint="equipo · tanque de transferencia" color="#F87171" value={xDyed} onChange={setXDyed} presets={[25, 50]} />
          </div>
          <div className="mt-4 card px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-black tracking-widest text-[#8B95A5]">RESUMEN</div>
              <FuelBadge comb={veh.comb} />
            </div>
            {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-2 border-b border-[#1E2733] last:border-0"><span className="text-[13px] text-[#8B95A5]">{k}</span><span className="text-[14px] font-black text-right">{v}</span></div>)}
          </div>
          {last && hoursBetween(Date.now(), last.ts) < AL.HORAS_MIN_ENTRE_CARGAS && veh.tipo !== "PIPA" ? (
            <div className="mt-3 rounded-2xl bg-[#78350F] px-4 py-3 text-[13px] font-bold">⚠ Este vehículo cargó hace {Math.max(1, Math.round(hoursBetween(Date.now(), last.ts)))} h. Queda marcado para la oficina.</div>) : null}
          <div className="mt-5"><Big onClick={generate} disabled={!station || busy}>{busy ? "REGISTRANDO…" : "GENERAR PO ⛽"}</Big></div>
          {HAS_BACKEND ? <div className="mt-2 text-center text-[11px] text-[#5B6572]">Se registra en la oficina en este instante. Nadie tiene que mandar nada.</div> : null}
        </div>
      </Shell>);
  }

  /* ---------- 7 · REGISTER, THEN THE TICKET (only when there is NO backend) ---------- */
  if (step === 7 && ticket && !sent && !ticket.srv) {
    const s = STATIONS[ticket.est] || {};
    const tels = [FUEL.LOG_TEL, s.tel].filter(Boolean);
    const body = pendBody(pendList().length ? pendList() : [ticket]);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return (
      <Shell>
        <Top title="Manda el registro" sub="Tu número de PO aparece en cuanto quede registrado" />
        <div className="px-4 pb-8">
          <div className="card px-5 py-6 text-center">
            <div className="text-6xl">🔒</div>
            <div className="display text-[22px] mt-3">Tu PO está listo</div>
            <div className="text-[14px] text-[#B4BCC8] mt-2 leading-snug">Falta un paso: mandar el registro a la oficina.<br />Sin eso no se muestra el número.</div>
          </div>
          <div className="mt-4 card px-4 py-3">
            {[["Quién", ticket.who], ["Vehículo", ticket.veh + (ticket.placa ? " · " + ticket.placa : "") + (ticket.equipo ? " · " + ticket.equipo : "")],
              ticket.lectura !== "" ? [ticket.tipo === "MAQUINARIA" ? "Horas" : "Odómetro", fmtNum(ticket.lectura)] : null,
              ["Obra", ticket.obra], ["Estación", s.nombre || ticket.est], ...(ticket.xGas ? [["+ Gasolina", ticket.xGas + " gal"]] : []), ...(ticket.xDyed ? [["+ Diésel rojo", ticket.xDyed + " gal"]] : [])].filter(Boolean)
              .map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-2 border-b border-[#1E2733] last:border-0"><span className="text-[13px] text-[#8B95A5]">{k}</span><span className="text-[14px] font-black text-right">{v}</span></div>)}
          </div>
          <div className="mt-5">
            <a href={smsHref(tels, body)} onClick={() => { setAsked(true); }}
               className="btn block w-full py-5 text-center text-[19px] bg-[#F5B800] text-[#0B0F14]">MANDAR REGISTRO ➤</a>
            <div className="mt-2 text-center text-[11px] text-[#5B6572]">Se abre Mensajes con todo escrito. Solo toca la flecha de enviar.</div>
          </div>
          {asked ? (
            <div className="mt-5 card px-4 py-4 pop">
              <div className="text-[15px] font-black text-center">¿Ya tocaste enviar en Mensajes?</div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button onClick={() => { pendClear([ticket.po]); setSent(true); }} className="btn py-3.5 bg-[#16A34A] text-white text-[15px]">SÍ, YA LO MANDÉ</button>
                <button onClick={() => setAsked(false)} className="btn py-3.5 bg-[#1A2230] text-white text-[15px]">TODAVÍA NO</button>
              </div>
            </div>) : null}
          {offline ? (
            <button onClick={() => setSent(true)} className="mt-6 w-full py-3 rounded-2xl bg-[#78350F] text-white text-[13px] font-black">
              SIN SEÑAL — ver mi PO ahora (se manda solo cuando haya señal)
            </button>) : null}
        </div>
      </Shell>);
  }
  if (step === 7 && ticket) {
    const s = STATIONS[ticket.est] || { nombre: ticket.est, corto: ticket.est, color: "#374151" };
    const payload = { ...ticket };
    const link = APP_URL + "fuel.html#f=" + b64e(payload);
    const xs = extrasText(ticket.xGas, ticket.xDyed);
    const lines = [`PO ${ticket.po} · ${ticket.comb}${xs.length ? " " + xs.join(" ") : ""}`, `${ticket.who}`,
      `${ticket.veh}${ticket.placa ? " · Placa " + ticket.placa : ""}${ticket.equipo ? " · Equipo " + ticket.equipo : ""}`,
      ticket.lectura !== "" ? `${ticket.tipo === "MAQUINARIA" ? "Horas" : "Odómetro"}: ${fmtNum(ticket.lectura)}` : null,
      `Obra: ${ticket.obra}`, `${s.nombre}`, "", "REGISTRO:", link].filter(x => x !== null);
    const tels = [FUEL.LOG_TEL, s.tel].filter(Boolean);
    return (
      <Shell>
        <div className="px-4 pt-4">
          <div className="text-[11px] font-black tracking-[0.18em] text-[#8B95A5]">MUÑIZ COMBUSTIBLE · PO GENERADO</div>
        </div>
        <div className="px-4 pt-3 pb-10 pop">
          <div className="rounded-t-3xl overflow-hidden" style={{ background: FUEL_COLOR[ticket.comb] }}>
            <div className="px-5 py-5 text-white">
              <div className="text-[12px] font-black tracking-[0.2em] opacity-90">TIPO DE COMBUSTIBLE</div>
              <div className="display text-[46px] leading-none mt-1">{ticket.comb}</div>
              {xs.length ? <div className="mt-2 flex flex-wrap gap-1">{xs.map(x => <span key={x} className="rounded-lg bg-black/25 px-2 py-1 text-[13px] font-black">{x}</span>)}</div> : null}
            </div>
          </div>
          <div className="bg-white text-[#141414] px-5 pt-5 pb-4">
            <div className="text-[11px] font-black tracking-[0.2em] text-[#6B7280]">NÚMERO DE PO</div>
            <div className="mono display text-[38px] leading-none mt-1 tracking-tight">{ticket.po}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5">
              <div><div className="text-[10px] font-black tracking-widest text-[#6B7280]">{ticket.placa ? "PLACA" : ticket.equipo ? "EQUIPO" : "UNIDAD"}</div><div className="mono text-[22px] font-black">{ticket.placa || ticket.equipo || "—"}</div></div>
              <div><div className="text-[10px] font-black tracking-widest text-[#6B7280]">{ticket.tipo === "MAQUINARIA" ? "HORAS" : "ODÓMETRO"}</div><div className="mono text-[22px] font-black">{ticket.lectura !== "" ? fmtNum(ticket.lectura) : "—"}</div></div>
              <div className="col-span-2"><div className="text-[10px] font-black tracking-widest text-[#6B7280]">CHOFER</div><div className="text-[18px] font-black">{ticket.who}</div></div>
              <div className="col-span-2"><div className="text-[10px] font-black tracking-widest text-[#6B7280]">VEHÍCULO</div><div className="text-[15px] font-bold">{ticket.veh}</div></div>
              <div className="col-span-2"><div className="text-[10px] font-black tracking-widest text-[#6B7280]">OBRA</div><div className="text-[15px] font-bold">{ticket.obra}</div></div>
            </div>
          </div>
          <div className="perf" style={{ background: "#fff", backgroundImage: "radial-gradient(circle,#0B0F14 7px,transparent 8px)", backgroundSize: "24px 22px", backgroundPosition: "center", backgroundRepeat: "repeat-x" }} />
          <div className="rounded-b-3xl px-5 py-4 flex items-center justify-between" style={{ background: s.color, color: ticket.est === "LEOS" ? "#0B0F14" : "#fff" }}>
            <div><div className="text-[10px] font-black tracking-widest opacity-80">ESTACIÓN</div><div className="display text-[22px] leading-none">{s.corto}</div></div>
            <div className="text-right"><div className="text-[10px] font-black tracking-widest opacity-80">FECHA</div><div className="text-[14px] font-black">{fmtDT(ticket.ts)}</div></div>
          </div>

          <div className="mt-5 text-center text-[13px] text-[#B4BCC8] font-bold">Muestra esta pantalla en la bomba. {xs.length ? "Todo lo de arriba va en este mismo PO." : "Leo's pide PO, placa y nombre — aquí están."}</div>
          {ticket.srv ? (
            <div className="mt-3 rounded-2xl bg-[#052E16] border border-[#16A34A] px-4 py-3 text-center text-[13px] font-black text-[#86EFAC]">✓ Registrado en la oficina · {fmtDT(ticket.ts)}</div>) : null}
          {(!ticket.srv || s.tel) ? (
            <div className="mt-4">
              <a href={smsHref(ticket.srv ? [s.tel] : tels, lines.join("\n"))} className="btn block w-full py-4 text-center text-[18px] bg-[#F5B800] text-[#0B0F14]">{ticket.srv ? "MANDAR PO A " + (s.corto || "LA ESTACIÓN") + " ➤" : "MANDAR PO ➤"}</a>
              <div className="mt-2 text-center text-[11px] text-[#5B6572]">{ticket.srv ? "Opcional: la estación lo recibe por texto." : "Se manda solo al registro" + (s.tel ? " y a la estación" : "") + ". Nadie tiene que aprobarlo."}</div>
            </div>) : null}
          <button onClick={() => onDone(ticket)} className="mt-6 w-full py-3 rounded-2xl bg-[#1A2230] text-white text-[15px] font-black">LISTO</button>
        </div>
      </Shell>);
  }
  return null;
}

/* ===================================================================== OFFICE CONSOLE */
function Login({ onOk, onCancel }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(""); try { const t = await sbLogin(email.trim(), pw); onOk(t); } catch (e) { setErr("Correo o contraseña incorrectos"); } finally { setBusy(false); } };
  return (
    <Shell>
      <Top title="Oficina" sub="Entra con tu correo de Muñiz" />
      <div className="px-4 pb-8">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="correo" type="email" autoCapitalize="none"
          className="w-full h-14 rounded-2xl bg-[#121822] border border-[#1E2733] px-4 text-[17px] text-white outline-none" />
        <input value={pw} onChange={e => setPw(e.target.value)} placeholder="contraseña" type="password" onKeyDown={e => e.key === "Enter" && go()}
          className="mt-2 w-full h-14 rounded-2xl bg-[#121822] border border-[#1E2733] px-4 text-[17px] text-white outline-none" />
        {err ? <div className="mt-3 text-[#F87171] text-[14px] font-black">{err}</div> : null}
        <div className="mt-5"><Big onClick={go} disabled={busy || !email || !pw}>{busy ? "ENTRANDO…" : "ENTRAR"}</Big></div>
        <button onClick={onCancel} className="mt-4 w-full text-[12px] font-black text-[#5B6572]">CANCELAR</button>
      </div>
    </Shell>);
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
          <div className="flex items-center gap-1.5"><FuelBadge comb={e.comb} /><span className="text-[10px] font-black px-2 py-1 rounded-full" style={{ background: s.color || "#ddd", color: e.est === "LEOS" ? "#0B0F14" : "#fff" }}>{s.corto || e.est}</span></div>
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
    <Shell dark={false}>
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
                <FuelBadge comb={v.comb} />
                <div className="flex-1 min-w-0"><div className="text-[14px] font-black truncate">{v.desc} <span className="text-[#6B7280] font-bold">· {v.de || "compartido"}</span></div>
                  <div className="mono text-[12px] text-[#6B7280]">{v.placa || (typed ? `${typed} (dictada)` : "sin placa")} · {h.length} carga(s){l && l.lectura !== "" ? ` · última ${fmtNum(l.lectura)}` : ""}</div></div>
              </div>); })}
          </div>)}
        <div className="pb-10 grid grid-cols-2 gap-2">
          <button onClick={csv} className="btn py-3.5 bg-[#0B0F14] text-white text-[14px]">⬇ EXPORTAR CSV</button>
          <button onClick={onNew} className="btn py-3.5 bg-[#F5B800] text-[#0B0F14] text-[14px]">⛽ NUEVO PO</button>
        </div>
      </div>
    </Shell>);
}

/* ===================================================================== APP */
function App() {
  const [mode, setMode] = useState("boot");
  const [pin, setPin] = useState(false);
  const [login, setLogin] = useState(false);
  const [token, setToken] = useState(officeToken());
  const [ofName, setOfName] = useState("");
  const [refTick, setRefTick] = useState(0);
  useEffect(() => {
    if (!HAS_BACKEND) return;
    refreshRef().then(() => setRefTick(t => t + 1)).catch(() => {});
    /* flush anything a phone could not send earlier (idempotent via client_ref) */
    const q = LS.get("muniz_fuel_queue", []);
    if (q.length) (async () => { const left = []; for (const row of q) { const r = { ...row }; delete r.__err;
      try { await sbRpc("create_fuel_po", { payload: r }); } catch (e) { left.push(r); } } LS.set("muniz_fuel_queue", left); })();
  }, []);
  const [me, setMe] = useState(LS.get(K_ME, ""));
  const [logged, setLogged] = useState(null);

  useEffect(() => {
    const route = () => {
      const h = window.location.hash || "";
      if (h.startsWith("#f=")) {
        const raw = b64d(h.slice(3));
        const batch = raw && Array.isArray(raw.multi) ? raw.multi : (raw && raw.po ? [raw] : null);
        if (batch) {
          if (officeUnlocked()) { const L = LS.get(K_LOG, []); batch.forEach(e => { if (!L.some(x => x.po === e.po)) L.push(e); }); LS.set(K_LOG, L); setLogged(batch[0]); setMode("office"); setOfName(n => n || "OFICINA"); }
          else { setLogged(batch); setPin(true); }
          return;
        }
        const e = raw;
        if (e && e.po) {
          if (officeUnlocked()) { const L = LS.get(K_LOG, []); if (!L.some(x => x.po === e.po)) { L.push(e); LS.set(K_LOG, L); } setLogged(e); setMode("office"); setOfName(n => n || "OFICINA"); }
          else { setLogged(e); setPin(true); }
          return;
        }
      }
      if (h === "#oficina") { if (HAS_BACKEND) { officeToken() ? setMode("office") : setLogin(true); } else setPin(true); return; }
      setMode("wizard");
    };
    /* anything still pending gets another try at the server on every open */
    try { if (WEBHOOK) { const p = pendList(); if (p.length) { p.forEach(e => beacon(e)); } } } catch (x) {}
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);

  if (login) return <Login onOk={t => { setToken(t); setOfName(t.email); setLogin(false); setMode("office"); }} onCancel={() => { setLogin(false); window.location.hash = ""; setMode("wizard"); }} />;
  if (pin) return <PinGate onOk={n => { setOfName(n); setPin(false); if (logged) { const L = LS.get(K_LOG, []); (Array.isArray(logged) ? logged : [logged]).forEach(e => { if (e && e.po && !L.some(x => x.po === e.po)) L.push(e); }); LS.set(K_LOG, L); } setMode("office"); }} onCancel={() => { setPin(false); setLogged(null); window.location.hash = ""; setMode("wizard"); }} />;
  if (mode === "office") return <Office key={refTick} token={token} whoOf={ofName || (token && token.email) || "OFICINA"} onExit={() => { window.location.hash = ""; setMode("wizard"); }} onNew={() => { window.location.hash = ""; setMode("wizard"); }} />;
  if (mode === "wizard") return <Wizard key={me + ":" + refTick} initialWho={me} onDone={() => { setMe(LS.get(K_ME, "")); setMode("done"); }} onOffice={() => { if (HAS_BACKEND) { officeToken() ? setMode("office") : setLogin(true); } else setPin(true); }} />;
  if (mode === "done") return (
    <Shell>
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="w-24 h-24 rounded-full bg-[#16A34A] flex items-center justify-center text-5xl">✓</div>
        <div className="display text-[28px] mt-5">PO registrado</div>
        <div className="text-[14px] text-[#B4BCC8] mt-2">{HAS_BACKEND ? "Quedó registrado en la oficina en el momento." : "Ya quedó en el registro de la oficina."}</div>
        <button onClick={() => setMode("wizard")} className="btn mt-8 w-full py-4 bg-[#F5B800] text-[#0B0F14] text-[17px]">OTRO PO</button>
        {EMBED ? <button onClick={closeEmbed} className="btn mt-3 w-full py-4 bg-[#1A2230] text-white text-[17px]">← REGRESAR AL APP</button> : null}
        <a href="./index.html" className="mt-4 text-[13px] font-black text-[#8B95A5]">← Volver a pedidos</a>
        <div className="mt-10 text-[10px] text-[#3B4553]">Muñiz Combustible v{VERSION}</div>
      </div>
    </Shell>);
  return <Shell><div className="p-8 text-center text-[#8B95A5]">Cargando…</div></Shell>;
}

createRoot(document.getElementById("root")).render(<App />);
