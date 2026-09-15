import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Modal } from '../../components/ui/Modal'
import { EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { useAuth } from '../../state/AuthContext'
import { cancelarReserva, listarReservasDeCliente, reprogramarReserva } from '../../lib/api/reservas'
import { consultarDisponibilidad } from '../../lib/api/reservas'
import { fechaBogotaISO, formatoFecha, formatoHora, formatoMoneda } from '../../lib/format'
import type { Reserva, SlotDisponible } from '../../lib/types'

export function ClienteReservas() {
  const { cliente } = useAuth()
  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'proximas' | 'anteriores'>('proximas')
  const [seleccionada, setSeleccionada] = useState<Reserva | null>(null)

  function recargar() {
    if (!cliente) return
    listarReservasDeCliente(cliente.id).then(setReservas).catch((e) => setError(e.message))
  }

  useEffect(recargar, [cliente])

  const ahora = new Date()
  const visibles = reservas?.filter((r) =>
    tab === 'proximas'
      ? ['pendiente', 'confirmada', 'en_atencion'].includes(r.estado) && new Date(r.rango_inicio) >= ahora
      : r.estado === 'completada' || r.estado === 'cancelada' || r.estado === 'no_asistio' || new Date(r.rango_inicio) < ahora,
  )

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Mis reservas</h1>
      <div className="flex gap-2">
        <button onClick={() => setTab('proximas')} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === 'proximas' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
          Próximas
        </button>
        <button onClick={() => setTab('anteriores')} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === 'anteriores' ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}>
          Anteriores
        </button>
      </div>

      {error && <ErrorState mensaje={error} />}
      {!visibles ? (
        <Cargando />
      ) : visibles.length === 0 ? (
        <EmptyState
          titulo={tab === 'proximas' ? 'No tienes reservas próximas' : 'Aún no hay reservas anteriores'}
          accion={tab === 'proximas' ? <Link to="/reservar"><Button tamano="sm">Reservar cita</Button></Link> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visibles.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-carbon">{r.servicio_nombre}</p>
                <p className="text-sm text-carbon/60">
                  {formatoFecha(r.rango_inicio)} · {formatoHora(r.rango_inicio)} con {r.profesional_nombre}
                </p>
                <p className="text-sm font-medium text-oliva">{formatoMoneda(r.precio_estimado)}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <EstadoReservaBadge estado={r.estado} />
                {tab === 'proximas' && (
                  <button onClick={() => setSeleccionada(r)} className="text-xs font-semibold text-oliva underline underline-offset-2">
                    Gestionar
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {seleccionada && (
        <DetalleReserva
          reserva={seleccionada}
          onCerrar={() => setSeleccionada(null)}
          onCambio={() => {
            setSeleccionada(null)
            recargar()
          }}
        />
      )}
    </div>
  )
}

function DetalleReserva({ reserva, onCerrar, onCambio }: { reserva: Reserva; onCerrar: () => void; onCambio: () => void }) {
  const [modo, setModo] = useState<'ver' | 'reprogramar'>('ver')
  const [fecha, setFecha] = useState(fechaBogotaISO())
  const [slots, setSlots] = useState<SlotDisponible[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (modo !== 'reprogramar') return
    setSlots(null)
    consultarDisponibilidad(reserva.servicio_id, reserva.profesional_id, fecha).then(setSlots).catch((e) => setError(e.message))
  }, [modo, fecha, reserva])

  async function cancelar() {
    setCargando(true)
    setError(null)
    try {
      await cancelarReserva(reserva.id, 'Cancelada por el cliente desde el portal')
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  async function confirmarReprogramacion(slot: SlotDisponible) {
    setCargando(true)
    setError(null)
    try {
      await reprogramarReserva(reserva.id, slot.inicio)
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Tu reserva">
      {error && <div className="mb-3"><ErrorState mensaje={error} /></div>}
      {modo === 'ver' ? (
        <div className="flex flex-col gap-3">
          <p className="font-semibold text-carbon">{reserva.servicio_nombre}</p>
          <p className="text-sm text-carbon/60">
            {formatoFecha(reserva.rango_inicio)} · {formatoHora(reserva.rango_inicio)} con {reserva.profesional_nombre}
          </p>
          <p className="text-xs text-carbon/50">
            Puedes cancelar o reprogramar según la política de anticipación del salón; si no es posible, el sistema te lo indicará.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variante="secondary" onClick={() => setModo('reprogramar')}>Reprogramar</Button>
            <Button variante="danger" onClick={cancelar} cargando={cargando}>Cancelar cita</Button>
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
                  onClick={() => confirmarReprogramacion(s)}
                  className="rounded-lg border border-piedra bg-blanco py-2 text-sm font-medium hover:border-oliva disabled:opacity-50"
                >
                  {formatoHora(s.inicio)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
