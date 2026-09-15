-- 0011_auditoria.sql

create table auditoria_log (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id uuid not null,
  accion text not null, -- 'insert' | 'update' | 'delete'
  usuario_id uuid references perfil (id),
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  creado_en timestamptz not null default now()
);

create index auditoria_log_tabla_registro_idx on auditoria_log (tabla, registro_id);

create or replace function fn_auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into auditoria_log (tabla, registro_id, accion, usuario_id, datos_anteriores, datos_nuevos)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('update', 'delete') then to_jsonb(old) else null end,
    case when tg_op in ('update', 'insert') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger auditar_reserva after update or delete on reserva
  for each row execute function fn_auditar_cambio();
create trigger auditar_atencion after update or delete on atencion
  for each row execute function fn_auditar_cambio();
create trigger auditar_pago after update or delete on pago
  for each row execute function fn_auditar_cambio();
create trigger auditar_comision after update or delete on comision
  for each row execute function fn_auditar_cambio();
create trigger auditar_movimiento_puntos after update or delete on movimiento_puntos
  for each row execute function fn_auditar_cambio();
create trigger auditar_regla_comision after update or delete on regla_comision
  for each row execute function fn_auditar_cambio();
