import { isDemoMode, LOCAL_ID, supabase, supabaseRequerido } from '../supabase'
import type { Perfil } from '../types'

// Sin sufijo de ruta (#/ingresar): HashRouter y Supabase no conviven en el mismo hash.
// Supabase añade "#access_token=...&type=signup|magiclink" al final de emailRedirectTo.
// Si ya hay un "#", quedan dos y supabase-js no lee el token. Origen limpio → el correo
// aterriza en ".../#access_token=...", se consume la sesión y Home.tsx manda al portal.
export function origenAuth(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return `${window.location.origin}${window.location.pathname}`
}

export function patronRedirectAuth(urlSitio: string): string | null {
  const raw = urlSitio.trim()
  if (!raw) return null
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return `${u.protocol}//${u.host}/**`
  } catch {
    return null
  }
}

export async function iniciarSesion(email: string, password: string) {
  const client = supabaseRequerido()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function asegurarClienteEnLocal(): Promise<string | null> {
  if (isDemoMode || !LOCAL_ID) return null
  const { data, error } = await supabaseRequerido().rpc('fn_asegurar_cliente_en_local')
  if (error) throw error
  return data as string
}

function mensajeCuentaDuplicada(err: { message?: string } | null) {
  const m = (err?.message ?? '').toLowerCase()
  return /already|registered|exists|registrad/.test(m)
}

export async function registrarCliente(email: string, password: string, nombre: string, telefono?: string) {
  const client = supabaseRequerido()
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { nombre, telefono, local_id: LOCAL_ID },
      emailRedirectTo: origenAuth(),
    },
  })

  const identidades = data.user?.identities ?? null
  const pareceExistente = mensajeCuentaDuplicada(error) || (data.user != null && identidades?.length === 0)

  if (!error && data.session) {
    await asegurarClienteEnLocal()
    return { sesion: true as const }
  }

  if (pareceExistente || (data.user && !data.session)) {
    const { error: loginError } = await client.auth.signInWithPassword({ email, password })
    if (!loginError) {
      await asegurarClienteEnLocal()
      return { sesion: true as const }
    }
    if (pareceExistente) {
      throw new Error(
        'Ese correo ya tiene cuenta. Entra con la misma contraseña en todos los salones (el correo es único en la plataforma).',
      )
    }
    if (!error && !data.session) {
      return { sesion: false as const }
    }
  }

  if (error) throw error
  return { sesion: Boolean(data.session) }
}

export async function cerrarSesion() {
  if (isDemoMode) return
  await supabase!.auth.signOut()
}

export async function obtenerPerfilActual(): Promise<Perfil | null> {
  if (isDemoMode) return null
  const { data: sesion } = await supabase!.auth.getSession()
  const uid = sesion.session?.user.id
  if (!uid) return null
  const { data, error } = await supabase!.from('perfil').select('*').eq('id', uid).maybeSingle()
  if (error) throw error
  return data
}
