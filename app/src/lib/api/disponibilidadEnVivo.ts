// GlowDesk Live — capa de datos (Fase 3). Envuelve las funciones de
// supabase/migrations/0060/0061_glowdesk_live_*.sql; ninguna regla de disponibilidad se
// recalcula aquí — el motor SQL es la única fuente de verdad (sección 7 del pedido).
import { isDemoMode, LOCAL_ID, supabase, supabaseRequerido } from '../supabase'
import { demoProfesionales, demoServicios, demoClienteActual } from '../demoData'
import { emitirCambioDemo } from '../disponibilidadEnVivo/eventosDemo'
import type {
  EstadoManualProfesional,
  EstadoProfesionalAhora,
  SalonEnVivo,
  SolicitudDisponibilidad,
  ZonaSalon,
} from '../types'

// ---------------------------------------------------------------------------
// Motor: lectura de disponibilidad
// ---------------------------------------------------------------------------

export async function obtenerEstadoProfesionalAhora(
  profesionalId: string,
  servicioId?: string | null,
): Promise<EstadoProfesionalAhora> {
  if (isDemoMode) return demoEstadoProfesional(profesionalId, servicioId)
  const { data, error } = await supabase!.rpc('fn_estado_profesional_ahora', {
    p_profesional_id: profesionalId,
    p_servicio_id: servicioId ?? null,
  })
  if (error) throw error
  return data as EstadoProfesionalAhora
}

export async function obtenerSalonEnVivo(servicioId?: string | null): Promise<SalonEnVivo> {
  if (isDemoMode) return demoSalonEnVivo(servicioId)
  const { data, error } = await supabase!.rpc('fn_salon_en_vivo', { p_servicio_id: servicioId ?? null })
  if (error) throw error
  return data as SalonEnVivo
}

// ---------------------------------------------------------------------------
// Zonas del salón (CRUD de administración, mismo patrón que categoria_servicio)
// ---------------------------------------------------------------------------

export async function listarZonas(): Promise<ZonaSalon[]> {
  if (isDemoMode) return demoZonas
  const { data, error } = await supabase!
    .from('zona_salon')
    .select('id, nombre, icono, orden_visualizacion, activa')
    .order('orden_visualizacion')
  if (error) throw error
  return data ?? []
}

export async function crearZona(params: { nombre: string; icono?: string | null }): Promise<ZonaSalon> {
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('zona_salon')
    .insert({ nombre: params.nombre, icono: params.icono ?? null, local_id: LOCAL_ID })
    .select('id, nombre, icono, orden_visualizacion, activa')
    .single()
  if (error) throw error
  return data
}

export async function actualizarZona(
  zonaId: string,
  cambios: Partial<{ nombre: string; icono: string | null; orden_visualizacion: number; activa: boolean }>,
): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('zona_salon').update(cambios).eq('id', zonaId)
  if (error) throw error
}

export async function eliminarZona(zonaId: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('zona_salon').delete().eq('id', zonaId)
  if (error) throw error
}

export async function listarZonasDeProfesional(profesionalId: string): Promise<string[]> {
  if (isDemoMode) return demoAsignacionZonas[profesionalId] ?? []
  const { data, error } = await supabase!.from('profesional_zona').select('zona_id').eq('profesional_id', profesionalId)
  if (error) throw error
  return (data ?? []).map((r) => r.zona_id)
}

export async function asignarProfesionalAZona(profesionalId: string, zonaId: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('profesional_zona').insert({ profesional_id: profesionalId, zona_id: zonaId, local_id: LOCAL_ID })
  if (error) throw error
}

