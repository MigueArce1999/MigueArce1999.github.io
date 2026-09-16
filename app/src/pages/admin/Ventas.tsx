import { Fragment, useEffect, useState } from 'react'
import { Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { EstadoAtencionBadge } from '../../components/ui/StatusBadge'
import { listarColaboradoresDeLineas, listarProductosVendidos, listarVentasDetalle } from '../../lib/api/admin'
import type { ColaboradorVenta, ProductoVenta } from '../../lib/api/admin'
import { formatoFecha, formatoMoneda } from '../../lib/format'
import type { VentaLinea } from '../../lib/types'

export function AdminVentas() {
  const [ventas, setVentas] = useState<VentaLinea[] | null>(null)
  const [colaboradoresPorLinea, setColaboradoresPorLinea] = useState<Record<string, ColaboradorVenta[]>>({})
  const [productos, setProductos] = useState<ProductoVenta[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listarVentasDetalle()
      .then((data) => {
        setVentas(data)
        return listarColaboradoresDeLineas(data.map((v) => v.id))
      })
      .then((colaboradores) => {
        const agrupado: Record<string, ColaboradorVenta[]> = {}
        for (const c of colaboradores) {
          ;(agrupado[c.atencionServicioId] ??= []).push(c)
        }
        setColaboradoresPorLinea(agrupado)
      })
      .catch((e) => setError(e.message))
    listarProductosVendidos().then(setProductos).catch((e) => setError(e.message))
  }, [])

  const totalVendido = ventas?.reduce((acc, v) => acc + (v.precio_snapshot - v.descuento) * v.cantidad, 0) ?? 0
  const totalComision = ventas?.reduce((acc, v) => acc + v.comision_total, 0) ?? 0
  const totalProductos = productos?.reduce((acc, p) => acc + p.subtotal, 0) ?? 0

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Ventas y cobros</h1>
      <p className="text-sm text-carbon/60">
        Cada fila es un servicio cobrado. "Le quedó al negocio" descuenta la comisión ya generada para
        quien lo realizó (snapshot de la regla vigente al momento del cobro). Si un servicio tuvo
        colaboradores, aparecen debajo como distribución interna, con quién los agregó. La
        apertura/cierre de caja con arqueo de efectivo es un módulo de Fase 2.
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
                const colaboradores = colaboradoresPorLinea[v.id] ?? []
                return (
                  <Fragment key={v.id}>
                    <tr className="border-t border-piedra/60">
                      <td className="px-3 py-2 text-carbon/70">{formatoFecha(v.atencion_completado_en ?? v.atencion_creado_en)}</td>
                      <td className="px-3 py-2 font-medium text-carbon">{v.cliente_nombre}</td>
                      <td className="px-3 py-2 text-carbon">{v.nombre_snapshot}</td>
                      <td className="px-3 py-2 text-carbon/70">{v.profesional_nombre ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-carbon">{formatoMoneda(vendido)}</td>
                      <td className="px-3 py-2 text-right text-carbon/70">{formatoMoneda(v.comision_total)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-oliva">{formatoMoneda(negocio)}</td>
                      <td className="px-3 py-2"><EstadoAtencionBadge estado={v.atencion_estado} /></td>
                    </tr>
                    {colaboradores.length > 0 && (
                      <tr className="border-t border-piedra/30 bg-champan/10">
                        <td />
                        <td colSpan={7} className="px-3 py-2">
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-carbon/50">
                            Distribución interna (no se suma a la cuenta)
                          </p>
                          <div className="flex flex-col gap-1">
                            {colaboradores.map((c) => (
                              <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-xs text-carbon/70">
                                <span>
                                  <span className="font-medium text-carbon">{c.colaboradorNombre}</span>
                                  {c.participacion ? ` · ${c.participacion}` : ''}
                                  {' · '}Agregado por: {c.creadoPorNombre ?? '—'}
                                </span>
                                <span className="font-medium text-carbon">{formatoMoneda(c.valor)}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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

      <h2 className="mt-2 font-marca text-lg font-semibold text-carbon">Productos vendidos</h2>
      {!productos ? (
        <Cargando filas={2} />
      ) : productos.length === 0 ? (
        <EmptyState titulo="No hay productos vendidos todavía" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-piedra">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-piedra/30 text-left text-xs uppercase tracking-wide text-carbon/60">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id} className="border-t border-piedra/60">
                  <td className="px-3 py-2 text-carbon/70">{formatoFecha(p.fecha)}</td>
                  <td className="px-3 py-2 font-medium text-carbon">{p.clienteNombre}</td>
                  <td className="px-3 py-2 text-carbon/70">{p.categoria}</td>
                  <td className="px-3 py-2 text-carbon">{p.nombre}</td>
                  <td className="px-3 py-2 text-right text-carbon/70">x{p.cantidad}</td>
                  <td className="px-3 py-2 text-right font-semibold text-oliva">{formatoMoneda(p.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-piedra bg-piedra/20 font-semibold">
                <td className="px-3 py-2" colSpan={5}>Total</td>
                <td className="px-3 py-2 text-right text-oliva">{formatoMoneda(totalProductos)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
