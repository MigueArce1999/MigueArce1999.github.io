import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { ErrorState } from '../../components/ui/Estados'
import { registrarClientePublico } from '../../lib/api/clientes'
import { telefonoValido } from '../../lib/telefono'

// Ruta pública independiente del panel administrativo y del registro de cuenta (/registro,
// que crea usuario+contraseña): esta es solo una ficha de contacto rápida, pensada para
// abrirse desde el QR/enlace de "Compartir registro" en Admin → Clientes, sin iniciar sesión.
// No crea una cuenta, ni una reserva, ni una atención — solo una fila en "cliente"
// (fn_registrar_cliente_publico, ver supabase/migrations/0024).
export function RegistroSalon() {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
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
    if (!telefonoValido(telefono)) { setError('Escribe un número de WhatsApp válido, con indicativo si estás fuera de Colombia.'); return }
    enviadoRef.current = true
    setEnviando(true)
    try {
      await registrarClientePublico({ nombre: nombre.trim(), telefono, email: email.trim() || null, aceptaMarketing })
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
        <h1 className="mb-3 font-marca text-3xl font-semibold text-carbon">¡Listo, gracias!</h1>
        <p className="max-w-sm text-sm text-carbon/60">Ya quedaste registrada. Nos vemos pronto en el salón.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-marfil px-4 py-16 sm:px-6">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-center font-marca text-2xl font-semibold text-carbon">Claudia Patricia</p>
        <h1 className="mb-2 text-center font-marca text-3xl font-semibold text-carbon">Bienvenida</h1>
        <p className="mb-8 text-center text-sm text-carbon/60">Completa tus datos para registrarte con nosotras.</p>

        {error && <div className="mb-4"><ErrorState mensaje={error} /></div>}

        <form onSubmit={enviar} className="flex flex-col gap-5">
          <Input id="nombrePublico" etiqueta="Nombre completo" required value={nombre} onChange={(e) => setNombre(e.target.value)} className="py-3 text-base" />
          <Input
            id="telefonoPublico"
            etiqueta="WhatsApp (con indicativo si no eres de Colombia)"
            required
            type="tel"
            placeholder="300 123 4567"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="py-3 text-base"
          />
          <Input id="emailPublico" etiqueta="Correo (opcional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="py-3 text-base" />

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
            Tus datos se guardan únicamente para gestionar tu perfil como clienta del salón.
          </p>

          <Button type="submit" tamano="lg" cargando={enviando}>Completar registro</Button>
        </form>

        <p className="mt-8 text-center text-xs text-carbon/40">
          <Link to="/" className="underline underline-offset-2">Claudia Patricia · Salón de belleza</Link>
        </p>
      </div>
    </div>
  )
}
