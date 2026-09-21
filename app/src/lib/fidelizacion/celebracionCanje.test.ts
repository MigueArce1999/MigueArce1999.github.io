import { describe, expect, it } from 'vitest'
import {
  anuncioAccesible,
  calcularSaldoTrasCanje,
  construirPasosCanje,
  esEventoReciente,
  mensajeResultadoFinal,
} from './celebracionCanje'
import type { CanjeConfirmadoDatos } from '../types'

function datos(overrides: Partial<CanjeConfirmadoDatos> = {}): CanjeConfirmadoDatos {
  return {
    canje_id: 'canje-1',
    recompensa_nombre: 'Descuento de $15.000',
    recompensa_imagen_url: null,
    recompensa_tipo: 'descuento_fijo',
    costo_puntos: 500,
    saldo_anterior: 1000,
    saldo_posterior: 500,
    puntos_ganados_en_esta_atencion: 0,
    ...overrides,
  }
}

describe('calcularSaldoTrasCanje', () => {
  it('resta el costo del saldo anterior (escenario #1: 1.000 -> 500)', () => {
    expect(calcularSaldoTrasCanje(datos())).toBe(500)
  })

  it('nunca baja de cero, aunque los números fueran inconsistentes', () => {
    expect(calcularSaldoTrasCanje(datos({ saldo_anterior: 300, costo_puntos: 500 }))).toBe(0)
  })
})

describe('construirPasosCanje', () => {
  it('escenario #1: 1.000 puntos, canje de 500 -> termina en 500', () => {
    const pasos = construirPasosCanje(datos({ saldo_anterior: 1000, costo_puntos: 500, saldo_posterior: 500 }))
    expect(pasos).toEqual({
      saldoAnterior: 1000,
      costoPuntos: 500,
      saldoTrasCanje: 500,
      puntosGanados: 0,
      saldoFinal: 500,
      huboGanancia: false,
    })
  })

  it('escenario #2: 700 puntos, canje de 500 -> termina en 200', () => {
    const pasos = construirPasosCanje(datos({ saldo_anterior: 700, costo_puntos: 500, saldo_posterior: 200 }))
    expect(pasos.saldoTrasCanje).toBe(200)
    expect(pasos.saldoFinal).toBe(200)
  })

  it('escenario #3: 500 puntos, canje de 500 -> termina en cero', () => {
    const pasos = construirPasosCanje(datos({ saldo_anterior: 500, costo_puntos: 500, saldo_posterior: 0 }))
    expect(pasos.saldoTrasCanje).toBe(0)
    expect(pasos.saldoFinal).toBe(0)
    expect(pasos.huboGanancia).toBe(false)
  })

  it('escenario #4: 1.000 puntos, canje de 500 y ganancia de 45 -> termina en 545', () => {
    const pasos = construirPasosCanje(datos({ saldo_anterior: 1000, costo_puntos: 500, saldo_posterior: 545, puntos_ganados_en_esta_atencion: 45 }))
    expect(pasos.saldoTrasCanje).toBe(500)
    expect(pasos.puntosGanados).toBe(45)
    expect(pasos.saldoFinal).toBe(545)
    expect(pasos.huboGanancia).toBe(true)
  })

  it('el saldo final SIEMPRE es el saldo_posterior confirmado, nunca una suma hecha en el cliente', () => {
    // Si alguien intentara "reconstruir" sumando saldoTrasCanje + puntosGanados daría 500+45=545,
    // que en este caso coincide, pero construirPasosCanje nunca hace esa suma: usa el valor
    // confirmado directamente. Lo probamos con un caso donde SÍ divergirían (p. ej. si hubo un
    // ajuste manual adicional en la misma ventana, saldo_posterior ya lo refleja distinto).
    const pasos = construirPasosCanje(datos({ saldo_anterior: 1000, costo_puntos: 500, saldo_posterior: 560, puntos_ganados_en_esta_atencion: 45 }))
    expect(pasos.saldoFinal).toBe(560) // no 545 — el servidor es la única fuente de verdad
  })
})

describe('esEventoReciente', () => {
  it('es reciente si el saldo actual coincide con el saldo_posterior congelado', () => {
    expect(esEventoReciente(datos({ saldo_posterior: 500 }), 500)).toBe(true)
  })

  it('NO es reciente si hubo movimientos posteriores (saldo actual ya no coincide)', () => {
    expect(esEventoReciente(datos({ saldo_posterior: 500 }), 620)).toBe(false)
  })
})

describe('mensajeResultadoFinal', () => {
  it('saldo en cero: mensaje de regalo disfrutado, sin sonar a pérdida', () => {
    expect(mensajeResultadoFinal(0, false)).toMatch(/Disfruta tu regalo/)
  })

  it('saldo suficiente para otra recompensa: mensaje de oportunidad', () => {
    expect(mensajeResultadoFinal(600, true)).toMatch(/otra recompensa/)
  })

  it('saldo positivo pero sin otra recompensa alcanzable: mensaje neutro de conservar puntos', () => {
    expect(mensajeResultadoFinal(200, false)).toMatch(/Conservas/)
  })
})

describe('anuncioAccesible', () => {
  it('anuncia un solo resultado (no la cuenta regresiva) sin ganancia adicional', () => {
    const pasos = construirPasosCanje(datos({ saldo_anterior: 1000, costo_puntos: 500, saldo_posterior: 500 }))
    expect(anuncioAccesible(pasos)).toBe('Canje confirmado. Utilizaste 500 puntos y te quedan 500 puntos.')
  })

  it('incluye la ganancia cuando la misma atención también otorgó puntos', () => {
    const pasos = construirPasosCanje(datos({ saldo_anterior: 1000, costo_puntos: 500, saldo_posterior: 545, puntos_ganados_en_esta_atencion: 45 }))
    expect(anuncioAccesible(pasos)).toBe('Canje confirmado. Utilizaste 500 puntos, ganaste 45 puntos por tu visita, y ahora tienes 545 puntos.')
  })
})
