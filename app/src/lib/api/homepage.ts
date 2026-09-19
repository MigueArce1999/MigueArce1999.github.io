// API del módulo admin "Configuración de la homepage". Reutiliza las tablas del catálogo
// (categoria_servicio, promocion, profesional) en vez de un modelo paralelo — ver 0041.
import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
import { demoCategorias, demoPromociones } from '../demoData'
import type { CategoriaServicio, ConfiguracionHomepage, EstadoPromocion, Promocion } from '../types'

// --- Portada -----------------------------------------------------------------------------------

export async function obtenerConfiguracionHomepage(): Promise<ConfiguracionHomepage> {
  if (isDemoMode) return { hero_imagen_url: null, hero_editable: true }
  const { data, error } = await supabase!.from('configuracion_homepage').select('hero_imagen_url, hero_editable').maybeSingle()
  if (error) throw error
  return data ?? { hero_imagen_url: null, hero_editable: true }
}

export async function actualizarHeroHomepage(heroImagenUrl: string | null): Promise<void> {
  const client = supabaseRequerido()
  const { data: perfil } = await client.auth.getUser()
  const { error } = await client
    .from('configuracion_homepage')
    .update({ hero_imagen_url: heroImagenUrl, actualizado_en: new Date().toISOString(), actualizado_por: perfil.user?.id ?? null })
    .eq('id', true)
  if (error) throw error
}

// --- Categorías -------------------------------------------------------------------------------
// A diferencia de listarCategorias (público, solo activas), este listado admin trae también las
// ocultas para poder reactivarlas.
export async function listarCategoriasAdmin(): Promise<CategoriaServicio[]> {
  if (isDemoMode) return demoCategorias
  const { data, error } = await supabase!.from('categoria_servicio').select('*').order('orden_visualizacion')
  if (error) throw error
  return data
}

export interface DatosCategoriaHomepage {
  nombre: string
  descripcionCorta: string | null
  imagenUrl: string | null
  textoBoton: string
  enlaceBoton: string | null
  activa: boolean
}

export async function editarCategoriaHomepage(id: string, datos: DatosCategoriaHomepage): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client
    .from('categoria_servicio')
    .update({
      nombre: datos.nombre,
      descripcion_corta: datos.descripcionCorta,
      imagen_url: datos.imagenUrl,
      texto_boton: datos.textoBoton,
      enlace_boton: datos.enlaceBoton,
      activa: datos.activa,
    })
    .eq('id', id)
  if (error) throw error
}

export async function actualizarOrdenCategorias(orden: { id: string; ordenVisualizacion: number }[]): Promise<void> {
  const client = supabaseRequerido()
  const resultados = await Promise.all(
    orden.map((o) => client.from('categoria_servicio').update({ orden_visualizacion: o.ordenVisualizacion }).eq('id', o.id)),
  )
  const conError = resultados.find((r) => r.error)
  if (conError?.error) throw conError.error
}

// --- Promociones --------------------------------------------------------------------------------

export async function listarPromocionesAdmin(): Promise<Promocion[]> {
  if (isDemoMode) return demoPromociones
  const { data, error } = await supabase!
    .from('promocion')
    .select('*, promocion_servicio(servicio_id)')
    .order('orden_visualizacion')
  if (error) throw error
  return (data ?? []).map((p: any) => ({ ...p, servicios: (p.promocion_servicio ?? []).map((ps: any) => ps.servicio_id) }))
}

// Calculado a partir de activa + fechas, nunca guardado — evita tener dos fuentes de verdad
// sobre si una promoción está vigente.
export function estadoPromocion(p: Pick<Promocion, 'activa' | 'vigente_desde' | 'vigente_hasta'>): EstadoPromocion {
  if (!p.activa) return 'inactiva'
  const ahora = Date.now()
  if (p.vigente_desde && new Date(p.vigente_desde).getTime() > ahora) return 'programada'
  if (p.vigente_hasta && new Date(p.vigente_hasta).getTime() < ahora) return 'finalizada'
  return 'activa'
}

export interface DatosPromocion {
  nombre: string
  descripcion: string
  condiciones: string | null
  vigenteDesde: string | null
  vigenteHasta: string | null
  tipoDescuento: 'porcentaje' | 'fijo' | 'precio_especial'
  valor: number
  activa: boolean
  imagenUrl: string | null
  textoBoton: string
  enlaceBoton: string | null
}

function validarPromocion(datos: DatosPromocion) {
  if (!datos.nombre.trim()) throw new Error('El título de la promoción es obligatorio.')
  if (datos.vigenteDesde && datos.vigenteHasta && new Date(datos.vigenteHasta) <= new Date(datos.vigenteDesde)) {
    throw new Error('La fecha de finalización debe ser posterior a la fecha de inicio.')
  }
  if (datos.textoBoton.trim().length > 40) throw new Error('El texto del botón es demasiado largo (máximo 40 caracteres).')
  if (datos.enlaceBoton && !/^(\/|https?:\/\/)/.test(datos.enlaceBoton.trim())) {
    throw new Error('El enlace del botón debe ser una ruta interna (empieza con /) o una URL completa (http/https).')
  }
}

