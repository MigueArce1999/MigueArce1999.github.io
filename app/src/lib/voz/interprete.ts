// Capa 3 de 7: interpretación de instrucciones (ver docs de entrega para las 7 capas
// completas). Recibe texto ya normalizado y devuelve una lista de AccionInterpretada, SIN
// tocar la base de datos ni el borrador — eso lo hace el motor (motor.ts). Determinista: un
// conjunto fijo de patrones/sinónimos, sin modelo generativo. Si una frase no encaja en ningún
// patrón, se devuelve como 'no_reconocido' en vez de forzar una interpretación dudosa.

import { extraerMonto, leerMontoDesdeTokens, ORDINALES, sinTildes, type MontoInterpretado } from './numeros'
import { hashCorto } from './texto'
import type { AccionInterpretada, ReferenciaLinea, TipoAccion } from './tipos'

interface Token {
  texto: string
  normalizado: string
  inicio: number
  fin: number
}

function tokenizar(texto: string): Token[] {
  const tokens: Token[] = []
  const re = /[^\s]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) {
    const crudo = m[0]
    const limpio = crudo.replace(/^[¿¡"'“”(]+|[?!."'“”),;:]+$/g, '')
    tokens.push({ texto: crudo, normalizado: sinTildes(limpio.toLowerCase()), inicio: m.index, fin: m.index + crudo.length })
  }
  return tokens
}

function crearAccion(
  tipo: TipoAccion,
  textoOriginal: string,
  datos: Record<string, unknown> = {},
  extra: Partial<Pick<AccionInterpretada, 'referencia' | 'camposFaltantes' | 'ambiguedades' | 'estado'>> = {},
): AccionInterpretada {
  return {
    id: hashCorto(`${tipo}|${textoOriginal.trim().toLowerCase()}|${JSON.stringify(datos)}`),
    tipo,
    textoOriginal: textoOriginal.trim(),
    datos,
    referencia: extra.referencia,
    camposFaltantes: extra.camposFaltantes ?? [],
    ambiguedades: extra.ambiguedades ?? [],
    estado: extra.estado ?? 'lista',
  }
}

// Palabras sin contenido propio: un fragmento sobrante hecho solo de estas no vale la pena
// mostrarlo como "no reconocido" (es basura de conectores, no una instrucción perdida).
const CONECTORES = new Set([
  'y', 'la', 'el', 'los', 'las', 'un', 'una', 'de', 'del', 'a', 'con', 'se', 'lo', 'que', 'le',
  // Verbos de relleno que suelen introducir un servicio ya capturado por otro patrón
  // ("Le HICIMOS un blower…"): no aportan una instrucción propia, así que un sobrante hecho
  // solo de estas palabras no vale la pena mostrarlo como "no reconocido".
  'hicimos', 'hizo', 'hice', 'realizamos', 'realizo', 'realizó',
  'agrega', 'anade', 'agregar', 'anadir',
])

function esFragmentoSignificativo(fragmento: string): boolean {
  const palabras = fragmento.trim().split(/\s+/).filter(Boolean)
  return palabras.some((p) => p.length >= 3 && !CONECTORES.has(sinTildes(p.toLowerCase())))
}

// --- Máscara de caracteres: cada patrón que encuentra una coincidencia marca su tramo como
// "usado" para que los patrones siguientes no lo vuelvan a interpretar, y para poder armar al
// final el texto sobrante (lo que nadie reclamó) sin reconstruir strings a mano. ---

function marcar(mascara: boolean[], inicio: number, fin: number) {
  for (let i = inicio; i < fin; i++) mascara[i] = true
}

function estaLibre(mascara: boolean[], inicio: number, fin: number, umbral = 0.4): boolean {
  let usados = 0
  for (let i = inicio; i < fin; i++) if (mascara[i]) usados++
  return usados / Math.max(1, fin - inicio) < umbral
}

interface Contexto {
  texto: string
  mascara: boolean[]
  acciones: AccionInterpretada[]
}

function agregar(ctx: Contexto, accion: AccionInterpretada, inicio: number, fin: number) {
  ctx.acciones.push(accion)
  marcar(ctx.mascara, inicio, fin)
}

// --- Nota: se extrae ANTES que todo lo demás, directamente sobre el texto crudo, porque debe
// tragarse literalmente todo lo que sigue (comas y puntos incluidos) — ver sección 10: "todo el
// contenido posterior a 'añade una nota' debe tratarse como texto de la nota, no como
// instrucciones ejecutables". ---
const PATRON_NOTA = /\b(?:a[ñn]ade|agrega|agregar|a[ñn]adir)\s+(?:una\s+)?nota\s*:?\s*/i

function extraerNota(texto: string): { nota: AccionInterpretada | null; restante: string } {
  const m = texto.match(PATRON_NOTA)
  if (!m || m.index === undefined) return { nota: null, restante: texto }
  const inicioTexto = m.index + m[0].length
  const textoNota = texto.slice(inicioTexto).trim()
  if (!textoNota) return { nota: null, restante: texto }
  return {
    nota: crearAccion('agregar_nota', texto.slice(m.index), { texto: textoNota }),
    restante: texto.slice(0, m.index),
  }
}

// --- Servicio/producto compuesto: "un/una NOMBRE de MONTO [con PROFESIONAL]". El monto puede
// ser una cifra o varias palabras numéricas ("cuarenta y cinco mil"), así que se recorre token
// por token en vez de un mega-regex frágil. Se admite además "NOMBRE por MONTO" (sección 8:
// "Añade definición de rizos por setenta mil"). ---
const VERBOS_AGREGAR = new Set(['agrega', 'anade', 'agregar', 'anadir'])

function extraerServiciosCompuestos(ctx: Contexto, tokens: Token[]) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!estaLibre(ctx.mascara, t.inicio, t.fin)) continue

    // Dos formas de arrancar: con artículo ("un/una NOMBRE de MONTO") o con el verbo directo
    // sin artículo ("Añade NOMBRE por MONTO", sección 8: "Añade definición de rizos por
    // setenta mil"). Si el verbo SÍ va seguido de artículo, se deja que ese "un/una" dispare
    // su propia iteración para no procesar el mismo tramo dos veces.
    let nombreInicioIdx: number
    if (t.normalizado === 'un' || t.normalizado === 'una') {
      nombreInicioIdx = i + 1
    } else if (VERBOS_AGREGAR.has(t.normalizado) && tokens[i + 1] && tokens[i + 1].normalizado !== 'un' && tokens[i + 1].normalizado !== 'una') {
      nombreInicioIdx = i + 1
    } else {
      continue
    }

    // Busca "de" o "por" dentro de una ventana razonable para delimitar el nombre. Un nombre
    // de servicio puede él mismo contener "de" ("definición DE rizos"), así que no basta con
    // tomar la PRIMERA ocurrencia: se prueba cada candidato en orden y se acepta el primero
    // para el que lo que sigue realmente empieza con un monto válido.
    const limiteBusqueda = Math.min(tokens.length, nombreInicioIdx + 8)
    let idxSeparador = -1
    let leido: { monto: MontoInterpretado; consumidos: number } | null = null
    for (let j = nombreInicioIdx + 1; j < limiteBusqueda; j++) {
      if (tokens[j].normalizado !== 'de' && tokens[j].normalizado !== 'por') continue
      const intento = leerMontoDesdeTokens(tokens.slice(j + 1).map((tk) => tk.normalizado), 0)
      if (intento) { idxSeparador = j; leido = intento; break }
    }

    let nombreFinIdx: number
    let monto: MontoInterpretado | undefined
    let finSpan: number
    let idxPosibleCon: number
    if (idxSeparador !== -1 && leido) {
      nombreFinIdx = idxSeparador
      monto = leido.monto
      const idxUltimoTokenMonto = idxSeparador + leido.consumidos
      finSpan = tokens[idxUltimoTokenMonto].fin
      idxPosibleCon = idxUltimoTokenMonto + 1
    } else {
      // Sin precio dictado todavía (sección 8: "Se hizo un corte con Valery", o un servicio
      // a_valorar del que aún no se sabe el importe): se admite "un/una NOMBRE con
      // PROFESIONAL" sin monto, buscando directamente el "con" dentro de la ventana.
      let idxCon = -1
      for (let j = nombreInicioIdx + 1; j < limiteBusqueda; j++) {
        if (tokens[j].normalizado === 'con') { idxCon = j; break }
      }
      if (idxCon === -1 || idxCon === nombreInicioIdx) continue
      nombreFinIdx = idxCon
      finSpan = tokens[idxCon].fin
      idxPosibleCon = idxCon
    }

    const nombreTokens = tokens.slice(nombreInicioIdx, nombreFinIdx)
    if (nombreTokens.length === 0 || !estaLibre(ctx.mascara, nombreTokens[0].inicio, nombreTokens[nombreTokens.length - 1].fin)) continue
    const nombre = ctx.texto.slice(nombreTokens[0].inicio, nombreTokens[nombreTokens.length - 1].fin)

    let profesionalTexto: string | undefined
    if (tokens[idxPosibleCon]?.normalizado === 'con') {
      const inicioNombreProf = idxPosibleCon + 1
      let finNombreProf = inicioNombreProf
      let finDeClausula = false
      // Nombre propio: hasta 2 palabras, se detiene en conectores, en "y", o al final de la
      // oración (un token que termina en . ! ? no se sigue de otro: "con Valery. Ana" no debe
      // tragarse "Ana", que empieza la frase siguiente).
      while (
        finNombreProf < tokens.length &&
        finNombreProf < inicioNombreProf + 2 &&
        !CONECTORES.has(tokens[finNombreProf].normalizado) &&
        tokens[finNombreProf].normalizado !== 'y'
      ) {
        finDeClausula = /[.!?]$/.test(tokens[finNombreProf].texto)
        finNombreProf++
        if (finDeClausula) break
      }
      if (finNombreProf > inicioNombreProf) {
        const crudo = ctx.texto.slice(tokens[inicioNombreProf].inicio, tokens[finNombreProf - 1].fin)
        profesionalTexto = crudo.replace(/[.,!?]+$/, '')
        finSpan = finDeClausula ? tokens[finNombreProf - 1].fin - 1 : tokens[finNombreProf - 1].fin
      }
    }

    // Si justo antes venía un verbo tipo "Agrega"/"Añade" (caso "Agrega un champú…"), se marca
    // también como usado: no aporta una acción propia, pero dejarlo suelto lo mostraría como
    // "no reconocido" pese a haber sido interpretado correctamente.
    const spanInicio = i > 0 && VERBOS_AGREGAR.has(tokens[i - 1].normalizado) && estaLibre(ctx.mascara, tokens[i - 1].inicio, tokens[i - 1].fin)
      ? tokens[i - 1].inicio
      : t.inicio

    const spanCompleto = ctx.texto.slice(spanInicio, finSpan)
    agregar(
      ctx,
      crearAccion('agregar_servicio_o_producto', spanCompleto, { nombre: nombre.trim(), monto, profesionalTexto }),
      spanInicio,
      finSpan,
    )
    // Continuar buscando después de este tramo: como índice de tokens, basta con encontrar el
    // primero cuyo carácter final ya pasa finSpan.
    while (i < tokens.length && tokens[i].fin < finSpan) i++
  }
}

