// Controlador del micrófono (Web Speech API) sin React, para poder probarlo con un reconocedor
// falso. El hook useReconocimientoVoz solo lo envuelve.
//
// Por qué existe (la intermitencia de "hola Glowdesk"):
//  1. Había varias llamadas a iniciar() casi simultáneas (abrir panel, cambio de turnos cortos,
//     volver a la pestaña, vigilante de 1.2 s…). Cada una creaba un reconocedor nuevo mientras el
//     anterior seguía cerrándose; Chrome solo deja uno activo, así que a veces el nuevo nacía
//     abortado y el micrófono quedaba "escuchando" sin oír nada.
//     → Aquí hay UN solo reconocedor a la vez; el siguiente arranca cuando el anterior terminó.
//  2. Un "sí" se emitía en provisional y otra vez al volverse final (>450 ms después): el
//     asistente confirmaba dos pasos seguidos. → Cada resultado (por índice) se emite una vez.
//  3. Las frases finales se deduplicaban para siempre: repetir "María" tras un fallo no hacía
//     nada. → Solo se descartan repeticiones idénticas en una ventana corta.
//  4. Errores fatales (permiso denegado, sin micrófono) reintentaban en bucle; errores de red
//     reintentaban sin pausa. → Fatal = se detiene; red = reintento con espera creciente.
//  5. Mientras el asistente habla, el micrófono se oía a sí mismo ("¿atención o clienta?" →
//     "atención"). → `pausado`: se corta el reconocedor mientras habla y se descarta lo que
//     tuviera a medias; al terminar arranca uno limpio.

import { contieneWakeWord, esComandoCorto } from './conversacionGlowdesk'

export type EstadoMicrofono = 'inactivo' | 'escuchando' | 'no_disponible' | 'error'

export interface ResultadoReconocimiento {
  id: string
  texto: string
}

export interface AlternativaLike {
  transcript: string
}

export interface ResultadoLike {
  readonly isFinal: boolean
  readonly length: number
  [indice: number]: AlternativaLike
}

export interface EventoResultadoLike {
  resultIndex: number
  results: { readonly length: number; [indice: number]: ResultadoLike }
}

export interface ReconocedorLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  onresult: ((e: EventoResultadoLike) => void) | null
}

export interface Reloj {
  set(fn: () => void, ms: number): number
  clear(id: number): void
  ahora(): number
}

export interface OpcionesControlador {
  crear: () => ReconocedorLike | null
  onFinal: (r: ResultadoReconocimiento) => void
  onProvisional?: (texto: string) => void
  onEstado?: (estado: EstadoMicrofono, error: string | null) => void
  anticipar?: (texto: string) => boolean
  reloj?: Reloj
  log?: (evento: string, datos?: unknown) => void
  idioma?: string
}

export interface ConfigControlador {
  /** Reanudar solo cuando Chrome cierra la sesión (silencio, 60 s, etc.). */
  mantener: boolean
  /** continuous = false: Chrome cierra el turno en cuanto la persona calla. */
  turnosCortos: boolean
  /** true mientras el asistente habla: no escuchar (evita que se oiga a sí mismo). */
  pausado: boolean
}

const ERRORES_FATALES = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])
const VENTANA_REPETIDO_MS = 1500
const ESPERA_FLUSH_MS = 280
const ESPERA_ONEND_MS = 1500

