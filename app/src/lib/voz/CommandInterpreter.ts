// Capa de interpretación: convierte UNA expresión completa (hablada o escrita) en un
// ParsedAttentionCommand tipado. Nunca toca Supabase, nunca ejecuta nada — eso es
// responsabilidad de EntityResolver y del VoiceExecutionService, más adelante en el pipeline
// (VOICE → STT → NORMALIZATION → COMMAND INTERPRETER → ENTITY RESOLUTION → VALIDATION → DRAFT
// → USER CONFIRMATION → EXECUTION).
//
// Diseño deliberado (fix de la causa raíz de los bugs reportados): la frase NO se separa
// primero por "y"/comas. En vez de eso, se recorre UNA sola vez buscando "anclas" — verbos y
// conectores reales del español que marcan dónde empieza cada pieza de información (cliente,
// servicio, profesional, colaborador, compensación, precio, producto, corrección, control) — y
// las anclas mismas definen dónde termina cada tramo. Así "clienta Verónica, se hizo un
// blower..." nunca captura "Verónica se hizo" como nombre: el ancla de servicio ("se hizo")
// corta el tramo del cliente justo antes de sí misma, no después de contar N palabras.

import { ORDINALES, esPalabraNumero, extraerMonto, leerMontoDesdeTokens, pareceTelefono, sinTildes } from './MoneyNormalizer'
import type {
  CommandInterpreter,
  CorrectionField,
  InterpreterInput,
  ParsedAttentionCommand,
  ParsedCollaboratorRef,
  ParsedProductRef,
  ParsedServiceRef,
  VoiceCorrection,
  VoiceIntent,
} from './schema'

// --- Tokenización ------------------------------------------------------------------------

interface Token {
  raw: string
  norm: string
  start: number
  end: number
}

