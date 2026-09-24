import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDemoMode, LOCAL_ID, supabase } from '../lib/supabase'
import { obtenerClientePorUsuario } from '../lib/api/cliente'
import { asegurarClienteEnLocal } from '../lib/api/auth'
import { demoClienteActual, demoProfesionales } from '../lib/demoData'
import type { Cliente, Perfil, Profesional, Rol } from '../lib/types'

interface AuthState {
  cargando: boolean
  haySesion: boolean
  perfil: Perfil | null
  cliente: Cliente | null
  profesional: Profesional | null
  // Solo aplica en modo demostración: permite previsualizar los 3 portales autenticados
  // sin un login real, ya que no hay proyecto Supabase conectado en este entorno.
  demoRol: Rol | null
  fijarDemoRol: (rol: Rol | null) => void
  cerrarSesionLocal: () => void
  motivoRechazo: string | null
}

const AuthContext = createContext<AuthState | null>(null)

const DEMO_ADMIN: Perfil = { id: 'demo-usuario-admin', nombre: 'Claudia (demo)', telefono: null, rol: 'admin', activo: true }
const DEMO_EMPLEADA: Perfil = { id: 'demo-prof-naldi', nombre: 'Naldi (demo)', telefono: null, rol: 'empleada', activo: true }
const DEMO_CLIENTE: Perfil = { id: 'demo-usuario-cliente', nombre: demoClienteActual.nombre, telefono: null, rol: 'cliente', activo: true }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(!isDemoMode)
  const [haySesion, setHaySesion] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [profesional, setProfesional] = useState<Profesional | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState<string | null>(null)
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
    const usuarioCargadoRef = { current: null as string | null }

    async function cargar(usuarioId: string | undefined) {
      if (!usuarioId) {
        if (activo) {
          usuarioCargadoRef.current = null
          setHaySesion(false)
          setPerfil(null)
          setCliente(null)
          setProfesional(null)
          setCargando(false)
        }
        return
      }
      setHaySesion(true)
      setMotivoRechazo(null)
      const { data: perfilRow } = await supabase!.from('perfil').select('*').eq('id', usuarioId).maybeSingle()
      if (!activo) return
      if (!perfilRow) {
        usuarioCargadoRef.current = null
        setPerfil(null)
        setCliente(null)
        setProfesional(null)
        setCargando(false)
        return
      }
      setPerfil(perfilRow)
      usuarioCargadoRef.current = usuarioId
      try {
        await asegurarClienteEnLocal()
      } catch {
        /* el SELECT de cliente puede devolver la fila si ya existía */
      }
      if (!activo) return
      try {
        const c = await obtenerClientePorUsuario(usuarioId)
        if (activo) setCliente(c)
      } catch {
        if (activo) setCliente(null)
      }
      const esEquipoDeEsteSalon = Boolean(LOCAL_ID && perfilRow.local_id === LOCAL_ID)
      if (esEquipoDeEsteSalon && (perfilRow.rol === 'empleada' || perfilRow.rol === 'admin')) {
        const { data: profRow } = await supabase!.from('vista_profesional').select('*').eq('id', usuarioId).eq('local_id', LOCAL_ID).maybeSingle()
        if (activo) setProfesional(profRow)
      } else if (activo) {
        setProfesional(null)
      }
      setCargando(false)
    }

    supabase!.auth.getSession().then(({ data }) => cargar(data.session?.user.id))
    const { data: sub } = supabase!.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'INITIAL_SESSION' || evento === 'TOKEN_REFRESHED') return
      if (evento === 'SIGNED_IN' && sesion?.user.id && sesion.user.id === usuarioCargadoRef.current) return
      if (evento === 'SIGNED_OUT' || !sesion?.user.id) {
        cargar(undefined)
        return
      }
      setCargando(true)
      cargar(sesion.user.id)
    })
    return () => {
      activo = false
      sub.subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRol])

  function cerrarSesionLocal() {
    setHaySesion(false)
    setPerfil(null)
    setCliente(null)
    setProfesional(null)
    fijarDemoRol(null)
  }

  const valor = useMemo(
    () => ({ cargando, haySesion, perfil, cliente, profesional, demoRol, fijarDemoRol, cerrarSesionLocal, motivoRechazo }),
    [cargando, haySesion, perfil, cliente, profesional, demoRol, motivoRechazo],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
