-- 0007_puntos.sql
-- Fidelización: reglas versionadas, movimientos (nunca un saldo editable) y recompensas.

create table regla_puntos (
  id uuid primary key default gen_random_uuid(),
  tasa numeric(8, 4) not null check (tasa >= 0), -- puntos otorgados por cada peso pagado
  vigencia_dias int, -- null = los puntos no vencen
  vigente_desde timestamptz not null default now(),
  vigente_hasta timestamptz,
  activa boolean not null default true,
  constraint regla_puntos_rango_valido check (vigente_hasta is null or vigente_hasta > vigente_desde)
);

create unique index regla_puntos_vigente_unica_idx on regla_puntos (activa) where vigente_hasta is null and activa;

create table movimiento_puntos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references cliente (id) on delete cascade,
  tipo tipo_movimiento_puntos not null,
  puntos numeric(12, 2) not null, -- positivo o negativo; el saldo es SUM(puntos)
  referencia_tipo text, -- 'atencion' | 'canje' | 'ajuste_manual'
  referencia_id uuid,
  motivo text, -- obligatorio para 'ajuste' (validado en la función, no aquí, para poder dar mensaje claro)
  creado_por uuid references perfil (id),
  creado_en timestamptz not null default now(),
  constraint movimiento_puntos_motivo_ajuste check (tipo <> 'ajuste' or motivo is not null)
);

create index movimiento_puntos_cliente_idx on movimiento_puntos (cliente_id);

create table recompensa (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  costo_puntos numeric(12, 2) not null check (costo_puntos > 0),
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);