function tokenizar(texto: string): Token[] {
  const tokens: Token[] = []
  const re = /[^\s]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) {
    const crudo = m[0]
    const limpio = crudo.replace(/^[¿¡"'“”(]+|[?!."'“”),;:]+$/g, '')
    tokens.push({ raw: crudo, norm: sinTildes(limpio.toLowerCase()), start: m.index, end: m.index + crudo.length })
  }
  return tokens
}

// Palabras sin contenido propio: nunca forman parte de un nombre propio ni de un límite útil.
// "tambien" incluida a propósito (sección "referencias contextuales" del pedido): "también Ana
// ayudó" no debe robarse "también" como si fuera parte del nombre de la colaboradora.
const CONECTORES = new Set(['y', 'la', 'el', 'los', 'las', 'un', 'una', 'de', 'del', 'a', 'con', 'se', 'lo', 'que', 'le', 'al', 'tambien'])

// --- Anclas --------------------------------------------------------------------------------
// Cada ancla es una secuencia de 1-3 tokens normalizados. `reverse: true` significa que el
// dato relevante (un nombre propio) va ANTES del ancla, no después ("Ana colaboró", "Valery
// hizo el corte") — se resuelve en resolverLimitesClausula().

type TipoClausula =
  | 'CLIENTE' | 'CLIENTE_CREAR' | 'CLIENTE_CAMBIAR'
  | 'SERVICIO'
  | 'PROFESIONAL' | 'PROFESIONAL_REVERSO'
  | 'COLABORADOR' | 'COLABORADOR_REVERSO'
  | 'COMPENSACION'
  | 'PRECIO_SERVICIO_COSTO' // "el corte costó/cuesta X"
  | 'PRECIO_CAMBIAR' // "cambia el corte a X" / "ponle X al corte"
  | 'PRODUCTO'
  | 'QUITAR'
  | 'QUITAR_COLABORADOR' // "quita a Ana del blower" — distinto de QUITAR (que quita el servicio/producto entero)
  | 'CORRECCION_NO_FUE'
  | 'NOTA'
  | 'CONTROL_CONFIRMAR'
  | 'CONTROL_CANCELAR'
  | 'CONTROL_DESHACER'
  | 'RESPUESTA'

interface DefinicionAncla {
  tokens: string[]
  tipo: TipoClausula
  reverse?: boolean
  /** Máximo de tokens hacia atrás a incluir para una ancla reversa (nombre propio). */
  maxNombreReverso?: number
}

const ANCLAS: DefinicionAncla[] = [
  // Control — van primero: máxima prioridad, frases cortas.
  { tokens: ['vamos', 'a', 'cobrar'], tipo: 'CONTROL_CONFIRMAR' },
  { tokens: ['confirmar'], tipo: 'CONTROL_CONFIRMAR' },
  { tokens: ['confirma'], tipo: 'CONTROL_CONFIRMAR' },
  { tokens: ['guardalo'], tipo: 'CONTROL_CONFIRMAR' },
  { tokens: ['registrar'], tipo: 'CONTROL_CONFIRMAR' },
  { tokens: ['listo'], tipo: 'CONTROL_CONFIRMAR' },
  { tokens: ['termine'], tipo: 'CONTROL_CONFIRMAR' },
  { tokens: ['terminee'], tipo: 'CONTROL_CONFIRMAR' },
  { tokens: ['cancelar'], tipo: 'CONTROL_CANCELAR' },
  { tokens: ['cancela'], tipo: 'CONTROL_CANCELAR' },
  { tokens: ['deshaz'], tipo: 'CONTROL_DESHACER' },
  { tokens: ['deshacer'], tipo: 'CONTROL_DESHACER' },

  // Cliente
  { tokens: ['cambia', 'la', 'clienta', 'por'], tipo: 'CLIENTE_CAMBIAR' },
  { tokens: ['crear', 'nueva', 'clienta'], tipo: 'CLIENTE_CREAR' },
  { tokens: ['crea', 'nueva', 'clienta'], tipo: 'CLIENTE_CREAR' },
  { tokens: ['crea', 'una', 'clienta'], tipo: 'CLIENTE_CREAR' },
  { tokens: ['crea', 'a'], tipo: 'CLIENTE_CREAR' },
  { tokens: ['busca', 'el', 'telefono'], tipo: 'CLIENTE' },
  { tokens: ['busca', 'a', 'la', 'clienta'], tipo: 'CLIENTE' },
  { tokens: ['busca', 'la', 'clienta'], tipo: 'CLIENTE' },
  { tokens: ['busca', 'a'], tipo: 'CLIENTE' },
  { tokens: ['atiende', 'a'], tipo: 'CLIENTE' },
  { tokens: ['la', 'clienta', 'es'], tipo: 'CLIENTE' },
  { tokens: ['clienta', 'es'], tipo: 'CLIENTE' },
  { tokens: ['clienta'], tipo: 'CLIENTE' },
  { tokens: ['atiende'], tipo: 'CLIENTE' },

  // Servicio — "un/una" bare va al final (menor prioridad: solo si nada más calzó antes).
  { tokens: ['se', 'hizo'], tipo: 'SERVICIO' },
  { tokens: ['le', 'hicimos'], tipo: 'SERVICIO' },
  { tokens: ['hicimos'], tipo: 'SERVICIO' },
  { tokens: ['hazle'], tipo: 'SERVICIO' },
  { tokens: ['agrega'], tipo: 'SERVICIO' },
  // Formas conjugadas reales del habla ("agregó un champú", nunca solo el imperativo/infinitivo
  // que ya cubrían las líneas de arriba) — sin tilde porque sinTildes() ya normalizó el token.
  { tokens: ['agrego'], tipo: 'SERVICIO' },
  { tokens: ['anadio'], tipo: 'SERVICIO' },
  { tokens: ['anade'], tipo: 'SERVICIO' },
  { tokens: ['agregar'], tipo: 'SERVICIO' },
  { tokens: ['anadir'], tipo: 'SERVICIO' },

  // Profesional. "lo hizo"/"hecho por"/"con" traen el nombre DESPUÉS del ancla ("El blower lo
  // hizo Claudia"); "hizo el/la" es al revés, el nombre va ANTES ("Valery hizo el blower").
  { tokens: ['lo', 'hizo'], tipo: 'PROFESIONAL' },
  { tokens: ['hecho', 'por'], tipo: 'PROFESIONAL' },
  { tokens: ['hizo', 'el'], tipo: 'PROFESIONAL_REVERSO', reverse: true, maxNombreReverso: 2 },
  { tokens: ['hizo', 'la'], tipo: 'PROFESIONAL_REVERSO', reverse: true, maxNombreReverso: 2 },
  { tokens: ['con'], tipo: 'PROFESIONAL' },

  // Colaborador
  { tokens: ['colaboro'], tipo: 'COLABORADOR_REVERSO', reverse: true, maxNombreReverso: 2 },
  { tokens: ['ayudo'], tipo: 'COLABORADOR_REVERSO', reverse: true, maxNombreReverso: 2 },
  { tokens: ['participo'], tipo: 'COLABORADOR_REVERSO', reverse: true, maxNombreReverso: 2 },

  // Compensación
  { tokens: ['tuvo', 'una', 'ganancia', 'de'], tipo: 'COMPENSACION' },
  { tokens: ['tiene', 'una', 'ganancia', 'de'], tipo: 'COMPENSACION' },
  { tokens: ['tiene', 'una', 'comision', 'de'], tipo: 'COMPENSACION' },
  { tokens: ['tiene', 'comision', 'de'], tipo: 'COMPENSACION' },
  { tokens: ['se', 'gano'], tipo: 'COMPENSACION' },
  { tokens: ['se', 'gana'], tipo: 'COMPENSACION' },
  { tokens: ['gano'], tipo: 'COMPENSACION' },
  { tokens: ['gana'], tipo: 'COMPENSACION' },
  { tokens: ['le', 'tocan'], tipo: 'COMPENSACION' },

  // Precio (corrección / consulta directa)
  { tokens: ['costo'], tipo: 'PRECIO_SERVICIO_COSTO' },
  { tokens: ['cuesta'], tipo: 'PRECIO_SERVICIO_COSTO' },
  { tokens: ['ponle'], tipo: 'PRECIO_CAMBIAR' },
  { tokens: ['cambia', 'el', 'precio', 'a'], tipo: 'PRECIO_CAMBIAR' },

  // Quitar. "quita a" (colaboradora) tiene prioridad sobre "quita" a secas (servicio/producto)
  // por ser más larga — el orden en ANCLAS_ORDENADAS ya se encarga de eso.
  { tokens: ['quita', 'a'], tipo: 'QUITAR_COLABORADOR' },
  { tokens: ['quita'], tipo: 'QUITAR' },
  { tokens: ['elimina'], tipo: 'QUITAR' },
  { tokens: ['borra'], tipo: 'QUITAR' },

  // Corrección genérica: "no fue X, fue Y" / "en realidad..."
  { tokens: ['no', 'fue'], tipo: 'CORRECCION_NO_FUE' },
  { tokens: ['no', 'fueron'], tipo: 'CORRECCION_NO_FUE' },
  { tokens: ['en', 'realidad'], tipo: 'CORRECCION_NO_FUE' },

  // Nota
  { tokens: ['agrega', 'una', 'nota'], tipo: 'NOTA' },
  { tokens: ['anade', 'una', 'nota'], tipo: 'NOTA' },

  // Cambiar precio genérico "cambia el X a Y" (menor prioridad que las formas específicas de
  // arriba, para no competir con "cambia la clienta por"/"cambia el precio a").
  { tokens: ['cambia'], tipo: 'PRECIO_CAMBIAR' },

  // Producto — verbos específicos de producto tienen prioridad; "agrega"/"un" ya cubiertos por
  // SERVICIO arriba, la distinción servicio/producto se resuelve en EntityResolver (sección 10
  // del pedido: "todas pueden significar ADD_SERVICE", y el mismo criterio aplica a producto).
  { tokens: ['usaron'], tipo: 'PRODUCTO' },
  { tokens: ['pon'], tipo: 'PRODUCTO' },

  // Artículo desnudo: última red — cualquier "un/una" que no fue reclamado por nada más
  // arriba se trata como el inicio de un servicio (o producto, decidido después).
  { tokens: ['un'], tipo: 'SERVICIO' },
  { tokens: ['una'], tipo: 'SERVICIO' },

  // Respuesta corta a una aclaración pendiente.
  { tokens: ['si'], tipo: 'RESPUESTA' },
  { tokens: ['no'], tipo: 'RESPUESTA' },
]

// Ordenar por longitud descendente: en una misma posición, "busca la clienta" debe ganarle a
// "busca a" y a "clienta" sueltos.
const ANCLAS_ORDENADAS = [...ANCLAS].sort((a, b) => b.tokens.length - a.tokens.length)

interface MatchAncla {
  def: DefinicionAncla
  tokenStart: number // índice del primer token del ancla (antes de ajustar por reverse)
  tokenEnd: number // índice exclusivo tras el último token del ancla
}

function coincideEn(tokens: Token[], idx: number, secuencia: string[]): boolean {
  if (idx + secuencia.length > tokens.length) return false
  for (let i = 0; i < secuencia.length; i++) {
    if (tokens[idx + i].norm !== secuencia[i]) return false
  }
  return true
}

function encontrarAnclas(tokens: Token[]): MatchAncla[] {
  const ocupado = new Array(tokens.length).fill(false)
  const matches: MatchAncla[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (ocupado[i]) continue
    for (const def of ANCLAS_ORDENADAS) {
      if (coincideEn(tokens, i, def.tokens)) {
        matches.push({ def, tokenStart: i, tokenEnd: i + def.tokens.length })
        for (let j = i; j < i + def.tokens.length; j++) ocupado[j] = true
        break
      }
    }
  }
  return matches.sort((a, b) => a.tokenStart - b.tokenStart)
}

// --- Cláusulas: cada ancla define dónde EMPIEZA su tramo de datos; el tramo termina donde
// empieza la siguiente ancla. Para anclas "reverse" (nombre antes del verbo), se le "roban"
// hasta `maxNombreReverso` tokens de nombre propio al final del tramo anterior. ---

interface Clausula {
  tipo: TipoClausula
  tokenDatosStart: number // primer token de DATOS de esta cláusula (tras el propio ancla, salvo reverse)
  tokenDatosEnd: number // exclusivo
  tokenAnclaStart: number
  tokenAnclaEnd: number
}

function esTokenLibreParaNombre(tokens: Token[], idx: number, anclas: MatchAncla[]): boolean {
  if (idx < 0) return false
  // "y" nunca forma parte de un nombre robado hacia atrás — es el conector ENTRE dos
  // cláusulas ("... con Valery Y Ana colaboró"), no parte de "Ana".
  if (CONECTORES.has(tokens[idx].norm)) return false
  // Un token con puntuación de cierre en el texto CRUDO ("Valery,", "Valery.") es el ÚLTIMO
  // token de la cláusula anterior — nunca se roba hacia atrás cruzando esa puntuación (si no,
  // "...con Valery, Ana colaboró" terminaría robándose "Valery," entero para el nombre de Ana).
  // La normalización (`.norm`) la quita a propósito para el resto de comparaciones, así que
  // aquí se mira el texto crudo en su lugar.
  if (/[.,!?;:]$/.test(tokens[idx].raw)) return false
  return !anclas.some((a) => idx >= a.tokenStart && idx < a.tokenEnd)
}

function construirClausulas(tokens: Token[], anclas: MatchAncla[]): Clausula[] {
  const clausulas: Clausula[] = anclas.map((a, i) => ({
    tipo: a.def.tipo,
    tokenAnclaStart: a.tokenStart,
    tokenAnclaEnd: a.tokenEnd,
    tokenDatosStart: a.def.reverse ? a.tokenStart : a.tokenEnd,
    tokenDatosEnd: i + 1 < anclas.length ? anclas[i + 1].tokenStart : tokens.length,
  }))

  // Ajuste reverso: robarle al tramo ANTERIOR los tokens de nombre propio que en realidad son
  // el sujeto de esta ancla ("Ana colaboró": "Ana" pertenece a esta cláusula, no a la anterior).
  for (let i = 0; i < clausulas.length; i++) {
    const def = anclas[i].def
    if (!def.reverse) continue
    let inicioNombre = anclas[i].tokenStart
    let restantes = def.maxNombreReverso ?? 2
    while (restantes > 0 && esTokenLibreParaNombre(tokens, inicioNombre - 1, anclas)) {
      inicioNombre--
      restantes--
    }
    clausulas[i].tokenDatosStart = inicioNombre
    if (i > 0) clausulas[i - 1].tokenDatosEnd = Math.min(clausulas[i - 1].tokenDatosEnd, inicioNombre)
  }

  return clausulas
}

function textoDeRango(tokens: Token[], start: number, end: number): string {
  if (start >= end || start < 0 || end > tokens.length) return ''
  return tokens.slice(start, end).map((t) => t.raw).join(' ').replace(/^[.,]+|[.,]+$/g, '').trim()
}

function tokensNormDeRango(tokens: Token[], start: number, end: number): string[] {
  return tokens.slice(Math.max(0, start), Math.max(0, end)).map((t) => t.norm)
}

// --- Extractores por tipo de cláusula --------------------------------------------------------

function limpiarNombrePropio(texto: string): string {
  return texto.replace(/^(a|la|el|una?)\s+/i, '').trim()
}

// Relleno puro de continuación que nunca es, por sí solo, el nombre de la clienta: "también",
// "y", "ella"/"el" (pronombre, no artículo). Si tras quitarlo no queda nada, el preámbulo entero
// era relleno — no hay nombre nuevo que extraer (ver uso en CLAVES_SUJETO_IMPLICITO).
const PALABRAS_SUJETO_VACIO = new Set(['ella', 'el', 'tambien', 'y'])

function limpiarPreambuloSujeto(tokens: Token[], start: number, end: number): string | undefined {
  let i = start
  while (i < end && PALABRAS_SUJETO_VACIO.has(tokens[i].norm)) i++
  const texto = limpiarNombrePropio(textoDeRango(tokens, i, end))
  return texto || undefined
}

// Palabras que en este salón casi siempre son un producto, no un servicio de catálogo — mismo
// criterio que usaba el formulario manual (categorías sugeridas del <datalist>). Es solo una
// pista rápida para no crear un "servicio" con nombre "champú"; la ambigüedad real de nombres
// que no calzan aquí la resuelve EntityResolver contra el catálogo de Supabase.
const PALABRAS_PRODUCTO_CONOCIDAS = ['champu', 'tinte', 'acondicionador', 'tratamiento', 'mascarilla', 'keratina', 'shampoo', 'serum', 'aceite']

function esProbablementeProducto(nombre: string): boolean {
  const norm = sinTildes(nombre.toLowerCase())
  return PALABRAS_PRODUCTO_CONOCIDAS.some((p) => norm.includes(p))
}

export function interpretarUtterance(rawText: string, utteranceId: string): ParsedAttentionCommand {
  const texto = rawText.trim()
  const tokens = tokenizar(texto)
  const ambiguedades: string[] = []
  const camposFaltantes: string[] = []
  const correcciones: VoiceCorrection[] = []

  if (tokens.length === 0) {
    return vacioComando(utteranceId, rawText)
  }

  const anclas = encontrarAnclas(tokens)
  if (anclas.length === 0) {
    return {
      ...vacioComando(utteranceId, rawText),
      ambiguities: [rawText],
      confidence: 0,
    }
  }

  const clausulas = construirClausulas(tokens, anclas)

  const servicios: ParsedServiceRef[] = []
  const productos: ParsedProductRef[] = []
  let cliente: ParsedAttentionCommand['client'] | undefined
  let nota: string | undefined
  let removerColaborador: ParsedAttentionCommand['removeCollaborator']
  let intentPrincipal: VoiceIntent = 'UNKNOWN'
  // Nota de TypeScript: la mutación de estas dos variables ocurre siempre EN EL MISMO ámbito
  // que su lectura (nunca dentro de una función auxiliar) — a propósito, para que el análisis
  // de flujo de control pueda angostar `servicioActivo`/`colaboradorActivo` correctamente en
  // cada `if`; delegar la asignación a una función separada le hace perder el rastro y angosta
  // el tipo a `never`.
  let servicioActivo: ParsedServiceRef | null = null
  let colaboradorActivo: ParsedCollaboratorRef | null = null

  function crearServicio(query?: string): ParsedServiceRef {
    const s: ParsedServiceRef = { query, collaborators: [] }
    servicios.push(s)
    return s
  }

  // Sujeto implícito: "Verónica se hizo un blower" nombra a la clienta SIN ningún verbo de
  // búsqueda ("busca"/"clienta"/"atiende") — es sujeto directo de "se hizo"/"hicimos". Si la
  // PRIMERA ancla de toda la frase es una de estas y hay texto sin reclamar justo antes, ese
  // texto es el nombre de la clienta (nunca se activa a mitad de frase: ahí "Ana colaboró" ya
  // tiene su propio manejo específico, y confundir un sujeto de servicio con otra cosa a mitad
  // de frase sería mucho más arriesgado que al principio).
  const CLAVES_SUJETO_IMPLICITO = new Set(['se hizo', 'le hicimos', 'hicimos'])
  if (anclas[0].tokenStart > 0 && anclas[0].def.tipo === 'SERVICIO' && CLAVES_SUJETO_IMPLICITO.has(anclas[0].def.tokens.join(' '))) {
    // El preámbulo puede ser puro relleno de continuación ("también ella se hizo...", "y
    // ella también se hizo...") en vez de un nombre real — en ese caso NO se toca `cliente`, así
    // la clienta activa de la sesión sigue siendo la misma (ver VoiceExecutionService: cuando
    // `client` queda undefined, el draft.client existente no se pisa).
    const preambulo = limpiarPreambuloSujeto(tokens, 0, anclas[0].tokenStart)
    if (preambulo) cliente = { query: preambulo }
  }

  for (const c of clausulas) {
    const datosTexto = textoDeRango(tokens, c.tokenDatosStart, c.tokenDatosEnd)
    const datosTokensNorm = tokensNormDeRango(tokens, c.tokenDatosStart, c.tokenDatosEnd)

    switch (c.tipo) {
      case 'CONTROL_CONFIRMAR':
        intentPrincipal = 'CONFIRM'
        break
      case 'CONTROL_CANCELAR':
        intentPrincipal = 'CANCEL'
        break
      case 'CONTROL_DESHACER':
        intentPrincipal = 'UNDO'
        break
      case 'RESPUESTA':
        if (clausulas.length === 1) intentPrincipal = 'CONFIRM' // "sí"/"no" solos se resuelven como respuesta a la aclaración visible, ver VoiceExecutionService
        break

      case 'CLIENTE_CREAR': {
        // El propio tramo puede traer "teléfono NNN" pegado al nombre en la MISMA cláusula
        // ("Crea a Verónica, teléfono 3001234567") — nunca dispara una segunda ancla CLIENTE
        // aparte, así que el teléfono se separa aquí mismo (mismo patrón que CLIENTE más abajo).
        const matchTelefono = datosTexto.match(/tel[ée]fono\s+([\d\s]+)/i)
        const nombre = limpiarNombrePropio((matchTelefono ? datosTexto.slice(0, matchTelefono.index) : datosTexto).trim().replace(/[,.]+$/, '').trim())
        const telefono = matchTelefono ? matchTelefono[1].replace(/\s+/g, '') : undefined
        cliente = { createName: nombre || undefined, createPhone: telefono }
        if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'CREATE_CLIENT'
        break
      }
      case 'CLIENTE_CAMBIAR':
      case 'CLIENTE': {
        // Puede venir "3001234567" (teléfono) o un nombre. Si además trae "teléfono NNN" dentro
        // del mismo tramo (p. ej. "Crea a Verónica, teléfono 3001234567"), se separa el teléfono.
        const matchTelefono = datosTexto.match(/tel[ée]fono\s+([\d\s]+)/i)
        let nombre = datosTexto
        let telefono: string | undefined
        if (matchTelefono) {
          telefono = matchTelefono[1].replace(/\s+/g, '')
          nombre = datosTexto.slice(0, matchTelefono.index).trim().replace(/[,.]+$/, '').trim()
        } else if (pareceTelefono(datosTexto)) {
          telefono = datosTexto.replace(/\D/g, '')
          nombre = ''
        }
        nombre = limpiarNombrePropio(nombre)
        if (cliente?.createName) {
          // Ya estábamos creando una clienta (CLIENTE_CREAR) y esta cláusula añade su teléfono.
          cliente.createPhone = telefono
        } else {
          cliente = { query: nombre || undefined, phone: telefono }
          if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'FIND_CLIENT'
        }
        break
      }

      case 'SERVICIO': {
        // Puede traer "de/por MONTO" y "con PROFESIONAL" dentro del mismo tramo de datos. Un
        // nombre que suena a producto conocido ("champú", "tinte"...) se separa aquí mismo —
        // el resto de la ambigüedad real (un nombre que no es ni un producto obvio ni todavía
        // se sabe si existe como servicio) la resuelve EntityResolver contra el catálogo real.
        const { nombre, monto, profesionalTexto, restanteIdx } = extraerServicioDelTramo(tokens, c.tokenDatosStart, c.tokenDatosEnd)
        if (!nombre) break
        void restanteIdx
        // Sustantivo genérico ("un SERVICIO", "un PRODUCTO") en vez de un nombre real — la
        // persona describió precio/profesional pero todavía no dijo QUÉ servicio o producto es
        // (sección "información incompleta / slot filling" del pedido). Se guarda lo que sí se
        // sabe y se marca para preguntar solo el nombre, en vez de tratar la palabra "servicio"
        // como si fuera el nombre real de un servicio a buscar en el catálogo.
        const nombreNorm = sinTildes(nombre.toLowerCase()).trim()
        if (nombreNorm === 'producto' || nombreNorm === 'productos') {
          productos.push({ queryUnknown: true, price: monto?.valor })
          intentPrincipal = intentPrincipal === 'UNKNOWN' ? 'ADD_PRODUCT' : 'REGISTER_ATTENTION'
          break
        }
        if (esProbablementeProducto(nombre) && !profesionalTexto) {
          productos.push({ query: nombre, price: monto?.valor })
          intentPrincipal = intentPrincipal === 'UNKNOWN' ? 'ADD_PRODUCT' : 'REGISTER_ATTENTION'
          break
        }
        const esNombreGenericoServicio = nombreNorm === 'servicio' || nombreNorm === 'servicios'
        const s = crearServicio(esNombreGenericoServicio ? undefined : nombre)
        if (esNombreGenericoServicio) s.queryUnknown = true
        servicioActivo = s
        colaboradorActivo = null
        if (monto) { s.price = monto.valor; s.priceAmbiguous = monto.ambiguo }
        if (profesionalTexto) s.professional = { query: profesionalTexto }
        if (intentPrincipal === 'UNKNOWN' || intentPrincipal === 'FIND_CLIENT') {
          intentPrincipal = cliente || servicios.length > 1 ? 'REGISTER_ATTENTION' : 'ADD_SERVICE'
        } else {
          intentPrincipal = 'REGISTER_ATTENTION'
        }
        break
      }

      case 'PROFESIONAL': {
        // Nombre DESPUÉS del ancla ("con Valery", "lo hizo Claudia", "hecho por Ana"). El tramo
        // de datos puede traer MÁS que el nombre (p. ej. "con Claudia Patricia de 45 mil y
        // agregó..." — el precio vino DESPUÉS del profesional en vez de antes) — se acota el
        // nombre y, si sobra un "de/por MONTO" en el resto del tramo, se rescata como precio del
        // servicio en curso en vez de tragárselo entero como si fuera parte del nombre.
        const { nombre: nombreProf, alternativa: nombreProfAlt, monto: montoTrasNombre } = extraerNombrePropioYPrecioDelTramo(tokens, c.tokenDatosStart, c.tokenDatosEnd)
        if (!nombreProf) break
        if (servicioActivo) {
          servicioActivo.professional = { query: nombreProf, queryAlternativo: nombreProfAlt }
          if (montoTrasNombre && servicioActivo.price == null) {
            servicioActivo.price = montoTrasNombre.valor
            servicioActivo.priceAmbiguous = montoTrasNombre.ambiguo
          }
        } else {
          // "El blower lo hizo Claudia": no hay servicio activo EN ESTA FRASE porque el nombre
          // del servicio vino antes del ancla — se recupera mirando hacia atrás, igual que
          // PRECIO_SERVICIO_COSTO ("el corte costó...").
          const posibleServicio = limpiarNombrePropio(textoDeRango(tokens, Math.max(0, c.tokenAnclaStart - 4), c.tokenAnclaStart))
          if (posibleServicio) {
            const s = crearServicio(posibleServicio)
            s.professional = { query: nombreProf }
            servicioActivo = s
            colaboradorActivo = null
          } else {
            correcciones.push({ field: 'service_professional', value: nombreProf })
            if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'SET_PROFESSIONAL'
          }
        }
        break
      }

      case 'PROFESIONAL_REVERSO': {
        // Nombre ANTES del ancla, servicio DESPUÉS ("Valery hizo el blower").
        const nombreProf = limpiarNombrePropio(textoDeRango(tokens, c.tokenDatosStart, c.tokenAnclaStart))
        const nombreServicio = limpiarNombrePropio(textoDeRango(tokens, c.tokenAnclaEnd, c.tokenDatosEnd))
        if (!nombreProf) break
        if (servicioActivo && !nombreServicio) {
          servicioActivo.professional = { query: nombreProf }
        } else if (nombreServicio) {
          const s = crearServicio(nombreServicio)
          s.professional = { query: nombreProf }
          servicioActivo = s
          colaboradorActivo = null
        } else {
          correcciones.push({ field: 'service_professional', value: nombreProf })
          if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'SET_PROFESSIONAL'
        }
        break
      }

      case 'COLABORADOR_REVERSO': {
        // Nombre ANTES del ancla ("Ana colaboró"); el servicio ("en el blower") y la
        // compensación ("por 10 mil" / "de 10 mil") pueden venir DESPUÉS, en cualquier orden
        // relativo entre sí, dentro del mismo tramo — se extraen juntos para que "colaboró en
        // el blower y tuvo una ganancia de 10.000" nunca se pierda (causa raíz del bug original).
        const nombreColab = limpiarNombrePropio(textoDeRango(tokens, c.tokenDatosStart, c.tokenAnclaStart))
        if (!nombreColab) break
        const { servicioQuery, monto } = extraerColaboradorDelTramo(tokens, c.tokenAnclaEnd, c.tokenDatosEnd)
        const colab: ParsedCollaboratorRef = { query: nombreColab }
        if (monto) {
          colab.compensation = monto.ambiguo ? monto.valorSugerido : monto.valor
          colab.compensationAmbiguous = monto.ambiguo
          colab.compensationType = 'fixed'
        }
        colaboradorActivo = colab
        if (servicioActivo && !servicioQuery) {
          servicioActivo.collaborators.push(colab)
        } else {
          // "Ana colaboró en el blower" sin servicio nuevo en esta frase (o con uno explícito
          // vía "en el X"): se agrega como servicio propio — si `servicioQuery` queda vacío, se
          // resuelve más adelante contra el servicio activo del contexto de sesión.
          const s = crearServicio(servicioQuery)
          s.collaborators.push(colab)
          servicioActivo = s
        }
        if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'ADD_COLLABORATOR'
        else if (intentPrincipal !== 'REGISTER_ATTENTION') intentPrincipal = 'REGISTER_ATTENTION'
        break
      }

      case 'COMPENSACION': {
        const monto = extraerMonto(datosTexto)
        if (!monto) { ambiguedades.push(`compensación sin monto claro: "${datosTexto}"`); break }
        if (colaboradorActivo) {
          colaboradorActivo.compensation = monto.ambiguo ? monto.valorSugerido : monto.valor
          colaboradorActivo.compensationAmbiguous = monto.ambiguo
          colaboradorActivo.compensationType = 'fixed'
        } else {
          correcciones.push({ field: 'collaborator_compensation', value: monto.ambiguo ? monto.valorSugerido! : monto.valor })
          if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'UPDATE_COLLABORATOR_COMPENSATION'
        }
        break
      }

      case 'PRECIO_SERVICIO_COSTO': {
        // "el corte costó 35 mil" — el NOMBRE del servicio está en el tramo anterior a "costó"
        // (esta ancla no es reverse porque el patrón léxico ya se resuelve distinto: se busca
        // hacia atrás en la misma cláusula ancla, tomando el tramo previo completo como
        // referencia del servicio si no hay servicio activo en esta frase).
        const monto = extraerMonto(datosTexto)
        const nombreServicioPrevio = textoDeRango(tokens, Math.max(0, c.tokenAnclaStart - 4), c.tokenAnclaStart)
        if (monto) {
          correcciones.push({ field: 'service_price', value: monto.ambiguo ? monto.valorSugerido! : monto.valor, targetQuery: limpiarNombrePropio(nombreServicioPrevio) || undefined })
          if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'UPDATE_SERVICE'
        }
        break
      }

      case 'PRECIO_CAMBIAR': {
        // "cambia el corte a 35 mil" / "ponle 35 mil al corte" / "cambia el precio a 50 mil"
        const monto = extraerMonto(datosTexto)
        let objetivo = extraerObjetivoDePrecio(datosTexto, datosTokensNorm)
        if (monto) {
          correcciones.push({ field: 'service_price', value: monto.ambiguo ? monto.valorSugerido! : monto.valor, targetQuery: objetivo })
          if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'UPDATE_SERVICE'
        }
        break
      }

      case 'QUITAR': {
        const objetivo = limpiarNombrePropio(datosTexto)
        const ordinalMatch = sinTildes(objetivo.toLowerCase()).match(/^(primer|primero|segundo|tercer|tercero|cuarto|ultimo|ultima)\b/)
        const esServicioPalabra = /\bservicio\b/i.test(objetivo)
        const prod: ParsedProductRef = {}
        const serv: ParsedServiceRef = { collaborators: [] }
        if (ordinalMatch) {
          const ord = ORDINALES[ordinalMatch[1]]
          if (ord === -1) { serv.refersToLast = true; prod.refersToLast = true } else { serv.ordinal = ord; prod.ordinal = ord }
        } else {
          const nombreLimpio = objetivo.replace(/\b(el|la)\s+servicio\b/i, '').trim()
          serv.query = nombreLimpio || undefined
          prod.query = nombreLimpio || undefined
        }
        void esServicioPalabra
        // No sabemos todavía si es servicio o producto — EntityResolver decide contra el draft
        // real; aquí se deja evidencia de ambas intenciones posibles y gana la que sí resuelva.
        servicios.push(serv)
        productos.push(prod)
        intentPrincipal = 'REMOVE_SERVICE'
        break
      }

      case 'QUITAR_COLABORADOR': {
        // "Quita a Ana del blower" / "Quita a Ana de el corte" / "Quita a Ana" (sin servicio
        // explícito — se resuelve contra el servicio activo del contexto de sesión).
        const m = datosTexto.match(/^([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)\s+de(?:l)?\s+(?:la\s+)?(.+)$/i)
        if (m) {
          removerColaborador = { collaboratorQuery: limpiarNombrePropio(m[1]), serviceQuery: limpiarNombrePropio(m[2]) }
        } else {
          const nombre = limpiarNombrePropio(datosTexto)
          if (nombre) removerColaborador = { collaboratorQuery: nombre }
        }
        intentPrincipal = 'REMOVE_COLLABORATOR'
        break
      }

      case 'CORRECCION_NO_FUE': {
        // "No fue Valery, fue Claudia" / "No fueron 10 mil, fueron 15 mil" / "En realidad Ana
        // ganó 15 mil". El valor NUEVO puede venir tras una coma ("fue Claudia") o ser el único
        // dato de la cláusula si la persona no repite el verbo.
        const partes = datosTexto.split(/,|\bfue\b|\bfueron\b/i).map((p) => p.trim()).filter(Boolean)
        const valorNuevoTexto = partes[partes.length - 1] ?? datosTexto
        const monto = extraerMonto(valorNuevoTexto)
        if (monto) {
          correcciones.push({ field: 'collaborator_compensation', value: monto.ambiguo ? monto.valorSugerido! : monto.valor })
          if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'UPDATE_COLLABORATOR_COMPENSATION'
        } else {
          const nombre = limpiarNombrePropio(valorNuevoTexto)
          if (nombre) {
            correcciones.push({ field: 'service_professional', value: nombre })
            if (intentPrincipal === 'UNKNOWN') intentPrincipal = 'UPDATE_SERVICE'
          }
        }
        break
      }

      case 'NOTA': {
        nota = datosTexto || undefined
        intentPrincipal = intentPrincipal === 'UNKNOWN' ? 'ADD_NOTE' : intentPrincipal
        break
      }

      case 'PRODUCTO': {
        const { nombre, monto, cantidad } = extraerProductoDelTramo(datosTexto)
        if (nombre) {
          productos.push({ query: nombre, price: monto?.valor, quantity: cantidad })
          intentPrincipal = intentPrincipal === 'UNKNOWN' ? 'ADD_PRODUCT' : 'REGISTER_ATTENTION'
        }
        break
      }
    }
  }

  if (!cliente && servicios.length === 0 && productos.length === 0 && correcciones.length === 0 && intentPrincipal === 'UNKNOWN') {
    ambiguedades.push(rawText)
  }

  const confidence = calcularConfianza({ cliente, servicios, productos, correcciones, ambiguedades })

  if (!cliente && (intentPrincipal === 'REGISTER_ATTENTION' || intentPrincipal === 'ADD_SERVICE')) {
    // No es un campo "faltante" bloqueante: solo se resuelve contra el cliente ya seleccionado
    // en el draft/contexto de sesión (ver VoiceExecutionService). No se agrega a missingFields
    // aquí porque el intérprete no conoce el draft actual.
  }

  return {
    utteranceId,
    rawText,
    normalizedText: sinTildes(texto.toLowerCase()),
    intent: intentPrincipal,
    client: cliente,
    services: servicios,
    products: productos,
    corrections: correcciones,
    removeCollaborator: removerColaborador,
    notes: nota,
    confidence,
    missingFields: camposFaltantes,
    ambiguities: ambiguedades,
  }
}

function vacioComando(utteranceId: string, rawText: string): ParsedAttentionCommand {
  return {
    utteranceId,
    rawText,
    normalizedText: sinTildes(rawText.toLowerCase()),
    intent: 'UNKNOWN',
    services: [],
    products: [],
    corrections: [],
    confidence: 0.3,
    missingFields: [],
    ambiguities: [],
  }
}

function calcularConfianza(datos: {
  cliente?: unknown
  servicios: unknown[]
  productos: unknown[]
  correcciones: unknown[]
  ambiguedades: string[]
}): number {
  if (datos.ambiguedades.length > 0 && !datos.cliente && datos.servicios.length === 0 && datos.productos.length === 0 && datos.correcciones.length === 0) {
    return 0.1
  }
  const piezas = (datos.cliente ? 1 : 0) + datos.servicios.length + datos.productos.length + datos.correcciones.length
  return piezas > 0 ? Math.min(1, 0.6 + piezas * 0.1) : 0.4
}

// --- Extracción del resto de una cláusula de colaborador: "[en el/la SERVICIO] [de/por MONTO]"
// en cualquier orden relativo, dentro del tramo posterior al verbo ("colaboró", "ayudó",
// "participó"). Arregla el bug original: "colaboró en el blower Y TUVO UNA GANANCIA de
// 10.000" ya no deja la compensación huérfana, porque se lee del MISMO tramo, no de una
// pregunta de seguimiento obligatoria. ---
function extraerColaboradorDelTramo(tokens: Token[], start: number, end: number): { servicioQuery?: string; monto?: ReturnType<typeof extraerMonto> } {
  const norm = tokensNormDeRango(tokens, start, end)
  let servicioQuery: string | undefined
  let monto: ReturnType<typeof extraerMonto> | undefined
  let cursor = 0

  if (norm[cursor] === 'en' && (norm[cursor + 1] === 'el' || norm[cursor + 1] === 'la')) {
    const inicioServicio = cursor + 2
    let finServicio = inicioServicio
    while (finServicio < norm.length && norm[finServicio] !== 'de' && norm[finServicio] !== 'por' && norm[finServicio] !== 'y') {
      finServicio++
    }
    servicioQuery = textoDeRango(tokens, start + inicioServicio, start + finServicio).trim() || undefined
    cursor = finServicio
  }

  for (let j = cursor; j < norm.length; j++) {
    if (norm[j] !== 'de' && norm[j] !== 'por') continue
    const intento = leerMontoDesdeTokens(norm, j + 1)
    if (intento) { monto = intento.monto; break }
  }

  return { servicioQuery, monto }
}

// --- Extracción de servicio compuesto: "NOMBRE [de/por MONTO] [con PROFESIONAL]" -----------
// Igual que antes, pero ahora opera sobre un tramo YA delimitado por el sistema de anclas (no
// tiene que adivinar dónde termina el nombre buscando "de/por" a ciegas en toda la frase).
function extraerServicioDelTramo(
  tokens: Token[],
  start: number,
  end: number,
): { nombre?: string; monto?: ReturnType<typeof extraerMonto>; profesionalTexto?: string; restanteIdx: number } {
  const norm = tokensNormDeRango(tokens, start, end)
  let idxSeparador = -1
  let leido: ReturnType<typeof leerMontoDesdeTokens> = null
  for (let j = 0; j < norm.length; j++) {
    if (norm[j] !== 'de' && norm[j] !== 'por') continue
    const intento = leerMontoDesdeTokens(norm, j + 1)
    if (intento) { idxSeparador = j; leido = intento; break }
  }

  let finNombreIdx: number
  let monto: ReturnType<typeof extraerMonto> | undefined
  let idxTrasMonto = -1
  if (idxSeparador !== -1 && leido) {
    finNombreIdx = idxSeparador
    monto = leido.monto
    idxTrasMonto = idxSeparador + 1 + leido.consumidos
  } else {
    finNombreIdx = norm.findIndex((t) => t === 'con')
    if (finNombreIdx === -1) finNombreIdx = norm.length
  }

  const nombre = textoDeRango(tokens, start, start + finNombreIdx).trim()

  let profesionalTexto: string | undefined
  const idxCon = idxTrasMonto !== -1 ? (norm[idxTrasMonto] === 'con' ? idxTrasMonto : -1) : (finNombreIdx < norm.length && norm[finNombreIdx] === 'con' ? finNombreIdx : -1)
  if (idxCon !== -1) {
    const inicioNombreProf = idxCon + 1
    let finNombreProf = inicioNombreProf
    while (finNombreProf < norm.length && finNombreProf < inicioNombreProf + 2 && !CONECTORES.has(norm[finNombreProf])) {
      const terminaClausula = /[.,!?;:]$/.test(tokens[start + finNombreProf]?.raw ?? '')
      finNombreProf++
      if (terminaClausula) break
    }
    profesionalTexto = textoDeRango(tokens, start + inicioNombreProf, start + finNombreProf).trim() || undefined
  }

  return { nombre: nombre || undefined, monto, profesionalTexto, restanteIdx: end }
}

// --- Nombre propio acotado tras un ancla PROFESIONAL ("con NOMBRE", "lo hizo NOMBRE") --------
// El nombre nunca cruza un conector (de/por/y/…) ni una puntuación de cierre en el texto crudo,
// y se topa en `maxNombre` tokens (los nombres de persona en español rara vez pasan de 2-3
// palabras). Si sobra un "de/por MONTO" en lo que queda del tramo, se devuelve aparte — cubre
// el orden "con Claudia Patricia de 45 mil" (profesional ANTES del precio), no solo el orden ya
// soportado "de 45 mil con Claudia" (precio antes del profesional).
//
// Nombres compuestos mal transcritos ("Claudia y Patricia" en vez de "Claudia Patricia"): si el
// nombre corto se topa justo en un "y" seguido de otra palabra que no es conector, se arma
// también una lectura compuesta uniendo ambas partes SIN el "y" — EntityResolver decide cuál de
// las dos existe de verdad contra el equipo real; nunca se adivina aquí (sección "nombres
// compuestos" del pedido).
function extraerNombrePropioYPrecioDelTramo(
  tokens: Token[],
  start: number,
  end: number,
): { nombre?: string; alternativa?: string; monto?: ReturnType<typeof extraerMonto> } {
  const norm = tokensNormDeRango(tokens, start, end)
  const maxNombre = 3

  let finNombre = 0
  while (finNombre < norm.length && finNombre < maxNombre && !CONECTORES.has(norm[finNombre])) {
    const terminaClausula = /[.,!?;:]$/.test(tokens[start + finNombre]?.raw ?? '')
    finNombre++
    if (terminaClausula) break
  }
  const nombreCorto = textoDeRango(tokens, start, start + finNombre).trim() || undefined

  let nombre = nombreCorto
  let alternativa: string | undefined
  if (
    nombreCorto &&
    finNombre < norm.length &&
    norm[finNombre] === 'y' &&
    finNombre + 1 < norm.length &&
    !CONECTORES.has(norm[finNombre + 1]) &&
    !/[.,!?;:]$/.test(tokens[start + finNombre]?.raw ?? '')
  ) {
    const siguiente = textoDeRango(tokens, start + finNombre + 1, start + finNombre + 2)
    if (siguiente) {
      nombre = `${nombreCorto} ${siguiente}`
      alternativa = nombreCorto
      finNombre += 2 // el compuesto también consume la palabra tras la "y" para el precio de abajo
    }
  }

  let monto: ReturnType<typeof extraerMonto> | undefined
  for (let j = finNombre; j < norm.length; j++) {
    if (norm[j] !== 'de' && norm[j] !== 'por') continue
    const intento = leerMontoDesdeTokens(norm, j + 1)
    if (intento) { monto = intento.monto; break }
  }

  return { nombre, alternativa, monto }
}

function extraerProductoDelTramo(texto: string): { nombre?: string; monto?: ReturnType<typeof extraerMonto>; cantidad?: number } {
  const tokens = texto.split(/\s+/).filter(Boolean)
  let cantidad: number | undefined
  let resto = texto
  if (tokens.length > 0 && esPalabraNumero(sinTildes(tokens[0].toLowerCase()))) {
    const monto = extraerMonto(tokens[0])
    if (monto && monto.valor < 100) { cantidad = monto.valor; resto = tokens.slice(1).join(' ') }
  }
  const idxDe = resto.search(/\bde\b|\bpor\b/i)
  let nombre = resto
  let monto: ReturnType<typeof extraerMonto> | undefined
  if (idxDe !== -1) {
    nombre = resto.slice(0, idxDe).trim()
    monto = extraerMonto(resto.slice(idxDe + 2)) ?? undefined
  }
  return { nombre: limpiarNombrePropio(nombre) || undefined, monto, cantidad }
}

function extraerObjetivoDePrecio(texto: string, tokensNorm: string[]): string | undefined {
  const idxA = tokensNorm.lastIndexOf('a')
  if (idxA <= 0) return undefined
  const objetivo = texto.split(/\s+/).slice(0, idxA).join(' ')
  const limpio = limpiarNombrePropio(objetivo.replace(/\bel\s+precio\b/i, '').replace(/\bprecio\b/i, ''))
  return limpio || undefined
}

// --- Implementación por defecto de la interfaz CommandInterpreter --------------------------
// Sin proveedor de IA configurado en este proyecto (no hay backend propio para ocultar una
// clave de API — nunca se expone una credencial de este tipo en el frontend), así que esta es
// la implementación activa. Cumple la interfaz para poder sustituirla más adelante por un
// proveedor con structured output sin tocar el resto del pipeline (ver InterpreterInput /
// CommandInterpreter en schema.ts).
export const deterministicCommandInterpreter: CommandInterpreter = {
  interpret(input: InterpreterInput): ParsedAttentionCommand {
    return interpretarUtterance(input.text, input.utteranceId)
  },
}

export type { CorrectionField }
