-- 0014_rls.sql
-- Row Level Security: la barrera real de permisos vive en Postgres, no en la UI.
-- Convención: lectura amplia donde es catálogo público; escritura de dinero/estado SIEMPRE
-- a través de las funciones SECURITY DEFINER de 0013 (no se otorgan políticas de UPDATE
-- directas sobre reserva/atencion/pago/comision/movimiento_puntos más allá de lo estrictamente
-- necesario para inserts controlados por la propia RLS).
--
-- Un proyecto Supabase ya trae por defecto privilegios base (SELECT/INSERT/UPDATE/DELETE)
-- para anon/authenticated sobre las tablas de `public` (vía ALTER DEFAULT PRIVILEGES del
-- propio setup de la plataforma) y dejar la puerta real en RLS. Se otorgan aquí explícitamente
-- de todos modos para que este esquema no dependa de ese comportamiento implícito de la
-- plataforma y funcione igual en cualquier Postgres compatible.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;

alter table perfil enable row level security;
alter table permiso enable row level security;
alter table cliente enable row level security;
alter table profesional enable row level security;
alter table categoria_servicio enable row level security;
alter table servicio enable row level security;
alter table servicio_profesional enable row level security;
alter table horario_disponibilidad enable row level security;
alter table bloqueo_ausencia enable row level security;
alter table reserva enable row level security;
alter table reserva_evento enable row level security;
alter table atencion enable row level security;
alter table atencion_servicio enable row level security;
alter table pago enable row level security;
alter table regla_comision enable row level security;
alter table comision enable row level security;
alter table liquidacion enable row level security;
alter table liquidacion_detalle enable row level security;
alter table regla_puntos enable row level security;
alter table movimiento_puntos enable row level security;
alter table recompensa enable row level security;
alter table promocion enable row level security;
alter table promocion_servicio enable row level security;
alter table categoria_gasto enable row level security;
alter table gasto enable row level security;
alter table caja_sesion enable row level security;
alter table caja_movimiento enable row level security;
alter table contenido_pagina enable row level security;
alter table contenido_evento enable row level security;
alter table resena enable row level security;
alter table auditoria_log enable row level security;
alter table configuracion_negocio enable row level security;

-- ---------------------------------------------------------------------------
-- Identidad
-- ---------------------------------------------------------------------------

create policy perfil_select_propio_o_admin on perfil for select
  using (id = auth.uid() or fn_es_admin());
create policy perfil_update_propio_o_admin on perfil for update
  using (id = auth.uid() or fn_es_admin());

create policy permiso_select on permiso for select
  using (perfil_id = auth.uid() or fn_es_admin());
create policy permiso_admin_maneja on permiso for all
  using (fn_es_admin()) with check (fn_es_admin());

create policy cliente_select on cliente for select
  using (
    usuario_id = auth.uid()
    or fn_es_admin()
    or fn_tiene_permiso('puede_caja')
    or fn_profesional_atendio_cliente(id)
  );
create policy cliente_insert on cliente for insert
  with check (usuario_id = auth.uid() or fn_es_admin() or fn_rol_actual() = 'empleada');
create policy cliente_update on cliente for update
  using (usuario_id = auth.uid() or fn_es_admin())
  with check (usuario_id = auth.uid() or fn_es_admin());

create policy profesional_select_publico on profesional for select using (true);
create policy profesional_update_propio_o_admin on profesional for update
  using (id = auth.uid() or fn_es_admin());
create policy profesional_admin_inserta on profesional for insert with check (fn_es_admin());

-- ---------------------------------------------------------------------------
-- Catálogo (lectura pública, escritura solo admin)
-- ---------------------------------------------------------------------------

create policy categoria_servicio_select_publico on categoria_servicio for select using (true);
create policy categoria_servicio_admin_escribe on categoria_servicio for all
  using (fn_es_admin()) with check (fn_es_admin());

create policy servicio_select_publico on servicio for select using (true);
create policy servicio_admin_escribe on servicio for all
  using (fn_es_admin()) with check (fn_es_admin());

create policy servicio_profesional_select_publico on servicio_profesional for select using (true);
create policy servicio_profesional_admin_escribe on servicio_profesional for all
  using (fn_es_admin()) with check (fn_es_admin());

-- ---------------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------------

create policy horario_select_publico on horario_disponibilidad for select using (true);
create policy horario_propia_o_admin on horario_disponibilidad for all
  using (profesional_id = auth.uid() or fn_es_admin())
  with check (profesional_id = auth.uid() or fn_es_admin());

create policy bloqueo_select on bloqueo_ausencia for select
  using (profesional_id = auth.uid() or fn_es_admin() or fn_tiene_permiso('puede_ver_agenda_equipo'));
create policy bloqueo_propia_o_admin on bloqueo_ausencia for all
  using (profesional_id = auth.uid() or fn_es_admin())
  with check (profesional_id = auth.uid() or fn_es_admin());

create policy reserva_select on reserva for select
  using (
    fn_es_admin()
    or profesional_id = auth.uid()
    or fn_tiene_permiso('puede_ver_agenda_equipo')
    or fn_es_mi_cliente(cliente_id)
  );
