// Paleta categórica validada (skill de dataviz, references/palette.md): 8 tonos ordenados
// para que cada par ADYACENTE se distinga bajo daltonismo (Delta E >= 8 en OKLab) y a simple
// vista (Delta E >= 15). El orden importa — es el mecanismo de seguridad, no algo cosmético —
// así que nunca se reordena ni se generan tonos adicionales para una 9ª categoría (esa se
// pliega en "Otros" en vez de inventar un color indistinguible).
export const PALETA_CATEGORICA = [
  '#2a78d6', // 1 azul
  '#eb6834', // 2 naranja
  '#1baf7a', // 3 aqua
  '#eda100', // 4 amarillo
  '#e87ba4', // 5 magenta
  '#008300', // 6 verde
  '#4a3aa7', // 7 violeta
  '#e34948', // 8 rojo
]

// "Otros" no es una categoría real (agrupa el resto), así que nunca compite por un tono de la
// paleta: un gris apagado dice "esto es relleno", no "esta es la novena serie".
export const COLOR_OTROS = '#c3c2b7'

// El color de cada categoría depende de su NOMBRE, no de su posición al ordenar por valor —
// si "Ana" es la profesional #1 este mes y la #3 el próximo, debe verse del mismo color en
// las dos gráficas (ver anti-patrones: "recolor-on-filter" rompe la asociación color=identidad
// que el lector ya aprendió). El hash es determinístico; solo se reasigna un color cuando el
// conjunto de nombres visibles realmente cambia (una categoría entra o sale del top mostrado).
function hashEtiqueta(etiqueta: string): number {
  let h = 0
  for (let i = 0; i < etiqueta.length; i++) h = (h * 31 + etiqueta.charCodeAt(i)) >>> 0
  return h
}

export function asignarColores(etiquetas: string[]): Map<string, string> {
  const colores = new Map<string, string>()
  const ocupados = new Set<number>()
  // Orden estable (alfabético) al resolver colisiones, para que el resultado no dependa del
  // orden de llegada (que sí puede variar: por valor, por fecha, etc.).
  const ordenadas = [...new Set(etiquetas)].sort((a, b) => a.localeCompare(b))
  for (const etiqueta of ordenadas) {
    if (etiqueta === 'Otros') {
      colores.set(etiqueta, COLOR_OTROS)
      continue
    }
    let slot = hashEtiqueta(etiqueta) % PALETA_CATEGORICA.length
    let vueltas = 0
    while (ocupados.has(slot) && vueltas < PALETA_CATEGORICA.length) {
      slot = (slot + 1) % PALETA_CATEGORICA.length
      vueltas++
    }
    ocupados.add(slot)
    colores.set(etiqueta, PALETA_CATEGORICA[slot])
  }
  return colores
}
