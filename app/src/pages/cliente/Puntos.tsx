import { useEffect, useState } from 'react'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { listarMovimientosPuntos, saldoPuntos } from '../../lib/api/cliente'
import { formatoFecha } from '../../lib/format'
import type { MovimientoPuntos } from '../../lib/types'

const etiquetasMovimiento: Record<string, string> = {
  abono: 'Puntos ganados',
  canje: 'Canje de recompensa',
  reversion: 'Reversión (devolución)',
  ajuste: 'Ajuste manual',
  vencimiento: 'Vencimiento',
}

export function ClientePuntos() {
  const { cliente } = useAuth()
  const [movimientos, setMovimientos] = useState<MovimientoPuntos[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cliente) return
    listarMovimientosPuntos(cliente.id).then(setMovimientos).catch((e) => setError(e.message))
  }, [cliente])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Mis puntos y beneficios</h1>

      <Card className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Saldo disponible</p>
        <p className="mt-1 font-marca text-4xl font-semibold text-oliva">
          {movimientos ? saldoPuntos(movimientos) : '—'}
        </p>
        <p className="mt-2 text-xs text-carbon/50">
          Las reglas de acumulación y vencimiento las define administración y pueden cambiar; consulta condiciones vigentes en el salón.
        </p>
      </Card>

      <div>
        <p className="mb-3 font-semibold text-carbon">Historial de movimientos</p>
        {error && <ErrorState mensaje={error} />}
        {!movimientos ? (
          <Cargando />
        ) : movimientos.length === 0 ? (
          <EmptyState titulo="Todavía no tienes movimientos de puntos" />
        ) : (
          <div className="flex flex-col gap-2">
            {movimientos.map((m) => (
              <Card key={m.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-carbon">{etiquetasMovimiento[m.tipo] ?? m.tipo}</p>
                  <p className="text-xs text-carbon/50">{formatoFecha(m.creado_en)}</p>
                  {m.motivo && <p className="text-xs text-carbon/50">Motivo: {m.motivo}</p>}
                </div>
                <span className={`font-semibold ${Number(m.puntos) >= 0 ? 'text-exito' : 'text-error'}`}>
                  {Number(m.puntos) >= 0 ? '+' : ''}{m.puntos}
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
