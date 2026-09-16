import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
import { demoComisionesEmpleada, demoReservasAgendaEmpleada } from '../demoData'
import type { Atencion, ComisionResumen, VentaLinea } from '../types'

export async function registrarAtencion(params: {
  clienteId: string
  reservaId: string | null
  lineas: { servicioId: string; profesionalId: string; precioSnapshot?: number; descuento?: number; cantidad?: number }[]
}): Promise<{ id: string }> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_registrar_atencion', {
    p_cliente_id: params.clienteId,
    p_reserva_id: params.reservaId,
    p_lineas: params.lineas.map((l) => ({
      servicio_id: l.servicioId,
      profesional_id: l.profesionalId,
      precio_snapshot: l.precioSnapshot,
      descuento: l.descuento ?? 0,
      cantidad: l.cantidad ?? 1,
    })),
  })
  if (error) throw error
  return data as { id: string }
}

export async function completarYCobrarAtencion(params: {
  atencionId: string
  pagos: { metodo: 'efectivo' | 'transferencia' | 'tarjeta' | 'otro'; monto: number }[]
}): Promise<Atencion> {
  const client = supabaseRequerido()
  // Clave de idempotencia estable por navegador+intento: evita doble cobro si la petición
  // se reintenta por un problema de red (ver docs/03-flujos.md §3.3).
  const idempotencyKey = `${params.atencionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  const { data, error } = await client.rpc('fn_completar_y_cobrar_atencion', {
    p_atencion_id: params.atencionId,
    p_pagos: params.pagos,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
  return data as Atencion
}

export async function listarComisiones(
  profesionalId: string,
  desdeISO: string,
  hastaISO: string,
): Promise<ComisionResumen[]> {
  if (isDemoMode) return demoComisionesEmpleada
  const { data, error } = await supabase!
    .from('vista_comision')
    .select('*')
    .eq('profesional_id', profesionalId)
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return data
}

export async function listarReservasDelDia(profesionalId: string, fechaISO: string) {
  if (isDemoMode) return demoReservasAgendaEmpleada
  const desde = `${fechaISO}T00:00:00`
  const hasta = `${fechaISO}T23:59:59`
  const { data, error } = await supabase!
    .from('vista_reserva')
    .select('*')
    .eq('profesional_id', profesionalId)
    .gte('inicio', desde)
    .lte('inicio', hasta)
    .order('inicio')
  if (error) throw error
  return data
}

// Servicios que la profesional registró y cobró hoy directamente desde "Atender", sin pasar
// por una cita (reserva_id null). "Mi día" solo miraba vista_reserva, así que una venta de
// mostrador nunca aparecía ahí ni sumaba a "Servicios realizados"/"Vendido hoy" — ver
// supabase/migrations/0017_vista_atencion_servicio_detalle.sql.
export async function listarAtencionesDelDia(profesionalId: string, fechaISO: string): Promise<VentaLinea[]> {
  if (isDemoMode) return []
  const desde = `${fechaISO}T00:00:00`
  const hasta = `${fechaISO}T23:59:59`
  const { data, error } = await supabase!
    .from('vista_atencion_servicio')
    .select('*')
    .eq('profesional_id', profesionalId)
    .is('reserva_id', null)
    .gte('atencion_creado_en', desde)
    .lte('atencion_creado_en', hasta)
    .order('atencion_creado_en', { ascending: false })
  if (error) throw error
  return data
}

export async function crearLiquidacion(profesionalId: string, periodoInicio: string, periodoFin: string) {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_crear_liquidacion', {
    p_profesional_id: profesionalId,
    p_periodo_inicio: periodoInicio,
    p_periodo_fin: periodoFin,
  })
  if (error) throw error
  return data
}
