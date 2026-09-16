import { useEffect, useState } from 'react'
import { Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { EstadoAtencionBadge } from '../../components/ui/StatusBadge'
import { listarVentasDetalle } from '../../lib/api/admin'
import { formatoFecha, formatoMoneda } from '../../lib/format'
import type { VentaLinea } from '../../lib/types'

export function AdminVentas() {
  const [ventas, setVentas] = useState<VentaLinea[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarVentasDetalle().then(setVentas).catch((e) => setError(e.message))
  }, [])

  const totalVendido = ventas?.reduce((acc, v) => acc + (v.precio_snapshot - v.descuento) * v.cantidad, 0) ?? 0
  const totalComision = ventas?.reduce((acc, v) => acc + v.comision_total, 0) ?? 0

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Ventas y cobros</h1>
      <p className="text-sm text-carbon/60">
        Cada fila es un servicio cobrado. "Le quedó al negocio" descuenta la comisión ya generada para
        quien lo realizó (snapshot de la regla vigente al momento del cobro). La apertura/cierre de caja
        con arqueo de efectivo es un módulo de Fase 2.
      </p>

      {error && <ErrorState mensaje={error} />}
      {!ventas ? (
        <Cargando />
      ) : ventas.length === 0 ? (
        <EmptyState titulo="No hay ventas registradas todavía" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-piedra">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-piedra/30 text-left text-xs uppercase tracking-wide text-carbon/60">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Servicio</th>
                <th className="px-3 py-2">Profesional</th>
                <th className="px-3 py-2 text-right">Precio cobrado</th>
                <th className="px-3 py-2 text-right">Comisión</th>
                <th className="px-3 py-2 text-right">Le quedó al negocio</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => {
                const vendido = (v.precio_snapshot - v.descuento) * v.cantidad
                const negocio = vendido - v.comision_total
                return (
                  <tr key={v.id} className="border-t border-piedra/60">
                    <td className="px-3 py-2 text-carbon/70">{formatoFecha(v.atencion_completado_en ?? v.atencion_creado_en)}</td>
                    <td className="px-3 py-2 font-medium text-carbon">{v.cliente_nombre}</td>
                    <td className="px-3 py-2 text-carbon">{v.nombre_snapshot}</td>
                    <td className="px-3 py-2 text-carbon/70">{v.profesional_nombre ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-carbon">{formatoMoneda(vendido)}</td>
                    <td className="px-3 py-2 text-right text-carbon/70">{formatoMoneda(v.comision_total)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-oliva">{formatoMoneda(negocio)}</td>
                    <td className="px-3 py-2"><EstadoAtencionBadge estado={v.atencion_estado} /></td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-piedra bg-piedra/20 font-semibold">
                <td className="px-3 py-2" colSpan={4}>Total</td>
                <td className="px-3 py-2 text-right">{formatoMoneda(totalVendido)}</td>
                <td className="px-3 py-2 text-right">{formatoMoneda(totalComision)}</td>
                <td className="px-3 py-2 text-right text-oliva">{formatoMoneda(totalVendido - totalComision)}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
