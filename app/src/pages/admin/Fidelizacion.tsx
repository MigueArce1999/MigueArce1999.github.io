import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { CampoMoneda, Input, Select, Textarea } from '../../components/ui/Campos'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { Modal } from '../../components/ui/Modal'
import { listarCategorias, listarServiciosAdmin } from '../../lib/api/catalogo'
import { formatoEnteroCOP, formatoFecha } from '../../lib/format'
import {
  ajustarPuntosManual,
  actualizarConfiguracionFidelizacion,
  actualizarRecompensa,
  alternarRecompensaActiva,
  crearRecompensa,
  listarCanjesPendientesEntrega,
  listarClientesFidelizacion,
  listarMisCanjes,
  listarMovimientosPuntosPagina,
  listarRecompensasAdmin,
  marcarCanjeEntregado,
  obtenerConfiguracionFidelizacion,
  obtenerReglaPuntosVigente,
  obtenerResumenFidelizacion,
  guardarReglaPuntos,
  type CanjePendienteEntrega,
  type ClienteFidelizacionResumen,
  type RecompensaFormulario,
  type ResumenFidelizacionPeriodo,
} from '../../lib/api/fidelizacion'
import type { CanjeRecompensa, CategoriaServicio, ConfiguracionFidelizacion, MovimientoPuntos, Recompensa, Servicio, TipoRecompensa } from '../../lib/types'

type Pestana = 'resumen' | 'recompensas' | 'configuracion' | 'clientas'

export function AdminFidelizacion() {
  const [pestana, setPestana] = useState<Pestana>('resumen')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-marca text-2xl font-semibold text-carbon">Fidelización</h1>
        <p className="text-sm text-carbon/60">Tu belleza florece — el programa de puntos y recompensas del salón.</p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-piedra">
        {([
          ['resumen', 'Resumen'], ['recompensas', 'Recompensas'], ['configuracion', 'Configuración'], ['clientas', 'Clientas'],
        ] as [Pestana, string][]).map(([p, etiqueta]) => (
          <button
            key={p}
            onClick={() => setPestana(p)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              pestana === p ? 'border-oliva text-oliva' : 'border-transparent text-carbon/50 hover:text-carbon'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'resumen' && <PestanaResumen />}
      {pestana === 'recompensas' && <PestanaRecompensas />}
      {pestana === 'configuracion' && <PestanaConfiguracion />}
      {pestana === 'clientas' && <PestanaClientas />}
    </div>
  )
}

// --- Resumen -----------------------------------------------------------------------------

function inicioDeHace(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

function PestanaResumen() {
  const [desde, setDesde] = useState(inicioDeHace(30))
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10))
  const [resumen, setResumen] = useState<ResumenFidelizacionPeriodo | null>(null)
  const [error, setError] = useState<string | null>(null)

  function cargar() {
    setError(null)
    setResumen(null)
    obtenerResumenFidelizacion(`${desde}T00:00:00`, `${hasta}T23:59:59`)
      .then(setResumen)
      .catch((e) => setError(e.message))
  }

  useEffect(cargar, [desde, hasta])

  return (
    <div className="flex flex-col gap-4">
      <CanjesPorEntregar />

      <div className="flex flex-wrap items-end gap-3">
        <Input id="desde" etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Input id="hasta" etiqueta="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </div>
      {error && <ErrorState mensaje={error} reintentar={cargar} />}
      {!resumen && !error ? (
        <Cargando filas={2} />
      ) : resumen ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/40">En el periodo elegido</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricaCard titulo="Clientas con movimientos" valor={resumen.clientas_con_movimientos} />
            <MetricaCard titulo="Puntos otorgados" valor={formatoEnteroCOP(resumen.puntos_otorgados)} />
            <MetricaCard titulo="Puntos utilizados" valor={formatoEnteroCOP(resumen.puntos_utilizados)} />
            <MetricaCard titulo="Recompensas canjeadas" valor={resumen.recompensas_canjeadas} />
          </div>
          <p className="text-xs text-carbon/50">
            Estas son cifras del periodo elegido, no un saldo — para ver cuántos puntos tiene disponibles cada clienta
            ahora mismo, ve a la pestaña "Clientas". Los puntos no son una utilidad ni una deuda monetaria: son la unidad
            interna del programa.
          </p>
        </>
      ) : null}
    </div>
  )
}

