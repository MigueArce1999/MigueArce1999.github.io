-- 0054_local_empresa_marca.sql
-- Datos de empresa, colores y flag de facturación electrónica por local.
-- Los consume el salón (branding) y la consola adminpeluquerias.

alter table local
  add column if not exists razon_social text,
  add column if not exists nit text,
  add column if not exists email_contacto text,
  add column if not exists color_primario text,
  add column if not exists color_acento text,
  add column if not exists requiere_facturacion_electronica boolean not null default false;

comment on column local.razon_social is 'Razón social / nombre legal del negocio.';
comment on column local.nit is 'NIT o documento tributario.';
comment on column local.email_contacto is 'Correo de la empresa (soporte, facturación).';
comment on column local.color_primario is 'Hex del color principal del sitio del salón (--color-oliva).';
comment on column local.color_acento is 'Hex del color de acento (--color-champan).';
comment on column local.requiere_facturacion_electronica is 'Si el local usará facturación electrónica (DIAN). Solo interruptor por ahora.';
