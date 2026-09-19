// Horario habitual, ausencias/bloqueos y sus solicitudes de aprobación — ver
// supabase/migrations/0031_agenda_compartida_esquema.sql y 0032_agenda_compartida_funciones.sql.
// Todas las escrituras sensibles pasan por RPC (SECURITY DEFINER): el frontend nunca hace
// INSERT/UPDATE directo sobre horario_disponibilidad/bloqueo_ausencia/solicitud_horario salvo
// quien tenga el permiso puede_editar_horario_propio (y aun así, vía RPC — ver 0032).
import { isDemoMode, supabaseRequerido } from '../supabase'
import type { BloqueoAusencia, EstadoSolicitud, HorarioDisponibilidad, IntervaloHorario, Reserva, SolicitudHorario, TipoBloqueoAusencia } from '../types'

// fn_reservas_afectadas_bloqueo/horario devuelven `setof reserva` (la fila cruda de la tabla,
// con su columna `rango` tstzrange) — no trae cliente_nombre/servicio_nombre/profesional_nombre
// como sí trae vista_reserva. Para mostrar conflictos legibles ("cita de Fulanita el martes a
// las 3pm"), se resuelven los ids devueltos contra vista_reserva en un segundo paso: el mismo
// filtro de RLS que ya deja llamar a estas funciones (admin, la propia profesional, o
// puede_ver_agenda_equipo) también deja leer esas filas en vista_reserva.
async function resolverContraVistaReserva(ids: string[]): Promise<Reserva[]> {
  if (ids.length === 0) return []
  const client = supabaseRequerido()
  const { data, error } = await client.from('vista_reserva').select('*').in('id', ids)
  if (error) throw error
  return (data ?? []).map((row: any) => ({
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
  }))
}

// --- Horario habitual --------------------------------------------------------------------

// Trae TODAS las filas históricas de una profesional y devuelve solo la versión vigente para
// la fecha de referencia (por defecto, hoy): la misma regla que aplica fn_disponibilidad en
// el servidor (última vigente_desde <= fecha). Se resuelve en el cliente porque el volumen por
// profesional es mínimo (unas pocas versiones de a lo sumo un puñado de intervalos cada una).
export async function obtenerHorarioVigente(profesionalId: string, fechaReferencia?: string): Promise<HorarioDisponibilidad[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client
    .from('horario_disponibilidad')
    .select('*')
    .eq('profesional_id', profesionalId)
    .order('vigente_desde', { ascending: false })
  if (error) throw error
  const filas = (data ?? []) as HorarioDisponibilidad[]
  const ref = fechaReferencia ?? new Date().toISOString().slice(0, 10)
  const version = filas.find((f) => f.vigente_desde <= ref)?.vigente_desde
  if (!version) return []
  return filas.filter((f) => f.vigente_desde === version && f.activo)
}

// Próxima versión ya programada (vigente_desde en el futuro), si alguien ya guardó/aprobó un
// cambio que todavía no entra en vigor — para mostrarla como "A partir del [fecha]: ...".
export async function obtenerProximoHorario(profesionalId: string): Promise<{ vigenteDesde: string; intervalos: IntervaloHorario[] } | null> {
  if (isDemoMode) return null
  const client = supabaseRequerido()
  const hoy = new Date().toISOString().slice(0, 10)
  const { data, error } = await client
    .from('horario_disponibilidad')
    .select('*')
    .eq('profesional_id', profesionalId)
    .gt('vigente_desde', hoy)
    .order('vigente_desde', { ascending: true })
  if (error) throw error
  const filas = (data ?? []) as HorarioDisponibilidad[]
  if (filas.length === 0) return null
  const version = filas[0].vigente_desde
  return {
    vigenteDesde: version,
    intervalos: filas.filter((f) => f.vigente_desde === version).map((f) => ({ dia_semana: f.dia_semana, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin })),
  }
}

export async function solicitarHorario(params: {
  profesionalId: string
  intervalos: IntervaloHorario[]
  vigenteDesde: string
  motivo?: string | null
}): Promise<SolicitudHorario> {
  if (isDemoMode) throw new Error('En modo demostración no se pueden guardar cambios de horario.')
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_solicitar_horario', {
    p_profesional_id: params.profesionalId,
    p_intervalos: params.intervalos,
    p_vigente_desde: params.vigenteDesde,
    p_motivo: params.motivo ?? null,
  })
  if (error) throw error
  return data as SolicitudHorario
}

export async function reservasAfectadasPorHorario(profesionalId: string, intervalos: IntervaloHorario[], vigenteDesde: string): Promise<Reserva[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_reservas_afectadas_horario', {
    p_profesional_id: profesionalId,
    p_intervalos: intervalos,
    p_desde: vigenteDesde,
  })
  if (error) throw error
  return resolverContraVistaReserva((data ?? []).map((r: any) => r.id))
}