// Autocanjes (la clienta pidió su recompensa ella misma desde su perfil) que todavía no se le han
// entregado — un canje aplicado durante un cobro normal no aparece acá porque ya se resolvió en
// esa misma visita (ver vista_canje_pendiente_entrega en 0049_autocanje.sql).
function CanjesPorEntregar() {
  const [pendientes, setPendientes] = useState<CanjePendienteEntrega[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [entregando, setEntregando] = useState<string | null>(null)

  function cargar() {
    setError(null)
    listarCanjesPendientesEntrega().then(setPendientes).catch((e) => setError(e.message))
  }

  useEffect(cargar, [])

  async function entregar(canjeId: string) {
    setEntregando(canjeId)
    try {
      await marcarCanjeEntregado(canjeId)
      cargar()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setEntregando(null)
    }
  }

  if (error) return <ErrorState mensaje={error} reintentar={cargar} />
  if (!pendientes) return <Cargando filas={1} />
  if (pendientes.length === 0) return null

  return (
    <Card className="flex flex-col gap-3 border-champan/60 bg-champan/10">
      <div>
        <p className="font-semibold text-carbon">Canjes por entregar</p>
        <p className="text-xs text-carbon/60">Recompensas que clientas ya canjearon ellas mismas desde su perfil y todavía no reclaman.</p>
      </div>
      <div className="flex flex-col gap-2">
        {pendientes.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blanco px-3 py-2">
            <div>
              <p className="text-sm font-medium text-carbon">{c.cliente_nombre} <span className="font-normal text-carbon/50">· {c.condiciones_snapshot.nombre}</span></p>
              <p className="text-xs text-carbon/50">
                {formatoEnteroCOP(c.costo_puntos_snapshot)} puntos · {formatoFecha(c.creado_en)}
                {c.cliente_telefono && ` · ${c.cliente_telefono}`}
              </p>
            </div>
            <Button tamano="sm" onClick={() => entregar(c.id)} cargando={entregando === c.id}>Marcar entregado</Button>
          </div>
        ))}
      </div>
    </Card>
  )
}

function MetricaCard({ titulo, valor }: { titulo: string; valor: string | number }) {
  return (
    <Card className="text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">{titulo}</p>
      <p className="mt-1 font-marca text-2xl font-semibold text-oliva">{valor}</p>
    </Card>
  )
}

// --- Recompensas ---------------------------------------------------------------------------

const FORM_VACIO: RecompensaFormulario = {
  nombre: '', descripcion: '', costoPuntos: 100, tipo: 'beneficio', servicioId: null, montoDescuento: null,
  serviciosElegibles: [], condiciones: '', requiereAtencionPagada: true, stockIlimitado: true, cantidadDisponible: null,
  imagenUrl: '', ordenVisualizacion: 0, activa: false,
}

