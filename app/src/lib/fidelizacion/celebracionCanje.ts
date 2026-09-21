// Lógica pura de la celebración de canje (sin React, sin DOM): decide QUÉ mostrar a partir del
// snapshot inmutable que ya guardó el servidor (canje_confirmado.datos, ver
// supabase/migrations/0048_celebracion_canje.sql). Nunca recalcula el saldo desde cero — solo
// interpreta los números que el servidor ya congeló en ese instante, más el saldo actual (que sí
// puede haber cambiado desde entonces) para decidir si animar en vivo o mostrar un resumen
// histórico ("Tu último canje").

import type { CanjeConfirmadoDatos } from '../types'

// El saldo intermedio (justo después del canje, antes de cualquier abono de la misma atención)
// se DERIVA de dos números que el servidor congeló juntos en el mismo instante — nunca se
// reconstruye a partir del saldo actual, que sí puede haber cambiado desde entonces.
export function calcularSaldoTrasCanje(datos: CanjeConfirmadoDatos): number {
  return Math.max(datos.saldo_anterior - datos.costo_puntos, 0)
}

export interface PasosCanje {
  saldoAnterior: number
  costoPuntos: number
  saldoTrasCanje: number
  puntosGanados: number
  saldoFinal: number
  huboGanancia: boolean
}

// Arma la secuencia completa de números que necesita la animación (sección 10 del pedido: canje
// y acumulación de la misma atención se agrupan en una sola narrativa, nunca dos animaciones
// superpuestas). saldoFinal es SIEMPRE datos.saldo_posterior — el valor que el servidor confirmó,
// jamás una suma hecha en el cliente.
export function construirPasosCanje(datos: CanjeConfirmadoDatos): PasosCanje {
  const saldoTrasCanje = calcularSaldoTrasCanje(datos)
  return {
    saldoAnterior: datos.saldo_anterior,
    costoPuntos: datos.costo_puntos,
    saldoTrasCanje,
    puntosGanados: datos.puntos_ganados_en_esta_atencion,
    saldoFinal: datos.saldo_posterior,
    huboGanancia: datos.puntos_ganados_en_esta_atencion > 0,
  }
}

// Un evento es "reciente" (se puede animar en vivo sobre el saldo actual) solo si nada más pasó
// después: el saldo actual del servidor debe coincidir EXACTAMENTE con el saldo_posterior que
// quedó congelado en el canje. Si no coincide (compras, ajustes o devoluciones posteriores),
// se muestra como resumen histórico "Tu último canje" en vez de sugerir que el saldo actual
// bajó por este canje (sección 11 del pedido).
export function esEventoReciente(datos: CanjeConfirmadoDatos, saldoActual: number): boolean {
  return datos.saldo_posterior === saldoActual
}

// Mensaje de cierre (Etapa D + sección 6): nunca inventa un progreso, solo interpreta el saldo
// final ya confirmado y si hay o no otra recompensa realmente alcanzable (calculado aparte, con
// los datos EN VIVO del catálogo — ver listarRecompensasDisponiblesPara).
export function mensajeResultadoFinal(saldoFinal: number, hayOtraRecompensaDisponible: boolean): string {
  if (saldoFinal <= 0) return 'Disfruta tu regalo. En tu próxima visita seguimos floreciendo.'
  if (hayOtraRecompensaDisponible) return '¡Todavía tienes puntos para otra recompensa!'
  return 'Conservas tus puntos para tu próximo regalo.'
}

// Texto único para el aria-live al terminar (sección 12: "anunciar UN resultado, no cada número
// de la cuenta regresiva").
export function anuncioAccesible(pasos: PasosCanje): string {
  const base = `Canje confirmado. Utilizaste ${pasos.costoPuntos} puntos y te quedan ${pasos.saldoFinal} puntos.`
  if (!pasos.huboGanancia) return base
  return `Canje confirmado. Utilizaste ${pasos.costoPuntos} puntos, ganaste ${pasos.puntosGanados} puntos por tu visita, y ahora tienes ${pasos.saldoFinal} puntos.`
}
