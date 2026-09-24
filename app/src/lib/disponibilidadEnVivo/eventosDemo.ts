// En modo demo no hay Supabase Realtime (no hay proyecto conectado) — este es un pub-sub minúsculo
// en memoria que las mutaciones demo de lib/api/disponibilidadEnVivo.ts usan para avisar "algo
// cambió" a los hooks, imitando el mismo patrón "recibo un aviso, vuelvo a preguntar" que Realtime
// real (nunca se pasa el dato mutado directamente: el hook siempre relee vía la función de lectura
// correspondiente, igual que haría con el pulso real).
type Escucha = () => void

const escuchas = new Set<Escucha>()

export function emitirCambioDemo(): void {
  for (const escucha of escuchas) escucha()
}

// Devuelve la función de limpieza — el mismo valor de retorno que espera un useEffect de React.
export function suscribirseACambiosDemo(escucha: Escucha): () => void {
  escuchas.add(escucha)
  return () => {
    escuchas.delete(escucha)
  }
}

// Solo para tests: verificar que no queden suscripciones colgadas tras desmontar.
export function cantidadDeEscuchasDemo(): number {
  return escuchas.size
}
