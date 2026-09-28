// Capa única de datos para el Dashboard de Analytics — todo lo que muestra la pantalla (KPIs,
// gráfica, por profesional/servicio/producto/método de pago) sale de esta única llamada, para
// que nunca haya dos widgets calculando la misma cifra con reglas distintas (ver
// fn_analytics_resumen en supabase/migrations/0071_analytics_dashboard.sql, la fuente real).
import { demoAnalyticsResumen } from '../demoData'
import { isDemoMode, supabaseRequerido } from '../supabase'
import type { AnalyticsResumen, RangoFecha } from '../types'

export async function obtenerAnalytics(rango: RangoFecha): Promise<AnalyticsResumen> {
  if (isDemoMode) return demoAnalyticsResumen(rango.desde, rango.hasta)
  const client = supabaseRequerido()
  const { data, error } = await client.rpc('fn_analytics_resumen', {
    p_desde: rango.desde.toISOString(),
    p_hasta: rango.hasta.toISOString(),
  })
  if (error) throw error
  return data as AnalyticsResumen
}
