# 4. Modelo de datos (Postgres / Supabase)

Ver SQL real y comentado en `supabase/migrations/`. Este documento es el mapa de lectura.

## 4.1 Identidad y roles

- **`perfil`** — 1:1 con `auth.users` (Supabase Auth). `id = auth.users.id`. Campos: `nombre`, `telefono`,
  `rol` (`cliente`|`empleada`|`admin`|`super_admin`), `activo`, `local_id` (NULL solo si `super_admin`).
- **`permiso`** — flags finos opcionales por perfil (`puede_ver_agenda_equipo`, `puede_descuentos_hasta`,
  `puede_caja`, `puede_anular_ventas`, …). Un perfil sin fila en `permiso` tiene los permisos base de su rol.
- **`cliente`** — puede o no tener `usuario_id → perfil.id` (NULL = creado en recepción, sin cuenta).
  `consentimiento_marketing boolean default false` (separado de las notificaciones operativas de citas,
  que no requieren opt-in porque son transaccionales).
- **`profesional`** — 1:1 con `perfil` (rol `empleada`). `especialidades text[]`, `foto_url`, `bio`, `activo`.
  Desactivar un perfil (`activo=false`) no borra sus atenciones ni comisiones históricas — solo deja de
  aparecer en el catálogo público y en los flujos de nueva reserva.

## 4.2 Catálogo

- **`categoria_servicio`** (Cabello, Estética, Cejas y maquillaje, Manicura/pedicura — editable).
- **`servicio`** — `categoria_id`, `nombre`, `descripcion`, `imagen_url`, `duracion_minutos`,
  `tipo_precio` (`fijo`|`desde`|`a_valorar`), `precio` (nullable si `a_valorar`), `activo`.
  Desactivar un servicio no borra las atenciones que ya lo referenciaron (`atencion_servicio` guarda su
  propio snapshot de nombre y precio, ver 4.4).
- **`servicio_profesional`** — tabla puente: qué profesionales prestan qué servicio.

## 4.3 Agenda y disponibilidad

- **`horario_disponibilidad`** — recurrente semanal por profesional: `dia_semana`, `hora_inicio`, `hora_fin`.
- **`bloqueo_ausencia`** — excepción puntual (vacaciones, incapacidad, bloqueo manual): `profesional_id`,
  `rango tstzrange`, `motivo`.
- **`reserva`** — la intención de recibir un servicio:
  `cliente_id`, `servicio_id`, `profesional_id` (nullable si aún no asignada, aunque el flujo público
  siempre la asigna al confirmar), `rango tstzrange` (inicio/fin calculado con la duración del servicio),
  `estado` (`pendiente`|`confirmada`|`en_atencion`|`completada`|`cancelada`|`no_asistio`),
  `origen` (`cliente`|`recepcion`|`admin`), `creado_por`.

  ```sql
  -- Constraint que hace imposible el doble-booking a nivel de base de datos,
  -- incluso ante dos transacciones concurrentes:
  EXCLUDE USING gist (
    profesional_id WITH =,
    rango WITH &&
  ) WHERE (estado NOT IN ('cancelada', 'no_asistio'))
  ```

- **`reserva_evento`** — bitácora de cambios de estado/horario (`quién`, `cuándo`, `de→a`).

## 4.4 Atención, venta y pago

- **`atencion`** — servicios efectivamente realizados. `reserva_id` (nullable → atención sin cita),
  `cliente_id`, `estado` (`en_progreso`|`completada`|`anulada`), `notas`.
- **`atencion_servicio`** — línea de detalle: `atencion_id`, `servicio_id`, `profesional_id`,
  `nombre_snapshot`, `precio_snapshot`, `descuento`, `cantidad`. Snapshot de nombre/precio para que un
  cambio futuro de precio del catálogo **no altere ventas ya registradas**.
