-- =====================================================================
--  MUÑIZ CONCRETE & CONTRACTING  ·  Backend  ·  Fase 2: PEDIDOS DE MATERIAL
--  Requiere Fase 1 + parches 1-3 ya corridos.
--  Pegar completo en Supabase -> SQL Editor -> Run.  Se puede correr
--  más de una vez sin romper nada. Termina con:  OK · Fase 2 lista
--
--  QUÉ HACE: cada vez que alguien toca MANDAR, APROBAR, RECHAZAR o genera
--  un TICKET en el app de pedidos, el pedido se registra AQUÍ en ese
--  instante — antes de que se abra Mensajes. Si el mayordomo nunca manda
--  el texto, la oficina lo ve de todos modos.
-- =====================================================================

-- ---------- folio interno de solicitud: S1001, S1002, ... ----------
-- (no es el PO. El PO lo pone la oficina; aquí queda en la columna "po")
create sequence if not exists material_req_seq start with 1001;

-- ---------- el pedido (una fila por pedido, sigue su vida completa) ----------
create table if not exists material_orders (
  id              bigint generated always as identity primary key,
  req_no          text unique not null default ('S' || nextval('material_req_seq')::text),
  order_key       text unique not null,          -- mayordomo|ts|proveedor (viene del app; reintentos no duplican)
  created_at      timestamptz not null default now(),   -- cuándo lo vio la base de datos
  requested_at    timestamptz,                   -- cuándo lo armó el mayordomo (reloj del teléfono)
  provider        text not null check (provider in ('ACE','CMC','RSS','WHITECAP')),
  foreman         text not null,                 -- quien pide
  foreman_role    text,                          -- MAYORDOMO | SUPERVISOR | GERENTE | OFICINA | (desconocido)
  jobsite         text,
  jobsite_known   boolean not null default false,-- true si la obra está en la tabla jobsites
  jobsite_week    text,                          -- lo que le tocaba esta semana según el rol
  supervisor      text,                          -- quién lo aprobó (o el mismo, si va directo)
  self_approved   boolean not null default false,-- supervisor/gerente/oficina: va directo a Tito
  driver          text,                          -- chofer que recoge (si se identificó)
  is_addon        boolean not null default false,-- "AGREGADO" al pedido de hace rato
  is_practice     boolean not null default false,-- MODO PRÁCTICA: nunca cuenta
  status          text not null default 'SOLICITADO'
                  check (status in ('SOLICITADO','APROBADO','RECHAZADO','PO_ASIGNADO')),
  submitted_at    timestamptz,                   -- tocó MANDAR (abrió Mensajes al supervisor)
  confirmed_at    timestamptz,                   -- tocó "SÍ, YA LO MANDÉ"
  approved_at     timestamptz,
  rejected_at     timestamptz,
  po              text,                          -- PO de la oficina (del ticket de recogida)
  po_at           timestamptz,
  requested_lines integer not null default 0,
  requested_qty   numeric  not null default 0,
  approved_lines  integer,
  approved_qty    numeric,
  adjusted_lines  integer,                       -- cantidad cambiada por el supervisor
  removed_lines   integer,                       -- quitadas por el supervisor
  custom_lines    integer not null default 0,    -- "FUERA DE CATÁLOGO"
  est_total       numeric,                       -- estimado con precio de catálogo (aprobado, o pedido si aún no)
  not_found       text[] not null default '{}',  -- lo que buscó y no encontró en el catálogo
  usage           jsonb,                         -- uso del app (aperturas, búsquedas) al momento de mandar
  device_id       text,
  notes           text
);
create index if not exists mo_created_idx  on material_orders (created_at desc);
create index if not exists mo_foreman_idx  on material_orders (foreman, created_at desc);
create index if not exists mo_status_idx   on material_orders (status);
create index if not exists mo_po_idx       on material_orders (po);

