// Capa 7 (confirmación/persistencia queda en Atender.tsx) + el "pegamento" de React que
// conecta las capas 1 (captura de voz) y 4-6 (motor) con el MISMO estado y los MISMOS setters
// del formulario manual de "Registrar atención" — nunca un borrador paralelo.

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Cliente, Profesional, Servicio } from '../types'
import { buscarClientes, crearClienteRapido } from '../api/empleada'
import { estadoInicialAsistente, procesarTexto, type DependenciasMotor, type LineaProductoBorrador, type LineaServicioBorrador } from './motor'
import { useReconocimientoVoz } from './useReconocimientoVoz'
import type { AccesoEstado } from './deshacer'
import type { EstadoAsistenteVoz, MensajeAplicado, PreguntaPendiente } from './tipos'

const MAX_MENSAJES = 12

export interface PropsAsistenteRegistro {
  cliente: Cliente | null
  setCliente: Dispatch<SetStateAction<Cliente | null>>
  lineas: LineaServicioBorrador[]
  setLineas: Dispatch<SetStateAction<LineaServicioBorrador[]>>
  productos: LineaProductoBorrador[]
  setProductos: Dispatch<SetStateAction<LineaProductoBorrador[]>>
  notas: string
  setNotas: Dispatch<SetStateAction<string>>
  servicios: Servicio[]
  equipo: Profesional[]
  crearServicio: (nombre: string) => Promise<Servicio>
  puedeCrearServicio: boolean
  onListo: () => void
}