- **`atencion_servicio_colaborador`** — colaboradores internos de una línea de servicio:
  `atencion_servicio_id`, `colaborador_id` (profesional), `participacion` (texto libre, ej. "Apoyo en
  peinado"), `valor`. Es una **distribución interna** del precio ya cobrado en `atencion_servicio`, no un
  cargo adicional: nunca se suma al total de la atención ni a `pago`. `unique(atencion_servicio_id,
  colaborador_id)` evita duplicados; `fn_registrar_atencion` valida además que el colaborador no sea el
  propio profesional responsable y que la suma de valores no supere el precio de la línea.
- **`atencion_producto`** — productos vendidos a la clienta (no insumos consumidos durante el servicio):
  `atencion_id`, `categoria`, `nombre`, `cantidad`, `precio_unitario`. Sin catálogo propio en este alcance
  (recepción escribe categoría/nombre/precio en el momento); sí se incluyen en el total a cobrar y en
  `vista_atencion.total_vendido`.
- **`pago`** — dinero recibido: `atencion_id`, `metodo` (`efectivo`|`transferencia`|`tarjeta`|`otro`),
  `monto` (negativo para devoluciones), `referencia_pago_id` (self-FK para vincular una devolución con su
  pago original).
- Los indicadores de "venta" (ver `docs/03-flujos.md`) se derivan de `atencion_servicio` +
  `atencion_producto` + `pago`, no se duplican en una tabla `venta` aparte — evita que ventas y pagos se
  desincronicen. Las comisiones (ver 4.5) se calculan solo sobre `atencion_servicio`: los productos y los
  colaboradores no generan comisión propia en este alcance.

## 4.5 Comisiones y liquidaciones

- **`regla_comision`** — vigente por `profesional_id` + `servicio_id` (o profesional sin servicio = regla
  general): `tipo` (`porcentaje`|`fijo`), `valor`, `vigente_desde`, `vigente_hasta` (nullable = sigue vigente).
  Nunca se hace `UPDATE` de una regla vigente: se cierra (`vigente_hasta = now()`) y se crea una nueva fila.
- **`comision`** — generada por `fn_completar_y_cobrar_atencion`: `atencion_servicio_id`,
  `regla_aplicada jsonb` (snapshot completo de la regla usada), `base_calculo`, `valor`,
  `estado` (`generada`|`liquidada`).
- **`liquidacion`** — `profesional_id`, `periodo_inicio`, `periodo_fin`, `importe_total`, `responsable_id`,
  `creado_en`.
- **`liquidacion_detalle`** — puente `liquidacion_id` ↔ `comision_id`, con `UNIQUE(comision_id)` para que
  una comisión no pueda liquidarse dos veces.

## 4.6 Fidelización

- **`regla_puntos`** — vigente: `tasa` (puntos por peso pagado), `vigencia_dias` (nullable), `activa`.
- **`movimiento_puntos`** — `cliente_id`, `tipo` (`abono`|`canje`|`reversion`|`ajuste`|`vencimiento`),
  `puntos` (positivo o negativo), `referencia_tipo`/`referencia_id` (a qué atención, canje o ajuste
  corresponde), `motivo` (obligatorio si `tipo='ajuste'`), `creado_por`. El saldo del cliente es
  `SUM(puntos)`, calculado, nunca un campo editable directo.
- **`recompensa`** — catálogo de canjes: `nombre`, `costo_puntos`, `descripcion`, `activa`.

## 4.7 Promociones

- **`promocion`** — `nombre`, `descripcion`, `vigente_desde`, `vigente_hasta`, `tipo_descuento`
  (`porcentaje`|`fijo`|`precio_especial`), `valor`, `acumulable boolean`.
- **`promocion_servicio`** — servicios incluidos.
- Una consulta de "promociones vigentes" siempre filtra `vigente_desde <= now() AND vigente_hasta >= now()`;
  nunca se muestra una promoción vencida como disponible (regla de consulta, no de borrado).

## 4.8 Caja y gastos (Fase 2, esquema ya reservado)

- **`categoria_gasto`**, **`gasto`** (`categoria_id`, `fecha`, `monto`, `descripcion`, `registrado_por`).
- **`caja_sesion`** (apertura/cierre, `saldo_inicial`, `saldo_esperado`, `saldo_contado`, `diferencia`).
- **`caja_movimiento`** (ingresos/egresos de efectivo dentro de una sesión).

## 4.9 Contenido web y auditoría

- **`contenido_evento`** — jornadas/eventos administrables del sitio público.
- **`resena`** — reseñas reales importadas/registradas manualmente; nunca generadas sintéticamente.
- **`auditoria_log`** — `tabla`, `registro_id`, `accion`, `usuario_id`, `datos_anteriores jsonb`,
  `datos_nuevos jsonb`, `creado_en`. Alimentado por triggers `AFTER UPDATE/DELETE` en las tablas sensibles
  (`reserva`, `atencion`, `pago`, `comision`, `movimiento_puntos`, `regla_comision`).

## 4.10 Reglas transversales de integridad

- Todos los importes son `numeric(12,2)` (COP no tiene decimales en la práctica, pero se deja precisión
  para descuentos porcentuales exactos).
- Todas las fechas se guardan en `timestamptz` (UTC en disco); la conversión a `America/Bogota` ocurre en
  la capa de presentación (`Intl.DateTimeFormat` con `timeZone: 'America/Bogota'`) y en las funciones SQL
  de reporte (`AT TIME ZONE 'America/Bogota'`), nunca se guarda una hora "local" ambigua.
  `configuracion_negocio.zona_horaria = 'America/Bogota'` es el valor de referencia.
- `configuracion_negocio` es **una fila por local** (`local_id` PK) que
  centraliza: moneda (`COP`), confirmación de reservas, ventana de cancelación, minutos de expiración de
  pendientes, tasa de puntos por defecto, etc. El frontend filtra con `VITE_LOCAL_ID`.

## 4.11 Multi-local (mismo Supabase)

- **`local`** — un negocio. Semilla `c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001` (Claudia Patricia).
  Marca: `nombre`, `nombre_corto`, `eslogan`, `logo_url`, `favicon_url`, `url_sitio`, `slug`,
  `color_primario`, `color_acento`. Empresa: `razon_social`, `nit`, `email_contacto`.
  Producto: `requiere_facturacion_electronica`. Las edita el super admin en `adminpeluquerias`.
  El `super_admin` tiene `perfil.local_id` NULL; RLS le deja leer su propia fila (0055) para poder iniciar sesión.
  En el salón entra como clienta (se crea `cliente` de ese local con `fn_asegurar_cliente_en_local`, 0056).
- **`cliente`** es por local: unique `(local_id, usuario_id)`. El mismo correo Auth puede ser clienta en varios salones.
  La contraseña es **una** por correo (Supabase Auth); no hay una clave distinta por local.
- Casi todas las tablas de operación tienen `local_id`. RLS restrictiva: catálogo público por header `x-local-id` o perfil; datos privados solo `perfil.local_id`.
- Alta comercial: `fn_provisionar_local(nombre, slug, …)` → UUID para `VITE_LOCAL_ID` de esa instalación (el dominio no importa). Primer super admin: en el SQL editor, `select fn_conceder_super_admin('correo@…');`.
- Auth es del proyecto, no del local. Cada dominio se lista en Redirect URLs (`https://dominio.com/**`). El registro manda `emailRedirectTo` al origen de esa instalación. Si el correo ya existe, el registro intenta iniciar sesión y vincular la clienta a este local.
