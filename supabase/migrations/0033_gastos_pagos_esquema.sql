-- 0033_gastos_pagos_esquema.sql
-- Módulo "Gastos y pagos": el esquema de 0009_caja_gastos.sql (`categoria_gasto`, `gasto`) se
-- creó como stub de Fase 2 y nunca tuvo pantalla — se amplía in place en vez de reemplazarlo.
-- No se toca `caja_sesion`/`caja_movimiento`: ese stub modela el arqueo de caja por turno
-- (saldo_inicial/saldo_esperado/saldo_contado), un concepto distinto y hoy tampoco usado por
-- ningún flujo (ni siquiera las ventas escriben ahí) — mezclarlo aquí sería forzar una pieza
-- que no encaja. Este módulo introduce en cambio `cuenta`/`cuenta_movimiento`: un libro de
-- saldo corriente por cuenta (caja en efectivo, banco, billetera), que es lo que en realidad
-- necesita "cuenta de origen" del pago de un gasto.
--
-- Tampoco existe ningún módulo de compras/inventario en el proyecto — origen 'compra' queda
-- definido en el enum para cuando exista, pero sin columna de referencia a una tabla que no
-- existe (se agregaría junto con esa integración futura, ver resumen final).

-- ---------------------------------------------------------------------------
-- Cuentas de origen (caja en efectivo, cuentas bancarias, billeteras). Sin cuentas ni saldos
-- inventados: se parte únicamente de "Caja del salón" en efectivo con saldo cero; cualquier
-- cuenta bancaria/billetera real la agrega el propio negocio desde la pantalla.
-- ---------------------------------------------------------------------------
create type tipo_cuenta as enum ('efectivo', 'bancaria', 'billetera');

