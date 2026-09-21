import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDemoMode, supabase } from '../lib/supabase'
import { obtenerClientePorUsuario } from '../lib/api/cliente'
import { demoClienteActual, demoProfesionales } from '../lib/demoData'
import type { Cliente, Perfil, Profesional, Rol } from '../lib/types'

interface AuthState {
  cargando: boolean
  perfil: Perfil | null
  cliente: Cliente | null
  profesional: Profesional | null
  // Solo aplica en modo demostración: permite previsualizar los 3 portales autenticados
  // sin un login real, ya que no hay proyecto Supabase conectado en este entorno.
  demoRol: Rol | null
  fijarDemoRol: (rol: Rol | null) => void
  cerrarSesionLocal: () => void
}

const AuthContext = createContext<AuthState | null>(null)

const DEMO_ADMIN: Perfil = { id: 'demo-usuario-admin', nombre: 'Claudia (demo)', telefono: null, rol: 'admin', activo: true }
const DEMO_EMPLEADA: Perfil = { id: 'demo-prof-naldi', nombre: 'Naldi (demo)', telefono: null, rol: 'empleada', activo: true }
const DEMO_CLIENTE: Perfil = { id: 'demo-usuario-cliente', nombre: demoClienteActual.nombre, telefono: null, rol: 'cliente', activo: true }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(!isDemoMode)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [profesional, setProfesional] = useState<Profesional | null>(null)
  const [demoRol, setDemoRol] = useState<Rol | null>(() => {
    if (!isDemoMode) return null
    try {
      return (localStorage.getItem('demo-rol') as Rol | null) ?? null
    } catch {
      return null
    }
  })

  function fijarDemoRol(rol: Rol | null) {
    setDemoRol(rol)
    try {
      if (rol) localStorage.setItem('demo-rol', rol)
      else localStorage.removeItem('demo-rol')
    } catch {
      // localStorage puede no estar disponible (navegación privada); no es crítico aquí.
    }
  }

  useEffect(() => {
    if (isDemoMode) {
      if (demoRol === 'admin') setPerfil(DEMO_ADMIN)
      else if (demoRol === 'empleada') {
        setPerfil(DEMO_EMPLEADA)
        setProfesional(demoProfesionales.find((p) => p.slug === 'naldi') ?? null)
      } else if (demoRol === 'cliente') {
        setPerfil(DEMO_CLIENTE)
        setCliente(demoClienteActual)
      } else {
        setPerfil(null)
      }
      return
    }

    let activo = true
    async function cargar(usuarioId: string | undefined) {
      if (!usuarioId) {
        if (activo) {
          setPerfil(null)
          setCliente(null)
          setProfesional(null)
          setCargando(false)
        }
        return
      }
      const { data: perfilRow } = await supabase!.from('perfil').select('*').eq('id', usuarioId).maybeSingle()
      if (!activo) return
      setPerfil(perfilRow)
      // Toda cuenta nace con su propia fila `cliente` (ver 0002_identidad.sql → fn_manejar_
      // usuario_nuevo) y esa fila NUNCA se borra al ascender a empleada/admin — así que se busca
      // siempre, sin importar el rol actual, para que quien además es clienta pueda entrar
      // también a su portal de clienta (ver RutaProtegida) sin perder su rol principal.
      const c = await obtenerClientePorUsuario(usuarioId)
      if (activo) setCliente(c)
      if (perfilRow?.rol === 'empleada' || perfilRow?.rol === 'admin') {
        // Un admin que ADEMÁS tiene fila en `profesional` (p. ej. quien administra el salón y
        // también atiende) puede entrar al portal de empleadas sin cambiar de rol — ver
        // RutaProtegida. Para un admin sin esa fila, esto simplemente devuelve null.
        const { data: profRow } = await supabase!.from('vista_profesional').select('*').eq('id', usuarioId).maybeSingle()
        if (activo) setProfesional(profRow)
      }
      setCargando(false)
    }

    supabase!.auth.getSession().then(({ data }) => cargar(data.session?.user.id))
    const { data: sub } = supabase!.auth.onAuthStateChange((_evento, sesion) => {
      setCargando(true)
      cargar(sesion?.user.id)
    })
    return () => {
      activo = false
      sub.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRol])

  function cerrarSesionLocal() {
    setPerfil(null)
    setCliente(null)
    setProfesional(null)
    fijarDemoRol(null)
  }

  const valor = useMemo(
    () => ({ cargando, perfil, cliente, profesional, demoRol, fijarDemoRol, cerrarSesionLocal }),
    [cargando, perfil, cliente, profesional, demoRol],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
