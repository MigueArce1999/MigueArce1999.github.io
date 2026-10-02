// Aritmética de fechas del Dashboard de Analytics — separada de lib/format.ts a propósito.
//
// rangoPeriodo() en lib/format.ts (usado por Resumen/Ventas/Dashboard viejo) arma fechas como
// "2026-09-26T00:00:00" SIN offset de zona horaria: el navegador y Postgres (que por defecto
// corre en UTC) no tienen forma de saber que eso significa medianoche en Bogotá, no en UTC — un
// corrimiento real de 5 horas en los límites de "Hoy"/"Ayer". Ese código sigue funcionando igual
// que siempre (no se toca, Resumen/Ventas no cambian), pero este módulo nuevo construye cada
// límite de día con el offset "-05:00" explícito, para que el instante sea exacto sin importar
// en qué huso horario corra el navegador o la base de datos.
//
// Colombia no tiene horario de verano, así que un offset fijo -05:00 siempre es correcto (mismo
// supuesto que ya usa rangoPeriodo('ayer') en lib/format.ts).
import { addDays, subDays, subMonths, subWeeks } from 'date-fns'
import { fechaBogotaISO } from '../format'
import type { ModoComparacion, PresetRangoFecha, RangoFecha } from '../types'

const OFFSET_BOGOTA = '-05:00'

// Instante exacto de medianoche en Bogotá del día calendario (en Bogotá) al que pertenece `fecha`.
export function inicioDiaBogota(fecha: Date): Date {
  return new Date(`${fechaBogotaISO(fecha)}T00:00:00${OFFSET_BOGOTA}`)
}

// Límite EXCLUSIVO de fin de día (medianoche del día siguiente) — mismo criterio `>= desde, <
// hasta` que ya usa el resto del proyecto (evita perder el último segundo del día por un
// redondeo de "23:59:59").
export function finDiaBogota(fecha: Date): Date {
  return inicioDiaBogota(addDays(fecha, 1))
}

// 0 = domingo … 6 = sábado, igual que EXTRACT(DOW) de Postgres y que Date.getDay() — pero
// calculado en hora de Bogotá en vez de la zona horaria del navegador.
function diaSemanaNumeroBogota(fecha: Date): number {
  const nombre = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', weekday: 'short' }).format(fecha)
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return mapa[nombre] ?? 0
}

// Recibe el día calendario como string "yyyy-MM-dd" (nunca un Date ya construido): un Date que
// represente "medianoche de ese día" es ambiguo sin saber en qué zona horaria se construyó — si
// el navegador no corre en hora de Bogotá, reinterpretar ese Date a través de fechaBogotaISO
// podía correr el día seleccionado hacia atrás. El string del día no tiene esa ambigüedad.
// Un solo día o un rango de varios son el mismo cálculo (desde === hasta = un día específico).
export function calcularRangoPersonalizado(desdeDia: string, hastaDia: string): RangoFecha {
  const desde = new Date(`${desdeDia}T00:00:00${OFFSET_BOGOTA}`)
  const hasta = new Date(`${hastaDia}T00:00:00${OFFSET_BOGOTA}`)
  // +24h en milisegundos, no addDays (que avanza por el calendario LOCAL del navegador vía
  // setDate — si esa zona horaria tuviera un cambio de horario justo ese día, podría no ser
  // exactamente 24h). Colombia nunca tiene ese problema, pero el navegador de quien mire el
  // Dashboard puede estar en cualquier zona horaria.
  return { desde, hasta: new Date(hasta.getTime() + 24 * 60 * 60 * 1000) }
}

export function calcularRangoPreset(preset: Exclude<PresetRangoFecha, 'personalizado'>): RangoFecha {
  const ahora = new Date()
  if (preset === 'hoy') return { desde: inicioDiaBogota(ahora), hasta: finDiaBogota(ahora) }
  if (preset === 'ayer') {
    const ayer = subDays(ahora, 1)
    return { desde: inicioDiaBogota(ayer), hasta: finDiaBogota(ayer) }
  }
  if (preset === 'semana') {
    const inicioSemana = subDays(ahora, diaSemanaNumeroBogota(ahora))
    return { desde: inicioDiaBogota(inicioSemana), hasta: ahora }
  }
  // 'mes': primer día del mes calendario en Bogotá.
  const [anio, mes] = fechaBogotaISO(ahora).split('-')
  return { desde: new Date(`${anio}-${mes}-01T00:00:00${OFFSET_BOGOTA}`), hasta: ahora }
}

// Año y mes calendario (1-12) de HOY en Bogotá, como par de enteros — base para la aritmética de
// mes en calcularRangoMes/etiquetaMes (nunca Date.setMonth/addMonths de date-fns sobre un Date ya
// construido: esas operaciones leen el mes en la zona horaria del entorno donde corra el código,
// no en Bogotá, con el mismo riesgo de desfase que ya evita el resto de este archivo).
function anioMesHoyBogota(ahora: Date): { anio: number; mes: number } {
  const [anio, mes] = fechaBogotaISO(ahora).split('-').map(Number)
  return { anio, mes }
}

