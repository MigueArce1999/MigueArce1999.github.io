-- Logo aparte para el pie del sitio público del salón.
alter table local
  add column if not exists logo_footer_url text;

comment on column local.logo_footer_url is 'URL pública del logo del footer. Si falta, el sitio usa logo_url.';
