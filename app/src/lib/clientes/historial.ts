import type { VentaExtraPorAtencion } from '../api/admin'
import type { ClienteNota, ClienteRecomendacion, EstadoAtencion, VentaLinea } from '../types'

export interface VisitaAgrupada {
  atencionId: string
  fecha: string
  estado: EstadoAtencion
  profesionales: string[]
  servicios: { nombre: string; cantidad: number; total: number }[]
  productos: { nombre: string; cantidad: number }[]
  metodosPago: string[]
  total: number
  notas: ClienteNota[]
  recomendaciones: ClienteRecomendacion[]
}

// Agrupa líneas de servicio (una por fila en vista_atencion_servicio) en visitas reales (una por
// atención) para la línea de tiempo del perfil — reutiliza listarVentasDeCliente y
// listarProductosYPagosPorAtencion tal cual, nunca una consulta nueva que ya exista. `ventas`
// llega ordenado desc por fecha (ver listarVentasDeCliente): un Map conserva ese orden de
// inserción, así el resultado ya sale de más reciente a más antigua sin reordenar.
export function agruparVisitas(
  ventas: VentaLinea[],
  extraPorAtencion: Record<string, VentaExtraPorAtencion>,
  notas: ClienteNota[],
  recomendaciones: ClienteRecomendacion[],
): VisitaAgrupada[] {
  const porAtencion = new Map<string, VisitaAgrupada>()
  for (const v of ventas) {
    let visita = porAtencion.get(v.atencion_id)
    if (!visita) {
      const extra = extraPorAtencion[v.atencion_id]
      visita = {
        atencionId: v.atencion_id,
        fecha: v.atencion_completado_en ?? v.atencion_creado_en,
        estado: v.atencion_estado,
        profesionales: [],
        servicios: [],
        productos: extra?.productos ?? [],
        metodosPago: extra?.metodosPago ?? [],
        total: 0,
        notas: notas.filter((n) => n.atencion_id === v.atencion_id),
        recomendaciones: recomendaciones.filter((r) => r.atencion_id === v.atencion_id),
      }
      porAtencion.set(v.atencion_id, visita)
    }
    if (v.profesional_nombre && !visita.profesionales.includes(v.profesional_nombre)) visita.profesionales.push(v.profesional_nombre)
    const totalLinea = (v.precio_snapshot - v.descuento) * v.cantidad
    visita.servicios.push({ nombre: v.nombre_snapshot, cantidad: v.cantidad, total: totalLinea })
    visita.total += totalLinea
  }
  return [...porAtencion.values()]
}

// Profesional que más veces atendió a esta clienta — se calcula del lado del cliente a partir
// del historial ya cargado (el perfil solo trae detalle al abrirse, ver sección 21 del pedido),
// sin una columna ni consulta SQL aparte solo para este número.
export function profesionalHabitual(ventas: VentaLinea[]): string | null {
  const conteo = new Map<string, number>()
  for (const v of ventas) {
    if (!v.profesional_nombre) continue
    conteo.set(v.profesional_nombre, (conteo.get(v.profesional_nombre) ?? 0) + 1)
  }
  let mejor: string | null = null
  let max = 0
  for (const [nombre, n] of conteo) {
    if (n > max) {
      mejor = nombre
      max = n
    }
  }
  return mejor
}
