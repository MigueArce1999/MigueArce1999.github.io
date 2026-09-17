-- 0024_registro_publico_y_campanas.sql
-- Soporta: (a) un formulario público de registro de clientes por QR/enlace, sin sesión, y
-- (b) campañas de WhatsApp por enlace wa.me (no hay ninguna API oficial de WhatsApp Business
-- configurada en este proyecto, así que no se simula un envío masivo automático).

-- --- cliente: estado activo/archivado (mismo patrón boolean que profesional.activo y
-- servicio.activo, no un enum nuevo) + trazabilidad de origen y consentimiento de marketing.
alter table cliente add column activo boolean not null default true;
alter table cliente add column origen_registro text not null default 'admin'
  check (origen_registro in ('admin', 'publico'));
alter table cliente add column consentimiento_marketing_fecha timestamptz;
alter table cliente add column consentimiento_marketing_version text;

-- Reseña en Google: se marca A MANO desde el panel (alguien del salón confirma que la vio),
-- nunca se verifica automáticamente contra la API de Google — el nombre de la columna deja
-- claro que es un registro manual, no una integración real.
alter table cliente add column resena_google_confirmada boolean not null default false;

-- Backfill: todo lo que ya existe se asume registrado por el negocio (admin/recepción), no por
-- el formulario público (que no existía hasta ahora).
update cliente set origen_registro = 'admin' where origen_registro is null;

comment on column cliente.activo is
  'false = archivado. No se borra el cliente (conserva historial de atenciones/comisiones); solo deja de contarse como activo y se puede reactivar.';
comment on column cliente.origen_registro is
  '''admin'' = lo creó el salón desde el panel; ''publico'' = la propia clienta desde el formulario público (QR o enlace).';

-- --- Registro público: security definer porque un visitante anónimo (rol "anon") no tiene
-- fila en perfil ni sesión, así que cliente_insert (0014/0016 RLS) nunca lo dejaría pasar
-- directo contra la tabla. Esta función es la ÚNICA puerta de entrada pública, y decide qué
-- puede y qué no puede hacer un desconocido:
--   - Valida nombre y teléfono en el servidor (nunca confía en la validación del navegador).
--   - Si el teléfono YA existe, no sobrescribe nombre/contacto/consentimiento (no hay forma de
--     verificar que quien llena el formulario es esa misma persona) y NO revela que el
--     teléfono ya estaba registrado: responde igual que un registro nuevo y exitoso, dejando
--     la actualización real para que el personal la haga desde el panel.
--   - Jamás crea una reserva, atención ni venta: solo una fila en "cliente".
create or replace function fn_registrar_cliente_publico(
  p_nombre text,
  p_telefono text,
  p_email text default null,
  p_acepta_marketing boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_telefono text;
  v_solo_digitos text;
  v_existente uuid;
begin
  if p_nombre is null or length(trim(p_nombre)) < 2 then
    raise exception 'Ingresa tu nombre completo.';
  end if;

  v_telefono := regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g');
  v_solo_digitos := regexp_replace(v_telefono, '[^0-9]', '', 'g');
  if length(v_solo_digitos) < 7 then
    raise exception 'Ingresa un número de WhatsApp válido.';
  end if;

  -- Compara por los últimos 10 dígitos para que "3001234567" y "+57 300 123 4567" (con o sin
  -- indicativo de país) se reconozcan como el mismo número.
  select id into v_existente from cliente
  where right(regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g'), 10) = right(v_solo_digitos, 10)
  limit 1;

  if v_existente is not null then
    return;
  end if;

  insert into cliente (
    nombre, telefono, email, consentimiento_marketing, activo, origen_registro,
    consentimiento_marketing_fecha, consentimiento_marketing_version
  ) values (
    trim(p_nombre), v_telefono, nullif(trim(coalesce(p_email, '')), ''),
    coalesce(p_acepta_marketing, false), true, 'publico',
    case when coalesce(p_acepta_marketing, false) then now() else null end,
    case when coalesce(p_acepta_marketing, false) then 'registro-publico-v1' else null end
  );
end;
$$;

-- A diferencia de toda otra función de este proyecto, se otorga también a "anon": quien llena
-- el formulario público NO tiene sesión de Supabase.
grant execute on function fn_registrar_cliente_publico to anon, authenticated;

-- --- Campañas de WhatsApp: solo enlaces wa.me (no hay API de WhatsApp Business configurada).
-- Abrir wa.me NO confirma que el mensaje se envió, así que el estado por destinatario separa
-- "se abrió la conversación" de "el personal marcó que sí lo envió" — nunca se asume enviado.
create type campana_tipo as enum ('general', 'promocional');
create type campana_estado as enum ('borrador', 'lista', 'en_progreso', 'finalizada');
create type destinatario_estado as enum ('pendiente', 'whatsapp_abierto', 'marcado_enviado', 'excluido');

create table campana (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  mensaje text not null,
  tipo campana_tipo not null default 'general',
  estado campana_estado not null default 'borrador',
  creado_por uuid references perfil (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table campana_destinatario (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references campana (id) on delete cascade,
  cliente_id uuid not null references cliente (id) on delete cascade,
  estado destinatario_estado not null default 'pendiente',
  motivo_exclusion text, -- ej. "sin autorización de promociones", "sin teléfono válido"
  actualizado_en timestamptz not null default now(),
  unique (campana_id, cliente_id)
);
create index campana_destinatario_campana_idx on campana_destinatario (campana_id);

alter table campana enable row level security;
alter table campana_destinatario enable row level security;

-- Campañas es una función administrativa (vive bajo /admin, ya protegido en el router); solo
-- admin puede leer/escribir, igual que el resto de configuración sensible de este panel.
create policy campana_admin on campana for all using (fn_es_admin()) with check (fn_es_admin());
create policy campana_destinatario_admin on campana_destinatario for all using (fn_es_admin()) with check (fn_es_admin());

-- --- Resumen real de cliente: visitas_completadas y gasto_acumulado YA existen como columnas
-- reales mantenidas por trigger (0012_configuracion.sql), así que esta vista no las duplica —
-- solo agrega lo que de verdad falta: la FECHA de la última visita y el nombre del último
-- servicio/profesional, para no confundir "cliente creado el..." con "cliente atendido el...".
create view vista_cliente_resumen with (security_invoker = true) as
select
  c.*,
  v.ultima_visita,
  v.ultimo_servicio_nombre,
  v.ultimo_profesional_nombre
from cliente c
left join lateral (
  select
    max(a.completado_en) as ultima_visita,
    (array_agg(ase.nombre_snapshot order by a.completado_en desc nulls last, ase.id))[1] as ultimo_servicio_nombre,
    (array_agg(vp.nombre order by a.completado_en desc nulls last, ase.id))[1] as ultimo_profesional_nombre
  from atencion a
  join atencion_servicio ase on ase.atencion_id = a.id
  left join vista_profesional vp on vp.id = ase.profesional_id
  where a.cliente_id = c.id and a.estado = 'completada'
) v on true;

grant select on vista_cliente_resumen to authenticated;
