-- =====================================================================
--  MUÑIZ · PARCHE 2  ·  arregla  create_fuel_po()
--  Error que corrige:  column reference "created_at" is ambiguous
--
--  CAUSA: la funcion devuelve una columna llamada "created_at" y adentro
--  hacia "order by created_at". Postgres no sabia si te referias a la
--  columna de la tabla o al valor que devuelve la funcion.
--  ARREGLO: se le dice explicitamente que las referencias sueltas son
--  COLUMNAS (#variable_conflict use_column) y ademas se califica cada
--  columna con el nombre de su tabla (fuel_pos.created_at).
--
--  Pegar en Supabase -> SQL Editor -> New query -> RUN.
--  Se puede correr varias veces sin problema.
-- =====================================================================

create or replace function create_fuel_po(payload jsonb)
returns table (po text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_id    text := nullif(payload->>'vehicle_id','');
  v_veh   vehicles;
  v_read  numeric := nullif(payload->>'reading','')::numeric;
  v_prev  numeric;
  v_new   fuel_pos;
  v_found fuel_pos;
begin
  -- 1) el vehiculo tiene que existir en la flota
  select v.* into v_veh from vehicles v where v.id = v_id and v.active;
  if not found then
    raise exception 'Vehículo no está en la flota: %', coalesce(v_id,'(vacío)');
  end if;

  -- 2) la obra tiene que ser una obra real (o texto libre marcado como "otra")
  if coalesce((payload->>'jobsite_other')::boolean,false) = false
     and not exists (select 1 from jobsites j where j.name = payload->>'jobsite') then
    raise exception 'Obra desconocida: %', coalesce(payload->>'jobsite','(vacío)');
  end if;

  -- 3) la lectura no puede ir para atras (la verdad vive aqui, no en el telefono)
  if v_read is not null then
    select f.reading into v_prev
      from fuel_pos f
     where f.vehicle_id = v_id
       and f.reading is not null
     order by f.created_at desc
     limit 1;
    if v_prev is not null and v_read < v_prev then
      raise exception 'La lectura (%) es menor que la última registrada (%)', v_read, v_prev;
    end if;
  end if;

  -- 4) idempotente: si el telefono reintenta, devuelve el MISMO PO
  if coalesce(payload->>'client_ref','') <> '' then
    select f.* into v_found from fuel_pos f where f.client_ref = payload->>'client_ref';
    if found then
      return query select v_found.po, v_found.created_at;
      return;
    end if;
  end if;

  -- 5) guardar. El TIPO DE COMBUSTIBLE lo pone la flota, jamas el telefono.
  insert into fuel_pos (
    client_ref, device_id, who, role, vehicle_id, vehicle_desc, tipo, comb,
    plate, plate_typed, equipo, reading, jobsite, jobsite_other, jobsite_week,
    station, flags, seconds_to_po)
  values (
    nullif(payload->>'client_ref',''),
    nullif(payload->>'device_id',''),
    upper(trim(coalesce(payload->>'who',''))),
    nullif(payload->>'role',''),
    v_veh.id, v_veh.descr, v_veh.tipo, v_veh.comb,
    coalesce(nullif(payload->>'plate',''), nullif(v_veh.plate,'')),
    coalesce((payload->>'plate_typed')::boolean,false),
    nullif(payload->>'equipo',''),
    v_read,
    payload->>'jobsite',
    coalesce((payload->>'jobsite_other')::boolean,false),
    nullif(payload->>'jobsite_week',''),
    payload->>'station',
    coalesce((select array_agg(t.x) from jsonb_array_elements_text(coalesce(payload->'flags','[]'::jsonb)) as t(x)), '{}'),
    nullif(payload->>'seconds_to_po','')::int)
  returning fuel_pos.* into v_new;

  return query select v_new.po, v_new.created_at;
end $$;

revoke all on function create_fuel_po(jsonb) from public;
grant execute on function create_fuel_po(jsonb) to anon, authenticated;

-- el campo nunca inserta directo: todo pasa por la funcion
revoke insert on fuel_pos from anon;
drop policy if exists fuel_insert on fuel_pos;

-- ---------------------------------------------------------------------
--  PRUEBA AUTOMATICA: registra un PO de prueba, revisa las 3 reglas,
--  y BORRA todo lo de prueba. No consume el numero F1001 real.
-- ---------------------------------------------------------------------
do $$
declare
  r     record;
  v_ok  boolean;
  v_veh text;
  v_job text;
  v_po  text;
begin
  select v.id into v_veh from vehicles v where v.tipo = 'CAMIONETA' and v.active limit 1;
  select j.name into v_job from jobsites j where j.active limit 1;
  if v_veh is null or v_job is null then
    raise notice 'PRUEBA OMITIDA: falta flota u obras'; return;
  end if;

  -- a) registra
  select * into r from create_fuel_po(jsonb_build_object(
    'client_ref','__test__','vehicle_id',v_veh,'who','PRUEBA','jobsite',v_job,
    'station','LEOS','reading',999999,'seconds_to_po',1,'flags','[]'::jsonb));
  v_po := r.po;
  raise notice 'PRUEBA 1/4 OK · se registro %', v_po;

  -- b) idempotente
  select * into r from create_fuel_po(jsonb_build_object(
    'client_ref','__test__','vehicle_id',v_veh,'who','PRUEBA','jobsite',v_job,
    'station','LEOS','reading',999999));
  if r.po = v_po then raise notice 'PRUEBA 2/4 OK · reintento devuelve el mismo PO';
  else raise exception 'FALLO: el reintento creo otro PO (% vs %)', r.po, v_po; end if;

  -- c) lectura menor debe fallar
  v_ok := false;
  begin
    perform create_fuel_po(jsonb_build_object(
      'client_ref','__test2__','vehicle_id',v_veh,'who','PRUEBA','jobsite',v_job,
      'station','LEOS','reading',1));
  exception when others then v_ok := true;
  end;
  if v_ok then raise notice 'PRUEBA 3/4 OK · lectura menor rechazada';
  else raise exception 'FALLO: acepto una lectura menor'; end if;

  -- d) obra inventada debe fallar
  v_ok := false;
  begin
    perform create_fuel_po(jsonb_build_object(
      'client_ref','__test3__','vehicle_id',v_veh,'who','PRUEBA','jobsite','ADA 33',
      'station','LEOS','reading',1000000));
  exception when others then v_ok := true;
  end;
  if v_ok then raise notice 'PRUEBA 4/4 OK · numero de contrato rechazado como obra';
  else raise exception 'FALLO: acepto ADA 33 como obra'; end if;

  -- limpiar
  delete from fuel_pos where client_ref like '\_\_test%';
  raise notice 'PRUEBAS LIMPIADAS · la funcion quedo lista';
end $$;

select 'OK · create_fuel_po arreglada y probada' as status;
