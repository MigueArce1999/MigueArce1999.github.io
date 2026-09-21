// Hook de datos de la tarjeta de fidelización de la clienta: carga saldo/meta/progreso, y las
// celebraciones pendientes de reconocer (persistidas en el servidor — sección 7 del pedido:
// "no dependas exclusivamente de localStorage, la clienta puede entrar desde otro dispositivo").
// Un fallo cargando notificaciones NUNCA rompe la tarjeta principal: son independientes.

import { useCallback, useEffect, useState } from 'react'
import {
  listarNotificacionesNoVistas,
  marcarNotificacionVista,
  obtenerMiFidelizacion,
} from '../api/fidelizacion'
import type { MiFidelizacion, NotificacionFidelizacion } from '../types'

export function useMiFidelizacion(clienteId: string | undefined) {
  const [fidelizacion, setFidelizacion] = useState<MiFidelizacion | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [celebraciones, setCelebraciones] = useState<NotificacionFidelizacion[]>([])

  const cargar = useCallback(() => {
    if (!clienteId) return
    setCargando(true)
    setError(null)
    obtenerMiFidelizacion(clienteId)
      .then(setFidelizacion)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false))
    listarNotificacionesNoVistas(clienteId)
      .then(setCelebraciones)
      .catch(() => { /* las celebraciones son una mejora visual; su fallo no debe verse */ })
  }, [clienteId])

  useEffect(() => {
    cargar()
  }, [cargar])

  // "Actualiza... al recuperar el foco" (sección 17 del pedido): la app no tiene tiempo real,
  // así que esto es lo más parecido sin construir una infraestructura nueva solo para esto.
  useEffect(() => {
    function alVolverFoco() {
      if (document.visibilityState === 'visible') cargar()
    }
    document.addEventListener('visibilitychange', alVolverFoco)
    window.addEventListener('focus', alVolverFoco)
    return () => {
      document.removeEventListener('visibilitychange', alVolverFoco)
      window.removeEventListener('focus', alVolverFoco)
    }
  }, [cargar])

  // Se marca vista en el servidor ANTES de quitarla de la lista local — si falla, se queda
  // visible y se puede reintentar; nunca queda "vista" localmente sin estarlo también ahí.
  const reconocerCelebracion = useCallback(async (id: string) => {
    await marcarNotificacionVista(id)
    setCelebraciones((prev) => prev.filter((n) => n.id !== id))
  }, [])

  return { fidelizacion, cargando, error, celebraciones, recargar: cargar, reconocerCelebracion }
}
