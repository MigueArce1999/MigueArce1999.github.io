import { LOCAL_ID } from './supabase'
import type { Perfil } from './types'

export const PLATAFORMA_URL = String(import.meta.env.VITE_PLATAFORMA_URL ?? '').replace(/\/$/, '')

export const rutaPorRol: Record<Perfil['rol'], string> = {
  cliente: '/cliente',
  empleada: '/equipo-app',
  admin: '/admin',
  super_admin: '/cliente',
}

/** Portal de ESTA instalación: equipo solo si el perfil es de este local; si no, clienta.
 *  super_admin no tiene local_id: en cualquier tienda entra como clienta. */
export function rutaEnEsteSalon(perfil: Perfil, tieneCliente: boolean): string {
  if (perfil.rol === 'super_admin') return tieneCliente ? '/cliente' : '/'
  if (LOCAL_ID && perfil.local_id === LOCAL_ID) {
    if (perfil.rol === 'admin') return '/admin'
    if (perfil.rol === 'empleada') return '/equipo-app'
  }
  return tieneCliente ? '/cliente' : '/'
}