// --- Patrones de frase fija: cada uno se corre como regex global sobre el texto completo y
// solo se acepta si su tramo sigue libre (no reclamado por un patrón de mayor prioridad). ---

interface PatronFijo {
  regex: RegExp
  construir: (m: RegExpExecArray, spanTexto: string) => AccionInterpretada | null
}

const PATRONES: PatronFijo[] = [
  // Colaborador: "Ana colaboró en el blower" / "Ana colaboró en el corte de Valery"
  {
    regex: /\b([a-záéíóúñ]+)\s+colabor[oó]\s+en\s+(?:el|la)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3}?)(?=[.,]|\s+y\s+(?:un\b|una\b|el\b|la\b)|$)/gi,
    construir: (m, span) => crearAccion('agregar_colaborador', span, { colaboradorTexto: m[1] }, { referencia: { texto: m[2].trim() } }),
  },
  // "Añade a Nalda como colaboradora del segundo servicio" / "...del blower"
  {
    regex: /\ba[ñn]ad[ei]\s+a\s+([a-záéíóúñ]+)\s+como\s+colaborador[a]?\s+(?:del|de\s+la)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3}?)(?=[.,]|$)/gi,
    construir: (m, span) => {
      const refTexto = m[2].trim()
      const ordinal = ORDINALES[sinTildes(refTexto.toLowerCase().split(/\s+/)[0])]
      return crearAccion(
        'agregar_colaborador',
        span,
        { colaboradorTexto: m[1] },
        { referencia: ordinal ? { posicionOrdinal: ordinal } : { texto: refTexto } },
      )
    },
  },
  // "Quita a Ana del blower" / "Quita a Ana de el corte"
  {
    regex: /\bquita\s+a\s+([a-záéíóúñ]+)\s+de(?:l)?\s+(?:la\s+)?([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3}?)(?=[.,]|$)/gi,
    construir: (m, span) => crearAccion('quitar_colaborador', span, { colaboradorTexto: m[1] }, { referencia: { texto: m[2].trim() } }),
  },
  // "Cambia la profesional del corte por Claudia" / "...el profesional del corte por Claudia"
  {
    regex: /\bcambia\s+(?:la|el)\s+profesional\s+del\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3}?)\s+por\s+([a-záéíóúñ]+)/gi,
    construir: (m, span) => crearAccion('asignar_profesional', span, { profesionalTexto: m[2] }, { referencia: { texto: m[1].trim() } }),
  },
  // "El blower lo hizo Claudia" / "El corte lo hizo Valery"
  {
    regex: /\bel\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2}?)\s+lo\s+hizo\s+([a-záéíóúñ]+)/gi,
    construir: (m, span) => crearAccion('asignar_profesional', span, { profesionalTexto: m[2] }, { referencia: { texto: m[1].trim() } }),
  },
  // Cliente: "cambia la clienta por María Pérez" (reemplazo explícito, nunca por oír un nombre
  // de pasada en una nota o al asignar un profesional).
  {
    regex: /\bcambia\s+la\s+clienta\s+por\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})/gi,
    construir: (m, span) => crearAccion('cambiar_cliente', span, { texto: m[1].trim() }),
  },
  { regex: /\bcrear?\s+(?:una\s+)?nueva\s+clienta\b/gi, construir: (_m, span) => crearAccion('crear_cliente', span) },
  { regex: /\bbusca\s+(?:el\s+)?tel[ée]fono\s+([\d\s]+)/gi, construir: (m, span) => crearAccion('buscar_cliente', span, { texto: m[1].replace(/\s+/g, '') }) },
  { regex: /\bbusca\s+a\s+(?:la\s+)?clienta?\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})/gi, construir: (m, span) => crearAccion('buscar_cliente', span, { texto: m[1].trim() }) },
  { regex: /\bbusca\s+a\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})/gi, construir: (m, span) => crearAccion('buscar_cliente', span, { texto: m[1].trim() }) },
  { regex: /\b(?:la\s+)?clienta\s+es\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})/gi, construir: (m, span) => crearAccion('buscar_cliente', span, { texto: m[1].trim() }) },
  { regex: /\bclienta\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})/gi, construir: (m, span) => crearAccion('buscar_cliente', span, { texto: m[1].trim() }) },
  { regex: /\bse\s+llama\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2})/gi, construir: (m, span) => crearAccion('completar_cliente_nuevo', span, { campo: 'nombre', valor: m[1].trim() }) },
  { regex: /\bsu\s+n[uú]mero\s+es\s+([\d\s]+)/gi, construir: (m, span) => crearAccion('completar_cliente_nuevo', span, { campo: 'telefono', valor: m[1].replace(/\s+/g, '') }) },

  // Cantidad de producto: "cambia la cantidad a dos". Debe correr ANTES que el patrón
  // genérico "cambia el/la X a Y" de abajo, si no "cantidad" se leería como si fuera el
  // nombre de un servicio.
  {
    regex: /\bcambia\s+la\s+cantidad\s+a\s+(\w+)/gi,
    construir: (m, span) => {
      const monto = extraerMonto(m[1])
      const cantidad = monto ? monto.valor : Number(m[1])
      if (!cantidad || Number.isNaN(cantidad)) return null
      return crearAccion('cambiar_cantidad_producto', span, { cantidad })
    },
  },

  // Precio: "el blower costó cuarenta y cinco mil" / "el corte cuesta 35000"
  {
    regex: /\bel\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2}?)\s+(?:cost[oó]|cuesta)\s+(.+?)(?=[.,]|\s+y\s+(?:un\b|una\b|el\b|la\b)|$)/gi,
    construir: (m, span) => leerAccionPrecio(m[2], span, { texto: m[1].trim() }),
  },
  // "Cambia el corte a treinta y cinco mil" (genérico: se corre DESPUÉS de clienta/profesional).
  {
    regex: /\bcambia\s+(?:el|la)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2}?)\s+a\s+(.+?)(?=[.,]|\s+y\s+(?:un\b|una\b|el\b|la\b)|$)/gi,
    construir: (m, span) => leerAccionPrecio(m[2], span, { texto: m[1].trim() }),
  },
  // "Cámbialo a cincuenta mil" — sin nombre: aplica al servicio activo si es inequívoco.
  {
    regex: /\bc[aá]mbialo\s+a\s+(.+?)(?=[.,]|$)/gi,
    construir: (m, span) => leerAccionPrecio(m[1], span, {}),
  },
  // "Ponle treinta y cinco mil al corte" / "Ponle treinta y cinco"
  {
    regex: /\bp[oó]nle\s+(.+?)(?:\s+al?\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2}))?(?=[.,]|$)/gi,
    construir: (m, span) => leerAccionPrecio(m[1], span, m[2] ? { texto: m[2].trim() } : {}),
  },

  // Quitar: "quita el segundo servicio" / "quita el corte" / "quita el champú"
  {
    regex: /\bquita\s+el\s+(primer|primero|segundo|tercer|tercero|cuarto)\s+servicio/gi,
    construir: (m, span) => crearAccion('quitar_linea', span, {}, { referencia: { posicionOrdinal: ORDINALES[sinTildes(m[1].toLowerCase())] } }),
  },
  {
    regex: /\bquita\s+(?:el|la)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3}?)(?=[.,]|$)/gi,
    construir: (m, span) => crearAccion('quitar_linea', span, {}, { referencia: { texto: m[1].trim() } }),
  },

  // Confirmaciones / control. El final usa un lookahead en vez de \b: \b considera "no
  // palabra" a una vocal acentuada (é), así que después de "terminé" nunca habría un límite
  // de palabra real y el patrón jamás encajaría.
  { regex: /\b(?:listo|termin[eé]|vamos\s+a\s+cobrar)(?=[.,]|\s|$)/gi, construir: (_m, span) => crearAccion('confirmar_listo', span) },
  { regex: /\bdeshacer(?:\s+(?:lo\s+)?[uú]ltimo(?:\s+cambio)?)?\b/gi, construir: (_m, span) => crearAccion('deshacer', span) },

  // Respuestas a una pregunta pendiente ("la primera", "el segundo", "2", "sí", "no").
  {
    regex: /\b(?:la|el)\s+(primera|primero|segunda|segundo|tercera|tercero|cuarta|cuarto)\b/gi,
    construir: (m, span) => crearAccion('responder_pregunta', span, { seleccion: m[1] }),
  },
  { regex: /^\s*(s[ií]|no)\s*\.?\s*$/gi, construir: (m, span) => crearAccion('responder_pregunta', span, { seleccion: m[1] }) },
  { regex: /^\s*(\d{1,2})\s*\.?\s*$/g, construir: (m, span) => crearAccion('responder_pregunta', span, { seleccion: m[1] }) },
]

