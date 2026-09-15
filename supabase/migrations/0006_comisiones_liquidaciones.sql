-- 0006_comisiones_liquidaciones.sql
-- Reglas de comisión versionadas + comisiones generadas + liquidaciones (pago a la profesional).

create table regla_comision (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references profesional (id) on delete cascade,
  servicio_id uuid references servicio (id) on delete cascade, -- null = regla general de la profesional
  tipo tipo_valor_comision not null,
  valor numeric(12, 2) not null check (valor >= 0),
  vigente_desde timestamptz not null default now(),
  vigente_hasta timestamptz, -- null = vigente
  creado_por uuid references perfil (id),
  constraint regla_comision_rango_valido check (vigente_hasta is null or vigente_hasta > vigente_desde)
);

-- Solo una regla vigente (vigente_hasta null) por combinación profesional+servicio.
create unique index regla_comision_vigente_unica_idx
  on regla_comision (profesional_id, coalesce(servicio_id, '00000000-0000-0000-0000-000000000000'))
  where vigente_hasta is null;

create table comision (
  id uuid primary key default gen_random_uuid(),
  atencion_servicio_id uuid not null references atencion_servicio (id) on delete restrict,
  profesional_id uuid not null references profesional (id) on delete restrict,
  regla_aplicada jsonb not null, -- snapshot: cambios futuros a regla_comision no alteran esto
  base_calculo numeric(12, 2) not null,
  valor numeric(12, 2) not null, -- negativo = reversión por devolución
  estado estado_comision not null default 'generada',
  referencia_devolucion_id uuid references comision (id),
  creado_en timestamptz not null default now()
);

create index comision_profesional_idx on comision (profesional_id, estado);
create index comision_atencion_servicio_idx on comision (atencion_servicio_id);

create table liquidacion (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references profesional (id) on delete restrict,
  periodo_inicio date not null,
  periodo_fin date not null,
  importe_total numeric(12, 2) not null,
  responsable_id uuid not null references perfil (id),
  creado_en timestamptz not null default now(),
  constraint liquidacion_periodo_valido check (periodo_fin >= periodo_inicio)
);

create table liquidacion_detalle (
  liquidacion_id uuid not null references liquidacion (id) on delete cascade,
  comision_id uuid not null unique references comision (id) on delete restrict, -- unique = nunca se liquida 2 veces
  primary key (liquidacion_id, comision_id)
);
