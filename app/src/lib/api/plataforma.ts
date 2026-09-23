import { isDemoMode, LOCAL_ID, supabase } from '../supabase'
import type { LocalMarca } from '../types'

const FALLBACK: LocalMarca = {
  id: LOCAL_ID || 'demo',
  nombre: 'Claudia Patricia',
  slug: 'claudia-patricia',
  activo: true,
  logo_url: '/logo-claudia-patricia.png',
  favicon_url: '/favicon.png',
  logo_footer_url: null,
  url_sitio: 'https://saladebellezaclaudiapatricia.com',
  nombre_corto: 'CP',
  eslogan: 'Salón de belleza',
  color_primario: null,
  color_acento: null,
}

export function marcaFallback(): LocalMarca {
  return { ...FALLBACK }
}

export async function obtenerMarcaPublica(): Promise<LocalMarca> {
  if (isDemoMode || !LOCAL_ID) return marcaFallback()
  const { data, error } = await supabase!
    .from('local')
    .select('id, nombre, slug, activo, logo_url, favicon_url, logo_footer_url, url_sitio, nombre_corto, eslogan, color_primario, color_acento')
    .eq('id', LOCAL_ID)
    .maybeSingle()
  if (error) throw error
  return data ? { ...marcaFallback(), ...data } : marcaFallback()
}
