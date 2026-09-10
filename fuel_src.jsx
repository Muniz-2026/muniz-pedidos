import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";

/* =====================================================================
   MUÑIZ COMBUSTIBLE
   One question per screen. The registry decides the fuel type, not the
   person. Every PO lands in the office log automatically. No supervisor.
   ===================================================================== */

const CFG  = (typeof window !== "undefined" && window.MUNIZ_CONFIG) || {};
const FUEL = CFG.COMBUSTIBLE || {};
const APP_URL = "https://muniz-2026.github.io/muniz-pedidos/";
const VERSION = "1.0";

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
const EVERYONE = Array.from(new Set([...FOREMEN_BASE, ...SUPS, ...PMS, ...DRIVERS, ...EXTRA, ...Object.keys(OFICINA)]))
  .sort((a, b) => lastName(a).localeCompare(lastName(b), "es"));
const roleOf = n => OFICINA[n] !== undefined ? "OFICINA" : SUPS.includes(n) ? "SUPERVISOR" : PMS.includes(n) ? "GERENTE"
  : DRIVERS.includes(n) ? "CHOFER" : FOREMEN_BASE.includes(n) ? "MAYORDOMO" : "PERSONAL";

/* ---------- fleet / stations / jobsites ---------- */
const FLOTA = (FUEL.FLOTA || []).map(v => ({ ...v, de: up(v.de), comb: up(v.comb), tipo: up(v.tipo), placa: up(v.placa) }));
const STATIONS = FUEL.ESTACIONES || {};
const OBRAS = FUEL.OBRAS || [];
const OBRA_SEMANA = (() => { const o = {}; const m = FUEL.OBRA_SEMANA || {}; for (const k in m) o[up(k)] = m[k]; return o; })();
const AL = Object.assign({ HORAS_MIN_ENTRE_CARGAS: 6, CARGAS_MAX_7DIAS: 4, MILLAS_MIN_ENTRE_CARGAS: 40 }, FUEL.ALERTAS || {});
const FUEL_COLOR = { DIESEL: "#16A34A", GASOLINA: "#EA580C" };
const TIPO_LABEL = { CAMIONETA: "Camioneta", MAQUINARIA: "Maquinaria", TAMBO: "Tambo / tanque", PIPA: "Camión de combustible" };

/* ---------- storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const K_ME = "muniz_fuel_me", K_HIST = "muniz_fuel_hist", K_LOG = "muniz_fuel_log", K_PLATES = "muniz_fuel_plates", K_OF = "muniz_oficina";
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
  const [ticket, setTicket] = useState(null);
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
  const last = veh ? lastFor(veh.id) : null;
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
    const now = new Date();
    const e = { po: makePO(now), ts: now.getTime(), who, role: roleOf(who),
      vid: veh.id, veh: veh.desc, tipo: veh.tipo, comb: veh.comb,
      placa: effPlate || "", equipo: equipNo || "", lectura: needsLectura ? lectura : "",
      obra: obraOtra || obra, obraOtra: !!obraOtra, obraSemana,
      est: station, plateTyped: !!(veh && !veh.placa && (plates[veh.id] || plate) && (veh.tipo === "CAMIONETA" || veh.tipo === "PIPA")), manualVeh: false, v: 1 };
    const h = LS.get(K_HIST, []); h.push(e); LS.set(K_HIST, h.slice(-400));
    if (veh && !veh.placa && plate) { const p = LS.get(K_PLATES, {}); p[veh.id] = up(plate); LS.set(K_PLATES, p); }
    setTicket(e); go(7);
  };

  const filtered = EVERYONE.filter(n => !q || norm(n).includes(norm(q)));

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
        <button onClick={() => { setVeh(v); setPlate(""); setEquipNo(""); setLectura(""); go(3); }}
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
        <Top title="¿Qué vas a cargar?" sub={`${who} · el tipo de combustible lo pone el registro`} step={2} total={TOTAL} onBack={() => go(1)} />
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
    ].filter(Boolean);
    return (
      <Shell>
        <Top title="¿Dónde vas a cargar?" sub="Escoge la estación y revisa" step={6} total={TOTAL} onBack={() => go(5)} />
        <div className="px-4 pb-8">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(STATIONS).map(([k, s]) => (
              <button key={k} onClick={() => setStation(k)} className={`btn rounded-2xl px-3 py-5 text-left border-2 ${station === k ? "border-white" : "border-transparent"}`} style={{ background: s.color, color: k === "LEOS" ? "#0B0F14" : "#fff" }}>
                <div className="display text-[20px] leading-tight">{s.corto}</div>
                <div className="text-[12px] font-bold mt-1 opacity-90">{s.nombre}</div>
              </button>))}
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
          <div className="mt-5"><Big onClick={generate} disabled={!station}>GENERAR PO ⛽</Big></div>
        </div>
      </Shell>);
  }

  /* ---------- 7 · TICKET ---------- */
  if (step === 7 && ticket) {
    const s = STATIONS[ticket.est] || { nombre: ticket.est, corto: ticket.est, color: "#374151" };
    const payload = { ...ticket };
    const link = APP_URL + "fuel.html#f=" + b64e(payload);
    const lines = [`PO ${ticket.po} · ${ticket.comb}`, `${ticket.who}`,
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

          <div className="mt-5 text-center text-[13px] text-[#B4BCC8] font-bold">Muestra esta pantalla en la bomba. Leo's pide PO, placa y nombre — aquí están.</div>
          <div className="mt-4">
            <a href={smsHref(tels, lines.join("\n"))} className="btn block w-full py-4 text-center text-[18px] bg-[#F5B800] text-[#0B0F14]">MANDAR PO ➤</a>
            <div className="mt-2 text-center text-[11px] text-[#5B6572]">Se manda solo al registro{s.tel ? " y a la estación" : ""}. Nadie tiene que aprobarlo.</div>
          </div>
          <button onClick={() => onDone(ticket)} className="mt-6 w-full py-3 rounded-2xl bg-[#1A2230] text-white text-[15px] font-black">LISTO</button>
        </div>
      </Shell>);
  }
  return null;
}

