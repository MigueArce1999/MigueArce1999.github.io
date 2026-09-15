import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { isDemoMode } from '../../lib/supabase'
import { listarProfesionales, listarServicios } from '../../lib/api/catalogo'
import { consultarDisponibilidad, crearReserva } from '../../lib/api/reservas'
import { iniciarSesion, registrarCliente } from '../../lib/api/auth'
import { obtenerClientePorUsuario } from '../../lib/api/cliente'
import { fechaBogotaISO, formatoFecha, formatoHora, formatoMoneda } from '../../lib/format'
import type { Profesional, Servicio, SlotDisponible } from '../../lib/types'

type Paso = 'servicio' | 'profesional' | 'horario' | 'cuenta' | 'confirmar' | 'listo'

export function Reservar() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { perfil, cliente, demoRol, fijarDemoRol } = useAuth()

  const [servicios, setServicios] = useState<Servicio[] | null>(null)
  const [profesionales, setProfesionales] = useState<Profesional[] | null>(null)
  const [servicioId, setServicioId] = useState<string | null>(params.get('servicio'))
  const [profesionalId, setProfesionalId] = useState<string | null>(params.get('profesional'))
  const [fecha, setFecha] = useState(fechaBogotaISO())
  const [slots, setSlots] = useState<SlotDisponible[] | null>(null)
  const [slotElegido, setSlotElegido] = useState<SlotDisponible | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargandoAccion, setCargandoAccion] = useState(false)
  const [reservaCreada, setReservaCreada] = useState(false)

  const [modoCuenta, setModoCuenta] = useState<'ingresar' | 'registro'>('ingresar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')

  useEffect(() => {
    listarServicios().then(setServicios).catch((e) => setError(e.message))
    listarProfesionales().then(setProfesionales).catch((e) => setError(e.message))
  }, [])

  const servicio = servicios?.find((s) => s.id === servicioId) ?? null
  // Si se llegó desde el perfil de una profesional, solo se muestran sus servicios.
  const serviciosFiltrados = profesionalId
    ? servicios?.filter((s) => s.profesionales?.some((p) => p.id === profesionalId))
    : servicios
  const profesionalesDelServicio = servicio?.profesionales ?? profesionales ?? []

  const sesionActiva = Boolean(perfil && (cliente || demoRol === 'cliente'))

  const paso: Paso = useMemo(() => {
    if (reservaCreada) return 'listo'
    if (!servicioId) return 'servicio'
    if (!profesionalId) return 'profesional'
    if (!slotElegido) return 'horario'
    if (!sesionActiva) return 'cuenta'
    return 'confirmar'
  }, [reservaCreada, servicioId, profesionalId, slotElegido, sesionActiva])

  useEffect(() => {
    if (paso !== 'horario' || !servicioId || !profesionalId) return
    setSlots(null)
    consultarDisponibilidad(servicioId, profesionalId, fecha).then(setSlots).catch((e) => setError(e.message))
  }, [paso, servicioId, profesionalId, fecha])

  async function manejarIngreso(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargandoAccion(true)
    try {
      if (isDemoMode) {
        fijarDemoRol('cliente')
      } else if (modoCuenta === 'ingresar') {
        await iniciarSesion(email, password)
      } else {
        await registrarCliente(email, password, nombre)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCargandoAccion(false)
    }
  }

  async function confirmar() {
    if (!servicioId || !profesionalId || !slotElegido) return
    setError(null)
    setCargandoAccion(true)
    try {
      let clienteId = cliente?.id
      if (!clienteId && perfil) {
        const c = await obtenerClientePorUsuario(perfil.id)
        clienteId = c?.id
      }
      if (!clienteId) throw new Error('No se encontró tu perfil de cliente. Intenta iniciar sesión de nuevo.')
      await crearReserva({ clienteId, servicioId, profesionalId, inicioISO: slotElegido.inicio })
      setReservaCreada(true)
    } catch (err: any) {
      setError(err.message ?? 'No se pudo crear la reserva. Es posible que el horario ya no esté disponible.')
      setSlotElegido(null) // revalidar: el horario pudo ocuparse mientras tanto
    } finally {
      setCargandoAccion(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-marca text-3xl font-semibold text-carbon">Reservar cita</h1>
      <Pasos actual={paso} />
      {error && <div className="my-4"><ErrorState mensaje={error} /></div>}

      {paso === 'servicio' && (
        <div className="mt-6 flex flex-col gap-3">
          {!servicios ? (
            <Cargando />
          ) : (
            (profesionalId ? serviciosFiltrados : servicios)?.map((s) => (
              <button
                key={s.id}
                onClick={() => setServicioId(s.id)}
                className="flex items-center justify-between rounded-xl border border-piedra bg-blanco p-4 text-left hover:border-oliva"
              >
                <div>
                  <p className="font-semibold text-carbon">{s.nombre}</p>
                  <p className="text-xs text-carbon/60">{s.duracion_minutos} min</p>
                </div>
                <p className="font-semibold text-oliva">
                  {s.tipo_precio === 'a_valorar' ? 'A valorar' : formatoMoneda(s.precio)}
                </p>
              </button>
            ))
          )}
        </div>
      )}

      {paso === 'profesional' && (
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => setProfesionalId('sin-preferencia')}
            className="rounded-xl border border-dashed border-piedra bg-blanco p-4 text-left hover:border-oliva"
          >
            <p className="font-semibold text-carbon">Sin preferencia</p>
            <p className="text-xs text-carbon/60">Te asignamos la primera disponible.</p>
          </button>
          {profesionalesDelServicio.map((p) => (
            <button
              key={p.id}
              onClick={() => setProfesionalId(p.id)}
              className="flex items-center gap-3 rounded-xl border border-piedra bg-blanco p-4 text-left hover:border-oliva"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-piedra font-marca text-oliva">{p.nombre.charAt(0)}</div>
              <div>
                <p className="font-semibold text-carbon">{p.nombre}</p>
                <p className="text-xs text-carbon/60">{p.especialidades.join(', ')}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {paso === 'horario' && (
        <div className="mt-6">
          <label className="mb-2 block text-sm font-semibold text-carbon">Elige una fecha</label>
          <input
            type="date"
            value={fecha}
            min={fechaBogotaISO()}
            onChange={(e) => {
              setFecha(e.target.value)
              setSlotElegido(null)
            }}
            className="mb-4 rounded-lg border border-piedra px-3 py-2 text-sm"
          />
          {profesionalId === 'sin-preferencia' ? (
            <p className="text-sm text-carbon/60">
              Elige primero una profesional específica para ver horarios (en esta versión, "sin preferencia"
              se resuelve mostrándote el horario de la primera disponible; contacta al salón para casos particulares).
            </p>
          ) : !slots ? (
            <Cargando filas={2} />
          ) : slots.length === 0 ? (
            <p className="text-sm text-carbon/60">No hay horarios disponibles ese día. Prueba otra fecha.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => (
                <button
                  key={s.inicio}
                  onClick={() => setSlotElegido(s)}
                  className="rounded-lg border border-piedra bg-blanco py-2 text-sm font-medium hover:border-oliva"
                >
                  {formatoHora(s.inicio)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {paso === 'cuenta' && (
        <div className="mt-6">
          <p className="mb-4 text-sm text-carbon/70">
            Guardamos tu selección: {servicio?.nombre} el {slotElegido && formatoFecha(slotElegido.inicio)} a las{' '}
            {slotElegido && formatoHora(slotElegido.inicio)}. Inicia sesión o regístrate para confirmar.
          </p>
          {isDemoMode ? (
            <Button onClick={manejarIngreso} cargando={cargandoAccion}>Continuar (modo demo)</Button>
          ) : (
            <form onSubmit={manejarIngreso} className="flex flex-col gap-3">
              <div className="flex gap-2 text-sm">
                <button type="button" onClick={() => setModoCuenta('ingresar')} className={`font-semibold ${modoCuenta === 'ingresar' ? 'text-oliva' : 'text-carbon/50'}`}>
                  Ya tengo cuenta
                </button>
                <span className="text-carbon/30">·</span>
                <button type="button" onClick={() => setModoCuenta('registro')} className={`font-semibold ${modoCuenta === 'registro' ? 'text-oliva' : 'text-carbon/50'}`}>
                  Crear cuenta
                </button>
              </div>
              {modoCuenta === 'registro' && (
                <input required placeholder="Nombre completo" value={nombre} onChange={(e) => setNombre(e.target.value)} className="rounded-lg border border-piedra px-3 py-2 text-sm" />
              )}
              <input required type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-lg border border-piedra px-3 py-2 text-sm" />
              <input required type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-lg border border-piedra px-3 py-2 text-sm" />
              <Button type="submit" cargando={cargandoAccion}>{modoCuenta === 'ingresar' ? 'Ingresar' : 'Crear cuenta y continuar'}</Button>
            </form>
          )}
        </div>
      )}

      {paso === 'confirmar' && servicio && slotElegido && (
        <Card className="mt-6 flex flex-col gap-3">
          <p className="font-marca text-xl font-semibold text-carbon">Revisa tu reserva</p>
          <Fila etiqueta="Servicio" valor={servicio.nombre} />
          <Fila etiqueta="Fecha" valor={formatoFecha(slotElegido.inicio)} />
          <Fila etiqueta="Hora" valor={formatoHora(slotElegido.inicio)} />
          <Fila etiqueta="Duración" valor={`${servicio.duracion_minutos} min`} />
          <Fila etiqueta="Precio" valor={servicio.tipo_precio === 'a_valorar' ? 'Se acuerda en salón' : formatoMoneda(servicio.precio)} />
          {servicio.tipo_precio === 'a_valorar' && (
            <p className="text-xs text-carbon/50">El valor final se define al momento de prestar el servicio.</p>
          )}
          <Button onClick={confirmar} cargando={cargandoAccion} className="mt-2">Confirmar reserva</Button>
        </Card>
      )}

      {paso === 'listo' && (
        <Card className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-3xl">✓</p>
          <p className="font-marca text-xl font-semibold text-carbon">¡Reserva confirmada!</p>
          <p className="text-sm text-carbon/60">Ya puedes verla en tu portal de cliente.</p>
          <Button onClick={() => navigate('/cliente/reservas')}>Ver mis reservas</Button>
        </Card>
      )}
    </div>
  )
}

function Pasos({ actual }: { actual: Paso }) {
  const orden: Paso[] = ['servicio', 'profesional', 'horario', 'cuenta', 'confirmar']
  if (actual === 'listo') return null
  const idx = orden.indexOf(actual)
  return (
    <div className="mb-4 flex gap-1">
      {orden.map((_, i) => (
        <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= idx ? 'bg-oliva' : 'bg-piedra'}`} />
      ))}
    </div>
  )
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between border-b border-piedra/60 pb-2 text-sm">
      <span className="text-carbon/60">{etiqueta}</span>
      <span className="font-medium text-carbon">{valor}</span>
    </div>
  )
}