// Rango del mes calendario en Bogotá, desplazado `offsetMeses` meses desde el actual (0 = mes en
// curso, -1 = el mes pasado, …) — para el ranking de puntos ("clienta del mes"), que necesita
// navegar entre meses sin la UI de comparación de periodos del Dashboard. `ahora` solo existe
// para que las pruebas puedan fijar "hoy"; el llamador real nunca lo pasa.
export function calcularRangoMes(offsetMeses: number, ahora: Date = new Date()): RangoFecha {
  const { anio, mes } = anioMesHoyBogota(ahora)
  const totalMeses = anio * 12 + (mes - 1) + offsetMeses
  const anioDesde = Math.floor(totalMeses / 12)
  const mesDesde = (totalMeses % 12) + 1
  const totalMesesSiguiente = totalMeses + 1
  const anioHasta = Math.floor(totalMesesSiguiente / 12)
  const mesHasta = (totalMesesSiguiente % 12) + 1
  return {
    desde: new Date(`${anioDesde}-${String(mesDesde).padStart(2, '0')}-01T00:00:00${OFFSET_BOGOTA}`),
    hasta: new Date(`${anioHasta}-${String(mesHasta).padStart(2, '0')}-01T00:00:00${OFFSET_BOGOTA}`),
  }
}

// "Octubre 2026" — mismo offset que calcularRangoMes, para rotular el mes que se está mirando.
export function etiquetaMes(offsetMeses: number, ahora: Date = new Date()): string {
  const { anio, mes } = anioMesHoyBogota(ahora)
  const totalMeses = anio * 12 + (mes - 1) + offsetMeses
  const anioMes = Math.floor(totalMeses / 12)
  const mesMes = (totalMeses % 12) + 1
  const fecha = new Date(`${anioMes}-${String(mesMes).padStart(2, '0')}-01T00:00:00${OFFSET_BOGOTA}`)
  // Por separado y unidos con un espacio (no { month: 'long', year: 'numeric' } junto, que en
  // es-CO intercala "de": "septiembre de 2026") — más corto, para cuadrar en el navegador de mes
  // angosto del ranking.
  const mesNombre = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'America/Bogota' }).format(fecha)
  const anioTexto = new Intl.DateTimeFormat('es-CO', { year: 'numeric', timeZone: 'America/Bogota' }).format(fecha)
  return `${mesNombre.charAt(0).toUpperCase()}${mesNombre.slice(1)} ${anioTexto}`
}

// Mismo número de días siempre — nunca compara un rango de 7 días contra uno de 8.
export function calcularPeriodoAnterior(rango: RangoFecha, modo: ModoComparacion): RangoFecha | null {
  if (modo === 'ninguna' || modo === 'personalizado') return null
  if (modo === 'periodo_anterior') {
    const duracionMs = rango.hasta.getTime() - rango.desde.getTime()
    return { desde: new Date(rango.desde.getTime() - duracionMs), hasta: rango.desde }
  }
  if (modo === 'dia_anterior') return { desde: subDays(rango.desde, 1), hasta: subDays(rango.hasta, 1) }
  // 'semana_anterior' y 'mismo_dia_semana_anterior' son el mismo cálculo (restar 7 días a todo
  // el rango): para un solo día ("sábado 26" → "sábado 19") son literalmente lo mismo; la
  // distinción de nombre es solo para que la persona elija la etiqueta que le suene más natural.
  if (modo === 'semana_anterior' || modo === 'mismo_dia_semana_anterior') {
    return { desde: subWeeks(rango.desde, 1), hasta: subWeeks(rango.hasta, 1) }
  }
  // 'mes_anterior': mismos días del mes calendario anterior (ej. 20-26 sep → 20-26 ago). No
  // siempre son exactamente los mismos "número de días" si el mes anterior tiene menos días,
  // pero es la lectura de negocio esperada ("cómo nos fue este mes vs. el mes pasado").
  return { desde: subMonths(rango.desde, 1), hasta: subMonths(rango.hasta, 1) }
}

const UN_DIA_MS = 24 * 60 * 60 * 1000

export type Granularidad = 'hora' | 'dia' | 'semana' | 'mes'

// Umbrales del pedido: 1 día → hora; 2-14 días → día; 15-60 → semana (para no pasar de ~60
// puntos en la gráfica); más de 60 → mes.
export function elegirGranularidad(rango: RangoFecha): Granularidad {
  const dias = Math.max(1, Math.round((rango.hasta.getTime() - rango.desde.getTime()) / UN_DIA_MS))
  if (dias <= 1) return 'hora'
  if (dias <= 14) return 'dia'
  if (dias <= 60) return 'semana'
  return 'mes'
}

export interface Variacion {
  valor: number // porcentaje, puede ser negativo
  direccion: 'up' | 'down' | 'flat'
}

// null = "Sin referencia anterior" (nunca +∞% ni NaN): cuando antes fue $0 y ahora hay ventas,
// el porcentaje no tiene un valor honesto que mostrar.
export function calcularVariacion(actual: number, anterior: number): Variacion | null {
  if (anterior === 0) return actual === 0 ? { valor: 0, direccion: 'flat' } : null
  const valor = ((actual - anterior) / Math.abs(anterior)) * 100
  return { valor, direccion: valor > 0.05 ? 'up' : valor < -0.05 ? 'down' : 'flat' }
}