export function useAsistenteRegistro(props: PropsAsistenteRegistro) {
  const [abierto, setAbierto] = useState(false)
  const [transcripcionProvisional, setTranscripcionProvisional] = useState('')
  const [transcripcionFinal, setTranscripcionFinal] = useState('')
  const [textoManual, setTextoManual] = useState('')
  const [mensajes, setMensajes] = useState<MensajeAplicado[]>([])
  const [preguntaPendiente, setPreguntaPendiente] = useState<PreguntaPendiente | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [errorConexion, setErrorConexion] = useState<string | null>(null)
  const [hayHistorialParaDeshacer, setHayHistorialParaDeshacer] = useState(false)

  const estadoAsistenteRef = useRef(estadoInicialAsistente())
  const propsRef = useRef(props)
  // Los refs no deben leerse ni escribirse durante el render; se sincroniza en un efecto, que
  // corre justo después de confirmado el render y siempre antes de que un evento del usuario
  // (clic, resultado de voz) pueda disparar procesarInstruccion.
  useEffect(() => { propsRef.current = props })

  const deps: DependenciasMotor = useMemo(
    () => ({
      obtenerServicios: () => propsRef.current.servicios,
      obtenerEquipo: () => propsRef.current.equipo,
      buscarClientes,
      crearClienteRapido,
      crearServicioRapido: (nombre) => propsRef.current.crearServicio(nombre),
      get puedeCrearServicio() { return propsRef.current.puedeCrearServicio },
    }),
    [],
  )

  const procesarInstruccion = useCallback(
    async (texto: string) => {
      if (!texto.trim()) return
      setProcesando(true)
      setErrorConexion(null)
      try {
        // Lectura/escritura consistente DENTRO de esta instrucción: varias acciones de una
        // misma frase pueden depender unas de otras (p. ej. "Ana colaboró en el blower" recién
        // añadido en la MISMA frase) y el estado de React todavía no se habría actualizado a
        // tiempo entre una y otra si se escribiera directo contra los setters reales.
        let cliente = propsRef.current.cliente
        let lineas = propsRef.current.lineas
        let productos = propsRef.current.productos
        let notas = propsRef.current.notas

        const acceso: AccesoEstado = {
          obtenerCliente: () => cliente,
          setCliente: (c) => { cliente = c },
          obtenerLineas: () => lineas,
          setLineas: (fn) => { lineas = fn(lineas) },
          obtenerProductos: () => productos,
          setProductos: (fn) => { productos = fn(productos) },
          obtenerNotas: () => notas,
          setNotas: (fn) => { notas = fn(notas) },
        }

        const resultado = await procesarTexto(texto, estadoAsistenteRef.current, acceso, deps, propsRef.current.onListo)

        propsRef.current.setCliente(cliente)
        propsRef.current.setLineas(lineas)
        propsRef.current.setProductos(productos)
        propsRef.current.setNotas(notas)

        setMensajes((prev) => [...prev, ...resultado.mensajes].slice(-MAX_MENSAJES))
        setPreguntaPendiente(estadoAsistenteRef.current.colaPreguntas[0] ?? null)
        setHayHistorialParaDeshacer(estadoAsistenteRef.current.historial.length > 0)
        if (resultado.noReconocidos.length > 0) {
          setMensajes((prev) =>
            [
              ...prev,
              ...resultado.noReconocidos.map((frag) => ({
                id: `no-reconocido-${Date.now()}-${frag}`,
                texto: `No entendí: "${frag}". Puedes editarlo abajo o decirlo distinto — por ejemplo "busca a [nombre]" o "agrega un [servicio] de [precio] con [profesional]".`,
                icono: '❓',
              })),
            ].slice(-MAX_MENSAJES),
          )
        }
      } catch (e: any) {
        setErrorConexion(e?.message || 'No se pudo procesar la instrucción. Revisa tu conexión e inténtalo de nuevo.')
      } finally {
        setProcesando(false)
      }
    },
    [deps],
  )

  const onResultadoFinal = useCallback(
    (r: { id: string; texto: string }) => {
      setTranscripcionFinal(r.texto)
      setTranscripcionProvisional('')
      procesarInstruccion(r.texto)
    },
    [procesarInstruccion],
  )

  const mic = useReconocimientoVoz({
    onResultadoFinal,
    onTranscripcionProvisional: setTranscripcionProvisional,
  })

  const estado: EstadoAsistenteVoz = useMemo(() => {
    if (mic.estado === 'no_disponible' && !abierto) return 'sin_microfono'
    if (errorConexion) return 'error_conexion'
    if (mic.estado === 'no_disponible') return 'sin_microfono'
    if (mic.estado === 'error') return 'error_conexion'
    if (preguntaPendiente) return 'necesita_respuesta'
    if (procesando) return 'interpretando'
    if (mic.estado === 'escuchando') return 'escuchando'
    return mensajes.length > 0 ? 'aplicado' : 'listo'
  }, [mic.estado, errorConexion, preguntaPendiente, procesando, mensajes.length, abierto])

  const abrir = useCallback(() => setAbierto(true), [])
  const cerrar = useCallback(() => {
    mic.detener()
    setAbierto(false)
  }, [mic])

  const responderPregunta = useCallback((valor: string) => procesarInstruccion(valor), [procesarInstruccion])

  const enviarTextoManual = useCallback(() => {
    const texto = textoManual.trim()
    if (!texto) return
    setTextoManual('')
    procesarInstruccion(texto)
  }, [textoManual, procesarInstruccion])

  const deshacerUltimo = useCallback(() => procesarInstruccion('deshacer'), [procesarInstruccion])

  return {
    abierto,
    abrir,
    cerrar,
    estado,
    micDisponible: mic.disponible,
    micEscuchando: mic.estado === 'escuchando',
    iniciarMicrofono: mic.iniciar,
    detenerMicrofono: mic.detener,
    transcripcionProvisional,
    transcripcionFinal,
    setTranscripcionFinal,
    reenviarTranscripcionFinal: () => procesarInstruccion(transcripcionFinal),
    textoManual,
    setTextoManual,
    enviarTextoManual,
    mensajes,
    preguntaPendiente,
    responderPregunta,
    deshacerUltimo,
    hayHistorialParaDeshacer,
    errorConexion,
    errorMicrofono: mic.error,
  }
}
