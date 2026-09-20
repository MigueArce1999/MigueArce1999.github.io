// Puente delgado hacia Supabase para el asistente de voz: los RPC de búsqueda difusa
// (migración 0046), el catálogo de productos (0044) y los alias de voz (0045). EntityResolver
// es quien decide QUÉ hacer con estos resultados (umbrales, aclaraciones); este archivo solo
// los trae.
import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
import type { Producto } from './schema'

export type EntityType = 'client' | 'service' | 'employee' | 'product'

export interface CandidatoFuzzy {
  id: string
  nombre: string
  score: number
}

export interface CandidatoClienteFuzzy extends CandidatoFuzzy {
  telefono: string | null
}

export interface CandidatoProductoFuzzy extends CandidatoFuzzy {
  categoria: string | null
  precio: number | null
}

export async function buscarClientesFuzzy(texto: string, limite = 5): Promise<CandidatoClienteFuzzy[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_buscar_clientes_fuzzy', { p_texto: texto, p_limite: limite })
  if (error) throw error
  return (data ?? []) as CandidatoClienteFuzzy[]
}

export async function buscarServiciosFuzzy(texto: string, limite = 5): Promise<CandidatoFuzzy[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_buscar_servicios_fuzzy', { p_texto: texto, p_limite: limite })
  if (error) throw error
  return (data ?? []) as CandidatoFuzzy[]
}

export async function buscarProfesionalesFuzzy(texto: string, limite = 5): Promise<CandidatoFuzzy[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_buscar_profesionales_fuzzy', { p_texto: texto, p_limite: limite })
  if (error) throw error
  return (data ?? []) as CandidatoFuzzy[]
}

export async function buscarProductosFuzzy(texto: string, limite = 5): Promise<CandidatoProductoFuzzy[]> {
  if (isDemoMode) return []
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_buscar_productos_fuzzy', { p_texto: texto, p_limite: limite })
  if (error) throw error
  return (data ?? []) as CandidatoProductoFuzzy[]
}

/** Alias de voz confirmados (sección 7): se consultan ANTES del fuzzy matching. Devuelve el id
 * de la entidad si hay un alias exacto normalizado, o null. */
export async function buscarAliasVoz(entityType: EntityType, textoNormalizado: string): Promise<string | null> {
  if (isDemoMode) return null
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_buscar_alias_voz', { p_entity_type: entityType, p_texto_normalizado: textoNormalizado })
  if (error) throw error
  return (data as string | null) ?? null
}

export async function listarProductos(): Promise<Producto[]> {
  if (isDemoMode) return []
  const { data, error } = await supabase!.from('producto').select('*').eq('activo', true).order('nombre')
  if (error) throw error
  return data
}

export async function crearProductoRapido(nombre: string, categoria?: string | null, precio?: number | null): Promise<Producto> {
  if (isDemoMode) {
    return { id: 'demo-producto-' + Date.now(), nombre, categoria: categoria ?? null, precio: precio ?? null, activo: true }
  }
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_crear_producto_rapido', { p_nombre: nombre, p_categoria: categoria ?? null, p_precio: precio ?? null })
  if (error) throw error
  return data as Producto
}
