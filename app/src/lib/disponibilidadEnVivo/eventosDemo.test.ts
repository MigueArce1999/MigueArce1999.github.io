import { describe, expect, it } from 'vitest'
import { cantidadDeEscuchasDemo, emitirCambioDemo, suscribirseACambiosDemo } from './eventosDemo'

describe('eventosDemo', () => {
  it('llama a cada escucha suscrita cuando se emite un cambio', () => {
    let llamadas = 0
    const cancelar = suscribirseACambiosDemo(() => { llamadas += 1 })
    emitirCambioDemo()
    emitirCambioDemo()
    expect(llamadas).toBe(2)
    cancelar()
  })

  it('deja de llamar a una escucha después de cancelar la suscripción', () => {
    let llamadas = 0
    const cancelar = suscribirseACambiosDemo(() => { llamadas += 1 })
    cancelar()
    emitirCambioDemo()
    expect(llamadas).toBe(0)
  })

  it('no deja escuchas colgadas tras cancelar (evita fugas de memoria)', () => {
    const antes = cantidadDeEscuchasDemo()
    const cancelar1 = suscribirseACambiosDemo(() => {})
    const cancelar2 = suscribirseACambiosDemo(() => {})
    expect(cantidadDeEscuchasDemo()).toBe(antes + 2)
    cancelar1()
    cancelar2()
    expect(cantidadDeEscuchasDemo()).toBe(antes)
  })

  it('soporta varias escuchas independientes al mismo tiempo', () => {
    const vistos: string[] = []
    const cancelarA = suscribirseACambiosDemo(() => vistos.push('a'))
    const cancelarB = suscribirseACambiosDemo(() => vistos.push('b'))
    emitirCambioDemo()
    expect(vistos.sort()).toEqual(['a', 'b'])
    cancelarA()
    cancelarB()
  })

  it('cancelar dos veces la misma suscripción no lanza error', () => {
    const cancelar = suscribirseACambiosDemo(() => {})
    cancelar()
    expect(() => cancelar()).not.toThrow()
  })
})
