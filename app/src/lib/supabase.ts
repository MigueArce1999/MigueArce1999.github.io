import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Modo demostración: no hay proyecto Supabase conectado en este entorno (ver
// docs/07-plan-implementacion.md → "Qué pasa si nunca se conecta Supabase").
// Toda la capa de datos (lib/api/*.ts) revisa este flag antes de decidir si
// llama a Supabase real o devuelve datos de ejemplo desde lib/demoData.ts.
export const isDemoMode = !url || !anonKey

export const supabase = isDemoMode
  ? null
  : createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
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
