import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  calcularPeriodoAnterior,
  calcularRangoPersonalizado,
  calcularRangoPreset,
} from '../lib/analytics/rangoFecha'
import type { ModoComparacion, PresetRangoFecha, RangoFecha } from '../lib/types'

interface DateRangeState {
  preset: PresetRangoFecha
  rango: RangoFecha
  comparacion: ModoComparacion
  rangoComparacion: RangoFecha | null
  // Para prellenar el date picker si la persona lo vuelve a abrir después de elegir un rango
  // personalizado — null en cualquier otro preset.
  personalizado: { desde: string; hasta: string } | null
  setPreset: (preset: Exclude<PresetRangoFecha, 'personalizado'>) => void
  // "yyyy-MM-dd", nunca un Date ya construido — ver el comentario en calcularRangoPersonalizado.
  setRangoPersonalizado: (desdeDia: string, hastaDia: string) => void
  setComparacion: (modo: ModoComparacion) => void
}

const DateRangeContext = createContext<DateRangeState | null>(null)

const PRESETS_VALIDOS: PresetRangoFecha[] = ['hoy', 'ayer', 'semana', 'mes', 'personalizado']
const COMPARACIONES_VALIDAS: ModoComparacion[] = [
  'ninguna', 'periodo_anterior', 'dia_anterior', 'semana_anterior', 'mes_anterior', 'mismo_dia_semana_anterior',
]

// Fuente única de startDate/endDate/preset/comparación del Dashboard: persiste en la URL
// (?preset=personalizado&from=...&to=...&compare=...) para que refrescar la página, compartir el
// enlace o volver de ver un detalle mantenga el mismo periodo — nunca cae de vuelta a "hoy" en
// silencio. Se monta solo alrededor de la ruta /admin/dashboard (ver App.tsx), no en toda la app.
export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams()

  const presetParam = params.get('preset')
  const preset: PresetRangoFecha = PRESETS_VALIDOS.includes(presetParam as PresetRangoFecha)
    ? (presetParam as PresetRangoFecha)
    : 'hoy'

  const fromParam = params.get('from')
  const toParam = params.get('to')

  const comparacionParam = params.get('compare')
  const comparacion: ModoComparacion = COMPARACIONES_VALIDAS.includes(comparacionParam as ModoComparacion)
    ? (comparacionParam as ModoComparacion)
    : 'ninguna'

  const rango = useMemo<RangoFecha>(() => {
    if (preset === 'personalizado' && fromParam) {
      return calcularRangoPersonalizado(fromParam, toParam ?? fromParam)
    }
    return calcularRangoPreset(preset === 'personalizado' ? 'hoy' : preset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, fromParam, toParam])

  const rangoComparacion = useMemo(() => calcularPeriodoAnterior(rango, comparacion), [rango, comparacion])

  const setPreset = useCallback(
    (nuevo: Exclude<PresetRangoFecha, 'personalizado'>) => {
      const siguiente = new URLSearchParams(params)
      siguiente.set('preset', nuevo)
      siguiente.delete('from')
      siguiente.delete('to')
      setParams(siguiente, { replace: true })
    },
    [params, setParams],
  )

  const setRangoPersonalizado = useCallback(
    (desdeDia: string, hastaDia: string) => {
      const siguiente = new URLSearchParams(params)
      siguiente.set('preset', 'personalizado')
      siguiente.set('from', desdeDia)
      siguiente.set('to', hastaDia)
      setParams(siguiente, { replace: true })
    },
    [params, setParams],
  )

  const setComparacion = useCallback(
    (modo: ModoComparacion) => {
      const siguiente = new URLSearchParams(params)
      if (modo === 'ninguna') siguiente.delete('compare')
      else siguiente.set('compare', modo)
      setParams(siguiente, { replace: true })
    },
    [params, setParams],
  )

  const valor: DateRangeState = {
    preset,
    rango,
    comparacion,
    rangoComparacion,
    personalizado: preset === 'personalizado' && fromParam ? { desde: fromParam, hasta: toParam ?? fromParam } : null,
    setPreset,
    setRangoPersonalizado,
    setComparacion,
  }

  return <DateRangeContext.Provider value={valor}>{children}</DateRangeContext.Provider>
}

export function useDateRange(): DateRangeState {
  const ctx = useContext(DateRangeContext)
  if (!ctx) throw new Error('useDateRange debe usarse dentro de <DateRangeProvider>')
  return ctx
}
