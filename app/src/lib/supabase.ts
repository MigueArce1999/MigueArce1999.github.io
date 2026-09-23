import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
const localIdRaw = (import.meta.env.VITE_LOCAL_ID as string | undefined)?.trim()

// Modo demostración: no hay proyecto Supabase conectado (ver docs/07-plan-implementacion.md).
export const isDemoMode = !url || !anonKey

if (!isDemoMode && !localIdRaw) {
  throw new Error(
    'Hay conexión a Supabase pero falta VITE_LOCAL_ID. Cada instalación pertenece a un local; ' +
      'sin ese UUID la app mezclaría datos de todos los negocios. Cópialo desde la tabla `local`.',
  )
}

export const LOCAL_ID = localIdRaw ?? ''

export const supabase: SupabaseClient | null = isDemoMode
  ? null
  : createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
      global: {
        headers: { 'x-local-id': LOCAL_ID },
      },
    })

export function supabaseRequerido() {
  if (!supabase) {
    throw new Error(
      'No hay conexión a Supabase configurada (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
        'Estás en modo demostración: esta acción no está disponible sobre datos de ejemplo.',
    )
  }
  return supabase
}
