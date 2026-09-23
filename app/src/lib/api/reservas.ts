import { isDemoMode, LOCAL_ID, supabase, supabaseRequerido } from '../supabase'
import { demoReservasAgendaEmpleada, demoReservasCliente } from '../demoData'
import type { Reserva, SlotDisponible, SlotEquipoDisponible } from '../types'

export async function consultarDisponibilidad(
  servicioId: string,
  profesionalId: string,
  fechaISO: string,
): Promise<SlotDisponible[]> {
  if (isDemoMode) {
    // En modo demo se simulan slots cada hora entre 9am y 5pm del día pedido.
    const base = new Date(`${fechaISO}T09:00:00-05:00`)
    const slots: SlotDisponible[] = []
    for (let h = 0; h < 8; h++) {
      const inicio = new Date(base.getTime() + h * 60 * 60 * 1000)
      const fin = new Date(inicio.getTime() + 60 * 60 * 1000)
      slots.push({ inicio: inicio.toISOString(), fin: fin.toISOString() })
    }
    return slots
  }
  const { data, error } = await supabase!.rpc('fn_disponibilidad', {
    p_servicio_id: servicioId,
    p_profesional_id: profesionalId,
    p_fecha: fechaISO,
  })
  if (error) throw error
  return (data ?? []).map((row: any) => ({ inicio: row.inicio, fin: row.fin }))
}

// Disponibilidad agregada de un grupo de profesionales elegibles para un servicio ("Cualquier
// profesional"): un mismo horario aparece una sola vez con la lista de quiénes lo tienen
// libre — ver fn_disponibilidad_equipo en 0032_agenda_compartida_funciones.sql.
export async function consultarDisponibilidadEquipo(
  servicioId: string,
  profesionalIds: string[],
  fechaISO: string,
): Promise<SlotEquipoDisponible[]> {
  if (isDemoMode) {
    const base = new Date(`${fechaISO}T09:00:00-05:00`)
    const slots: SlotEquipoDisponible[] = []
    for (let h = 0; h < 8; h++) {
      const inicio = new Date(base.getTime() + h * 60 * 60 * 1000)
      const fin = new Date(inicio.getTime() + 60 * 60 * 1000)
      slots.push({ inicio: inicio.toISOString(), fin: fin.toISOString(), profesionales_disponibles: profesionalIds })
    }
    return slots
  }
  if (profesionalIds.length === 0) return []
  const { data, error } = await supabase!.rpc('fn_disponibilidad_equipo', {
    p_servicio_id: servicioId,
    p_profesional_ids: profesionalIds,
    p_fecha: fechaISO,
  })
  if (error) throw error
  return (data ?? []).map((row: any) => ({ inicio: row.inicio, fin: row.fin, profesionales_disponibles: row.profesionales_disponibles ?? [] }))
}

export async function crearReserva(params: {
  clienteId: string
  servicioId: string
  profesionalId: string
  inicioISO: string
  origen?: 'cliente' | 'recepcion' | 'admin'
}): Promise<Reserva> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_crear_reserva', {
    p_cliente_id: params.clienteId,
    p_servicio_id: params.servicioId,
    p_profesional_id: params.profesionalId,
    p_inicio: params.inicioISO,
    p_origen: params.origen ?? 'cliente',
  })
  if (error) throw error
  return data as Reserva
}

// "Cualquier profesional": el servidor intenta cada candidata elegible en orden hasta que una
// consiga reservar de verdad (fn_crear_reserva_cualquier_profesional, ver 0032) — nunca deja
// una reserva sin responsable, y decide con el mismo EXCLUDE constraint que evita dobles citas.
export async function crearReservaCualquierProfesional(params: {
  clienteId: string
  servicioId: string
  profesionalIds: string[]
  inicioISO: string
  origen?: 'cliente' | 'recepcion' | 'admin'
}): Promise<Reserva> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_crear_reserva_cualquier_profesional', {
    p_cliente_id: params.clienteId,
    p_servicio_id: params.servicioId,
    p_profesional_ids: params.profesionalIds,
    p_inicio: params.inicioISO,
    p_origen: params.origen ?? 'cliente',
  })
  if (error) throw error
  return data as Reserva
}

