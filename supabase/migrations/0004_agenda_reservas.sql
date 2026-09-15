-- 0004_agenda_reservas.sql
-- Disponibilidad recurrente, bloqueos puntuales y reservas (con protección anti-solapamiento real).

create table horario_disponibilidad (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references profesional (id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6), -- 0 = domingo, como Postgres EXTRACT(DOW)
  hora_inicio time not null,
  hora_fin time not null,
  activo boolean not null default true,
  constraint horario_valido check (hora_fin > hora_inicio)
);

create index horario_disponibilidad_prof_idx on horario_disponibilidad (profesional_id, dia_semana);

create table bloqueo_ausencia (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references profesional (id) on delete cascade,
  rango tstzrange not null,
  motivo text,
  creado_por uuid references perfil (id),
  creado_en timestamptz not null default now(),
  exclude using gist (profesional_id with =, rango with &&)
);

create table reserva (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references cliente (id) on delete restrict,
  servicio_id uuid not null references servicio (id) on delete restrict,
  profesional_id uuid not null references profesional (id) on delete restrict,
  rango tstzrange not null,
  precio_estimado numeric(12, 2),
  estado estado_reserva not null default 'confirmada',
  origen origen_reserva not null default 'cliente',
  notas text,
  creado_por uuid references perfil (id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Núcleo de la garantía "dos clientes no pueden confirmar el mismo horario con la misma profesional":
  -- Postgres rechaza la transacción que llega segunda, incluso si ambas pasaron la validación de UI.
  exclude using gist (
    profesional_id with =,
    rango with &&
  ) where (estado not in ('cancelada', 'no_asistio'))
);

create index reserva_cliente_idx on reserva (cliente_id);
create index reserva_profesional_idx on reserva (profesional_id);
create index reserva_estado_idx on reserva (estado);
create index reserva_rango_idx on reserva using gist (rango);

create table reserva_evento (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references reserva (id) on delete cascade,
  tipo tipo_evento_reserva not null,
  usuario_id uuid references perfil (id),
  valor_anterior jsonb,
  valor_nuevo jsonb,
  motivo text,
  creado_en timestamptz not null default now()
);

create index reserva_evento_reserva_idx on reserva_evento (reserva_id);
