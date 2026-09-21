// Estimación de puntos a ganar, usada SOLO como vista previa en Atender.tsx (paso "Cobrar")
// antes de confirmar el cobro — replica la MISMA fórmula que aplica
// fn_completar_y_cobrar_atencion (ver supabase/migrations/0047_fidelizacion.sql) para que la
// vista previa nunca contradiga al servidor, pero el valor que de verdad queda guardado siempre
// lo calcula y devuelve el servidor (sección 12 del pedido: "distinguir estimado de confirmado").
// Extraída a un módulo aparte, sin dependencias de React, para poder probarla con vitest.

import type { ReglaPuntos, Recompensa } from '../types'

export interface LineaElegible {
  servicioId: string
  precio: number | null
}

export interface ServicioConCategoria {
  id: string
  categoria_id: string
}

// Un 'descuento_fijo' nunca resta más de lo que hay para cobrar; un 'beneficio' no descuenta
// nada aquí (su línea de servicio ya vale $0 desde que se aplicó — ver Atender.tsx).
export function calcularDescuentoRecompensa(recompensa: Recompensa | null, subtotal: number): number {
  if (!recompensa || recompensa.tipo !== 'descuento_fijo') return 0
  return Math.min(recompensa.monto_descuento ?? 0, subtotal)
}

export function estimarPuntosGanados(params: {
  acumulacionActiva: boolean
  regla: ReglaPuntos | null
  lineas: LineaElegible[]
  servicios: ServicioConCategoria[]
  subtotalProductos: number
  subtotal: number
  descuentoRecompensa: number
  total: number
}): number {
  const { acumulacionActiva, regla, lineas, servicios, subtotalProductos, subtotal, descuentoRecompensa, total } = params
  if (!acumulacionActiva || !regla) return 0
  if (!regla.monto_por_bloque || !regla.puntos_por_bloque || total <= 0) return 0

  let elegibleBruto = 0
  for (const l of lineas) {
    if (!l.servicioId || l.precio == null) continue
    const servicio = servicios.find((s) => s.id === l.servicioId)
    if (!servicio) continue
    if (regla.categorias_excluidas.includes(servicio.categoria_id)) continue
    if (regla.servicios_excluidos.includes(l.servicioId)) continue
    elegibleBruto += l.precio
  }
  if (regla.incluye_productos) elegibleBruto += subtotalProductos

  let elegibleNeto = elegibleBruto
  if (descuentoRecompensa > 0 && subtotal > 0) {
    elegibleNeto = Math.max(elegibleBruto - Math.round(descuentoRecompensa * (elegibleBruto / subtotal)), 0)
  }

  return Math.floor(elegibleNeto / regla.monto_por_bloque) * regla.puntos_por_bloque
}