export async function cancelarReserva(reservaId: string, motivo: string) {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_cancelar_reserva', { p_reserva_id: reservaId, p_motivo: motivo })
  if (error) throw error
}

export async function reprogramarReserva(reservaId: string, nuevoInicioISO: string, nuevoProfesionalId?: string) {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_reprogramar_reserva', {
    p_reserva_id: reservaId,
    p_nuevo_inicio: nuevoInicioISO,
    p_nuevo_profesional_id: nuevoProfesionalId ?? null,
  })
  if (error) throw error
}

export async function reasignarReserva(reservaId: string, nuevoProfesionalId: string) {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_reasignar_reserva', {
    p_reserva_id: reservaId,
    p_nuevo_profesional_id: nuevoProfesionalId,
  })
  if (error) throw error
}

// Confirmar manualmente una reserva 'pendiente' (modo de confirmación manual). El servidor
// purga primero las pendientes vencidas, así nunca se confirma una que ya venció sin revisión.
export async function confirmarReservaPendiente(reservaId: string) {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_confirmar_reserva_pendiente', { p_reserva_id: reservaId })
  if (error) throw error
}

export async function marcarNoAsistio(reservaId: string) {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_marcar_no_asistio', { p_reserva_id: reservaId })
  if (error) throw error
}

export async function listarReservasDeCliente(clienteId: string): Promise<Reserva[]> {
  if (isDemoMode) return demoReservasCliente
  const { data, error } = await supabase!
    .from('vista_reserva')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('local_id', LOCAL_ID)
    .order('inicio', { ascending: false })
  if (error) throw error
  return (data ?? []).map(mapVistaReserva)
}

export async function listarReservasDeProfesional(
  profesionalId: string,
  desdeISO: string,
  hastaISO: string,
): Promise<Reserva[]> {
  if (isDemoMode) return demoReservasAgendaEmpleada
  const { data, error } = await supabase!
    .from('vista_reserva')
    .select('*')
    .eq('profesional_id', profesionalId)
    .eq('local_id', LOCAL_ID)
    .gte('inicio', desdeISO)
    .lt('inicio', hastaISO)
    .order('inicio')
  if (error) throw error
  return (data ?? []).map(mapVistaReserva)
}

export async function listarAgendaGeneral(desdeISO: string, hastaISO: string): Promise<Reserva[]> {
  if (isDemoMode) return demoReservasAgendaEmpleada
  const { data, error } = await supabase!
    .from('vista_reserva')
    .select('*')
    .eq('local_id', LOCAL_ID)
    .gte('inicio', desdeISO)
    .lt('inicio', hastaISO)
    .order('inicio')
  if (error) throw error
  return (data ?? []).map(mapVistaReserva)
}

export async function obtenerReservaPorId(reservaId: string): Promise<Reserva | null> {
  if (isDemoMode) return demoReservasAgendaEmpleada.find((r) => r.id === reservaId) ?? null
  const { data, error } = await supabase!.from('vista_reserva').select('*').eq('id', reservaId).eq('local_id', LOCAL_ID).maybeSingle()
  if (error) throw error
  return data ? mapVistaReserva(data) : null
}

// Una cita "completada" no implica que ya se cobró — distinguir esos dos hechos es justamente
// para qué existe vista_atencion (total_vendido vs total_pagado, ver 0015_vistas.sql).
export async function obtenerAtencionDeReserva(reservaId: string): Promise<{ totalVendido: number; totalPagado: number } | null> {
  if (isDemoMode) return null
  const { data, error } = await supabase!.from('vista_atencion').select('total_vendido, total_pagado').eq('reserva_id', reservaId).maybeSingle()
  if (error) throw error
  return data ? { totalVendido: Number(data.total_vendido), totalPagado: Number(data.total_pagado) } : null
}

function mapVistaReserva(row: any): Reserva {
  return {
    id: row.id,
    cliente_id: row.cliente_id,
    cliente_nombre: row.cliente_nombre,
    servicio_id: row.servicio_id,
    servicio_nombre: row.servicio_nombre,
    profesional_id: row.profesional_id,
    profesional_nombre: row.profesional_nombre,
    rango_inicio: row.inicio,
    rango_fin: row.fin,
    precio_estimado: row.precio_estimado,
    estado: row.estado,
    origen: row.origen,
    notas: row.notas,
  }
}
