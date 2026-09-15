-- 0005_atencion_pagos.sql
-- Servicios efectivamente realizados y dinero recibido.

create table atencion (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid references reserva (id) on delete set null, -- null = atención sin cita
  cliente_id uuid not null references cliente (id) on delete restrict,
  estado estado_atencion not null default 'en_progreso',
  notas text,
  idempotency_key text unique, -- evita duplicar "completar y cobrar" ante reintentos de red
  creado_por uuid references perfil (id),
  creado_en timestamptz not null default now(),
  completado_en timestamptz
);

create index atencion_cliente_idx on atencion (cliente_id);
create index atencion_reserva_idx on atencion (reserva_id);

create table atencion_servicio (
  id uuid primary key default gen_random_uuid(),
  atencion_id uuid not null references atencion (id) on delete cascade,
  servicio_id uuid not null references servicio (id) on delete restrict,
  profesional_id uuid not null references profesional (id) on delete restrict,
  nombre_snapshot text not null,
  precio_snapshot numeric(12, 2) not null check (precio_snapshot >= 0),
  descuento numeric(12, 2) not null default 0 check (descuento >= 0),
  cantidad int not null default 1 check (cantidad > 0)
);

create index atencion_servicio_atencion_idx on atencion_servicio (atencion_id);
create index atencion_servicio_profesional_idx on atencion_servicio (profesional_id);

create table pago (
  id uuid primary key default gen_random_uuid(),
  atencion_id uuid not null references atencion (id) on delete restrict,
  metodo metodo_pago not null,
  monto numeric(12, 2) not null, -- negativo = devolución
  referencia_pago_id uuid references pago (id), -- vincula una devolución con su pago original
  registrado_por uuid references perfil (id),
  creado_en timestamptz not null default now()
);

create index pago_atencion_idx on pago (atencion_id);