-- ---------- las líneas, una foto por etapa ----------
-- stage: SOLICITADO (lo que pidió) | APROBADO (lo que autorizó el supervisor) | TICKET (lo que salió en el ticket)
create table if not exists material_order_lines (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references material_orders(id) on delete cascade,
  stage       text not null check (stage in ('SOLICITADO','APROBADO','TICKET')),
  pos         integer not null,
  code        text,                              -- código del proveedor ('' si es fuera de catálogo)
  descr       text,
  custom      boolean not null default false,    -- fuera de catálogo
  qty         numeric not null default 0,        -- cantidad en esta etapa (0 = quitada)
  qty_requested numeric,                         -- lo que había pedido originalmente (si cambió)
  removed     boolean not null default false,    -- el supervisor la quitó
  authorized  boolean,                           -- solo en TICKET: true autorizada / false NO autorizada
  unit_price  numeric,                           -- precio de catálogo al momento (puede ser null)
  line_total  numeric generated always as (qty * coalesce(unit_price,0)) stored
);
create index if not exists mol_order_idx on material_order_lines (order_id, stage, pos);

-- ---------- bitácora: cada toque que cambió el pedido ----------
create table if not exists material_order_events (
  id        bigint generated always as identity primary key,
  order_id  bigint not null references material_orders(id) on delete cascade,
  ts        timestamptz not null default now(),
  stage     text not null,                       -- SOLICITADO | CONFIRMADO | APROBADO | RECHAZADO | TICKET
  actor     text,
  device_id text,
  meta      jsonb
);
create index if not exists moe_order_idx on material_order_events (order_id, ts);

