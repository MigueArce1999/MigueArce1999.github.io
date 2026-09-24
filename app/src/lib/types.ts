// Tipos que reflejan el esquema de supabase/migrations/*.sql.
// Mantener sincronizado a mano es aceptable para el alcance de la Fase 1;
// en Fase 2 conviene generarlos con `supabase gen types typescript`.

export type Rol = 'cliente' | 'empleada' | 'admin' | 'super_admin'

export type EstadoReserva =
  | 'pendiente'
  | 'confirmada'
  | 'en_atencion'
  | 'completada'
  | 'cancelada'
  | 'no_asistio'

export type EstadoAtencion = 'en_progreso' | 'completada' | 'anulada'
export type MetodoPago = 'efectivo' | 'transferencia' | 'tarjeta' | 'otro'
export type TipoPrecioServicio = 'fijo' | 'desde' | 'rango' | 'a_valorar'
export type TipoMovimientoPuntos = 'abono' | 'canje' | 'reversion' | 'ajuste' | 'vencimiento'

export interface Perfil {
  id: string
  nombre: string
  telefono: string | null
  rol: Rol
  activo: boolean
  local_id?: string
}

export interface LocalMarca {
  id: string
  nombre: string
  slug: string
  activo: boolean
  logo_url: string | null
  favicon_url: string | null
  logo_footer_url: string | null
  splash_url: string | null
  url_sitio: string | null
  nombre_corto: string | null
  eslogan: string | null
  color_primario?: string | null
  color_acento?: string | null
  creado_en?: string
}

export interface Cliente {
  id: string
  usuario_id: string | null
  nombre: string
  telefono: string | null
  email: string | null
  consentimiento_marketing: boolean
  visitas_completadas: number
  gasto_acumulado: number
  activo: boolean
  origen_registro: 'admin' | 'publico'
  notas: string | null
  // Se marca a mano desde el panel; nunca es una verificación automática contra Google.
  resena_google_confirmada: boolean
  // Fidelización: meta que la propia clienta eligió (null = usar la de menor costo disponible
  // por defecto — ver fn_mi_fidelizacion en 0047_fidelizacion.sql).
  meta_recompensa_id: string | null
  creado_en: string
}

// vista_cliente_resumen (ver supabase/migrations/0024): agrega a Cliente lo que no es una
// columna real sino derivado del historial de atenciones — nunca confundir con creado_en.
export interface ClienteResumen extends Cliente {
  ultima_visita: string | null
  ultimo_servicio_nombre: string | null
  ultimo_profesional_nombre: string | null
}

export type CampanaTipo = 'general' | 'promocional'
export type CampanaEstado = 'borrador' | 'lista' | 'en_progreso' | 'finalizada'
export type DestinatarioEstado = 'pendiente' | 'whatsapp_abierto' | 'marcado_enviado' | 'excluido'

export interface Campana {
  id: string
  nombre: string
  mensaje: string
  tipo: CampanaTipo
  estado: CampanaEstado
  creado_en: string
}

export interface CampanaDestinatario {
  id: string
  campana_id: string
  cliente_id: string
  cliente_nombre?: string
  cliente_telefono?: string | null
  estado: DestinatarioEstado
  motivo_exclusion: string | null
}

export interface Profesional {
  id: string
  slug: string
  nombre: string
  especialidades: string[]
  bio: string | null
  foto_url: string | null
  activo: boolean
  orden_visualizacion: number
  // Distinto de `activo` (que controla si opera en el salón/puede recibir reservas): decide si
  // aparece en la vitrina de "Conoce al equipo" de la home pública.
  mostrar_en_home: boolean
}

export interface CategoriaServicio {
  id: string
  nombre: string
  orden_visualizacion: number
  // También hace de interruptor "visible en la homepage" — no hay un campo aparte para eso.
  activa: boolean
  descripcion_corta: string | null
  imagen_url: string | null
  texto_boton: string
  enlace_boton: string | null
}

export interface Servicio {
  id: string
  categoria_id: string
  categoria_nombre?: string
  nombre: string
  descripcion: string | null
  imagen_url: string | null
  // null = todavía sin confirmar; seleccionable igual en Atender (no depende de este campo),
  // pero no se ofrece para reservar en línea hasta que se configure (ver fn_crear_reserva).
  duracion_minutos: number | null
  tipo_precio: TipoPrecioServicio
  precio: number | null
  // Solo aplica cuando tipo_precio = 'rango': el extremo superior ("$100.000–$200.000").
  precio_maximo?: number | null
  activo: boolean
  profesionales?: Profesional[]
}

