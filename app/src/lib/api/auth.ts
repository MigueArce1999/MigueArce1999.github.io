import { isDemoMode, supabase, supabaseRequerido } from '../supabase'
import type { Perfil } from '../types'

export async function iniciarSesion(email: string, password: string) {
  const client = supabaseRequerido()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function registrarCliente(email: string, password: string, nombre: string, telefono?: string) {
  const client = supabaseRequerido()
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { nombre, telefono } },
  })
  if (error) throw error
  return data
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
