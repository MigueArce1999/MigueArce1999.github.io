import { isDemoMode, supabase } from '../supabase'
import {
  demoCategorias,
  demoProfesionales,
  demoPromociones,
  demoServicios,
} from '../demoData'
import type { CategoriaServicio, Profesional, Promocion, Servicio } from '../types'

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
