// Conversión de números dictados en español a valores enteros, y resolución de montos en pesos
// colombianos. Determinista: un diccionario fijo de palabras numéricas + las reglas de
// composición estándar del español (centena + decena[-y-unidad] + multiplicador) — sin ningún
// modelo de lenguaje de por medio. Ver docs de entrega para dónde encaja esta capa dentro de
// "captura → normalización → interpretación → resolución → validación → aplicación".

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9,
}

const DIEZ_A_VEINTE: Record<string, number> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
}

const VEINTIALGO: Record<string, number> = {
  veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
}

const DECENAS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
}

const CENTENAS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
}

const MULTIPLICADORES: Record<string, number> = { mil: 1000, millon: 1_000_000, millones: 1_000_000 }

export const ORDINALES: Record<string, number> = {
  primero: 1, primer: 1, primera: 1,
  segundo: 2, segunda: 2,
  tercero: 3, tercer: 3, tercera: 3,
  cuarto: 4, cuarta: 4,
  quinto: 5, quinta: 5,
}

export function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const PALABRAS_NUMERO = new Set([
  ...Object.keys(UNIDADES), ...Object.keys(DIEZ_A_VEINTE), ...Object.keys(VEINTIALGO),
  ...Object.keys(DECENAS), ...Object.keys(CENTENAS), ...Object.keys(MULTIPLICADORES),
])

export function esPalabraNumero(palabra: string): boolean {
  return PALABRAS_NUMERO.has(sinTildes(palabra.toLowerCase()))
}

// Consume palabras numéricas a partir de startIdx en un arreglo de tokens ya normalizados
// (minúsculas, sin tildes) y devuelve el valor compuesto + cuántos tokens ocupó. Soporta
// "cuarenta y cinco mil", "ciento veinte mil", "doscientos cincuenta mil", "un millón".
export function parseNumeroPalabras(tokens: string[], startIdx: number): { valor: number; consumidos: number } | null {
  let i = startIdx
  let total = 0
  let grupoActual = 0
  let consumioAlgo = false

  const token = (idx: number) => (idx < tokens.length ? tokens[idx] : '')

  while (i < tokens.length) {
    const t = token(i)
    if (CENTENAS[t] !== undefined) {
      grupoActual += CENTENAS[t]
      i++; consumioAlgo = true
      continue
    }
    if (VEINTIALGO[t] !== undefined) {
      grupoActual += VEINTIALGO[t]
      i++; consumioAlgo = true
      continue
    }
    if (DIEZ_A_VEINTE[t] !== undefined) {
      grupoActual += DIEZ_A_VEINTE[t]
      i++; consumioAlgo = true
      continue
    }
    if (DECENAS[t] !== undefined) {
      grupoActual += DECENAS[t]
      i++; consumioAlgo = true
      if (token(i) === 'y' && UNIDADES[token(i + 1)] !== undefined) {
        grupoActual += UNIDADES[token(i + 1)]
        i += 2
      }
      continue
    }
    if (UNIDADES[t] !== undefined) {
      grupoActual += UNIDADES[t]
      i++; consumioAlgo = true
      continue
    }
    if (MULTIPLICADORES[t] !== undefined) {
      total += (grupoActual || 1) * MULTIPLICADORES[t]
      grupoActual = 0
      i++; consumioAlgo = true
      continue
    }
    break
  }
  if (!consumioAlgo) return null
  return { valor: total + grupoActual, consumidos: i - startIdx }
}

export interface MontoInterpretado {
  valor: number
  // true si lo dictado no traía "mil"/"millón" ni separador de miles: p. ej. "ponle treinta y
  // cinco" — nunca se asume en silencio que son $35.000, se debe confirmar con la persona.
  ambiguo: boolean
  valorSugerido?: number
}

function leerCifra(texto: string): { valor: number; longitud: number } | null {
  const m = texto.match(/^\$?\s*(\d[\d.,]*)/)
  if (!m || !/\d/.test(m[1])) return null
  const soloDigitos = m[1].replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(/[.,]/g, '')
  const valor = parseInt(soloDigitos, 10)
  if (Number.isNaN(valor)) return null
  return { valor, longitud: m[0].length }
}

// Intenta leer un monto en COP al inicio de `texto`: primero cifras ("35.000", "35000",
// "$45000"), luego números en palabras. Nunca multiplica un número "pelado" por mil en
// silencio — ver sección de importes ambiguos del pedido.
export function extraerMonto(texto: string): MontoInterpretado | null {
  const limpio = texto.trim()
  const cifra = leerCifra(limpio)
  if (cifra) return { valor: cifra.valor, ambiguo: false }

  const tokens = sinTildes(limpio.toLowerCase()).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  const resultado = parseNumeroPalabras(tokens, 0)
  if (!resultado || resultado.valor === 0) return null
  const incluyeMultiplicador = tokens.slice(0, resultado.consumidos).some((t) => t === 'mil' || t === 'millon' || t === 'millones')
  if (!incluyeMultiplicador && resultado.valor < 1000) {
    return { valor: resultado.valor, ambiguo: true, valorSugerido: resultado.valor * 1000 }
  }
  return { valor: resultado.valor, ambiguo: false }
}

// Variante usada por el intérprete de comandos compuestos: lee un monto a partir de un arreglo
// de tokens ya normalizados (para poder saber cuántos tokens ocupó y seguir leyendo lo que
// venga después, p. ej. "con Claudia").
export function leerMontoDesdeTokens(tokens: string[], startIdx: number): { monto: MontoInterpretado; consumidos: number } | null {
  const cifra = leerCifra(tokens[startIdx] ?? '')
  if (cifra && cifra.longitud >= (tokens[startIdx] ?? '').length) {
    return { monto: { valor: cifra.valor, ambiguo: false }, consumidos: 1 }
  }
  const resultado = parseNumeroPalabras(tokens, startIdx)
  if (!resultado || resultado.valor === 0) return null
  let consumidos = resultado.consumidos
  // "pesos" al final es puramente decorativo, se descarta.
  if (tokens[startIdx + consumidos] === 'pesos') consumidos++
  const incluyeMultiplicador = tokens.slice(startIdx, startIdx + resultado.consumidos).some((t) => t === 'mil' || t === 'millon' || t === 'millones')
  const monto: MontoInterpretado = !incluyeMultiplicador && resultado.valor < 1000
    ? { valor: resultado.valor, ambiguo: true, valorSugerido: resultado.valor * 1000 }
    : { valor: resultado.valor, ambiguo: false }
  return { monto, consumidos }
}
