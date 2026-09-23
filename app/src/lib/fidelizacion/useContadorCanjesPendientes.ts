import { useEffect, useState } from 'react'
import { listarCanjesPendientesEntrega } from '../api/fidelizacion'

// Avisa a la administración de autocanjes por entregar con un número en el menú, en vez de un
// toast en vivo: reutiliza la misma vista/función que ya lista "Canjes por entregar" en
// Fidelización (nada nuevo en el backend), y no requiere Realtime (no hay ninguna suscripción de
// ese tipo en el proyecto todavía).
const INTERVALO_MS = 45_000

export function useContadorCanjesPendientes(activo: boolean): number {
  const [contador, setContador] = useState(0)

  useEffect(() => {
    if (!activo) {
      setContador(0)
      return
    }
    let cancelado = false
    async function cargar() {
      try {
        const pendientes = await listarCanjesPendientesEntrega()
        if (!cancelado) setContador(pendientes.length)
      } catch {
        // Si falla la consulta (red, etc.) el badge simplemente no se actualiza en este ciclo.
      }
    }
    cargar()
    const intervalo = setInterval(cargar, INTERVALO_MS)
    return () => {
      cancelado = true
      clearInterval(intervalo)
    }
  }, [activo])

  return contador
}