export interface Promocion {
  id: string
  nombre: string
  descripcion: string
  condiciones: string | null
  // Ambas opcionales: sin fechas, la visibilidad pública depende solo de `activa` (el
  // interruptor "Mostrar en la homepage").
  vigente_desde: string | null
  vigente_hasta: string | null
  tipo_descuento: 'porcentaje' | 'fijo' | 'precio_especial'
  valor: number
  activa: boolean
  imagen_url: string | null
  orden_visualizacion: number
  texto_boton: string
  enlace_boton: string | null
  servicios?: string[]
}

// Estado mostrado en el admin — calculado a partir de `activa` + fechas, nunca almacenado, para
// no tener dos fuentes de verdad sobre si una promoción está vigente.
export type EstadoPromocion = 'inactiva' | 'programada' | 'activa' | 'finalizada'

export interface ConfiguracionHomepage {
  hero_imagen_url: string | null
  hero_editable: boolean
}

export interface SlotDisponible {
  inicio: string // ISO
  fin: string
}

export interface Reserva {
  id: string
  cliente_id: string
  cliente_nombre?: string
  servicio_id: string
  servicio_nombre?: string
  profesional_id: string
  profesional_nombre?: string
  rango_inicio: string
  rango_fin: string
  precio_estimado: number | null
  estado: EstadoReserva
  origen: 'cliente' | 'recepcion' | 'admin'
  notas: string | null
}

export interface AtencionServicioLinea {
  id: string
  servicio_id: string
  nombre_snapshot: string
  precio_snapshot: number
  descuento: number
  cantidad: number
  profesional_id: string
  profesional_nombre?: string
}

export interface Atencion {
  id: string
  reserva_id: string | null
  cliente_id: string
  cliente_nombre?: string
  estado: EstadoAtencion
  notas: string | null
  creado_en: string
  completado_en: string | null
  lineas: AtencionServicioLinea[]
  total_pagado?: number
  total_vendido?: number
}

// Fila plana de vista_atencion_servicio: una línea de venta con su contexto de atención,
// cliente y comisión ya generada (ver supabase/migrations/0017_vista_atencion_servicio_detalle.sql).
export interface VentaLinea {
  id: string
  atencion_id: string
  servicio_id: string
  nombre_snapshot: string
  precio_snapshot: number
  descuento: number
  cantidad: number
  profesional_id: string
  profesional_nombre?: string
  reserva_id: string | null
  atencion_estado: EstadoAtencion
  atencion_creado_en: string
  atencion_completado_en: string | null
  cliente_id: string
  cliente_nombre: string
  comision_total: number
  es_colaboracion: boolean
}

export interface MovimientoPuntos {
  id: string
  cliente_id: string
  tipo: TipoMovimientoPuntos
  puntos: number
  referencia_tipo: string | null
  referencia_id: string | null
  canje_id: string | null
  motivo: string | null
  regla_aplicada: Record<string, unknown> | null
  creado_en: string
}

export interface ComisionResumen {
  id: string
  atencion_servicio_id: string
  base_calculo: number
  valor: number
  estado: 'generada' | 'liquidada'
  creado_en: string
  servicio_nombre?: string
  cliente_nombre?: string
}

// Fila vigente de regla_comision (ver supabase/migrations/0006/0023): servicio_id null es la
// comisión base de la profesional; con servicio_id es una excepción que la reemplaza (nunca
// se suma) únicamente para ese servicio.
export interface ReglaComision {
  id: string
  profesionalId: string
  servicioId: string | null
  servicioNombre: string | null
  tipo: 'porcentaje' | 'fijo'
  valor: number
}

export interface ConfiguracionNegocio {
  moneda: string
  zona_horaria: string
  modo_confirmacion: 'automatica' | 'manual'
  reserva_pendiente_expira_minutos: number
  cancelacion_horas_limite: number
  tasa_puntos_por_defecto: number
  anticipacion_minima_reserva_minutos: number
  horizonte_reservas_dias: number
  margen_entre_citas_minutos: number
  // GlowDesk Live (0060_glowdesk_live_esquema.sql) — sección 22 del pedido.
  live_disponibilidad_activo: boolean
  live_umbral_termina_pronto_minutos: number
  live_umbral_disponible_limitado_minutos: number
  live_expiracion_solicitud_minutos: number
  live_hold_minutos: number
  voz_asistente_genero?: 'femenina' | 'masculina'
}