export function claveNorm(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const relojNavegador: Reloj = {
  set: (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
  clear: (id) => window.clearTimeout(id),
  ahora: () => Date.now(),
}

interface Instancia {
  rec: ReconocedorLike
  continuo: boolean
  emitidos: Set<number>
  provisional: { indice: number; texto: string } | null
  cortadaPorNosotros: boolean
  huboError: boolean
  vigilanteFin: number | null
}

export class ControladorReconocimiento {
  private readonly o: OpcionesControlador
  private readonly reloj: Reloj
  private config: ConfigControlador = { mantener: false, turnosCortos: false, pausado: false }
  private deseado = false
  private actual: Instancia | null = null
  private arranqueProgramado: number | null = null
  private flushTimer: number | null = null
  private erroresSeguidos = 0
  private ultimoEmitido: { clave: string; t: number } | null = null
  private estado: EstadoMicrofono
  private error: string | null = null
  private destruido = false

  constructor(o: OpcionesControlador) {
    this.o = o
    this.reloj = o.reloj ?? relojNavegador
    this.estado = 'inactivo'
  }

  get estadoActual(): EstadoMicrofono {
    return this.estado
  }

  configurar(parcial: Partial<ConfigControlador>) {
    this.config = { ...this.config, ...parcial }
    this.reconciliar()
  }

  /** La persona (o el asistente) quiere escuchar. Idempotente: si ya escucha no hace nada. */
  iniciar() {
    if (this.destruido) return
    if (this.estado === 'error') {
      this.error = null
      this.erroresSeguidos = 0
    }
    this.deseado = true
    this.reconciliar()
  }

  detener() {
    this.deseado = false
    this.reconciliar()
  }

  /** React StrictMode desmonta y vuelve a montar: el mismo controlador debe poder volver. */
  revivir() {
    this.destruido = false
  }

  destruir() {
    this.destruido = true
    this.deseado = false
    this.cancelarFlush()
    if (this.arranqueProgramado != null) this.reloj.clear(this.arranqueProgramado)
    this.arranqueProgramado = null
    if (this.actual) {
      const inst = this.actual
      inst.cortadaPorNosotros = true
      inst.rec.onresult = null
      try { inst.rec.abort() } catch { /* ignore */ }
    }
    this.actual = null
  }

  // ------------------------------------------------------------------ ciclo de vida

  private debeCorrer() {
    return this.deseado && !this.config.pausado && !this.destruido
  }

  private reconciliar() {
    if (!this.debeCorrer()) {
      if (this.arranqueProgramado != null) {
        this.reloj.clear(this.arranqueProgramado)
        this.arranqueProgramado = null
      }
      if (this.actual) this.cortar(this.actual, 'pausa/detener')
      this.fijarEstado(this.estado === 'error' ? 'error' : 'inactivo')
      return
    }
    if (this.actual) {
      // Cambió el modo (turnos cortos ↔ continuo): se corta y el nuevo arranca en onend.
      if (this.actual.continuo === this.config.turnosCortos) this.cortar(this.actual, 'cambio de modo')
      return
    }
    this.programarArranque(this.esperaReintento())
  }

  private esperaReintento() {
    if (this.erroresSeguidos === 0) return 0
    return Math.min(5000, 300 * 2 ** (this.erroresSeguidos - 1))
  }

  private programarArranque(ms: number) {
    if (this.arranqueProgramado != null) return
    this.arranqueProgramado = this.reloj.set(() => {
      this.arranqueProgramado = null
      this.arrancar()
    }, ms)
  }

  private arrancar() {
    if (!this.debeCorrer() || this.actual) return
    const rec = this.o.crear()
    if (!rec) {
      this.deseado = false
      this.fijarEstado('no_disponible')
      return
    }
    const inst: Instancia = {
      rec,
      continuo: !this.config.turnosCortos,
      emitidos: new Set(),
      provisional: null,
      cortadaPorNosotros: false,
      huboError: false,
      vigilanteFin: null,
    }
    rec.lang = this.o.idioma ?? 'es-CO'
    rec.continuous = inst.continuo
    rec.interimResults = true
    rec.maxAlternatives = 3
    rec.onstart = () => {
      if (this.actual !== inst) return
      this.error = null
      this.fijarEstado('escuchando')
    }
    rec.onerror = (e) => this.alError(inst, e.error)
    rec.onend = () => this.alTerminar(inst)
    rec.onresult = (e) => this.alResultado(inst, e)
    this.actual = inst
    this.log('start', { continuo: inst.continuo })
    try {
      rec.start()
    } catch (err) {
      // InvalidStateError: otro reconocedor aún no suelta el micrófono. Se reintenta.
      this.log('start-falló', String(err))
      this.actual = null
      this.erroresSeguidos += 1
      this.programarArranque(Math.max(300, this.esperaReintento()))
    }
  }

  private cortar(inst: Instancia, motivo: string) {
    if (inst.cortadaPorNosotros) return
    inst.cortadaPorNosotros = true
    this.log('abort', motivo)
    // Lo que estuviera a medias se descarta (puede ser el eco del asistente).
    inst.provisional = null
    this.cancelarFlush()
    this.o.onProvisional?.('')
    try { inst.rec.abort() } catch { /* ignore */ }
    // Algunos navegadores no disparan onend tras abort(): no quedarse colgado.
    inst.vigilanteFin = this.reloj.set(() => this.alTerminar(inst), ESPERA_ONEND_MS)
  }

  private alError(inst: Instancia, codigo: string) {
    if (this.actual !== inst) return
    this.log('error', codigo)
    if (codigo === 'no-speech' || codigo === 'aborted') return
    if (ERRORES_FATALES.has(codigo)) {
      this.deseado = false
      this.error = codigo === 'audio-capture'
        ? 'No se encontró un micrófono disponible.'
        : 'Se necesita permiso del micrófono.'
      this.fijarEstado('error')
      return
    }
    // network y demás: se reintenta con espera creciente al terminar.
    inst.huboError = true
    this.erroresSeguidos += 1
    if (this.erroresSeguidos >= 3) {
      this.error = codigo === 'network'
        ? 'El reconocimiento de voz no tiene conexión. Reintentando…'
        : `Error de reconocimiento: ${codigo}`
      this.o.onEstado?.(this.estado, this.error)
    }
  }

  private alTerminar(inst: Instancia) {
    if (inst.vigilanteFin != null) {
      this.reloj.clear(inst.vigilanteFin)
      inst.vigilanteFin = null
    }
    if (this.actual !== inst) return
    this.actual = null
    this.log('end', { cortada: inst.cortadaPorNosotros })
    // Una sesión que terminó sin error (p. ej. silencio) demuestra que el servicio responde.
    if (!inst.huboError) this.erroresSeguidos = 0
    if (!inst.cortadaPorNosotros) {
      this.flushProvisional(inst)
      if (!this.config.mantener) this.deseado = false
    }
    this.reconciliar()
  }

  // ------------------------------------------------------------------ resultados

  private alResultado(inst: Instancia, e: EventoResultadoLike) {
    if (this.actual !== inst || inst.cortadaPorNosotros) return
    let provisional = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (inst.emitidos.has(i)) continue
      const resultado = e.results[i]
      let texto = (resultado[0]?.transcript ?? '').trim()
      if (!texto) continue
      for (let a = 0; a < resultado.length; a++) {
        const alt = (resultado[a]?.transcript ?? '').trim()
        if (alt && (esComandoCorto(alt) || this.o.anticipar?.(alt))) {
          texto = alt
          break
        }
      }
      if (resultado.isFinal || esComandoCorto(texto) || this.o.anticipar?.(texto)) {
        inst.emitidos.add(i)
        if (inst.provisional?.indice === i) {
          inst.provisional = null
          this.cancelarFlush()
        }
        this.erroresSeguidos = 0
        this.emitir(texto)
      } else {
        provisional += (provisional ? ' ' : '') + texto
        this.programarFlush(inst, i, texto)
      }
    }
    this.o.onProvisional?.(provisional)
  }

  private valeFlushRapido(texto: string) {
    if (esComandoCorto(texto) || (this.o.anticipar?.(texto) ?? false)) return true
    return /^(si|sip|s|se|no|nop|listo|ya|dale|ok|okay|uno|dos|tres)$/.test(claveNorm(texto))
  }

  private programarFlush(inst: Instancia, indice: number, texto: string) {
    inst.provisional = { indice, texto }
    this.cancelarFlush()
    if (!this.valeFlushRapido(texto)) return
    this.flushTimer = this.reloj.set(() => {
      this.flushTimer = null
      this.flushProvisional(inst)
    }, ESPERA_FLUSH_MS)
  }

  private flushProvisional(inst: Instancia) {
    this.cancelarFlush()
    const p = inst.provisional
    inst.provisional = null
    this.o.onProvisional?.('')
    if (!p || inst.emitidos.has(p.indice) || !this.valeFlushRapido(p.texto)) return
    inst.emitidos.add(p.indice)
    this.emitir(p.texto)
  }

  private cancelarFlush() {
    if (this.flushTimer != null) {
      this.reloj.clear(this.flushTimer)
      this.flushTimer = null
    }
  }

  private emitir(texto: string) {
    const recorte = texto.trim()
    if (!recorte) return
    const clave = claveNorm(recorte)
    const ahora = this.reloj.ahora()
    if (!contieneWakeWord(recorte) && this.ultimoEmitido?.clave === clave && ahora - this.ultimoEmitido.t < VENTANA_REPETIDO_MS) {
      this.log('repetido-descartado', recorte)
      return
    }
    this.ultimoEmitido = { clave, t: ahora }
    this.log('final', recorte)
    this.o.onFinal({ id: `${clave}-${ahora}`, texto: recorte })
  }

  private fijarEstado(estado: EstadoMicrofono) {
    if (estado !== 'error') this.error = estado === 'escuchando' ? this.error : null
    if (this.estado === estado && estado !== 'error') return
    this.estado = estado
    this.o.onEstado?.(estado, this.error)
  }

  private log(evento: string, datos?: unknown) {
    this.o.log?.(evento, datos)
  }
}
