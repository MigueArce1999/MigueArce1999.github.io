// Capas 4-6 de 7: resolución de entidades contra la base de datos, validación y aplicación al
// borrador. Recibe las AccionInterpretada que produjo interprete.ts (texto puro, sin tocar la
// base de datos) y:
//   1) resuelve cada referencia textual contra clientas/servicios/profesionales REALES,
//   2) valida (permisos, precios "desde"/rango, importes ambiguos),
//   3) aplica el cambio usando los MISMOS setters que ya usa el formulario manual de
//      Atender.tsx — nunca un borrador paralelo —,
//   4) registra cada cambio para poder deshacerlo quirúrgicamente después.
// La confirmación final (cobrar) sigue siendo, siempre, el botón de la pantalla de cobro: este
// motor nunca llama a completarYCobrarAtencion.

import { formatoMoneda } from '../format'
import type { Cliente, Profesional, Servicio } from '../types'
import { interpretarTexto } from './interprete'
import { buscarCoincidencias, similitud, hashCorto, type ResultadoBusqueda } from './texto'
import { extraerMonto, ORDINALES } from './numeros'
import { deshacerGrupo, type AccesoEstado, type GrupoDeshacer, type OperacionReversible } from './deshacer'
import type { AccionInterpretada, MensajeAplicado, OpcionPregunta, PreguntaPendiente, ReferenciaLinea } from './tipos'

// --- Tipos del borrador, iguales a los internos de Atender.tsx (no se importan directo de ahí
// para no crear una dependencia circular UI → motor; es la MISMA forma de datos, ver
// pages/empleada/Atender.tsx). ---
export interface LineaServicioBorrador {
  tempId: string
  servicioId: string
  nombre: string
  profesionalId: string
  precio: number | null
  esColaboracion: boolean
  colaboracionDe?: string
}

export interface LineaProductoBorrador {
  tempId: string
  categoria: string
  nombre: string
  cantidad: number
  precioUnitario: number | null
}