// --- Agenda compartida (ver supabase/migrations/0031/0032) -----------------------------

export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada' | 'retirada'
export type TipoBloqueoAusencia = 'bloqueo' | 'ausencia_dia' | 'ausencia_rango'

// Un intervalo del horario habitual de una profesional. dia_semana sigue la convención de
// Postgres EXTRACT(DOW): 0 = domingo … 6 = sábado.
export interface IntervaloHorario {
  dia_semana: number
  hora_inicio: string // "HH:MM" o "HH:MM:SS"
  hora_fin: string
}

// Fila de horario_disponibilidad ya resuelta a la versión vigente (una fecha de referencia).
export interface HorarioDisponibilidad extends IntervaloHorario {
  id: string
  profesional_id: string
  activo: boolean
  vigente_desde: string
}

export interface BloqueoAusencia {
  id: string
  profesional_id: string
  profesional_nombre?: string
  rango_inicio: string
  rango_fin: string
  motivo: string | null
  tipo: TipoBloqueoAusencia
  todo_el_dia: boolean
  estado: EstadoSolicitud
  creado_por: string | null
  creado_en: string
  revisado_por: string | null
  revisado_en: string | null
  motivo_rechazo: string | null
}

export interface SolicitudHorario {
  id: string
  profesional_id: string
  profesional_nombre?: string
  estado: EstadoSolicitud
  intervalos: IntervaloHorario[]
  vigente_desde: string
  motivo: string | null
  creado_por: string | null
  creado_en: string
  revisado_por: string | null
  revisado_en: string | null
  motivo_rechazo: string | null
}

// Slot de fn_disponibilidad_equipo: mismo horario, con la lista de profesionales elegibles
// que de verdad lo tienen libre en este momento ("Cualquier profesional").
export interface SlotEquipoDisponible extends SlotDisponible {
  profesionales_disponibles: string[]
}

// --- Gastos y pagos (ver supabase/migrations/0033-0035) ---------------------------------

export type EstadoGasto = 'pendiente' | 'pago_parcial' | 'pagado' | 'anulado'
export type OrigenGasto = 'manual' | 'compra' | 'liquidacion'
export type TipoCuenta = 'efectivo' | 'bancaria' | 'billetera'
export type FrecuenciaRecurrencia = 'semanal' | 'mensual'

export interface CategoriaGasto {
  id: string
  nombre: string
  activa: boolean
}

export interface Proveedor {
  id: string
  nombre: string
  telefono: string | null
  activo: boolean
}

export interface Cuenta {
  id: string
  nombre: string
  tipo: TipoCuenta
  activa: boolean
  saldo: number
}

// Fila de vista_gasto: el saldo/estado/vencido siempre vienen calculados del servidor, nunca
// se recalculan en el cliente (ver 0034_gastos_pagos_funciones.sql → vista_gasto).
export interface Gasto {
  id: string
  concepto: string
  categoria_id: string
  categoria_nombre: string
  categoria_activa: boolean
  proveedor_id: string | null
  proveedor_nombre: string | null
  referencia: string | null
  fecha: string
  fecha_vencimiento: string | null
  valor_total: number
  notas: string | null
  comprobante_path: string | null
  origen: OrigenGasto
  referencia_liquidacion_id: string | null
  plantilla_id: string | null
  anulado: boolean
  anulado_motivo: string | null
  anulado_por: string | null
  anulado_en: string | null
  creado_por: string
  creado_por_nombre: string | null
  creado_en: string
  actualizado_por: string | null
  actualizado_en: string
  total_pagado: number
  saldo_pendiente: number
  estado: EstadoGasto
  vencido: boolean
}

export interface GastoPago {
  id: string
  gasto_id: string
  importe: number
  fecha: string
  metodo: MetodoPago
  cuenta_id: string
  cuenta_nombre?: string
  referencia: string | null
  // Soporte opcional de ESTE pago puntual (p. ej. el comprobante de esa transferencia) —
  // distinto de gasto.comprobante_path, que es el soporte del gasto en sí.
  comprobante_path: string | null
  registrado_por: string
  registrado_por_nombre?: string
  creado_en: string
}

export interface GastoPagoReversion {
  id: string
  gasto_pago_id: string
  importe: number
  motivo: string
  registrado_por: string
  registrado_por_nombre?: string
  creado_en: string
}

export type TipoEventoGasto = 'creado' | 'editado' | 'pago_registrado' | 'pago_revertido' | 'anulado'

