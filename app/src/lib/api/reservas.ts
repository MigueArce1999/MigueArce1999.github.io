import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
import { demoReservasAgendaEmpleada, demoReservasCliente } from '../demoData'
import type { Reserva, SlotDisponible } from '../types'

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

export async function cancelarReserva(reservaId: string, motivo: string) {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_cancelar_reserva', { p_reserva_id: reservaId, p_motivo: motivo })
  if (error) throw error
}

export async function reprogramarReserva(reservaId: string, nuevoInicioISO: string) {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_reprogramar_reserva', {
    p_reserva_id: reservaId,
    p_nuevo_inicio: nuevoInicioISO,
  })
  if (error) throw error
}

export async function listarReservasDeCliente(clienteId: string): Promise<Reserva[]> {
  if (isDemoMode) return demoReservasCliente
  const { data, error } = await supabase!
    .from('vista_reserva')
    .select('*')
    .eq('cliente_id', clienteId)
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
    .gte('inicio', desdeISO)
    .lt('inicio', hastaISO)
    .order('inicio')
  if (error) throw error
  return (data ?? []).map(mapVistaReserva)
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
