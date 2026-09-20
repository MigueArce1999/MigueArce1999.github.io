// Normalización de texto y coincidencia aproximada — resuelve nombres de clientas, servicios y
// profesionales dictados por voz contra registros que YA existen en la base de datos. Nunca al
// revés: esta capa no inventa entidades, solo las encuentra (o dice que no las encontró).

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function distanciaLevenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const fila = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) fila[j] = j
  for (let i = 1; i <= m; i++) {
    let anterior = fila[0]
    fila[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = fila[j]
      fila[j] = a[i - 1] === b[j - 1] ? anterior : 1 + Math.min(anterior, fila[j], fila[j - 1])
      anterior = temp
    }
  }
  return fila[n]
}

// 1 = idéntico, 0 = completamente distinto. Combina coincidencia exacta / "contiene" /
// "empieza con" y distancia de edición relativa — suficiente para nombres y servicios cortos
// dictados por voz, sin depender de ningún servicio externo de NLP.
export function similitud(a: string, b: string): number {
  const na = normalizar(a)
  const nb = normalizar(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.8
  const distancia = distanciaLevenshtein(na, nb)
  const maxLen = Math.max(na.length, nb.length)
  return Math.max(0, 1 - distancia / maxLen)
}

export interface Coincidencia<T> {
  item: T
  puntaje: number
}

export type ResultadoBusqueda<T> =
  | { tipo: 'ninguna' }
  | { tipo: 'unica'; item: T }
  | { tipo: 'aproximada'; item: T; puntaje: number }
  | { tipo: 'multiple'; opciones: Coincidencia<T>[] }

// Umbrales empíricos (no vienen de ningún estándar externo): por encima de AUTOMATICO, una
// única coincidencia se selecciona sola; por debajo, se pide confirmación o se muestran
// opciones. Ver sección 7 del pedido ("una coincidencia exacta y única puede seleccionarse
// automáticamente… una aproximada debe presentarse para confirmación").
const UMBRAL_AUTOMATICO = 0.92
const UMBRAL_MINIMO = 0.55

export function buscarCoincidencias<T>(
  texto: string,
  items: T[],
  obtenerTexto: (item: T) => string,
): ResultadoBusqueda<T> {
  const puntuados = items
    .map((item) => ({ item, puntaje: similitud(texto, obtenerTexto(item)) }))
    .filter((c) => c.puntaje >= UMBRAL_MINIMO)
    .sort((a, b) => b.puntaje - a.puntaje)

  if (puntuados.length === 0) return { tipo: 'ninguna' }
  const [mejor, segundo] = puntuados
  if (mejor.puntaje >= UMBRAL_AUTOMATICO && (!segundo || mejor.puntaje - segundo.puntaje > 0.05)) {
    return { tipo: 'unica', item: mejor.item }
  }
  if (puntuados.length === 1) return { tipo: 'aproximada', item: mejor.item, puntaje: mejor.puntaje }
  return { tipo: 'multiple', opciones: puntuados.slice(0, 5) }
}

// Hash corto y estable (FNV-1a) usado para dar un id determinista a cada acción interpretada:
// la misma instrucción produce siempre el mismo id, lo que permite detectar si un resultado de
// voz repetido generó la misma acción dos veces.
export function hashCorto(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
