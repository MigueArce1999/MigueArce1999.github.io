import { LOCAL_ID } from './supabase'
import type { Perfil } from './types'

export const PLATAFORMA_URL = String(import.meta.env.VITE_PLATAFORMA_URL ?? '').replace(/\/$/, '')

export const rutaPorRol: Record<Perfil['rol'], string> = {
  cliente: '/cliente',
  empleada: '/equipo-app',
  admin: '/admin',
}

/** Portal de ESTA instalación según el rol de la persona en este salón (membresía);
 *  si no es del equipo de aquí, clienta. */
export function rutaEnEsteSalon(perfil: Perfil, tieneCliente: boolean): string {
  if (LOCAL_ID && perfil.local_id === LOCAL_ID) {
    if (perfil.rol === 'admin') return '/admin'
    if (perfil.rol === 'empleada') return '/equipo-app'
  }
  return tieneCliente ? '/cliente' : '/'
}