/* ===================================================================== OFFICE CONSOLE */
function Office({ whoOf, onExit, onNew }) {
  const [log, setLog] = useState(LS.get(K_LOG, []));
  useEffect(() => { const f = () => setLog(LS.get(K_LOG, [])); window.addEventListener("hashchange", f); const t = setInterval(f, 1500); return () => { window.removeEventListener("hashchange", f); clearInterval(t); }; }, []);
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
  const [ofName, setOfName] = useState("");
  const [me, setMe] = useState(LS.get(K_ME, ""));
  const [logged, setLogged] = useState(null);

  useEffect(() => {
    const route = () => {
      const h = window.location.hash || "";
      if (h.startsWith("#f=")) {
        const e = b64d(h.slice(3));
        if (e && e.po) {
          if (officeUnlocked()) { const L = LS.get(K_LOG, []); if (!L.some(x => x.po === e.po)) { L.push(e); LS.set(K_LOG, L); } setLogged(e); setMode("office"); setOfName(n => n || "OFICINA"); }
          else { setLogged(e); setPin(true); }
          return;
        }
      }
      if (h === "#oficina") { setPin(true); return; }
      setMode("wizard");
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);

  if (pin) return <PinGate onOk={n => { setOfName(n); setPin(false); if (logged) { const L = LS.get(K_LOG, []); if (!L.some(x => x.po === logged.po)) { L.push(logged); LS.set(K_LOG, L); } } setMode("office"); }} onCancel={() => { setPin(false); setLogged(null); window.location.hash = ""; setMode("wizard"); }} />;
  if (mode === "office") return <Office whoOf={ofName || "OFICINA"} onExit={() => { window.location.hash = ""; setMode("wizard"); }} onNew={() => { window.location.hash = ""; setMode("wizard"); }} />;
  if (mode === "wizard") return <Wizard key={me} initialWho={me} onDone={() => { setMe(LS.get(K_ME, "")); setMode("done"); }} onOffice={() => setPin(true)} />;
  if (mode === "done") return (
    <Shell>
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="w-24 h-24 rounded-full bg-[#16A34A] flex items-center justify-center text-5xl">✓</div>
        <div className="display text-[28px] mt-5">PO registrado</div>
        <div className="text-[14px] text-[#B4BCC8] mt-2">Ya quedó en el registro de la oficina.</div>
        <button onClick={() => setMode("wizard")} className="btn mt-8 w-full py-4 bg-[#F5B800] text-[#0B0F14] text-[17px]">OTRO PO</button>
        <a href="./index.html" className="mt-4 text-[13px] font-black text-[#8B95A5]">← Volver a pedidos</a>
        <div className="mt-10 text-[10px] text-[#3B4553]">Muñiz Combustible v{VERSION}</div>
      </div>
    </Shell>);
  return <Shell><div className="p-8 text-center text-[#8B95A5]">Cargando…</div></Shell>;
}

createRoot(document.getElementById("root")).render(<App />);
