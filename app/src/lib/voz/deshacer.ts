// Deshacer quirúrgico: cada instrucción aplicada registra exactamente qué cambió, y "deshacer"
// revierte SOLO lo que el asistente puso Y que nadie más tocó después — nunca pisa una edición
// manual posterior (sección 13: "no sobrescribas ediciones manuales posteriores… limita la
// reversión a los campos que todavía coincidan con el cambio del asistente").

export type OperacionReversible =
  | { tipo: 'set_cliente'; anterior: unknown; nuevo: unknown }
  | { tipo: 'agregar_linea_servicio'; tempId: string }
  | { tipo: 'quitar_linea_servicio'; linea: any; indice: number }
  | { tipo: 'cambiar_linea_servicio'; tempId: string; campo: string; anterior: unknown; nuevo: unknown }
  | { tipo: 'agregar_linea_producto'; tempId: string }
  | { tipo: 'quitar_linea_producto'; linea: any; indice: number }
  | { tipo: 'cambiar_linea_producto'; tempId: string; campo: string; anterior: unknown; nuevo: unknown }
  | { tipo: 'cambiar_notas'; anterior: string; nuevo: string }

export interface GrupoDeshacer {
  id: string
  resumen: string
  operaciones: OperacionReversible[]
}

export interface AccesoEstado {
  obtenerCliente: () => any
  setCliente: (c: any) => void
  obtenerLineas: () => any[]
  setLineas: (actualizar: (prev: any[]) => any[]) => void
  obtenerProductos: () => any[]
  setProductos: (actualizar: (prev: any[]) => any[]) => void
  obtenerNotas: () => string
  setNotas: (actualizar: (prev: string) => string) => void
}

// Devuelve qué operaciones NO se pudieron revertir por haber sido editadas manualmente después
// (para poder avisarlo), y aplica las que sí.
export function deshacerGrupo(grupo: GrupoDeshacer, acceso: AccesoEstado): { omitidas: number } {
  let omitidas = 0
  // En orden inverso: lo último aplicado se deshace primero.
  for (let i = grupo.operaciones.length - 1; i >= 0; i--) {
    const op = grupo.operaciones[i]
    switch (op.tipo) {
      case 'set_cliente': {
        if (JSON.stringify(acceso.obtenerCliente()) === JSON.stringify(op.nuevo)) {
          acceso.setCliente(op.anterior)
        } else {
          omitidas++
        }
        break
      }
      case 'agregar_linea_servicio': {
        acceso.setLineas((prev) => prev.filter((l) => l.tempId !== op.tempId))
        break
      }
      case 'quitar_linea_servicio': {
        acceso.setLineas((prev) => {
          const copia = [...prev]
          copia.splice(Math.min(op.indice, copia.length), 0, op.linea)
          return copia
        })
        break
      }
      case 'cambiar_linea_servicio': {
        let omitida = false
        acceso.setLineas((prev) =>
          prev.map((l) => {
            if (l.tempId !== op.tempId) return l
            if (l[op.campo] !== op.nuevo) { omitida = true; return l }
            return { ...l, [op.campo]: op.anterior }
          }),
        )
        if (omitida) omitidas++
        break
      }
      case 'agregar_linea_producto': {
        acceso.setProductos((prev) => prev.filter((p) => p.tempId !== op.tempId))
        break
      }
      case 'quitar_linea_producto': {
        acceso.setProductos((prev) => {
          const copia = [...prev]
          copia.splice(Math.min(op.indice, copia.length), 0, op.linea)
          return copia
        })
        break
      }
      case 'cambiar_linea_producto': {
        let omitida = false
        acceso.setProductos((prev) =>
          prev.map((p) => {
            if (p.tempId !== op.tempId) return p
            if (p[op.campo] !== op.nuevo) { omitida = true; return p }
            return { ...p, [op.campo]: op.anterior }
          }),
        )
        if (omitida) omitidas++
        break
      }
      case 'cambiar_notas': {
        if (acceso.obtenerNotas() === op.nuevo) acceso.setNotas(() => op.anterior)
        else omitidas++
        break
      }
    }
  }
  return { omitidas }
}
