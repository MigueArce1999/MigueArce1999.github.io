// Bandeja de solicitudes "¿puedes atenderme ahora?" de la profesional (sección 13). A diferencia
// de useSalonEnVivo, esto SÍ se suscribe directo a la tabla real (solicitud_disponibilidad) —
// es seguro porque su RLS ya limita cada fila a quien corresponde (cliente dueño, profesional
// destinataria o admin; ver 0060_glowdesk_live_esquema.sql), así que Realtime nunca entrega aquí
// una solicitud ajena.
import { useCallback, useEffect, useState } from 'react'
import { isDemoMode, supabase } from '../supabase'
import { listarSolicitudesProfesional } from '../api/disponibilidadEnVivo'
import { suscribirseACambiosDemo } from './eventosDemo'
import type { SolicitudDisponibilidad } from '../types'

export function useSolicitudesProfesional(profesionalId: string | undefined) {
  const [solicitudes, setSolicitudes] = useState<SolicitudDisponibilidad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(() => {
    if (!profesionalId) return
    setError(null)
    listarSolicitudesProfesional()
      .then(setSolicitudes)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false))
  }, [profesionalId])

  useEffect(() => {
    cargar()
  }, [cargar])

  useEffect(() => {
    if (!profesionalId) return

    if (isDemoMode) {
      return suscribirseACambiosDemo(cargar)
    }

    const cliente = supabase
    if (!cliente) return
    const canal = cliente
      .channel(`solicitudes-profesional-${profesionalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'solicitud_disponibilidad', filter: `profesional_id=eq.${profesionalId}` },
        cargar,
      )
      .subscribe()

    return () => {
      cliente.removeChannel(canal)
    }
  }, [profesionalId, cargar])

  return { solicitudes, cargando, error, recargar: cargar }
}
