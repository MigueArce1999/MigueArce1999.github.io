import { describe, expect, it } from 'vitest'
import { textoDemandaSalon, textoEstadoDisponibilidad } from './textoDisponibilidad'
import type { EstadoProfesionalAhora } from '../types'

function estado(overrides: Partial<EstadoProfesionalAhora> = {}): EstadoProfesionalAhora {
  return {
    status: 'available',
    razon: null,
    disponible_ahora: true,
    disponible_hasta: null,
    proxima_disponible_en: null,
    minutos_libres: null,
    puede_atender_servicio: true,
    ...overrides,
  }
}

describe('textoEstadoDisponibilidad', () => {
  it('available con ventana larga: "Libre durante aprox. 1 h 15 min" (escenario Nalda, sección 8)', () => {
    const t = textoEstadoDisponibilidad(estado({ status: 'available', minutos_libres: 75 }))
    expect(t.titulo).toBe('Disponible ahora')
    expect(t.detalle).toBe('Libre durante aprox. 1 h 15 min')
    expect(t.emoji).toBe('🟢')
  })

  it('available con ventana exacta en horas, sin minutos sueltos', () => {
    const t = textoEstadoDisponibilidad(estado({ status: 'available', minutos_libres: 120 }))
    expect(t.detalle).toBe('Libre durante aprox. 2 h')
  })

  it('available con ventana corta en minutos', () => {
    const t = textoEstadoDisponibilidad(estado({ status: 'available', minutos_libres: 35 }))
    expect(t.detalle).toBe('Libre durante aprox. 35 min')
  })

  it('available sin ventana conocida no muestra un detalle inventado', () => {
    const t = textoEstadoDisponibilidad(estado({ status: 'available', minutos_libres: null }))
    expect(t.detalle).toBeNull()
  })

  it('upcoming_appointment: "Disponible por tiempo limitado" (sección 6)', () => {
    const t = textoEstadoDisponibilidad(estado({ status: 'upcoming_appointment', minutos_libres: 35 }))
    expect(t.titulo).toBe('Disponible por tiempo limitado')
    expect(t.detalle).toBe('Libre durante aprox. 35 min')
    expect(t.emoji).toBe('🟣')
  })

  it('busy: "Atendiendo" + hora estimada de vuelta (sección 4: "Disponible aproximadamente 12:10 PM")', () => {
    const t = textoEstadoDisponibilidad(
      estado({ status: 'busy', razon: 'servicio_activo', disponible_ahora: false, proxima_disponible_en: '2026-09-21T17:10:00.000Z' }),
    )
    expect(t.titulo).toBe('Atendiendo')
    expect(t.detalle).toMatch(/^Disponible aprox\./)
    expect(t.emoji).toBe('🔴')
  })

  it('ending_soon: minutos restantes calculados contra un "ahora" determinista (sección 4: "Aprox. 15 min")', () => {
    const ahora = new Date('2026-09-21T15:25:00.000Z').getTime()
    const t = textoEstadoDisponibilidad(
      estado({ status: 'ending_soon', razon: 'servicio_activo', disponible_ahora: false, proxima_disponible_en: '2026-09-21T15:40:00.000Z' }),
      ahora,
    )
    expect(t.titulo).toBe('Termina pronto')
    expect(t.detalle).toBe('Termina en aprox. 15 min')
  })

  it('unavailable genérico: nunca revela el motivo interno a la clienta (sección 26)', () => {
    const t = textoEstadoDisponibilidad(estado({ status: 'unavailable', razon: 'almuerzo', disponible_ahora: false }))
    expect(t.titulo).toBe('No disponible')
    expect(t.detalle).toBeNull()
  })

  it('unavailable por dia_libre también se muestra genérico, no "día libre" literal', () => {
    const t = textoEstadoDisponibilidad(estado({ status: 'unavailable', razon: 'dia_libre', disponible_ahora: false }))
    expect(t.titulo).toBe('No disponible')
  })

  it('ocupado_temporal (hold tras aceptar una solicitud) tiene su propio texto distinto, sección 16', () => {
    const t = textoEstadoDisponibilidad(estado({ status: 'unavailable', razon: 'ocupado_temporal', disponible_ahora: false }))
    expect(t.titulo).toBe('Ocupada temporalmente')
    expect(t.emoji).toBe('🟣')
  })
})

describe('textoDemandaSalon', () => {
  it('mapea los tres niveles con su emoji (sección 3)', () => {
    expect(textoDemandaSalon('tranquilo')).toEqual({ emoji: '🟢', texto: 'Tranquilo' })
    expect(textoDemandaSalon('movimiento_medio')).toEqual({ emoji: '🟡', texto: 'Movimiento medio' })
    expect(textoDemandaSalon('alta_demanda')).toEqual({ emoji: '🔴', texto: 'Alta demanda' })
  })
})
