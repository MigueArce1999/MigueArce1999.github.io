import { describe, expect, it } from 'vitest'
import { calcularDescuentoRecompensa, estimarPuntosGanados, type ServicioConCategoria } from './estimarPuntos'
import type { ReglaPuntos, Recompensa } from '../types'

function regla(overrides: Partial<ReglaPuntos> = {}): ReglaPuntos {
  return {
    id: 'regla-1',
    activa: true,
    vigente_desde: '2024-01-01T00:00:00Z',
    vigente_hasta: null,
    monto_por_bloque: 10000,
    puntos_por_bloque: 10,
    categorias_excluidas: [],
    servicios_excluidos: [],
    incluye_productos: true,
    ...overrides,
  }
}

function recompensa(overrides: Partial<Recompensa> = {}): Recompensa {
  return {
    id: 'recompensa-1',
    nombre: 'Descuento de prueba',
    descripcion: null,
    costo_puntos: 50,
    activa: true,
    tipo: 'descuento_fijo',
    servicio_id: null,
    monto_descuento: 20000,
    servicios_elegibles: [],
    condiciones: null,
    requiere_atencion_pagada: false,
    stock_ilimitado: true,
    cantidad_disponible: null,
    imagen_url: null,
    orden_visualizacion: 0,
    creado_en: '2024-01-01T00:00:00Z',
    actualizado_en: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

const servicios: ServicioConCategoria[] = [
  { id: 'servicio-corte', categoria_id: 'categoria-cabello' },
  { id: 'servicio-manicure', categoria_id: 'categoria-unas' },
]

describe('calcularDescuentoRecompensa', () => {
  it('no descuenta nada si no hay recompensa aplicada', () => {
    expect(calcularDescuentoRecompensa(null, 100000)).toBe(0)
  })

  it('no descuenta nada para una recompensa tipo beneficio (su línea ya vale $0)', () => {
    expect(calcularDescuentoRecompensa(recompensa({ tipo: 'beneficio', monto_descuento: null }), 100000)).toBe(0)
  })

  it('descuenta el monto fijo cuando alcanza dentro del subtotal', () => {
    expect(calcularDescuentoRecompensa(recompensa({ monto_descuento: 20000 }), 100000)).toBe(20000)
  })

  it('nunca descuenta más de lo que hay en el subtotal', () => {
    expect(calcularDescuentoRecompensa(recompensa({ monto_descuento: 20000 }), 5000)).toBe(5000)
  })
})

describe('estimarPuntosGanados', () => {
  it('no otorga puntos si la acumulación está pausada', () => {
    const puntos = estimarPuntosGanados({
      acumulacionActiva: false,
      regla: regla(),
      lineas: [{ servicioId: 'servicio-corte', precio: 100000 }],
      servicios,
      subtotalProductos: 0,
      subtotal: 100000,
      descuentoRecompensa: 0,
      total: 100000,
    })
    expect(puntos).toBe(0)
  })

  it('no otorga puntos sin una regla vigente configurada', () => {
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: null,
      lineas: [{ servicioId: 'servicio-corte', precio: 100000 }],
      servicios,
      subtotalProductos: 0,
      subtotal: 100000,
      descuentoRecompensa: 0,
      total: 100000,
    })
    expect(puntos).toBe(0)
  })

  it('aplica la fórmula por bloques sobre el monto elegible', () => {
    // $100.000 / $10.000 por bloque = 10 bloques × 10 puntos = 100 puntos
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: regla(),
      lineas: [{ servicioId: 'servicio-corte', precio: 100000 }],
      servicios,
      subtotalProductos: 0,
      subtotal: 100000,
      descuentoRecompensa: 0,
      total: 100000,
    })
    expect(puntos).toBe(100)
  })

  it('redondea el bloque hacia abajo (nunca da puntos de más)', () => {
    // $109.999 solo completa 10 bloques de $10.000, no 11
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: regla(),
      lineas: [{ servicioId: 'servicio-corte', precio: 109999 }],
      servicios,
      subtotalProductos: 0,
      subtotal: 109999,
      descuentoRecompensa: 0,
      total: 109999,
    })
    expect(puntos).toBe(100)
  })

  it('excluye servicios de una categoría marcada como excluida', () => {
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: regla({ categorias_excluidas: ['categoria-unas'] }),
      lineas: [
        { servicioId: 'servicio-corte', precio: 60000 },
        { servicioId: 'servicio-manicure', precio: 40000 },
      ],
      servicios,
      subtotalProductos: 0,
      subtotal: 100000,
      descuentoRecompensa: 0,
      total: 100000,
    })
    // Solo el corte ($60.000) es elegible → 6 bloques × 10 = 60 puntos
    expect(puntos).toBe(60)
  })

  it('excluye un servicio individual aunque su categoría sí sume puntos', () => {
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: regla({ servicios_excluidos: ['servicio-manicure'] }),
      lineas: [
        { servicioId: 'servicio-corte', precio: 60000 },
        { servicioId: 'servicio-manicure', precio: 40000 },
      ],
      servicios,
      subtotalProductos: 0,
      subtotal: 100000,
      descuentoRecompensa: 0,
      total: 100000,
    })
    expect(puntos).toBe(60)
  })

  it('ignora los productos cuando incluye_productos es false', () => {
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: regla({ incluye_productos: false }),
      lineas: [{ servicioId: 'servicio-corte', precio: 50000 }],
      servicios,
      subtotalProductos: 50000,
      subtotal: 100000,
      descuentoRecompensa: 0,
      total: 100000,
    })
    // Solo el servicio ($50.000) → 5 bloques × 10 = 50 puntos
    expect(puntos).toBe(50)
  })

  it('resta el descuento de una recompensa en proporción al monto elegible', () => {
    // Subtotal $100.000, descuento $20.000 (20%) → elegible neto = $100.000 - 20% = $80.000
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: regla(),
      lineas: [{ servicioId: 'servicio-corte', precio: 100000 }],
      servicios,
      subtotalProductos: 0,
      subtotal: 100000,
      descuentoRecompensa: 20000,
      total: 80000,
    })
    expect(puntos).toBe(80)
  })

  it('nunca da puntos negativos si el descuento supera lo elegible', () => {
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: regla(),
      lineas: [{ servicioId: 'servicio-corte', precio: 5000 }],
      servicios,
      subtotalProductos: 0,
      subtotal: 100000,
      descuentoRecompensa: 95000,
      total: 5000,
    })
    expect(puntos).toBeGreaterThanOrEqual(0)
  })

  it('no otorga puntos si el total a pagar es cero (p. ej. todo cubierto por la recompensa)', () => {
    const puntos = estimarPuntosGanados({
      acumulacionActiva: true,
      regla: regla(),
      lineas: [{ servicioId: 'servicio-corte', precio: 50000 }],
      servicios,
      subtotalProductos: 0,
      subtotal: 50000,
      descuentoRecompensa: 50000,
      total: 0,
    })
    expect(puntos).toBe(0)
  })
})