function leerAccionPrecio(fragmentoMonto: string, span: string, referencia: ReferenciaLinea): AccionInterpretada | null {
  const monto = extraerMonto(fragmentoMonto)
  if (!monto) return null
  return crearAccion('fijar_precio_servicio', span, { monto }, { referencia: Object.keys(referencia).length ? referencia : undefined })
}

// Producto simple sin patrón "un/una … de …": "Agrega dos acondicionadores", "Quita el
// champú" ya cubierto arriba por 'quitar_linea'. La cantidad ("dos", "2") se lee con el mismo
// lector de números que los montos.
const PATRON_PRODUCTO_CANTIDAD = /\b(?:agrega|a[ñn]ade|agregar|a[ñn]adir)\s+(\w+)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,2}?)(?:\s+de\s+(.+?))?(?=[.,]|$)/gi

function extraerProductosSimples(ctx: Contexto) {
  let m: RegExpExecArray | null
  PATRON_PRODUCTO_CANTIDAD.lastIndex = 0
  while ((m = PATRON_PRODUCTO_CANTIDAD.exec(ctx.texto))) {
    const inicio = m.index
    const fin = m.index + m[0].length
    if (!estaLibre(ctx.mascara, inicio, fin)) continue
    const monto = extraerMonto(m[1])
    const cantidad = monto ? monto.valor : Number(m[1])
    if (!cantidad || Number.isNaN(cantidad)) continue // "un"/"una" ya los cubre el patrón compuesto
    const montoPrecio = m[3] ? extraerMonto(m[3]) : undefined
    agregar(
      ctx,
      crearAccion('agregar_servicio_o_producto', ctx.texto.slice(inicio, fin), { nombre: m[2].trim(), cantidad, monto: montoPrecio ?? undefined }),
      inicio,
      fin,
    )
  }
}

