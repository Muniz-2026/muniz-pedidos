-- =====================================================================
--  MUÑIZ · PARCHE 3  ·  arregla la recursión en is_office()
--
--  ERROR QUE CORRIGE:
--    {"code":"54001", ... "Increase the configuration parameter
--     max_stack_depth"}   (stack depth limit exceeded)
--
--  CAUSA: la funcion is_office() lee la tabla office_users. Pero la
--  regla de lectura de office_users decia "solo si is_office()".
--  Entonces: leer office_users -> llama is_office() -> lee office_users
--  -> llama is_office() ... hasta que Postgres se queda sin pila.
--
--  ARREGLO: is_office() pasa a ser SECURITY DEFINER. Asi corre con los
--  permisos del dueño de la funcion y NO vuelve a pasar por las reglas
--  de la tabla. Se rompe el circulo. Sigue siendo seguro: la funcion
--  solo responde si/no sobre el correo de quien esta entrando.
--
--  Pegar en Supabase -> SQL Editor -> New query -> RUN.
--  Se puede correr varias veces sin problema.
-- =====================================================================

create or replace function is_office()
returns boolean
language sql
stable
security definer                      -- <<< esto es lo que rompe la recursión
set search_path = public
as $$
  select exists (
    select 1 from office_users ou
     where lower(ou.email) = lower(coalesce(auth.jwt() ->> 'email',''))
  );
$$;

revoke all on function is_office() from public;
grant execute on function is_office() to anon, authenticated;

-- la tabla office_users se lee con la funcion (que ya no recursa)
drop policy if exists office_users_read on office_users;
create policy office_users_read on office_users for select using (is_office());

-- ---------------------------------------------------------------------
--  PRUEBA: is_office() debe responder sin trabarse.
--  Sin sesion devuelve false (no hay correo en el token) — eso es lo
--  correcto. Lo que importa es que RESPONDA en vez de tronar.
-- ---------------------------------------------------------------------
do $$
declare r boolean; n int;
begin
  select is_office() into r;                       -- si recursara, aqui tronaba
  raise notice 'PRUEBA 1/2 OK · is_office() respondió: %', r;
  select count(*) into n from office_users;        -- lectura directa (dueño)
  raise notice 'PRUEBA 2/2 OK · office_users tiene % correo(s)', n;
  if n = 0 then
    raise notice 'AVISO: no hay correos en office_users. Nadie podrá entrar al centro de mando.';
    raise notice 'Agrega el tuyo:  insert into office_users (email,name) values (''tu@correo'',''TU NOMBRE'');';
  end if;
end $$;

select 'OK · is_office() arreglada' as status, count(*) as correos_de_oficina from office_users;
