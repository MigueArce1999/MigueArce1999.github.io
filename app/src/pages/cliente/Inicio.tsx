import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, EmptyState } from '../../components/ui/Estados'
import { EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { useAuth } from '../../state/AuthContext'
import { listarMovimientosPuntos, saldoPuntos } from '../../lib/api/cliente'
import { listarPromocionesVigentes } from '../../lib/api/catalogo'
import { listarReservasDeCliente } from '../../lib/api/reservas'
import { formatoFecha, formatoHora } from '../../lib/format'
import type { Promocion, Reserva } from '../../lib/types'

export function ClienteInicio() {
  const { cliente, perfil } = useAuth()
  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [puntos, setPuntos] = useState<number | null>(null)
  const [promos, setPromos] = useState<Promocion[] | null>(null)

  useEffect(() => {
    if (!cliente) return
    listarReservasDeCliente(cliente.id).then(setReservas)
    listarMovimientosPuntos(cliente.id).then((m) => setPuntos(saldoPuntos(m)))
    listarPromocionesVigentes().then(setPromos)
  }, [cliente])

  const proxima = reservas
    ?.filter((r) => ['confirmada', 'pendiente'].includes(r.estado) && new Date(r.rango_inicio) > new Date())
    .sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio))[0]

  const ultimosServicios = reservas?.filter((r) => r.estado === 'completada').slice(0, 3)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-marca text-2xl font-semibold text-carbon">Hola, {perfil?.nombre?.split(' ')[0]}</h1>
        <p className="text-sm text-carbon/60">Aquí tienes un resumen de tu cuenta.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Próxima cita</p>
          {!reservas ? (
            <Cargando filas={1} />
          ) : proxima ? (
            <div className="mt-2">
              <p className="font-semibold text-carbon">{proxima.servicio_nombre}</p>
              <p className="text-sm text-carbon/60">
                {formatoFecha(proxima.rango_inicio)} · {formatoHora(proxima.rango_inicio)} con {proxima.profesional_nombre}
              </p>
              <div className="mt-2"><EstadoReservaBadge estado={proxima.estado} /></div>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-sm text-carbon/60">No tienes citas próximas.</p>
              <Link to="/reservar"><Button tamano="sm">Reservar cita</Button></Link>
            </div>
          )}
        </Card>

        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Puntos disponibles</p>
          <p className="mt-2 text-3xl font-marca font-semibold text-oliva">{puntos ?? '—'}</p>
          <Link to="/cliente/puntos" className="text-sm font-semibold text-oliva underline underline-offset-2">
            Ver beneficios
          </Link>
        </Card>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold text-carbon">Últimos servicios</p>
          <Link to="/cliente/historial" className="text-sm font-semibold text-oliva">Ver todo</Link>
        </div>
        {!ultimosServicios ? (
          <Cargando />
        ) : ultimosServicios.length === 0 ? (
          <EmptyState titulo="Aún no tienes servicios registrados" />
        ) : (
          <div className="flex flex-col gap-2">
            {ultimosServicios.map((r) => (
              <Card key={r.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-carbon">{r.servicio_nombre}</p>
                  <p className="text-xs text-carbon/60">{formatoFecha(r.rango_inicio)} · {r.profesional_nombre}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {promos && promos.length > 0 && (
        <div>
          <p className="mb-3 font-semibold text-carbon">Beneficios y promociones vigentes</p>
          <div className="flex flex-col gap-2">
            {promos.map((p) => (
              <Card key={p.id} className="py-3">
                <p className="font-medium text-carbon">{p.nombre}</p>
                <p className="text-xs text-carbon/60">{p.descripcion}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
