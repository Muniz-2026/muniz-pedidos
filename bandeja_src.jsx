/* MUÑIZ · BANDEJA · v1.0
   Una página, tres caras:
   - Supervisor / Enrique / gerente: tarjetas de decisión. Un toque.
   - Oficina (Tito, Claudia): lo aprobado que espera PO.
   - Mayordomo (#mis): sus pedidos, estado en vivo, justificar equipo, reenviar.
   Lee y escribe SOLO por funciones RPC (nombre + PIN). No toca app.js. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const CFG = (typeof window !== "undefined" && window.MUNIZ_CONFIG) || {};
const SB = CFG.SUPABASE || {};
const SB_URL = String(SB.URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/auth\/v1$/, "");
const SB_KEY = String(SB.ANON_KEY || "").trim();
const BASE = location.href.replace(/bandeja\.html.*$/, "");
const K_WHO = "muniz_bandeja_who", K_DEV = "muniz_device_id", K_PED = "muniz_pedido";
const ls = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const money = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ago = s => { const m = Math.round(s / 60); if (m < 1) return "ahora"; if (m < 60) return `${m} min`; const h = Math.floor(m / 60); if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")}`; return `${Math.floor(h / 24)} d`; };
const first = n => String(n || "").split(" ")[0];
const PROVC = { ACE: "#FF5A00", CMC: "#2E5C8A", RSS: "#A78BFA", WHITECAP: "#F5B800" };
const LANEC = { VERDE: "#1F8A3B", AMARILLO: "#F5B800", ROJO: "#C81E1E", PRACTICA: "#6B7280" };
const STATUS = { SOLICITADO: ["ESPERANDO", "#F5B800"], APROBADO: ["APROBADO · SIN PO", "#38BDF8"], PO_ASIGNADO: ["PO ASIGNADO", "#4ADE80"], RECHAZADO: ["RECHAZADO", "#F87171"] };

async function rpc(fn, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
  const t = await r.text();
  if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch (e) {} throw new Error(m); }
  return t ? JSON.parse(t) : null;
}
function b64url(o) { const s = new TextEncoder().encode(JSON.stringify(o)); let b = ""; s.forEach(c => b += String.fromCharCode(c)); return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function speak(txt) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(txt); u.lang = "es-MX"; u.rate = 0.95; speechSynthesis.speak(u); } catch (e) {} }

/* ---------- piezas ---------- */
const Pill = ({ c, children }) => <span className="pill" style={{ background: c }}>{children}</span>;
function Line({ l, edit, onQty }) {
  const bad = l.rule === "RESTRINGIDO", hold = l.rule === "TRAILER_SI", odd = l.rule === "FUERA_LISTA" || l.rule === "SIN_PRECIO";
  return (
    <div className={`line ${bad ? "bad" : hold ? "hold" : odd ? "odd" : ""}`}>
      <div className="line-top">
        {edit && !bad ? (
          <div className="qty">
            <button onClick={() => onQty(Math.max(0, (l.q ?? l.qty) - 1))}>−</button>
            <b>{l.q ?? l.qty}</b>
            <button onClick={() => onQty((l.q ?? l.qty) + 1)}>+</button>
          </div>
        ) : <b className="q">{bad ? <s>{l.qty}</s> : l.qty}</b>}
        <div className="d">
          <div className={bad ? "strike" : ""}>{l.descr || l.code}{l.custom ? <em> · fuera de catálogo</em> : null}</div>
          {l.code && l.descr ? <small className="mono">{l.code}</small> : null}
        </div>
        <div className="p mono">{l.unit_price != null ? money(l.unit_price * (l.q ?? l.qty)) : "—"}</div>
      </div>
      {(bad || hold || odd) && l.rule_note ? <div className="note">{bad ? "✗ " : hold ? "⛔ " : "• "}{l.rule_note}</div> : null}
      {edit && !bad && (l.q ?? l.qty) === 0 ? <div className="note">Quitada</div> : null}
    </div>);
}