export async function quitarProfesionalDeZona(profesionalId: string, zonaId: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('profesional_zona').delete().eq('profesional_id', profesionalId).eq('zona_id', zonaId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Estado manual de la profesional ("Mi disponibilidad")
// ---------------------------------------------------------------------------

// 'disponible' no es un estado manual real (fn_marcar_estado_manual lo rechaza) — es el botón
// de la UI que significa "quita cualquier override", así que se traduce a limpiarEstadoManual().
export async function marcarEstadoManual(
  estado: Exclude<EstadoManualProfesional, 'disponible'>,
  minutos: number,
  motivo?: string | null,
): Promise<void> {
  if (isDemoMode) {
    demoEstadoManual = { estado, hasta: new Date(Date.now() + minutos * 60_000).toISOString(), motivo: motivo ?? null }
    emitirCambioDemo()
    return
  }
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_marcar_estado_manual', { p_estado: estado, p_minutos: minutos, p_motivo: motivo ?? null })
  if (error) throw error
}

export async function limpiarEstadoManual(): Promise<void> {
  if (isDemoMode) {
    demoEstadoManual = null
    emitirCambioDemo()
    return
  }
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_limpiar_estado_manual')
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Solicitudes de disponibilidad ("¿puedes atenderme ahora?")
// ---------------------------------------------------------------------------

export async function crearSolicitudDisponibilidad(params: {
  clienteId: string
  profesionalId: string
  servicioId: string
  llegadaMinutos: number
  idempotencyKey: string
}): Promise<SolicitudDisponibilidad> {
  if (isDemoMode) {
    const resultado = demoCrearSolicitud(params)
    emitirCambioDemo()
    return resultado
  }
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_crear_solicitud_disponibilidad', {
    p_cliente_id: params.clienteId,
    p_profesional_id: params.profesionalId,
    p_servicio_id: params.servicioId,
    p_llegada_minutos: params.llegadaMinutos,
    p_idempotency_key: params.idempotencyKey,
  })
  if (error) throw error
  return data as SolicitudDisponibilidad
}

export async function responderSolicitudDisponibilidad(
  solicitudId: string,
  respuesta: 'aceptar' | 'rechazar' | 'mas_tarde',
  disponibleEnMinutos?: number,
): Promise<SolicitudDisponibilidad> {
  if (isDemoMode) {
    const resultado = demoResponderSolicitud(solicitudId, respuesta, disponibleEnMinutos)
    emitirCambioDemo()
    return resultado
  }
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_responder_solicitud_disponibilidad', {
    p_solicitud_id: solicitudId,
    p_respuesta: respuesta,
    p_disponible_en_minutos: disponibleEnMinutos ?? null,
  })
  if (error) throw error
  return data as SolicitudDisponibilidad
}

export async function marcarClienteEnCamino(solicitudId: string): Promise<SolicitudDisponibilidad> {
  if (isDemoMode) {
    const resultado = demoMarcarEnCamino(solicitudId)
    emitirCambioDemo()
    return resultado
  }
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_marcar_cliente_en_camino', { p_solicitud_id: solicitudId })
  if (error) throw error
  return data as SolicitudDisponibilidad
}

export async function cancelarSolicitudDisponibilidad(solicitudId: string): Promise<SolicitudDisponibilidad> {
  if (isDemoMode) {
    const resultado = demoCancelarSolicitud(solicitudId)
    emitirCambioDemo()
    return resultado
  }
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_cancelar_solicitud_disponibilidad', { p_solicitud_id: solicitudId })
  if (error) throw error
  return data as SolicitudDisponibilidad
}

export async function listarSolicitudesProfesional(): Promise<SolicitudDisponibilidad[]> {
  if (isDemoMode) return demoSolicitudes.filter((s) => ['pendiente', 'aceptada', 'cliente_en_camino'].includes(s.estado))
  const { data, error } = await supabase!.rpc('fn_listar_solicitudes_profesional')
  if (error) throw error
  return (data ?? []) as SolicitudDisponibilidad[]
}

export async function listarMisSolicitudes(clienteId: string): Promise<SolicitudDisponibilidad[]> {
  if (isDemoMode) return demoSolicitudes.filter((s) => s.cliente_id_demo === clienteId).map(sinCampoDemo)
  const { data, error } = await supabase!.rpc('fn_listar_mis_solicitudes', { p_cliente_id: clienteId })
  if (error) throw error
  return (data ?? []) as SolicitudDisponibilidad[]
}

// Lectura independiente de UNA solicitud (para el hook de Realtime de la clienta, que necesita
// releer tras cada aviso del pulso sin depender de la lista completa). El servidor valida
// pertenencia (fn_obtener_solicitud_disponibilidad, 0062) — nunca se confía en que el frontend
// solo pida las suyas.
export async function obtenerSolicitudDisponibilidad(solicitudId: string): Promise<SolicitudDisponibilidad> {
  if (isDemoMode) return sinCampoDemo(demoBuscar(solicitudId))
  const { data, error } = await supabase!.rpc('fn_obtener_solicitud_disponibilidad', { p_id: solicitudId })
  if (error) throw error
  return data as SolicitudDisponibilidad
}

