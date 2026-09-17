// Formato regional del negocio: pesos colombianos, zona horaria America/Bogota.
// Ver docs/04-modelo-de-datos.md §4.10 — las fechas se guardan en UTC (timestamptz)
// y solo se convierten a hora de Bogotá en esta capa de presentación.

const ZONA_HORARIA = 'America/Bogota'

export function formatoMoneda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—'
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(valor)
}

// Solo el número con separador de miles colombiano ("45000" -> "45.000"), sin símbolo de
// moneda: para el texto editable de un campo de dinero, donde el "$"/"COP" van fuera del
// valor (ver components/ui/Campos.tsx → CampoMoneda).
export function formatoEnteroCOP(valor: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(valor)
}

export function formatoFecha(iso: string, opciones: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA_HORARIA,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...opciones,
  }).format(new Date(iso))
}

export function formatoHora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA_HORARIA,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

export function formatoFechaHora(iso: string): string {
  return `${formatoFecha(iso)} · ${formatoHora(iso)}`
}

export function fechaBogotaISO(fecha: Date = new Date()): string {
  // yyyy-mm-dd tal como se ve en Bogotá, para usar como parámetro de fecha en RPCs.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha)
  const obtener = (tipo: string) => partes.find((p) => p.type === tipo)?.value
  return `${obtener('year')}-${obtener('month')}-${obtener('day')}`
}

export function diaSemanaBogota(fecha: Date = new Date()): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_HORARIA, weekday: 'long' }).format(fecha)
}

export type PeriodoResumen = 'hoy' | 'semana' | 'mes'

// Compartido por Resumen y Dashboard (ambos filtran por el mismo periodo con el mismo
// criterio), para no repetir dos veces la aritmética de fechas.
export function rangoPeriodo(periodo: PeriodoResumen): { desde: string; hasta: string } {
  const hoy = new Date()
  if (periodo === 'hoy') {
    const d = fechaBogotaISO(hoy)
    return { desde: `${d}T00:00:00`, hasta: `${d}T23:59:59` }
  }
  if (periodo === 'semana') {
    const inicio = new Date(hoy)
    inicio.setDate(inicio.getDate() - inicio.getDay())
    return { desde: inicio.toISOString(), hasta: new Date().toISOString() }
  }
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  return { desde: inicio.toISOString(), hasta: new Date().toISOString() }
}
