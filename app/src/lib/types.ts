// Tipos que reflejan el esquema de supabase/migrations/*.sql.
// Mantener sincronizado a mano es aceptable para el alcance de la Fase 1;
// en Fase 2 conviene generarlos con `supabase gen types typescript`.

export type Rol = 'cliente' | 'empleada' | 'admin'

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
}

export interface CategoriaServicio {
  id: string
  nombre: string
  orden_visualizacion: number
  activa: boolean
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
  vigente_desde: string
  vigente_hasta: string
  tipo_descuento: 'porcentaje' | 'fijo' | 'precio_especial'
  valor: number
  servicios?: string[]
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
  motivo: string | null
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
