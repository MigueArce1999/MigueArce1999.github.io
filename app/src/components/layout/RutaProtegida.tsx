import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../state/AuthContext'
import type { Rol } from '../../lib/types'
import { Cargando } from '../ui/Estados'

// Esta guarda solo mejora la experiencia (oculta pantallas que no aplican). La barrera real
// de seguridad es la RLS de Postgres (ver docs/02-roles-y-permisos.md) — aunque alguien
// manipule el frontend, Supabase seguirá rechazando lecturas/escrituras no autorizadas.
//
// Admin puede entrar también al portal de empleadas (nunca al revés): el backend ya trata a
// admin como superusuario en cada función/política RLS, así que esto no abre ninguna
// capacidad nueva — solo destraba en el frontend una navegación que el backend ya permitía.
// Solo tiene sentido si además tiene una fila en `profesional` vinculada (AuthContext se
// encarga de cargarla); sin eso, las pantallas de empleada no tendrían de quién mostrar datos.
//
// Cualquier perfil (cliente, empleada o admin) puede entrar además al portal de clienta si
// tiene una fila en `cliente` vinculada — toda cuenta nace con una (ver 0002_identidad.sql), así
// que en la práctica esto nunca falta salvo en cuentas muy antiguas de antes de esa migración.
export function RutaProtegida({ rolRequerido, children }: { rolRequerido: Rol; children: ReactNode }) {
  const { perfil, cliente, profesional, cargando } = useAuth()

  if (cargando) return <div className="p-6"><Cargando /></div>

  if (!perfil) {
    // En modo demo, /ingresar ofrece botones para elegir qué portal previsualizar.
    return <Navigate to="/ingresar" replace />
  }
  const puedeEntrar =
    perfil.rol === rolRequerido ||
    (rolRequerido === 'empleada' && perfil.rol === 'admin' && profesional !== null) ||
    (rolRequerido === 'cliente' && cliente !== null)
  if (!puedeEntrar) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
