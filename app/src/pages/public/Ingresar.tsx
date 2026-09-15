import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { ErrorState } from '../../components/ui/Estados'
import { isDemoMode } from '../../lib/supabase'
import { iniciarSesion } from '../../lib/api/auth'
import { useAuth } from '../../state/AuthContext'
import type { Rol } from '../../lib/types'

const rutaPorRol: Record<Rol, string> = { cliente: '/cliente', empleada: '/equipo-app', admin: '/admin' }

export function Ingresar() {
  const navigate = useNavigate()
  const { perfil, fijarDemoRol } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    // En modo demo, /ingresar sirve para ELEGIR o CAMBIAR de portal, así que no se redirige
    // automáticamente aunque ya haya un demoRol activo (ver más abajo, isDemoMode).
    if (perfil && isDemoMode) return
    if (perfil) navigate(rutaPorRol[perfil.rol], { replace: true })
  }, [perfil, navigate])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      await iniciarSesion(email, password)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  if (isDemoMode) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center sm:px-6">
        <h1 className="mb-2 font-marca text-3xl font-semibold text-carbon">Modo demostración</h1>
        <p className="mb-8 text-sm text-carbon/60">
          No hay un proyecto Supabase conectado, así que no hay login real. Elige qué portal quieres
          previsualizar con datos de ejemplo.
        </p>
        <div className="flex flex-col gap-3">
          <Button onClick={() => { fijarDemoRol('cliente'); navigate('/cliente') }}>Ver portal del cliente</Button>
          <Button variante="secondary" onClick={() => { fijarDemoRol('empleada'); navigate('/equipo-app') }}>Ver portal de empleadas</Button>
          <Button variante="secondary" onClick={() => { fijarDemoRol('admin'); navigate('/admin') }}>Ver dashboard admin</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="mb-6 font-marca text-3xl font-semibold text-carbon">Ingresar</h1>
      {error && <div className="mb-4"><ErrorState mensaje={error} /></div>}
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <Input id="email" etiqueta="Correo" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input id="password" etiqueta="Contraseña" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" cargando={cargando}>Ingresar</Button>
      </form>
      <p className="mt-4 text-center text-sm text-carbon/60">
        ¿Primera vez aquí? <Link to="/registro" className="font-semibold text-oliva">Crea tu cuenta</Link>
      </p>
      <p className="mt-8 text-center text-xs text-carbon/40">Acceso de clientes y del equipo del salón.</p>
    </div>
  )
}
