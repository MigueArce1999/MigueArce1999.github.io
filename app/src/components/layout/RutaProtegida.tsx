import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../state/AuthContext'
import type { Rol } from '../../lib/types'
import { isDemoMode, LOCAL_ID } from '../../lib/supabase'
import { Cargando } from '../ui/Estados'

// Esta guarda solo mejora la experiencia (oculta pantallas que no aplican). La barrera real
// de seguridad es la RLS de Postgres (ver docs/02-roles-y-permisos.md).
//
// En este salón puedes ser clienta aunque tu perfil.rol sea admin/empleada/super_admin
// (otra instalación, o la plataforma). El equipo de ESTE local se reconoce por perfil.local_id.
export function RutaProtegida({ rolRequerido, children }: { rolRequerido: Rol; children: ReactNode }) {
  const { perfil, cliente, profesional, cargando } = useAuth()

  if (cargando && !perfil) return <div className="p-6"><Cargando /></div>

  if (!perfil) {
    return <Navigate to="/ingresar" replace />
  }
  // En modo demo no hay LOCAL_ID real ni perfiles con local_id (ver AuthContext DEMO_ADMIN/
  // DEMO_EMPLEADA) — solo hay un salón de ejemplo, así que siempre "pertenece" a él.
  const esEquipoDeEsteSalon = isDemoMode || Boolean(LOCAL_ID && perfil.local_id === LOCAL_ID)
  const puedeEntrar =
    (rolRequerido === 'cliente' && cliente !== null) ||
    (rolRequerido === 'admin' && perfil.rol === 'admin' && esEquipoDeEsteSalon) ||
    (rolRequerido === 'empleada' && esEquipoDeEsteSalon && (
      perfil.rol === 'empleada' || (perfil.rol === 'admin' && profesional !== null)
    ))
  if (!puedeEntrar) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
