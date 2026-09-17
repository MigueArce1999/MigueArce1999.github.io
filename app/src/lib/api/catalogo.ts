import { isDemoMode, supabase } from '../supabase'
import {
  demoCategorias,
  demoProfesionales,
  demoPromociones,
  demoServicios,
} from '../demoData'
import type { CategoriaServicio, ConfiguracionNegocio, Profesional, Promocion, Servicio } from '../types'

const configuracionDemo: ConfiguracionNegocio = {
  moneda: 'COP',
  zona_horaria: 'America/Bogota',
  modo_confirmacion: 'automatica',
  reserva_pendiente_expira_minutos: 30,
  cancelacion_horas_limite: 2,
  tasa_puntos_por_defecto: 0.02,
  anticipacion_minima_reserva_minutos: 0,
  horizonte_reservas_dias: 60,
  margen_entre_citas_minutos: 0,
}

// Solo los campos que le importan al flujo público de reserva (política de cancelación, modo
// de confirmación, cuánto dura una reserva pendiente): configuracion_negocio es de lectura
// pública (0014_rls.sql), la misma fila que ya administra Admin → Configuración.
export async function obtenerConfiguracionNegocio(): Promise<ConfiguracionNegocio> {
  if (isDemoMode) return configuracionDemo
  const { data, error } = await supabase!.from('configuracion_negocio').select('*').maybeSingle()
  if (error) throw error
  return data ?? configuracionDemo
}

export async function listarCategorias(): Promise<CategoriaServicio[]> {
  if (isDemoMode) return demoCategorias
  const { data, error } = await supabase!
    .from('categoria_servicio')
    .select('*')
    .eq('activa', true)
    .order('orden_visualizacion')
  if (error) throw error
  return data
}

export async function listarServicios(categoriaId?: string): Promise<Servicio[]> {
  if (isDemoMode) {
    return categoriaId ? demoServicios.filter((s) => s.categoria_id === categoriaId) : demoServicios
  }
  let query = supabase!
    .from('servicio')
    .select('*, categoria:categoria_id(nombre), servicio_profesional(profesional:profesional_id(*))')
    .eq('activo', true)
  if (categoriaId) query = query.eq('categoria_id', categoriaId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((s: any) => ({
    ...s,
    categoria_nombre: s.categoria?.nombre,
    profesionales: (s.servicio_profesional ?? []).map((sp: any) => sp.profesional),
  }))
}

// Borrado real (no "Desactivar"): la base de datos misma protege el historial real —
// cualquier servicio con una reserva o atención ya registrada bloquea el DELETE (llaves
// foráneas "on delete restrict" en 0004/0005), así que ese caso se traduce a un mensaje
// claro en vez del error técnico de Postgres (código 23503 = violación de llave foránea).
// La política servicio_admin_escribe (0014_rls.sql) ya cubre "for all", incluyendo DELETE.
export async function eliminarServicio(id: string): Promise<void> {
  if (isDemoMode) return
  const { error } = await supabase!.from('servicio').delete().eq('id', id)
  if (error) {
    if (error.code === '23503') {
      throw new Error('Este servicio ya tiene reservas o ventas registradas; no se puede borrar. Usa "Desactivar" en su lugar.')
    }
    throw error
  }
}

// A diferencia de listarServicios (que solo trae los activos, para el sitio público y los
// formularios de reservar/atender), el panel de administración necesita ver también los
// desactivados — si no, "Desactivar" los saca del panel para siempre y ya no se pueden
// reactivar ni borrar una vez que pierdan su historial.
export async function listarServiciosAdmin(categoriaId?: string): Promise<Servicio[]> {
  if (isDemoMode) {
    return categoriaId ? demoServicios.filter((s) => s.categoria_id === categoriaId) : demoServicios
  }
  let query = supabase!
    .from('servicio')
    .select('*, categoria:categoria_id(nombre), servicio_profesional(profesional:profesional_id(*))')
  if (categoriaId) query = query.eq('categoria_id', categoriaId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((s: any) => ({
    ...s,
    categoria_nombre: s.categoria?.nombre,
    profesionales: (s.servicio_profesional ?? []).map((sp: any) => sp.profesional),
  }))
}

export async function obtenerServicio(id: string): Promise<Servicio | null> {
  if (isDemoMode) return demoServicios.find((s) => s.id === id) ?? null
  const { data, error } = await supabase!
    .from('servicio')
    .select('*, categoria:categoria_id(nombre), servicio_profesional(profesional:profesional_id(*))')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    ...data,
    categoria_nombre: (data as any).categoria?.nombre,
    profesionales: ((data as any).servicio_profesional ?? []).map((sp: any) => sp.profesional),
  }
}

export async function listarProfesionales(): Promise<Profesional[]> {
  if (isDemoMode) return demoProfesionales
  const { data, error } = await supabase!
    .from('vista_profesional')
    .select('*')
    .eq('activo', true)
    .order('orden_visualizacion')
  if (error) throw error
  return data as Profesional[]
}

export async function obtenerProfesional(slug: string): Promise<Profesional | null> {
  if (isDemoMode) return demoProfesionales.find((p) => p.slug === slug) ?? null
  const { data, error } = await supabase!.from('vista_profesional').select('*').eq('slug', slug).maybeSingle()
  if (error) throw error
  return data as Profesional | null
}

export async function listarServiciosDeProfesional(profesionalId: string): Promise<Servicio[]> {
  if (isDemoMode) return demoServicios.filter((s) => s.profesionales?.some((p) => p.id === profesionalId))
  const { data, error } = await supabase!
    .from('servicio_profesional')
    .select('servicio:servicio_id(*, categoria:categoria_id(nombre))')
    .eq('profesional_id', profesionalId)
  if (error) throw error
  return (data ?? []).map((row: any) => ({ ...row.servicio, categoria_nombre: row.servicio?.categoria?.nombre }))
}

export async function listarPromocionesVigentes(): Promise<Promocion[]> {
  const ahora = new Date().toISOString()
  if (isDemoMode) {
    return demoPromociones.filter((p) => p.vigente_desde <= ahora && p.vigente_hasta >= ahora)
  }
  const { data, error } = await supabase!
    .from('promocion')
    .select('*, promocion_servicio(servicio_id)')
    .eq('activa', true)
    .lte('vigente_desde', ahora)
    .gte('vigente_hasta', ahora)
  if (error) throw error
  return (data ?? []).map((p: any) => ({
    ...p,
    servicios: (p.promocion_servicio ?? []).map((ps: any) => ps.servicio_id),
  }))
}
