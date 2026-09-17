import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Modal } from '../../components/ui/Modal'
import { EstadoPagoBadge, EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { useAuth } from '../../state/AuthContext'
import { isDemoMode, supabaseRequerido } from '../../lib/supabase'
import { listarBloqueosAusencias, obtenerHorarioVigente } from '../../lib/api/agenda'
import {
  cancelarReserva,
  confirmarReservaPendiente,
  consultarDisponibilidad,
  marcarNoAsistio,
  obtenerAtencionDeReserva,
  listarReservasDeProfesional,
  reprogramarReserva,
} from '../../lib/api/reservas'
import { fechaBogotaISO, formatoFecha, formatoHora } from '../../lib/format'
import type { BloqueoAusencia, HorarioDisponibilidad, Reserva, SlotDisponible } from '../../lib/types'

type Vista = 'dia' | 'semana'

function inicioSemana(fecha: Date) {
  const d = new Date(fecha)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function seSuperponen(aInicio: Date, aFin: Date, bInicio: Date, bFin: Date) {
  return aInicio < bFin && bInicio < aFin
}

export function EmpleadaAgenda() {
  const { profesional } = useAuth()
  const [vista, setVista] = useState<Vista>('dia')
  const [referencia, setReferencia] = useState(new Date())
  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [horario, setHorario] = useState<HorarioDisponibilidad[]>([])
  const [bloqueos, setBloqueos] = useState<BloqueoAusencia[]>([])
  const [seleccionada, setSeleccionada] = useState<Reserva | null>(null)
  const [permisoAgendaEquipo, setPermisoAgendaEquipo] = useState(false)

  const desde = vista === 'dia' ? new Date(referencia) : inicioSemana(referencia)
  if (vista === 'dia') desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde)
  hasta.setDate(hasta.getDate() + (vista === 'dia' ? 1 : 7))

  function recargar() {
    if (!profesional) return
    setReservas(null)
    listarReservasDeProfesional(profesional.id, desde.toISOString(), hasta.toISOString()).then(setReservas)
    listarBloqueosAusencias(profesional.id, 'aprobada').then(setBloqueos)
  }

  useEffect(recargar, [profesional, vista, referencia])

  useEffect(() => {
    if (!profesional) return
    obtenerHorarioVigente(profesional.id, fechaBogotaISO(referencia)).then(setHorario)
    if (!isDemoMode) {
      supabaseRequerido().from('permiso').select('puede_ver_agenda_equipo').eq('perfil_id', profesional.id).maybeSingle()
        .then(({ data }) => setPermisoAgendaEquipo(data?.puede_ver_agenda_equipo ?? false))
    }
  }, [profesional, referencia])

  if (!profesional) return <Cargando />

  function mover(dias: number) {
    setReferencia((f) => {
      const d = new Date(f)
      d.setDate(d.getDate() + dias)
      return d
    })
  }

  function bloqueosDelDia(fecha: Date) {
    const inicioDia = new Date(fecha)
    inicioDia.setHours(0, 0, 0, 0)
    const finDia = new Date(fecha)
    finDia.setHours(23, 59, 59, 999)
    return bloqueos.filter((b) => seSuperponen(new Date(b.rango_inicio), new Date(b.rango_fin), inicioDia, finDia))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Mi agenda</h1>
        <Link to="/equipo-app/disponibilidad" className="text-sm font-semibold text-oliva underline underline-offset-2">
          Gestionar disponibilidad
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => mover(vista === 'dia' ? -1 : -7)} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">←</button>
          <button onClick={() => setReferencia(new Date())} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">Hoy</button>
          <button onClick={() => mover(vista === 'dia' ? 1 : 7)} className="rounded-full bg-piedra/40 px-3 py-1 text-sm">→</button>
          <input
            type="date"
            value={fechaBogotaISO(referencia)}
            onChange={(e) => setReferencia(new Date(`${e.target.value}T12:00:00`))}
            className="rounded-lg border border-piedra px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex gap-2">
          {(['dia', 'semana'] as Vista[]).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${vista === v ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {vista === 'dia' ? (
        <VistaDia fecha={referencia} reservas={reservas} horario={horario} bloqueos={bloqueosDelDia(new Date(referencia))} onAbrir={setSeleccionada} />
      ) : (
        <VistaSemana inicio={desde} reservas={reservas} bloqueos={bloqueos} onAbrir={setSeleccionada} />
      )}

      {seleccionada && (
        <DetalleCita
          reserva={seleccionada}
          permisoAgendaEquipo={permisoAgendaEquipo}
          onCerrar={() => setSeleccionada(null)}
          onCambio={() => { setSeleccionada(null); recargar() }}
        />
      )}
    </div>
  )
}

function turnoDelDia(horario: HorarioDisponibilidad[], diaSemana: number) {
  return horario
    .filter((h) => h.dia_semana === diaSemana)
    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
    .map((h) => `${h.hora_inicio.slice(0, 5)}–${h.hora_fin.slice(0, 5)}`)
}

function VistaDia({
  fecha,
  reservas,
  horario,
  bloqueos,
  onAbrir,
}: {
  fecha: Date
  reservas: Reserva[] | null
  horario: HorarioDisponibilidad[]
  bloqueos: BloqueoAusencia[]
  onAbrir: (r: Reserva) => void
}) {
  const turno = turnoDelDia(horario, fecha.getDay())
  const reservasDelDia = reservas?.slice().sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio)) ?? null

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center justify-between gap-2 bg-piedra/20 py-3">
        <p className="text-sm font-medium text-carbon">{formatoFecha(fecha.toISOString(), { weekday: 'long', day: '2-digit', month: 'long', year: undefined })}</p>
        <p className="text-xs text-carbon/60">{turno.length > 0 ? `Turno: ${turno.join(' · ')}` : 'Sin turno programado este día'}</p>
      </Card>

      {bloqueos.length > 0 && (
        <div className="flex flex-col gap-2">
          {bloqueos.map((b) => (
            <Card key={b.id} className="flex items-center justify-between gap-2 border-carbon/20 bg-carbon/5 py-3">
              <p className="text-sm text-carbon/70">
                🚫 {b.todo_el_dia ? 'Ausencia todo el día' : `Bloqueado ${formatoHora(b.rango_inicio)}–${formatoHora(b.rango_fin)}`}
                {b.motivo ? ` · ${b.motivo}` : ''}
              </p>
            </Card>
          ))}
        </div>
      )}

      {!reservasDelDia ? (
        <Cargando />
      ) : reservasDelDia.length === 0 ? (
        <EmptyState titulo="Aún no tienes citas para este día" />
      ) : (
        <div className="flex flex-col gap-2">
          {reservasDelDia.map((r) => <TarjetaCita key={r.id} reserva={r} onAbrir={onAbrir} />)}
        </div>
      )}
    </div>
  )
}

