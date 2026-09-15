-- 0001_extensions_enums.sql
-- Extensiones y tipos base del ecosistema Claudia Patricia.

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gist; -- necesaria para el EXCLUDE constraint anti-solapamiento

create type rol_usuario as enum ('cliente', 'empleada', 'admin');

create type estado_reserva as enum (
  'pendiente', 'confirmada', 'en_atencion', 'completada', 'cancelada', 'no_asistio'
);

create type origen_reserva as enum ('cliente', 'recepcion', 'admin');

create type tipo_evento_reserva as enum (
  'creada', 'confirmada', 'reprogramada', 'cancelada', 'completada', 'no_asistio'
);

create type estado_atencion as enum ('en_progreso', 'completada', 'anulada');

create type metodo_pago as enum ('efectivo', 'transferencia', 'tarjeta', 'otro');

create type tipo_precio_servicio as enum ('fijo', 'desde', 'a_valorar');

create type tipo_valor_comision as enum ('porcentaje', 'fijo');

create type estado_comision as enum ('generada', 'liquidada');

create type tipo_movimiento_puntos as enum (
  'abono', 'canje', 'reversion', 'ajuste', 'vencimiento'
);

create type tipo_descuento_promocion as enum ('porcentaje', 'fijo', 'precio_especial');

create type modo_confirmacion_reserva as enum ('automatica', 'manual');