// ---------------------------------------------------------------------------
// Demo mode: estado en memoria, solo para esta pestaña — igual convención que
// demoCanjesExtra/demoSaldoOverride en lib/api/fidelizacion.ts.
// ---------------------------------------------------------------------------

const demoZonas: ZonaSalon[] = [
  { id: 'demo-zona-cabello', nombre: 'Cabello', icono: null, orden_visualizacion: 1, activa: true },
  { id: 'demo-zona-cejas', nombre: 'Cejas y maquillaje', icono: null, orden_visualizacion: 2, activa: true },
  { id: 'demo-zona-unas', nombre: 'Manicura y pedicura', icono: null, orden_visualizacion: 3, activa: true },
]

const demoAsignacionZonas: Record<string, string[]> = {
  'demo-prof-claudia': ['demo-zona-cabello'],
  'demo-prof-naldi': ['demo-zona-cabello'],
  'demo-prof-ana': ['demo-zona-cejas'],
  'demo-prof-valery': ['demo-zona-unas'],
}

// Guiones fijos por profesional demo, solo para que la pantalla se vea completa y variada sin
// necesitar agenda real — no es el motor, es una vitrina. minutosBase se usa para simular el
// paso del tiempo dentro de la misma sesión (ending_soon avanza de verdad si se deja abierta).
const DEMO_GUION: Record<string, { status: EstadoProfesionalAhora['status']; minutosRestantes?: number; minutosLibres?: number }> = {
  'demo-prof-claudia': { status: 'busy', minutosRestantes: 35 },
  'demo-prof-naldi': { status: 'available', minutosLibres: 120 },
  'demo-prof-ana': { status: 'ending_soon', minutosRestantes: 8 },
  'demo-prof-valery': { status: 'upcoming_appointment', minutosLibres: 25 },
}

let demoEstadoManual: { estado: EstadoManualProfesional; hasta: string; motivo: string | null } | null = null

function demoEstadoProfesional(profesionalId: string, servicioId?: string | null): EstadoProfesionalAhora {
  if (demoEstadoManual && demoEstadoManual.estado !== 'disponible' && new Date(demoEstadoManual.hasta) > new Date()) {
    return {
      status: 'unavailable',
      razon: demoEstadoManual.estado,
      disponible_ahora: false,
      disponible_hasta: null,
      proxima_disponible_en: demoEstadoManual.hasta,
      minutos_libres: null,
      puede_atender_servicio: false,
    }
  }

  const guion = DEMO_GUION[profesionalId]
  if (!guion) {
    return {
      status: 'unavailable', razon: 'fuera_de_horario', disponible_ahora: false,
      disponible_hasta: null, proxima_disponible_en: null, minutos_libres: null, puede_atender_servicio: false,
    }
  }

  const ahora = Date.now()
  if (guion.status === 'busy' || guion.status === 'ending_soon') {
    const fin = new Date(ahora + (guion.minutosRestantes ?? 20) * 60_000).toISOString()
    return {
      status: guion.status, razon: 'servicio_activo', disponible_ahora: false,
      disponible_hasta: null, proxima_disponible_en: fin, minutos_libres: null, puede_atender_servicio: false,
    }
  }

  const minutosLibres = guion.minutosLibres ?? 60
  const servicio = servicioId ? demoServicios.find((s) => s.id === servicioId) : null
  const puedeAtender = servicio?.duracion_minutos != null ? servicio.duracion_minutos <= minutosLibres : servicio ? null : true
  return {
    status: guion.status, razon: null, disponible_ahora: true,
    disponible_hasta: new Date(ahora + minutosLibres * 60_000).toISOString(),
    proxima_disponible_en: null, minutos_libres: minutosLibres, puede_atender_servicio: puedeAtender,
  }
}

function demoSalonEnVivo(servicioId?: string | null): SalonEnVivo {
  const profesionales = demoProfesionales.map((p) => ({
    profesional_id: p.id,
    nombre: p.nombre,
    foto_url: p.foto_url,
    zonas: demoAsignacionZonas[p.id] ?? [],
    estado: demoEstadoProfesional(p.id, servicioId),
  }))
  const disponibles = profesionales.filter((p) => p.estado.status === 'available' || p.estado.status === 'upcoming_appointment').length
  const demanda = disponibles / profesionales.length >= 0.5 ? 'tranquilo' : disponibles > 0 ? 'movimiento_medio' : 'alta_demanda'
  return { activo: true, demanda, actualizado_en: new Date().toISOString(), zonas: demoZonas, profesionales }
}

