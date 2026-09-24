import { useCallback, useEffect, useRef, useState } from 'react'
import { completarYCobrarAtencion, crearClienteRapido, registrarAtencion } from '../api/empleada'
import { obtenerConfiguracionNegocio } from '../api/catalogo'
import { useReconocimientoVoz } from './useReconocimientoVoz'
import { callar, esperarVoces, hablar } from './sintesisVoz'
import { buscarClientesFuzzy, buscarProfesionalesFuzzy, buscarServiciosFuzzy } from './voiceApi'
import {
  aplicarCandidatosGlowdesk,
  contieneWakeWord,
  esComandoCorto,
  esEcoAsistente,
  esRespuestaRapida,
  estadoInicialGlowdesk,
  estadoMenuGlowdesk,
  procesarTurnoGlowdesk,
  type AccionGlowdesk,
  type EstadoGlowdesk,
  type GeneroVozAsistente,
} from './conversacionGlowdesk'

export type ModoGlowdesk = 'apagado' | 'silencio' | 'escuchando' | 'hablando' | 'pensando'

export function useGlowdeskAsistente() {
  const [genero, setGenero] = useState<GeneroVozAsistente>('femenina')
  const [abierto, setAbierto] = useState(false)
  const [modo, setModo] = useState<ModoGlowdesk>('apagado')
  const [dialogo, setDialogo] = useState<{ de: 'tu' | 'glowdesk'; texto: string }[]>([])
  const [provisional, setProvisional] = useState('')
  const [error, setError] = useState<string | null>(null)
  const estadoRef = useRef<EstadoGlowdesk>(estadoInicialGlowdesk())
  const ocupadoRef = useRef(false)
  const pendienteRef = useRef<string | null>(null)
  const ultimaFraseRef = useRef<string | null>(null)
  const hablandoRef = useRef(false)
  const encendiendoRef = useRef(false)
  const abiertoRef = useRef(false)
  const atencionIdRef = useRef<string | null>(null)
  const generoRef = useRef(genero)
  useEffect(() => { generoRef.current = genero })

  useEffect(() => {
    void obtenerConfiguracionNegocio()
      .then((c) => {
        if (c.voz_asistente_genero === 'masculina' || c.voz_asistente_genero === 'femenina') {
          setGenero(c.voz_asistente_genero)
        }
      })
      .catch(() => { /* usa femenina */ })
    void esperarVoces()
  }, [])

  const decirYSeguir = useCallback(async (frase: string, reanudar: boolean) => {
    ultimaFraseRef.current = frase
    hablandoRef.current = true
    setModo('hablando')
    await hablar(frase, generoRef.current)
    await new Promise((r) => window.setTimeout(r, 180))
    hablandoRef.current = false
    if (reanudar && abiertoRef.current) setModo('escuchando')
    else if (reanudar) setModo('silencio')
    else setModo('apagado')
  }, [])

  const micIniciarRef = useRef<(() => void) | null>(null)
  const micDetenerRef = useRef<(() => void) | null>(null)

  const ejecutarAccion = useCallback(async (accion: AccionGlowdesk, estado: EstadoGlowdesk) => {
    if (accion.tipo === 'buscar_cliente') {
      const filas = await buscarClientesFuzzy(accion.query)
      return aplicarCandidatosGlowdesk(estado, 'cliente', filas.map((f) => ({ id: f.id, nombre: f.nombre })), accion.query)
    }
    if (accion.tipo === 'buscar_servicio') {
      const filas = await buscarServiciosFuzzy(accion.query)
      return aplicarCandidatosGlowdesk(estado, 'servicio', filas.map((f) => ({ id: f.id, nombre: f.nombre, precio: f.precio })), accion.query)
    }
    if (accion.tipo === 'buscar_profesional') {
      const filas = await buscarProfesionalesFuzzy(accion.query)
      return aplicarCandidatosGlowdesk(estado, 'profesional', filas.map((f) => ({ id: f.id, nombre: f.nombre })), accion.query)
    }
    if (accion.tipo === 'crear_cliente') {
      await crearClienteRapido({ nombre: accion.nombre, telefono: accion.telefono })
      return null
    }
    if (accion.tipo === 'registrar_atencion') {
      const { id } = await registrarAtencion({
        clienteId: accion.clienteId,
        reservaId: null,
        lineas: [{ servicioId: accion.servicioId, profesionalId: accion.profesionalId, precioSnapshot: accion.precio }],
        borradorKey: `glowdesk-${Date.now()}`,
      })
      atencionIdRef.current = id
      return null
    }
    if (accion.tipo === 'cobrar_atencion') {
      const atencionId = atencionIdRef.current
      if (!atencionId) throw new Error('No hay una atención para cobrar.')
      await completarYCobrarAtencion({
        atencionId,
        pagos: [{ metodo: 'efectivo', monto: accion.precio }],
        idempotencyKey: `glowdesk-cobro-${atencionId}`,
      })
      atencionIdRef.current = null
      return null
    }
    return null
  }, [])

  const onResultadoFinal = useCallback((r: { texto: string }) => {
    const texto = r.texto.trim()
    if (!texto) return
    if (contieneWakeWord(texto)) {
      ocupadoRef.current = false
      pendienteRef.current = null
      hablandoRef.current = false
      callar()
    } else if (esEcoAsistente(texto, ultimaFraseRef.current)) {
      return
    }
    if (!contieneWakeWord(texto) && (hablandoRef.current || ocupadoRef.current)) {
      if (esComandoCorto(texto) && !esEcoAsistente(texto, ultimaFraseRef.current)) pendienteRef.current = texto
      return
    }
    ocupadoRef.current = true
    setProvisional('')
    const estabaDormido = estadoRef.current.fase === 'dormido'
    if (!estabaDormido) setModo('pensando')
    void (async () => {
      try {
        let resultado = procesarTurnoGlowdesk(estadoRef.current, texto)
        estadoRef.current = resultado.estado
        if (!resultado.decir && !resultado.accion) {
          setModo(estabaDormido || !abiertoRef.current ? 'silencio' : 'escuchando')
          return
        }
        if (!abiertoRef.current) {
          abiertoRef.current = true
          setAbierto(true)
        }
        setDialogo((d) => [...d, { de: 'tu', texto }])
        callar()
        if (resultado.accion) {
          const aplicado = await ejecutarAccion(resultado.accion, estadoRef.current)
          if (aplicado) {
            estadoRef.current = aplicado.estado
            resultado = { ...resultado, decir: aplicado.decir, estado: aplicado.estado }
          }
        }
        if (resultado.decir) {
          callar()
          setDialogo((d) => [...d, { de: 'glowdesk', texto: resultado.decir! }])
          await decirYSeguir(resultado.decir, true)
        } else {
          setModo(abiertoRef.current ? 'escuchando' : 'silencio')
        }
      } catch (e: any) {
        const msg = e?.message || 'No pude completar eso.'
        setError(msg)
        setDialogo((d) => [...d, { de: 'glowdesk', texto: msg }])
        abiertoRef.current = true
        setAbierto(true)
        await decirYSeguir(msg, true)
      } finally {
        ocupadoRef.current = false
        const pendiente = pendienteRef.current
        pendienteRef.current = null
        if (pendiente) onResultadoFinal({ texto: pendiente })
      }
    })()
  }, [decirYSeguir, ejecutarAccion])

  const mic = useReconocimientoVoz({
    onResultadoFinal,
    onTranscripcionProvisional: setProvisional,
    mantenerEscucha: modo === 'silencio' || (abierto && modo !== 'apagado'),
    anticipar: (texto) => esRespuestaRapida(estadoRef.current, texto),
    turnosCortos: abierto && modo !== 'silencio' && modo !== 'apagado',
  })
  micIniciarRef.current = mic.iniciar
  micDetenerRef.current = mic.detener

  const iniciarEscuchaSilenciosa = useCallback(() => {
    if (abiertoRef.current) return
    estadoRef.current = estadoInicialGlowdesk()
    setModo('silencio')
    setProvisional('')
    micIniciarRef.current?.()
  }, [])

  useEffect(() => {
    let viva = true
    const perm = typeof navigator !== 'undefined' ? (navigator as any).permissions : null
    if (!perm?.query) return
    void perm.query({ name: 'microphone' }).then((p: { state: string }) => {
      if (!viva || p.state !== 'granted') return
      iniciarEscuchaSilenciosa()
    }).catch(() => { /* sin permiso no preguntamos */ })
    return () => { viva = false }
  }, [iniciarEscuchaSilenciosa])

  const encender = useCallback(async () => {
    if (encendiendoRef.current || (abiertoRef.current && estadoRef.current.fase !== 'dormido')) return
    encendiendoRef.current = true
    abiertoRef.current = true
    setError(null)
    setAbierto(true)
    estadoRef.current = estadoMenuGlowdesk()
    const saludo = '¿Registramos una atención o una clienta?'
    setDialogo([{ de: 'glowdesk', texto: saludo }])
    setModo('escuchando')
    micIniciarRef.current?.()
    try {
      await decirYSeguir(saludo, true)
    } finally {
      encendiendoRef.current = false
    }
  }, [decirYSeguir])

  const apagar = useCallback(() => {
    callar()
    ocupadoRef.current = false
    pendienteRef.current = null
    ultimaFraseRef.current = null
    hablandoRef.current = false
    encendiendoRef.current = false
    abiertoRef.current = false
    atencionIdRef.current = null
    estadoRef.current = estadoInicialGlowdesk()
    setAbierto(false)
    setDialogo([])
    setProvisional('')
    setModo('silencio')
    window.setTimeout(() => {
      if (abiertoRef.current) return
      micIniciarRef.current?.()
    }, 250)
  }, [])

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      window.setTimeout(() => micIniciarRef.current?.(), 250)
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [])

  useEffect(() => {
    if (abierto || modo !== 'silencio') return
    if (mic.estado === 'escuchando') return
    const t = window.setTimeout(() => {
      if (abiertoRef.current) return
      micIniciarRef.current?.()
    }, 1200)
    return () => window.clearTimeout(t)
  }, [abierto, modo, mic.estado])

  return {
    genero,
    abierto,
    modo,
    dialogo,
    provisional,
    error: error || mic.error,
    micDisponible: mic.disponible,
    encender,
    apagar,
    iniciarEscuchaSilenciosa,
  }
}
