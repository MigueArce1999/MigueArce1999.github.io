import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { EstadoPagoBadge } from '../../components/ui/StatusBadge'
import { useAuth } from '../../state/AuthContext'
import { listarHistorialAtenciones, listarMovimientosPuntos } from '../../lib/api/cliente'
import { formatoFecha, formatoMoneda } from '../../lib/format'
import type { Atencion, MovimientoPuntos } from '../../lib/types'

export function ClienteHistorial() {
  const { cliente } = useAuth()
  const [atenciones, setAtenciones] = useState<Atencion[] | null>(null)
  const [movimientos, setMovimientos] = useState<MovimientoPuntos[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cliente) return
    listarHistorialAtenciones(cliente.id).then(setAtenciones).catch((e) => setError(e.message))
    listarMovimientosPuntos(cliente.id).then(setMovimientos).catch(() => {})
  }, [cliente])

  function puntosDe(atencionId: string) {
    return movimientos?.find((m) => m.referencia_id === atencionId && m.tipo === 'abono')?.puntos ?? 0
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Historial de servicios</h1>
      <p className="text-sm text-carbon/60">
        Aquí solo aparecen los servicios que se realizaron y pagaron. Una cita cancelada no cuenta como servicio realizado.
      </p>
      {error && <ErrorState mensaje={error} />}
      {!atenciones ? (
        <Cargando />
      ) : atenciones.length === 0 ? (
        <EmptyState titulo="Aún no tienes servicios completados" />
      ) : (
        <div className="flex flex-col gap-3">
          {atenciones.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-carbon/50">{formatoFecha(a.completado_en ?? a.creado_en)}</p>
                  {a.lineas.map((l) => (
                    <p key={l.id} className="font-semibold text-carbon">
                      {l.nombre_snapshot} · {l.profesional_nombre}
                    </p>
                  ))}
                </div>
                <EstadoPagoBadge pagado={a.total_pagado ?? 0} total={a.total_vendido ?? 0} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-oliva">{formatoMoneda(a.total_pagado)}</span>
                <span className="text-carbon/60">+{puntosDe(a.id)} puntos</span>
                <Link
                  to={`/reservar?servicio=${a.lineas[0]?.servicio_id}&profesional=${a.lineas[0]?.profesional_id}`}
                  className="font-semibold text-oliva underline underline-offset-2"
                >
                  Volver a reservar
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
