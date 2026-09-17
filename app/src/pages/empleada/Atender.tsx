import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { CampoBase, CampoMoneda, Input, Select, Textarea } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { isDemoMode, supabase } from '../../lib/supabase'
import { listarProfesionales, listarServicios } from '../../lib/api/catalogo'
import { buscarClientes, completarYCobrarAtencion, listarClientesRecientes, registrarAtencion } from '../../lib/api/empleada'
import { obtenerClienteAdmin } from '../../lib/api/clientes'
import { obtenerReservaPorId } from '../../lib/api/reservas'
import { estimarComision, type EstimacionComision } from '../../lib/api/comisiones'
import { formatoFecha, formatoHora, formatoMoneda } from '../../lib/format'
import type { Cliente, MetodoPago, Profesional, Servicio } from '../../lib/types'

// --- Tipos del borrador (solo viven en el navegador hasta el clic final en "Confirmar
// cobro"; ver fn_registrar_atencion en supabase/migrations/0020_colaborador_como_servicio.sql
// para la validación de negocio que se repite aquí en el cliente como primera línea de
// defensa). Un colaborador NO es un campo anidado dentro de un servicio: es su PROPIA línea
// de servicio (esColaboracion = true), sumada al total, cuyo valor asignado es su ganancia
// completa (100%) — decisión explícita del negocio. ---

// Máximo de colaboradores por servicio (decisión de negocio, sin caso de uso real por encima
// de esto todavía; evita que un servicio termine con una lista interminable de líneas).
const MAX_COLABORADORES_POR_SERVICIO = 5

interface LineaServicioBorrador {
  tempId: string
  servicioId: string
  nombre: string
  profesionalId: string
  // null = campo vacío (nunca "0" forzado); distinto de un 0 explícito para un servicio
  // cortesía. Ver docs/03-flujos.md y components/ui/Campos.tsx → CampoMoneda.
  precio: number | null
  esColaboracion: boolean
  // Solo presente en una línea de colaboración: tempId de su línea de servicio principal, para
  // agruparla visualmente bajo esa tarjeta en el paso de registrar (hasta MAX_COLABORADORES_POR_SERVICIO).
  colaboracionDe?: string
}

interface LineaProductoBorrador {
  tempId: string
  categoria: string
  nombre: string
  cantidad: number
  precioUnitario: number | null
}

function idTemporal() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function lineaVacia(profesionalPorDefecto: string): LineaServicioBorrador {
  return { tempId: idTemporal(), servicioId: '', nombre: '', profesionalId: profesionalPorDefecto, precio: null, esColaboracion: false }
}

function lineaIncompleta(l: LineaServicioBorrador) {
  return !l.servicioId || !l.profesionalId || l.precio == null || l.precio < 0
}

// La marca es opcional: la categoría (tinte, champú…) ya identifica el producto igual.
function productoIncompleto(p: LineaProductoBorrador) {
  return !p.categoria.trim() || p.cantidad <= 0 || p.precioUnitario == null || p.precioUnitario < 0
}

