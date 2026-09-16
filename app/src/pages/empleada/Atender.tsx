import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { CampoBase, CampoMoneda, Input, Select, Textarea } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { isDemoMode, supabase } from '../../lib/supabase'
import { listarProfesionales, listarServicios } from '../../lib/api/catalogo'
import { buscarClientes, completarYCobrarAtencion, listarClientesRecientes, registrarAtencion } from '../../lib/api/empleada'
import { formatoMoneda } from '../../lib/format'
import type { Cliente, MetodoPago, Profesional, Servicio } from '../../lib/types'

// --- Tipos del borrador (solo viven en el navegador hasta el clic final en "Confirmar
// cobro"; ver fn_registrar_atencion en supabase/migrations/0018_atender_avanzado.sql para
// la validación de negocio que se repite aquí en el cliente como primera línea de defensa). ---

interface ColaboradorBorrador {
  tempId: string
  colaboradorId: string
  colaboradorNombre: string
  participacion: string
  valor: number
}

interface LineaServicioBorrador {
  tempId: string
  servicioId: string
  nombre: string
  profesionalId: string
  // null = campo vacío (nunca "0" forzado); distinto de un 0 explícito para un servicio
  // cortesía. Ver docs/03-flujos.md y components/ui/Campos.tsx → CampoMoneda.
  precio: number | null
  colaboradores: ColaboradorBorrador[]
  colaboradorFormAbierto: boolean
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
  return { tempId: idTemporal(), servicioId: '', nombre: '', profesionalId: profesionalPorDefecto, precio: null, colaboradores: [], colaboradorFormAbierto: false }
}

function lineaIncompleta(l: LineaServicioBorrador) {
  return !l.servicioId || !l.profesionalId || l.precio == null || l.precio < 0
}

