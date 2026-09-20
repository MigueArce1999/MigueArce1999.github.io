import { describe, expect, it } from 'vitest'
import { extraerMonto } from './numeros'

describe('extraerMonto', () => {
  it('interpreta números en palabras con "mil"', () => {
    expect(extraerMonto('treinta y cinco mil')?.valor).toBe(35000)
    expect(extraerMonto('cuarenta y cinco mil')?.valor).toBe(45000)
    expect(extraerMonto('ciento veinte mil')?.valor).toBe(120000)
    expect(extraerMonto('doscientos cincuenta mil pesos')?.valor).toBe(250000)
    expect(extraerMonto('sesenta mil')?.valor).toBe(60000)
  })

  it('interpreta cifras con y sin separador de miles', () => {
    expect(extraerMonto('35.000')?.valor).toBe(35000)
    expect(extraerMonto('35000')?.valor).toBe(35000)
    expect(extraerMonto('$45000')?.valor).toBe(45000)
  })

  it('marca como ambiguo un número pelado sin "mil"', () => {
    const r = extraerMonto('treinta y cinco')
    expect(r?.valor).toBe(35)
    expect(r?.ambiguo).toBe(true)
    expect(r?.valorSugerido).toBe(35000)
  })

  it('no confunde una cifra ya completa con ambigua', () => {
    expect(extraerMonto('35000')?.ambiguo).toBe(false)
  })
})
