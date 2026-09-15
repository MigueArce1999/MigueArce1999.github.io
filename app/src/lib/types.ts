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
export type TipoPrecioServicio = 'fijo' | 'desde' | 'a_valorar'
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
  duracion_minutos: number
  tipo_precio: TipoPrecioServicio
  precio: number | null
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

export interface ConfiguracionNegocio {
  moneda: string
  zona_horaria: string
  modo_confirmacion: 'automatica' | 'manual'
  reserva_pendiente_expira_minutos: number
  cancelacion_horas_limite: number
  tasa_puntos_por_defecto: number
}