export async function listarSolicitudesHorario(profesionalId?: string, estado?: EstadoSolicitud): Promise<SolicitudHorario[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  let query = client.from('solicitud_horario').select('*').order('creado_en', { ascending: false })
  if (profesionalId) query = query.eq('profesional_id', profesionalId)
  if (estado) query = query.eq('estado', estado)
  const { data, error } = await query
  if (error) throw error
  const filas = data ?? []
  const nombres = await nombresDeProfesionales(filas.map((r: any) => r.profesional_id))
  return filas.map((r: any) => ({ ...r, profesional_nombre: nombres.get(r.profesional_id) }))
}

export async function aprobarSolicitudHorario(id: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_aprobar_solicitud_horario', { p_id: id })
  if (error) throw error
}

export async function rechazarSolicitudHorario(id: string, motivo: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_rechazar_solicitud_horario', { p_id: id, p_motivo: motivo })
  if (error) throw error
}

export async function retirarSolicitudHorario(id: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_retirar_solicitud_horario', { p_id: id })
  if (error) throw error
}

// --- Ausencias y bloqueos ------------------------------------------------------------------

// Postgres serializa un tstzrange como texto con cada extremo entre comillas, p. ej.
// `["2026-01-01 08:00:00+00","2026-01-01 09:00:00+00")` — se parsea una sola vez aquí en vez
// de repetirlo en cada pantalla que lista bloqueos.
function parseRango(texto: string | null | undefined): { inicio: string; fin: string } {
  const match = /\["?([^",]+)"?,\s*"?([^",)]+)"?[)\]]/.exec(texto ?? '')
  return { inicio: match?.[1] ?? '', fin: match?.[2] ?? '' }
}

function mapBloqueo(row: any, nombresPorId: Map<string, string>): BloqueoAusencia {
  const { inicio, fin } = parseRango(row.rango)
  return {
    id: row.id,
    profesional_id: row.profesional_id,
    profesional_nombre: nombresPorId.get(row.profesional_id),
    rango_inicio: inicio,
    rango_fin: fin,
    motivo: row.motivo,
    tipo: row.tipo,
    todo_el_dia: row.todo_el_dia,
    estado: row.estado,
    creado_por: row.creado_por,
    creado_en: row.creado_en,
    revisado_por: row.revisado_por,
    revisado_en: row.revisado_en,
    motivo_rechazo: row.motivo_rechazo,
  }
}

// Nombres de profesionales para un conjunto de ids, vía vista_profesional (ya trae el nombre
// resuelto desde perfil — ver 0015_vistas.sql). Reutilizado por listarBloqueosAusencias y
// listarSolicitudesHorario en vez de intentar un embed anidado profesional->perfil por REST.
async function nombresDeProfesionales(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Map()
  const client = supabaseRequerido()
  const { data, error } = await client.from('vista_profesional').select('id, nombre').in('id', unicos)
  if (error) throw error
  return new Map((data ?? []).map((p: any) => [p.id, p.nombre]))
}

export async function listarBloqueosAusencias(profesionalId?: string, estado?: EstadoSolicitud): Promise<BloqueoAusencia[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  let query = client.from('bloqueo_ausencia').select('*').order('creado_en', { ascending: false })
  if (profesionalId) query = query.eq('profesional_id', profesionalId)
  if (estado) query = query.eq('estado', estado)
  const { data, error } = await query
  if (error) throw error
  const filas = data ?? []
  const nombres = await nombresDeProfesionales(filas.map((r: any) => r.profesional_id))
  return filas.map((row: any) => mapBloqueo(row, nombres))
}

export async function solicitarBloqueo(params: {
  profesionalId: string
  tipo: TipoBloqueoAusencia
  desdeISO: string
  hastaISO: string
  todoElDia: boolean
  motivo?: string | null
}): Promise<BloqueoAusencia> {
  if (isDemoMode) throw new Error('En modo demostración no se pueden crear bloqueos.')
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_solicitar_bloqueo', {
    p_profesional_id: params.profesionalId,
    p_tipo: params.tipo,
    p_desde: params.desdeISO,
    p_hasta: params.hastaISO,
    p_todo_el_dia: params.todoElDia,
    p_motivo: params.motivo ?? null,
  })
  if (error) throw error
  return mapBloqueo(data, new Map())
}

export async function reservasAfectadasPorBloqueo(profesionalId: string, desdeISO: string, hastaISO: string): Promise<Reserva[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_reservas_afectadas_bloqueo', {
    p_profesional_id: profesionalId,
    p_rango: `[${desdeISO},${hastaISO})`,
  })
  if (error) throw error
  return resolverContraVistaReserva((data ?? []).map((r: any) => r.id))
}

export async function aprobarSolicitudBloqueo(id: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_aprobar_solicitud_bloqueo', { p_id: id })
  if (error) throw error
}

export async function rechazarSolicitudBloqueo(id: string, motivo: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_rechazar_solicitud_bloqueo', { p_id: id, p_motivo: motivo })
  if (error) throw error
}

export async function retirarSolicitudBloqueo(id: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.rpc('fn_retirar_solicitud_bloqueo', { p_id: id })
  if (error) throw error
}
