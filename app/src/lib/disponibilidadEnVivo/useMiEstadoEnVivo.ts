// Hook de "Mi estado ahora" (Fase 6, sección 20-21 del pedido) — misma arquitectura que
// useSalonEnVivo: se suscribe al pulso público del local (nunca a tablas protegidas) y, cuando
// avanza, vuelve a preguntar fn_estado_profesional_ahora por RPC. Además programa un refresco
// propio justo cuando vence el override manual actual (`proxima_disponible_en`), porque ese
// vencimiento no dispara ningún cambio en la base de datos — es solo que pasó el tiempo.
import { useCallback, useEffect, useRef, useState } from 'react'
import { isDemoMode, LOCAL_ID, supabase } from '../supabase'
import { obtenerEstadoProfesionalAhora } from '../api/disponibilidadEnVivo'
import { suscribirseACambiosDemo } from './eventosDemo'
import type { EstadoProfesionalAhora } from '../types'

const ESPERA_COALESCE_MS = 400

export function useMiEstadoEnVivo(profesionalId: string | undefined) {
  const [estado, setEstado] = useState<EstadoProfesionalAhora | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const temporizadorPulsoRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const temporizadorVencimientoRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cargar = useCallback(
    (silencioso = false) => {
      if (!profesionalId) return
      if (!silencioso) setCargando(true)
      setError(null)
      obtenerEstadoProfesionalAhora(profesionalId)
        .then(setEstado)
        .catch((e) => setError(e.message))
        .finally(() => setCargando(false))
    },
    [profesionalId],
  )

  const cargarRef = useRef(cargar)
  useEffect(() => {
    cargarRef.current = cargar
  }, [cargar])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Refresco propio al vencer un override manual: sin esto, la pantalla seguiría mostrando
  // "En descanso" pasada la hora, porque nada en la base de datos cambia solo por el paso del
  // reloj — hay que volver a preguntar exactamente en ese instante.
  useEffect(() => {
    if (temporizadorVencimientoRef.current) clearTimeout(temporizadorVencimientoRef.current)
    if (estado?.status !== 'unavailable' || !estado.proxima_disponible_en) return
    const faltanMs = new Date(estado.proxima_disponible_en).getTime() - Date.now() + 500
    if (faltanMs <= 0 || faltanMs > 12 * 60 * 60 * 1000) return
    temporizadorVencimientoRef.current = setTimeout(() => cargarRef.current(true), faltanMs)
    return () => {
      if (temporizadorVencimientoRef.current) clearTimeout(temporizadorVencimientoRef.current)
    }
  }, [estado])

  useEffect(() => {
    if (!profesionalId) return

    function programarRecarga() {
      if (temporizadorPulsoRef.current) clearTimeout(temporizadorPulsoRef.current)
      temporizadorPulsoRef.current = setTimeout(() => cargarRef.current(true), ESPERA_COALESCE_MS)
    }

    if (isDemoMode) {
      const cancelar = suscribirseACambiosDemo(programarRecarga)
      return () => {
        cancelar()
        if (temporizadorPulsoRef.current) clearTimeout(temporizadorPulsoRef.current)
      }
    }

    const cliente = supabase
    if (!cliente || !LOCAL_ID) return

    const canal = cliente
      .channel(`pulso-disponibilidad-mi-estado-${profesionalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pulso_disponibilidad', filter: `local_id=eq.${LOCAL_ID}` },
        programarRecarga,
      )
      .subscribe()

    return () => {
      if (temporizadorPulsoRef.current) clearTimeout(temporizadorPulsoRef.current)
      cliente.removeChannel(canal)
    }
  }, [profesionalId])

  return { estado, cargando, error, recargar: cargar }
}
