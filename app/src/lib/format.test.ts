import { describe, expect, it } from 'vitest'
import { formatoFecha, formatoFechaHora, formatoHora, formatoMoneda } from './format'

describe('formatoHora / formatoFecha', () => {
  it('formatean una fecha válida sin problema', () => {
    expect(formatoHora('2026-09-21T15:30:00.000Z')).toMatch(/\d/)
    expect(formatoFecha('2026-09-21T15:30:00.000Z')).toMatch(/2026/)
  })

  it('nunca truenan con una fecha inválida — devuelven "—" en vez de lanzar RangeError', () => {
    expect(() => formatoHora('')).not.toThrow()
    expect(() => formatoFecha('')).not.toThrow()
    expect(formatoHora('')).toBe('—')
    expect(formatoFecha('')).toBe('—')
  })

  it('tampoco truenan con undefined/null, aunque el tipo declarado sea string (fila con dato corrupto)', () => {
    expect(formatoHora(undefined as unknown as string)).toBe('—')
    expect(formatoFecha(null as unknown as string)).toBe('—')
  })

  it('formatoFechaHora hereda la misma protección (compone las otras dos)', () => {
    expect(() => formatoFechaHora('no-es-una-fecha')).not.toThrow()
    expect(formatoFechaHora('no-es-una-fecha')).toBe('— · —')
  })
})

describe('formatoMoneda', () => {
  it('null/undefined muestran "—" en vez de "$NaN"', () => {
    expect(formatoMoneda(null)).toBe('—')
    expect(formatoMoneda(undefined)).toBe('—')
  })
})
