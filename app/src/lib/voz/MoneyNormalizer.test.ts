import { describe, expect, it } from 'vitest'
import { extraerMonto, leerMontoDesdeTokens, pareceTelefono } from './MoneyNormalizer'

describe('MoneyNormalizer — extraerMonto', () => {
  it('cifra + "mil" (bug real encontrado durante el refactor): "45 mil" = 45.000, no 45', () => {
    expect(extraerMonto('45 mil')?.valor).toBe(45000)
    expect(extraerMonto('10 mil')?.valor).toBe(10000)
    expect(extraerMonto('100 millones')?.valor).toBe(100_000_000)
  })

  it('números en palabras', () => {
    expect(extraerMonto('cuarenta y cinco mil')?.valor).toBe(45000)
    expect(extraerMonto('ciento veinte mil')?.valor).toBe(120000)
  })

  it('cifras con y sin separador de miles', () => {
    expect(extraerMonto('35.000')?.valor).toBe(35000)
    expect(extraerMonto('35000')?.valor).toBe(35000)
    expect(extraerMonto('$45000')?.valor).toBe(45000)
  })

  it('un número pelado sin "mil" queda marcado ambiguo, nunca se asume', () => {
    const r = extraerMonto('treinta y cinco')
    expect(r?.ambiguo).toBe(true)
    expect(r?.valorSugerido).toBe(35000)
  })
})

describe('MoneyNormalizer — leerMontoDesdeTokens (usado por el intérprete)', () => {
  it('mismo bug de cifra + "mil", ahora vía tokens', () => {
    const r = leerMontoDesdeTokens(['de', '45', 'mil', 'con', 'valery'], 1)
    expect(r?.monto.valor).toBe(45000)
    expect(r?.consumidos).toBe(2)
  })
})

describe('MoneyNormalizer — contexto de teléfono nunca se confunde con dinero', () => {
  it('un teléfono de 10 dígitos no se lee como monto', () => {
    expect(pareceTelefono('3001234567')).toBe(true)
    expect(pareceTelefono('300 123 4567')).toBe(true)
    expect(pareceTelefono('45 mil')).toBe(false)
  })
})
