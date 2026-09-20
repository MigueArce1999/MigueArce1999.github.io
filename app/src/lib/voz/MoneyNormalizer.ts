// Normalizador de dinero para pesos colombianos (COP). Reconoce cifras ("45.000", "45000",
// "$45.000") y números dictados en palabras ("cuarenta y cinco mil"), sin asumir NUNCA en
// silencio que un número pelado ("45") significa "45.000" — eso siempre se marca ambiguo para
// que quien resuelve la entidad decida si pide confirmación.
//
// El mismo parser numérico sirve para tres contextos distintos (precio de servicio, precio de
// producto, compensación de colaborador): la ambigüedad se resuelve igual en los tres. El
// contexto de TELÉFONO es deliberadamente distinto — un teléfono nunca pasa por este parser de
// dinero, así que un número de 10 dígitos jamás se interpreta como "45 mil millones".

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
  ultimo: -1, ultima: -1, // -1 = marcador especial "el último", resuelto por quien llama
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
  /** true si lo dictado no traía "mil"/"millón" ni separador de miles: p. ej. "ponle treinta y
   * cinco" — nunca se asume en silencio que son $35.000, se debe confirmar con la persona. */
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

function multiplicadorTrasCifra(resto: string): { factor: number; longitud: number } | null {
  const m = resto.match(/^\s*(mil|millones|millón|millon)\b/i)
  if (!m) return null
  const palabra = sinTildes(m[1].toLowerCase())
  return { factor: palabra === 'mil' ? 1000 : 1_000_000, longitud: m[0].length }
}

/** Intenta leer un monto en COP al inicio de `texto`. Usado para precios de servicio/producto y
 * compensación de colaborador — nunca para teléfonos (ver `pareceTelefono`). Una cifra puede ir
 * seguida de "mil"/"millones" ("45 mil" = 45.000, no 45): siempre se comprueba antes de aceptar
 * la cifra como valor final. */
export function extraerMonto(texto: string): MontoInterpretado | null {
  const limpio = texto.trim()
  const cifra = leerCifra(limpio)
  if (cifra) {
    const multiplicador = multiplicadorTrasCifra(limpio.slice(cifra.longitud))
    if (multiplicador) return { valor: cifra.valor * multiplicador.factor, ambiguo: false }
    return { valor: cifra.valor, ambiguo: false }
  }

  const tokens = sinTildes(limpio.toLowerCase()).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  const resultado = parseNumeroPalabras(tokens, 0)
  if (!resultado || resultado.valor === 0) return null
  const incluyeMultiplicador = tokens.slice(0, resultado.consumidos).some((t) => t === 'mil' || t === 'millon' || t === 'millones')
  if (!incluyeMultiplicador && resultado.valor < 1000) {
    return { valor: resultado.valor, ambiguo: true, valorSugerido: resultado.valor * 1000 }
  }
  return { valor: resultado.valor, ambiguo: false }
}

/** Variante para el intérprete de comandos: lee un monto desde un arreglo de tokens ya
 * normalizados, devolviendo cuántos tokens ocupó para poder seguir leyendo lo que sigue. Igual
 * que extraerMonto, una cifra ("45") seguida del token "mil"/"millones" se multiplica — nunca
 * se detiene en la cifra sola. */
export function leerMontoDesdeTokens(tokens: string[], startIdx: number): { monto: MontoInterpretado; consumidos: number } | null {
  const cifra = leerCifra(tokens[startIdx] ?? '')
  if (cifra && cifra.longitud >= (tokens[startIdx] ?? '').length) {
    let valor = cifra.valor
    let consumidos = 1
    const siguiente = tokens[startIdx + 1]
    if (siguiente === 'mil') { valor *= 1000; consumidos = 2 }
    else if (siguiente === 'millon' || siguiente === 'millones') { valor *= 1_000_000; consumidos = 2 }
    if (tokens[startIdx + consumidos] === 'pesos') consumidos++
    return { monto: { valor, ambiguo: false }, consumidos }
  }
  const resultado = parseNumeroPalabras(tokens, startIdx)
  if (!resultado || resultado.valor === 0) return null
  let consumidos = resultado.consumidos
  if (tokens[startIdx + consumidos] === 'pesos') consumidos++
  const incluyeMultiplicador = tokens.slice(startIdx, startIdx + resultado.consumidos).some((t) => t === 'mil' || t === 'millon' || t === 'millones')
  const monto: MontoInterpretado = !incluyeMultiplicador && resultado.valor < 1000
    ? { valor: resultado.valor, ambiguo: true, valorSugerido: resultado.valor * 1000 }
    : { valor: resultado.valor, ambiguo: false }
  return { monto, consumidos }
}

/** Un teléfono dictado ("300 123 4567", "3001234567") NUNCA debe pasar por extraerMonto: 10
 * dígitos corridos se leerían como "tres mil millones...". Se detecta por longitud/densidad de
 * dígitos, y el resultado son dígitos crudos, no un valor monetario. */
export function pareceTelefono(texto: string): boolean {
  const digitos = texto.replace(/\D/g, '')
  return digitos.length >= 6 && digitos.length >= texto.replace(/\s/g, '').length * 0.6
}

export function extraerDigitosTelefono(texto: string): string {
  return texto.replace(/\D/g, '')
}
