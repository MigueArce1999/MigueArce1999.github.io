-- 0012_configuracion.sql
-- Fila única de configuración del negocio.

create table configuracion_negocio (
  id boolean primary key default true,
  moneda text not null default 'COP',
  zona_horaria text not null default 'America/Bogota',
  modo_confirmacion modo_confirmacion_reserva not null default 'automatica',
  reserva_pendiente_expira_minutos int not null default 30,
  cancelacion_horas_limite int not null default 2,
  tasa_puntos_por_defecto numeric(8, 4) not null default 0.02, -- ejemplo: 2% del valor pagado en puntos
  actualizado_en timestamptz not null default now(),
  constraint configuracion_negocio_singleton check (id)
);

insert into configuracion_negocio (id) values (true);

-- Denormalizados de cliente, mantenidos por trigger (nunca editados a mano desde el frontend).
alter table cliente add column visitas_completadas int not null default 0;
alter table cliente add column gasto_acumulado numeric(12, 2) not null default 0;

create or replace function fn_actualizar_contadores_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  select cliente_id into v_cliente_id from atencion where id = new.atencion_id;

  update cliente
  set gasto_acumulado = gasto_acumulado + new.monto
  where id = v_cliente_id;

  return new;
end;
$$;

create trigger actualizar_contadores_cliente_on_pago
  after insert on pago
  for each row execute function fn_actualizar_contadores_cliente();

create or replace function fn_marcar_visita_completada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'completada' and old.estado is distinct from 'completada' then
    update cliente set visitas_completadas = visitas_completadas + 1 where id = new.cliente_id;
  end if;
  return new;
end;
$$;

create trigger marcar_visita_completada_on_atencion
  after update on atencion
  for each row execute function fn_marcar_visita_completada();
