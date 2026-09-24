// Hook de "Salón en vivo" (sección 19 del pedido: Realtime, no polling agresivo). Se suscribe
// SOLO a pulso_disponibilidad (ver 0062_glowdesk_live_realtime.sql) — nunca a las tablas reales
// de agenda, que están protegidas por RLS y no deben transmitirse a un visitante anónimo. Cuando
// el pulso avanza, se vuelve a preguntar el estado real por RPC (fn_salon_en_vivo): Realtime es
// solo el aviso de "algo cambió", el motor SQL sigue siendo la única fuente de verdad.
import { useCallback, useEffect, useRef, useState } from 'react'
import { isDemoMode, LOCAL_ID, supabase } from '../supabase'
import { obtenerSalonEnVivo } from '../api/disponibilidadEnVivo'
import { suscribirseACambiosDemo } from './eventosDemo'
import type { SalonEnVivo } from '../types'

// Coalesce varios cambios seguidos (p. ej. una atención con tres líneas de servicio dispara tres
// triggers) en una sola llamada a fn_salon_en_vivo, en vez de una por cada evento.
const ESPERA_COALESCE_MS = 400

export function useSalonEnVivo(servicioId?: string | null) {
  const [salon, setSalon] = useState<SalonEnVivo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conectado, setConectado] = useState(isDemoMode) // en demo no hay "conexión" que perder
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cargar = useCallback((silencioso = false) => {
    if (!silencioso) setCargando(true)
    setError(null)
    obtenerSalonEnVivo(servicioId ?? null)
      .then(setSalon)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false))
  }, [servicioId])

  // La suscripción de Realtime no depende del servicio elegido (el pulso es del local entero),
  // así que se guarda la versión más reciente de `cargar` en un ref en vez de incluirla en las
  // dependencias del efecto de abajo — cambiar el filtro de servicio no debe desconectar y
  // reconectar el canal cada vez que la clienta prueba otro servicio.
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
      .channel(`pulso-disponibilidad-${LOCAL_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pulso_disponibilidad', filter: `local_id=eq.${LOCAL_ID}` },
        programarRecarga,
      )
      .subscribe((estado) => setConectado(estado === 'SUBSCRIBED'))

    return () => {
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current)
      cliente.removeChannel(canal)
    }
  }, [])

  return { salon, cargando, error, conectado, recargar: cargar }
}
