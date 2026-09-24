-- Voz de Glowdesk (síntesis): cada local elige masculina o femenina.
alter table configuracion_negocio
  add column if not exists voz_asistente_genero text not null default 'femenina';

alter table configuracion_negocio
  drop constraint if exists configuracion_negocio_voz_asistente_genero_chk;

alter table configuracion_negocio
  add constraint configuracion_negocio_voz_asistente_genero_chk
  check (voz_asistente_genero in ('femenina', 'masculina'));

comment on column configuracion_negocio.voz_asistente_genero is
  'Género de la voz hablada del asistente Glowdesk en este local.';