interface DemoSolicitud extends SolicitudDisponibilidad {
  cliente_id_demo: string
}

function sinCampoDemo(s: DemoSolicitud): SolicitudDisponibilidad {
  const { cliente_id_demo: _omit, ...resto } = s
  return resto
}

const demoSolicitudes: DemoSolicitud[] = []
let demoContadorSolicitud = 0

function demoCrearSolicitud(params: {
  clienteId: string; profesionalId: string; servicioId: string; llegadaMinutos: number; idempotencyKey: string
}): SolicitudDisponibilidad {
  const existente = demoSolicitudes.find((s) => s.id === `demo-sol-${params.idempotencyKey}`)
  if (existente) return sinCampoDemo(existente)
  if (demoSolicitudes.some((s) => s.cliente_id_demo === params.clienteId && s.profesional_id === params.profesionalId && s.estado === 'pendiente')) {
    throw new Error('Ya tienes una solicitud pendiente con esta profesional.')
  }
  const profesional = demoProfesionales.find((p) => p.id === params.profesionalId)
  const servicio = demoServicios.find((s) => s.id === params.servicioId)
  demoContadorSolicitud += 1
  const nueva: DemoSolicitud = {
    id: `demo-sol-${params.idempotencyKey || demoContadorSolicitud}`,
    cliente_id_demo: params.clienteId,
    estado: 'pendiente',
    expira_en: new Date(Date.now() + 3 * 60_000).toISOString(),
    disponible_desde: null,
    llegada_minutos: params.llegadaMinutos,
    profesional_id: params.profesionalId,
    profesional_nombre: profesional?.nombre ?? 'Profesional',
    servicio_id: params.servicioId,
    servicio_nombre: servicio?.nombre ?? 'Servicio',
    creado_en: new Date().toISOString(),
    respondido_en: null,
  }
  demoSolicitudes.push(nueva)
  return sinCampoDemo(nueva)
}

function demoBuscar(solicitudId: string): DemoSolicitud {
  const s = demoSolicitudes.find((s) => s.id === solicitudId)
  if (!s) throw new Error('Solicitud no encontrada (modo demo).')
  return s
}

function demoResponderSolicitud(
  solicitudId: string, respuesta: 'aceptar' | 'rechazar' | 'mas_tarde', disponibleEnMinutos?: number,
): SolicitudDisponibilidad {
  const s = demoBuscar(solicitudId)
  if (s.estado !== 'pendiente') throw new Error(`Esta solicitud ya fue respondida (${s.estado}).`)
  s.respondido_en = new Date().toISOString()
  if (respuesta === 'aceptar') {
    s.estado = 'aceptada'
    demoEstadoManual = { estado: 'ocupado_temporal', hasta: new Date(Date.now() + 20 * 60_000).toISOString(), motivo: 'cliente_en_camino' }
  } else if (respuesta === 'rechazar') {
    s.estado = 'rechazada'
  } else {
    s.estado = 'aceptada_luego'
    s.disponible_desde = new Date(Date.now() + (disponibleEnMinutos ?? 30) * 60_000).toISOString()
  }
  return sinCampoDemo(s)
}

function demoMarcarEnCamino(solicitudId: string): SolicitudDisponibilidad {
  const s = demoBuscar(solicitudId)
  if (s.estado !== 'aceptada') throw new Error(`Esta solicitud no está aceptada (${s.estado}).`)
  s.estado = 'cliente_en_camino'
  return sinCampoDemo(s)
}

function demoCancelarSolicitud(solicitudId: string): SolicitudDisponibilidad {
  const s = demoBuscar(solicitudId)
  if (!['pendiente', 'aceptada', 'aceptada_luego'].includes(s.estado)) {
    throw new Error(`Esta solicitud ya no se puede cancelar (${s.estado}).`)
  }
  s.estado = 'cancelada'
  return sinCampoDemo(s)
}

// Referencia usada por defecto cuando una pantalla demo necesita "la clienta actual" sin pasar
// el id explícitamente (mismo patrón que el resto de módulos demo de este proyecto).
export const clienteDemoActualId = demoClienteActual.id
