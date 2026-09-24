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

// Cómo mostrar el precio de un servicio según su tipo — un solo lugar para las 4 variantes
// (fijo/desde/rango/a_valorar), reutilizado por el sitio público y el panel admin. El texto
// para "a_valorar" varía un poco según el contexto (p. ej. "A valorar" en una tarjeta corta,
// "Se acuerda en salón" en el detalle de una reserva), así que es el único parámetro opcional.
export function formatoPrecioServicio(
  servicio: { tipo_precio: string; precio: number | null; precio_maximo?: number | null },
  etiquetaAValorar = 'A valorar',
): string {
  if (servicio.tipo_precio === 'a_valorar') return etiquetaAValorar
  if (servicio.tipo_precio === 'rango') return `${formatoMoneda(servicio.precio)}–${formatoMoneda(servicio.precio_maximo)}`
  if (servicio.tipo_precio === 'desde') return `Desde ${formatoMoneda(servicio.precio)}`
  return formatoMoneda(servicio.precio)
}

// Solo el número con separador de miles colombiano ("45000" -> "45.000"), sin símbolo de
// moneda: para el texto editable de un campo de dinero, donde el "$"/"COP" van fuera del
// valor (ver components/ui/Campos.tsx → CampoMoneda).
export function formatoEnteroCOP(valor: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(valor)
}

// Estas dos se usan sobre todo dentro de listas (.map de reservas/atenciones/ventas) donde una
// sola fila con una fecha nula o mal formada tumbaría toda la pantalla si se dejara reventar
// Intl.DateTimeFormat — que lanza RangeError: Invalid time value ante una Date inválida, no
// devuelve un texto de error como el resto de las funciones de este archivo.
export function formatoFecha(iso: string, opciones: Intl.DateTimeFormatOptions = {}): string {
  // `new Date(null)` da la época (1970), no NaN — hay que descartar los "vacíos" aparte de los
  // que sí construyen una Date pero inválida (texto que no es una fecha).
  if (!iso) return '—'
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA_HORARIA,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...opciones,
  }).format(fecha)
}

export function formatoHora(iso: string): string {
  if (!iso) return '—'
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA_HORARIA,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(fecha)
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

// Hora (0-23) de un instante en la zona horaria del negocio — nunca Date.getHours(), que usa
// la zona horaria del navegador y agruparía mal "mañana/tarde" para alguien fuera de Colombia.
export function horaBogota(iso: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA, hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)))
}

// Minutos desde medianoche (hora de Bogotá) de un instante — usado para posicionar bloques en
// la agenda del admin (columna por profesional) por altura/posición proporcional a la hora.
export function minutosDesdeMedianocheBogota(iso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? 0)
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? 0)
  return hora * 60 + minuto
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
