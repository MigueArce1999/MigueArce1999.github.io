import { useState } from 'react'
import { Button } from '../ui/Button'
import { Card, EmptyState } from '../ui/Estados'
import { EstadoAtencionBadge } from '../ui/StatusBadge'
import { METODO_PAGO_ETIQUETA } from '../../lib/api/admin'
import { formatoFechaCorta, formatoFechaHora, formatoMoneda } from '../../lib/format'
import { FormularioObservacionSeguimiento } from './FormularioObservacionSeguimiento'
import type { VisitaAgrupada } from '../../lib/clientes/historial'
import type { Servicio } from '../../lib/types'

const ESTADO_RECOMENDACION_ETIQUETA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-advertencia/15 text-advertencia' },
  completada: { texto: 'Completada', clase: 'bg-exito/15 text-exito' },
  cancelada: { texto: 'Cancelada', clase: 'bg-carbon/10 text-carbon/60' },
}

// Línea de tiempo de visitas reales (una por atención, no por línea de servicio) — la
// funcionalidad central del pedido (sección 5). Cada entrada ya trae todo lo que antes vivía
// repartido en Atender/Ventas/Dashboard: servicios, productos, método de pago, notas y
// recomendación de esa visita puntual.
export function HistorialVisitas({
  visitas,
  clienteId,
  servicios,
  onCambio,
}: {
  visitas: VisitaAgrupada[] | null
  clienteId: string
  servicios: Servicio[]
  onCambio: () => void
}) {
  const [agregandoEn, setAgregandoEn] = useState<string | null>(null)

  if (!visitas) return null
  if (visitas.length === 0) {
    return <EmptyState titulo="Aún no hay visitas registradas para esta clienta." />
  }

  return (
    <div className="flex flex-col gap-3">
      {visitas.map((v) => (
        <Card key={v.atencionId} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-carbon">{formatoFechaHora(v.fecha)}</p>
            <EstadoAtencionBadge estado={v.estado} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Profesional</p>
              <p className="text-sm text-carbon">{v.profesionales.join(', ') || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Total</p>
              <p className="text-sm font-semibold text-carbon">{formatoMoneda(v.total)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Servicios</p>
              <ul className="text-sm text-carbon">
                {v.servicios.map((s, i) => (
                  <li key={i}>• {s.nombre}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Productos</p>
              <p className="text-sm text-carbon">{v.productos.length > 0 ? v.productos.map((p) => p.nombre).join(', ') : '—'}</p>
            </div>
            {v.metodosPago.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Método de pago</p>
                <p className="text-sm text-carbon">{v.metodosPago.map((m) => METODO_PAGO_ETIQUETA[m] ?? m).join(' + ')}</p>
              </div>
            )}
          </div>

          {v.notas.map((n) => (
            <div key={n.id} className="rounded-lg bg-champan/10 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Observación</p>
              <p className="text-sm text-carbon/80">{n.nota}</p>
            </div>
          ))}

          {v.recomendaciones.map((r) => (
            <div key={r.id} className="rounded-lg bg-oliva/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Recomendación</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_RECOMENDACION_ETIQUETA[r.estado].clase}`}>
                  {ESTADO_RECOMENDACION_ETIQUETA[r.estado].texto}
                </span>
              </div>
              <p className="text-sm text-carbon/80">{r.descripcion}</p>
              {r.fecha_recomendada_regreso && (
                <p className="mt-1 text-xs text-carbon/50">Próximo seguimiento: {formatoFechaCorta(r.fecha_recomendada_regreso)}</p>
              )}
            </div>
          ))}

          {agregandoEn === v.atencionId ? (
            <FormularioObservacionSeguimiento
              clienteId={clienteId}
              atencionId={v.atencionId}
              servicios={servicios}
              onCancelar={() => setAgregandoEn(null)}
              onGuardado={() => {
                setAgregandoEn(null)
                onCambio()
              }}
            />
          ) : (
            <Button variante="ghost" tamano="sm" className="self-start" onClick={() => setAgregandoEn(v.atencionId)}>
              + Agregar observación o recomendación
            </Button>
          )}
        </Card>
      ))}
    </div>
  )
}
