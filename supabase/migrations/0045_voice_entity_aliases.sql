-- 0045_voice_entity_aliases.sql
-- Alias de voz: "blower"/"blover"/"secado" deben resolver al mismo servicio; "amino"/"aminoácidos"
-- al mismo tratamiento. Se consultan ANTES del fuzzy matching (sección 7 del pedido) — un alias
-- confirmado es más confiable que una coincidencia aproximada por similitud de texto.
-- No se guarda nada aquí automáticamente: esta tabla solo se llena por seed manual o, en el
-- futuro, cuando una persona confirma explícitamente una corrección que vale la pena recordar
-- (el código está preparado para eso — ver EntityResolver.ts — pero ninguna ruta actual escribe
-- aquí sin que un humano lo haya confirmado primero).
create type voice_entity_type as enum ('client', 'service', 'employee', 'product');

create table voice_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_type voice_entity_type not null,
  entity_id uuid not null,
  alias text not null,
  normalized_alias text not null,
  usage_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index voice_entity_aliases_unicidad_idx
  on voice_entity_aliases (entity_type, normalized_alias);
create index voice_entity_aliases_entity_idx
  on voice_entity_aliases (entity_type, entity_id);
create index voice_entity_aliases_normalized_trgm_idx
  on voice_entity_aliases using gin (normalized_alias gin_trgm_ops);

alter table voice_entity_aliases enable row level security;

-- Cualquier persona del equipo puede LEER alias (los necesita para resolver lo que dictó), pero
-- solo admin/empleada pueden escribir — nunca un cliente ni un usuario anónimo. No hay política
-- para clientes ni anon: sin fila en `perfil` con rol admin/empleada, fn_rol_actual() da NULL y
-- ambas políticas de abajo lo bloquean.
create policy voice_entity_aliases_select on voice_entity_aliases for select
  using (fn_rol_actual() in ('admin', 'empleada'));
create policy voice_entity_aliases_escribe on voice_entity_aliases for all
  using (fn_rol_actual() in ('admin', 'empleada'))
  with check (fn_rol_actual() in ('admin', 'empleada'));

grant select, insert, update, delete on voice_entity_aliases to authenticated;

-- Semilla: ejemplos reales del pedido — variantes fonéticas/de transcripción de "Blower" (si
-- existe en el catálogo de este salón) y un ejemplo de "aminoácidos" para cuando exista un
-- servicio con ese nombre. Se inserta condicionalmente: si el servicio todavía no existe en
-- este salón en particular, no se crea un alias apuntando a nada.
do $$
declare
  v_blower_id uuid;
begin
  select id into v_blower_id from servicio where lower(nombre) = 'blower' limit 1;
  if v_blower_id is not null then
    insert into voice_entity_aliases (entity_type, entity_id, alias, normalized_alias) values
      ('service', v_blower_id, 'blover', 'blover'),
      ('service', v_blower_id, 'blouer', 'blouer'),
      ('service', v_blower_id, 'blow', 'blow'),
      ('service', v_blower_id, 'secado', 'secado')
    on conflict (entity_type, normalized_alias) do nothing;
  end if;
end $$;

-- Función de búsqueda de alias: se usa ANTES del fuzzy — devuelve el entity_id si hay un alias
-- exacto (normalizado) para ese tipo de entidad, y de paso incrementa usage_count para poder
-- ver más adelante qué alias se usan de verdad.
create or replace function fn_buscar_alias_voz(p_entity_type voice_entity_type, p_texto_normalizado text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entity_id uuid;
begin
  update voice_entity_aliases
  set usage_count = usage_count + 1, updated_at = now()
  where entity_type = p_entity_type and normalized_alias = p_texto_normalizado
  returning entity_id into v_entity_id;
  return v_entity_id;
end;
$$;

grant execute on function fn_buscar_alias_voz to authenticated;
