import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Cargando, EmptyState } from '../../components/ui/Estados'
import { EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { useAuth } from '../../state/AuthContext'
import { listarReservasDelDia } from '../../lib/api/empleada'
import { fechaBogotaISO, formatoHora, formatoMoneda } from '../../lib/format'
import type { Reserva } from '../../lib/types'

export function EmpleadaDia() {
  const { profesional } = useAuth()
  const [reservas, setReservas] = useState<Reserva[] | null>(null)

  useEffect(() => {
    if (!profesional) return
    listarReservasDelDia(profesional.id, fechaBogotaISO()).then(setReservas as any)
  }, [profesional])

  const hoyCompletadas = reservas?.filter((r) => r.estado === 'completada') ?? []
  const vendidoHoy = hoyCompletadas.reduce((acc, r) => acc + (r.precio_estimado ?? 0), 0)
  // Nota: en la vista de agenda no viene el detalle de pago/comisión por línea; para el
  // desglose exacto (cobrado vs comisión vs propinas) se consulta lib/api/empleada.listarComisiones,
  // usado en la pantalla "Mis ventas". Aquí se muestra un resumen rápido del día.
  const proxima = reservas?.filter((r) => new Date(r.rango_inicio) > new Date()).sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio))[0]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-marca text-2xl font-semibold text-carbon">Mi día</h1>
        <p className="text-sm text-carbon/60">Resumen de hoy. Los totales de ganancias reales están en "Mis ventas".</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Resumen etiqueta="Citas hoy" valor={String(reservas?.length ?? '—')} />
        <Resumen etiqueta="Servicios realizados" valor={String(hoyCompletadas.length)} />
        <Resumen etiqueta="Vendido hoy" valor={formatoMoneda(vendidoHoy)} />
        <Resumen etiqueta="Próxima cita" valor={proxima ? formatoHora(proxima.rango_inicio) : '—'} />
      </div>

      <Link to="/equipo-app/atender" className="rounded-2xl bg-oliva px-5 py-4 text-center font-semibold text-blanco">
        + Registrar un servicio
      </Link>

      <div>
        <p className="mb-3 font-semibold text-carbon">Citas de hoy</p>
        {!reservas ? (
          <Cargando />
        ) : reservas.length === 0 ? (
          <EmptyState titulo="No tienes citas asignadas hoy" />
        ) : (
          <div className="flex flex-col gap-2">
            {reservas.map((r) => (
              <Card key={r.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-carbon">{formatoHora(r.rango_inicio)} · {r.servicio_nombre}</p>
                  <p className="text-xs text-carbon/60">{r.cliente_nombre}</p>
                </div>
                <EstadoReservaBadge estado={r.estado} />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Card className="text-center">
      <p className="text-xs text-carbon/50">{etiqueta}</p>
      <p className="mt-1 font-marca text-xl font-semibold text-carbon">{valor}</p>
    </Card>
  )
}
