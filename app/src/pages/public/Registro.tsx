import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { ErrorState } from '../../components/ui/Estados'
import { isDemoMode } from '../../lib/supabase'
import { registrarCliente } from '../../lib/api/auth'
import { useAuth } from '../../state/AuthContext'

export function Registro() {
  const navigate = useNavigate()
  const { fijarDemoRol } = useAuth()
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [listo, setListo] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      if (isDemoMode) {
        fijarDemoRol('cliente')
        navigate('/cliente')
        return
      }
      const resultado = await registrarCliente(email, password, nombre)
      if (resultado.sesion) {
        navigate('/cliente')
        return
      }
      setListo(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  if (listo) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center sm:px-6">
        <h1 className="mb-2 font-marca text-3xl font-semibold text-carbon">Revisa tu correo</h1>
        <p className="text-sm text-carbon/60">Te enviamos un enlace de confirmación para activar tu cuenta.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 sm:px-6">
      <h1 className="mb-6 font-marca text-3xl font-semibold text-carbon">Crea tu cuenta</h1>
      {error && <div className="mb-4"><ErrorState mensaje={error} /></div>}
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <Input id="nombre" etiqueta="Nombre completo" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Input id="email" etiqueta="Correo" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input id="password" etiqueta="Contraseña" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" cargando={cargando}>Crear cuenta</Button>
      </form>
      <p className="mt-4 text-center text-sm text-carbon/60">
        ¿Ya tienes cuenta en este u otro salón? Usa el mismo correo y contraseña.{' '}
        <Link to="/ingresar" className="font-semibold text-oliva">Ingresa aquí</Link>
      </p>
    </div>
  )
}