export interface GastoEvento {
  id: string
  gasto_id: string
  tipo: TipoEventoGasto
  usuario_id: string | null
  usuario_nombre?: string
  valor_anterior: Record<string, unknown> | null
  valor_nuevo: Record<string, unknown> | null
  motivo: string | null
  creado_en: string
}

export interface PlantillaGastoRecurrente {
  id: string
  concepto: string
  categoria_id: string
  categoria_nombre?: string
  proveedor_id: string | null
  proveedor_nombre?: string | null
  valor_total: number
  frecuencia: FrecuenciaRecurrencia
  primera_fecha_vencimiento: string
  fecha_fin: string | null
  activa: boolean
  creado_en: string
}

// --- Fidelización ("Tu belleza florece") ----------------------------------------------------
// Ver supabase/migrations/0047_fidelizacion.sql para el porqué de cada decisión de esquema.

export type TipoRecompensa = 'beneficio' | 'descuento_fijo'
export type EstadoCanje = 'confirmado' | 'revertido'

export interface ReglaPuntos {
  id: string
  activa: boolean
  vigente_desde: string
  vigente_hasta: string | null
  monto_por_bloque: number | null
  puntos_por_bloque: number | null
  categorias_excluidas: string[]
  servicios_excluidos: string[]
  incluye_productos: boolean
}

export interface ConfiguracionFidelizacion {
  acumulacion_activa: boolean
  canjes_activo: boolean
  texto_programa: string
  actualizado_en: string
}

export interface Recompensa {
  id: string
  nombre: string
  descripcion: string | null
  costo_puntos: number
  activa: boolean
  tipo: TipoRecompensa
  servicio_id: string | null
  servicio_nombre?: string
  monto_descuento: number | null
  servicios_elegibles: string[]
  condiciones: string | null
  requiere_atencion_pagada: boolean
  stock_ilimitado: boolean
  cantidad_disponible: number | null
  imagen_url: string | null
  orden_visualizacion: number
  creado_en: string
  actualizado_en: string
}

export interface CanjeRecompensa {
  id: string
  cliente_id: string
  cliente_nombre?: string
  recompensa_id: string
  atencion_id: string | null
  costo_puntos_snapshot: number
  condiciones_snapshot: { nombre: string; tipo: TipoRecompensa; condiciones: string | null; servicio_id: string | null; monto_descuento: number | null }
  estado: EstadoCanje
  entregado: boolean
  empleada_id: string | null
  creado_en: string
  revertido_en: string | null
  // Saldo justo antes y después del cobro completo que incluyó este canje (canje + cualquier
  // abono de la misma atención) — un snapshot inmutable, nunca recalculado (ver
  // 0048_celebracion_canje.sql). null en canjes anteriores a esa migración.
  saldo_anterior: number | null
  saldo_posterior: number | null
}

// Snapshot devuelto por fn_mi_fidelizacion: todo lo que necesita la tarjeta de la clienta en una
// sola llamada (saldo, meta con su progreso ya calculado, y el estado del programa).
export interface MiFidelizacion {
  saldo: number
  acumulacion_activa: boolean
  canjes_activo: boolean
  texto_programa: string
  meta: Recompensa | null
  progreso: number | null
  puntos_faltantes: number | null
}

// Todo lo que necesita la celebración de canje (0048_celebracion_canje.sql) en una sola lectura,
// congelado en el momento del canje — nunca se recalcula (saldo_posterior puede ya no coincidir
// con el saldo actual si hubo movimientos después, y eso es intencional: describe ese instante).
export interface CanjeConfirmadoDatos {
  canje_id: string
  recompensa_nombre: string
  recompensa_imagen_url: string | null
  recompensa_tipo: TipoRecompensa
  costo_puntos: number
  saldo_anterior: number
  saldo_posterior: number
  puntos_ganados_en_esta_atencion: number
}

export interface NotificacionFidelizacion {
  id: string
  cliente_id: string
  tipo: 'puntos_ganados' | 'meta_alcanzada' | 'canje_confirmado'
  titulo: string
  mensaje: string
  origen_tipo: string
  origen_id: string
  leida_en: string | null
  creado_en: string
  // Solo poblado cuando tipo = 'canje_confirmado'.
  datos?: CanjeConfirmadoDatos | null
}

// Valor definitivo que devuelve fn_completar_y_cobrar_atencion — nunca una estimación: es lo
// que de verdad quedó guardado en el servidor (sección 12 del pedido: "la vista previa puede ser
// inmediata, pero debe distinguirse del resultado confirmado").
export interface ResultadoCobro {
  atencion: Atencion
  puntos_ganados: number
  puntos_utilizados: number
  saldo_nuevo: number
  recompensa_aplicada: { canje_id: string; nombre: string; tipo: TipoRecompensa } | null
}

