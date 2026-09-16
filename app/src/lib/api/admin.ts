import { isDemoMode, supabaseRequerido } from '../supabase'
import { demoClientesAdmin, demoEquipoResumen, demoResumenNegocio } from '../demoData'
import type { Cliente } from '../types'

// Fórmulas del resumen (ver docs/01-arquitectura-informacion.md y docs/03-flujos.md):
// - ventas netas = suma de atencion_servicio (precio_snapshot - descuento) * cantidad de
//   atenciones completadas en el periodo (ventas realizadas, no reservas futuras).
// - cobros = suma de pago.monto (incluye devoluciones, que son negativas) en el periodo.
// - ticket promedio = ventas netas / número de atenciones completadas.
export async function resumenNegocio(desdeISO: string, hastaISO: string) {
  if (isDemoMode) return demoResumenNegocio
  const client = supabaseRequerido()

  const { data: atenciones, error: e1 } = await client
    .from('vista_atencion')
    .select('id, total_vendido, total_pagado, estado, creado_en, cliente_id')
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  if (e1) throw e1

  const completadas = (atenciones ?? []).filter((a) => a.estado === 'completada')
  const ventasNetas = completadas.reduce((acc, a) => acc + Number(a.total_vendido), 0)
  const cobros = completadas.reduce((acc, a) => acc + Number(a.total_pagado), 0)

  const { data: reservas, error: e2 } = await client
    .from('reserva')
    .select('id, estado')
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  if (e2) throw e2
  const cancelaciones = (reservas ?? []).filter((r) => r.estado === 'cancelada').length
  const inasistencias = (reservas ?? []).filter((r) => r.estado === 'no_asistio').length

  const { data: comisiones, error: e3 } = await client
    .from('comision')
    .select('valor, estado')
    .gte('creado_en', desdeISO)
    .lt('creado_en', hastaISO)
  if (e3) throw e3
  const comisionesGeneradas = (comisiones ?? []).reduce((acc, c) => acc + Number(c.valor), 0)
  const comisionesPendientes = (comisiones ?? [])
    .filter((c) => c.estado === 'generada')
    .reduce((acc, c) => acc + Number(c.valor), 0)

  return {
    ventasNetas,
    cobros,
    citasCompletadas: completadas.length,
    ticketPromedio: completadas.length ? ventasNetas / completadas.length : 0,
    cancelaciones,
    inasistencias,
    comisionesGeneradas,
    comisionesPendientes,
    clientesNuevos: 0, // requiere comparar cliente.creado_en contra el periodo; ver Fase 2
    clientesRecurrentes: 0,
  }
}

export async function listarClientes(busqueda?: string): Promise<Cliente[]> {
  if (isDemoMode) {
    const q = busqueda?.toLowerCase()
    return q ? demoClientesAdmin.filter((c) => c.nombre.toLowerCase().includes(q)) : demoClientesAdmin
  }
  const client = supabaseRequerido()
  let query = client.from('cliente').select('*').order('nombre')
  if (busqueda) query = query.or(`nombre.ilike.%${busqueda}%,telefono.ilike.%${busqueda}%,email.ilike.%${busqueda}%`)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function listarEquipoConRendimiento() {
  if (isDemoMode) return demoEquipoResumen
  const client = supabaseRequerido()
  const { data, error } = await client.from('vista_profesional').select('*').order('orden_visualizacion')
  if (error) throw error
  return data
}
