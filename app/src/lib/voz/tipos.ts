// Tipos compartidos del asistente de registro por voz. La lista de TipoAccion es exhaustiva a
// propósito: el intérprete SOLO puede producir acciones de esta lista (nunca SQL, código u
// operaciones arbitrarias) — ver sección 6 del pedido.

export type EstadoAsistenteVoz =
  | 'listo'
  | 'escuchando'
  | 'interpretando'
  | 'buscando'
  | 'necesita_respuesta'
  | 'aplicado'
  | 'sin_microfono'
  | 'error_conexion'

export type TipoAccion =
  | 'buscar_cliente'
  | 'crear_cliente'
  | 'completar_cliente_nuevo'
  | 'confirmar_cliente_nuevo'
  | 'cambiar_cliente'
  | 'agregar_servicio_o_producto'
  | 'fijar_precio_servicio'
  | 'asignar_profesional'
  | 'agregar_colaborador'
  | 'quitar_colaborador'
  | 'quitar_linea'
  | 'cambiar_cantidad_producto'
  | 'agregar_nota'
  | 'deshacer'
  | 'confirmar_listo'
  | 'responder_pregunta'
  | 'no_reconocido'

// Cómo se nombró el servicio/producto/línea al que se refiere una instrucción: por texto (se
// resuelve por parecido contra las líneas ya presentes en el borrador) y/o por posición
// ordinal ("el segundo servicio"). Nunca "el último elemento" a secas — ver sección 9.
export interface ReferenciaLinea {
  texto?: string
  posicionOrdinal?: number
  profesionalTexto?: string
}

export interface AccionInterpretada {
  id: string
  tipo: TipoAccion
  textoOriginal: string
  datos: Record<string, unknown>
  referencia?: ReferenciaLinea
  camposFaltantes: string[]
  ambiguedades: string[]
  estado: 'lista' | 'pendiente' | 'necesita_aclaracion' | 'error'
}

export interface OpcionPregunta {
  etiqueta: string
  valor: string
}

export interface PreguntaPendiente {
  id: string
  texto: string
  // Vacío = pregunta abierta (p. ej. "¿cuánto se cobró por el blower?"); con opciones, las
  // respuestas ("la primera", "2", toque) solo aplican sobre ESTA lista visible.
  opciones: OpcionPregunta[]
  onResponder: (valor: string) => void | Promise<void>
}

export interface MensajeAplicado {
  id: string
  texto: string
  icono: string
}
