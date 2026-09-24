// Sigue en vivo UNA solicitud de la clienta (pantalla "Preguntándole a Nalda…" / "¡Nalda te
// espera!" — secciones 13-14). Se suscribe directo a la fila real: su RLS ya la limita a quien
// corresponde, así que es seguro (a diferencia de useSalonEnVivo, que nunca toca tablas reales).
import { useCallback, useEffect, useState } from 'react'
import { isDemoMode, supabase } from '../supabase'
import { obtenerSolicitudDisponibilidad } from '../api/disponibilidadEnVivo'
import { suscribirseACambiosDemo } from './eventosDemo'
import type { SolicitudDisponibilidad } from '../types'

export function useSolicitudDisponibilidad(solicitudId: string | null) {
  const [solicitud, setSolicitud] = useState<SolicitudDisponibilidad | null>(null)
  const [cargando, setCargando] = useState(Boolean(solicitudId))
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(() => {
    if (!solicitudId) return
    setError(null)
    obtenerSolicitudDisponibilidad(solicitudId)
      .then(setSolicitud)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false))
  }, [solicitudId])

  useEffect(() => {
    if (!solicitudId) {
      setSolicitud(null)
      return
    }
    setCargando(true)
    cargar()
  }, [solicitudId, cargar])

  useEffect(() => {
    if (!solicitudId) return

    if (isDemoMode) {
      return suscribirseACambiosDemo(cargar)
    }

    const cliente = supabase
    if (!cliente) return
    const canal = cliente
      .channel(`solicitud-disponibilidad-${solicitudId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'solicitud_disponibilidad', filter: `id=eq.${solicitudId}` },
        cargar,
      )
      .subscribe()

    return () => {
      cliente.removeChannel(canal)
    }
  }, [solicitudId, cargar])

  return { solicitud, cargando, error, recargar: cargar }
}