-- =====================================================================
--  LA FUNCIÓN QUE LLAMA EL TELÉFONO. Único camino para escribir.
--  register_material_order(stage, payload, device_id)
--    stage   = 'SOLICITADO' | 'CONFIRMADO' | 'APROBADO' | 'RECHAZADO' | 'TICKET'
--    payload = el mismo objeto que el app mete en el link (#r= / #t= / #p=),
--              con las líneas enriquecidas: [codigo, cantidad, descripcion, precio]
--  Devuelve el folio S#### y el estado. Idempotente: reintentar no duplica.
-- =====================================================================
create or replace function register_material_order(p_stage text, payload jsonb, p_device text default null)
returns table (req_no text, status text, po text, order_id bigint)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_stage   text := upper(trim(coalesce(p_stage,'')));
  v_prov    text := upper(trim(coalesce(payload->>'p','ACE')));
  v_f       text := upper(trim(coalesce(payload->>'f','')));
  v_ts      timestamptz;
  v_key     text;
  v_o       material_orders;
  v_role    text;
  v_job     text := nullif(trim(coalesce(payload->>'j','')),'');
  v_jobknown boolean;
  v_lines   jsonb := coalesce(payload->'o','[]'::jsonb);
  v_x       jsonb := coalesce(payload->'x','[]'::jsonb);
  v_a       jsonb := coalesce(payload->'a','[]'::jsonb);
  v_line    jsonb;
  v_i       integer := 0;
  v_code    text; v_descr text; v_qty numeric; v_price numeric; v_custom boolean; v_orig numeric;
  v_nlines  integer := 0; v_nqty numeric := 0; v_ncustom integer := 0; v_total numeric := 0;
  v_sup     text;
  v_po      text;
  v_lstage  text;
begin
  if v_stage not in ('SOLICITADO','CONFIRMADO','APROBADO','RECHAZADO','TICKET') then
    raise exception 'Etapa desconocida: %', v_stage;
  end if;
  if v_prov not in ('ACE','CMC','RSS','WHITECAP') then
    raise exception 'Proveedor desconocido: %', v_prov;
  end if;
  if v_f = '' then
    raise exception 'Falta el nombre de quien pide';
  end if;

  -- reloj del teléfono (ms). Si no viene, usamos ahora.
  begin
    v_ts := to_timestamp((payload->>'ts')::double precision / 1000.0);
  exception when others then v_ts := null; end;
  if v_ts is null or v_ts < '2026-01-01' or v_ts > now() + interval '1 day' then v_ts := now(); end if;

  -- la llave que hace idempotente todo: quién | cuándo lo armó | proveedor
  v_key := v_f || '|' || coalesce(payload->>'ts','') || '|' || v_prov;

  select p.role into v_role from people p where p.name = v_f;
  v_jobknown := v_job is not null and exists (select 1 from jobsites j where j.name = v_job and j.active);

  -- -------- localizar (o crear) el pedido --------
  if v_stage = 'TICKET' then
    -- el ticket no trae ts: buscamos el pedido aprobado más reciente de esa persona
    -- con ese proveedor (últimos 10 días) que aún no tenga PO, o que ya tenga ESTE PO.
    v_po := nullif(upper(trim(coalesce(payload->>'po',''))),'');
    select * into v_o from material_orders m
     where m.foreman = v_f and m.provider = v_prov and not m.is_practice
       and m.created_at > now() - interval '10 days'
       and (m.po is null or m.po = v_po)
       and m.status in ('SOLICITADO','APROBADO','PO_ASIGNADO')
     order by (m.po = v_po) desc nulls last, m.status = 'APROBADO' desc, m.created_at desc
     limit 1;
    if not found then
      -- ticket sin pedido previo en la base (pedido viejo, o hecho antes de la Fase 2): se crea
      v_key := 'TICKET|' || v_f || '|' || v_prov || '|' || coalesce(v_po,'SIN-PO') || '|' || coalesce(payload->>'d','');
      select * into v_o from material_orders m where m.order_key = v_key;
      if not found then
        insert into material_orders (order_key, requested_at, provider, foreman, foreman_role, jobsite, jobsite_known,
                                     jobsite_week, driver, device_id, status, notes)
        values (v_key, now(), v_prov, v_f, v_role, v_job, v_jobknown, week_jobsite(v_f),
                nullif(upper(trim(coalesce(payload->>'ch',''))),''), p_device, 'APROBADO',
                'Ticket sin solicitud previa en la base de datos')
        returning * into v_o;
      end if;
    end if;
  else
    select * into v_o from material_orders m where m.order_key = v_key;
    if not found then
      if v_stage in ('CONFIRMADO','RECHAZADO') then
        -- no hay nada que confirmar/rechazar: no inventamos pedidos
        return;
      end if;
      insert into material_orders (order_key, requested_at, provider, foreman, foreman_role, jobsite, jobsite_known,
                                   jobsite_week, driver, is_addon, is_practice, device_id, usage, not_found, status)
      values (v_key, v_ts, v_prov, v_f, v_role, v_job, v_jobknown, week_jobsite(v_f),
              nullif(upper(trim(coalesce(payload->>'ch',''))),''),
              coalesce((payload->>'ad')::int,0) = 1,
              coalesce((payload->>'dm')::int,0) = 1,
              p_device, payload->'u',
              coalesce((select array_agg(t.x) from jsonb_array_elements_text(coalesce(payload->'nf','[]'::jsonb)) as t(x)), '{}'),
              case when v_stage = 'APROBADO' then 'APROBADO' else 'SOLICITADO' end)
      returning * into v_o;
    end if;
  end if;

  -- -------- por etapa --------
  if v_stage = 'SOLICITADO' then
    if v_o.submitted_at is not null then
      -- reintento del mismo toque: no cambia nada
      return query select v_o.req_no, v_o.status, v_o.po, v_o.id; return;
    end if;
    v_lstage := 'SOLICITADO';

  elsif v_stage = 'CONFIRMADO' then
    update material_orders set confirmed_at = coalesce(confirmed_at, now()) where id = v_o.id returning * into v_o;
    insert into material_order_events (order_id, stage, actor, device_id) values (v_o.id, 'CONFIRMADO', v_f, p_device);
    return query select v_o.req_no, v_o.status, v_o.po, v_o.id; return;

  elsif v_stage = 'RECHAZADO' then
    if v_o.status = 'SOLICITADO' then
      update material_orders set status = 'RECHAZADO', rejected_at = now(),
             supervisor = coalesce(nullif(upper(trim(coalesce(payload->>'s',''))),''), supervisor)
       where id = v_o.id returning * into v_o;
      insert into material_order_events (order_id, stage, actor, device_id, meta)
      values (v_o.id, 'RECHAZADO', coalesce(nullif(payload->>'s',''), 'SUPERVISOR'), p_device, payload - 'o' - 'u');
    end if;
    return query select v_o.req_no, v_o.status, v_o.po, v_o.id; return;

  elsif v_stage = 'APROBADO' then
    if v_o.approved_at is not null and v_o.status in ('APROBADO','PO_ASIGNADO') then
      return query select v_o.req_no, v_o.status, v_o.po, v_o.id; return;   -- reintento
    end if;
    v_sup := nullif(upper(trim(coalesce(payload->>'s',''))),'');
    v_lstage := 'APROBADO';

  elsif v_stage = 'TICKET' then
    v_lstage := 'TICKET';
  end if;

  -- -------- líneas: reemplaza la foto de esta etapa --------
  delete from material_order_lines where order_id = v_o.id and stage = v_lstage;
  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_i := v_i + 1;
    v_code  := trim(coalesce(v_line->>0,''));
    v_qty   := coalesce(nullif(v_line->>1,'')::numeric, 0);
    v_descr := nullif(trim(coalesce(v_line->>2,'')),'');
    v_price := nullif(v_line->>3,'')::numeric;
    v_custom := left(v_code,1) = '*';
    if v_custom then v_code := ''; end if;
    -- ¿cambió la cantidad? (viene en "a": [codigo_o_descr, original, nueva])
    v_orig := null;
    if v_lstage = 'APROBADO' then
      select nullif(a->>1,'')::numeric into v_orig from jsonb_array_elements(v_a) a
       where (a->>0) = v_code or (v_custom and (a->>0) = v_descr) limit 1;
    end if;
    insert into material_order_lines (order_id, stage, pos, code, descr, custom, qty, qty_requested, authorized, unit_price)
    values (v_o.id, v_lstage, v_i, v_code, v_descr, v_custom, v_qty, v_orig,
            case when v_lstage = 'TICKET' then true end, v_price);
    v_nlines := v_nlines + 1; v_nqty := v_nqty + v_qty; v_total := v_total + v_qty * coalesce(v_price,0);
    if v_custom then v_ncustom := v_ncustom + 1; end if;
  end loop;
  -- quitadas / no autorizadas (viene en "x": [codigo_o_descr, cantidad_original, descripcion?])
  for v_line in select * from jsonb_array_elements(v_x) loop
    v_i := v_i + 1;
    v_code  := trim(coalesce(v_line->>0,''));
    v_qty   := coalesce(nullif(v_line->>1,'')::numeric, 0);
    v_descr := nullif(trim(coalesce(v_line->>2,'')),'');
    v_custom := left(v_code,1) = '*' or (v_descr is null and not exists (select 1 where v_code ~ '^[A-Z0-9]'));
    if left(v_code,1) = '*' then v_code := ''; end if;
    insert into material_order_lines (order_id, stage, pos, code, descr, custom, qty, qty_requested, removed, authorized)
    values (v_o.id, v_lstage, v_i, v_code, coalesce(v_descr, case when v_code = '' then null else null end), v_custom,
            0, v_qty, v_lstage = 'APROBADO', case when v_lstage = 'TICKET' then false end);
  end loop;

  -- -------- encabezado --------
  if v_lstage = 'SOLICITADO' then
    update material_orders set
      submitted_at = now(), requested_lines = v_nlines, requested_qty = v_nqty, custom_lines = v_ncustom,
      est_total = nullif(v_total,0), jobsite = coalesce(v_job, jobsite), jobsite_known = v_jobknown,
      driver = coalesce(nullif(upper(trim(coalesce(payload->>'ch',''))),''), driver)
    where id = v_o.id returning * into v_o;
    insert into material_order_events (order_id, stage, actor, device_id, meta)
    values (v_o.id, 'SOLICITADO', v_f, p_device, jsonb_build_object('lines', v_nlines, 'qty', v_nqty, 'to', payload->>'to'));

  elsif v_lstage = 'APROBADO' then
    update material_orders set
      status = case when status = 'PO_ASIGNADO' then status else 'APROBADO' end,
      approved_at = now(), supervisor = coalesce(v_sup, supervisor),
      self_approved = (v_sup is not null and v_sup = foreman),
      approved_lines = v_nlines, approved_qty = v_nqty,
      adjusted_lines = (select count(*) from jsonb_array_elements(v_a)),
      removed_lines  = (select count(*) from jsonb_array_elements(v_x)),
      custom_lines   = greatest(custom_lines, v_ncustom),
      est_total = nullif(v_total,0),
      -- si el pedido nace ya aprobado (supervisor/gerente directo) también es su solicitud
      requested_lines = case when submitted_at is null then v_nlines + (select count(*) from jsonb_array_elements(v_x)) else requested_lines end,
      requested_qty   = case when submitted_at is null then v_nqty else requested_qty end,
      is_addon   = is_addon or coalesce((payload->>'ad')::int,0) = 1,
      is_practice = is_practice or coalesce((payload->>'dm')::int,0) = 1,
      driver = coalesce(nullif(upper(trim(coalesce(payload->>'ch',''))),''), driver),
      not_found = case when cardinality(not_found) = 0
                       then coalesce((select array_agg(t.x) from jsonb_array_elements_text(coalesce(payload->'nf','[]'::jsonb)) as t(x)), '{}')
                       else not_found end
    where id = v_o.id returning * into v_o;
    insert into material_order_events (order_id, stage, actor, device_id, meta)
    values (v_o.id, 'APROBADO', coalesce(v_sup, v_f), p_device,
            jsonb_build_object('lines', v_nlines, 'qty', v_nqty, 'adjusted', v_a, 'removed', v_x));

  elsif v_lstage = 'TICKET' then
    update material_orders set
      status = 'PO_ASIGNADO', po = coalesce(v_po, po), po_at = coalesce(po_at, now()),
      driver = coalesce(nullif(upper(trim(coalesce(payload->>'ch',''))),''), driver),
      jobsite = coalesce(jobsite, v_job)
    where id = v_o.id returning * into v_o;
    insert into material_order_events (order_id, stage, actor, device_id, meta)
    values (v_o.id, 'TICKET', 'OFICINA', p_device,
            jsonb_build_object('po', v_po, 'authorized', v_nlines, 'not_authorized', (select count(*) from jsonb_array_elements(v_x))));
  end if;

  return query select v_o.req_no, v_o.status, v_o.po, v_o.id;
end $$;

revoke all on function register_material_order(text, jsonb, text) from public;
grant execute on function register_material_order(text, jsonb, text) to anon, authenticated;

-- ---------- seguridad: el campo NO toca las tablas; solo la función ----------
alter table material_orders       enable row level security;
alter table material_order_lines  enable row level security;
alter table material_order_events enable row level security;

drop policy if exists mo_office  on material_orders;
create policy mo_office  on material_orders       for all using (is_office()) with check (is_office());
drop policy if exists mol_office on material_order_lines;
create policy mol_office on material_order_lines  for all using (is_office()) with check (is_office());
drop policy if exists moe_office on material_order_events;
create policy moe_office on material_order_events for all using (is_office()) with check (is_office());

grant select, update, delete on material_orders, material_order_lines, material_order_events to authenticated;
grant insert on material_order_lines, material_order_events to authenticated;   -- para notas/ajustes de oficina
grant usage, select on sequence material_req_seq to authenticated;
revoke all on material_orders, material_order_lines, material_order_events from anon;

-- ---------- vista lista para el Centro de Mando ----------
create or replace view material_orders_full with (security_invoker = true) as
select m.*,
  extract(epoch from (m.approved_at - m.submitted_at))::int as secs_to_approve,
  extract(epoch from (m.po_at - coalesce(m.approved_at, m.submitted_at)))::int as secs_to_po,
  (select jsonb_agg(jsonb_build_object(
      'stage', l.stage, 'pos', l.pos, 'code', l.code, 'descr', l.descr, 'custom', l.custom,
      'qty', l.qty, 'qty_requested', l.qty_requested, 'removed', l.removed,
      'authorized', l.authorized, 'unit_price', l.unit_price, 'line_total', l.line_total)
      order by l.stage, l.pos)
     from material_order_lines l where l.order_id = m.id) as lines,
  array_remove(array[
    case when m.status = 'SOLICITADO' and m.submitted_at < now() - interval '2 hours' then 'Sin respuesta del supervisor 2 h+' end,
    case when m.status = 'SOLICITADO' and m.confirmed_at is null and m.submitted_at < now() - interval '10 minutes' then 'Abrió Mensajes y no confirmó' end,
    case when m.status = 'APROBADO' and m.po is null and m.approved_at < now() - interval '4 hours' then 'Aprobado sin PO 4 h+' end,
    case when not m.jobsite_known and coalesce(m.jobsite,'') <> '' then 'Obra escrita a mano' end,
    case when coalesce(m.jobsite,'') = '' then 'Sin obra' end,
    case when m.jobsite_week is not null and m.jobsite is not null and m.jobsite <> m.jobsite_week then 'Obra distinta al rol de la semana' end,
    case when m.self_approved and coalesce(m.foreman_role,'') = 'MAYORDOMO' then 'Mayordomo se aprobó a sí mismo' end,
    case when m.custom_lines > 0 then m.custom_lines || ' fuera de catálogo' end,
    case when m.removed_lines > 0 then m.removed_lines || ' quitada(s) por supervisor' end,
    case when m.is_addon then 'Agregado al pedido anterior' end,
    case when extract(dow from m.created_at at time zone 'America/Chicago') = 0 then 'Domingo' end,
    case when extract(hour from m.created_at at time zone 'America/Chicago') not between 5 and 19 then 'Fuera de horario' end
  ], null) as server_flags
from material_orders m;
grant select on material_orders_full to authenticated;

-- La vista de combustible de la Fase 1 corría con permisos del dueño y se
-- saltaba las reglas de la tabla. Ahora respeta RLS igual que la tabla.
alter view fuel_pos_flagged set (security_invoker = true);

-- ---------- que el app de pedidos también cuente en "EN EL APP AHORA" ----------
-- (la tabla events ya existe; la columna app acepta 'pedidos'. Nada que cambiar.)

-- =====================================================================
--  PRUEBA AUTOMÁTICA: pide, confirma, aprueba con ajuste, ticket con PO.
--  Todo se BORRA al final y el folio S1001 queda libre para el primer
--  pedido real. Los resultados salen en Messages/Notices.
-- =====================================================================
do $$
declare
  r record; v_f text; v_job text; v_ts text := (extract(epoch from now())*1000)::bigint::text;
  v_id bigint; v_req text; v_seq bigint; v_called boolean; n int;
begin
  select last_value, is_called into v_seq, v_called from material_req_seq;
  select p.name into v_f from people p where p.role = 'MAYORDOMO' and p.active order by p.name limit 1;
  select j.name into v_job from jobsites j where j.active order by j.name limit 1;
  if v_f is null or v_job is null then raise notice 'PRUEBA OMITIDA: falta gente u obras'; return; end if;

  -- 1) el mayordomo toca MANDAR
  select * into r from register_material_order('SOLICITADO', jsonb_build_object(
    'v',1,'p','ACE','f',v_f,'j',v_job,'ts',v_ts,
    'o', jsonb_build_array(jsonb_build_array('MTTP159',2,'Tamalón / concrete placer',45.5),
                           jsonb_build_array('*c1',1,'Cosa rara que no está',null)),
    'nf', jsonb_build_array('grapas')), 'dev-test');
  v_id := r.order_id; v_req := r.req_no;
  if r.status <> 'SOLICITADO' then raise exception 'FALLO 1: estado %', r.status; end if;
  raise notice 'PRUEBA 1/6 OK · se registró % como SOLICITADO', v_req;

  -- 2) reintento: mismo folio
  select * into r from register_material_order('SOLICITADO', jsonb_build_object('p','ACE','f',v_f,'ts',v_ts,'o','[]'::jsonb), 'dev-test');
  if r.req_no <> v_req then raise exception 'FALLO 2: el reintento creó otro folio (% vs %)', r.req_no, v_req; end if;
  raise notice 'PRUEBA 2/6 OK · reintento devuelve el mismo folio';

  -- 3) confirma "SÍ, YA LO MANDÉ"
  perform register_material_order('CONFIRMADO', jsonb_build_object('p','ACE','f',v_f,'ts',v_ts), 'dev-test');
  if (select confirmed_at from material_orders where id = v_id) is null then raise exception 'FALLO 3: no confirmó'; end if;
  raise notice 'PRUEBA 3/6 OK · confirmación registrada';

  -- 4) el supervisor aprueba: baja 2->1 y quita el fuera de catálogo
  select * into r from register_material_order('APROBADO', jsonb_build_object(
    'p','ACE','f',v_f,'ts',v_ts,'s','MIGUEL JUAREZ','j',v_job,
    'o', jsonb_build_array(jsonb_build_array('MTTP159',1,'Tamalón / concrete placer',45.5)),
    'a', jsonb_build_array(jsonb_build_array('MTTP159',2,1)),
    'x', jsonb_build_array(jsonb_build_array('Cosa rara que no está',1))), 'dev-sup');
  if r.status <> 'APROBADO' or r.req_no <> v_req then raise exception 'FALLO 4: % %', r.status, r.req_no; end if;
  select count(*) into n from material_order_lines where order_id = v_id and stage = 'APROBADO';
  if n <> 2 then raise exception 'FALLO 4: esperaba 2 líneas aprobadas (1 viva + 1 quitada), hay %', n; end if;
  if (select est_total from material_orders where id = v_id) <> 45.5 then raise exception 'FALLO 4: total estimado'; end if;
  raise notice 'PRUEBA 4/6 OK · aprobado con ajuste y quitada; total estimado $45.50';

  -- 5) la oficina genera el ticket con PO (el ticket no trae ts)
  select * into r from register_material_order('TICKET', jsonb_build_object(
    'p','ACE','f',v_f,'po','TEST-9999','j',v_job,'ch','HECTOR SEGURA',
    'o', jsonb_build_array(jsonb_build_array('MTTP159',1)), 'x','[]'::jsonb), 'dev-office');
  if r.req_no <> v_req or r.status <> 'PO_ASIGNADO' or r.po <> 'TEST-9999' then
    raise exception 'FALLO 5: el ticket no encontró el pedido (% % %)', r.req_no, r.status, r.po; end if;
  raise notice 'PRUEBA 5/6 OK · ticket ligado al mismo pedido, PO TEST-9999, chofer HECTOR SEGURA';

  -- 6) rechazo de un pedido nuevo
  select * into r from register_material_order('SOLICITADO', jsonb_build_object(
    'p','RSS','f',v_f,'ts',(v_ts::bigint+1)::text,'o',jsonb_build_array(jsonb_build_array('X1',3,'Varilla',9))), 'dev-test');
  perform register_material_order('RECHAZADO', jsonb_build_object('p','RSS','f',v_f,'ts',(v_ts::bigint+1)::text,'s','MIGUEL JUAREZ'), 'dev-sup');
  if (select status from material_orders where req_no = r.req_no) <> 'RECHAZADO' then raise exception 'FALLO 6: no rechazó'; end if;
  raise notice 'PRUEBA 6/6 OK · rechazo registrado';

  -- limpiar y regresar el folio
  delete from material_orders where device_id in ('dev-test') or order_key like '%|' || v_ts || '|%' or order_key like '%|' || (v_ts::bigint+1)::text || '|%';
  perform setval('material_req_seq', v_seq, v_called);
  raise notice 'PRUEBAS LIMPIADAS · el folio S% sigue libre', (select last_value from material_req_seq) + case when (select is_called from material_req_seq) then 1 else 0 end;
end $$;

select 'OK · Fase 2 lista' as status,
       (select count(*) from material_orders) as pedidos_registrados,
       'S' || (select last_value + case when is_called then 1 else 0 end from material_req_seq) as siguiente_folio;
