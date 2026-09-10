-- =====================================================================
--  MUÑIZ CONCRETE & CONTRACTING  ·  Backend  ·  Fase 1: COMBUSTIBLE
--  Pegar completo en Supabase -> SQL Editor -> Run.  Se puede correr
--  más de una vez sin romper nada (todo es "if not exists" / "or replace").
-- =====================================================================

-- ---------- catálogos que antes vivían en config.js ----------
create table if not exists people (
  name        text primary key,                 -- "PEDRO LIMON"
  role        text not null default 'MAYORDOMO',-- MAYORDOMO | SUPERVISOR | GERENTE | CHOFER | PERSONAL | OFICINA
  phone       text,
  active      boolean not null default true
);

create table if not exists stations (
  code   text primary key,                      -- LEOS | TEXCON
  name   text not null,
  short  text not null,
  phone  text,
  color  text not null default '#374151',
  active boolean not null default true
);

create table if not exists jobsites (
  name    text primary key,                     -- "North Cross Dr"  (lugar, nunca contrato)
  address text,
  active  boolean not null default true
);

create table if not exists vehicles (
  id          text primary key,                 -- "V-PLI"
  plate       text,                             -- "" hasta que la oficina la ponga
  descr       text not null,
  tipo        text not null check (tipo in ('CAMIONETA','MAQUINARIA','TAMBO','PIPA')),
  comb        text not null check (comb in ('DIESEL','GASOLINA')),
  assigned_to text references people(name) on update cascade on delete set null,
  active      boolean not null default true
);

-- dónde le toca a cada quien esta semana (del 6-Week Lookahead)
create table if not exists roster (
  person     text not null references people(name) on update cascade on delete cascade,
  week_start date not null,                     -- lunes
  jobsite    text not null references jobsites(name) on update cascade,
  primary key (person, week_start)
);

-- quién puede entrar a la oficina (login con correo en Supabase Auth)
create table if not exists office_users (
  email text primary key,
  name  text not null
);

-- ---------- el registro de combustible ----------
create sequence if not exists fuel_po_seq start with 1001;

create table if not exists fuel_pos (
  id             bigint generated always as identity primary key,
  po             text unique not null default ('F' || nextval('fuel_po_seq')::text),
  created_at     timestamptz not null default now(),
  client_ref     text unique,                   -- uuid del teléfono: reintentos no duplican
  device_id      text,
  who            text not null,
  role           text,
  vehicle_id     text,
  vehicle_desc   text,
  tipo           text,
  comb           text not null check (comb in ('DIESEL','GASOLINA')),
  plate          text,
  plate_typed    boolean not null default false,
  equipo         text,
  reading        numeric,                       -- millas u horas
  jobsite        text not null,
  jobsite_other  boolean not null default false,
  jobsite_week   text,
  station        text not null,
  flags          text[] not null default '{}',
  seconds_to_po  integer,                       -- cuánto tardó la persona en los 6 pasos
  gallons        numeric,                       -- se llena después, de la factura
  amount         numeric
);
create index if not exists fuel_pos_vehicle_idx on fuel_pos (vehicle_id, created_at desc);
create index if not exists fuel_pos_who_idx     on fuel_pos (who, created_at desc);
create index if not exists fuel_pos_created_idx on fuel_pos (created_at desc);

-- cada toque en el app, para tiempos y usuarios en vivo
create table if not exists events (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),
  device_id text,
  who       text,
  app       text not null default 'fuel',       -- fuel | pedidos
  event     text not null,                      -- open | step | po_created | error
  step      integer,
  meta      jsonb
);
create index if not exists events_ts_idx on events (ts desc);

-- ---------- funciones que llama el teléfono ----------
-- lo último que se sabe de un vehículo, sin exponer el registro entero
create or replace function vehicle_status(vid text)
returns table (last_reading numeric, last_at timestamptz, last_po text, fills_24h integer, fills_7d integer)
language sql security definer set search_path = public as $$
  select
    (select reading    from fuel_pos where vehicle_id = vid order by created_at desc limit 1),
    (select created_at from fuel_pos where vehicle_id = vid order by created_at desc limit 1),
    (select po         from fuel_pos where vehicle_id = vid order by created_at desc limit 1),
    (select count(*)::int from fuel_pos where vehicle_id = vid and created_at > now() - interval '24 hours'),
    (select count(*)::int from fuel_pos where vehicle_id = vid and created_at > now() - interval '7 days');
