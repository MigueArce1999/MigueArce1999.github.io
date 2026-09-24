// Traduce el jsonb del motor (EstadoProfesionalAhora) a lo que de verdad se le muestra a la
// clienta — separado de los componentes de UI para que sea una función pura y testeable
// (sección 39 del pedido), igual que ../fidelizacion/celebracionCanje.ts. Nunca reconstruye la
// disponibilidad: solo da formato al resultado que ya calculó el servidor.
import type { EstadoProfesionalAhora } from '../types'

export interface TextoDisponibilidad {
  emoji: string
  titulo: string
  detalle: string | null
  clase: string
}

const FORMATO_HORA = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' })

function formatoLibrePor(minutos: number | null): string | null {
  if (minutos == null) return null
  if (minutos < 1) return null
  if (minutos >= 60) {
    const horas = Math.floor(minutos / 60)
    const resto = minutos % 60
    return `Libre durante aprox. ${horas} h${resto > 0 ? ` ${resto} min` : ''}`
  }
  return `Libre durante aprox. ${minutos} min`
}

function formatoDisponibleA(iso: string | null): string | null {
  if (!iso) return null
  return `Disponible aprox. ${FORMATO_HORA.format(new Date(iso))}`
}

function formatoTerminaEn(iso: string | null, ahoraMs: number): string | null {
  if (!iso) return null
  const minutos = Math.max(0, Math.round((new Date(iso).getTime() - ahoraMs) / 60_000))
  return minutos <= 0 ? 'Termina en cualquier momento' : `Termina en aprox. ${minutos} min`
}

// `ahoraMs` es un parámetro (no siempre Date.now()) por la misma razón que p_ahora en el motor
// SQL: poder probar "termina pronto" de forma determinista.
export function textoEstadoDisponibilidad(estado: EstadoProfesionalAhora, ahoraMs: number = Date.now()): TextoDisponibilidad {
  switch (estado.status) {
    case 'available':
      return { emoji: '🟢', titulo: 'Disponible ahora', detalle: formatoLibrePor(estado.minutos_libres), clase: 'bg-exito/15 text-exito' }
    case 'upcoming_appointment':
      return {
        emoji: '🟣',
        titulo: 'Disponible por tiempo limitado',
        detalle: formatoLibrePor(estado.minutos_libres),
        clase: 'bg-champan/25 text-carbon',
      }
    case 'busy':
      return { emoji: '🔴', titulo: 'Atendiendo', detalle: formatoDisponibleA(estado.proxima_disponible_en), clase: 'bg-error/15 text-error' }
    case 'ending_soon':
      return {
        emoji: '🟡',
        titulo: 'Termina pronto',
        detalle: formatoTerminaEn(estado.proxima_disponible_en, ahoraMs),
        clase: 'bg-advertencia/15 text-advertencia',
      }
    case 'unavailable':
    default:
      // ocupado_temporal = soft hold tras aceptar una solicitud (sección 16): se distingue de un
      // "no disponible" genérico porque es información útil y no privada (no revela al cliente
      // que la profesional atiende ahora mismo, solo que ya tiene un compromiso en camino).
      if (estado.razon === 'ocupado_temporal') {
        return { emoji: '🟣', titulo: 'Ocupada temporalmente', detalle: 'Otra clienta viene en camino', clase: 'bg-champan/25 text-carbon' }
      }
      return { emoji: '⚪', titulo: 'No disponible', detalle: null, clase: 'bg-carbon/10 text-carbon/60' }
  }
}

// Sección 3: estado general del salón en el widget de home.
export function textoDemandaSalon(demanda: 'tranquilo' | 'movimiento_medio' | 'alta_demanda'): { emoji: string; texto: string } {
  switch (demanda) {
    case 'tranquilo':
      return { emoji: '🟢', texto: 'Tranquilo' }
    case 'movimiento_medio':
      return { emoji: '🟡', texto: 'Movimiento medio' }
    case 'alta_demanda':
      return { emoji: '🔴', texto: 'Alta demanda' }
  }
}
