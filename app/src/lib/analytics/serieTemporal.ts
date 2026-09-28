// Prepara la serie de la gráfica "Evolución de ventas" según la granularidad elegida
// (elegirGranularidad en rangoFecha.ts). fn_analytics_resumen siempre agrega por día en el
// servidor (serie_diaria); agrupar por semana/mes es una simple re-agregación de esos mismos
// días en el cliente — no hace falta otra consulta. Por hora es el único caso que necesita datos
// crudos (fn_analytics_resumen no los trae): se arma aparte a partir de listarVentasDetalle, que
// ya existe y ya se usa en la tabla de Ventas — se reutiliza, no se duplica.
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { horaBogota } from '../format'
import type { AnalyticsSerieDia, VentaLinea } from '../types'
import type { Granularidad } from './rangoFecha'

export interface PuntoSerie {
  etiqueta: string
  ventas: number
}

function claveSemana(fechaISO: string): string {
  // Semana que empieza en domingo, igual que el resto del proyecto (ver rangoPeriodo('semana')
  // en lib/format.ts). Se agrupa por la fecha del domingo de esa semana.
  const d = new Date(`${fechaISO}T00:00:00`)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

export function agruparSerieDiaria(serie: AnalyticsSerieDia[], granularidad: Granularidad): PuntoSerie[] {
  if (granularidad === 'dia') {
    return serie.map((d) => ({ etiqueta: format(new Date(`${d.fecha}T00:00:00`), 'EEE d', { locale: es }), ventas: d.ventas }))
  }
  if (granularidad === 'semana') {
    const acc = new Map<string, number>()
    for (const d of serie) acc.set(claveSemana(d.fecha), (acc.get(claveSemana(d.fecha)) ?? 0) + d.ventas)
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([inicioSemana, ventas]) => ({ etiqueta: format(new Date(`${inicioSemana}T00:00:00`), "d MMM", { locale: es }), ventas }))
  }
  // 'mes'
  const acc = new Map<string, number>()
  for (const d of serie) {
    const clave = d.fecha.slice(0, 7) // yyyy-mm
    acc.set(clave, (acc.get(clave) ?? 0) + d.ventas)
  }
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([anioMes, ventas]) => ({ etiqueta: format(new Date(`${anioMes}-01T00:00:00`), 'MMM yyyy', { locale: es }), ventas }))
}

const ETIQUETA_HORA = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', hour12: true })

// Ventana 6am-10pm: cubre el horario real de cualquier salón; mostrar las 24 horas dejaría la
// mitad de la gráfica en cero toda la madrugada, sin aportar nada.
const PRIMERA_HORA = 6
const ULTIMA_HORA = 22

export function bucketPorHora(lineas: Pick<VentaLinea, 'precio_snapshot' | 'descuento' | 'cantidad' | 'atencion_creado_en' | 'atencion_completado_en'>[]): PuntoSerie[] {
  const acc = new Map<number, number>()
  for (const l of lineas) {
    const iso = l.atencion_completado_en ?? l.atencion_creado_en
    if (!iso) continue
    const hora = horaBogota(iso)
    const monto = (l.precio_snapshot - l.descuento) * l.cantidad
    acc.set(hora, (acc.get(hora) ?? 0) + monto)
  }
  const puntos: PuntoSerie[] = []
  for (let h = PRIMERA_HORA; h <= ULTIMA_HORA; h++) {
    const fecha = new Date()
    fecha.setUTCHours(h + 5, 0, 0, 0) // +5 para que al formatear en America/Bogota dé la hora h
    puntos.push({ etiqueta: ETIQUETA_HORA.format(fecha), ventas: acc.get(h) ?? 0 })
  }
  return puntos
}