$$;

-- el rol de esta semana para una persona
create or replace function week_jobsite(p text)
returns text language sql security definer set search_path = public as $$
  select jobsite from roster
   where person = p and week_start <= current_date
   order by week_start desc limit 1;
$$;

-- ---------- seguridad (RLS) ----------
alter table people       enable row level security;
alter table stations     enable row level security;
alter table jobsites     enable row level security;
alter table vehicles     enable row level security;
alter table roster       enable row level security;
alter table office_users enable row level security;
alter table fuel_pos     enable row level security;
alter table events       enable row level security;

create or replace function is_office()
returns boolean language sql stable as $$
  select exists (select 1 from office_users where email = (auth.jwt() ->> 'email'));
$$;

-- catálogos: cualquiera los lee (el app los necesita), solo oficina los cambia
do $$ declare t text; begin
  foreach t in array array['people','stations','jobsites','vehicles','roster'] loop
    execute format('drop policy if exists %I_read on %I',  t, t);
    execute format('create policy %I_read on %I for select using (true)', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('create policy %I_write on %I for all using (is_office()) with check (is_office())', t, t);
  end loop;
end $$;

drop policy if exists office_users_read on office_users;
create policy office_users_read on office_users for select using (is_office());

-- el registro: el campo solo INSERTA; solo la oficina lee, edita o borra
drop policy if exists fuel_insert on fuel_pos;
create policy fuel_insert on fuel_pos for insert with check (true);
drop policy if exists fuel_office on fuel_pos;
create policy fuel_office on fuel_pos for all using (is_office()) with check (is_office());

drop policy if exists events_insert on events;
create policy events_insert on events for insert with check (true);
drop policy if exists events_office on events;
create policy events_office on events for select using (is_office());

grant usage on schema public to anon, authenticated;
grant select on people, stations, jobsites, vehicles, roster to anon, authenticated;
grant insert on fuel_pos, events to anon, authenticated;
grant usage, select on sequence fuel_po_seq to anon, authenticated;
grant select, update, delete on fuel_pos, events to authenticated;
grant all on people, stations, jobsites, vehicles, roster, office_users to authenticated;
grant execute on function vehicle_status(text), week_jobsite(text), is_office() to anon, authenticated;

-- ---------- vista lista para la oficina (con las banderas calculadas) ----------
create or replace view fuel_pos_flagged as
with x as (
  select f.*,
         lag(reading)    over (partition by vehicle_id order by created_at) as prev_reading,
         lag(created_at) over (partition by vehicle_id order by created_at) as prev_at,
         count(*) over (partition by vehicle_id order by created_at range between interval '7 days' preceding and current row) as fills_7d
  from fuel_pos f)
select x.*,
  array_remove(array[
    case when prev_at is not null and created_at - prev_at < interval '24 hours' and tipo <> 'PIPA' then 'Mismo vehículo cargó 2 veces en 24 h' end,
    case when prev_reading is not null and reading < prev_reading then 'Odómetro/horas retrocedieron' end,
    case when tipo = 'CAMIONETA' and prev_reading is not null and reading - prev_reading between 0 and 39 then 'Menos de 40 millas desde la última carga' end,
    case when fills_7d > 4 and tipo <> 'PIPA' then '5+ cargas en 7 días' end,
    case when plate_typed then 'Placa dictada por la persona' end,
    case when jobsite_other then 'Obra escrita a mano' end,
    case when jobsite_week is not null and jobsite <> jobsite_week then 'Obra distinta al rol de la semana' end,
    case when extract(dow from created_at at time zone 'America/Chicago') = 0 then 'Domingo' end,
    case when extract(hour from created_at at time zone 'America/Chicago') not between 5 and 19 then 'Fuera de horario' end
  ], null) as server_flags
from x;
grant select on fuel_pos_flagged to authenticated;

-- =====================================================================
--  DATOS INICIALES (de config.js). Se pueden editar después en la tabla.
-- =====================================================================
insert into stations (code,name,short,color) values
  ('LEOS',  'Leo''s Service Station','LEO''S',  '#F5B800'),
  ('TEXCON','Tex-Con Oil',           'TEX-CON','#1D4ED8')
on conflict (code) do nothing;

insert into office_users (email,name) values
  ('tito@munizcontracting.com','TITO CUETO')
on conflict (email) do nothing;
-- >>> agregar a Claudia con su correo:
-- insert into office_users (email,name) values ('claudia@munizcontracting.com','CLAUDIA TAMAYO');

insert into jobsites (name) values
 ('St Johns Ave'),('Springdale Rd @ Lyons Rd'),('Middle Lake'),('Gonzales Ped Island'),('Mokan Trail'),
 ('Violet Crown Trail'),('Violet Crown Circle C'),('North Lamar Blvd'),('Menchaca Rd'),('Banister Area'),
 ('Rundberg Rd'),('Rundberg Rd @ Mearns Meadows'),('RBJ Health Center'),('CapMetro'),('Burnet Rd'),
 ('Cameron Rd'),('Niels Thompson Dr @ Longhorn Blvd'),('Manor Rd'),('North Cross Dr'),('Mesa Dr'),
 ('Duval Rd'),('Metro Center Dr'),('Pleasant Valley Ph1'),('E 12th St @ Chestnut Ave'),('CAUDI'),
 ('West 12th St'),('Howard Ln'),('Radam Ln & 1st St'),('Middle Fiskville SUP'),('EM Franklin Ave')
on conflict (name) do nothing;
insert into jobsites (name,address) values ('Yarda Muñiz · 7907 S FM 973','7907 South FM 973, Austin, TX 78719')
on conflict (name) do nothing;

insert into people (name,role) values
 ('ALVARO AGUIRRE','MAYORDOMO'),('FRANCISCO AGUIRRE','MAYORDOMO'),('ENRIQUE ALVARADO','MAYORDOMO'),
 ('FRANCISCO BOCANEGRA','MAYORDOMO'),('RUBEN CANO','MAYORDOMO'),('CARLOS DIAZ','MAYORDOMO'),
 ('JULIAN GONZALEZ','MAYORDOMO'),('OMAR ALFREDO HERNANDEZ','MAYORDOMO'),('JOSE GUADALUPE JUAREZ','MAYORDOMO'),
 ('PEDRO LIMON','MAYORDOMO'),('DAVID MOLINA','MAYORDOMO'),('SERGIO NINO','MAYORDOMO'),('DANIEL ORTEGA','MAYORDOMO'),
 ('JUAN PEREZ','MAYORDOMO'),('HERVEY QUINTERO','MAYORDOMO'),('GIOVANNI RODRIGUEZ','MAYORDOMO'),
 ('GERARDO SANCHEZ','MAYORDOMO'),('ISIDRO SANCHEZ','MAYORDOMO'),('RICARDO SANCHEZ','MAYORDOMO'),
 ('VICTOR SANCHEZ','MAYORDOMO'),('DIEGO VAZQUEZ','MAYORDOMO'),('JOSE ZAMARRIPA','MAYORDOMO'),
 ('ISIDRO GARCIA','MAYORDOMO'),('IVAN MUNIZ','MAYORDOMO'),
 ('MIGUEL JUAREZ','SUPERVISOR'),('TACHO HERNANDEZ','SUPERVISOR'),('JOSE LUIS ZAMARRIPA','SUPERVISOR'),
 ('MARTIN GONZALEZ','SUPERVISOR'),('LUPE JUAREZ','SUPERVISOR'),
 ('HECTOR MANZANARES','GERENTE'),('SIMON MARTINEZ','GERENTE'),('MARIO MUNOZ','GERENTE'),
 ('HUGO CARLINO','GERENTE'),('EDUARDO VALENZUELA','GERENTE'),('LUIS PEREZ','GERENTE'),
 ('HECTOR SEGURA','CHOFER'),('ABRAHAM GONZALEZ','CHOFER'),
 ('ULISES LARA','PERSONAL'),('JOSE ANTONIO LICEA','PERSONAL'),('ENRIQUE CHAPA','PERSONAL'),
 ('RAFAEL PEREZ','PERSONAL'),('JOSE DE LA CERDA','PERSONAL'),('JESUS G RODRIGUEZ','PERSONAL'),
 ('FRANCIS ECHEVESTRE','PERSONAL'),('AVISAI JIMENEZ','PERSONAL'),('ROGELIO LOPEZ','PERSONAL'),
 ('ALEJANDRO ESQUIVEL','PERSONAL'),('ANDY HERNANDEZ','PERSONAL'),('MARTIN JUAREZ','PERSONAL'),
 ('JOSE GERARDO GARCIA','PERSONAL'),('MARCELA CASTANEDA','PERSONAL'),('FERNANDO ARELLANO','PERSONAL'),
 ('ALEXANDER ROSALES','PERSONAL'),('URIEL SOTO','PERSONAL'),('BRYAN LOPEZ','PERSONAL'),
 ('JULIO MARTINEZ','PERSONAL'),('PABLO REYNAGA','PERSONAL'),
 ('TITO CUETO','OFICINA'),('CLAUDIA TAMAYO','OFICINA')
on conflict (name) do nothing;

-- FLOTA. La placa va en blanco hasta que la oficina la ponga (Table Editor -> vehicles).
insert into vehicles (id,plate,descr,tipo,comb,assigned_to) values
 ('V-AAG','','Camioneta diésel','CAMIONETA','DIESEL','ALVARO AGUIRRE'),
 ('V-FAG','','Camioneta diésel','CAMIONETA','DIESEL','FRANCISCO AGUIRRE'),
 ('V-EAL','','Camioneta diésel','CAMIONETA','DIESEL','ENRIQUE ALVARADO'),
 ('V-FBO','','Camioneta diésel','CAMIONETA','DIESEL','FRANCISCO BOCANEGRA'),
 ('V-RCA','','Camioneta diésel','CAMIONETA','DIESEL','RUBEN CANO'),
 ('V-CDI','','Camioneta diésel','CAMIONETA','DIESEL','CARLOS DIAZ'),
 ('V-JGO','','Camioneta diésel','CAMIONETA','DIESEL','JULIAN GONZALEZ'),
 ('V-OHE','','Camioneta diésel','CAMIONETA','DIESEL','OMAR ALFREDO HERNANDEZ'),
 ('V-JGJ','','Camioneta diésel','CAMIONETA','DIESEL','JOSE GUADALUPE JUAREZ'),
 ('V-PLI','','Camioneta diésel','CAMIONETA','DIESEL','PEDRO LIMON'),
 ('V-DMO','','Camioneta diésel','CAMIONETA','DIESEL','DAVID MOLINA'),
 ('V-SNI','','Camioneta diésel','CAMIONETA','DIESEL','SERGIO NINO'),
 ('V-DOR','','Camioneta diésel','CAMIONETA','DIESEL','DANIEL ORTEGA'),
 ('V-JPE','','Camioneta diésel','CAMIONETA','DIESEL','JUAN PEREZ'),
 ('V-HQU','','Camioneta diésel','CAMIONETA','DIESEL','HERVEY QUINTERO'),
 ('V-GRO','','Camioneta diésel','CAMIONETA','DIESEL','GIOVANNI RODRIGUEZ'),
 ('V-GSA','','Camioneta diésel','CAMIONETA','DIESEL','GERARDO SANCHEZ'),
 ('V-ISA','','Camioneta diésel','CAMIONETA','DIESEL','ISIDRO SANCHEZ'),
 ('V-RSA','','Camioneta diésel','CAMIONETA','DIESEL','RICARDO SANCHEZ'),
 ('V-VSA','','Camioneta diésel','CAMIONETA','DIESEL','VICTOR SANCHEZ'),
 ('V-DVA','','Camioneta diésel','CAMIONETA','DIESEL','DIEGO VAZQUEZ'),
 ('V-JZA','','Camioneta diésel','CAMIONETA','DIESEL','JOSE ZAMARRIPA'),
 ('V-IGA','','Camioneta diésel','CAMIONETA','DIESEL','ISIDRO GARCIA'),
 ('V-IMU','','Camioneta diésel','CAMIONETA','DIESEL','IVAN MUNIZ'),
 ('V-MJU','','Camioneta gasolina','CAMIONETA','GASOLINA','MIGUEL JUAREZ'),
 ('V-THE','','Camioneta gasolina','CAMIONETA','GASOLINA','TACHO HERNANDEZ'),
 ('V-JLZ','','Camioneta gasolina','CAMIONETA','GASOLINA','JOSE LUIS ZAMARRIPA'),
 ('V-MGO','','Camioneta gasolina','CAMIONETA','GASOLINA','MARTIN GONZALEZ'),
 ('V-LJU','','Camioneta gasolina','CAMIONETA','GASOLINA','LUPE JUAREZ'),
 ('P-HMA','','Camión de combustible','PIPA','DIESEL','HECTOR MANZANARES'),
 ('P-SMA','','Camión de combustible','PIPA','DIESEL','SIMON MARTINEZ'),
 ('P-MMU','','Camión de combustible','PIPA','DIESEL','MARIO MUNOZ'),
 ('P-HCA','','Camión de combustible','PIPA','DIESEL','HUGO CARLINO'),
 ('P-EVA','','Camión de combustible','PIPA','DIESEL','EDUARDO VALENZUELA'),
 ('P-LPE','','Camión de combustible','PIPA','DIESEL','LUIS PEREZ'),
 ('V-HSE','','Camioneta diésel','CAMIONETA','DIESEL','HECTOR SEGURA'),
 ('V-AGO','','Camioneta diésel','CAMIONETA','DIESEL','ABRAHAM GONZALEZ'),
 ('V-ULA','','Camioneta diésel','CAMIONETA','DIESEL','ULISES LARA'),
 ('V-JLI','','Camioneta diésel','CAMIONETA','DIESEL','JOSE ANTONIO LICEA'),
 ('V-ECH','','Camioneta diésel','CAMIONETA','DIESEL','ENRIQUE CHAPA'),
 ('V-RPE','','Camioneta diésel','CAMIONETA','DIESEL','RAFAEL PEREZ'),
 ('V-JCE','','Camioneta diésel','CAMIONETA','DIESEL','JOSE DE LA CERDA'),
 ('V-JRO','','Camioneta diésel','CAMIONETA','DIESEL','JESUS G RODRIGUEZ'),
 ('V-FEC','','Camioneta diésel','CAMIONETA','DIESEL','FRANCIS ECHEVESTRE'),
 ('V-AJI','','Camioneta diésel','CAMIONETA','DIESEL','AVISAI JIMENEZ'),
 ('V-RLO','','Camioneta diésel','CAMIONETA','DIESEL','ROGELIO LOPEZ'),
 ('M-GEN','','Maquinaria (bobcat, rodillo, compactador, generador…)','MAQUINARIA','DIESEL',null),
 ('T-DSL','','Tambo / tanque de DIÉSEL','TAMBO','DIESEL',null),
 ('T-GAS','','Tambo / tanque de GASOLINA','TAMBO','GASOLINA',null)
on conflict (id) do nothing;

-- rol de la semana del 7 de septiembre 2026 (6-Week Lookahead). Cada lunes: nuevas filas.
insert into roster (person,week_start,jobsite) values
 ('ENRIQUE ALVARADO','2026-09-07','St Johns Ave'),('DANIEL ORTEGA','2026-09-07','Springdale Rd @ Lyons Rd'),
 ('RUBEN CANO','2026-09-07','Mokan Trail'),('SERGIO NINO','2026-09-07','Metro Center Dr'),
 ('ISIDRO SANCHEZ','2026-09-07','North Lamar Blvd'),('GERARDO SANCHEZ','2026-09-07','North Lamar Blvd'),
 ('DIEGO VAZQUEZ','2026-09-07','Banister Area'),('FRANCISCO AGUIRRE','2026-09-07','Rundberg Rd'),
 ('VICTOR SANCHEZ','2026-09-07','RBJ Health Center'),('JULIAN GONZALEZ','2026-09-07','CapMetro'),
 ('GIOVANNI RODRIGUEZ','2026-09-07','Burnet Rd'),('OMAR ALFREDO HERNANDEZ','2026-09-07','Rundberg Rd @ Mearns Meadows'),
 ('ISIDRO GARCIA','2026-09-07','Burnet Rd'),('ALVARO AGUIRRE','2026-09-07','Cameron Rd'),
 ('CARLOS DIAZ','2026-09-07','Niels Thompson Dr @ Longhorn Blvd'),('PEDRO LIMON','2026-09-07','North Cross Dr'),
 ('FRANCISCO BOCANEGRA','2026-09-07','Duval Rd'),('JUAN PEREZ','2026-09-07','Pleasant Valley Ph1'),
 ('DAVID MOLINA','2026-09-07','E 12th St @ Chestnut Ave'),('JOSE ZAMARRIPA','2026-09-07','CAUDI'),
 ('HERVEY QUINTERO','2026-09-07','West 12th St'),('JOSE GUADALUPE JUAREZ','2026-09-07','Howard Ln'),
 ('IVAN MUNIZ','2026-09-07','Middle Fiskville SUP')
on conflict (person,week_start) do nothing;

-- listo.
select 'OK · tablas: ' || count(*) from information_schema.tables where table_schema='public';
