-- 0009_caja_gastos.sql
-- Esquema reservado para Fase 2 (caja y gastos). Se crea ahora para que el modelo de datos
-- esté completo desde el inicio, pero no tiene pantallas en la Fase 1.

create table categoria_gasto (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activa boolean not null default true
);

create table gasto (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references categoria_gasto (id) on delete restrict,
  fecha date not null default current_date,
  monto numeric(12, 2) not null check (monto > 0),
  descripcion text,
  registrado_por uuid not null references perfil (id),
  creado_en timestamptz not null default now()
);

create index gasto_fecha_idx on gasto (fecha);

create table caja_sesion (
  id uuid primary key default gen_random_uuid(),
  abierta_por uuid not null references perfil (id),
  cerrada_por uuid references perfil (id),
  saldo_inicial numeric(12, 2) not null default 0,
  saldo_esperado numeric(12, 2),
  saldo_contado numeric(12, 2),
  diferencia numeric(12, 2) generated always as (saldo_contado - saldo_esperado) stored,
  abierta_en timestamptz not null default now(),
  cerrada_en timestamptz
);

create table caja_movimiento (
  id uuid primary key default gen_random_uuid(),
  caja_sesion_id uuid not null references caja_sesion (id) on delete cascade,
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  monto numeric(12, 2) not null check (monto > 0),
  concepto text not null,
  pago_id uuid references pago (id),
  creado_en timestamptz not null default now()
);
