import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { ErrorState } from '../../components/ui/Estados'
import { registrarCliente } from '../../lib/api/auth'
import { marcarConsentimientoMarketingPropio } from '../../lib/api/clientes'
import { isDemoMode } from '../../lib/supabase'
import { telefonoValido } from '../../lib/telefono'
import { useAuth } from '../../state/AuthContext'

// Ruta pública independiente del portal (/ingresar, /registro): es la pantalla que abre el
// QR/enlace de "Compartir registro" en Admin → Clientes, pensada para pegarse en el salón y
// escanearse sin sesión previa. Crea una cuenta real (correo + contraseña vía registrarCliente,
// igual que /registro) para que la clienta quede con acceso a su portal — puntos, historial,
// promociones — desde el primer momento, no solo una fila de contacto sin login.
export function RegistroSalon() {
  const navigate = useNavigate()
  const { fijarDemoRol } = useAuth()
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [aceptaMarketing, setAceptaMarketing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)
  const enviadoRef = useRef(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (enviadoRef.current) return
    setError(null)
    if (nombre.trim().length < 2) { setError('Escribe tu nombre completo.'); return }
    if (telefono.trim() && !telefonoValido(telefono)) { setError('Escribe un número de WhatsApp válido, con indicativo si estás fuera de Colombia.'); return }
    enviadoRef.current = true
    setEnviando(true)
    try {
      if (isDemoMode) {
        fijarDemoRol('cliente')
        navigate('/cliente')
        return
      }
      const resultado = await registrarCliente(email.trim(), password, nombre.trim(), telefono.trim() || undefined)
      if (aceptaMarketing) {
        await marcarConsentimientoMarketingPropio().catch(() => {})
      }
      if (resultado.sesion) {
        navigate('/cliente')
        return
      }
      setListo(true)
    } catch (err: any) {
      setError(err.message)
      enviadoRef.current = false
    } finally {
      setEnviando(false)
    }
  }

  if (listo) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-marfil px-4 py-16 text-center sm:px-6">
        <p className="mb-2 font-marca text-2xl font-semibold text-carbon">Claudia Patricia</p>
        <h1 className="mb-3 font-marca text-3xl font-semibold text-carbon">Revisa tu correo</h1>
        <p className="max-w-sm text-sm text-carbon/60">Te enviamos un enlace de confirmación para activar tu cuenta. Ábrelo y luego ingresa con tu correo y contraseña.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-marfil px-4 py-16 sm:px-6">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-center font-marca text-2xl font-semibold text-carbon">Claudia Patricia</p>
        <h1 className="mb-2 text-center font-marca text-3xl font-semibold text-carbon">Bienvenida</h1>
        <p className="mb-8 text-center text-sm text-carbon/60">Crea tu cuenta para agendar citas y ver tus puntos y beneficios.</p>

        {error && <div className="mb-4"><ErrorState mensaje={error} /></div>}

        <form onSubmit={enviar} className="flex flex-col gap-5">
          <Input id="nombrePublico" etiqueta="Nombre completo" required value={nombre} onChange={(e) => setNombre(e.target.value)} className="py-3 text-base" />
          <Input id="emailPublico" etiqueta="Correo" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="py-3 text-base" />
          <Input
            id="passwordPublico"
            etiqueta="Contraseña"
            type="password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="py-3 text-base"
          />
          <Input
            id="telefonoPublico"
            etiqueta="WhatsApp (opcional, con indicativo si no eres de Colombia)"
            type="tel"
            placeholder="300 123 4567"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="py-3 text-base"
          />

          <label className="flex items-start gap-3 text-sm text-carbon/70">
            <input
              type="checkbox"
              checked={aceptaMarketing}
              onChange={(e) => setAceptaMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            Quiero recibir promociones y novedades del salón por WhatsApp (opcional).
          </label>

          <p className="text-xs text-carbon/50">
            Tus datos se guardan únicamente para gestionar tu cuenta como clienta del salón.
          </p>

          <Button type="submit" tamano="lg" cargando={enviando}>Crear mi cuenta</Button>
        </form>

        <p className="mt-4 text-center text-sm text-carbon/60">
          ¿Ya tienes cuenta en este u otro salón? Usa el mismo correo y contraseña.{' '}
          <Link to="/ingresar" className="font-semibold text-oliva">Ingresa aquí</Link>
        </p>

        <p className="mt-8 text-center text-xs text-carbon/40">
          <Link to="/" className="underline underline-offset-2">Claudia Patricia · Salón de belleza</Link>
        </p>
      </div>
    </div>
  )
}
