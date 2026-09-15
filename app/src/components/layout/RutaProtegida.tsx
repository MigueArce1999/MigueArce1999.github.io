import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../state/AuthContext'
import type { Rol } from '../../lib/types'
import { Cargando } from '../ui/Estados'

// Esta guarda solo mejora la experiencia (oculta pantallas que no aplican). La barrera real
// de seguridad es la RLS de Postgres (ver docs/02-roles-y-permisos.md) — aunque alguien
// manipule el frontend, Supabase seguirá rechazando lecturas/escrituras no autorizadas.
export function RutaProtegida({ rolRequerido, children }: { rolRequerido: Rol; children: ReactNode }) {
  const { perfil, cargando } = useAuth()

  if (cargando) return <div className="p-6"><Cargando /></div>

  if (!perfil) {
    // En modo demo, /ingresar ofrece botones para elegir qué portal previsualizar.
    return <Navigate to="/ingresar" replace />
  }
  if (perfil.rol !== rolRequerido) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
