import { describe, expect, it } from 'vitest'
import {
  calcularPeriodoAnterior,
  calcularRangoMes,
  calcularRangoPersonalizado,
  calcularRangoPreset,
  calcularVariacion,
  elegirGranularidad,
  etiquetaMes,
  finDiaBogota,
  inicioDiaBogota,
} from './rangoFecha'

describe('inicioDiaBogota / finDiaBogota', () => {
  it('el límite de "hoy" queda en 05:00 UTC (medianoche en Bogotá, UTC-5), no en 00:00 UTC', () => {
    // 2026-09-26 03:00 UTC = 2026-09-25 22:00 Bogotá -> el día calendario en Bogotá es 25-sep.
    const instante = new Date('2026-09-26T03:00:00.000Z')
    const inicio = inicioDiaBogota(instante)
    expect(inicio.toISOString()).toBe('2026-09-25T05:00:00.000Z')
  })

  it('finDiaBogota es exactamente 24h después de inicioDiaBogota (límite exclusivo)', () => {
    const instante = new Date('2026-09-26T15:00:00.000Z')
    const inicio = inicioDiaBogota(instante)
    const fin = finDiaBogota(instante)
    expect(fin.getTime() - inicio.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('una venta a las 23:59 Bogotá del viernes NO cae en el rango de "hoy" sábado (el bug que rangoPeriodo de format.ts sí tenía)', () => {
    // 23:59 Bogotá del 25-sep = 04:59 UTC del 26-sep.
    const ventaFilo = new Date('2026-09-26T04:59:00.000Z')
    const rangoSabado = calcularRangoPersonalizado('2026-09-26', '2026-09-26')
    expect(ventaFilo >= rangoSabado.desde && ventaFilo < rangoSabado.hasta).toBe(false)
    const rangoViernes = calcularRangoPersonalizado('2026-09-25', '2026-09-25')
    expect(ventaFilo >= rangoViernes.desde && ventaFilo < rangoViernes.hasta).toBe(true)
  })
})

describe('calcularRangoPersonalizado', () => {
  it('un solo día: desde y hasta caen en el mismo día calendario, con 24h exactas de ventana', () => {
    const r = calcularRangoPersonalizado('2026-09-26', '2026-09-26')
    expect(r.hasta.getTime() - r.desde.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('un rango de varios días cubre desde la medianoche del primero hasta la medianoche siguiente al último', () => {
    const r = calcularRangoPersonalizado('2026-09-20', '2026-09-26')
    expect(r.desde.toISOString()).toBe('2026-09-20T05:00:00.000Z')
    expect(r.hasta.toISOString()).toBe('2026-09-27T05:00:00.000Z')
  })

  // El bug real que se encontró probando en el navegador: un Date ya construido (p. ej. el que
  // arma un calendario clicando celdas, o `new Date(fromParam + "T00:00:00")` reconstruido desde
  // la URL) es ambiguo sin saber en qué zona horaria se creó. Reinterpretarlo contra Bogotá podía
  // correr el día seleccionado hacia atrás si el navegador no corre en hora de Bogotá — por eso
  // esta función recibe el día como string "yyyy-MM-dd" y nunca un Date.
  it('da el mismo resultado exacto sin importar la hora del día en que se llame (nunca depende del reloj del navegador)', () => {
    const a = calcularRangoPersonalizado('2026-09-26', '2026-09-26')
    const b = calcularRangoPersonalizado('2026-09-26', '2026-09-26')
    expect(a.desde.getTime()).toBe(b.desde.getTime())
    expect(a.desde.toISOString()).toBe('2026-09-26T05:00:00.000Z')
  })
})

describe('calcularRangoPreset', () => {
  it('"hoy" y "ayer" difieren en exactamente 24 horas', () => {
    const hoy = calcularRangoPreset('hoy')
    const ayer = calcularRangoPreset('ayer')
    expect(hoy.desde.getTime() - ayer.desde.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(ayer.hasta.getTime()).toBe(hoy.desde.getTime())
  })
})

describe('calcularPeriodoAnterior', () => {
  const sabado = calcularRangoPersonalizado('2026-09-26', '2026-09-26')

  it('"ninguna" no compara nada', () => {
    expect(calcularPeriodoAnterior(sabado, 'ninguna')).toBeNull()
  })

  it('"semana_anterior" resta exactamente 7 días (sábado 26 sep -> sábado 19 sep, el ejemplo del pedido)', () => {
    const anterior = calcularPeriodoAnterior(sabado, 'semana_anterior')!
    expect(anterior.desde.toISOString().slice(0, 10)).toBe('2026-09-19')
    expect(anterior.hasta.getTime() - anterior.desde.getTime()).toBe(sabado.hasta.getTime() - sabado.desde.getTime())
  })

  it('"periodo_anterior" para un rango de 7 días da otro rango de exactamente 7 días, inmediatamente antes', () => {
    const rango7dias = calcularRangoPersonalizado('2026-09-20', '2026-09-26')
    const anterior = calcularPeriodoAnterior(rango7dias, 'periodo_anterior')!
    const duracionOriginal = rango7dias.hasta.getTime() - rango7dias.desde.getTime()
    const duracionAnterior = anterior.hasta.getTime() - anterior.desde.getTime()
    expect(duracionAnterior).toBe(duracionOriginal)
    expect(anterior.hasta.getTime()).toBe(rango7dias.desde.getTime())
  })
})

describe('elegirGranularidad', () => {
  it('1 día -> hora', () => {
    const r = calcularRangoPersonalizado('2026-09-26', '2026-09-26')
    expect(elegirGranularidad(r)).toBe('hora')
  })
  it('7 días -> dia', () => {
    const r = calcularRangoPersonalizado('2026-09-20', '2026-09-26')
    expect(elegirGranularidad(r)).toBe('dia')
  })
  it('90 días -> mes', () => {
    const r = calcularRangoPersonalizado('2026-01-01', '2026-04-01')
    expect(elegirGranularidad(r)).toBe('mes')
  })
})

describe('calcularVariacion', () => {
  it('sube de 100 a 118.4 -> +18.4%, como el ejemplo del pedido', () => {
    const v = calcularVariacion(2450000, 2069000)!
    expect(v.direccion).toBe('up')
    expect(v.valor).toBeCloseTo(18.4, 1)
  })

  it('anterior 0 y actual > 0 -> null (nunca +Infinity%)', () => {
    expect(calcularVariacion(50000, 0)).toBeNull()
  })

  it('ambos en 0 -> 0%, no null (sí hay referencia: los dos periodos estuvieron en cero)', () => {
    expect(calcularVariacion(0, 0)).toEqual({ valor: 0, direccion: 'flat' })
  })

  it('nunca da NaN', () => {
    const v = calcularVariacion(0, 100)!
    expect(Number.isNaN(v.valor)).toBe(false)
  })
})

describe('calcularRangoMes / etiquetaMes', () => {
  // 2026-09-26 15:00 UTC = 2026-09-26 10:00 Bogotá -> "hoy" en Bogotá es 26-sep-2026.
  const hoyBogota = new Date('2026-09-26T15:00:00.000Z')

  it('offset 0: el mes en curso va del 1 al 1 del mes siguiente, ambos a medianoche Bogotá', () => {
    const r = calcularRangoMes(0, hoyBogota)
    expect(r.desde.toISOString()).toBe('2026-09-01T05:00:00.000Z')
    expect(r.hasta.toISOString()).toBe('2026-10-01T05:00:00.000Z')
  })

  it('offset -1: el mes anterior', () => {
    const r = calcularRangoMes(-1, hoyBogota)
    expect(r.desde.toISOString()).toBe('2026-08-01T05:00:00.000Z')
    expect(r.hasta.toISOString()).toBe('2026-09-01T05:00:00.000Z')
  })

  it('cruza el fin de año sin romperse (diciembre -> enero del año siguiente)', () => {
    const diciembre = new Date('2026-12-15T15:00:00.000Z')
    const r = calcularRangoMes(1, diciembre)
    expect(r.desde.toISOString()).toBe('2027-01-01T05:00:00.000Z')
    expect(r.hasta.toISOString()).toBe('2027-02-01T05:00:00.000Z')
  })

  it('cruza el inicio de año hacia atrás (enero -> diciembre del año anterior)', () => {
    const enero = new Date('2027-01-10T15:00:00.000Z')
    const r = calcularRangoMes(-1, enero)
    expect(r.desde.toISOString()).toBe('2026-12-01T05:00:00.000Z')
    expect(r.hasta.toISOString()).toBe('2027-01-01T05:00:00.000Z')
  })

  it('etiquetaMes nombra el mes en español, con mayúscula inicial', () => {
    expect(etiquetaMes(0, hoyBogota)).toBe('Septiembre 2026')
    expect(etiquetaMes(-1, hoyBogota)).toBe('Agosto 2026')
  })
})