// --- GlowDesk Live: disponibilidad en tiempo real -------------------------------------------
// Los tipos de esta sección reflejan exactamente el jsonb que devuelven las funciones de
// supabase/migrations/0061_glowdesk_live_motor.sql — no hay transformación de forma entre el
// motor SQL (fuente única de verdad) y lo que consume la UI.

export interface ZonaSalon {
  id: string
  nombre: string
  icono: string | null
  orden_visualizacion: number
  activa: boolean
}

// Devuelto por fn_estado_profesional_ahora. `razon` nunca revela información privada del
// cliente que esté siendo atendido (sección 26 del pedido) — son categorías internas seguras
// de mostrar tal cual o de traducir a texto amigable en la UI.
export type EstadoDisponibilidad = 'available' | 'busy' | 'ending_soon' | 'upcoming_appointment' | 'unavailable'

export type RazonNoDisponible =
  | 'fuera_de_horario'
  | 'dia_libre'
  | 'ausencia'
  | 'bloqueo'
  | 'descanso'
  | 'almuerzo'
  | 'no_disponible'
  | 'ocupado_temporal'
  | 'servicio_activo'
  | 'cita'
  | null

export interface EstadoProfesionalAhora {
  status: EstadoDisponibilidad
  razon: RazonNoDisponible
  disponible_ahora: boolean
  disponible_hasta: string | null
  proxima_disponible_en: string | null
  minutos_libres: number | null
  // null = no se pidió filtrar por un servicio concreto, o la duración de ese servicio es
  // desconocida (no se puede confirmar con certeza que le alcanza el tiempo libre).
  puede_atender_servicio: boolean | null
}

export interface ProfesionalEnVivo {
  profesional_id: string
  nombre: string
  foto_url: string | null
  zonas: string[]
  estado: EstadoProfesionalAhora
}

// Devuelto por fn_estado_equipo_en_vivo (0066) — la vista de admin de "quién está disponible
// ahora", igual que ProfesionalEnVivo pero sin `zonas` (no aplica en ese panel) y sin depender de
// que live_disponibilidad_activo esté prendido, a diferencia de fn_salon_en_vivo.
export interface EstadoEquipoItem {
  profesional_id: string
  nombre: string
  foto_url: string | null
  estado: EstadoProfesionalAhora
}

export type DemandaSalon = 'tranquilo' | 'movimiento_medio' | 'alta_demanda'

// Devuelto por fn_salon_en_vivo. `activo: false` significa que el feature flag
// live_disponibilidad_activo está apagado para este local — la UI debe ocultar todo el módulo,
// no mostrar un estado vacío.
export type SalonEnVivo =
  | { activo: false }
  | {
      activo: true
      demanda: DemandaSalon
      actualizado_en: string
      zonas: ZonaSalon[]
      profesionales: ProfesionalEnVivo[]
    }

export type EstadoSolicitudDisponibilidad =
  | 'pendiente'
  | 'aceptada'
  | 'aceptada_luego'
  | 'rechazada'
  | 'expirada'
  | 'cancelada'
  | 'cliente_en_camino'
  | 'completada'

// Devuelto por fn_resultado_solicitud_disponibilidad (y por cada función que muta el estado de
// una solicitud) — nunca una reconstrucción en el cliente, siempre lo que el servidor guardó.
export interface SolicitudDisponibilidad {
  id: string
  estado: EstadoSolicitudDisponibilidad
  expira_en: string
  disponible_desde: string | null
  llegada_minutos: number
  profesional_id: string
  profesional_nombre: string
  servicio_id: string
  servicio_nombre: string
  creado_en: string
  respondido_en: string | null
}

// 'disponible_forzado' (0070) es distinto de 'disponible': 'disponible' no es un override real
// (fn_marcar_estado_manual lo rechaza, significa "quitar cualquier override"), mientras que
// 'disponible_forzado' SÍ es un override real que hace que el motor la muestre disponible aunque
// esté fuera de su horario o en un bloqueo/ausencia aprobados — nunca por encima de un servicio
// o cita real en curso, eso siempre gana.
export type EstadoManualProfesional = 'disponible' | 'descanso' | 'almuerzo' | 'no_disponible' | 'ocupado_temporal' | 'disponible_forzado'
