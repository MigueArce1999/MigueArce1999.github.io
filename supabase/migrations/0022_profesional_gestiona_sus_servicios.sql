-- 0022_profesional_gestiona_sus_servicios.sql
-- Antes solo admin podía escribir en servicio_profesional (qué servicios realiza cada
-- profesional): servicio_profesional_admin_escribe usa "for all using (fn_es_admin())". Se
-- pidió que cada empleada pueda gestionar (agregar/quitar) sus propios servicios desde su
-- Perfil, sin depender de que administración lo haga por ella.
--
-- Se agrega una policy PERMISIVA adicional (no reemplaza la de admin: en Postgres, varias
-- policies permisivas para el mismo comando se combinan con OR) que solo le permite tocar
-- filas de su propio profesional_id — nunca las de otra persona.
create policy servicio_profesional_propia_escribe on servicio_profesional for all
  using (profesional_id = auth.uid())
  with check (profesional_id = auth.uid());
