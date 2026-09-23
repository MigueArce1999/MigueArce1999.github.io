-- 0055_perfil_propio_sin_local.sql
-- `perfil_local_privado` exigía local_id = fn_local_id(). El super_admin tiene local_id NULL,
-- así que PostgREST devolvía [] al leer su propia fila y el login nunca avanzaba.

drop policy if exists perfil_local_privado on perfil;
create policy perfil_local_privado on perfil as restrictive for all to public
  using (id = auth.uid() or local_id = fn_local_id() or fn_es_super_admin())
  with check (
    id = auth.uid()
    or local_id = coalesce(fn_local_id(), fn_local_publico())
    or fn_es_super_admin()
  );