export async function crearPromocion(datos: DatosPromocion): Promise<Promocion> {
  validarPromocion(datos)
  const client = supabaseRequerido()
  const { data: ultima } = await client
    .from('promocion')
    .select('orden_visualizacion')
    .order('orden_visualizacion', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data, error } = await client
    .from('promocion')
    .insert({
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion,
      condiciones: datos.condiciones,
      vigente_desde: datos.vigenteDesde,
      vigente_hasta: datos.vigenteHasta,
      tipo_descuento: datos.tipoDescuento,
      valor: datos.valor,
      activa: datos.activa,
      imagen_url: datos.imagenUrl,
      texto_boton: datos.textoBoton.trim() || 'Ver promoción',
      enlace_boton: datos.enlaceBoton,
      orden_visualizacion: (ultima?.orden_visualizacion ?? 0) + 1,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function editarPromocion(id: string, datos: DatosPromocion): Promise<void> {
  validarPromocion(datos)
  const client = supabaseRequerido()
  const { error } = await client
    .from('promocion')
    .update({
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion,
      condiciones: datos.condiciones,
      vigente_desde: datos.vigenteDesde,
      vigente_hasta: datos.vigenteHasta,
      tipo_descuento: datos.tipoDescuento,
      valor: datos.valor,
      activa: datos.activa,
      imagen_url: datos.imagenUrl,
      texto_boton: datos.textoBoton.trim() || 'Ver promoción',
      enlace_boton: datos.enlaceBoton,
    })
    .eq('id', id)
  if (error) throw error
}

// Borrado real: promocion_servicio cae en cascada (on delete cascade, ver 0008); nada más
// referencia una promoción, así que no hace falta un mensaje especial de "tiene historial".
export async function eliminarPromocion(id: string): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client.from('promocion').delete().eq('id', id)
  if (error) throw error
}

export async function duplicarPromocion(promo: Promocion): Promise<Promocion> {
  return crearPromocion({
    nombre: `${promo.nombre} (copia)`,
    descripcion: promo.descripcion,
    condiciones: promo.condiciones,
    vigenteDesde: null,
    vigenteHasta: null,
    tipoDescuento: promo.tipo_descuento,
    valor: promo.valor,
    activa: false,
    imagenUrl: promo.imagen_url,
    textoBoton: promo.texto_boton,
    enlaceBoton: promo.enlace_boton,
  })
}

export async function actualizarOrdenPromociones(orden: { id: string; ordenVisualizacion: number }[]): Promise<void> {
  const client = supabaseRequerido()
  const resultados = await Promise.all(
    orden.map((o) => client.from('promocion').update({ orden_visualizacion: o.ordenVisualizacion }).eq('id', o.id)),
  )
  const conError = resultados.find((r) => r.error)
  if (conError?.error) throw conError.error
}

// --- Equipo: solo los campos públicos que muestra la homepage --------------------------------
// El resto (comisiones, agenda, historial, borrado) sigue viviendo exclusivamente en
// Admin → Equipo; este módulo nunca toca esas tablas.

export interface DatosProfesionalHomepage {
  bio: string | null
  especialidades: string[]
  fotoUrl: string | null
  mostrarEnHome: boolean
}

export async function editarProfesionalHomepage(id: string, datos: DatosProfesionalHomepage): Promise<void> {
  const client = supabaseRequerido()
  const { error } = await client
    .from('profesional')
    .update({
      bio: datos.bio,
      especialidades: datos.especialidades,
      foto_url: datos.fotoUrl,
      mostrar_en_home: datos.mostrarEnHome,
    })
    .eq('id', id)
  if (error) throw error
}

export async function actualizarOrdenEquipoHomepage(orden: { id: string; ordenVisualizacion: number }[]): Promise<void> {
  const client = supabaseRequerido()
  const resultados = await Promise.all(
    orden.map((o) => client.from('profesional').update({ orden_visualizacion: o.ordenVisualizacion }).eq('id', o.id)),
  )
  const conError = resultados.find((r) => r.error)
  if (conError?.error) throw conError.error
}

// --- Imágenes públicas (Storage) --------------------------------------------------------------
// Bucket público (a diferencia de comprobantes-gastos): las fotos de categorías/promociones son
// contenido del sitio, así que basta una URL pública, sin firmar.
const BUCKET_IMAGENES_PUBLICO = 'imagenes-publico'
export const TIPOS_IMAGEN_PERMITIDOS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
export const TAMANO_MAXIMO_IMAGEN = 5 * 1024 * 1024 // 5 MB

export async function subirImagenPublica(archivo: File, carpeta: 'categorias' | 'promociones' | 'equipo' | 'hero'): Promise<string> {
  if (!TIPOS_IMAGEN_PERMITIDOS.includes(archivo.type)) {
    throw new Error('Formato no admitido: sube una imagen JPG, PNG o WEBP.')
  }
  if (archivo.size > TAMANO_MAXIMO_IMAGEN) {
    throw new Error(`La imagen supera el tamaño máximo permitido (${Math.round(TAMANO_MAXIMO_IMAGEN / 1024 / 1024)} MB).`)
  }
  const client = supabaseRequerido()
  const extension = archivo.name.split('.').pop() || 'jpg'
  const ruta = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`
  const { error } = await client.storage.from(BUCKET_IMAGENES_PUBLICO).upload(ruta, archivo, { upsert: false })
  if (error) throw error
  const { data } = client.storage.from(BUCKET_IMAGENES_PUBLICO).getPublicUrl(ruta)
  return data.publicUrl
}

// Best-effort: si la imagen vieja ya no existe o falla el borrado, no debe bloquear el guardado
// del resto del formulario — solo dejaría un archivo huérfano en el bucket.
export async function eliminarImagenPublica(url: string): Promise<void> {
  try {
    const client = supabaseRequerido()
    const marcador = `/${BUCKET_IMAGENES_PUBLICO}/`
    const idx = url.indexOf(marcador)
    if (idx === -1) return
    const ruta = url.slice(idx + marcador.length)
    await client.storage.from(BUCKET_IMAGENES_PUBLICO).remove([ruta])
  } catch {
    // no crítico
  }
}
