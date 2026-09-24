// Hook del panel admin "Equipo" (0066): mismo patrón de Realtime que useSalonEnVivo/
// useMiEstadoEnVivo — se suscribe solo al pulso público, nunca a las tablas reales.
import { useCallback, useEffect, useRef, useState } from 'react'
import { isDemoMode, LOCAL_ID, supabase } from '../supabase'
import { obtenerEstadoEquipoEnVivo } from '../api/disponibilidadEnVivo'
import { suscribirseACambiosDemo } from './eventosDemo'
import type { EstadoEquipoItem } from '../types'

const ESPERA_COALESCE_MS = 400

export function useEstadoEquipoEnVivo() {
  const [equipo, setEquipo] = useState<EstadoEquipoItem[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cargar = useCallback((silencioso = false) => {
    if (!silencioso) setCargando(true)
    setError(null)
    obtenerEstadoEquipoEnVivo()
      .then(setEquipo)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false))
  }, [])

  const cargarRef = useRef(cargar)
  useEffect(() => {
    cargarRef.current = cargar
  }, [cargar])

  useEffect(() => {
    cargar()
  }, [cargar])

  useEffect(() => {
    function programarRecarga() {
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current)
      temporizadorRef.current = setTimeout(() => cargarRef.current(true), ESPERA_COALESCE_MS)
    }

    if (isDemoMode) {
      const cancelar = suscribirseACambiosDemo(programarRecarga)
      return () => {
        cancelar()
        if (temporizadorRef.current) clearTimeout(temporizadorRef.current)
      }
    }

    const cliente = supabase
    if (!cliente || !LOCAL_ID) return

    const canal = cliente
      .channel(`pulso-disponibilidad-equipo-${LOCAL_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pulso_disponibilidad', filter: `local_id=eq.${LOCAL_ID}` },
        programarRecarga,
      )
      .subscribe()

    return () => {
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current)
      cliente.removeChannel(canal)
    }
  }, [])

  return { equipo, cargando, error, recargar: cargar }
}