function PestanaRecompensas() {
  const [recompensas, setRecompensas] = useState<Recompensa[] | null>(null)
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<Recompensa | null>(null)
  const [creando, setCreando] = useState(false)

  function cargar() {
    setError(null)
    listarRecompensasAdmin().then(setRecompensas).catch((e) => setError(e.message))
  }

  useEffect(() => {
    cargar()
    listarServiciosAdmin().then(setServicios).catch(() => {})
  }, [])

  async function alternarActiva(r: Recompensa) {
    await alternarRecompensaActiva(r.id, !r.activa)
    cargar()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button tamano="sm" onClick={() => setCreando(true)}>+ Nueva recompensa</Button>
      </div>
      {error && <ErrorState mensaje={error} reintentar={cargar} />}
      {!recompensas ? (
        <Cargando filas={3} />
      ) : recompensas.length === 0 ? (
        <EmptyState titulo="Todavía no has publicado ninguna recompensa" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {recompensas.map((r) => (
            <Card key={r.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-carbon">{r.nombre}</p>
                  <p className="text-xs text-carbon/50">{r.tipo === 'beneficio' ? 'Beneficio/servicio' : 'Descuento fijo'} · {formatoEnteroCOP(r.costo_puntos)} puntos</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.activa ? 'bg-exito/15 text-exito' : 'bg-piedra text-carbon/60'}`}>
                  {r.activa ? 'Publicada' : 'Inactiva'}
                </span>
              </div>
              {r.descripcion && <p className="text-sm text-carbon/60">{r.descripcion}</p>}
              {!r.stock_ilimitado && <p className="text-xs text-carbon/50">Stock: {r.cantidad_disponible ?? 0}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button tamano="sm" variante="secondary" onClick={() => setEditando(r)}>Editar</Button>
                <Button tamano="sm" variante={r.activa ? 'ghost' : 'outline'} onClick={() => alternarActiva(r)}>
                  {r.activa ? 'Desactivar' : 'Publicar'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {(creando || editando) && (
        <FormularioRecompensaModal
          recompensa={editando}
          servicios={servicios}
          onCerrar={() => { setCreando(false); setEditando(null) }}
          onGuardado={() => { setCreando(false); setEditando(null); cargar() }}
        />
      )}
    </div>
  )
}

function FormularioRecompensaModal({
  recompensa,
  servicios,
  onCerrar,
  onGuardado,
}: {
  recompensa: Recompensa | null
  servicios: Servicio[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [form, setForm] = useState<RecompensaFormulario>(
    recompensa
      ? {
          nombre: recompensa.nombre, descripcion: recompensa.descripcion ?? '', costoPuntos: recompensa.costo_puntos,
          tipo: recompensa.tipo, servicioId: recompensa.servicio_id, montoDescuento: recompensa.monto_descuento,
          serviciosElegibles: recompensa.servicios_elegibles, condiciones: recompensa.condiciones ?? '',
          requiereAtencionPagada: recompensa.requiere_atencion_pagada, stockIlimitado: recompensa.stock_ilimitado,
          cantidadDisponible: recompensa.cantidad_disponible, imagenUrl: recompensa.imagen_url ?? '',
          ordenVisualizacion: recompensa.orden_visualizacion, activa: recompensa.activa,
        }
      : FORM_VACIO,
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function actualizar<K extends keyof RecompensaFormulario>(campo: K, valor: RecompensaFormulario[K]) {
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  const valido = form.nombre.trim().length > 0 && form.costoPuntos > 0
    && (form.tipo === 'beneficio' ? !!form.servicioId : !!form.montoDescuento && form.montoDescuento > 0)

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      if (recompensa) await actualizarRecompensa(recompensa.id, form)
      else await crearRecompensa(form)
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={recompensa ? 'Editar recompensa' : 'Nueva recompensa'}>
      <div className="flex flex-col gap-3">
        {error && <ErrorState mensaje={error} />}
        <Input id="nombre" etiqueta="Nombre" value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} />
        <Textarea id="descripcion" etiqueta="Descripción breve" value={form.descripcion ?? ''} onChange={(e) => actualizar('descripcion', e.target.value)} />
        <Select id="tipo" etiqueta="Tipo" value={form.tipo} onChange={(e) => actualizar('tipo', e.target.value as TipoRecompensa)}>
          <option value="beneficio">Beneficio o servicio adicional</option>
          <option value="descuento_fijo">Descuento de monto fijo</option>
        </Select>
        <CampoMoneda id="costo" etiqueta="Puntos requeridos" value={form.costoPuntos} onChange={(v) => actualizar('costoPuntos', v ?? 0)} />

        {form.tipo === 'beneficio' ? (
          <Select id="servicio" etiqueta="Servicio incluido" value={form.servicioId ?? ''} onChange={(e) => actualizar('servicioId', e.target.value || null)}>
            <option value="">Elige un servicio…</option>
            {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </Select>
        ) : (
          <CampoMoneda id="monto" etiqueta="Monto del descuento (COP)" value={form.montoDescuento} onChange={(v) => actualizar('montoDescuento', v)} />
        )}

        <Textarea id="condiciones" etiqueta="Condiciones (se muestran a la clienta)" value={form.condiciones ?? ''} onChange={(e) => actualizar('condiciones', e.target.value)} />
        <Input id="imagen" etiqueta="URL de imagen (opcional)" value={form.imagenUrl ?? ''} onChange={(e) => actualizar('imagenUrl', e.target.value)} />

        <label className="flex items-center gap-2 text-sm text-carbon">
          <input type="checkbox" checked={form.requiereAtencionPagada} onChange={(e) => actualizar('requiereAtencionPagada', e.target.checked)} />
          Requiere una atención pagada para aplicarse
        </label>
        <label className="flex items-center gap-2 text-sm text-carbon">
          <input type="checkbox" checked={form.stockIlimitado} onChange={(e) => actualizar('stockIlimitado', e.target.checked)} />
          Stock ilimitado
        </label>
        {!form.stockIlimitado && (
          <Input
            id="stock" etiqueta="Cantidad disponible" type="number" min={0}
            value={form.cantidadDisponible ?? 0}
            onChange={(e) => actualizar('cantidadDisponible', Number(e.target.value))}
          />
        )}
        <label className="flex items-center gap-2 text-sm text-carbon">
          <input type="checkbox" checked={form.activa} onChange={(e) => actualizar('activa', e.target.checked)} />
          Publicada (visible para las clientas)
        </label>

        {/* Vista previa de la tarjeta tal como la vería la clienta. */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-carbon/40">Vista previa</p>
          <Card className="flex flex-col gap-1">
            <p className="font-semibold text-carbon">{form.nombre || 'Nombre de la recompensa'}</p>
            {form.descripcion && <p className="text-sm text-carbon/60">{form.descripcion}</p>}
            <p className="text-sm font-semibold text-oliva">{formatoEnteroCOP(form.costoPuntos)} puntos</p>
          </Card>
        </div>

        <Button onClick={guardar} cargando={guardando} disabled={!valido}>Guardar</Button>
      </div>
    </Modal>
  )
}

// --- Configuración -------------------------------------------------------------------------

function PestanaConfiguracion() {
  const [config, setConfig] = useState<ConfiguracionFidelizacion | null>(null)
  const [categorias, setCategorias] = useState<CategoriaServicio[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [error, setError] = useState<string | null>(null)
  const [guardandoEstado, setGuardandoEstado] = useState(false)
  const [guardandoRegla, setGuardandoRegla] = useState(false)
  const [exitoRegla, setExitoRegla] = useState(false)

  const [montoBloque, setMontoBloque] = useState<number | null>(1000)
  const [puntosBloque, setPuntosBloque] = useState<number | null>(1)
  const [categoriasExcluidas, setCategoriasExcluidas] = useState<Set<string>>(new Set())
  const [serviciosExcluidos, setServiciosExcluidos] = useState<Set<string>>(new Set())
  const [incluyeProductos, setIncluyeProductos] = useState(true)
  const [texto, setTexto] = useState('')

  function cargar() {
    setError(null)
    Promise.all([obtenerConfiguracionFidelizacion(), obtenerReglaPuntosVigente(), listarCategorias(), listarServiciosAdmin()])
      .then(([c, r, cats, servs]) => {
        setConfig(c)
        setTexto(c.texto_programa)
        setCategorias(cats)
        setServicios(servs)
        if (r) {
          setMontoBloque(r.monto_por_bloque)
          setPuntosBloque(r.puntos_por_bloque)
          setCategoriasExcluidas(new Set(r.categorias_excluidas))
          setServiciosExcluidos(new Set(r.servicios_excluidos))
          setIncluyeProductos(r.incluye_productos)
        }
      })
      .catch((e) => setError(e.message))
  }

  useEffect(cargar, [])

  async function alternarEstado(campo: 'acumulacionActiva' | 'canjesActivo', valor: boolean) {
    if (!config) return
    setGuardandoEstado(true)
    try {
      await actualizarConfiguracionFidelizacion({ [campo]: valor })
      cargar()
    } finally {
      setGuardandoEstado(false)
    }
  }

  async function guardarTexto() {
    await actualizarConfiguracionFidelizacion({ textoPrograma: texto })
  }

  function alternarEnConjunto(set: Set<string>, id: string): Set<string> {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  async function guardarRegla() {
    if (!montoBloque || !puntosBloque) return
    setGuardandoRegla(true)
    setExitoRegla(false)
    try {
      await guardarReglaPuntos({
        montoPorBloque: montoBloque, puntosPorBloque: puntosBloque,
        categoriasExcluidas: [...categoriasExcluidas], serviciosExcluidos: [...serviciosExcluidos], incluyeProductos,
      })
      setExitoRegla(true)
      cargar()
    } finally {
      setGuardandoRegla(false)
    }
  }

  if (error) return <ErrorState mensaje={error} reintentar={cargar} />
  if (!config) return <Cargando filas={3} />

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <p className="font-semibold text-carbon">Estado del programa</p>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-carbon">Acumulación de puntos</span>
          <input type="checkbox" checked={config.acumulacion_activa} disabled={guardandoEstado} onChange={(e) => alternarEstado('acumulacionActiva', e.target.checked)} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-carbon">Canjes de recompensas</span>
          <input type="checkbox" checked={config.canjes_activo} disabled={guardandoEstado} onChange={(e) => alternarEstado('canjesActivo', e.target.checked)} />
        </label>
        <p className="text-xs text-carbon/50">Pausar acumulación o canjes se aplica de inmediato, y solo hacia adelante — nunca cambia lo que ya se otorgó o se usó antes.</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="font-semibold text-carbon">Texto público del programa</p>
        <Textarea id="texto-programa" etiqueta="" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Button tamano="sm" onClick={guardarTexto} className="w-fit">Guardar texto</Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="font-semibold text-carbon">Regla de acumulación</p>
        <p className="text-sm text-carbon/60">
          Ejemplo: 1 punto por cada $1.000 pagados en conceptos elegibles. Un cambio aquí crea una regla nueva desde
          este momento — nunca recalcula ni cambia cómo se explican los puntos que ya se otorgaron.
        </p>
        <div className="flex flex-wrap gap-3">
          <CampoMoneda id="monto-bloque" etiqueta="COP por bloque" value={montoBloque} onChange={setMontoBloque} />
          <Input id="puntos-bloque" etiqueta="Puntos por bloque" type="number" min={1} value={puntosBloque ?? ''} onChange={(e) => setPuntosBloque(Number(e.target.value))} />
        </div>
        <label className="flex items-center gap-2 text-sm text-carbon">
          <input type="checkbox" checked={incluyeProductos} onChange={(e) => setIncluyeProductos(e.target.checked)} />
          Incluir productos vendidos (no solo servicios)
        </label>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-carbon/50">Categorías excluidas (no otorgan puntos)</p>
          <div className="flex flex-wrap gap-2">
            {categorias.map((c) => (
              <label key={c.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium ${categoriasExcluidas.has(c.id) ? 'border-error bg-error/10 text-error' : 'border-piedra text-carbon/70'}`}>
                <input type="checkbox" className="sr-only" checked={categoriasExcluidas.has(c.id)} onChange={() => setCategoriasExcluidas((prev) => alternarEnConjunto(prev, c.id))} />
                {c.nombre}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-carbon/50">Servicios excluidos individualmente</p>
          <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {servicios.map((s) => (
              <label key={s.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium ${serviciosExcluidos.has(s.id) ? 'border-error bg-error/10 text-error' : 'border-piedra text-carbon/70'}`}>
                <input type="checkbox" className="sr-only" checked={serviciosExcluidos.has(s.id)} onChange={() => setServiciosExcluidos((prev) => alternarEnConjunto(prev, s.id))} />
                {s.nombre}
              </label>
            ))}
          </div>
        </div>
        <Button tamano="sm" onClick={guardarRegla} cargando={guardandoRegla} disabled={!montoBloque || !puntosBloque} className="w-fit">Guardar regla</Button>
        {exitoRegla && <p className="text-sm font-medium text-exito">Regla actualizada.</p>}
      </Card>
    </div>
  )
}

// --- Clientas ------------------------------------------------------------------------------

function PestanaClientas() {
  const [busqueda, setBusqueda] = useState('')
  const [clientas, setClientas] = useState<ClienteFidelizacionResumen[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seleccionada, setSeleccionada] = useState<ClienteFidelizacionResumen | null>(null)

  function cargar() {
    setError(null)
    listarClientesFidelizacion(busqueda).then(setClientas).catch((e) => setError(e.message))
  }

  useEffect(() => {
    const t = setTimeout(cargar, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda])

  return (
    <div className="flex flex-col gap-4">
      <Input id="buscar-clienta" etiqueta="Buscar por nombre o teléfono" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      {error && <ErrorState mensaje={error} reintentar={cargar} />}
      {!clientas ? (
        <Cargando filas={3} />
      ) : clientas.length === 0 ? (
        <EmptyState titulo="Ninguna clienta con movimientos de fidelización todavía" />
      ) : (
        <div className="flex flex-col gap-2">
          {clientas.map((c) => (
            <button key={c.cliente_id} onClick={() => setSeleccionada(c)} className="text-left">
              <Card className="flex items-center justify-between py-3 hover:border-oliva">
                <div>
                  <p className="font-medium text-carbon">{c.nombre}</p>
                  <p className="text-xs text-carbon/50">{c.telefono ?? 'Sin teléfono'} · Último movimiento {c.ultimo_movimiento ? formatoFecha(c.ultimo_movimiento) : '—'}</p>
                </div>
                <div className="text-right">
                  <p className="font-marca text-lg font-semibold text-oliva">{formatoEnteroCOP(c.saldo)}</p>
                  <p className="text-xs text-carbon/50">Ganado {formatoEnteroCOP(c.total_ganado)} · Usado {formatoEnteroCOP(c.total_utilizado)}</p>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {seleccionada && <DetalleClientaModal clienta={seleccionada} onCerrar={() => setSeleccionada(null)} onAjustado={cargar} />}
    </div>
  )
}

function DetalleClientaModal({
  clienta,
  onCerrar,
  onAjustado,
}: {
  clienta: ClienteFidelizacionResumen
  onCerrar: () => void
  onAjustado: () => void
}) {
  const [movimientos, setMovimientos] = useState<MovimientoPuntos[] | null>(null)
  const [canjes, setCanjes] = useState<CanjeRecompensa[] | null>(null)
  const [ajustando, setAjustando] = useState(false)
  const [puntosAjuste, setPuntosAjuste] = useState<number>(0)
  const [motivoAjuste, setMotivoAjuste] = useState('')
  const [guardandoAjuste, setGuardandoAjuste] = useState(false)
  const [errorAjuste, setErrorAjuste] = useState<string | null>(null)

  useEffect(() => {
    listarMovimientosPuntosPagina(clienta.cliente_id, 0, 20).then(({ movimientos }) => setMovimientos(movimientos))
    listarMisCanjes(clienta.cliente_id).then(setCanjes)
  }, [clienta.cliente_id])

  async function confirmarAjuste() {
    if (puntosAjuste === 0 || !motivoAjuste.trim()) return
    setGuardandoAjuste(true)
    setErrorAjuste(null)
    try {
      await ajustarPuntosManual(clienta.cliente_id, puntosAjuste, motivoAjuste.trim())
      setAjustando(false)
      setPuntosAjuste(0)
      setMotivoAjuste('')
      onAjustado()
      listarMovimientosPuntosPagina(clienta.cliente_id, 0, 20).then(({ movimientos }) => setMovimientos(movimientos))
    } catch (e: any) {
      setErrorAjuste(e.message)
    } finally {
      setGuardandoAjuste(false)
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={clienta.nombre}>
      <div className="flex flex-col gap-4">
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Saldo actual</p>
            <p className="font-marca text-2xl font-semibold text-oliva">{formatoEnteroCOP(clienta.saldo)}</p>
          </div>
          <Button tamano="sm" variante="outline" onClick={() => setAjustando((v) => !v)}>Ajuste manual</Button>
        </Card>

        {ajustando && (
          <Card className="flex flex-col gap-2">
            {errorAjuste && <ErrorState mensaje={errorAjuste} />}
            <Input id="puntos-ajuste" etiqueta="Puntos (usa negativo para restar)" type="number" value={puntosAjuste} onChange={(e) => setPuntosAjuste(Number(e.target.value))} />
            <Textarea id="motivo-ajuste" etiqueta="Motivo (obligatorio)" value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} />
            {puntosAjuste !== 0 && (
              <p className="text-xs text-carbon/60">Vista previa: saldo quedaría en {formatoEnteroCOP(clienta.saldo + puntosAjuste)}.</p>
            )}
            <Button tamano="sm" onClick={confirmarAjuste} cargando={guardandoAjuste} disabled={puntosAjuste === 0 || !motivoAjuste.trim()}>
              Confirmar ajuste
            </Button>
          </Card>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-carbon">Historial reciente</p>
          {!movimientos ? <Cargando filas={2} /> : movimientos.length === 0 ? <EmptyState titulo="Sin movimientos" /> : (
            <div className="flex flex-col gap-1.5">
              {movimientos.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <span className="text-carbon/70">{formatoFecha(m.creado_en)} · {m.tipo}{m.motivo ? ` (${m.motivo})` : ''}</span>
                  <span className={Number(m.puntos) >= 0 ? 'text-exito' : 'text-error'}>{Number(m.puntos) >= 0 ? '+' : ''}{formatoEnteroCOP(Number(m.puntos))}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {canjes && canjes.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold text-carbon">Canjes</p>
            <div className="flex flex-col gap-1.5">
              {canjes.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span className="text-carbon/70">{formatoFecha(c.creado_en)} · {c.condiciones_snapshot.nombre}</span>
                  <span className="text-carbon/50">{c.estado}{c.entregado ? ' · entregado' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
