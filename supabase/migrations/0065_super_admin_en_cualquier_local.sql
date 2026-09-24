-- 0065_super_admin_en_cualquier_local.sql
-- fn_conceder_super_admin deja rol = super_admin y local_id NULL (no pertenece a un salón).
-- Las políticas restrictivas comparan local_id = fn_local_id(), así que esa cuenta no veía
-- ni sus citas ni su portal en ninguna instalación.
-- En un salón (header x-local-id) el super_admin es clienta de ESA tienda. Sigue sin ser
-- admin del salón: las políticas permisivas no cambian.

create or replace function fn_local_id() returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when rol = 'super_admin' then fn_local_id_request()
    else local_id
  end
  from perfil
  where id = auth.uid()
$$;
