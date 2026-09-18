import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { CampoMoneda, Input, Select, Textarea } from '../../components/ui/Campos'
import { Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Modal } from '../../components/ui/Modal'
import { EstadoAtencionBadge } from '../../components/ui/StatusBadge'
import { buscarClientes } from '../../lib/api/empleada'
import { listarProfesionales } from '../../lib/api/catalogo'
import { editarVenta, eliminarVenta, listarProductosVendidos, listarVentasDetalle, obtenerNotasVenta } from '../../lib/api/admin'
import type { ProductoVenta } from '../../lib/api/admin'
import { formatoFecha, formatoMoneda, rangoPeriodo, type PeriodoResumen } from '../../lib/format'
import type { Cliente, Profesional, VentaLinea } from '../../lib/types'

export function AdminVentas() {
  const [periodo, setPeriodo] = useState<PeriodoResumen>('mes')
  const [ventas, setVentas] = useState<VentaLinea[] | null>(null)
  const [productos, setProductos] = useState<ProductoVenta[] | null>(null)
  const [equipo, setEquipo] = useState<Profesional[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ventaEditando, setVentaEditando] = useState<string | null>(null)
  const [borrandoId, setBorrandoId] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  function cargar() {
    const { desde, hasta } = rangoPeriodo(periodo)
    setVentas(null)
    setProductos(null)
    listarVentasDetalle(desde, hasta).then(setVentas).catch((e) => setError(e.message))
    listarProductosVendidos(desde, hasta).then(setProductos).catch((e) => setError(e.message))
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo])

  useEffect(() => {
    listarProfesionales().then(setEquipo).catch(() => {})
  }, [])

  const totalVendido = ventas?.reduce((acc, v) => acc + (v.precio_snapshot - v.descuento) * v.cantidad, 0) ?? 0
  const totalComision = ventas?.reduce((acc, v) => acc + v.comision_total, 0) ?? 0
  const totalProductos = productos?.reduce((acc, p) => acc + p.subtotal, 0) ?? 0

  async function borrarVenta(atencionId: string) {
    if (!confirm('¿Borrar esta venta por completo? Se eliminan sus servicios, el pago registrado, su comisión y los puntos que generó. Esto no se puede deshacer.')) return
    setBorrandoId(atencionId)
    setErrorAccion(null)
    try {
      await eliminarVenta(atencionId)
      cargar()
    } catch (e: any) {
      setErrorAccion(e.message)
    } finally {
      setBorrandoId(null)
    }
  }

  // Cada fila es una línea de servicio; una venta con varios servicios ocupa varias filas
  // seguidas (mismo atencion_id, mismo creado_en). Las acciones se muestran una sola vez por
  // venta, en su primera fila, para no repetir el mismo botón en cada línea.
  const yaConAcciones = new Set<string>()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Ventas y cobros</h1>
        <div className="flex gap-2">
          {(['hoy', 'semana', 'mes'] as PeriodoResumen[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${periodo === p ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-carbon/60">
        Cada fila es un servicio cobrado. "Le quedó al negocio" descuenta la comisión ya generada para
        quien lo realizó. Una línea marcada "Colaboración" es la ganancia completa (100%) de quien ayudó,
        sumada al total igual que cualquier otro servicio. La apertura/cierre de caja con arqueo de
        efectivo es un módulo de Fase 2.
      </p>

      {error && <ErrorState mensaje={error} />}
      {errorAccion && <ErrorState mensaje={errorAccion} />}
      {!ventas ? (
        <Cargando />
      ) : ventas.length === 0 ? (
        <EmptyState titulo="No hay ventas registradas en este periodo" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-piedra">
          <table className="w-full min-w-[820px] text-sm">
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
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => {
                const vendido = (v.precio_snapshot - v.descuento) * v.cantidad
                const negocio = vendido - v.comision_total
                const mostrarAcciones = !yaConAcciones.has(v.atencion_id)
                yaConAcciones.add(v.atencion_id)
                return (
                  <tr key={v.id} className="border-t border-piedra/60">
                    <td className="px-3 py-2 text-carbon/70">{formatoFecha(v.atencion_completado_en ?? v.atencion_creado_en)}</td>
                    <td className="px-3 py-2 font-medium text-carbon">{v.cliente_nombre}</td>
                    <td className="px-3 py-2 text-carbon">
                      {v.nombre_snapshot}
                      {v.es_colaboracion && (
                        <span className="ml-2 rounded-full bg-champan/30 px-2 py-0.5 text-xs font-semibold text-carbon/70">Colaboración</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-carbon/70">{v.profesional_nombre ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-carbon">{formatoMoneda(vendido)}</td>
                    <td className="px-3 py-2 text-right text-carbon/70">{formatoMoneda(v.comision_total)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-oliva">{formatoMoneda(negocio)}</td>
                    <td className="px-3 py-2"><EstadoAtencionBadge estado={v.atencion_estado} /></td>
                    <td className="px-3 py-2">
                      {mostrarAcciones && (
                        <div className="flex gap-3 whitespace-nowrap">
                          <button onClick={() => setVentaEditando(v.atencion_id)} className="text-xs font-semibold text-oliva hover:underline">
                            Editar
                          </button>
                          <button
                            onClick={() => borrarVenta(v.atencion_id)}
                            disabled={borrandoId === v.atencion_id}
                            className="text-xs font-semibold text-error hover:underline disabled:opacity-50"
                          >
                            {borrandoId === v.atencion_id ? 'Borrando…' : 'Borrar'}
                          </button>
                        </div>
                      )}
                    </td>
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
                <td className="px-3 py-2" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <h2 className="mt-2 font-marca text-lg font-semibold text-carbon">Productos vendidos</h2>
      {!productos ? (
        <Cargando filas={2} />
      ) : productos.length === 0 ? (
        <EmptyState titulo="No hay productos vendidos en este periodo" />
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

      {ventaEditando && (
        <EditarVentaModal
          atencionId={ventaEditando}
          lineas={ventas?.filter((v) => v.atencion_id === ventaEditando) ?? []}
          equipo={equipo}
          onCerrar={() => setVentaEditando(null)}
          onGuardado={() => {
            setVentaEditando(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}

interface LineaEdicion {
  id: string
  nombreSnapshot: string
  profesionalId: string
  precio: number | null
  descuento: number | null
  cantidad: number
}

function EditarVentaModal({
  atencionId,
  lineas,
  equipo,
  onCerrar,
  onGuardado,
}: {
  atencionId: string
  lineas: VentaLinea[]
  equipo: Profesional[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const primera = lineas[0]
  const [clienteId, setClienteId] = useState(primera?.cliente_id ?? '')
  const [clienteNombre, setClienteNombre] = useState(primera?.cliente_nombre ?? '')
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [queryCliente, setQueryCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState<Cliente[]>([])

  const [notas, setNotas] = useState('')
  const [cargandoNotas, setCargandoNotas] = useState(true)

  const [lineasEdicion, setLineasEdicion] = useState<LineaEdicion[]>(
    lineas.map((l) => ({ id: l.id, nombreSnapshot: l.nombre_snapshot, profesionalId: l.profesional_id, precio: l.precio_snapshot, descuento: l.descuento, cantidad: l.cantidad })),
  )

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    obtenerNotasVenta(atencionId)
      .then((n) => setNotas(n ?? ''))
      .finally(() => setCargandoNotas(false))
  }, [atencionId])

  useEffect(() => {
    if (!queryCliente.trim()) { setResultadosCliente([]); return }
    const t = setTimeout(() => {
      buscarClientes(queryCliente.trim()).then(setResultadosCliente).catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [queryCliente])

  function actualizarLinea(id: string, cambios: Partial<LineaEdicion>) {
    setLineasEdicion((prev) => prev.map((l) => (l.id === id ? { ...l, ...cambios } : l)))
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      await editarVenta({
        atencionId,
        clienteId,
        notas: notas.trim() || null,
        lineas: lineasEdicion.map((l) => ({
          id: l.id,
          profesionalId: l.profesionalId,
          precioSnapshot: l.precio ?? 0,
          descuento: l.descuento ?? 0,
          cantidad: l.cantidad,
        })),
      })
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Editar venta">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-carbon/50">
          El dinero ya cobrado (el pago) no se toca al editar — si el precio de un servicio estaba mal
          digitado, esto corrige la venta y su comisión, pero el monto realmente recibido en caja queda
          igual. Si de verdad se cobró otro monto, avisa para ajustar el pago aparte.
        </p>
        {error && <ErrorState mensaje={error} />}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-carbon">Cliente</label>
          {!buscandoCliente ? (
            <div className="flex items-center justify-between rounded-lg border border-piedra bg-marfil px-3 py-2.5">
              <span className="text-sm text-carbon">{clienteNombre}</span>
              <button onClick={() => setBuscandoCliente(true)} className="text-xs font-semibold text-oliva hover:underline">Cambiar</button>
            </div>
          ) : (
            <div className="relative">
              <input
                autoFocus
                value={queryCliente}
                onChange={(e) => setQueryCliente(e.target.value)}
                placeholder="Buscar por nombre o teléfono"
                className="w-full rounded-lg border border-piedra bg-blanco px-3 py-2.5 text-sm text-carbon outline-none focus:border-oliva"
              />
              {resultadosCliente.length > 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-piedra bg-blanco shadow-lg">
                  {resultadosCliente.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setClienteId(c.id); setClienteNombre(c.nombre); setBuscandoCliente(false); setQueryCliente('') }}
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-piedra/40"
                    >
                      <span className="font-medium text-carbon">{c.nombre}</span>
                      {c.telefono && <span className="text-xs text-carbon/60">{c.telefono}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-carbon">Servicios</p>
          {lineasEdicion.map((l) => (
            <div key={l.id} className="flex flex-col gap-3 rounded-xl border border-piedra p-3">
              <p className="text-sm font-medium text-carbon">{l.nombreSnapshot}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select id={`prof-${l.id}`} etiqueta="Profesional" value={l.profesionalId} onChange={(e) => actualizarLinea(l.id, { profesionalId: e.target.value })}>
                  {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </Select>
                <CampoMoneda id={`precio-${l.id}`} etiqueta="Precio cobrado" value={l.precio} onChange={(v) => actualizarLinea(l.id, { precio: v })} />
                <CampoMoneda id={`descuento-${l.id}`} etiqueta="Descuento" value={l.descuento} onChange={(v) => actualizarLinea(l.id, { descuento: v })} />
              </div>
              <div className="w-32">
                <Input
                  id={`cantidad-${l.id}`}
                  etiqueta="Cantidad"
                  type="number"
                  min={1}
                  value={l.cantidad}
                  onChange={(e) => actualizarLinea(l.id, { cantidad: Math.max(1, Number(e.target.value)) })}
                />
              </div>
            </div>
          ))}
        </div>

        <Textarea id="notasVenta" etiqueta="Nota interna" value={notas} onChange={(e) => setNotas(e.target.value)} disabled={cargandoNotas} />

        <div className="flex justify-end gap-2">
          <Button variante="ghost" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} cargando={guardando}>Guardar cambios</Button>
        </div>
      </div>
    </Modal>
  )
}
