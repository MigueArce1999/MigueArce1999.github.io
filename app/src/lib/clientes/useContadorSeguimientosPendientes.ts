import { useEffect, useState } from 'react'
import { listarSeguimientosPendientes } from '../api/clientes'

// Mismo patrón que useContadorCanjesPendientes (Fidelización): un número junto a "Clientes" en
// el menú en vez de un sistema de notificaciones aparte — reutiliza la misma consulta que ya
// alimenta la card de "Seguimientos pendientes" del listado.
const INTERVALO_MS = 45_000

export function useContadorSeguimientosPendientes(activo: boolean): number {
  const [contador, setContador] = useState(0)

  useEffect(() => {
    if (!activo) {
      setContador(0)
      return
    }
    let cancelado = false
    async function cargar() {
      try {
        const pendientes = await listarSeguimientosPendientes()
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
