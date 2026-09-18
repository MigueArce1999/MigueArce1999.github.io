import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Campos'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Drawer } from '../../components/ui/Modal'
import {
  listarCategoriasGasto,
  listarCuentas,
  listarGastoIdsConPagoEnRango,
  listarGastos,
  listarPlantillasRecurrentes,
  obtenerIndicadoresGastos,
  type FiltrosGasto,
  type IndicadoresGasto,
} from '../../lib/api/gastos'
import { fechaBogotaISO, formatoFecha, formatoMoneda, rangoPeriodo } from '../../lib/format'
import type { CategoriaGasto, Cuenta, Gasto, PlantillaGastoRecurrente } from '../../lib/types'
import { GastosDetalle } from './GastosDetalle'
import { GastosFormulario } from './GastosFormulario'
import { GastosRecurrentes } from './GastosRecurrentes'

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango'
type Pestana = 'todos' | 'por_pagar' | 'recurrentes'

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente',
  pago_parcial: 'Pago parcial',
  pagado: 'Pagado',
  anulado: 'Anulado',
}

export function AdminGastos() {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [rangoDesde, setRangoDesde] = useState(fechaBogotaISO())
  const [rangoHasta, setRangoHasta] = useState(fechaBogotaISO())
  const [pestana, setPestana] = useState<Pestana>('todos')

  const [categorias, setCategorias] = useState<CategoriaGasto[]>([])
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [plantillas, setPlantillas] = useState<PlantillaGastoRecurrente[]>([])
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [indicadores, setIndicadores] = useState<IndicadoresGasto | null>(null)

  const [texto, setTexto] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroOrigen, setFiltroOrigen] = useState('')
  // Filtro de fecha de la LISTA: independiente del selector de periodo de arriba (ese solo
  // alimenta el indicador "Pagado en el periodo"). Vacío = sin filtrar por fecha.
  const [campoFecha, setCampoFecha] = useState<'fecha' | 'fecha_vencimiento' | 'pago'>('fecha')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [idsConPago, setIdsConPago] = useState<Set<string> | null>(null)

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [gastoEnEdicion, setGastoEnEdicion] = useState<Gasto | null>(null)
  const [gastoSeleccionado, setGastoSeleccionado] = useState<Gasto | null>(null)

  // Periodo del indicador "Pagado en el periodo" (el resto de indicadores son a la fecha
  // actual, sin importar este selector — ver obtenerIndicadoresGastos). Memoizado: rangoPeriodo
  // usa `new Date().toISOString()` para "hasta", que cambia en cada llamada — sin useMemo, el
  // valor sería un string distinto en cada render y el efecto de abajo entraría en bucle.
  const { desde: periodoDesde, hasta: periodoHasta } = useMemo(
    () => (periodo === 'rango' ? { desde: rangoDesde, hasta: rangoHasta } : rangoPeriodo(periodo === 'hoy' ? 'hoy' : periodo === 'semana' ? 'semana' : 'mes')),
    [periodo, rangoDesde, rangoHasta],
  )

  async function cargarCatalogos() {
    const [c, cu, pl] = await Promise.all([listarCategoriasGasto(), listarCuentas(), listarPlantillasRecurrentes()])
    setCategorias(c)
    setCuentas(cu)
    setPlantillas(pl)
  }

  async function cargarLista() {
    setCargando(true)
    setError(null)
    try {
      const filtros: FiltrosGasto = {
        texto,
        categoriaId: filtroCategoria || undefined,
        estado: (filtroEstado || undefined) as FiltrosGasto['estado'],
        origen: (filtroOrigen || undefined) as FiltrosGasto['origen'],
        campoFecha: campoFecha === 'pago' ? undefined : campoFecha,
        desde: campoFecha === 'pago' ? undefined : filtroDesde || undefined,
        hasta: campoFecha === 'pago' ? undefined : filtroHasta || undefined,
      }
      const [lista, ind] = await Promise.all([listarGastos(filtros), obtenerIndicadoresGastos(periodoDesde, periodoHasta)])
      setGastos(lista)
      setIndicadores(ind)
      if (campoFecha === 'pago' && filtroDesde && filtroHasta) {
        const ids = await listarGastoIdsConPagoEnRango(filtroDesde, filtroHasta)
        setIdsConPago(ids)
      } else {
        setIdsConPago(null)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarCatalogos().catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cargarLista()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, filtroCategoria, filtroEstado, filtroOrigen, campoFecha, filtroDesde, filtroHasta, periodoDesde, periodoHasta])

  const gastosFiltrados = useMemo(() => {
    let base = gastos
    if (idsConPago) base = base.filter((g) => idsConPago.has(g.id))
    if (pestana === 'por_pagar') base = base.filter((g) => !g.anulado && g.saldo_pendiente > 0)
    return base
  }, [gastos, idsConPago, pestana])

  function exportarCSV() {
    const encabezados = ['Concepto', 'Categoría', 'Proveedor', 'Fecha', 'Vencimiento', 'Valor total', 'Pagado', 'Saldo', 'Estado', 'Origen']
    const filas = gastosFiltrados.map((g) => [
      g.concepto,
      g.categoria_nombre,
      g.proveedor_nombre ?? '',
      g.fecha,
      g.fecha_vencimiento ?? '',
      g.valor_total,
      g.total_pagado,
      g.saldo_pendiente,
      g.anulado ? 'Anulado' : ETIQUETA_ESTADO[g.estado],
      g.origen,
    ])
    const csv = [encabezados, ...filas]
      .map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gastos-${fechaBogotaISO()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function alGuardarGasto(gasto: Gasto) {
    setFormularioAbierto(false)
    setGastoEnEdicion(null)
    cargarLista()
    setGastoSeleccionado(gasto)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-marca text-2xl font-semibold text-carbon">Gastos y pagos</h1>
          <p className="text-sm text-carbon/60">Controla los gastos del salón y organiza tus próximos pagos.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variante="secondary" onClick={exportarCSV} disabled={gastosFiltrados.length === 0}>Exportar</Button>
          <Button onClick={() => { setGastoEnEdicion(null); setFormularioAbierto(true) }}>Registrar gasto</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-carbon/60">Periodo:</label>
        {(['hoy', 'semana', 'mes', 'rango'] as Periodo[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriodo(p)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              periodo === p ? 'border-oliva bg-oliva text-blanco' : 'border-piedra text-carbon/70 hover:border-oliva'
            }`}
          >
            {p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Semana' : p === 'mes' ? 'Mes' : 'Rango'}
          </button>
        ))}
        {periodo === 'rango' && (
          <>
            <input type="date" value={rangoDesde} onChange={(e) => setRangoDesde(e.target.value)} className="rounded-lg border border-piedra px-3 py-1.5 text-sm" />
            <input type="date" value={rangoHasta} onChange={(e) => setRangoHasta(e.target.value)} className="rounded-lg border border-piedra px-3 py-1.5 text-sm" />
          </>
        )}
      </div>

      {error && <ErrorState mensaje={error} reintentar={cargarLista} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <IndicadorCard titulo="Pagado en el periodo" valor={indicadores?.pagadoEnPeriodo} ayuda="Neto de reversiones, según el periodo elegido arriba." />
        <IndicadorCard titulo="Pendiente por pagar" valor={indicadores?.pendientePorPagar} ayuda="Saldo abierto total, sin importar el periodo." />
        <IndicadorCard titulo="Vencido" valor={indicadores?.vencido} ayuda="Parte de lo pendiente, ya con fecha de vencimiento pasada." destacar="error" />
        <IndicadorCard titulo="Próximos 7 días" valor={indicadores?.proximos7Dias} ayuda="Parte de lo pendiente, que vence en la próxima semana." />
      </div>

      <div className="flex gap-1 border-b border-piedra">
        {(['todos', 'por_pagar', 'recurrentes'] as Pestana[]).map((p) => (
          <button
            key={p}
            onClick={() => setPestana(p)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              pestana === p ? 'border-oliva text-oliva' : 'border-transparent text-carbon/50 hover:text-carbon'
            }`}
          >
            {p === 'todos' ? 'Todos' : p === 'por_pagar' ? 'Por pagar' : 'Recurrentes'}
          </button>
        ))}
      </div>

      {pestana === 'recurrentes' ? (
        <GastosRecurrentes
          plantillas={plantillas}
          categorias={categorias}
          onCambio={cargarCatalogos}
          onGastoGenerado={() => { cargarCatalogos(); cargarLista() }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Input id="gtBuscar" etiqueta="Buscar" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Concepto, proveedor o referencia" />
            <Select id="gtCategoria" etiqueta="Categoría" value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </Select>
            <Select id="gtEstado" etiqueta="Estado" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="pago_parcial">Pago parcial</option>
              <option value="pagado">Pagado</option>
              <option value="vencido">Vencido</option>
              <option value="anulado">Anulado</option>
            </Select>
            <Select id="gtOrigen" etiqueta="Origen" value={filtroOrigen} onChange={(e) => setFiltroOrigen(e.target.value)}>
              <option value="">Todos</option>
              <option value="manual">Manual</option>
              <option value="liquidacion">Liquidación</option>
              <option value="compra">Compra</option>
            </Select>
            <Select id="gtCampoFecha" etiqueta="Filtrar por fecha de" value={campoFecha} onChange={(e) => setCampoFecha(e.target.value as typeof campoFecha)}>
              <option value="fecha">Fecha del gasto</option>
              <option value="fecha_vencimiento">Vencimiento</option>
              <option value="pago">Fecha de pago</option>
            </Select>
            <Input id="gtDesde" etiqueta="Desde" type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
            <Input id="gtHasta" etiqueta="Hasta" type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
          </div>

          {cargando ? (
            <Cargando filas={4} />
          ) : gastosFiltrados.length === 0 ? (
            <EmptyState
              titulo="Todavía no has registrado gastos"
              descripcion="Agrega el primer gasto para empezar a controlar las salidas del salón."
              accion={<Button onClick={() => setFormularioAbierto(true)}>Registrar gasto</Button>}
            />
          ) : (
            <>
              {/* Escritorio: tabla */}
              <div className="hidden overflow-x-auto rounded-2xl border border-piedra md:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-piedra/40 text-xs uppercase tracking-wide text-carbon/50">
                    <tr>
                      <th className="px-4 py-2.5">Concepto</th>
                      <th className="px-4 py-2.5">Categoría</th>
                      <th className="px-4 py-2.5">Proveedor</th>
                      <th className="px-4 py-2.5">Fecha</th>
                      <th className="px-4 py-2.5">Vence</th>
                      <th className="px-4 py-2.5 text-right">Valor</th>
                      <th className="px-4 py-2.5 text-right">Saldo</th>
                      <th className="px-4 py-2.5">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-piedra">
                    {gastosFiltrados.map((g) => (
                      <tr key={g.id} onClick={() => setGastoSeleccionado(g)} className="cursor-pointer hover:bg-piedra/20">
                        <td className="px-4 py-3 font-medium text-carbon">{g.concepto}</td>
                        <td className="px-4 py-3 text-carbon/70">{g.categoria_nombre}</td>
                        <td className="px-4 py-3 text-carbon/70">{g.proveedor_nombre ?? '—'}</td>
                        <td className="px-4 py-3 text-carbon/70">{formatoFecha(g.fecha)}</td>
                        <td className="px-4 py-3 text-carbon/70">{g.fecha_vencimiento ? formatoFecha(g.fecha_vencimiento) : '—'}</td>
                        <td className="px-4 py-3 text-right text-carbon">{formatoMoneda(g.valor_total)}</td>
                        <td className="px-4 py-3 text-right text-carbon">{g.anulado ? '—' : formatoMoneda(Math.max(g.saldo_pendiente, 0))}</td>
                        <td className="px-4 py-3"><EtiquetaEstadoFila gasto={g} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Móvil: tarjetas */}
              <div className="flex flex-col gap-2 md:hidden">
                {gastosFiltrados.map((g) => (
                  <Card key={g.id} className="flex flex-col gap-1.5 py-3" >
                    <button onClick={() => setGastoSeleccionado(g)} className="flex items-start justify-between gap-2 text-left">
                      <div>
                        <p className="font-medium text-carbon">{g.concepto}</p>
                        <p className="text-xs text-carbon/60">{g.categoria_nombre}{g.proveedor_nombre ? ` · ${g.proveedor_nombre}` : ''}</p>
                        <p className="text-xs text-carbon/50">{formatoFecha(g.fecha)}{g.fecha_vencimiento ? ` · vence ${formatoFecha(g.fecha_vencimiento)}` : ''}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-carbon">{formatoMoneda(g.valor_total)}</p>
                        <p className="text-xs text-carbon/50">Saldo {g.anulado ? '—' : formatoMoneda(Math.max(g.saldo_pendiente, 0))}</p>
                      </div>
                    </button>
                    <EtiquetaEstadoFila gasto={g} />
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <Drawer abierto={formularioAbierto} onCerrar={() => { setFormularioAbierto(false); setGastoEnEdicion(null) }} titulo={gastoEnEdicion ? 'Editar gasto' : 'Registrar gasto'}>
        <GastosFormulario
          gasto={gastoEnEdicion}
          categorias={categorias}
          cuentas={cuentas}
          onGuardado={alGuardarGasto}
          onCancelar={() => { setFormularioAbierto(false); setGastoEnEdicion(null) }}
        />
      </Drawer>

      <Drawer abierto={!!gastoSeleccionado} onCerrar={() => setGastoSeleccionado(null)} titulo="Detalle del gasto">
        {gastoSeleccionado && (
          <GastosDetalle
            gasto={gastoSeleccionado}
            cuentas={cuentas}
            onEditar={() => { setGastoEnEdicion(gastoSeleccionado); setGastoSeleccionado(null); setFormularioAbierto(true) }}
            onDuplicado={(nuevo) => { cargarLista(); setGastoSeleccionado(nuevo) }}
            onCambio={(actualizado) => { setGastoSeleccionado(actualizado); cargarLista() }}
            onCerrar={() => { setGastoSeleccionado(null); cargarLista() }}
          />
        )}
      </Drawer>
    </div>
  )
}

function IndicadorCard({ titulo, valor, ayuda, destacar }: { titulo: string; valor?: number; ayuda: string; destacar?: 'error' }) {
  return (
    <Card className="flex flex-col gap-1 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-carbon/50">{titulo}</p>
      <p className={`text-xl font-semibold ${destacar === 'error' && (valor ?? 0) > 0 ? 'text-error' : 'text-carbon'}`}>
        {valor === undefined ? '—' : formatoMoneda(valor)}
      </p>
      <p className="text-[11px] text-carbon/40">{ayuda}</p>
    </Card>
  )
}

function EtiquetaEstadoFila({ gasto }: { gasto: Gasto }) {
  if (gasto.anulado) return <span className="rounded-full bg-carbon/10 px-2.5 py-1 text-xs font-semibold text-carbon/60">Anulado</span>
  const color = gasto.estado === 'pagado' ? 'bg-oliva/15 text-oliva' : gasto.estado === 'pago_parcial' ? 'bg-champan/40 text-carbon' : 'bg-piedra text-carbon/70'
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>{ETIQUETA_ESTADO[gasto.estado]}</span>
      {gasto.vencido && <span className="rounded-full bg-error/10 px-2.5 py-1 text-xs font-semibold text-error">Vencido</span>}
    </span>
  )
}