export function interpretarTexto(textoCrudo: string): AccionInterpretada[] {
  const { nota, restante } = extraerNota(textoCrudo)
  const ctx: Contexto = { texto: restante, mascara: new Array(restante.length).fill(false), acciones: [] }

  const tokens = tokenizar(restante)
  extraerServiciosCompuestos(ctx, tokens)
  extraerProductosSimples(ctx)

  for (const patron of PATRONES) {
    let m: RegExpExecArray | null
    patron.regex.lastIndex = 0
    while ((m = patron.regex.exec(ctx.texto))) {
      const inicio = m.index
      const fin = m.index + m[0].length
      if (fin === inicio) { patron.regex.lastIndex++; continue }
      if (!estaLibre(ctx.mascara, inicio, fin)) continue
      const accion = patron.construir(m, ctx.texto.slice(inicio, fin))
      if (accion) agregar(ctx, accion, inicio, fin)
    }
  }

  // Lo que nadie reclamó: se agrupa por tramos contiguos sin marcar y, si tiene contenido
  // real (no solo conectores sueltos), se ofrece como "no reconocido" para editar a mano —
  // nunca se ejecuta una interpretación forzada de algo que no encajó en ningún patrón.
  let i = 0
  const sobrantes: AccionInterpretada[] = []
  while (i < ctx.mascara.length) {
    if (ctx.mascara[i]) { i++; continue }
    let j = i
    while (j < ctx.mascara.length && !ctx.mascara[j]) j++
    const fragmento = ctx.texto.slice(i, j).trim()
    if (esFragmentoSignificativo(fragmento)) {
      sobrantes.push(crearAccion('no_reconocido', fragmento, { texto: fragmento }, { estado: 'necesita_aclaracion' }))
    }
    i = j
  }

  const resultado = [...ctx.acciones].sort((a, b) => textoCrudo.indexOf(a.textoOriginal) - textoCrudo.indexOf(b.textoOriginal))
  if (nota) resultado.push(nota)
  resultado.push(...sobrantes)
  return resultado
}
