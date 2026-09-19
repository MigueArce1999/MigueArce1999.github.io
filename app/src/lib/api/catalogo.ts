import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
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

// `profesional` (la tabla) no tiene columna `nombre` — vive en `perfil`, y PostgREST no puede
// embeber profesional->perfil de forma anidada dentro de servicio_profesional->profesional.
// Por eso cada consulta que trae profesionales de un servicio debe resolver el nombre aparte
// contra `vista_profesional` (mismo patrón que nombresDeProfesionales en lib/api/agenda.ts).
async function adjuntarNombresProfesionales(filas: any[]): Promise<any[]> {
  const ids = [...new Set(filas.flatMap((s) => (s.servicio_profesional ?? []).map((sp: any) => sp.profesional?.id).filter(Boolean)))]
  let nombres = new Map<string, string>()
  if (ids.length > 0) {
    const { data, error } = await supabase!.from('vista_profesional').select('id, nombre').in('id', ids)
    if (error) throw error
    nombres = new Map((data ?? []).map((p: any) => [p.id, p.nombre]))
  }
  return filas.map((s) => ({
    ...s,
    categoria_nombre: s.categoria?.nombre,
    profesionales: (s.servicio_profesional ?? []).map((sp: any) => ({ ...sp.profesional, nombre: nombres.get(sp.profesional?.id) ?? '' })),
  }))
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
  return adjuntarNombresProfesionales(data ?? [])
}

// Cuando en Atender se escribe un servicio que no existe en el catálogo, se crea "sobre la
// marcha" en vez de bloquear a quien atiende — nace en la categoría "Otros servicios" con
// precio "a valorar" y sin duración confirmada (ver fn_crear_servicio_rapido en
// supabase/migrations/0038); administración lo reclasifica después desde Admin → Servicios.
// Idempotente por nombre: si ya existe (por otra empleada casi al mismo tiempo, o porque
// alguien ya lo escribió antes), devuelve el mismo en vez de duplicarlo.
export async function crearServicioRapido(nombre: string, precio?: number | null): Promise<Servicio> {
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_crear_servicio_rapido', { p_nombre: nombre, p_precio: precio ?? null })
  if (error) throw error
  return data as Servicio
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
  return adjuntarNombresProfesionales(data ?? [])
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
  const [conNombres] = await adjuntarNombresProfesionales([data])
  return conNombres
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

// Subconjunto de listarProfesionales para la vitrina de la home pública: además de activo,
// exige mostrar_en_home (un profesional puede seguir operando sin estar en la portada).
export async function listarProfesionalesHomepage(): Promise<Profesional[]> {
  if (isDemoMode) return demoProfesionales.filter((p) => p.mostrar_en_home)
  const { data, error } = await supabase!
    .from('vista_profesional')
    .select('*')
    .eq('activo', true)
    .eq('mostrar_en_home', true)
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

// Las fechas son opcionales (0041): una promoción sin fechas depende solo de `activa` para
// decidir si se muestra. No se puede filtrar esto con .lte()/.gte() en la consulta (NULL nunca
// pasa esas comparaciones), así que se trae todo lo activo y se filtra la vigencia en JS.
export async function listarPromocionesVigentes(): Promise<Promocion[]> {
  const ahora = new Date()
  if (isDemoMode) {
    return demoPromociones.filter(
      (p) => (!p.vigente_desde || new Date(p.vigente_desde) <= ahora) && (!p.vigente_hasta || new Date(p.vigente_hasta) >= ahora),
    )
  }
  const { data, error } = await supabase!
    .from('promocion')
    .select('*, promocion_servicio(servicio_id)')
    .eq('activa', true)
    .order('orden_visualizacion')
  if (error) throw error
  return (data ?? [])
    .filter((p: any) => (!p.vigente_desde || new Date(p.vigente_desde) <= ahora) && (!p.vigente_hasta || new Date(p.vigente_hasta) >= ahora))
    .map((p: any) => ({
      ...p,
      servicios: (p.promocion_servicio ?? []).map((ps: any) => ps.servicio_id),
    }))
}