-- Los INSERT/UPDATE de reserva pasan por fn_crear_reserva / fn_reprogramar_reserva / fn_cancelar_reserva
-- (SECURITY DEFINER), así que no se otorgan políticas de escritura directa desde el cliente.

create policy reserva_evento_select on reserva_evento for select
  using (
    fn_es_admin()
    or exists (
      select 1 from reserva r where r.id = reserva_evento.reserva_id
      and (r.profesional_id = auth.uid() or fn_es_mi_cliente(r.cliente_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Atención, pagos (escritura solo vía funciones; select acotado)
-- ---------------------------------------------------------------------------

create policy atencion_select on atencion for select
  using (fn_atencion_visible(id));

create policy atencion_servicio_select on atencion_servicio for select
  using (
    fn_es_admin()
    or fn_tiene_permiso('puede_caja')
    or profesional_id = auth.uid()
    or fn_atencion_visible(atencion_id)
  );

create policy pago_select on pago for select
  using (
    fn_es_admin()
    or fn_tiene_permiso('puede_caja')
    or fn_atencion_visible(atencion_id)
  );

-- ---------------------------------------------------------------------------
-- Comisiones y liquidaciones
-- ---------------------------------------------------------------------------

create policy regla_comision_select on regla_comision for select
  using (fn_es_admin() or profesional_id = auth.uid());
create policy regla_comision_admin_escribe on regla_comision for all
  using (fn_es_admin()) with check (fn_es_admin());

create policy comision_select on comision for select
  using (fn_es_admin() or profesional_id = auth.uid());

create policy liquidacion_select on liquidacion for select
  using (fn_es_admin() or profesional_id = auth.uid());

create policy liquidacion_detalle_select on liquidacion_detalle for select
  using (
    fn_es_admin()
    or exists (select 1 from liquidacion l where l.id = liquidacion_detalle.liquidacion_id and l.profesional_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Fidelización
-- ---------------------------------------------------------------------------

create policy regla_puntos_select_publico on regla_puntos for select using (true);
create policy regla_puntos_admin_escribe on regla_puntos for all
  using (fn_es_admin()) with check (fn_es_admin());

create policy movimiento_puntos_select on movimiento_puntos for select
  using (fn_es_admin() or fn_es_mi_cliente(cliente_id));

create policy recompensa_select_publico on recompensa for select using (true);
create policy recompensa_admin_escribe on recompensa for all
  using (fn_es_admin()) with check (fn_es_admin());

-- ---------------------------------------------------------------------------
-- Promociones (lectura pública, escritura admin)
-- ---------------------------------------------------------------------------

create policy promocion_select_publico on promocion for select using (true);
create policy promocion_admin_escribe on promocion for all
  using (fn_es_admin()) with check (fn_es_admin());
create policy promocion_servicio_select_publico on promocion_servicio for select using (true);
create policy promocion_servicio_admin_escribe on promocion_servicio for all
  using (fn_es_admin()) with check (fn_es_admin());

-- ---------------------------------------------------------------------------
-- Caja y gastos (solo admin / permiso explícito — Fase 2)
-- ---------------------------------------------------------------------------

create policy categoria_gasto_admin on categoria_gasto for all
  using (fn_es_admin()) with check (fn_es_admin());
create policy gasto_admin_o_permiso on gasto for all
  using (fn_es_admin() or fn_tiene_permiso('puede_caja'))
  with check (fn_es_admin() or fn_tiene_permiso('puede_caja'));
create policy caja_sesion_admin_o_permiso on caja_sesion for all
  using (fn_es_admin() or fn_tiene_permiso('puede_caja'))
  with check (fn_es_admin() or fn_tiene_permiso('puede_caja'));
create policy caja_movimiento_admin_o_permiso on caja_movimiento for all
  using (fn_es_admin() or fn_tiene_permiso('puede_caja'))
  with check (fn_es_admin() or fn_tiene_permiso('puede_caja'));

-- ---------------------------------------------------------------------------
-- Contenido web (lectura pública, escritura admin)
-- ---------------------------------------------------------------------------

create policy contenido_pagina_select_publico on contenido_pagina for select using (true);
create policy contenido_pagina_admin_escribe on contenido_pagina for all
  using (fn_es_admin()) with check (fn_es_admin());
create policy contenido_evento_select_publico on contenido_evento for select using (true);
create policy contenido_evento_admin_escribe on contenido_evento for all
  using (fn_es_admin()) with check (fn_es_admin());
create policy resena_select_publico on resena for select using (visible or fn_es_admin());
create policy resena_admin_escribe on resena for all
  using (fn_es_admin()) with check (fn_es_admin());

-- ---------------------------------------------------------------------------
-- Auditoría y configuración
-- ---------------------------------------------------------------------------

create policy auditoria_log_admin_select on auditoria_log for select using (fn_es_admin());

create policy configuracion_select_publico on configuracion_negocio for select using (true);
create policy configuracion_admin_escribe on configuracion_negocio for update
  using (fn_es_admin()) with check (fn_es_admin());