function VistaSemana({
  inicio,
  reservas,
  bloqueos,
  onAbrir,
}: {
  inicio: Date
  reservas: Reserva[] | null
  bloqueos: BloqueoAusencia[]
  onAbrir: (r: Reserva) => void
}) {
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(inicio)
    d.setDate(d.getDate() + i)
    return d
  })

  if (!reservas) return <Cargando />

  return (
    <div className="flex flex-col gap-4">
      {dias.map((dia) => {
        const clave = fechaBogotaISO(dia)
        const delDia = reservas.filter((r) => fechaBogotaISO(new Date(r.rango_inicio)) === clave).sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio))
        const bloqueosDia = bloqueos.filter((b) => seSuperponen(new Date(b.rango_inicio), new Date(b.rango_fin), new Date(new Date(dia).setHours(0, 0, 0, 0)), new Date(new Date(dia).setHours(23, 59, 59, 999))))
        return (
          <div key={clave}>
            <p className="mb-2 text-sm font-semibold text-carbon/70">{formatoFecha(dia.toISOString(), { weekday: 'long', day: '2-digit', month: 'long', year: undefined })}</p>
            {delDia.length === 0 && bloqueosDia.length === 0 ? (
              <p className="pl-1 text-xs text-carbon/40">Sin citas</p>
            ) : (
              <div className="flex flex-col gap-2">
                {bloqueosDia.map((b) => (
                  <Card key={b.id} className="border-carbon/20 bg-carbon/5 py-2">
                    <p className="text-xs text-carbon/60">🚫 {b.todo_el_dia ? 'Ausencia todo el día' : `Bloqueado ${formatoHora(b.rango_inicio)}–${formatoHora(b.rango_fin)}`}</p>
                  </Card>
                ))}
                {delDia.map((r) => <TarjetaCita key={r.id} reserva={r} onAbrir={onAbrir} compacta />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TarjetaCita({ reserva: r, onAbrir, compacta }: { reserva: Reserva; onAbrir: (r: Reserva) => void; compacta?: boolean }) {
  return (
    <button onClick={() => onAbrir(r)} className="block w-full text-left">
      <Card className={`flex items-center justify-between ${compacta ? 'py-2' : 'py-3'}`}>
        <div>
          <p className="font-medium text-carbon">{formatoHora(r.rango_inicio)}–{formatoHora(r.rango_fin)} · {r.servicio_nombre}</p>
          <p className="text-xs text-carbon/60">{r.cliente_nombre}</p>
        </div>
        <EstadoReservaBadge estado={r.estado} />
      </Card>
    </button>
  )
}

function DetalleCita({
  reserva,
  permisoAgendaEquipo,
  onCerrar,
  onCambio,
}: {
  reserva: Reserva
  permisoAgendaEquipo: boolean
  onCerrar: () => void
  onCambio: () => void
}) {
  const navigate = useNavigate()
  const [modo, setModo] = useState<'ver' | 'reprogramar'>('ver')
  const [fecha, setFecha] = useState(fechaBogotaISO(new Date(reserva.rango_inicio)))
  const [slots, setSlots] = useState<SlotDisponible[] | null>(null)
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

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Detalle de la cita">
      {error && <div className="mb-3"><ErrorState mensaje={error} /></div>}
      {modo === 'ver' ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-semibold text-carbon">{reserva.servicio_nombre}</p>
            <p className="text-sm text-carbon/60">{formatoFecha(reserva.rango_inicio)} · {formatoHora(reserva.rango_inicio)}–{formatoHora(reserva.rango_fin)}</p>
            <p className="text-sm text-carbon/60">Clienta: {reserva.cliente_nombre}</p>
          </div>
          <div className="flex items-center gap-2">
            <EstadoReservaBadge estado={reserva.estado} />
            {reserva.estado === 'completada' && pago && <EstadoPagoBadge pagado={pago.totalPagado} total={pago.totalVendido} />}
          </div>
          {reserva.notas && <p className="text-xs text-carbon/60">Notas: {reserva.notas}</p>}

          <div className="mt-2 flex flex-wrap gap-2">
            {!['completada', 'cancelada', 'no_asistio'].includes(reserva.estado) && (
              <Button onClick={() => navigate(`/equipo-app/atender?reservaId=${reserva.id}`)}>Iniciar atención</Button>
            )}
            {reserva.estado === 'pendiente' && permisoAgendaEquipo && (
              <Button variante="secondary" cargando={cargando} onClick={() => accion(() => confirmarReservaPendiente(reserva.id))}>Confirmar</Button>
            )}
            {puedeGestionar && (
              <Button variante="secondary" onClick={() => setModo('reprogramar')}>Reprogramar</Button>
            )}
            {puedeGestionar && (
              <Button variante="danger" cargando={cargando} onClick={() => accion(() => cancelarReserva(reserva.id, 'Cancelada por la profesional desde Mi agenda'))}>
                Cancelar
              </Button>
            )}
            {puedeGestionar && yaPaso && (
              <Button variante="ghost" cargando={cargando} onClick={() => accion(() => marcarNoAsistio(reserva.id))}>Marcar no asistió</Button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <input
            type="date"
            value={fecha}
            min={fechaBogotaISO()}
            onChange={(e) => setFecha(e.target.value)}
            className="mb-4 rounded-lg border border-piedra px-3 py-2 text-sm"
          />
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
    </Modal>
  )
}
