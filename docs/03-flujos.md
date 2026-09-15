# 3. Flujos que conectan los portales

Convención de entidades (ver `docs/04-modelo-de-datos.md` para el detalle):
`reserva` (intención) → `atencion` (servicios efectivamente realizados) → `atencion_servicio` (líneas, 1 por servicio×profesional) → `pago` (dinero recibido) → `comision` (derivada de cada línea pagada) → `liquidacion` (pago de comisiones acumuladas) → `movimiento_puntos`.

## 3.1 Flujo de reserva (cliente o recepción)

```
1. Elegir servicio (o partir de una profesional → solo sus servicios)
2. Elegir profesional o "Sin preferencia"
3. Consultar disponibilidad → fn_disponibilidad(servicio_id, profesional_id?, fecha)
   - Calcula slots libres = horario_disponibilidad - bloqueo_ausencia - reservas_activas
   - "Sin preferencia" agrega los slots de todas las profesionales habilitadas para el servicio
4. Seleccionar fecha y hora → slot se retiene solo en el cliente (no bloquea BD todavía)
5. Si no hay sesión: iniciar sesión o registrarse (la selección se conserva en el estado del flujo,
   no en localStorage como fuente de verdad — se reenvía al backend al confirmar)
6. Revisar resumen: servicio, profesional, duración, precio (o "desde"/"a valorar"), condiciones
7. Confirmar → RPC fn_crear_reserva(...)
     - Revalida disponibilidad en la misma transacción (evita condición de carrera)
     - INSERT reserva con estado inicial según configuracion_negocio.confirmacion_reservas
       ('confirmada' si es automática, 'pendiente' si es manual)
     - El EXCLUDE CONSTRAINT de la tabla reserva (ver modelo de datos) es la última barrera:
       si dos personas confirman el mismo profesional+horario a la vez, Postgres rechaza
       la segunda transacción aunque ambas hayan pasado el paso 3.
8. La reserva aparece inmediatamente (misma fila, no una copia) en:
     - /cliente/reservas (dueño de la reserva)
     - /equipo-app/agenda (profesional asignada)
     - /admin/agenda (administración)
```

**Reserva pendiente que expira**: si `confirmacion_reservas = 'manual'`, un job (`pg_cron` o Edge Function
programada) ejecuta `fn_liberar_reservas_pendientes_vencidas()` cada 5 minutos, que cancela con motivo
`'vencida_sin_confirmar'` toda reserva en estado `pendiente` cuyo `creado_en + reserva_pendiente_expira_minutos < now()`.

## 3.2 Flujo de atención sin cita (recepción/empleada)

```
1. "Registrar atención" sin reserva previa
2. Buscar cliente existente o crear registro básico (cliente.usuario_id = NULL)
3. Añadir uno o más servicios
4. Indicar profesional responsable de cada servicio (puede haber varias)
5. Revisar precio, descuentos autorizados (validados contra el límite de descuento del rol) y total
6. Notas operativas
7. Marcar como completada
8. Cobrar ahí mismo o enviar a caja/recepción (según permiso)
```

Esto crea `atencion` (sin `reserva_id`) + sus `atencion_servicio`. El resto del flujo es idéntico al de una
atención con cita (sección 3.3).

## 3.3 Completar y cobrar (el núcleo transaccional)

Toda la lógica vive en una única función Postgres `SECURITY DEFINER`:
`fn_completar_y_cobrar_atencion(atencion_id, pagos[], idempotency_key)`.