function idTemporal(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Productos no tienen catálogo real en este proyecto (ver docs de entrega — limitación
// documentada): se usa esta lista, la MISMA que ya sugiere el <datalist> del formulario
// manual, solo para decidir "esto suena a producto" cuando el nombre dictado no coincide con
// ningún servicio del catálogo.
const CATEGORIAS_PRODUCTO_CONOCIDAS = ['tinte', 'champu', 'acondicionador', 'tratamiento']

export interface DependenciasMotor {
  obtenerServicios: () => Servicio[]
  obtenerEquipo: () => Profesional[]
  buscarClientes: (texto: string) => Promise<Cliente[]>
  crearClienteRapido: (datos: { nombre: string; telefono: string | null }) => Promise<Cliente>
  crearServicioRapido: (nombre: string) => Promise<Servicio>
  puedeCrearServicio: boolean
}

export interface EstadoAsistente {
  colaPreguntas: PreguntaPendiente[]
  historial: GrupoDeshacer[]
  clienteEnCreacion: { nombre?: string; telefono?: string } | null
  servicioActivoTempId: string | null
  idsInstruccionesAplicadas: Set<string>
  // Uso interno de procesarTexto (ver ahí): el contexto de una instrucción cuya pregunta queda
  // pendiente puede seguir vivo en el cierre (closure) de esa pregunta más allá de esa
  // instrucción — así que se reutiliza y ACTUALIZA el mismo objeto en cada llamada, en vez de
  // crear uno nuevo, para que "responder" una pregunta vieja siempre lea/escriba el borrador
  // más reciente y no una copia atascada en el momento en que se formuló la pregunta.
  _contextoCompartido: Contexto | null
}

export function estadoInicialAsistente(): EstadoAsistente {
  return {
    colaPreguntas: [], historial: [], clienteEnCreacion: null, servicioActivoTempId: null,
    idsInstruccionesAplicadas: new Set(), _contextoCompartido: null,
  }
}

export function ocultarTelefono(telefono: string | null): string {
  if (!telefono) return 'sin teléfono'
  const digitos = telefono.replace(/\D/g, '')
  if (digitos.length < 5) return telefono
  return `${digitos.slice(0, 3)}${'*'.repeat(digitos.length - 5)}${digitos.slice(-2)}`
}

function resolverIndiceDeSeleccion(seleccion: string, cantidad: number): number | null {
  const s = seleccion.trim().toLowerCase()
  const num = Number(s)
  if (!Number.isNaN(num) && Number.isInteger(num) && num >= 1 && num <= cantidad) return num - 1
  const ordinal = ORDINALES[s] ?? { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4 }[s]
  if (ordinal && ordinal <= cantidad) return ordinal - 1
  return null
}

interface Contexto {
  acceso: AccesoEstado
  deps: DependenciasMotor
  estado: EstadoAsistente
  mensajes: MensajeAplicado[]
  operacionesGrupo: OperacionReversible[]
}

function msg(ctx: Contexto, texto: string, icono = '✓') {
  ctx.mensajes.push({ id: idTemporal(), texto, icono })
}

function preguntar(ctx: Contexto, texto: string, opciones: OpcionPregunta[], onResponder: PreguntaPendiente['onResponder']) {
  ctx.estado.colaPreguntas.push({ id: idTemporal(), texto, opciones, onResponder })
}

// --- Cliente -------------------------------------------------------------------------------

function seleccionarCliente(ctx: Contexto, c: Cliente, comoNuevo = false) {
  const anterior = ctx.acceso.obtenerCliente()
  ctx.acceso.setCliente(c)
  ctx.operacionesGrupo.push({ tipo: 'set_cliente', anterior, nuevo: c })
  msg(ctx, `Clienta ${comoNuevo ? 'creada y ' : ''}seleccionada: ${c.nombre} · ${ocultarTelefono(c.telefono)}`, '👤')
}

// Un texto casi todo numérico es un teléfono dictado, no un nombre: se compara contra
// Cliente.telefono en vez de Cliente.nombre (contra el nombre, un número de teléfono nunca
// tendría similitud suficiente con nadie).
function esTextoTelefono(texto: string): boolean {
  const digitos = texto.replace(/\D/g, '')
  return digitos.length >= 6 && digitos.length >= texto.replace(/\s/g, '').length * 0.6
}

async function manejarBuscarCliente(ctx: Contexto, texto: string) {
  let candidatos: Cliente[]
  try {
    candidatos = await ctx.deps.buscarClientes(texto)
  } catch (e: any) {
    msg(ctx, `No se pudo buscar la clienta: ${e.message}`, '⚠️')
    return
  }
  const resultado = esTextoTelefono(texto)
    ? buscarCoincidencias(texto, candidatos, (c) => c.telefono ?? '')
    : buscarCoincidencias(texto, candidatos, (c) => c.nombre)
  aplicarResultadoBusquedaCliente(ctx, texto, resultado)
}

function aplicarResultadoBusquedaCliente(ctx: Contexto, texto: string, resultado: ResultadoBusqueda<Cliente>) {
  if (resultado.tipo === 'unica') {
    seleccionarCliente(ctx, resultado.item)
    return
  }
  if (resultado.tipo === 'aproximada') {
    preguntar(ctx, `¿Es "${resultado.item.nombre}" (${ocultarTelefono(resultado.item.telefono)})?`, [
      { etiqueta: 'Sí', valor: 'si' },
      { etiqueta: 'No, buscar de nuevo', valor: 'no' },
    ], async (valor) => {
      if (valor.toLowerCase() === 'si' || valor.toLowerCase() === 'sí') seleccionarCliente(ctx, resultado.item)
      else msg(ctx, 'Dime el nombre de la clienta otra vez.', 'ℹ️')
    })
    return
  }
  if (resultado.tipo === 'multiple') {
    const opciones = resultado.opciones.map((o, i) => ({ etiqueta: `${o.item.nombre} · ${ocultarTelefono(o.item.telefono)}`, valor: String(i + 1) }))
    preguntar(ctx, `Encontré ${resultado.opciones.length} clientas parecidas a "${texto}". ¿Cuál es?`, opciones, async (valor) => {
      const idx = resolverIndiceDeSeleccion(valor, resultado.opciones.length)
      if (idx == null) { msg(ctx, 'No entendí cuál elegiste; toca una opción de la lista.', '⚠️'); return }
      seleccionarCliente(ctx, resultado.opciones[idx].item)
    })
    return
  }
  // Ninguna coincidencia: nunca se crea sola (puede ser un error de transcripción).
  preguntar(ctx, `No encontré a nadie llamado "${texto}". ¿Buscamos de nuevo o creamos una clienta nueva?`, [
    { etiqueta: 'Buscar de nuevo', valor: 'buscar' },
    { etiqueta: 'Crear clienta', valor: 'crear' },
  ], async (valor) => {
    if (valor === 'crear') {
      ctx.estado.clienteEnCreacion = { nombre: texto }
      msg(ctx, `Creando clienta nueva con nombre "${texto}". Dime el teléfono, o di "listo" para dejarlo sin teléfono.`, 'ℹ️')
      intentarConfirmarClienteNuevo(ctx)
    } else {
      msg(ctx, 'Dime el nombre de la clienta otra vez.', 'ℹ️')
    }
  })
}

function intentarConfirmarClienteNuevo(ctx: Contexto) {
  const datos = ctx.estado.clienteEnCreacion
  if (!datos?.nombre) return
  preguntar(
    ctx,
    `¿Creo a "${datos.nombre}" ${datos.telefono ? `con teléfono ${datos.telefono}` : 'sin teléfono'}?`,
    [{ etiqueta: 'Sí, crear', valor: 'si' }, { etiqueta: 'Editar', valor: 'no' }],
    async (valor) => {
      if (valor.toLowerCase() !== 'si' && valor.toLowerCase() !== 'sí') {
        msg(ctx, 'Dime el nombre y el teléfono correctos.', 'ℹ️')
        return
      }
      try {
        const nueva = await ctx.deps.crearClienteRapido({ nombre: datos.nombre!, telefono: datos.telefono ?? null })
        ctx.estado.clienteEnCreacion = null
        seleccionarCliente(ctx, nueva, true)
      } catch (e: any) {
        msg(ctx, `No se pudo crear la clienta: ${e.message}`, '⚠️')
      }
    },
  )
}

// --- Servicio / producto ---------------------------------------------------------------------

// Si la única línea de servicio del borrador todavía está vacía (la tarjeta en blanco que
// Atender.tsx siempre muestra al empezar), se completa esa misma línea en vez de sumar una
// segunda tarjeta vacía debajo — mismo resultado que si la empleada la hubiera llenado a mano.
function encontrarLineaVaciaReutilizable(ctx: Contexto): LineaServicioBorrador | null {
  const principales = lineasPrincipales(ctx.acceso.obtenerLineas())
  if (principales.length !== 1) return null
  const unica = principales[0]
  return !unica.servicioId && unica.precio == null ? unica : null
}

function agregarLineaServicio(ctx: Contexto, datos: Partial<LineaServicioBorrador> & { nombre: string }) {
  const reutilizable = encontrarLineaVaciaReutilizable(ctx)
  const valores = {
    servicioId: datos.servicioId ?? '',
    nombre: datos.nombre,
    profesionalId: datos.profesionalId ?? reutilizable?.profesionalId ?? '',
    precio: datos.precio ?? null,
  }

  let nueva: LineaServicioBorrador
  if (reutilizable) {
    nueva = { ...reutilizable, ...valores, esColaboracion: false }
    ctx.acceso.setLineas((prev) => prev.map((l) => (l.tempId === reutilizable.tempId ? nueva : l)))
    for (const campo of ['servicioId', 'nombre', 'profesionalId', 'precio'] as const) {
      if (reutilizable[campo] !== nueva[campo]) {
        ctx.operacionesGrupo.push({ tipo: 'cambiar_linea_servicio', tempId: nueva.tempId, campo, anterior: reutilizable[campo], nuevo: nueva[campo] })
      }
    }
  } else {
    nueva = { tempId: idTemporal(), esColaboracion: false, ...valores }
    ctx.acceso.setLineas((prev) => [...prev, nueva])
    ctx.operacionesGrupo.push({ tipo: 'agregar_linea_servicio', tempId: nueva.tempId })
  }

  ctx.estado.servicioActivoTempId = nueva.tempId
  const partes = [nueva.nombre]
  if (nueva.precio != null) partes.push(formatoMoneda(nueva.precio))
  msg(ctx, `${partes.join(' · ')} añadido`, '✂️')
  return nueva
}

function agregarLineaProducto(ctx: Contexto, datos: { categoria: string; nombre?: string; cantidad: number; precioUnitario: number | null }) {
  const nueva: LineaProductoBorrador = {
    tempId: idTemporal(),
    categoria: datos.categoria,
    nombre: datos.nombre ?? '',
    cantidad: datos.cantidad,
    precioUnitario: datos.precioUnitario,
  }
  ctx.acceso.setProductos((prev) => [...prev, nueva])
  ctx.operacionesGrupo.push({ tipo: 'agregar_linea_producto', tempId: nueva.tempId })
  const detalle = nueva.precioUnitario != null ? ` · ${formatoMoneda(nueva.precioUnitario)}` : ''
  msg(ctx, `${nueva.categoria}${nueva.cantidad > 1 ? ` x${nueva.cantidad}` : ''} añadido${detalle}`, '🧴')
}

function esProbablementeProducto(nombre: string): boolean {
  return CATEGORIAS_PRODUCTO_CONOCIDAS.some((c) => similitud(nombre, c) >= 0.6)
}

function ajustarPrecioServicioSegunTipo(
  ctx: Contexto,
  servicio: Servicio,
  monto: { valor: number; ambiguo: boolean; valorSugerido?: number } | undefined,
  profesionalTexto: string | undefined,
) {
  const necesitaConfirmar = (monto?.ambiguo || servicio.tipo_precio === 'desde' || servicio.tipo_precio === 'rango') && monto
  const necesitaImporte = !monto && servicio.tipo_precio === 'a_valorar'

  const profesionalId = profesionalTexto ? resolverIdProfesional(ctx, profesionalTexto) : undefined

  if (necesitaImporte) {
    preguntar(ctx, `¿Cuánto se cobró por ${servicio.nombre}?`, [], async (valor) => {
      const m = extraerMonto(valor)
      if (!m) { msg(ctx, `No entendí el importe: dilo de nuevo, por ejemplo "cuarenta y cinco mil".`, '⚠️'); return }
      ajustarPrecioServicioSegunTipo(ctx, servicio, m, profesionalTexto)
    })
    return
  }

  const precioFinal = necesitaConfirmar ? (monto!.ambiguo ? monto!.valorSugerido! : monto!.valor) : (monto?.valor ?? servicio.precio ?? null)

  if (necesitaConfirmar) {
    const razon = monto!.ambiguo
      ? `¿Te refieres a ${formatoMoneda(precioFinal)}?`
      : `${servicio.nombre} tiene precio ${servicio.tipo_precio === 'rango' ? 'en rango' : 'desde'} ${formatoMoneda(servicio.precio)}. ¿Confirmas ${formatoMoneda(precioFinal)} como el precio cobrado?`
    preguntar(ctx, razon, [{ etiqueta: 'Sí, confirmar', valor: 'si' }, { etiqueta: 'Cambiar el valor', valor: 'no' }], async (valor) => {
      if (valor.toLowerCase() === 'si' || valor.toLowerCase() === 'sí') {
        agregarLineaServicio(ctx, { servicioId: servicio.id, nombre: servicio.nombre, precio: precioFinal, profesionalId })
      } else {
        msg(ctx, 'Dime el precio correcto para este servicio.', 'ℹ️')
      }
    })
    return
  }

  agregarLineaServicio(ctx, { servicioId: servicio.id, nombre: servicio.nombre, precio: precioFinal, profesionalId })
}

function resolverIdProfesional(ctx: Contexto, texto: string): string | undefined {
  const resultado = buscarCoincidencias(texto, ctx.deps.obtenerEquipo(), (p) => p.nombre)
  if (resultado.tipo === 'unica') return resultado.item.id
  if (resultado.tipo === 'aproximada' && resultado.puntaje >= 0.75) return resultado.item.id
  return undefined
}

async function manejarAgregarServicioOProducto(ctx: Contexto, datos: Record<string, unknown>) {
  const nombre = String(datos.nombre ?? '').trim()
  if (!nombre) return
  const monto = datos.monto as { valor: number; ambiguo: boolean; valorSugerido?: number } | undefined
  const cantidad = typeof datos.cantidad === 'number' ? datos.cantidad : undefined
  const profesionalTexto = datos.profesionalTexto as string | undefined

  const resultado = buscarCoincidencias(nombre, ctx.deps.obtenerServicios(), (s) => s.nombre)

  if (resultado.tipo === 'unica') {
    ajustarPrecioServicioSegunTipo(ctx, resultado.item, monto, profesionalTexto)
    return
  }
  if (resultado.tipo === 'aproximada' && resultado.puntaje >= 0.75) {
    ajustarPrecioServicioSegunTipo(ctx, resultado.item, monto, profesionalTexto)
    return
  }
  if (resultado.tipo === 'multiple') {
    const opciones = resultado.opciones.map((o, i) => ({ etiqueta: o.item.nombre, valor: String(i + 1) }))
    preguntar(ctx, `Encontré varios servicios parecidos a "${nombre}". ¿Cuál es?`, opciones, async (valor) => {
      const idx = resolverIndiceDeSeleccion(valor, resultado.opciones.length)
      if (idx == null) { msg(ctx, 'Toca una opción de la lista.', '⚠️'); return }
      ajustarPrecioServicioSegunTipo(ctx, resultado.opciones[idx].item, monto, profesionalTexto)
    })
    return
  }

  // Sin coincidencia en el catálogo de servicios: ¿es un producto? (este proyecto no tiene un
  // catálogo real de productos — ver limitación documentada en la entrega — así que se decide
  // por parecido con las categorías ya sugeridas en el formulario manual).
  if (esProbablementeProducto(nombre) || (cantidad && cantidad > 1 && !monto)) {
    agregarLineaProducto(ctx, { categoria: capitalizar(nombre), cantidad: cantidad ?? 1, precioUnitario: monto?.valor ?? null })
    return
  }

  if (!ctx.deps.puedeCrearServicio) {
    msg(ctx, `No encontré "${nombre}" en el catálogo y tu rol no puede crear servicios nuevos.`, '⚠️')
    return
  }
  preguntar(ctx, `No encontré "${nombre}" en el catálogo. ¿Lo creo como servicio nuevo?`, [
    { etiqueta: 'Sí, crear servicio', valor: 'si' },
    { etiqueta: 'Agregar como producto', valor: 'producto' },
    { etiqueta: 'No, cancelar', valor: 'no' },
  ], async (valor) => {
    if (valor === 'producto') {
      agregarLineaProducto(ctx, { categoria: capitalizar(nombre), cantidad: cantidad ?? 1, precioUnitario: monto?.valor ?? null })
      return
    }
    if (valor.toLowerCase() !== 'si' && valor.toLowerCase() !== 'sí') { msg(ctx, 'Cancelado.', 'ℹ️'); return }
    try {
      const nuevo = await ctx.deps.crearServicioRapido(nombre)
      ajustarPrecioServicioSegunTipo(ctx, nuevo, monto, profesionalTexto)
    } catch (e: any) {
      msg(ctx, `No se pudo crear el servicio: ${e.message}`, '⚠️')
    }
  })
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// --- Referencias a una línea ya existente en el borrador (servicio o producto) ---------------

function lineasPrincipales(lineas: LineaServicioBorrador[]): LineaServicioBorrador[] {
  return lineas.filter((l) => !l.colaboracionDe)
}

function resolverLineaServicio(ctx: Contexto, referencia: ReferenciaLinea | undefined): ResultadoBusqueda<LineaServicioBorrador> {
  const principales = lineasPrincipales(ctx.acceso.obtenerLineas())
  if (referencia?.posicionOrdinal) {
    const l = principales[referencia.posicionOrdinal - 1]
    return l ? { tipo: 'unica', item: l } : { tipo: 'ninguna' }
  }
  if (referencia?.texto) {
    return buscarCoincidencias(referencia.texto, principales, (l) => l.nombre)
  }
  if (principales.length === 1) return { tipo: 'unica', item: principales[0] }
  const activo = principales.find((l) => l.tempId === ctx.estado.servicioActivoTempId)
  if (activo) return { tipo: 'unica', item: activo }
  if (principales.length === 0) return { tipo: 'ninguna' }
  return { tipo: 'multiple', opciones: principales.map((l) => ({ item: l, puntaje: 1 })) }
}

function preguntarCualServicio(
  ctx: Contexto,
  opciones: { item: LineaServicioBorrador; puntaje: number }[],
  continuar: (l: LineaServicioBorrador) => void,
) {
  const equipo = ctx.deps.obtenerEquipo()
  const nombreProf = (id: string) => equipo.find((p) => p.id === id)?.nombre ?? 'sin profesional'
  const items = opciones.map((o, i) => ({ etiqueta: `${o.item.nombre} de ${nombreProf(o.item.profesionalId)}`, valor: String(i + 1) }))
  preguntar(ctx, `¿Cuál servicio? ${items.map((it) => it.etiqueta).join(' / ')}`, items, async (valor) => {
    const idx = resolverIndiceDeSeleccion(valor, opciones.length)
    if (idx == null) { msg(ctx, 'Toca una opción de la lista.', '⚠️'); return }
    continuar(opciones[idx].item)
  })
}

function cambiarCampoLineaServicio(ctx: Contexto, l: LineaServicioBorrador, campo: keyof LineaServicioBorrador, nuevo: unknown) {
  const anterior = l[campo]
  ctx.acceso.setLineas((prev) => prev.map((x) => (x.tempId === l.tempId ? { ...x, [campo]: nuevo } : x)))
  ctx.operacionesGrupo.push({ tipo: 'cambiar_linea_servicio', tempId: l.tempId, campo: campo as string, anterior, nuevo })
  ctx.estado.servicioActivoTempId = l.tempId
}

async function manejarFijarPrecio(ctx: Contexto, referencia: ReferenciaLinea | undefined, monto: { valor: number; ambiguo: boolean; valorSugerido?: number }) {
  const resultado = resolverLineaServicio(ctx, referencia)
  if (resultado.tipo === 'ninguna') { msg(ctx, `No encontré ese servicio en la atención.`, '⚠️'); return }
  if (resultado.tipo === 'multiple') { preguntarCualServicio(ctx, resultado.opciones, (l) => aplicarPrecio(ctx, l, monto)); return }
  aplicarPrecio(ctx, resultado.item, monto)
}

function aplicarPrecio(ctx: Contexto, l: LineaServicioBorrador, monto: { valor: number; ambiguo: boolean; valorSugerido?: number }) {
  if (monto.ambiguo) {
    preguntar(ctx, `¿Confirmas ${formatoMoneda(monto.valorSugerido!)} para ${l.nombre}?`, [
      { etiqueta: 'Sí', valor: 'si' },
      { etiqueta: `No, es ${formatoMoneda(monto.valor)}`, valor: 'no' },
    ], async (valor) => {
      const final = valor.toLowerCase() === 'si' || valor.toLowerCase() === 'sí' ? monto.valorSugerido! : monto.valor
      cambiarCampoLineaServicio(ctx, l, 'precio', final)
      msg(ctx, `Precio de ${l.nombre} actualizado a ${formatoMoneda(final)}`, '💲')
    })
    return
  }
  cambiarCampoLineaServicio(ctx, l, 'precio', monto.valor)
  msg(ctx, `Precio de ${l.nombre} actualizado a ${formatoMoneda(monto.valor)}`, '💲')
}

async function manejarAsignarProfesional(ctx: Contexto, referencia: ReferenciaLinea | undefined, profesionalTexto: string) {
  const resultadoServicio = resolverLineaServicio(ctx, referencia)
  if (resultadoServicio.tipo === 'ninguna') { msg(ctx, `No encontré ese servicio en la atención.`, '⚠️'); return }
  if (resultadoServicio.tipo === 'multiple') {
    preguntarCualServicio(ctx, resultadoServicio.opciones, (l) => continuarAsignarProfesional(ctx, l, profesionalTexto))
    return
  }
  continuarAsignarProfesional(ctx, resultadoServicio.item, profesionalTexto)
}

function continuarAsignarProfesional(ctx: Contexto, l: LineaServicioBorrador, profesionalTexto: string) {
  const resultado = buscarCoincidencias(profesionalTexto, ctx.deps.obtenerEquipo(), (p) => p.nombre)
  if (resultado.tipo === 'ninguna') { msg(ctx, `No encontré a "${profesionalTexto}" en el equipo.`, '⚠️'); return }
  if (resultado.tipo === 'multiple') {
    const opciones = resultado.opciones.map((o, i) => ({ etiqueta: o.item.nombre, valor: String(i + 1) }))
    preguntar(ctx, `¿Cuál "${profesionalTexto}"?`, opciones, async (valor) => {
      const idx = resolverIndiceDeSeleccion(valor, resultado.opciones.length)
      if (idx == null) return
      cambiarCampoLineaServicio(ctx, l, 'profesionalId', resultado.opciones[idx].item.id)
      msg(ctx, `${resultado.opciones[idx].item.nombre} asignada a ${l.nombre}`, '🙋')
    })
    return
  }
  cambiarCampoLineaServicio(ctx, l, 'profesionalId', resultado.item.id)
  msg(ctx, `${resultado.item.nombre} asignada a ${l.nombre}`, '🙋')
}

async function manejarAgregarColaborador(ctx: Contexto, referencia: ReferenciaLinea | undefined, colaboradorTexto: string) {
  const resultadoServicio = resolverLineaServicio(ctx, referencia)
  if (resultadoServicio.tipo === 'ninguna') { msg(ctx, `No encontré ese servicio en la atención.`, '⚠️'); return }
  if (resultadoServicio.tipo === 'multiple') {
    preguntarCualServicio(ctx, resultadoServicio.opciones, (l) => continuarAgregarColaborador(ctx, l, colaboradorTexto))
    return
  }
  continuarAgregarColaborador(ctx, resultadoServicio.item, colaboradorTexto)
}

const MAX_COLABORADORES_POR_SERVICIO = 5

function continuarAgregarColaborador(ctx: Contexto, servicioLinea: LineaServicioBorrador, colaboradorTexto: string) {
  const lineas = ctx.acceso.obtenerLineas()
  const colaboradoresActuales = lineas.filter((l) => l.colaboracionDe === servicioLinea.tempId)
  if (colaboradoresActuales.length >= MAX_COLABORADORES_POR_SERVICIO) {
    msg(ctx, `${servicioLinea.nombre} ya tiene el máximo de ${MAX_COLABORADORES_POR_SERVICIO} colaboradores.`, '⚠️')
    return
  }
  const candidatos = ctx.deps.obtenerEquipo().filter((p) => p.id !== servicioLinea.profesionalId && !colaboradoresActuales.some((c) => c.profesionalId === p.id))
  const resultado = buscarCoincidencias(colaboradorTexto, candidatos, (p) => p.nombre)
  if (resultado.tipo === 'ninguna') { msg(ctx, `No encontré a "${colaboradorTexto}" disponible como colaboradora.`, '⚠️'); return }
  const continuarCon = (colaboradora: Profesional) => {
    preguntar(ctx, `¿Cuánto se le asigna a ${colaboradora.nombre} por colaborar en ${servicioLinea.nombre}?`, [], async (valorTexto) => {
      const monto = extraerMonto(valorTexto)
      if (!monto || monto.valor <= 0) { msg(ctx, 'Dime un valor mayor a cero, por ejemplo "diez mil".', '⚠️'); return }
      const valorFinal = monto.ambiguo ? monto.valorSugerido! : monto.valor
      const nueva: LineaServicioBorrador = {
        tempId: idTemporal(),
        servicioId: servicioLinea.servicioId,
        nombre: `${servicioLinea.nombre} (colaboración de ${colaboradora.nombre})`,
        profesionalId: colaboradora.id,
        precio: valorFinal,
        esColaboracion: true,
        colaboracionDe: servicioLinea.tempId,
      }
      ctx.acceso.setLineas((prev) => [...prev, nueva])
      ctx.operacionesGrupo.push({ tipo: 'agregar_linea_servicio', tempId: nueva.tempId })
      msg(ctx, `${colaboradora.nombre} añadida como colaboradora de ${servicioLinea.nombre} · ${formatoMoneda(valorFinal)}`, '🤝')
    })
  }
  if (resultado.tipo === 'multiple') {
    const opciones = resultado.opciones.map((o, i) => ({ etiqueta: o.item.nombre, valor: String(i + 1) }))
    preguntar(ctx, `¿Cuál "${colaboradorTexto}"?`, opciones, async (valor) => {
      const idx = resolverIndiceDeSeleccion(valor, resultado.opciones.length)
      if (idx == null) return
      continuarCon(resultado.opciones[idx].item)
    })
    return
  }
  continuarCon(resultado.item)
}

async function manejarQuitarColaborador(ctx: Contexto, referencia: ReferenciaLinea | undefined, colaboradorTexto: string) {
  const resultadoServicio = resolverLineaServicio(ctx, referencia)
  if (resultadoServicio.tipo === 'ninguna') { msg(ctx, `No encontré ese servicio en la atención.`, '⚠️'); return }
  if (resultadoServicio.tipo === 'multiple') {
    preguntarCualServicio(ctx, resultadoServicio.opciones, (l) => quitarColaboradorDe(ctx, l, colaboradorTexto))
    return
  }
  quitarColaboradorDe(ctx, resultadoServicio.item, colaboradorTexto)
}

function quitarColaboradorDe(ctx: Contexto, servicioLinea: LineaServicioBorrador, colaboradorTexto: string) {
  const lineas = ctx.acceso.obtenerLineas()
  const colaboradores = lineas.filter((l) => l.colaboracionDe === servicioLinea.tempId)
  const equipo = ctx.deps.obtenerEquipo()
  const resultado = buscarCoincidencias(colaboradorTexto, colaboradores, (c) => equipo.find((p) => p.id === c.profesionalId)?.nombre ?? '')
  if (resultado.tipo === 'ninguna' || resultado.tipo === 'multiple') {
    msg(ctx, `No encontré a "${colaboradorTexto}" como colaboradora de ${servicioLinea.nombre}.`, '⚠️')
    return
  }
  const linea = resultado.item
  const indice = lineas.findIndex((l) => l.tempId === linea.tempId)
  ctx.acceso.setLineas((prev) => prev.filter((l) => l.tempId !== linea.tempId))
  ctx.operacionesGrupo.push({ tipo: 'quitar_linea_servicio', linea, indice })
  msg(ctx, `${equipo.find((p) => p.id === linea.profesionalId)?.nombre ?? 'Colaboradora'} quitada de ${servicioLinea.nombre}`, '🗑')
}

async function manejarQuitarLinea(ctx: Contexto, referencia: ReferenciaLinea | undefined) {
  const resultadoServicio = resolverLineaServicio(ctx, referencia)
  if (resultadoServicio.tipo === 'unica') {
    quitarServicioYColaboradores(ctx, resultadoServicio.item)
    return
  }
  if (resultadoServicio.tipo === 'multiple') {
    preguntarCualServicio(ctx, resultadoServicio.opciones, (l) => quitarServicioYColaboradores(ctx, l))
    return
  }
  // No es un servicio: probar contra productos por nombre/categoría.
  if (referencia?.texto) {
    const productos = ctx.acceso.obtenerProductos()
    const resultadoProducto = buscarCoincidencias(referencia.texto, productos, (p) => `${p.categoria} ${p.nombre}`.trim())
    if (resultadoProducto.tipo === 'unica' || resultadoProducto.tipo === 'aproximada') {
      quitarProducto(ctx, resultadoProducto.item)
      return
    }
    if (resultadoProducto.tipo === 'multiple') {
      const opciones = resultadoProducto.opciones.map((o, i) => ({ etiqueta: `${o.item.categoria} ${o.item.nombre}`.trim(), valor: String(i + 1) }))
      preguntar(ctx, `¿Cuál producto quitar?`, opciones, async (valor) => {
        const idx = resolverIndiceDeSeleccion(valor, resultadoProducto.opciones.length)
        if (idx == null) return
        quitarProducto(ctx, resultadoProducto.opciones[idx].item)
      })
      return
    }
  }
  msg(ctx, `No encontré "${referencia?.texto ?? ''}" en esta atención.`, '⚠️')
}

function quitarServicioYColaboradores(ctx: Contexto, l: LineaServicioBorrador) {
  const lineas = ctx.acceso.obtenerLineas()
  const indice = lineas.findIndex((x) => x.tempId === l.tempId)
  const colaboradores = lineas.filter((x) => x.colaboracionDe === l.tempId)
  ctx.acceso.setLineas((prev) => prev.filter((x) => x.tempId !== l.tempId && x.colaboracionDe !== l.tempId))
  ctx.operacionesGrupo.push({ tipo: 'quitar_linea_servicio', linea: l, indice })
  for (const c of colaboradores) {
    ctx.operacionesGrupo.push({ tipo: 'quitar_linea_servicio', linea: c, indice: lineas.findIndex((x) => x.tempId === c.tempId) })
  }
  msg(ctx, `${l.nombre} quitado`, '🗑')
}

function quitarProducto(ctx: Contexto, p: LineaProductoBorrador) {
  const productos = ctx.acceso.obtenerProductos()
  const indice = productos.findIndex((x) => x.tempId === p.tempId)
  ctx.acceso.setProductos((prev) => prev.filter((x) => x.tempId !== p.tempId))
  ctx.operacionesGrupo.push({ tipo: 'quitar_linea_producto', linea: p, indice })
  msg(ctx, `${p.categoria} quitado`, '🗑')
}

function manejarCambiarCantidadProducto(ctx: Contexto, cantidad: number) {
  const productos = ctx.acceso.obtenerProductos()
  if (productos.length === 0) { msg(ctx, 'Todavía no has añadido ningún producto.', '⚠️'); return }
  const objetivo = productos[productos.length - 1]
  const anterior = objetivo.cantidad
  ctx.acceso.setProductos((prev) => prev.map((p) => (p.tempId === objetivo.tempId ? { ...p, cantidad } : p)))
  ctx.operacionesGrupo.push({ tipo: 'cambiar_linea_producto', tempId: objetivo.tempId, campo: 'cantidad', anterior, nuevo: cantidad })
  msg(ctx, `Cantidad de ${objetivo.categoria} actualizada a ${cantidad}`, '🔢')
}

function manejarAgregarNota(ctx: Contexto, texto: string) {
  const anterior = ctx.acceso.obtenerNotas()
  const nuevo = anterior.trim() ? `${anterior}\n${texto}` : texto
  ctx.acceso.setNotas(() => nuevo)
  ctx.operacionesGrupo.push({ tipo: 'cambiar_notas', anterior, nuevo })
  msg(ctx, 'Nota añadida', '📝')
}

// --- Orquestación principal -------------------------------------------------------------------

export interface ResultadoTurno {
  mensajes: MensajeAplicado[]
  noReconocidos: string[]
  huboCambios: boolean
}

async function ejecutarAccion(ctx: Contexto, accion: AccionInterpretada) {
  switch (accion.tipo) {
    case 'buscar_cliente': return manejarBuscarCliente(ctx, String(accion.datos.texto))
    case 'crear_cliente':
      ctx.estado.clienteEnCreacion = {}
      msg(ctx, 'Dime el nombre de la clienta nueva.', 'ℹ️')
      return
    case 'completar_cliente_nuevo': {
      if (!ctx.estado.clienteEnCreacion) {
        msg(ctx, 'Di "Crear nueva clienta" primero.', 'ℹ️')
        return
      }
      const campo = accion.datos.campo as 'nombre' | 'telefono'
      ctx.estado.clienteEnCreacion[campo] = String(accion.datos.valor)
      if (ctx.estado.clienteEnCreacion.nombre) intentarConfirmarClienteNuevo(ctx)
      return
    }
    case 'cambiar_cliente': {
      const texto = String(accion.datos.texto)
      let candidatos: Cliente[]
      try { candidatos = await ctx.deps.buscarClientes(texto) } catch { candidatos = [] }
      aplicarResultadoBusquedaCliente(ctx, texto, buscarCoincidencias(texto, candidatos, (c) => c.nombre))
      return
    }
    case 'agregar_servicio_o_producto': return manejarAgregarServicioOProducto(ctx, accion.datos)
    case 'fijar_precio_servicio': return manejarFijarPrecio(ctx, accion.referencia, accion.datos.monto as any)
    case 'asignar_profesional': return manejarAsignarProfesional(ctx, accion.referencia, String(accion.datos.profesionalTexto))
    case 'agregar_colaborador': return manejarAgregarColaborador(ctx, accion.referencia, String(accion.datos.colaboradorTexto))
    case 'quitar_colaborador': return manejarQuitarColaborador(ctx, accion.referencia, String(accion.datos.colaboradorTexto))
    case 'quitar_linea': return manejarQuitarLinea(ctx, accion.referencia)
    case 'cambiar_cantidad_producto': return manejarCambiarCantidadProducto(ctx, Number(accion.datos.cantidad))
    case 'agregar_nota': return manejarAgregarNota(ctx, String(accion.datos.texto))
    case 'confirmar_listo':
      msg(ctx, 'Revisando si la atención está lista para pasar a cobro…', 'ℹ️')
      return
    case 'deshacer': {
      const grupo = ctx.estado.historial.pop()
      if (!grupo) { msg(ctx, 'No hay nada que deshacer.', 'ℹ️'); return }
      const { omitidas } = deshacerGrupo(grupo, ctx.acceso)
      msg(ctx, omitidas > 0 ? `Deshecho: ${grupo.resumen} (${omitidas} cambio(s) no se revirtieron porque los editaste después).` : `Deshecho: ${grupo.resumen}`, '↩️')
      return
    }
    case 'no_reconocido':
      return
    case 'responder_pregunta':
      return // se maneja fuera, contra la pregunta pendiente visible
  }
}

// Entrada principal: procesa TODO el texto de una instrucción (hablada o escrita). Devuelve los
// mensajes de "acciones aplicadas" a mostrar y los fragmentos que no se reconocieron. Cada
// pregunta que surge se encola (nunca se pisan preguntas entre sí) y se expone de a una a
// través de estado.colaPreguntas[0] — ver sección 11: "pregunta una cosa a la vez".
export async function procesarTexto(
  texto: string,
  estado: EstadoAsistente,
  acceso: AccesoEstado,
  deps: DependenciasMotor,
  onListo?: () => void,
): Promise<ResultadoTurno> {
  const acciones = interpretarTexto(texto)
  if (!estado._contextoCompartido) {
    estado._contextoCompartido = { acceso, deps, estado, mensajes: [], operacionesGrupo: [] }
  } else {
    estado._contextoCompartido.acceso = acceso
    estado._contextoCompartido.deps = deps
    estado._contextoCompartido.mensajes = []
    estado._contextoCompartido.operacionesGrupo = []
  }
  const ctx = estado._contextoCompartido
  const noReconocidos: string[] = []

  // Si hay una pregunta visible y lo dicho es una respuesta a ella, se resuelve directo contra
  // esa pregunta en vez de reinterpretarla como una instrucción nueva — y solo contra la lista
  // de opciones ACTUALMENTE visible (sección 7: "estas respuestas solo deben funcionar sobre la
  // lista actualmente visible").
  const preguntaActual = estado.colaPreguntas[0]
  const respuestaPorPatron = preguntaActual && acciones.length === 1 && acciones[0].tipo === 'responder_pregunta'
    ? String(acciones[0].datos.seleccion)
    : null
  // Si lo dicho no encajó en los patrones de respuesta (ordinal/dígito/sí/no) pero SÍ hay una
  // pregunta visible con opciones de texto libre (p. ej. "Crear clienta" / "Buscar de nuevo"),
  // se compara contra las etiquetas de esas opciones — siempre sobre la lista ACTUALMENTE
  // visible, nunca contra una pregunta ya resuelta.
  const respuestaPorParecido = !respuestaPorPatron && preguntaActual && preguntaActual.opciones.length > 0
    ? buscarCoincidencias(texto, preguntaActual.opciones, (o) => o.etiqueta)
    : null
  // Pregunta ABIERTA (sin opciones, p. ej. "¿Cuánto se cobró por…?"): si lo dicho no encajó en
  // NINGÚN patrón reconocido (todas las acciones son 'no_reconocido'), se toma como la
  // respuesta directa en vez de reportarlo como no entendido — así "diez mil" contesta la
  // pregunta en vez de perderse. Si en cambio la persona lanzó una instrucción reconocible y
  // distinta, esa instrucción sigue su propio camino (sección 11: no se fuerza como respuesta).
  const esRespuestaAPreguntaAbierta =
    preguntaActual && preguntaActual.opciones.length === 0 && acciones.every((a) => a.tipo === 'no_reconocido')

  if (preguntaActual && respuestaPorPatron != null) {
    estado.colaPreguntas.shift()
    await preguntaActual.onResponder(respuestaPorPatron)
  } else if (preguntaActual && respuestaPorParecido && (respuestaPorParecido.tipo === 'unica' || respuestaPorParecido.tipo === 'aproximada')) {
    estado.colaPreguntas.shift()
    await preguntaActual.onResponder(respuestaPorParecido.item.valor)
  } else if (esRespuestaAPreguntaAbierta) {
    estado.colaPreguntas.shift()
    await preguntaActual!.onResponder(texto.trim())
  } else {
    for (const accion of acciones) {
      if (accion.tipo === 'no_reconocido') { noReconocidos.push(accion.textoOriginal); continue }
      if (accion.tipo === 'confirmar_listo') { onListo?.(); ejecutarAccion(ctx, accion); continue }
      // Idempotencia: la MISMA acción (mismo id, derivado del texto+datos) ya aplicada en este
      // turno de voz no se vuelve a aplicar — evita duplicar si el reconocimiento repite un
      // resultado final (sección 5/13).
      if (ctx.estado.idsInstruccionesAplicadas.has(accion.id)) continue
      await ejecutarAccion(ctx, accion)
      ctx.estado.idsInstruccionesAplicadas.add(accion.id)
    }
  }

  if (ctx.operacionesGrupo.length > 0) {
    estado.historial.push({ id: hashCorto(texto + Date.now()), resumen: texto.length > 60 ? `${texto.slice(0, 60)}…` : texto, operaciones: ctx.operacionesGrupo })
    if (estado.historial.length > 20) estado.historial.shift()
  }

  return { mensajes: ctx.mensajes, noReconocidos, huboCambios: ctx.operacionesGrupo.length > 0 }
}
