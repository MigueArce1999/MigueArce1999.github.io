import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Input, Select, Textarea } from '../../components/ui/Campos'
import { Modal } from '../../components/ui/Modal'
import { EstadoPagoBadge, EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { EstadoSolicitudBadge, HorarioHabitual, AusenciasBloqueos } from '../empleada/Disponibilidad'
import { listarProfesionales, listarServicios } from '../../lib/api/catalogo'
import { buscarClientes, listarClientesRecientes } from '../../lib/api/empleada'
import { crearClienteAdmin } from '../../lib/api/clientes'
import {
  aprobarSolicitudBloqueo,
  aprobarSolicitudHorario,
  listarBloqueosAusencias,
  listarSolicitudesHorario,
  rechazarSolicitudBloqueo,
  rechazarSolicitudHorario,
  reservasAfectadasPorBloqueo,
  reservasAfectadasPorHorario,
} from '../../lib/api/agenda'
import {
  cancelarReserva,
  confirmarReservaPendiente,
  consultarDisponibilidad,
  crearReserva,
  marcarNoAsistio,
  obtenerAtencionDeReserva,
  listarAgendaGeneral,
  reasignarReserva,
  reprogramarReserva,
} from '../../lib/api/reservas'
import { fechaBogotaISO, formatoFecha, formatoHora, minutosDesdeMedianocheBogota } from '../../lib/format'
import type { BloqueoAusencia, Cliente, EstadoReserva, Profesional, Reserva, Servicio, SlotDisponible, SolicitudHorario } from '../../lib/types'

type Vista = 'dia' | 'semana'
type Tab = 'agenda' | 'solicitudes'
const ESTADOS: EstadoReserva[] = ['pendiente', 'confirmada', 'en_atencion', 'completada', 'cancelada', 'no_asistio']

function inicioSemana(fecha: Date) {
  const d = new Date(fecha)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

export function AdminAgenda() {
  const [tab, setTab] = useState<Tab>('agenda')
  const [equipo, setEquipo] = useState<Profesional[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])

  useEffect(() => {
    listarProfesionales().then(setEquipo)
    listarServicios().then(setServicios)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Agenda</h1>
        <div className="flex gap-2">
          <button onClick={() => setTab('agenda')} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === 'agenda' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
            Agenda
          </button>
          <button onClick={() => setTab('solicitudes')} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === 'solicitudes' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
            Solicitudes
          </button>
        </div>
      </div>
      {tab === 'agenda' ? <PanelAgenda equipo={equipo} servicios={servicios} /> : <PanelSolicitudes />}
    </div>
  )
}

// --- Agenda ----------------------------------------------------------------------------------

function PanelAgenda({ equipo, servicios }: { equipo: Profesional[]; servicios: Servicio[] }) {
  const [vista, setVista] = useState<Vista>('dia')
  const [referencia, setReferencia] = useState(new Date())
  const [profesionalFiltro, setProfesionalFiltro] = useState('todas')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoReserva | 'todos'>('todos')
  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seleccionada, setSeleccionada] = useState<Reserva | null>(null)
  const [modalNueva, setModalNueva] = useState(false)
  const [gestionarHorarioDe, setGestionarHorarioDe] = useState<Profesional | null>(null)

  const desde = vista === 'dia' ? new Date(referencia) : inicioSemana(referencia)
  if (vista === 'dia') desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde)
  hasta.setDate(hasta.getDate() + (vista === 'dia' ? 1 : 7))

  function recargar() {
    setReservas(null)
    listarAgendaGeneral(desde.toISOString(), hasta.toISOString()).then(setReservas).catch((e) => setError(e.message))
  }
  useEffect(recargar, [vista, referencia])

  const visibles = reservas?.filter(
    (r) => (profesionalFiltro === 'todas' || r.profesional_id === profesionalFiltro) && (estadoFiltro === 'todos' || r.estado === estadoFiltro),
  )

  function mover(dias: number) {
    setReferencia((f) => {
      const d = new Date(f)
      d.setDate(d.getDate() + dias)
      return d
    })
  }

  const equipoVisible = profesionalFiltro === 'todas' ? equipo : equipo.filter((p) => p.id === profesionalFiltro)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => mover(vista === 'dia' ? -1 : -7)} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">←</button>
        <button onClick={() => setReferencia(new Date())} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">Hoy</button>
        <button onClick={() => mover(vista === 'dia' ? 1 : 7)} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">→</button>
        <input
          type="date"
          value={fechaBogotaISO(referencia)}
          onChange={(e) => setReferencia(new Date(`${e.target.value}T12:00:00`))}
          className="rounded-lg border border-piedra px-3 py-1.5 text-sm"
        />
        <div className="ml-auto flex gap-2">
          {(['dia', 'semana'] as Vista[]).map((v) => (
            <button key={v} onClick={() => setVista(v)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${vista === v ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={profesionalFiltro} onChange={(e) => setProfesionalFiltro(e.target.value)} className="rounded-lg border border-piedra px-3 py-1.5 text-sm">
          <option value="todas">Todas las profesionales</option>
          {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value as any)} className="rounded-lg border border-piedra px-3 py-1.5 text-sm">
          <option value="todos">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <Button tamano="sm" onClick={() => setModalNueva(true)} className="ml-auto">+ Nueva cita</Button>
        {profesionalFiltro !== 'todas' && (
          <Button tamano="sm" variante="secondary" onClick={() => setGestionarHorarioDe(equipo.find((p) => p.id === profesionalFiltro) ?? null)}>
            Horario de {equipo.find((p) => p.id === profesionalFiltro)?.nombre}
          </Button>
        )}
      </div>

      {error && <ErrorState mensaje={error} />}
      {!visibles ? (
        <Cargando />
      ) : (
        <>
          {/* Escritorio: columnas por profesional en vista día; lista en semana. */}
          <div className="hidden md:block">
            {vista === 'dia' ? (
              <VistaDiaColumnas fecha={referencia} equipo={equipoVisible} reservas={visibles} onAbrir={setSeleccionada} />
            ) : (
              <VistaSemanaAdmin inicio={desde} reservas={visibles} onAbrir={setSeleccionada} />
            )}
          </div>
          {/* Móvil: siempre lista cronológica, ya filtrada. */}
          <div className="md:hidden">
            <VistaListaMovil reservas={visibles} onAbrir={setSeleccionada} />
          </div>
        </>
      )}

      {seleccionada && (
        <DetalleCitaAdmin
          reserva={seleccionada}
          equipo={equipo}
          onCerrar={() => setSeleccionada(null)}
          onCambio={() => { setSeleccionada(null); recargar() }}
        />
      )}

      <Modal abierto={modalNueva} onCerrar={() => setModalNueva(false)} titulo="Nueva cita">
        <FormularioNuevaCita servicios={servicios} equipo={equipo} onCreada={() => { setModalNueva(false); recargar() }} />
      </Modal>

      <Modal abierto={gestionarHorarioDe !== null} onCerrar={() => setGestionarHorarioDe(null)} titulo={`Horario de ${gestionarHorarioDe?.nombre ?? ''}`}>
        {gestionarHorarioDe && (
          <div className="flex flex-col gap-4">
            <HorarioHabitual profesionalId={gestionarHorarioDe.id} />
            <div className="border-t border-piedra pt-4">
              <AusenciasBloqueos profesionalId={gestionarHorarioDe.id} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

const HORA_INICIO = 7
const HORA_FIN = 20
const PX_HORA = 56

function VistaDiaColumnas({ fecha, equipo, reservas, onAbrir }: { fecha: Date; equipo: Profesional[]; reservas: Reserva[]; onAbrir: (r: Reserva) => void }) {
  const clave = fechaBogotaISO(fecha)
  const horas = Array.from({ length: HORA_FIN - HORA_INICIO }, (_, i) => HORA_INICIO + i)
  const alturaTotal = (HORA_FIN - HORA_INICIO) * PX_HORA

  if (equipo.length === 0) return <EmptyState titulo="No hay profesionales para mostrar" />

  return (
    <div className="overflow-x-auto rounded-2xl border border-piedra bg-blanco">
      <div className="flex min-w-[640px]">
        <div className="w-14 shrink-0 border-r border-piedra/60">
          <div className="h-10 border-b border-piedra/60" />
          {horas.map((h) => (
            <div key={h} style={{ height: PX_HORA }} className="border-b border-piedra/30 pr-1 text-right text-[10px] text-carbon/40">
              {h}:00
            </div>
          ))}
        </div>
        {equipo.map((p) => {
          const delDia = reservas.filter((r) => r.profesional_id === p.id && fechaBogotaISO(new Date(r.rango_inicio)) === clave)
          return (
            <div key={p.id} className="flex-1 border-r border-piedra/60 last:border-r-0">
              <div className="flex h-10 items-center justify-center border-b border-piedra/60 px-2 text-xs font-semibold text-carbon">{p.nombre}</div>
              <div className="relative" style={{ height: alturaTotal }}>
                {horas.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-b border-piedra/20" style={{ top: (h - HORA_INICIO) * PX_HORA }} />
                ))}
                {delDia.map((r) => {
                  const inicioMin = minutosDesdeMedianocheBogota(r.rango_inicio) - HORA_INICIO * 60
                  const finMin = minutosDesdeMedianocheBogota(r.rango_fin) - HORA_INICIO * 60
                  const top = (inicioMin / 60) * PX_HORA
                  const alto = Math.max(((finMin - inicioMin) / 60) * PX_HORA, 20)
                  const color = r.estado === 'cancelada' || r.estado === 'no_asistio' ? 'bg-carbon/10 text-carbon/50 line-through' : r.estado === 'completada' ? 'bg-exito/15 text-exito' : 'bg-oliva/15 text-oliva'
                  return (
                    <button
                      key={r.id}
                      onClick={() => onAbrir(r)}
                      className={`absolute inset-x-0.5 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium ${color}`}
                      style={{ top, height: alto }}
                      title={`${formatoHora(r.rango_inicio)} · ${r.servicio_nombre} · ${r.cliente_nombre}`}
                    >
                      {formatoHora(r.rango_inicio)} {r.cliente_nombre}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VistaSemanaAdmin({ inicio, reservas, onAbrir }: { inicio: Date; reservas: Reserva[]; onAbrir: (r: Reserva) => void }) {
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(inicio)
    d.setDate(d.getDate() + i)
    return d
  })
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {dias.map((dia) => {
        const clave = fechaBogotaISO(dia)
        const delDia = reservas.filter((r) => fechaBogotaISO(new Date(r.rango_inicio)) === clave).sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio))
        return (
          <Card key={clave}>
            <p className="mb-2 text-sm font-semibold text-carbon">{formatoFecha(dia.toISOString(), { weekday: 'long', day: '2-digit', month: 'short', year: undefined })}</p>
            {delDia.length === 0 ? (
              <p className="text-xs text-carbon/40">Sin citas</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {delDia.map((r) => (
                  <button key={r.id} onClick={() => onAbrir(r)} className="flex items-center justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-piedra/20">
                    <span className="text-carbon">{formatoHora(r.rango_inicio)} · {r.profesional_nombre} · {r.cliente_nombre}</span>
                    <EstadoReservaBadge estado={r.estado} />
                  </button>
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function VistaListaMovil({ reservas, onAbrir }: { reservas: Reserva[]; onAbrir: (r: Reserva) => void }) {
  const ordenadas = reservas.slice().sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio))
  if (ordenadas.length === 0) return <EmptyState titulo="No hay citas con estos filtros" />
  return (
    <div className="flex flex-col gap-2">
      {ordenadas.map((r) => (
        <button key={r.id} onClick={() => onAbrir(r)} className="block w-full text-left">
          <Card className="flex items-center justify-between py-3">
            <div>
              <p className="font-medium text-carbon">{formatoFecha(r.rango_inicio)} · {formatoHora(r.rango_inicio)} · {r.servicio_nombre}</p>
              <p className="text-xs text-carbon/60">{r.cliente_nombre} con {r.profesional_nombre}</p>
            </div>
            <EstadoReservaBadge estado={r.estado} />
          </Card>
        </button>
      ))}
    </div>
  )
}

function DetalleCitaAdmin({ reserva, equipo, onCerrar, onCambio }: { reserva: Reserva; equipo: Profesional[]; onCerrar: () => void; onCambio: () => void }) {
  const navigate = useNavigate()
  const [modo, setModo] = useState<'ver' | 'reprogramar' | 'reasignar' | 'cancelar'>('ver')
  const [fecha, setFecha] = useState(fechaBogotaISO(new Date(reserva.rango_inicio)))
  const [slots, setSlots] = useState<SlotDisponible[] | null>(null)
  const [nuevoProfesional, setNuevoProfesional] = useState('')
  const [motivoCancelacion, setMotivoCancelacion] = useState('Cancelada desde administración')
  const [pago, setPago] = useState<{ totalVendido: number; totalPagado: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (reserva.estado === 'completada') obtenerAtencionDeReserva(reserva.id).then(setPago)
  }, [reserva.id, reserva.estado])

  useEffect(() => {
    if (modo !== 'reprogramar') return
    setSlots(null)
    consultarDisponibilidad(reserva.servicio_id, reserva.profesional_id, fecha).then(setSlots).catch((e) => setError(e.message))
  }, [modo, fecha, reserva])

  async function accion(fn: () => Promise<void>) {
    setCargando(true)
    setError(null)
    try {
      await fn()
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  const yaPaso = new Date(reserva.rango_inicio) < new Date()
  const puedeGestionar = ['pendiente', 'confirmada'].includes(reserva.estado)
  const otrasProfesionales = equipo.filter((p) => p.id !== reserva.profesional_id)

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Detalle de la cita">
      {error && <div className="mb-3"><ErrorState mensaje={error} /></div>}
      {modo === 'ver' && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-semibold text-carbon">{reserva.servicio_nombre}</p>
            <p className="text-sm text-carbon/60">{formatoFecha(reserva.rango_inicio)} · {formatoHora(reserva.rango_inicio)}–{formatoHora(reserva.rango_fin)}</p>
            <p className="text-sm text-carbon/60">Clienta: {reserva.cliente_nombre}</p>
            <p className="text-sm text-carbon/60">Profesional: {reserva.profesional_nombre}</p>
          </div>
          <div className="flex items-center gap-2">
            <EstadoReservaBadge estado={reserva.estado} />
            {reserva.estado === 'completada' && pago && <EstadoPagoBadge pagado={pago.totalPagado} total={pago.totalVendido} />}
          </div>
          {reserva.notas && <p className="text-xs text-carbon/60">Notas: {reserva.notas}</p>}

          <div className="mt-2 flex flex-wrap gap-2">
            {!['completada', 'cancelada', 'no_asistio'].includes(reserva.estado) && (
              <Button onClick={() => navigate(`/admin/ventas/nueva?reservaId=${reserva.id}`)}>Iniciar atención</Button>
            )}
            {reserva.estado === 'pendiente' && (
              <Button variante="secondary" cargando={cargando} onClick={() => accion(() => confirmarReservaPendiente(reserva.id))}>Confirmar</Button>
            )}
            {puedeGestionar && <Button variante="secondary" onClick={() => setModo('reprogramar')}>Reprogramar</Button>}
            {puedeGestionar && otrasProfesionales.length > 0 && <Button variante="secondary" onClick={() => setModo('reasignar')}>Reasignar</Button>}
            {puedeGestionar && <Button variante="danger" onClick={() => setModo('cancelar')}>Cancelar</Button>}
            {puedeGestionar && yaPaso && (
              <Button variante="ghost" cargando={cargando} onClick={() => accion(() => marcarNoAsistio(reserva.id))}>Marcar no asistió</Button>
            )}
          </div>
        </div>
      )}

      {modo === 'reprogramar' && (
        <div>
          <input type="date" value={fecha} min={fechaBogotaISO()} onChange={(e) => setFecha(e.target.value)} className="mb-4 rounded-lg border border-piedra px-3 py-2 text-sm" />
          {!slots ? (
            <Cargando filas={2} />
          ) : slots.length === 0 ? (
            <p className="text-sm text-carbon/60">No hay horarios disponibles ese día.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((s) => (
                <button
                  key={s.inicio}
                  disabled={cargando}
                  onClick={() => accion(() => reprogramarReserva(reserva.id, s.inicio))}
                  className="rounded-lg border border-piedra bg-blanco py-2 text-sm font-medium hover:border-oliva disabled:opacity-50"
                >
                  {formatoHora(s.inicio)}
                </button>
              ))}
            </div>
          )}
          <Button variante="ghost" className="mt-3" onClick={() => setModo('ver')}>Volver</Button>
        </div>
      )}

      {modo === 'reasignar' && (
        <div className="flex flex-col gap-3">
          <Select id="nuevaProfesional" etiqueta="Reasignar a" value={nuevoProfesional} onChange={(e) => setNuevoProfesional(e.target.value)}>
            <option value="">Elegir…</option>
            {otrasProfesionales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Select>
          <p className="text-xs text-carbon/50">Si la nueva profesional no realiza este servicio o no tiene ese horario libre, se mostrará un error claro sin mover la cita.</p>
          <div className="flex gap-2">
            <Button disabled={!nuevoProfesional} cargando={cargando} onClick={() => accion(() => reasignarReserva(reserva.id, nuevoProfesional))}>Confirmar reasignación</Button>
            <Button variante="ghost" onClick={() => setModo('ver')}>Volver</Button>
          </div>
        </div>
      )}

      {modo === 'cancelar' && (
        <div className="flex flex-col gap-3">
          <Textarea id="motivoCancelacion" etiqueta="Motivo" value={motivoCancelacion} onChange={(e) => setMotivoCancelacion(e.target.value)} />
          <div className="flex gap-2">
            <Button variante="danger" cargando={cargando} onClick={() => accion(() => cancelarReserva(reserva.id, motivoCancelacion))}>Sí, cancelar la cita</Button>
            <Button variante="ghost" onClick={() => setModo('ver')}>Volver</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function FormularioNuevaCita({ servicios, equipo, onCreada }: { servicios: Servicio[]; equipo: Profesional[]; onCreada: () => void }) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [creandoCliente, setCreandoCliente] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [telefonoNuevo, setTelefonoNuevo] = useState('')
  const [servicioId, setServicioId] = useState('')
  const [profesionalId, setProfesionalId] = useState('')
  const [fecha, setFecha] = useState(fechaBogotaISO())
  const [slots, setSlots] = useState<SlotDisponible[] | null>(null)
  const [slotElegido, setSlotElegido] = useState<SlotDisponible | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarClientesRecientes().then(setResultados)
  }, [])

  useEffect(() => {
    if (!busqueda.trim()) { listarClientesRecientes().then(setResultados); return }
    const t = setTimeout(() => buscarClientes(busqueda).then(setResultados), 250)
    return () => clearTimeout(t)
  }, [busqueda])

  const servicio = servicios.find((s) => s.id === servicioId) ?? null
  const profesionalesDelServicio = servicio?.profesionales ?? equipo

  useEffect(() => {
    if (!servicioId || !profesionalId) { setSlots(null); return }
    setSlots(null)
    setSlotElegido(null)
    consultarDisponibilidad(servicioId, profesionalId, fecha).then(setSlots).catch((e) => setError(e.message))
  }, [servicioId, profesionalId, fecha])

  async function crearNuevoCliente() {
    if (!nombreNuevo.trim() || !telefonoNuevo.trim()) { setError('Nombre y teléfono son obligatorios para crear la clienta.'); return }
    setError(null)
    try {
      const { id } = await crearClienteAdmin({ nombre: nombreNuevo.trim(), telefono: telefonoNuevo.trim(), email: null, consentimientoMarketing: false })
      setCliente({ id, usuario_id: null, nombre: nombreNuevo.trim(), telefono: telefonoNuevo.trim(), email: null, consentimiento_marketing: false, visitas_completadas: 0, gasto_acumulado: 0, activo: true, origen_registro: 'admin', notas: null, resena_google_confirmada: false, creado_en: new Date().toISOString() })
      setCreandoCliente(false)
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function confirmar() {
    if (!cliente || !servicioId || !profesionalId || !slotElegido) return
    setGuardando(true)
    setError(null)
    try {
      await crearReserva({ clienteId: cliente.id, servicioId, profesionalId, inicioISO: slotElegido.inicio, origen: 'recepcion' })
      onCreada()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}

      <div>
        <p className="mb-2 text-sm font-semibold text-carbon">Clienta</p>
        {cliente ? (
          <div className="flex items-center justify-between rounded-lg border border-oliva/40 bg-oliva/5 px-3 py-2 text-sm">
            <span>{cliente.nombre} {cliente.telefono ? `· ${cliente.telefono}` : ''}</span>
            <button onClick={() => setCliente(null)} className="text-xs font-semibold text-oliva hover:underline">Cambiar</button>
          </div>
        ) : creandoCliente ? (
          <div className="flex flex-col gap-2 rounded-lg border border-piedra p-3">
            <Input id="nombreNuevoCliente" etiqueta="Nombre" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} />
            <Input id="telefonoNuevoCliente" etiqueta="Teléfono" value={telefonoNuevo} onChange={(e) => setTelefonoNuevo(e.target.value)} />
            <div className="flex gap-2">
              <Button tamano="sm" type="button" onClick={crearNuevoCliente}>Crear y usar</Button>
              <Button tamano="sm" variante="ghost" type="button" onClick={() => setCreandoCliente(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o teléfono…"
              className="rounded-lg border border-piedra px-3 py-2 text-sm"
            />
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {resultados.map((c) => (
                <button key={c.id} onClick={() => setCliente(c)} className="rounded-lg px-2 py-1.5 text-left text-sm hover:bg-piedra/20">
                  {c.nombre} <span className="text-carbon/50">{c.telefono}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setCreandoCliente(true)} className="self-start text-xs font-semibold text-oliva hover:underline">
              + Es una clienta nueva
            </button>
          </div>
        )}
      </div>

      <Select id="servicioNuevaCita" etiqueta="Servicio" value={servicioId} onChange={(e) => { setServicioId(e.target.value); setProfesionalId('') }}>
        <option value="">Elegir…</option>
        {servicios.filter((s) => s.duracion_minutos != null).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </Select>

      {servicioId && (
        <Select id="profesionalNuevaCita" etiqueta="Profesional" value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)}>
          <option value="">Elegir…</option>
          {profesionalesDelServicio.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Select>
      )}

      {profesionalId && (
        <div>
          <label className="mb-2 block text-sm font-semibold text-carbon">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mb-3 rounded-lg border border-piedra px-3 py-2 text-sm" />
          {!slots ? (
            <Cargando filas={2} />
          ) : slots.length === 0 ? (
            <p className="text-sm text-carbon/60">Sin horarios disponibles ese día.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s) => (
                <button
                  key={s.inicio}
                  onClick={() => setSlotElegido(s)}
                  className={`rounded-lg border py-2 text-sm font-medium ${slotElegido?.inicio === s.inicio ? 'border-oliva bg-oliva/10' : 'border-piedra hover:border-oliva'}`}
                >
                  {formatoHora(s.inicio)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Button disabled={!cliente || !slotElegido} cargando={guardando} onClick={confirmar}>Crear cita</Button>
      <p className="text-xs text-carbon/50">Esta cita afecta la disponibilidad en línea de inmediato, igual que cualquier otra reserva.</p>
    </div>
  )
}

// --- Solicitudes -----------------------------------------------------------------------------

type SolicitudUnificada =
  | { clase: 'horario'; data: SolicitudHorario }
  | { clase: 'bloqueo'; data: BloqueoAusencia }

function PanelSolicitudes() {
  const [solicitudes, setSolicitudes] = useState<SolicitudUnificada[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<'pendiente' | 'todas'>('pendiente')

  function cargar() {
    setSolicitudes(null)
    Promise.all([
      listarSolicitudesHorario(undefined, filtroEstado === 'pendiente' ? 'pendiente' : undefined),
      listarBloqueosAusencias(undefined, filtroEstado === 'pendiente' ? 'pendiente' : undefined),
    ])
      .then(([horarios, bloqueos]) => {
        const combinadas: SolicitudUnificada[] = [
          ...horarios.map((h): SolicitudUnificada => ({ clase: 'horario', data: h })),
          ...bloqueos.map((b): SolicitudUnificada => ({ clase: 'bloqueo', data: b })),
        ].sort((a, b) => b.data.creado_en.localeCompare(a.data.creado_en))
        setSolicitudes(combinadas)
      })
      .catch((e) => setError(e.message))
  }
  useEffect(cargar, [filtroEstado])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button onClick={() => setFiltroEstado('pendiente')} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${filtroEstado === 'pendiente' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
          Pendientes
        </button>
        <button onClick={() => setFiltroEstado('todas')} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${filtroEstado === 'todas' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
          Todas
        </button>
      </div>
      {error && <ErrorState mensaje={error} />}
      {!solicitudes ? (
        <Cargando filas={3} />
      ) : solicitudes.length === 0 ? (
        <EmptyState titulo="No hay solicitudes" descripcion={filtroEstado === 'pendiente' ? 'Ninguna solicitud pendiente de revisión.' : undefined} />
      ) : (
        <div className="flex flex-col gap-2">
          {solicitudes.map((s) =>
            s.clase === 'horario' ? (
              <SolicitudHorarioCard key={`h-${s.data.id}`} solicitud={s.data} onCambio={cargar} />
            ) : (
              <SolicitudBloqueoCard key={`b-${s.data.id}`} solicitud={s.data} onCambio={cargar} />
            ),
          )}
        </div>
      )}
    </div>
  )
}

const ETIQUETA_TIPO_BLOQUEO: Record<BloqueoAusencia['tipo'], string> = {
  bloqueo: 'Bloqueo de horas',
  ausencia_dia: 'Día libre',
  ausencia_rango: 'Rango de fechas',
}

function SolicitudHorarioCard({ solicitud, onCambio }: { solicitud: SolicitudHorario; onCambio: () => void }) {
  const [conflictos, setConflictos] = useState<Reserva[] | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState('')
  const [rechazando, setRechazando] = useState(false)

  async function revisar() {
    setRevisando(true)
    setError(null)
    try {
      setConflictos(await reservasAfectadasPorHorario(solicitud.profesional_id, solicitud.intervalos, solicitud.vigente_desde))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRevisando(false)
    }
  }

  async function aprobar() {
    setProcesando(true)
    setError(null)
    try {
      await aprobarSolicitudHorario(solicitud.id)
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setProcesando(false)
    }
  }

  async function rechazar() {
    setProcesando(true)
    setError(null)
    try {
      await rechazarSolicitudHorario(solicitud.id, motivoRechazo)
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setProcesando(false)
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      {error && <ErrorState mensaje={error} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-carbon">{solicitud.profesional_nombre} · Cambio de horario</p>
          <p className="text-xs text-carbon/60">A partir del {formatoFecha(solicitud.vigente_desde)} · {solicitud.intervalos.length} intervalo(s)</p>
          {solicitud.motivo && <p className="text-xs text-carbon/50">{solicitud.motivo}</p>}
        </div>
        <EstadoSolicitudBadge estado={solicitud.estado} />
      </div>
      {solicitud.estado === 'pendiente' && (
        <>
          {conflictos === null ? (
            <Button tamano="sm" variante="secondary" onClick={revisar} cargando={revisando} className="self-start">Revisar conflictos</Button>
          ) : conflictos.length > 0 ? (
            <div className="rounded-lg border border-advertencia/40 bg-advertencia/10 p-3">
              <p className="text-sm font-semibold text-carbon">Afecta {conflictos.length} cita(s) — resuélvelas en la agenda antes de aprobar:</p>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-carbon/70">
                {conflictos.map((c) => <li key={c.id}>{formatoFecha(c.rango_inicio)} · {formatoHora(c.rango_inicio)} — {c.cliente_nombre}</li>)}
              </ul>
              <Button tamano="sm" variante="ghost" className="mt-2" onClick={() => setConflictos(null)}>Volver a revisar</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-exito">Sin conflictos.</p>
              <Button tamano="sm" cargando={procesando} onClick={aprobar}>Aprobar</Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Motivo de rechazo (opcional)" className="flex-1 rounded-lg border border-piedra px-2 py-1 text-xs" />
            <Button tamano="sm" variante="danger" cargando={rechazando} onClick={() => { setRechazando(true); rechazar().finally(() => setRechazando(false)) }}>Rechazar</Button>
          </div>
        </>
      )}
    </Card>
  )
}

function SolicitudBloqueoCard({ solicitud, onCambio }: { solicitud: BloqueoAusencia; onCambio: () => void }) {
  const [conflictos, setConflictos] = useState<Reserva[] | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState('')

  async function revisar() {
    setRevisando(true)
    setError(null)
    try {
      setConflictos(await reservasAfectadasPorBloqueo(solicitud.profesional_id, solicitud.rango_inicio, solicitud.rango_fin))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRevisando(false)
    }
  }

  async function aprobar() {
    setProcesando(true)
    setError(null)
    try {
      await aprobarSolicitudBloqueo(solicitud.id)
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setProcesando(false)
    }
  }

  async function rechazar() {
    setProcesando(true)
    setError(null)
    try {
      await rechazarSolicitudBloqueo(solicitud.id, motivoRechazo)
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setProcesando(false)
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      {error && <ErrorState mensaje={error} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-carbon">{solicitud.profesional_nombre} · {ETIQUETA_TIPO_BLOQUEO[solicitud.tipo]}</p>
          <p className="text-xs text-carbon/60">
            {formatoFecha(solicitud.rango_inicio)}
            {!solicitud.todo_el_dia && ` · ${formatoHora(solicitud.rango_inicio)}–${formatoHora(solicitud.rango_fin)}`}
          </p>
          {solicitud.motivo && <p className="text-xs text-carbon/50">{solicitud.motivo}</p>}
        </div>
        <EstadoSolicitudBadge estado={solicitud.estado} />
      </div>
      {solicitud.estado === 'pendiente' && (
        <>
          {conflictos === null ? (
            <Button tamano="sm" variante="secondary" onClick={revisar} cargando={revisando} className="self-start">Revisar conflictos</Button>
          ) : conflictos.length > 0 ? (
            <div className="rounded-lg border border-advertencia/40 bg-advertencia/10 p-3">
              <p className="text-sm font-semibold text-carbon">Afecta {conflictos.length} cita(s) — resuélvelas en la agenda antes de aprobar:</p>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-carbon/70">
                {conflictos.map((c) => <li key={c.id}>{formatoFecha(c.rango_inicio)} · {formatoHora(c.rango_inicio)} — {c.cliente_nombre}</li>)}
              </ul>
              <Button tamano="sm" variante="ghost" className="mt-2" onClick={() => setConflictos(null)}>Volver a revisar</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-exito">Sin conflictos.</p>
              <Button tamano="sm" cargando={procesando} onClick={aprobar}>Aprobar</Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} placeholder="Motivo de rechazo (opcional)" className="flex-1 rounded-lg border border-piedra px-2 py-1 text-xs" />
            <Button tamano="sm" variante="danger" cargando={procesando} onClick={rechazar}>Rechazar</Button>
          </div>
        </>
      )}
    </Card>
  )
}