```
BEGIN
  1. Verifica que quien llama es la profesional de al menos una línea, recepción o admin.
  2. Verifica que la atención no esté ya 'completada' (idempotencia: si idempotency_key ya se usó,
     retorna el resultado anterior sin volver a escribir nada — evita doble cobro por reintentos
     de red o doble clic).
  3. Si la atención tiene reserva_id → reserva.estado = 'completada'.
  4. atencion.estado = 'completada'.
  5. Por cada pago recibido → INSERT pago (método, monto, vuelto, atencion_id).
  6. Por cada atencion_servicio:
       monto_cobrado_linea = prorrateo del pago total sobre el precio de la línea
       INSERT comision (
         regla_aplicada = snapshot de regla_comision vigente para (profesional, servicio) en este momento,
         base_calculo = monto_cobrado_linea,
         valor = base_calculo * regla_aplicada.porcentaje (o valor fijo),
         estado = 'generada'
       )
       -- el snapshot de la regla es intencional: si mañana cambia el %, esta comisión no se recalcula
  7. Si monto_cobrado_total >= monto_total_atencion → cliente: INSERT movimiento_puntos
       (tipo='abono', puntos = monto_cobrado_total * regla_puntos.tasa_vigente, referencia=atencion_id)
     Si el pago es parcial, no se otorgan puntos todavía; se otorgan cuando se complete el pago restante
     (evita ganar puntos sobre dinero no recibido).
  8. Actualiza contadores denormalizados de cliente (visitas, gasto_acumulado) vía trigger, no aquí.
COMMIT
```

Por qué una función y no varios `INSERT` desde el frontend: así el "completar+cobrar" es **atómico**
(todo o nada) e **idempotente** (un reintento de red no duplica venta/comisión/puntos), y el frontend
—sea el portal de empleadas o el admin— nunca podría, por accidente o intento de manipulación, generar
comisión sin venta o puntos sin pago.

## 3.4 Reprogramar

`fn_reprogramar_reserva(reserva_id, nueva_fecha, nueva_hora)`:
valida política de tiempo mínimo → dentro de la misma transacción hace `UPDATE` del rango de tiempo de la
reserva (no crea una fila nueva, así conserva su historial de auditoría) → el `EXCLUDE CONSTRAINT` garantiza
que el horario anterior queda libre de inmediato y el nuevo no choca con otra reserva. Se registra en
`reserva_evento (tipo='reprogramada', usuario_id=quien_hizo_el_cambio, valor_anterior, valor_nuevo)`.

## 3.5 Cancelar

`fn_cancelar_reserva(reserva_id, motivo)`: valida política de tiempo mínimo (o permiso de administración
para saltarla), `UPDATE reserva.estado = 'cancelada'`, libera el horario (al no estar "activa" ya no cuenta
para el EXCLUDE CONSTRAINT ni para el cálculo de disponibilidad). Registra `reserva_evento`.

## 3.6 Devolución / anulación de venta

`fn_registrar_devolucion(pago_id o atencion_servicio_id, motivo, monto)`:
- Crea un `pago` con `monto negativo` (o `tipo='devolucion'`) referenciando el pago original — nunca borra el pago original.
- Crea una `comision` con `valor negativo` referenciando la comisión original, con el mismo `regla_aplicada` snapshot.
- Crea un `movimiento_puntos` de tipo `reversion` por los puntos proporcionales a lo devuelto.
- Si la comisión original ya fue `liquidada`, la reversión queda como **saldo pendiente a descontar en la
  próxima liquidación** de esa profesional (no se reabre una liquidación cerrada).
- Todo queda trazable: se puede reconstruir el importe neto de una venta sumando sus pagos.

## 3.7 Puntos — ciclo de vida de un movimiento

```
abono        → generado por atención completada y pagada
canje        → generado por el cliente al redimir una recompensa (valida saldo suficiente)
reversion    → generado por una devolución
ajuste       → generado manualmente por admin, con motivo obligatorio (nunca se edita el saldo directo,
                siempre se inserta un movimiento nuevo; el saldo es SUM(movimientos) calculado, no un campo editable)
vencimiento  → generado por un job periódico si regla_puntos.vigencia_dias está configurada
```

## 3.8 Liquidación de comisiones

`fn_crear_liquidacion(profesional_id, periodo_inicio, periodo_fin)`:
selecciona todas las `comision` de esa profesional con `estado='generada'` y `creado_en` dentro del periodo →
crea `liquidacion` (con responsable, fecha, importe total) + `liquidacion_detalle` por cada comisión incluida →
`UPDATE comision.estado='liquidada'` solo para esas filas. Una comisión con `estado='liquidada'` no puede
volver a incluirse en otra liquidación (constraint `UNIQUE` sobre `liquidacion_detalle.comision_id`), lo que
hace imposible pagarla dos veces.