/* ---------- la tarjeta ---------- */
function Card({ o, who, onDone }) {
  const [edit, setEdit] = useState(false);
  const [lines, setLines] = useState(() => (o.lines || []).map(l => ({ ...l, q: l.qty })));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [reject, setReject] = useState(false); const [why, setWhy] = useState("");
  const [showRoutine, setShowRoutine] = useState(false);
  const routine = lines.filter(l => l.rule === "RUTINA" || l.rule === "OK");
  const flagged = lines.filter(l => !(l.rule === "RUTINA" || l.rule === "OK"));
  const live = lines.filter(l => l.rule !== "RESTRINGIDO");
  const total = live.reduce((a, l) => a + (l.unit_price || 0) * (l.q ?? l.qty), 0);
  const reasons = (o.lane_reasons || []).filter(r => !["RESTRINGIDO", "TRAILER_SI", "NO_RUTINA"].includes(r.rule) || r.rule === "TRAILER_SI");
  const summary = `${o.foreman} pide ${live.length} artículo${live.length === 1 ? "" : "s"} en ${o.provider} para ${o.jobsite || "obra sin nombre"}, ${money(total)}. ` +
    (routine.length ? `${routine.length} de rutina. ` : "") + (flagged.filter(l => l.rule !== "RESTRINGIDO").map(l => `Revisar: ${l.qty} ${l.descr || l.code}${l.rule_note ? ". " + l.rule_note : ""}`).join(". ")) +
    (o.justification ? `. ${first(o.foreman)} explica: ${o.justification}` : "") + (reasons.map(r => r.text).join(". ") ? ". " + reasons.map(r => r.text).join(". ") : "");
  const act = async (action, payload) => {
    setBusy(true); setErr("");
    try { const r = await rpc("decide_order", { p_person: who.name, p_pin: who.pin, p_order_id: o.id, p_action: action, p_lines: payload || null, p_note: why || null }); onDone(o.id, r); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const changed = lines.some(l => l.q !== l.qty);
  return (
    <div className="card" style={{ borderColor: LANEC[o.lane] + "88" }}>
      <div className="card-h">
        <div>
          <div className="who">{o.foreman}</div>
          <div className="meta"><Pill c={PROVC[o.provider]}>{o.provider}</Pill> <span>{o.jobsite || <em>sin obra</em>}</span></div>
        </div>
        <div className="right">
          <div className="total mono">{money(total)}</div>
          <div className="age">{o.req_no} · {ago(o.age_s)}{o.escalated_office_at ? " · ⏫ oficina" : o.escalated_backup_at ? " · ⏫ escalado" : ""}</div>
        </div>
      </div>
      {reasons.length ? <div className="reasons">{reasons.map((r, i) => <span key={i} className={`chip ${r.level === "ROJO" ? "red" : "amber"}`}>{r.text}</span>)}</div> : null}
      {o.justification ? <div className="just"><b>{first(o.foreman)} explica:</b> “{o.justification}”</div> : null}
      {o.orders_30d ? <div className="hist">Últimos 30 días: {o.orders_30d} pedidos aprobados · {money(o.usd_30d)}</div> : null}

      {routine.length ? (
        <button className="routine" onClick={() => setShowRoutine(s => !s)}>
          ✓ {routine.length} línea{routine.length === 1 ? "" : "s"} de rutina · {money(routine.reduce((a, l) => a + (l.unit_price || 0) * (l.q ?? l.qty), 0))} <span>{showRoutine || edit ? "ocultar" : "ver"}</span>
        </button>) : null}
      {(showRoutine || edit) ? routine.map(l => <Line key={l.pos} l={l} edit={edit} onQty={q => setLines(ls => ls.map(x => x.pos === l.pos ? { ...x, q } : x))} />) : null}
      {flagged.length ? <div className="flag-h">{flagged.filter(l => l.rule !== "RESTRINGIDO").length ? `⚠ ${flagged.filter(l => l.rule !== "RESTRINGIDO").length} necesita${flagged.filter(l => l.rule !== "RESTRINGIDO").length === 1 ? "" : "n"} tu decisión` : ""}</div> : null}
      {flagged.map(l => <Line key={l.pos} l={l} edit={edit} onQty={q => setLines(ls => ls.map(x => x.pos === l.pos ? { ...x, q } : x))} />)}

      {err ? <div className="err">{err}</div> : null}
      {reject ? (
        <div className="reject">
          <input value={why} onChange={e => setWhy(e.target.value)} placeholder="¿Por qué? (lo ve el mayordomo)" />
          <div className="row"><button className="b gray" onClick={() => setReject(false)}>Cancelar</button><button className="b red" disabled={busy} onClick={() => act("RECHAZAR")}>RECHAZAR TODO</button></div>
        </div>
      ) : (
        <div className="actions">
          {!edit ? <button className="b green big" disabled={busy || !live.length} onClick={() => act("APROBAR")}>✅ APROBAR{routine.length && flagged.filter(l => l.rule !== "RESTRINGIDO").length ? " TODO" : ""} · {money(total)}</button>
                 : <button className="b green big" disabled={busy || !live.some(l => l.q > 0)} onClick={() => act("APROBAR_LINEAS", lines.filter(l => l.rule !== "RESTRINGIDO").map(l => [l.pos, l.q]))}>✅ APROBAR ASÍ · {money(total)}{changed ? " (con cambios)" : ""}</button>}
          <div className="row">
            <button className="b gray" onClick={() => setEdit(e => !e)}>{edit ? "↩ sin cambios" : "✏️ AJUSTAR"}</button>
            <button className="b gray" onClick={() => speak(summary)}>🔊</button>
            <button className="b redline" onClick={() => setReject(true)}>✗ RECHAZAR</button>
          </div>
        </div>)}
    </div>);
}

/* ---------- oficina: aprobado, falta PO ---------- */
function PoCard({ o }) {
  const [open, setOpen] = useState(false);
  const p = o.payload || {};
  const tok = { v: 1, p: o.provider, ts: p.ts || Date.now(), ta: Date.now(), f: o.foreman, j: o.jobsite || p.j || "", d: p.d || "", s: o.supervisor || "",
    o: (o.lines || []).map(l => l.code ? [l.code, l.qty] : ["*" + l.pos, l.qty, l.descr]), a: [], x: [], u: p.u || {} };
  const link = BASE + "index.html#t=" + b64url(tok);
  return (
    <div className="card po">
      <div className="card-h">
        <div><div className="who">{o.foreman}</div><div className="meta"><Pill c={PROVC[o.provider]}>{o.provider}</Pill> <span>{o.jobsite}</span></div></div>
        <div className="right"><div className="total mono">{money(o.est_total)}</div><div className="age">{o.req_no} · aprobado hace {ago(o.age_s)} · {o.decided_by === "REGLAS" ? "🟢 auto" : first(o.decided_by)}</div></div>
      </div>
      {open ? (o.lines || []).map(l => <div key={l.pos} className="line"><div className="line-top"><b className="q">{l.qty}</b><div className="d">{l.descr || l.code}<small className="mono"> {l.code}</small></div><div className="p mono">{l.unit_price != null ? money(l.unit_price * l.qty) : "—"}</div></div></div>) : null}
      <div className="row">
        <button className="b gray" onClick={() => setOpen(s => !s)}>{open ? "ocultar" : `${(o.lines || []).length} líneas`}</button>
        <a className="b orange" href={link}>📄 PONER PO EN EL APP</a>
      </div>
    </div>);
}

/* ---------- mayordomo: MIS PEDIDOS ---------- */
function Mine() {
  const dev = ls(K_DEV, null) || (localStorage.getItem(K_DEV));
  const name = (ls(K_PED, {}) || {}).name || "";
  const [rows, setRows] = useState(null); const [err, setErr] = useState(""); const [txt, setTxt] = useState({}); const [busy, setBusy] = useState(0);
  const load = async () => { try { setRows(await rpc("my_orders", { p_device: dev, p_name: name || null })); setErr(""); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);
  const justify = async o => { setBusy(o.id); try { await rpc("justify_order", { p_device: dev, p_order_id: o.id, p_text: txt[o.id] || "" }); await load(); } catch (e) { alert(e.message); } finally { setBusy(0); } };
  const resend = o => {
    const p = o.payload || {}; const tok = { v: 1, p: o.provider, f: o.foreman || name, j: o.jobsite || "", d: p.d || "", ts: p.ts, u: p.u || {}, o: p.o || [], nf: p.nf || [] };
    const sup = o.supervisor && (CFG.SUPERVISORES || {})[o.supervisor]; const phone = sup || CFG.TITO_PHONE;
    const body = `PEDIDO ${o.req_no} · ${name || o.foreman} · ${o.provider}${o.jobsite ? " · " + o.jobsite : ""}\nABRIR: ${BASE}index.html#r=${b64url(tok)}`;
    location.href = `sms:+${phone}?body=${encodeURIComponent(body)}`;
  };
  return (
    <div className="wrap">
      <div className="top"><div><div className="kicker">MUÑIZ · MIS PEDIDOS</div><div className="title">{name || "Este teléfono"}</div></div><a className="b gray sm" href={BASE + "index.html"}>← al app</a></div>
      {err ? <div className="err">{err}</div> : null}
      {rows === null ? <div className="empty">Cargando…</div> : !rows.length ? <div className="empty">Aún no hay pedidos desde este teléfono.<br />Los que mandes con MANDAR aparecen aquí al instante.</div> : null}
      {(rows || []).map(o => {
        const [lbl, c] = STATUS[o.status] || ["", "#666"];
        return (
          <div key={o.id} className="card" style={{ borderColor: c + "77" }}>
            <div className="card-h">
              <div><div className="who">{o.req_no}{o.is_practice ? " · práctica" : ""}</div><div className="meta"><Pill c={PROVC[o.provider]}>{o.provider}</Pill> <span>{o.jobsite}</span></div></div>
              <div className="right"><Pill c={c}>{lbl}{o.po ? " " + o.po : ""}</Pill><div className="age">{new Date(o.created_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</div></div>
            </div>
            {o.lane_note ? <div className={`lane ${o.lane}`}>{o.lane_note}</div> : null}
            {o.status === "SOLICITADO" && !o.needs_justification ? <div className="hist">Lo tiene {first(o.supervisor) || "tu supervisor"}. Si no contesta en 90 min pasa solo a Enrique Chapa.</div> : null}
            {o.decided_by && o.decided_by !== "REGLAS" && o.status !== "SOLICITADO" ? <div className="hist">Decidió {o.decided_by}</div> : null}
            {(o.lines || []).map(l => <div key={l.pos} className={`line ${l.removed ? "bad" : ""}`}><div className="line-top"><b className="q">{l.removed ? <s>{l.qty_requested ?? l.qty}</s> : l.qty}{!l.removed && l.qty_requested != null && l.qty_requested !== l.qty ? <small> (pediste {l.qty_requested})</small> : null}</b><div className="d"><div className={l.removed ? "strike" : ""}>{l.descr}</div></div></div>{l.removed && l.rule_note ? <div className="note">✗ {l.rule_note}</div> : null}</div>)}
            {o.needs_justification ? (
              <div className="justify">
                <div className="flag-h">⛔ Explica por qué necesitas este equipo si ya tienes uno en tu tráiler:</div>
                <textarea value={txt[o.id] || ""} onChange={e => setTxt(t => ({ ...t, [o.id]: e.target.value }))} placeholder="Ej.: el de la tráiler no prende, ya lo llevé a la yarda" rows={3} />
                <button className="b orange big" disabled={busy === o.id || (txt[o.id] || "").trim().length < 8} onClick={() => justify(o)}>MANDAR EXPLICACIÓN</button>
              </div>) : null}
            {o.status === "SOLICITADO" && !o.needs_justification ? <div className="row"><button className="b gray" onClick={() => resend(o)}>📲 REENVIAR TEXTO A {first(o.supervisor) || "TITO"}</button></div> : null}
          </div>);
      })}
    </div>);
}

/* ---------- supervisor / oficina ---------- */
function Inbox({ who, onLogout }) {
  const [data, setData] = useState(null); const [err, setErr] = useState(""); const [done, setDone] = useState({});
  const load = async () => { try { rpc("escalate_pending").catch(() => {}); const d = await rpc("bandeja", { p_person: who.name, p_pin: who.pin }); setData(d); setErr(""); } catch (e) { setErr(e.message); if (/PIN|conozco|decide/.test(e.message)) onLogout(); } };
  useEffect(() => { load(); const t = setInterval(load, 20000); document.addEventListener("visibilitychange", load); return () => { clearInterval(t); document.removeEventListener("visibilitychange", load); }; }, [who.name]);
  const onDone = (id, r) => { setDone(d => ({ ...d, [id]: r })); setTimeout(load, 800); };
  const queue = (data?.queue || []).filter(o => !done[o.id]);
  return (
    <div className="wrap">
      <div className="top">
        <div><div className="kicker">MUÑIZ · BANDEJA DE PEDIDOS</div><div className="title">{who.name}</div></div>
        <button className="b gray sm" onClick={onLogout}>salir</button>
      </div>
      {err ? <div className="err">{err}</div> : null}
      {data === null && !err ? <div className="empty">Cargando…</div> : null}
      {data ? (
        <>
          <div className="section">{queue.length ? `${queue.length} POR DECIDIR` : "NADA POR DECIDIR"} <span>lo verde (rutina bajo ${data.ceiling}) ya se aprobó solo</span></div>
          {!queue.length ? <div className="empty ok">✓ Todo al día. Nada esperando tu decisión.</div> : null}
          {queue.map(o => <Card key={o.id} o={o} who={who} onDone={onDone} />)}
          {Object.entries(done).map(([id, r]) => <div key={id} className="done">✓ {r.req_no} {r.status}{r.removed?.length ? ` · ${r.removed.length} quitada(s)` : ""}</div>)}
          {data.is_office ? (
            <>
              <div className="section">{(data.for_po || []).length} APROBADO{(data.for_po || []).length === 1 ? "" : "S"} · FALTA PO <span>te toca a ti</span></div>
              {(data.for_po || []).map(o => <PoCard key={o.id} o={o} />)}
            </>) : null}
          <div className="section">ÚLTIMOS 7 DÍAS</div>
          {(data.recent || []).slice(0, 25).map(o => { const [lbl, c] = STATUS[o.status] || ["", "#666"]; return (
            <div key={o.id} className="recent"><span className="mono">{o.req_no}</span><span className="rf">{o.foreman}</span><Pill c={PROVC[o.provider]}>{o.provider}</Pill><span className="mono dim">{o.est_total ? money(o.est_total) : ""}</span><Pill c={c}>{lbl}{o.po ? " " + o.po : ""}</Pill><span className="dim">{o.decided_by === "REGLAS" ? "🟢" : first(o.decided_by)}</span></div>); })}
        </>) : null}
    </div>);
}

function Login({ onLogin }) {
  const [people, setPeople] = useState([]); const [name, setName] = useState(""); const [pin, setPin] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { rpc("bandeja_people").then(setPeople).catch(e => setErr(e.message)); }, []);
  const go = async () => { setBusy(true); setErr(""); try { await rpc("bandeja", { p_person: name, p_pin: pin }); lsSet(K_WHO, { name, pin }); onLogin({ name, pin }); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="wrap login">
      <div className="kicker">MUÑIZ CONCRETE & CONTRACTING</div>
      <div className="title">Bandeja de pedidos</div>
      <p className="dim">Aquí llegan los pedidos que necesitan tu decisión. Lo de rutina ya se aprobó solo.</p>
      <div className="grid">{people.map(p => <button key={p.name} className={`b ${name === p.name ? "orange" : "gray"}`} onClick={() => setName(p.name)}>{p.name}<small>{p.role}</small></button>)}</div>
      {name ? <><input className="pin" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN" autoFocus />
        <button className="b green big" disabled={busy || pin.length < 4} onClick={go}>ENTRAR</button></> : null}
      {err ? <div className="err">{err}</div> : null}
      <a className="dim link" href={BASE + "bandeja.html#mis"}>Soy mayordomo → mis pedidos</a>
    </div>);
}

function App() {
  const [hash, setHash] = useState(location.hash);
  const [who, setWho] = useState(() => ls(K_WHO, null));
  useEffect(() => { const f = () => setHash(location.hash); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  if (!SB_URL || !SB_KEY) return <div className="wrap"><div className="err">Falta SUPABASE.URL / ANON_KEY en config.js</div></div>;
  if (hash === "#mis") return <Mine />;
  if (!who) return <Login onLogin={setWho} />;
  return <Inbox who={who} onLogout={() => { localStorage.removeItem(K_WHO); setWho(null); }} />;
}
createRoot(document.getElementById("root")).render(<App />);