// Navegación con teclado compartida por los dos buscadores (cliente y servicio).
function useNavegacionLista(cantidad: number) {
  const [indice, setIndice] = useState(-1)
  useEffect(() => setIndice(-1), [cantidad])
  function onKeyDown(e: KeyboardEvent, onSeleccionar: (indice: number) => void, cerrar: () => void) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndice((i) => Math.min(i + 1, cantidad - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndice((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { if (indice >= 0 && indice < cantidad) { e.preventDefault(); onSeleccionar(indice) } }
    else if (e.key === 'Escape') { cerrar() }
  }
  return { indice, setIndice, onKeyDown }
}

// Numeral de paso dentro del formulario de registrar (Cliente → Servicios → Productos →
// Nota): puramente visual, no controla el orden real de llenado (los 4 bloques se pueden
// completar en cualquier orden), solo le da a la empleada una guía de "por dónde voy".
function PasoBadge({ numero }: { numero: number }) {
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-oliva text-xs font-semibold text-blanco"
      aria-hidden
    >
      {numero}
    </span>
  )
}

function Stepper({ paso }: { paso: 'registrar' | 'cobrar' }) {
  return (
    <div className="hidden items-center gap-3 sm:flex">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${paso === 'registrar' ? 'bg-oliva text-blanco' : 'bg-piedra/50 text-carbon/50'}`}>1</span>
        <span className={`text-sm font-semibold ${paso === 'registrar' ? 'text-carbon' : 'text-carbon/40'}`}>Registrar atención</span>
      </div>
      <span className="h-px w-8 bg-piedra" />
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${paso === 'cobrar' ? 'bg-oliva text-blanco' : 'bg-piedra/50 text-carbon/50'}`}>2</span>
        <span className={`text-sm font-semibold ${paso === 'cobrar' ? 'text-carbon' : 'text-carbon/40'}`}>Cobrar</span>
      </div>
    </div>
  )
}

// Mismo flujo para el portal de empleadas y para Admin → Ventas → Registrar venta: la única
// diferencia entre los dos contextos es a dónde vuelve al terminar (cada portal tiene su
// propia ruta protegida por rol, ver RutaProtegida — un admin no puede navegar a /equipo-app).
export function EmpleadaAtender({
  rutaFinalizar = '/equipo-app',
  etiquetaFinalizar = 'Volver a Mi día',
}: {
  rutaFinalizar?: string
  etiquetaFinalizar?: string
} = {}) {
  const navigate = useNavigate()
  const { profesional } = useAuth()
  const [searchParams] = useSearchParams()
  // Llegar aquí desde "Iniciar atención" en Mi agenda (?reservaId=...) precarga cliente y
  // servicio de esa cita, reutilizando el mismo flujo de registrar/cobrar — nunca uno paralelo.
  const reservaIdParam = searchParams.get('reservaId')

  const [servicios, setServicios] = useState<Servicio[]>([])
  const [equipo, setEquipo] = useState<Profesional[]>([])
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true)
  const [cargandoReserva, setCargandoReserva] = useState(!!reservaIdParam)
  const [citaOrigen, setCitaOrigen] = useState<{ inicio: string; servicioNombre?: string } | null>(null)

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [lineas, setLineas] = useState<LineaServicioBorrador[]>([lineaVacia(profesional?.id ?? '')])
  const [productos, setProductos] = useState<LineaProductoBorrador[]>([])
  const [notasAbiertas, setNotasAbiertas] = useState(false)
  const [notas, setNotas] = useState('')
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo')

  const [paso, setPaso] = useState<'registrar' | 'cobrar' | 'listo'>('registrar')
  const [errores, setErrores] = useState<string[]>([])
  // Se activa la primera vez que se intenta continuar; a partir de ahí, los campos
  // pendientes muestran su propio mensaje debajo (p. ej. "Ingresa el precio cobrado") en vez
  // de solo aparecer en la lista general de arriba.
  const [intentoContinuar, setIntentoContinuar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Claves estables por intento de registro/cobro: si una petición falla por red y se
  // reintenta (o el botón recibe un doble clic), se reutiliza la MISMA clave para no crear
  // una atención ni un cobro duplicados (ver fn_registrar_atencion/fn_completar_y_cobrar_atencion).
  const [borradorKey] = useState(() => idTemporal())
  const [claveCobro] = useState(() => idTemporal())
  const atencionIdRef = useRef<string | null>(null)
  const enviandoRef = useRef(false)

  useEffect(() => {
    Promise.all([listarServicios(), listarProfesionales()]).then(([s, p]) => {
      setServicios(s)
      setEquipo(p)
      setCargandoCatalogo(false)
    })
  }, [])

  useEffect(() => {
    if (!reservaIdParam) return
    let activo = true
    obtenerReservaPorId(reservaIdParam)
      .then(async (reserva) => {
        if (!reserva || !activo) return
        const c = await obtenerClienteAdmin(reserva.cliente_id)
        if (!activo) return
        if (c) setCliente(c)
        setLineas([{
          tempId: idTemporal(),
          servicioId: reserva.servicio_id,
          nombre: reserva.servicio_nombre ?? '',
          profesionalId: reserva.profesional_id,
          precio: reserva.precio_estimado,
          esColaboracion: false,
        }])
        setCitaOrigen({ inicio: reserva.rango_inicio, servicioNombre: reserva.servicio_nombre })
      })
      .catch((e: any) => setError(e.message))
      .finally(() => { if (activo) setCargandoReserva(false) })
    return () => { activo = false }
  }, [reservaIdParam])

  useEffect(() => {
    if (profesional && lineas.length === 1 && !lineas[0].profesionalId) {
      setLineas([{ ...lineas[0], profesionalId: profesional.id }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profesional])

  const subtotalServicios = lineas.reduce((acc, l) => acc + (l.precio ?? 0), 0)
  const subtotalProductos = productos.reduce((acc, p) => acc + p.cantidad * (p.precioUnitario ?? 0), 0)
  const total = subtotalServicios + subtotalProductos

  function actualizarLinea(tempId: string, cambios: Partial<LineaServicioBorrador>) {
    setLineas((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...cambios } : l)))
  }
  function quitarLinea(tempId: string) {
    setLineas((prev) => prev.filter((l) => l.tempId !== tempId))
  }
  function agregarLinea(nueva: LineaServicioBorrador) {
    setLineas((prev) => [...prev, nueva])
  }
  function actualizarProducto(tempId: string, cambios: Partial<LineaProductoBorrador>) {
    setProductos((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, ...cambios } : p)))
  }
  function quitarProducto(tempId: string) {
    setProductos((prev) => prev.filter((p) => p.tempId !== tempId))
  }

  function irACobrar() {
    setIntentoContinuar(true)
    const nuevosErrores: string[] = []
    if (!cliente) nuevosErrores.push('Selecciona un cliente para continuar.')
    const completas = lineas.filter((l) => !lineaIncompleta(l))
    if (completas.length === 0) {
      nuevosErrores.push('Añade al menos un servicio con profesional y precio.')
    } else if (lineas.length > completas.length) {
      nuevosErrores.push('Hay un servicio sin terminar: elige servicio, profesional y precio, o quítalo con la ✕.')
    }
    if (productos.some(productoIncompleto)) {
      nuevosErrores.push('Hay un producto sin categoría, nombre o precio: complétalo o quítalo.')
    }
    if (nuevosErrores.length > 0) {
      setErrores(nuevosErrores)
      return
    }
    setErrores([])
    setPaso('cobrar')
  }

  async function confirmarCobro() {
    if (enviandoRef.current) return
    if (isDemoMode) {
      setError('Estás en modo demostración: cobrar no está disponible sobre datos de ejemplo.')
      return
    }
    enviandoRef.current = true
    setEnviando(true)
    setError(null)
    try {
      let idAtencion = atencionIdRef.current
      if (!idAtencion) {
        const { id } = await registrarAtencion({
          clienteId: cliente!.id,
          reservaId: reservaIdParam,
          lineas: lineas
            .filter((l) => !lineaIncompleta(l))
            .map((l) => ({
              servicioId: l.servicioId,
              profesionalId: l.profesionalId,
              precioSnapshot: l.precio ?? 0,
              esColaboracion: l.esColaboracion,
            })),
          productos: productos.map((p) => ({ categoria: p.categoria, nombre: p.nombre, cantidad: p.cantidad, precioUnitario: p.precioUnitario ?? 0 })),
          notas: notas.trim() || null,
          borradorKey,
        })
        idAtencion = id
        atencionIdRef.current = id
      }
      await completarYCobrarAtencion({ atencionId: idAtencion, pagos: [{ metodo: metodoPago, monto: total }], idempotencyKey: claveCobro })
      setPaso('listo')
    } catch (e: any) {
      setError(e.message)
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  if (paso === 'listo') {
    return (
      <div className="mx-auto max-w-md">
        <Card className="flex flex-col items-center gap-3 text-center">
          <p className="text-3xl">✓</p>
          <p className="font-semibold text-carbon">Servicio registrado y cobrado</p>
          <p className="text-sm text-carbon/60">El historial del cliente, tus ventas, tu comisión y sus puntos ya se actualizaron.</p>
          <Button onClick={() => navigate(rutaFinalizar)}>{etiquetaFinalizar}</Button>
        </Card>
      </div>
    )
  }

  if (paso === 'cobrar') {
    const lineasCompletas = lineas.filter((l) => !lineaIncompleta(l))
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-marca text-2xl font-semibold text-carbon">Cobrar</h1>
            <button onClick={() => setPaso('registrar')} className="text-sm font-semibold text-oliva underline underline-offset-2">
              ← Volver a editar
            </button>
          </div>
          <Stepper paso="cobrar" />
        </div>

        {error && <ErrorState mensaje={error} reintentar={confirmarCobro} />}

        <Card className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-carbon/50">Cliente</p>
          <p className="font-semibold text-carbon">{cliente?.nombre}</p>
          {cliente?.telefono && <p className="text-sm text-carbon/60">{cliente.telefono}</p>}
        </Card>

        <Card className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-wide text-carbon/50">Servicios</p>
          {lineasCompletas.map((l) => (
            <div key={l.tempId} className="flex items-center justify-between border-b border-piedra/60 pb-3 last:border-0 last:pb-0">
              <div>
                <p className="font-medium text-carbon">
                  {l.nombre}
                  {l.esColaboracion && (
                    <span className="ml-2 rounded-full bg-champan/30 px-2 py-0.5 text-xs font-semibold text-carbon/70">Colaboración</span>
                  )}
                </p>
                <p className="text-xs text-carbon/60">{equipo.find((p) => p.id === l.profesionalId)?.nombre ?? '—'}</p>
                <VistaPreviaComision linea={l} />
              </div>
              <span className="font-semibold text-carbon">{formatoMoneda(l.precio)}</span>
            </div>
          ))}
        </Card>

        {productos.length > 0 && (
          <Card className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-wide text-carbon/50">Productos</p>
            {productos.map((p) => (
              <div key={p.tempId} className="flex items-center justify-between text-sm">
                <span className="text-carbon">{p.nombre} <span className="text-carbon/50">· {p.categoria} · x{p.cantidad}</span></span>
                <span className="font-medium text-carbon">{formatoMoneda(p.cantidad * (p.precioUnitario ?? 0))}</span>
              </div>
            ))}
          </Card>
        )}

        {notas.trim() && (
          <Card className="flex flex-col gap-1 bg-champan/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Nota interna (no aparece en el comprobante de la clienta)</p>
            <p className="text-sm text-carbon/80">{notas}</p>
          </Card>
        )}

        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-sm text-carbon/60">
            <span>Subtotal servicios</span>
            <span>{formatoMoneda(subtotalServicios)}</span>
          </div>
          {subtotalProductos > 0 && (
            <div className="flex items-center justify-between text-sm text-carbon/60">
              <span>Subtotal productos</span>
              <span>{formatoMoneda(subtotalProductos)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-piedra pt-2 text-base font-semibold text-carbon">
            <span>Total a cobrar</span>
            <span className="text-oliva">{formatoMoneda(total)}</span>
          </div>
          <Select id="metodo" etiqueta="Método de pago" value={metodoPago} onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </Select>
          <Button onClick={confirmarCobro} cargando={enviando} tamano="lg">Confirmar cobro</Button>
        </Card>
      </div>
    )
  }

  const serviciosContados = lineas.filter((l) => l.servicioId && !l.colaboracionDe).length

  if (cargandoReserva) {
    return (
      <div className="mx-auto max-w-5xl">
        <Cargando filas={4} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl pb-40 md:pb-24 lg:pb-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-marca text-2xl font-semibold text-carbon">Registrar atención</h1>
          <p className="text-sm text-carbon/60">
            {citaOrigen
              ? `Cita de las ${formatoHora(citaOrigen.inicio)} del ${formatoFecha(citaOrigen.inicio)}${citaOrigen.servicioNombre ? ` · ${citaOrigen.servicioNombre}` : ''}`
              : 'Añade los servicios y productos de esta visita.'}
          </p>
        </div>
        <Stepper paso="registrar" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {errores.length > 0 && (
            <div className="rounded-2xl border border-error/30 bg-error/5 p-4">
              <p className="mb-1 text-sm font-semibold text-error">Antes de continuar, revisa esto:</p>
              <ul className="list-inside list-disc text-sm text-error">
                {errores.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <PasoBadge numero={1} />
              <p className="font-semibold text-carbon">Paso 1 · Cliente</p>
            </div>
            <ClienteSeccion cliente={cliente} onSeleccionar={setCliente} onCambiar={() => setCliente(null)} />
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <PasoBadge numero={2} />
              <p className="font-semibold text-carbon">Paso 2 · Servicios</p>
              {serviciosContados > 0 && (
                <span className="rounded-full bg-piedra/50 px-2 py-0.5 text-xs font-semibold text-carbon/60">
                  {serviciosContados} servicio{serviciosContados !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {cargandoCatalogo ? (
              <Cargando filas={1} />
            ) : (
              lineas
                .filter((l) => !l.colaboracionDe)
                .map((l, i) => (
                  <ServicioTarjeta
                    key={l.tempId}
                    numero={i + 1}
                    linea={l}
                    colaboradores={lineas.filter((c) => c.colaboracionDe === l.tempId)}
                    servicios={servicios}
                    equipo={equipo}
                    mostrarErrorPrecio={intentoContinuar && (l.precio == null || l.precio < 0)}
                    onCambiar={(cambios) => actualizarLinea(l.tempId, cambios)}
                    onQuitar={() => quitarLinea(l.tempId)}
                    onAgregarColaboracion={agregarLinea}
                    onQuitarColaboracion={quitarLinea}
                  />
                ))
            )}
            <button
              onClick={() => agregarLinea(lineaVacia(profesional?.id ?? ''))}
              className="rounded-xl border border-dashed border-piedra py-3 text-center text-sm font-semibold text-oliva hover:border-oliva hover:bg-oliva/5"
            >
              + Añadir otro servicio
            </button>
          </Card>

          <Card className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5"><PasoBadge numero={3} /></span>
                <div>
                  <p className="font-semibold text-carbon">Paso 3 · Productos <span className="font-normal text-carbon/50">· Opcional</span></p>
                  <p className="text-xs text-carbon/50">Incluye los productos vendidos en esta visita.</p>
                </div>
              </div>
              <button onClick={() => setProductos((prev) => [...prev, { tempId: idTemporal(), categoria: '', nombre: '', cantidad: 1, precioUnitario: null }])} className="text-sm font-semibold text-oliva hover:underline">
                + Añadir producto
              </button>
            </div>
            {productos.map((p) => (
              <ProductoFila key={p.tempId} producto={p} onCambiar={(c) => actualizarProducto(p.tempId, c)} onQuitar={() => quitarProducto(p.tempId)} />
            ))}
          </Card>

          <Card>
            <button onClick={() => setNotasAbiertas((v) => !v)} className="flex w-full items-center justify-between text-left">
              <span className="flex items-center gap-2">
                <PasoBadge numero={4} />
                <span className="font-semibold text-carbon">Paso 4 · Nota adicional <span className="font-normal text-carbon/50">· Opcional</span></span>
              </span>
              <span className="text-carbon/50">{notasAbiertas ? '−' : '+'}</span>
            </button>
            {notasAbiertas && (
              <div className="mt-3">
                <Textarea
                  id="notas"
                  etiqueta=""
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Tratamiento realizado, observaciones y recomendaciones para la próxima visita"
                  ayuda="Es interna: no aparece en el comprobante de la clienta ni genera recordatorios."
                />
              </div>
            )}
          </Card>
        </div>

        {/* Resumen lateral fijo en escritorio */}
        <div className="hidden lg:block">
          <div className="sticky top-4">
            <ResumenLateral lineas={lineas} subtotalServicios={subtotalServicios} subtotalProductos={subtotalProductos} total={total} onContinuar={irACobrar} />
          </div>
        </div>
      </div>

      {/* Barra inferior en móvil. Se apoya justo encima de la navegación inferior propia del
          portal (fixed, md:hidden en PortalLayout): el offset (72px) es la altura real de esa
          barra, para quedar alineada justo arriba de ella, sin superponerse ni dejar un hueco
          de por medio; de md a lg, esa navegación ya no existe y esta baja a bottom-0. */}
      <div className="fixed inset-x-0 bottom-[72px] z-40 flex items-center justify-between gap-3 border-t border-piedra bg-blanco px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] md:bottom-0 lg:hidden">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Total a cobrar</p>
          <p className="font-marca text-3xl font-semibold leading-tight text-carbon">{formatoMoneda(total)}</p>
        </div>
        <Button onClick={irACobrar} tamano="lg">Continuar al cobro</Button>
      </div>
    </div>
  )
}

function ResumenLateral({
  lineas,
  subtotalServicios,
  subtotalProductos,
  total,
  onContinuar,
}: {
  lineas: LineaServicioBorrador[]
  subtotalServicios: number
  subtotalProductos: number
  total: number
  onContinuar: () => void
}) {
  const completas = lineas.filter((l) => !lineaIncompleta(l))
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <p className="font-marca text-lg font-semibold text-carbon">Resumen de la atención</p>
        <p className="text-xs text-carbon/50">
          {completas.length === 0 ? 'Ningún servicio añadido' : `${completas.length} servicio${completas.length !== 1 ? 's' : ''} añadido${completas.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {completas.length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-piedra pb-3">
          {completas.map((l) => (
            <div key={l.tempId} className="flex items-center justify-between text-sm">
              <span className="text-carbon/80">{l.nombre}</span>
              <span className="font-medium text-carbon">{formatoMoneda(l.precio)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-carbon/60">
        <span>Servicios</span>
        <span>{formatoMoneda(subtotalServicios)}</span>
      </div>
      <div className="flex items-center justify-between text-sm text-carbon/60">
        <span>Productos</span>
        <span>{formatoMoneda(subtotalProductos)}</span>
      </div>

      <div className="rounded-xl bg-marfil px-4 py-3">
        <p className="text-xs text-carbon/50">Total a cobrar</p>
        <p className="font-marca text-2xl font-semibold text-carbon">
          {formatoMoneda(total)} <span className="text-sm font-normal text-carbon/50">COP</span>
        </p>
      </div>

      <Button onClick={onContinuar} tamano="lg">
        Continuar al cobro <span aria-hidden>→</span>
      </Button>
      <p className="text-center text-xs text-carbon/50">Revisa el detalle antes de cobrar.</p>
    </Card>
  )
}

// --- Cliente: buscador con recientes, coincidencias parciales, navegación por teclado y
// estados de carga/sin resultados/error. Tras seleccionar, ficha compacta con "Cambiar".
// "+ Crear cliente" es una acción siempre visible (no depende de escribir una búsqueda
// primero), para que registrar a alguien nuevo sea igual de rápido que buscar a alguien
// existente. ---

function ClienteSeccion({
  cliente,
  onSeleccionar,
  onCambiar,
}: {
  cliente: Cliente | null
  onSeleccionar: (c: Cliente) => void
  onCambiar: () => void
}) {
  const [query, setQuery] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [resultados, setResultados] = useState<Cliente[]>([])
  const [recientes, setRecientes] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoTelefono, setNuevoTelefono] = useState('')
  const [creando, setCreando] = useState(false)
  const [errorCrear, setErrorCrear] = useState<string | null>(null)

  const opciones = query.trim() ? resultados : recientes
  const { indice, setIndice, onKeyDown } = useNavegacionLista(opciones.length)

  useEffect(() => {
    if (!abierto || recientes.length > 0) return
    listarClientesRecientes().then(setRecientes).catch(() => {})
  }, [abierto, recientes.length])

  useEffect(() => {
    if (!query.trim()) {
      setResultados([])
      setError(null)
      return
    }
    setCargando(true)
    setError(null)
    const t = setTimeout(() => {
      buscarClientes(query.trim())
        .then(setResultados)
        .catch((e) => setError(e.message))
        .finally(() => setCargando(false))
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  function seleccionar(c: Cliente) {
    onSeleccionar(c)
    setAbierto(false)
    setQuery('')
    setFormularioAbierto(false)
  }

  async function crearCliente(e: React.FormEvent) {
    e.preventDefault()
    if (!nuevoNombre.trim()) return
    if (isDemoMode) {
      seleccionar({
        id: 'demo-cliente-nuevo', usuario_id: null, nombre: nuevoNombre.trim(), telefono: nuevoTelefono || null, email: null,
        consentimiento_marketing: false, visitas_completadas: 0, gasto_acumulado: 0, activo: true, origen_registro: 'admin',
        notas: null, resena_google_confirmada: false, creado_en: new Date().toISOString(),
      })
      return
    }
    setCreando(true)
    setErrorCrear(null)
    const { data, error: err } = await supabase!
      .from('cliente')
      .insert({ nombre: nuevoNombre.trim(), telefono: nuevoTelefono || null, consentimiento_marketing: false })
      .select()
      .single()
    setCreando(false)
    if (err) { setErrorCrear(err.message); return }
    setNuevoNombre(''); setNuevoTelefono('')
    seleccionar(data)
  }

  if (cliente) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-piedra bg-marfil px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-piedra font-marca text-carbon">
            {cliente.nombre.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-carbon">{cliente.nombre}</p>
            {cliente.telefono && <p className="text-xs text-carbon/60">{cliente.telefono}</p>}
          </div>
        </div>
        <button onClick={onCambiar} className="text-sm font-semibold text-oliva hover:underline">Cambiar</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setAbierto(true) }}
            onFocus={() => setAbierto(true)}
            onBlur={() => setTimeout(() => setAbierto(false), 150)}
            onKeyDown={(e) => onKeyDown(e, (i) => seleccionar(opciones[i]), () => setAbierto(false))}
            placeholder="Buscar por nombre o teléfono"
            aria-label="Buscar cliente por nombre o teléfono"
            role="combobox"
            aria-expanded={abierto}
            className="w-full rounded-lg border border-piedra bg-blanco px-3 py-2.5 text-sm text-carbon outline-none transition-colors focus:border-oliva"
          />
          {abierto && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-piedra bg-blanco shadow-lg">
              {!query.trim() && recientes.length > 0 && (
                <p className="border-b border-piedra/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-carbon/40">Clientes recientes</p>
              )}
              {cargando && <div className="p-3"><Cargando filas={2} /></div>}
              {error && <p className="px-3 py-3 text-sm text-error">{error}</p>}
              {!cargando && !error && opciones.length === 0 && query.trim() && (
                <p className="px-3 py-3 text-sm text-carbon/60">Sin resultados para "{query}".</p>
              )}
              {!cargando && !error && opciones.map((c, i) => (
                <button
                  key={c.id}
                  onMouseDown={() => seleccionar(c)}
                  onMouseEnter={() => setIndice(i)}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm ${i === indice ? 'bg-piedra/40' : ''}`}
                >
                  <span className="font-medium text-carbon">{c.nombre}</span>
                  {c.telefono && <span className="text-xs text-carbon/60">{c.telefono}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"
          variante="secondary"
          tamano="md"
          onClick={() => setFormularioAbierto((v) => !v)}
        >
          + Crear cliente
        </Button>
      </div>

      {formularioAbierto && (
        <form onSubmit={crearCliente} className="flex flex-col gap-3 rounded-lg border border-piedra bg-marfil p-3 sm:flex-row sm:items-end">
          {errorCrear && <div className="sm:basis-full"><ErrorState mensaje={errorCrear} /></div>}
          <div className="flex-1">
            <Input id="nuevoClienteNombre" etiqueta="Nombre" required value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
          </div>
          <div className="sm:w-40">
            <Input id="nuevoClienteTelefono" etiqueta="Teléfono (opcional)" value={nuevoTelefono} onChange={(e) => setNuevoTelefono(e.target.value)} />
          </div>
          <Button type="submit" cargando={creando}>Crear</Button>
        </form>
      )}
    </div>
  )
}

// Vista previa discreta de comisión y ganancia estimada (usada en el paso de registrar y en
// el de cobrar, para que ambos reflejen la regla vigente en cada momento). Mismos permisos que
// ya usa la RLS de regla_comision (admin, o la propia profesional viendo su propia línea) —
// nadie ve la comisión de una compañera desde aquí. Es solo una estimación (ver
// lib/api/comisiones.ts); el servidor la vuelve a calcular al confirmar el cobro, así que
// nunca se muestra como ganancia definitiva.
function VistaPreviaComision({ linea }: { linea: LineaServicioBorrador }) {
  const { perfil, profesional: miProfesional } = useAuth()
  const puedeVerComision = perfil?.rol === 'admin' || (!!miProfesional && linea.profesionalId === miProfesional.id)
  const [estimacion, setEstimacion] = useState<EstimacionComision | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!puedeVerComision || linea.esColaboracion || !linea.servicioId || !linea.profesionalId || linea.precio == null || linea.precio <= 0) {
      setEstimacion(null)
      setCargando(false)
      return
    }
    let activo = true
    setCargando(true)
    estimarComision(linea.profesionalId, linea.servicioId, linea.precio).then((r) => {
      if (activo) { setEstimacion(r); setCargando(false) }
    })
    return () => { activo = false }
  }, [puedeVerComision, linea.esColaboracion, linea.servicioId, linea.profesionalId, linea.precio])

  const mostrar = puedeVerComision && !linea.esColaboracion && !!linea.servicioId && !!linea.profesionalId && linea.precio != null && linea.precio > 0 && !cargando
  if (!mostrar) return null

  return (
    <p className="mt-2 text-xs text-carbon/50">
      {estimacion?.encontrada
        ? `Comisión ${estimacion.origen === 'excepcion' ? 'especial' : 'base'}: ${
            estimacion.tipo === 'porcentaje' ? `${estimacion.valor}%` : formatoMoneda(estimacion.valor ?? 0)
          } · Ganancia estimada: ${formatoMoneda(estimacion.comisionEstimada ?? 0)}`
        : 'Configura la comisión de esta profesional para ver una estimación de ganancia (Equipo → Editar perfil y servicios).'}
    </p>
  )
}

// --- Servicio: selector con búsqueda (filtra el catálogo ya cargado), profesional
// responsable, precio editable. "+ Añadir colaborador" crea una línea de servicio HERMANA
// (no anidada): se suma al total y su valor es la ganancia completa de esa persona. ---

function ServicioTarjeta({
  numero,
  linea,
  colaboradores,
  servicios,
  equipo,
  mostrarErrorPrecio,
  onCambiar,
  onQuitar,
  onAgregarColaboracion,
  onQuitarColaboracion,
}: {
  numero: number
  linea: LineaServicioBorrador
  colaboradores: LineaServicioBorrador[]
  servicios: Servicio[]
  equipo: Profesional[]
  mostrarErrorPrecio: boolean
  onCambiar: (cambios: Partial<LineaServicioBorrador>) => void
  onQuitar?: () => void
  onAgregarColaboracion: (nueva: LineaServicioBorrador) => void
  onQuitarColaboracion: (tempId: string) => void
}) {
  // Siempre el equipo completo: restringir a quienes tiene asignado el servicio en el
  // catálogo (servicio_profesional) bloqueaba elegir a alguien que sí lo hizo en la práctica
  // pero no estaba configurada para ese servicio — el mismo problema de fondo que se corrigió
  // en fn_registrar_atencion (0021) para el lado del servidor.
  const opcionesProfesional = equipo

  function elegirServicio(s: Servicio) {
    onCambiar({
      servicioId: s.id,
      nombre: s.nombre,
      // Si el servicio no tiene precio configurado (a_valorar), el campo queda vacío en vez
      // de forzar un 0 o conservar lo que hubiera antes.
      precio: s.precio ?? null,
      profesionalId: linea.profesionalId || opcionesProfesional[0]?.id || '',
    })
  }

  const [formAbierto, setFormAbierto] = useState(false)
  const [errorColaboracion, setErrorColaboracion] = useState<string | null>(null)
  const [colaboradorId, setColaboradorId] = useState('')
  const [participacion, setParticipacion] = useState('')
  const [valorColaboracion, setValorColaboracion] = useState<number | null>(null)

  function agregarColaboracion() {
    if (colaboradores.length >= MAX_COLABORADORES_POR_SERVICIO) {
      setErrorColaboracion(`Ya tiene el máximo de ${MAX_COLABORADORES_POR_SERVICIO} colaboradores.`)
      return
    }
    if (!colaboradorId) { setErrorColaboracion('Selecciona un colaborador.'); return }
    if (colaboradorId === linea.profesionalId) { setErrorColaboracion('El profesional responsable no puede ser su propio colaborador.'); return }
    if (colaboradores.some((c) => c.profesionalId === colaboradorId)) { setErrorColaboracion('Ese colaborador ya está agregado en este servicio.'); return }
    if (valorColaboracion == null || valorColaboracion <= 0) { setErrorColaboracion('Ingresa un valor mayor a cero.'); return }
    const nombreColaborador = equipo.find((p) => p.id === colaboradorId)?.nombre ?? '—'
    const nombreBase = linea.nombre || 'Servicio'
    onAgregarColaboracion({
      tempId: idTemporal(),
      servicioId: linea.servicioId,
      nombre: participacion ? `${nombreBase} · ${participacion} (${nombreColaborador})` : `${nombreBase} (colaboración de ${nombreColaborador})`,
      profesionalId: colaboradorId,
      precio: valorColaboracion,
      esColaboracion: true,
      colaboracionDe: linea.tempId,
    })
    setColaboradorId(''); setParticipacion(''); setValorColaboracion(null); setErrorColaboracion(null); setFormAbierto(false)
  }

  return (
    <div className="rounded-xl border border-piedra p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-piedra/40 text-lg" aria-hidden>✂️</div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-carbon/40">Servicio {numero}</p>
            <p className="text-sm text-carbon/60">{linea.nombre ? 'Servicio seleccionado' : 'Elige un servicio'}</p>
          </div>
        </div>
        {onQuitar && (
          <button onClick={onQuitar} aria-label="Quitar servicio" className="rounded-lg p-1.5 text-carbon/40 hover:bg-error/10 hover:text-error">
            🗑
          </button>
        )}
      </div>
      {/* alinearAltura en los tres campos: reserva la misma altura de etiqueta (hasta 2
          líneas) para que "Profesional responsable" (la más larga, la única que a veces se
          parte en dos líneas) no desplace su control hacia abajo respecto a Servicio/Precio.
          Precio cobrado recibe algo más de ancho que sus dos vecinos: el prefijo "$" y el
          sufijo "COP" fijos le restan espacio útil al número frente a un input normal. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.05fr_1.3fr]">
        <ServicioBuscador id={`servicio-${linea.tempId}`} servicios={servicios} valor={linea.nombre} onSeleccionar={elegirServicio} />
        <Select
          id={`prof-${linea.tempId}`}
          etiqueta="Profesional"
          alinearAltura
          value={linea.profesionalId}
          onChange={(e) => onCambiar({ profesionalId: e.target.value })}
        >
          <option value="">Elegir…</option>
          {opcionesProfesional.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Select>
        <CampoMoneda
          id={`precio-${linea.tempId}`}
          etiqueta="Precio cobrado"
          alinearAltura
          value={linea.precio}
          onChange={(v) => onCambiar({ precio: v })}
          error={mostrarErrorPrecio ? 'Ingresa el precio cobrado' : undefined}
        />
      </div>

      <VistaPreviaComision linea={linea} />

      {colaboradores.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {colaboradores.map((c) => {
            const nombreColaborador = equipo.find((p) => p.id === c.profesionalId)?.nombre ?? '—'
            return (
              <div key={c.tempId} className="flex items-center justify-between gap-2 rounded-lg bg-marfil px-3 py-2 text-sm">
                <span className="text-carbon">{nombreColaborador}</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-carbon">{formatoMoneda(c.precio ?? 0)}</span>
                  <button
                    onClick={() => onQuitarColaboracion(c.tempId)}
                    aria-label={`Quitar a ${nombreColaborador} de este servicio`}
                    className="rounded p-1 text-carbon/40 hover:bg-error/10 hover:text-error"
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {colaboradores.length >= MAX_COLABORADORES_POR_SERVICIO ? (
        <p className="mt-3 text-xs text-carbon/50">Máximo de {MAX_COLABORADORES_POR_SERVICIO} colaboradores por servicio.</p>
      ) : formAbierto ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-piedra bg-marfil p-3">
          {errorColaboracion && <p className="text-xs font-medium text-error">{errorColaboracion}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select id={`colab-${linea.tempId}-${colaboradores.length}`} etiqueta="Colaborador" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
              <option value="">Elegir…</option>
              {equipo
                .filter((p) => p.id !== linea.profesionalId && !colaboradores.some((c) => c.profesionalId === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
            </Select>
            <Input id={`part-${linea.tempId}-${colaboradores.length}`} etiqueta="Participación" placeholder="Apoyo en peinado" value={participacion} onChange={(e) => setParticipacion(e.target.value)} />
            <CampoMoneda id={`valorcolab-${linea.tempId}-${colaboradores.length}`} etiqueta="Valor asignado" value={valorColaboracion} onChange={setValorColaboracion} />
          </div>
          <p className="text-xs text-carbon/50">
            Se suma al total a cobrar y se registra como una línea de servicio nueva: ese valor queda como el 100%
            de la ganancia del colaborador, sin aplicarle ninguna comisión adicional.
          </p>
          <div className="flex gap-2">
            <Button tamano="sm" onClick={agregarColaboracion}>Añadir colaborador</Button>
            <Button tamano="sm" variante="ghost" onClick={() => { setFormAbierto(false); setErrorColaboracion(null) }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button type="button" variante="outline" tamano="sm" onClick={() => setFormAbierto(true)} className="mt-3 self-start">
          + {colaboradores.length > 0 ? 'Añadir otro colaborador' : 'Añadir colaborador'}
        </Button>
      )}
    </div>
  )
}

function ServicioBuscador({ id, servicios, valor, onSeleccionar }: { id: string; servicios: Servicio[]; valor: string; onSeleccionar: (s: Servicio) => void }) {
  const [query, setQuery] = useState(valor)
  const [abierto, setAbierto] = useState(false)
  useEffect(() => setQuery(valor), [valor])

  const filtrados = query.trim()
    ? servicios.filter((s) => s.nombre.toLowerCase().includes(query.trim().toLowerCase()))
    : servicios
  const { indice, setIndice, onKeyDown } = useNavegacionLista(filtrados.length)

  function elegir(s: Servicio) {
    onSeleccionar(s)
    setQuery(s.nombre)
    setAbierto(false)
  }

  return (
    <CampoBase etiqueta="Servicio" id={id} alinearAltura>
      <div className="relative">
        <input
          id={id}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setAbierto(true) }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => onKeyDown(e, (i) => elegir(filtrados[i]), () => setAbierto(false))}
          placeholder="Buscar servicio…"
          role="combobox"
          aria-expanded={abierto}
          className="w-full rounded-lg border border-piedra bg-blanco px-3 py-2.5 text-sm text-carbon outline-none transition-colors focus:border-oliva"
        />
        {abierto && (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-piedra bg-blanco shadow-lg">
            {filtrados.length === 0 && <p className="px-3 py-3 text-sm text-carbon/60">Sin resultados.</p>}
            {filtrados.map((s, i) => (
              <button
                key={s.id}
                onMouseDown={() => elegir(s)}
                onMouseEnter={() => setIndice(i)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === indice ? 'bg-piedra/40' : ''}`}
              >
                <span className="text-carbon">{s.nombre}</span>
                {s.precio != null && <span className="text-xs text-carbon/50">{formatoMoneda(s.precio)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </CampoBase>
  )
}

const CATEGORIAS_PRODUCTO_SUGERIDAS = ['Tinte', 'Champú', 'Acondicionador', 'Tratamiento']

function ProductoFila({
  producto,
  onCambiar,
  onQuitar,
}: {
  producto: LineaProductoBorrador
  onCambiar: (cambios: Partial<LineaProductoBorrador>) => void
  onQuitar: () => void
}) {
  const subtotal = producto.cantidad * (producto.precioUnitario ?? 0)
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-piedra p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-carbon">Categoría</label>
          <input
            list="categorias-producto"
            value={producto.categoria}
            onChange={(e) => onCambiar({ categoria: e.target.value })}
            placeholder="Tinte, champú, acondicionador…"
            className="w-full rounded-lg border border-piedra bg-blanco px-3 py-2.5 text-sm text-carbon outline-none focus:border-oliva"
          />
          <datalist id="categorias-producto">
            {CATEGORIAS_PRODUCTO_SUGERIDAS.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <Input
          id={`prod-nombre-${producto.tempId}`}
          etiqueta="Marca (opcional)"
          placeholder="Ej. L'Oréal"
          value={producto.nombre}
          onChange={(e) => onCambiar({ nombre: e.target.value })}
        />
      </div>
      {/* Precio unitario recibe más ancho que Cantidad/Subtotal: el prefijo "$" y el sufijo
          "COP" fijos le restan espacio útil al número frente a un input normal. */}
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[0.7fr_1.3fr_1fr_auto]">
        <Input id={`prod-cant-${producto.tempId}`} etiqueta="Cantidad" type="number" min={1} value={producto.cantidad} onChange={(e) => onCambiar({ cantidad: Number(e.target.value) })} />
        <CampoMoneda id={`prod-precio-${producto.tempId}`} etiqueta="Precio unitario" value={producto.precioUnitario} onChange={(v) => onCambiar({ precioUnitario: v })} />
        <div className="text-right">
          <p className="text-xs text-carbon/50">Subtotal</p>
          <p className="font-semibold text-carbon">{formatoMoneda(subtotal)}</p>
        </div>
        <button onClick={onQuitar} aria-label="Quitar producto" className="justify-self-end text-sm text-error hover:underline">Quitar</button>
      </div>
    </div>
  )
}