create table cuenta (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo tipo_cuenta not null,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

insert into cuenta (nombre, tipo) values ('Caja del salón', 'efectivo')
on conflict (nombre) do nothing;

-- Libro de movimientos por cuenta: el saldo de una cuenta siempre se calcula desde aquí (suma
-- de ingresos menos egresos), nunca se guarda un saldo editable que pueda desincronizarse.
create table cuenta_movimiento (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references cuenta (id) on delete restrict,
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  monto numeric(12, 2) not null check (monto > 0),
  concepto text not null,
  creado_en timestamptz not null default now()
);

create index cuenta_movimiento_cuenta_idx on cuenta_movimiento (cuenta_id);

-- ---------------------------------------------------------------------------
-- Proveedor o beneficiario: seleccionable o creable desde el propio formulario de gasto,
-- mismo patrón que ya usa el buscador de clientes.
-- ---------------------------------------------------------------------------
create table proveedor (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create unique index proveedor_nombre_unq_idx on proveedor (lower(nombre));

-- ---------------------------------------------------------------------------
-- Categorías iniciales (idempotente: nunca duplica si ya existen por otro medio).
-- ---------------------------------------------------------------------------
insert into categoria_gasto (nombre)
select nombre from (values
  ('Arriendo'),
  ('Servicios públicos'),
  ('Internet y telefonía'),
  ('Aseo y lavandería'),
  ('Insumos desechables'),
  ('Mantenimiento'),
  ('Publicidad y marketing'),
  ('Software y suscripciones'),
  ('Transporte y domicilios'),
  ('Otros gastos')
) as t(nombre)
where not exists (select 1 from categoria_gasto cg where lower(cg.nombre) = lower(t.nombre));

-- ---------------------------------------------------------------------------
-- Plantillas de gastos recurrentes (creadas antes de `gasto` porque este último referencia la
-- ocurrencia que lo generó).
-- ---------------------------------------------------------------------------
create type frecuencia_recurrencia as enum ('semanal', 'mensual');

create table plantilla_gasto_recurrente (
  id uuid primary key default gen_random_uuid(),
  concepto text not null,
  categoria_id uuid not null references categoria_gasto (id) on delete restrict,
  proveedor_id uuid references proveedor (id) on delete set null,
  valor_total numeric(12, 2) not null check (valor_total > 0),
  frecuencia frecuencia_recurrencia not null,
  primera_fecha_vencimiento date not null,
  fecha_fin date,
  activa boolean not null default true,
  creado_por uuid not null references perfil (id),
  creado_en timestamptz not null default now(),
  constraint plantilla_gasto_fechas_validas check (fecha_fin is null or fecha_fin >= primera_fecha_vencimiento)
);

-- ---------------------------------------------------------------------------
-- Gasto: se amplía la tabla existente. Se renombran dos columnas (monto→valor_total,
-- registrado_por→creado_por) para el vocabulario del módulo y consistencia con el resto del
-- esquema (creado_por ya es el nombre estándar en reserva/atencion/etc.) — sin riesgo de datos:
-- la tabla nunca tuvo pantalla, así que en la práctica no hay filas reales que migrar.
-- ---------------------------------------------------------------------------
alter table gasto rename column monto to valor_total;
alter table gasto rename column registrado_por to creado_por;
alter table gasto rename column descripcion to notas;

alter table gasto add column concepto text not null default '';
alter table gasto alter column concepto drop default;

alter table gasto add column proveedor_id uuid references proveedor (id) on delete set null;
alter table gasto add column referencia text;
alter table gasto add column fecha_vencimiento date;
alter table gasto add column comprobante_path text;

alter table gasto add column origen text not null default 'manual'
  check (origen in ('manual', 'compra', 'liquidacion'));

alter table gasto add column referencia_liquidacion_id uuid references liquidacion (id) on delete restrict;
alter table gasto add column plantilla_id uuid references plantilla_gasto_recurrente (id) on delete set null;

-- Anulación: campo propio (no se deriva de los pagos — un gasto se puede anular incluso sin
-- ningún pago registrado) y nunca se borra la fila, para conservar el historial completo.
alter table gasto add column anulado boolean not null default false;
alter table gasto add column anulado_motivo text;
alter table gasto add column anulado_por uuid references perfil (id);
alter table gasto add column anulado_en timestamptz;

alter table gasto add column actualizado_por uuid references perfil (id);
alter table gasto add column actualizado_en timestamptz not null default now();

-- Clave estable generada una vez por intento de "Guardar gasto" en el navegador: un reintento
-- de red o un doble clic con la MISMA clave nunca crea un segundo gasto (ver fn_crear_gasto).
alter table gasto add column idempotency_key text unique;

create index gasto_categoria_idx on gasto (categoria_id);
create index gasto_proveedor_idx on gasto (proveedor_id);
create index gasto_vencimiento_idx on gasto (fecha_vencimiento);
create index gasto_origen_idx on gasto (origen);

-- Un gasto con origen 'liquidacion' siempre debe traer su referencia (y viceversa): así nunca
-- queda una liquidación "suelta" sin saber a cuál gasto corresponde, ni un gasto marcado como
-- liquidación sin la liquidación real detrás.
alter table gasto add constraint gasto_liquidacion_coherente
  check ((origen = 'liquidacion') = (referencia_liquidacion_id is not null));

-- Solo puede haber un gasto por liquidación (evita que "pagarla" cree una segunda obligación
-- duplicada si alguien vuelve a intentar el enlace — ver fn_manejar_liquidacion_nueva).
create unique index gasto_liquidacion_unq_idx on gasto (referencia_liquidacion_id) where referencia_liquidacion_id is not null;

-- Ocurrencias generadas por una plantilla recurrente: una fila por combinación
-- plantilla+fecha_vencimiento, apuntando al gasto real que produjo — el `unique` es la
-- restricción anti-duplicados que pide la especificación.
create table plantilla_gasto_ocurrencia (
  id uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references plantilla_gasto_recurrente (id) on delete cascade,
  fecha_vencimiento date not null,
  gasto_id uuid not null references gasto (id) on delete restrict,
  creado_en timestamptz not null default now(),
  constraint plantilla_ocurrencia_unica unique (plantilla_id, fecha_vencimiento)
);

-- ---------------------------------------------------------------------------
-- Pagos y reversiones. Varios abonos por gasto; el saldo pagado/pendiente y el estado
-- (pendiente/pago_parcial/pagado) SIEMPRE se calculan desde aquí (ver vista_gasto en 0034) —
-- nunca se guarda un estado editable que permita forzar "Pagado" a mano.
-- ---------------------------------------------------------------------------
create table gasto_pago (
  id uuid primary key default gen_random_uuid(),
  gasto_id uuid not null references gasto (id) on delete restrict,
  importe numeric(12, 2) not null check (importe > 0),
  fecha date not null default current_date,
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  cuenta_id uuid not null references cuenta (id) on delete restrict,
  referencia text,
  registrado_por uuid not null references perfil (id),
  creado_en timestamptz not null default now(),
  -- Clave estable generada una vez por intento de pago en el navegador: un reintento de red o
  -- un doble clic con la MISMA clave nunca crea un segundo pago (ver fn_registrar_pago_gasto).
  idempotency_key text unique
);

create index gasto_pago_gasto_idx on gasto_pago (gasto_id);

create table gasto_pago_reversion (
  id uuid primary key default gen_random_uuid(),
  gasto_pago_id uuid not null references gasto_pago (id) on delete restrict,
  importe numeric(12, 2) not null check (importe > 0),
  motivo text not null,
  registrado_por uuid not null references perfil (id),
  creado_en timestamptz not null default now()
);

create index gasto_pago_reversion_pago_idx on gasto_pago_reversion (gasto_pago_id);

-- Cada movimiento de cuenta queda enlazado a exactamente el pago o la reversión que lo originó
-- (nunca ambos): permite reconstruir de dónde salió cada línea del libro de la cuenta.
alter table cuenta_movimiento add column gasto_pago_id uuid references gasto_pago (id) on delete restrict;
alter table cuenta_movimiento add column gasto_pago_reversion_id uuid references gasto_pago_reversion (id) on delete restrict;
alter table cuenta_movimiento add constraint cuenta_movimiento_origen_unico
  check (num_nonnulls(gasto_pago_id, gasto_pago_reversion_id) <= 1);

-- ---------------------------------------------------------------------------
-- Historial: mismo patrón que reserva_evento (0004_agenda_reservas.sql) — un registro
-- append-only de cada creación/edición/pago/reversión/anulación, para la sección "Historial de
-- creación, cambios y anulaciones" del detalle de un gasto.
-- ---------------------------------------------------------------------------
create type tipo_evento_gasto as enum ('creado', 'editado', 'pago_registrado', 'pago_revertido', 'anulado');

create table gasto_evento (
  id uuid primary key default gen_random_uuid(),
  gasto_id uuid not null references gasto (id) on delete cascade,
  tipo tipo_evento_gasto not null,
  usuario_id uuid references perfil (id),
  valor_anterior jsonb,
  valor_nuevo jsonb,
  motivo text,
  creado_en timestamptz not null default now()
);

create index gasto_evento_gasto_idx on gasto_evento (gasto_id);
