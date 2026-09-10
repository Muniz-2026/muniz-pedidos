-- =====================================================================
--  MUÑIZ · PARCHE 1  ·  create_fuel_po()
--  Pegar en Supabase -> SQL Editor -> New query -> RUN.
--  Se puede correr varias veces sin problema.
--
--  POR QUE: el telefono necesita (a) guardar el PO y (b) recibir el numero
--  de vuelta. Un INSERT normal con "devolver el renglon" exige permiso de
--  LECTURA sobre la tabla, y el campo NUNCA debe poder leer el registro.
--  Esta funcion resuelve las dos cosas: guarda y devuelve SOLO el numero.
-- =====================================================================

create or replace function create_fuel_po(payload jsonb)
returns table (po text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  text := nullif(payload->>'vehicle_id','');
  v_veh vehicles;
  v_read numeric := nullif(payload->>'reading','')::numeric;
  v_prev numeric;
  v_new  fuel_pos;
begin
  -- el vehiculo tiene que existir en la flota
  select * into v_veh from vehicles where id = v_id and active;
  if not found then
    raise exception 'Vehículo no está en la flota: %', coalesce(v_id,'(vacío)');
  end if;

  -- la obra tiene que ser una obra real (o texto libre marcado como "otra")
  if coalesce((payload->>'jobsite_other')::boolean,false) = false
     and not exists (select 1 from jobsites where name = payload->>'jobsite') then
    raise exception 'Obra desconocida: %', payload->>'jobsite';
  end if;

  -- la lectura no puede ir para atras (la verdad vive aqui, no en el telefono)
  if v_read is not null then
    select reading into v_prev from fuel_pos
     where vehicle_id = v_id and reading is not null
     order by created_at desc limit 1;
    if v_prev is not null and v_read < v_prev then
      raise exception 'La lectura (%) es menor que la última registrada (%)', v_read, v_prev;
    end if;
  end if;

  -- idempotente: si el telefono reintenta, devuelve el mismo PO
  if payload ? 'client_ref' then
    select * into v_new from fuel_pos where client_ref = payload->>'client_ref';
    if found then
      return query select v_new.po, v_new.created_at;
      return;
    end if;
  end if;

  -- el TIPO DE COMBUSTIBLE lo pone la flota, jamas el telefono
  insert into fuel_pos (
    client_ref, device_id, who, role, vehicle_id, vehicle_desc, tipo, comb,
    plate, plate_typed, equipo, reading, jobsite, jobsite_other, jobsite_week,
    station, flags, seconds_to_po)
  values (
    nullif(payload->>'client_ref',''), nullif(payload->>'device_id',''),
    upper(trim(payload->>'who')), nullif(payload->>'role',''),
    v_veh.id, v_veh.descr, v_veh.tipo, v_veh.comb,
    coalesce(nullif(payload->>'plate',''), nullif(v_veh.plate,'')),
    coalesce((payload->>'plate_typed')::boolean,false),
    nullif(payload->>'equipo',''), v_read,
    payload->>'jobsite', coalesce((payload->>'jobsite_other')::boolean,false),
    nullif(payload->>'jobsite_week',''),
    payload->>'station',
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(payload->'flags','[]'::jsonb)) x), '{}'),
    nullif(payload->>'seconds_to_po','')::int)
  returning * into v_new;

  return query select v_new.po, v_new.created_at;
end $$;

revoke all on function create_fuel_po(jsonb) from public;
grant execute on function create_fuel_po(jsonb) to anon, authenticated;

-- el campo ya no necesita INSERT directo: todo pasa por la funcion
revoke insert on fuel_pos from anon;
drop policy if exists fuel_insert on fuel_pos;

select 'OK · create_fuel_po lista' as status;
