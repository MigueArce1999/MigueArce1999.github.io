import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { isDemoMode } from '../../lib/supabase'
import { listarServicios, obtenerConfiguracionNegocio } from '../../lib/api/catalogo'
import { consultarDisponibilidad, consultarDisponibilidadEquipo, crearReserva, crearReservaCualquierProfesional } from '../../lib/api/reservas'
import { iniciarSesion, registrarCliente } from '../../lib/api/auth'
import { obtenerClientePorUsuario } from '../../lib/api/cliente'
import { fechaBogotaISO, formatoFecha, formatoHora, formatoPrecioServicio, horaBogota } from '../../lib/format'
import type { ConfiguracionNegocio, Servicio, SlotEquipoDisponible } from '../../lib/types'

type Paso = 'servicio' | 'profesional' | 'confirmar' | 'listo'
const SIN_PREFERENCIA = 'cualquiera'

export function Reservar() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { perfil, cliente, demoRol, fijarDemoRol } = useAuth()

  const [servicios, setServicios] = useState<Servicio[] | null>(null)
  const [config, setConfig] = useState<ConfiguracionNegocio | null>(null)
  const [servicioId, setServicioId] = useState<string | null>(params.get('servicio'))
  const [profesionalId, setProfesionalId] = useState<string | null>(params.get('profesional'))
  const [fecha, setFecha] = useState(fechaBogotaISO())
  const [slots, setSlots] = useState<SlotEquipoDisponible[] | null>(null)
  const [slotElegido, setSlotElegido] = useState<SlotEquipoDisponible | null>(null)
  const [buscandoSiguiente, setBuscandoSiguiente] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargandoAccion, setCargandoAccion] = useState(false)
  const [reservaCreada, setReservaCreada] = useState(false)
  const [solicitudPendiente, setSolicitudPendiente] = useState(false)

  const [modoCuenta, setModoCuenta] = useState<'ingresar' | 'registro'>('ingresar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')

  useEffect(() => {
    listarServicios().then(setServicios).catch((e) => setError(e.message))
    obtenerConfiguracionNegocio().then(setConfig).catch((e) => setError(e.message))
  }, [])

  const servicio = servicios?.find((s) => s.id === servicioId) ?? null
  // Solo servicios con duración confirmada se ofrecen para reservar en línea: uno sin duración
  // necesita valoración presencial (ver fn_crear_reserva) — nunca se inventa una duración/precio
  // definitivo para poder meterlo en el flujo.
  const serviciosReservables = servicios?.filter((s) => s.duracion_minutos != null) ?? null
  const serviciosNoReservables = servicios?.filter((s) => s.duracion_minutos == null) ?? []
  const profesionalesDelServicio = servicio?.profesionales ?? []

  const sesionActiva = Boolean(perfil && (cliente || demoRol === 'cliente'))

  const paso: Paso = useMemo(() => {
    if (reservaCreada) return 'listo'
    if (!servicioId) return 'servicio'
    if (!slotElegido) return 'profesional'
    return 'confirmar'
  }, [reservaCreada, servicioId, slotElegido])

  useEffect(() => {
    if (paso !== 'profesional' || !servicioId) return
    setSlots(null)
    setSlotElegido(null)
    if (profesionalId === SIN_PREFERENCIA) {
      const ids = profesionalesDelServicio.map((p) => p.id)
      consultarDisponibilidadEquipo(servicioId, ids, fecha).then(setSlots).catch((e) => setError(e.message))
    } else if (profesionalId) {
      consultarDisponibilidad(servicioId, profesionalId, fecha)
        .then((s) => setSlots(s.map((x) => ({ ...x, profesionales_disponibles: [profesionalId] }))))
        .catch((e) => setError(e.message))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, servicioId, profesionalId, fecha])

  async function buscarSiguienteFecha() {
    if (!servicioId || !profesionalId) return
    setBuscandoSiguiente(true)
    setError(null)
    try {
      const ids = profesionalId === SIN_PREFERENCIA ? profesionalesDelServicio.map((p) => p.id) : [profesionalId]
      const horizonte = config?.horizonte_reservas_dias ?? 60
      let encontrada = false
      for (let i = 1; i <= horizonte; i++) {
        const d = new Date(`${fecha}T12:00:00`)
        d.setDate(d.getDate() + i)
        const fechaCandidata = fechaBogotaISO(d)
        const resultado =
          profesionalId === SIN_PREFERENCIA
            ? await consultarDisponibilidadEquipo(servicioId, ids, fechaCandidata)
            : (await consultarDisponibilidad(servicioId, ids[0], fechaCandidata)).map((s) => ({ ...s, profesionales_disponibles: ids }))
        if (resultado.length > 0) {
          setFecha(fechaCandidata)
          encontrada = true
          break
        }
      }
      if (!encontrada) setError('No encontramos disponibilidad en los próximos días. Prueba cambiar de profesional o contáctanos directamente.')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBuscandoSiguiente(false)
    }
  }

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
    if (!servicioId || !slotElegido) return
    setError(null)
    setCargandoAccion(true)
    try {
      let clienteId = cliente?.id
      if (!clienteId && perfil) {
        const c = await obtenerClientePorUsuario(perfil.id)
        clienteId = c?.id
      }
      if (!clienteId) throw new Error('No se encontró tu perfil de cliente. Intenta iniciar sesión de nuevo.')

      const reserva =
        profesionalId === SIN_PREFERENCIA
          ? await crearReservaCualquierProfesional({ clienteId, servicioId, profesionalIds: slotElegido.profesionales_disponibles, inicioISO: slotElegido.inicio })
          : await crearReserva({ clienteId, servicioId, profesionalId: profesionalId!, inicioISO: slotElegido.inicio })

      setSolicitudPendiente(reserva.estado === 'pendiente')
      setReservaCreada(true)
    } catch (err: any) {
      setError(err.message ?? 'No se pudo crear la reserva. Es posible que el horario ya no esté disponible.')
      setSlotElegido(null) // revalidar: el horario pudo ocuparse mientras tanto
      setSlots(null)
    } finally {
      setCargandoAccion(false)
    }
  }

  const slotsManana = slots?.filter((s) => horaBogota(s.inicio) < 12) ?? []
  const slotsTarde = slots?.filter((s) => horaBogota(s.inicio) >= 12) ?? []

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 font-marca text-3xl font-semibold text-carbon">Reservar cita</h1>
      <Pasos actual={paso} />
      {error && <div className="my-4"><ErrorState mensaje={error} /></div>}

      {paso === 'servicio' && (
        <div className="mt-6 flex flex-col gap-3">
          {!serviciosReservables ? (
            <Cargando />
          ) : (
            <>
              {serviciosReservables.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setServicioId(s.id); setProfesionalId(null) }}
                  className="flex items-center justify-between rounded-xl border border-piedra bg-blanco p-4 text-left hover:border-oliva"
                >
                  <div>
                    <p className="font-semibold text-carbon">{s.nombre}</p>
                    <p className="text-xs text-carbon/60">{s.duracion_minutos} min</p>
                  </div>
                  <p className="font-semibold text-oliva">{formatoPrecioServicio(s)}</p>
                </button>
              ))}
              {serviciosNoReservables.length > 0 && (
                <div className="mt-2 rounded-xl border border-dashed border-piedra p-4">
                  <p className="text-sm font-semibold text-carbon">¿Buscas otro servicio?</p>
                  <p className="mt-1 text-xs text-carbon/60">
                    {serviciosNoReservables.map((s) => s.nombre).join(', ')} {serviciosNoReservables.length === 1 ? 'requiere' : 'requieren'} una valoración
                    presencial antes de definir duración y precio — contáctanos directamente para agendarla.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {paso === 'profesional' && (
        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <button
              onClick={() => setProfesionalId(SIN_PREFERENCIA)}
              className={`rounded-xl border p-4 text-left ${profesionalId === SIN_PREFERENCIA ? 'border-oliva bg-oliva/5' : 'border-dashed border-piedra bg-blanco hover:border-oliva'}`}
            >
              <p className="font-semibold text-carbon">Cualquier profesional</p>
              <p className="text-xs text-carbon/60">Te asignamos una profesional disponible en el horario que elijas.</p>
            </button>
            {profesionalesDelServicio.map((p) => (
              <button
                key={p.id}
                onClick={() => setProfesionalId(p.id)}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left ${profesionalId === p.id ? 'border-oliva bg-oliva/5' : 'border-piedra bg-blanco hover:border-oliva'}`}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-piedra font-marca text-oliva">{p.nombre.charAt(0)}</div>
                <div>
                  <p className="font-semibold text-carbon">{p.nombre}</p>
                  <p className="text-xs text-carbon/60">{p.especialidades.join(', ')}</p>
                </div>
              </button>
            ))}
          </div>

          {profesionalId && (
            <div>
              <label className="mb-2 block text-sm font-semibold text-carbon">Elige una fecha</label>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={fecha}
                  min={fechaBogotaISO()}
                  onChange={(e) => setFecha(e.target.value)}
                  className="rounded-lg border border-piedra px-3 py-2 text-sm"
                />
                <button type="button" onClick={buscarSiguienteFecha} disabled={buscandoSiguiente} className="text-sm font-semibold text-oliva hover:underline disabled:opacity-50">
                  {buscandoSiguiente ? 'Buscando…' : 'Buscar próxima fecha disponible'}
                </button>
              </div>

              {!slots ? (
                <Cargando filas={2} />
              ) : slots.length === 0 ? (
                <p className="text-sm text-carbon/60">
                  No hay horarios disponibles ese día. Prueba otra fecha{profesionalId !== SIN_PREFERENCIA ? ' o elige "Cualquier profesional"' : ''}.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {slotsManana.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-carbon/50">Mañana</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {slotsManana.map((s) => (
                          <button key={s.inicio} onClick={() => setSlotElegido(s)} className="rounded-lg border border-piedra bg-blanco py-2 text-sm font-medium hover:border-oliva">
                            {formatoHora(s.inicio)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {slotsTarde.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-carbon/50">Tarde</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {slotsTarde.map((s) => (
                          <button key={s.inicio} onClick={() => setSlotElegido(s)} className="rounded-lg border border-piedra bg-blanco py-2 text-sm font-medium hover:border-oliva">
                            {formatoHora(s.inicio)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {paso === 'confirmar' && servicio && slotElegido && (
        <div className="mt-6 flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <p className="font-marca text-xl font-semibold text-carbon">Revisa tu reserva</p>
            <Fila etiqueta="Servicio" valor={servicio.nombre} />
            <Fila
              etiqueta="Profesional"
              valor={profesionalId === SIN_PREFERENCIA ? 'Una de nuestras profesionales disponibles' : profesionalesDelServicio.find((p) => p.id === profesionalId)?.nombre ?? '—'}
            />
            <Fila etiqueta="Fecha" valor={formatoFecha(slotElegido.inicio)} />
            <Fila etiqueta="Hora" valor={formatoHora(slotElegido.inicio)} />
            {servicio.duracion_minutos != null && <Fila etiqueta="Duración" valor={`${servicio.duracion_minutos} min`} />}
            <Fila etiqueta="Precio" valor={formatoPrecioServicio(servicio, 'Se acuerda en salón')} />
            {config && (
              <p className="text-xs text-carbon/50">
                Puedes cancelar o reprogramar hasta {config.cancelacion_horas_limite} horas antes de tu cita desde "Mis reservas".
              </p>
            )}
          </Card>

          {!sesionActiva ? (
            <Card className="flex flex-col gap-3">
              <p className="text-sm text-carbon/70">Inicia sesión o regístrate para confirmar tu reserva.</p>
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
                  <Button type="submit" cargando={cargandoAccion}>{modoCuenta === 'ingresar' ? 'Ingresar' : 'Crear cuenta'}</Button>
                </form>
              )}
            </Card>
          ) : (
            <Button onClick={confirmar} cargando={cargandoAccion} tamano="lg">
              {config?.modo_confirmacion === 'manual' ? 'Solicitar reserva' : 'Confirmar reserva'}
            </Button>
          )}
        </div>
      )}

      {paso === 'listo' && (
        <Card className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-3xl">{solicitudPendiente ? '⏳' : '✓'}</p>
          <p className="font-marca text-xl font-semibold text-carbon">{solicitudPendiente ? 'Solicitud enviada' : '¡Reserva confirmada!'}</p>
          <p className="text-sm text-carbon/60">
            {solicitudPendiente
              ? `Tu horario queda reservado provisionalmente. Si nadie del salón la confirma en los próximos ${config?.reserva_pendiente_expira_minutos ?? 30} minutos, quedará liberado automáticamente.`
              : 'Ya puedes verla en tu portal de cliente.'}
          </p>
          <Button onClick={() => navigate('/cliente/reservas')}>Ver mis reservas</Button>
        </Card>
      )}
    </div>
  )
}

function Pasos({ actual }: { actual: Paso }) {
  const orden: Paso[] = ['servicio', 'profesional', 'confirmar']
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