function productoIncompleto(p: LineaProductoBorrador) {
  return !p.categoria.trim() || !p.nombre.trim() || p.cantidad <= 0 || p.precioUnitario == null || p.precioUnitario < 0
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

export function EmpleadaAtender() {
  const navigate = useNavigate()
  const { profesional } = useAuth()

  const [servicios, setServicios] = useState<Servicio[]>([])
  const [equipo, setEquipo] = useState<Profesional[]>([])
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true)

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
    lineas.forEach((l, i) => {
      if (l.colaboradorFormAbierto) nuevosErrores.push(`Termina o cancela el colaborador que estás agregando en el servicio ${i + 1}.`)
    })
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
          reservaId: null,
          lineas: lineas
            .filter((l) => !lineaIncompleta(l))
            .map((l) => ({
              servicioId: l.servicioId,
              profesionalId: l.profesionalId,
              precioSnapshot: l.precio ?? 0,
              colaboradores: l.colaboradores.map((c) => ({ colaboradorId: c.colaboradorId, participacion: c.participacion, valor: c.valor })),
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
          <Button onClick={() => navigate('/equipo-app')}>Volver a Mi día</Button>
        </Card>
      </div>
    )
  }

  if (paso === 'cobrar') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="font-marca text-2xl font-semibold text-carbon">Cobrar</h1>
          <button onClick={() => setPaso('registrar')} className="text-sm font-semibold text-oliva underline underline-offset-2">
            ← Volver a editar
          </button>
        </div>

        {error && <ErrorState mensaje={error} reintentar={confirmarCobro} />}

        <Card className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-carbon/50">Cliente</p>
          <p className="font-semibold text-carbon">{cliente?.nombre}</p>
          {cliente?.telefono && <p className="text-sm text-carbon/60">{cliente.telefono}</p>}
        </Card>

        <Card className="flex flex-col gap-4">
          <p className="text-xs uppercase tracking-wide text-carbon/50">Servicios</p>
          {lineas.filter((l) => !lineaIncompleta(l)).map((l) => (
            <div key={l.tempId} className="flex flex-col gap-2 border-b border-piedra/60 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-carbon">{l.nombre}</p>
                  <p className="text-xs text-carbon/60">{equipo.find((p) => p.id === l.profesionalId)?.nombre ?? '—'}</p>
                </div>
                <span className="font-semibold text-carbon">{formatoMoneda(l.precio)}</span>
              </div>
              {l.colaboradores.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg bg-champan/15 px-3 py-2">
                  <p className="text-xs font-semibold text-carbon/60">Distribución interna (no se suma a la cuenta)</p>
                  {l.colaboradores.map((c) => (
                    <div key={c.tempId} className="flex items-center justify-between text-xs text-carbon/70">
                      <span>{c.colaboradorNombre}{c.participacion ? ` · ${c.participacion}` : ''}</span>
                      <span>{formatoMoneda(c.valor)}</span>
                    </div>
                  ))}
                </div>
              )}
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

  return (
    <div className="mx-auto max-w-5xl pb-40 md:pb-24 lg:pb-6">
      <h1 className="mb-4 font-marca text-2xl font-semibold text-carbon">Registrar atención</h1>

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
            <p className="mb-3 font-semibold text-carbon">Cliente</p>
            <ClienteSeccion cliente={cliente} onSeleccionar={setCliente} onCambiar={() => setCliente(null)} />
          </Card>

          <Card className="flex flex-col gap-4">
            <p className="font-semibold text-carbon">Servicios</p>
            {cargandoCatalogo ? (
              <Cargando filas={1} />
            ) : (
              lineas.map((l, i) => (
                <ServicioTarjeta
                  key={l.tempId}
                  numero={i + 1}
                  linea={l}
                  servicios={servicios}
                  equipo={equipo}
                  mostrarErrorPrecio={intentoContinuar && (l.precio == null || l.precio < 0)}
                  onCambiar={(cambios) => actualizarLinea(l.tempId, cambios)}
                  onQuitar={lineas.length > 1 ? () => quitarLinea(l.tempId) : undefined}
                />
              ))
            )}
            <button
              onClick={() => setLineas((prev) => [...prev, lineaVacia(profesional?.id ?? '')])}
              className="self-start text-sm font-semibold text-oliva hover:underline"
            >
              + Añadir servicio
            </button>
          </Card>

          <Card className="flex flex-col gap-3">
            <p className="font-semibold text-carbon">Productos <span className="font-normal text-carbon/50">· opcional</span></p>
            {productos.map((p) => (
              <ProductoFila key={p.tempId} producto={p} onCambiar={(c) => actualizarProducto(p.tempId, c)} onQuitar={() => quitarProducto(p.tempId)} />
            ))}
            <button
              onClick={() => setProductos((prev) => [...prev, { tempId: idTemporal(), categoria: '', nombre: '', cantidad: 1, precioUnitario: null }])}
              className="self-start text-sm font-semibold text-oliva hover:underline"
            >
              + Añadir producto
            </button>
          </Card>

          <Card>
            <button onClick={() => setNotasAbiertas((v) => !v)} className="flex w-full items-center justify-between text-left">
              <span className="font-semibold text-carbon">Añadir nota operativa <span className="font-normal text-carbon/50">· Opcional</span></span>
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
            <ResumenLateral subtotalServicios={subtotalServicios} subtotalProductos={subtotalProductos} total={total} onContinuar={irACobrar} />
          </div>
        </div>
      </div>

      {/* Barra inferior en móvil. Se apoya sobre la navegación inferior propia del portal
          (fixed, md:hidden en PortalLayout): por debajo de md ambas conviven apiladas
          (bottom-14 dejando el espacio de esa barra libre); de md a lg, esa navegación ya no
          existe y esta baja a bottom-0. */}
      <div className="fixed inset-x-0 bottom-14 z-40 flex items-center justify-between gap-3 border-t border-piedra bg-blanco px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] md:bottom-0 lg:hidden">
        <div>
          <p className="text-xs text-carbon/50">Total a cobrar</p>
          <p className="font-marca text-lg font-semibold text-carbon">{formatoMoneda(total)}</p>
        </div>
        <Button onClick={irACobrar} tamano="lg">Continuar al cobro</Button>
      </div>
    </div>
  )
}

function ResumenLateral({
  subtotalServicios,
  subtotalProductos,
  total,
  onContinuar,
}: {
  subtotalServicios: number
  subtotalProductos: number
  total: number
  onContinuar: () => void
}) {
  return (
    <Card className="flex flex-col gap-3">
      <p className="font-semibold text-carbon">Resumen</p>
      <div className="flex items-center justify-between text-sm text-carbon/60">
        <span>Subtotal de servicios</span>
        <span>{formatoMoneda(subtotalServicios)}</span>
      </div>
      <div className="flex items-center justify-between text-sm text-carbon/60">
        <span>Subtotal de productos</span>
        <span>{formatoMoneda(subtotalProductos)}</span>
      </div>
      <div className="flex items-center justify-between border-t border-piedra pt-2 text-base font-semibold text-carbon">
        <span>Total a cobrar</span>
        <span className="text-oliva">{formatoMoneda(total)}</span>
      </div>
      <Button onClick={onContinuar} tamano="lg">Continuar al cobro</Button>
    </Card>
  )
}

// --- Cliente: buscador con recientes, coincidencias parciales, navegación por teclado y
// estados de carga/sin resultados/error. Tras seleccionar, ficha compacta con "Cambiar". ---

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
  const [creandoNombre, setCreandoNombre] = useState('')
  const [creandoTelefono, setCreandoTelefono] = useState('')
  const [creando, setCreando] = useState(false)

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
  }

  if (cliente) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-piedra bg-marfil px-4 py-3">
        <div>
          <p className="font-medium text-carbon">{cliente.nombre}</p>
          {cliente.telefono && <p className="text-xs text-carbon/60">{cliente.telefono}</p>}
        </div>
        <button onClick={onCambiar} className="text-sm font-semibold text-oliva hover:underline">Cambiar</button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setAbierto(true) }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => onKeyDown(e, (i) => seleccionar(opciones[i]), () => setAbierto(false))}
        placeholder="Buscar cliente por nombre o teléfono"
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
          {!cargando && query.trim() && (
            <div className="border-t border-piedra/60 p-3">
              <p className="mb-2 text-xs text-carbon/60">¿No existe? Crea un registro básico (sin cuenta ni marketing):</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={creandoNombre || query}
                  onChange={(e) => setCreandoNombre(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder="Nombre"
                  className="flex-1 rounded-lg border border-piedra px-2 py-1.5 text-sm"
                />
                <input
                  value={creandoTelefono}
                  onChange={(e) => setCreandoTelefono(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder="Teléfono (opcional)"
                  className="w-32 rounded-lg border border-piedra px-2 py-1.5 text-sm"
                />
                <Button
                  tamano="sm"
                  disabled={creando}
                  onMouseDown={async (e) => {
                    e.preventDefault()
                    const nombre = (creandoNombre || query).trim()
                    if (!nombre) return
                    if (isDemoMode) {
                      seleccionar({ id: 'demo-cliente-nuevo', usuario_id: null, nombre, telefono: creandoTelefono || null, email: null, consentimiento_marketing: false, visitas_completadas: 0, gasto_acumulado: 0 })
                      return
                    }
                    setCreando(true)
                    setError(null)
                    const { data, error: err } = await supabase!
                      .from('cliente')
                      .insert({ nombre, telefono: creandoTelefono || null, consentimiento_marketing: false })
                      .select()
                      .single()
                    setCreando(false)
                    if (err) { setError(err.message); return }
                    seleccionar(data)
                  }}
                >
                  Crear
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- Servicio: selector con búsqueda (filtra el catálogo ya cargado), profesional
// responsable, precio editable y, dentro de la misma tarjeta, colaboradores opcionales. ---

function ServicioTarjeta({
  numero,
  linea,
  servicios,
  equipo,
  mostrarErrorPrecio,
  onCambiar,
  onQuitar,
}: {
  numero: number
  linea: LineaServicioBorrador
  servicios: Servicio[]
  equipo: Profesional[]
  mostrarErrorPrecio: boolean
  onCambiar: (cambios: Partial<LineaServicioBorrador>) => void
  onQuitar?: () => void
}) {
  const servicioSeleccionado = servicios.find((s) => s.id === linea.servicioId)
  const opcionesProfesional = servicioSeleccionado?.profesionales?.length ? servicioSeleccionado.profesionales : equipo

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

  const sumaColaboradores = linea.colaboradores.reduce((acc, c) => acc + c.valor, 0)
  const [errorColaborador, setErrorColaborador] = useState<string | null>(null)
  const [colaboradorId, setColaboradorId] = useState('')
  const [participacion, setParticipacion] = useState('')
  const [valorColaborador, setValorColaborador] = useState<number | null>(null)

  function agregarColaborador() {
    if (!colaboradorId) { setErrorColaborador('Selecciona un colaborador.'); return }
    if (colaboradorId === linea.profesionalId) { setErrorColaborador('El profesional responsable no puede ser su propio colaborador.'); return }
    if (linea.colaboradores.some((c) => c.colaboradorId === colaboradorId)) { setErrorColaborador('Ese colaborador ya está agregado en este servicio.'); return }
    if (valorColaborador == null || valorColaborador <= 0) { setErrorColaborador('Ingresa un valor mayor a cero.'); return }
    if (sumaColaboradores + valorColaborador > (linea.precio ?? 0)) { setErrorColaborador('La suma de los colaboradores no puede superar el precio del servicio.'); return }
    const nombre = equipo.find((p) => p.id === colaboradorId)?.nombre ?? '—'
    onCambiar({ colaboradores: [...linea.colaboradores, { tempId: idTemporal(), colaboradorId, colaboradorNombre: nombre, participacion, valor: valorColaborador }], colaboradorFormAbierto: false })
    setColaboradorId(''); setParticipacion(''); setValorColaborador(null); setErrorColaborador(null)
  }

  return (
    <div className="rounded-xl border border-piedra p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/40">Servicio {numero}</p>
        {onQuitar && <button onClick={onQuitar} aria-label="Quitar servicio" className="text-sm text-error hover:underline">Quitar</button>}
      </div>
      {/* alinearAltura en los tres campos: reserva la misma altura de etiqueta (hasta 2
          líneas) para que "Profesional responsable" (la más larga, la única que a veces se
          parte en dos líneas) no desplace su control hacia abajo respecto a Servicio/Precio. */}
      {/* Precio cobrado recibe algo más de ancho que sus dos vecinos: el prefijo "$" y el
          sufijo "COP" fijos le restan espacio útil al número frente a un input normal. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.05fr_1.3fr]">
        <ServicioBuscador id={`servicio-${linea.tempId}`} servicios={servicios} valor={linea.nombre} onSeleccionar={elegirServicio} />
        <Select
          id={`prof-${linea.tempId}`}
          etiqueta="Profesional responsable"
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

      {linea.colaboradores.map((c) => (
        <div key={c.tempId} className="mt-3 flex items-center justify-between rounded-lg bg-champan/15 px-3 py-2 text-sm">
          <div>
            <span className="font-medium text-carbon">{c.colaboradorNombre}</span>
            {c.participacion && <span className="text-carbon/60"> · {c.participacion}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-carbon/70">{formatoMoneda(c.valor)}</span>
            <button onClick={() => onCambiar({ colaboradores: linea.colaboradores.filter((x) => x.tempId !== c.tempId) })} className="text-error hover:underline">Quitar</button>
          </div>
        </div>
      ))}

      {linea.colaboradorFormAbierto ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-piedra bg-marfil p-3">
          {errorColaborador && <p className="text-xs font-medium text-error">{errorColaborador}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select id={`colab-${linea.tempId}`} etiqueta="Colaborador" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
              <option value="">Elegir…</option>
              {equipo.filter((p) => p.id !== linea.profesionalId && !linea.colaboradores.some((c) => c.colaboradorId === p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </Select>
            <Input id={`part-${linea.tempId}`} etiqueta="Participación" placeholder="Apoyo en peinado" value={participacion} onChange={(e) => setParticipacion(e.target.value)} />
            <CampoMoneda id={`valorcolab-${linea.tempId}`} etiqueta="Valor asignado" value={valorColaborador} onChange={setValorColaborador} />
          </div>
          <p className="text-xs text-carbon/50">Este valor se distribuye dentro del precio del servicio.</p>
          <div className="flex gap-2">
            <Button tamano="sm" onClick={agregarColaborador}>Agregar colaborador</Button>
            <Button tamano="sm" variante="ghost" onClick={() => { onCambiar({ colaboradorFormAbierto: false }); setErrorColaborador(null) }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <button onClick={() => onCambiar({ colaboradorFormAbierto: true })} className="mt-3 text-sm font-semibold text-oliva hover:underline">
          + Colaborador
        </button>
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
        <Input id={`prod-nombre-${producto.tempId}`} etiqueta="Nombre del producto" value={producto.nombre} onChange={(e) => onCambiar({ nombre: e.target.value })} />
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
