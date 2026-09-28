import { describe, expect, it } from 'vitest'
import {
  ControladorReconocimiento,
  type EventoResultadoLike,
  type ReconocedorLike,
  type Reloj,
} from './controladorReconocimiento'

// Reloj manual: los timers solo corren con avanzar(ms).
function relojFalso() {
  let ahora = 0
  let sig = 1
  const timers = new Map<number, { en: number; fn: () => void }>()
  const reloj: Reloj = {
    set: (fn, ms) => { const id = sig++; timers.set(id, { en: ahora + ms, fn }); return id },
    clear: (id) => { timers.delete(id) },
    ahora: () => ahora,
  }
  function avanzar(ms: number) {
    const fin = ahora + ms
    for (;;) {
      const prox = [...timers.entries()].filter(([, t]) => t.en <= fin).sort((a, b) => a[1].en - b[1].en)[0]
      if (!prox) break
      timers.delete(prox[0])
      ahora = prox[1].en
      prox[1].fn()
    }
    ahora = fin
  }
  return { reloj, avanzar }
}

// Reconocedor falso que imita a Chrome: uno solo puede tener el micrófono.
class RecFalso implements ReconocedorLike {
  static activos = 0
  static creados: RecFalso[] = []
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  corriendo = false
  abortado = false
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onresult: ((e: EventoResultadoLike) => void) | null = null
  resultados: { isFinal: boolean; textos: string[] }[] = []
  constructor() { RecFalso.creados.push(this) }
  start() {
    if (RecFalso.activos > 0) throw new Error('InvalidStateError: already started')
    RecFalso.activos++
    this.corriendo = true
    this.onstart?.()
  }
  stop() { this.terminar() }
  abort() { this.abortado = true; this.terminar() }
  terminar() {
    if (!this.corriendo) return
    this.corriendo = false
    RecFalso.activos--
    this.onend?.()
  }
  decir(indice: number, texto: string, isFinal: boolean) {
    this.resultados[indice] = { isFinal, textos: [texto] }
    const results: any = { length: this.resultados.length }
    this.resultados.forEach((r, i) => {
      const res: any = { isFinal: r.isFinal, length: r.textos.length }
      r.textos.forEach((t, a) => { res[a] = { transcript: t } })
      results[i] = res
    })
    this.onresult?.({ resultIndex: indice, results })
  }
  error(codigo: string) { this.onerror?.({ error: codigo }) }
}

function montar(config = { mantener: true, turnosCortos: false, pausado: false }) {
  RecFalso.activos = 0
  RecFalso.creados = []
  const { reloj, avanzar } = relojFalso()
  const finales: string[] = []
  const estados: string[] = []
  const c = new ControladorReconocimiento({
    crear: () => new RecFalso(),
    onFinal: (r) => finales.push(r.texto),
    onEstado: (e) => estados.push(e),
    reloj,
  })
  c.configurar(config)
  const actual = () => RecFalso.creados[RecFalso.creados.length - 1]
  return { c, avanzar, finales, estados, actual }
}

describe('ControladorReconocimiento', () => {
  it('iniciar varias veces seguidas no crea reconocedores que compitan por el micrófono', () => {
    const { c, avanzar } = montar()
    c.iniciar(); c.iniciar(); c.iniciar()
    avanzar(10)
    c.iniciar()
    avanzar(1000)
    expect(RecFalso.creados).toHaveLength(1)
    expect(RecFalso.activos).toBe(1)
  })

  it('cambiar a turnos cortos corta el actual y arranca UNO nuevo cuando el anterior terminó', () => {
    const { c, avanzar, actual } = montar()
    c.iniciar(); avanzar(10)
    const primero = actual()
    c.configurar({ turnosCortos: true })
    avanzar(10)
    expect(primero.abortado).toBe(true)
    expect(RecFalso.creados).toHaveLength(2)
    expect(actual().continuous).toBe(false)
    expect(RecFalso.activos).toBe(1)
  })

  it('un "sí" provisional y luego final del mismo resultado se emite una sola vez', () => {
    const { c, avanzar, finales, actual } = montar()
    c.iniciar(); avanzar(10)
    actual().decir(0, 'sí', false)
    avanzar(700)
    actual().decir(0, 'sí', true)
    expect(finales).toEqual(['sí'])
  })

  it('repetir la misma frase más tarde SÍ se procesa (antes se descartaba para siempre)', () => {
    const { c, avanzar, finales, actual } = montar()
    c.iniciar(); avanzar(10)
    actual().decir(0, 'registrar a maría pérez', true)
    avanzar(5000)
    actual().decir(1, 'registrar a maría pérez', true)
    expect(finales).toHaveLength(2)
  })

  it('reanuda sola tras un fin natural (silencio) si mantener = true', () => {
    const { c, avanzar, actual } = montar()
    c.iniciar(); avanzar(10)
    actual().terminar()
    avanzar(10)
    expect(RecFalso.creados).toHaveLength(2)
    expect(RecFalso.activos).toBe(1)
  })

  it('sin mantener, un fin natural deja el micrófono inactivo', () => {
    const { c, avanzar, actual, estados } = montar({ mantener: false, turnosCortos: false, pausado: false })
    c.iniciar(); avanzar(10)
    actual().terminar()
    avanzar(1000)
    expect(RecFalso.creados).toHaveLength(1)
    expect(estados[estados.length - 1]).toBe('inactivo')
  })

  it('pausado (el asistente habla) corta el reconocedor y al terminar arranca uno limpio', () => {
    const { c, avanzar, actual } = montar()
    c.iniciar(); avanzar(10)
    const antes = actual()
    c.configurar({ pausado: true })
    avanzar(1000)
    expect(antes.abortado).toBe(true)
    expect(RecFalso.activos).toBe(0)
    expect(RecFalso.creados).toHaveLength(1)
    c.configurar({ pausado: false })
    avanzar(10)
    expect(RecFalso.creados).toHaveLength(2)
    expect(RecFalso.activos).toBe(1)
  })

  it('lo provisional a medias al pausar no se emite', () => {
    const { c, avanzar, finales, actual } = montar()
    c.iniciar(); avanzar(10)
    actual().decir(0, 'una atención o una', false)
    c.configurar({ pausado: true })
    avanzar(2000)
    expect(finales).toHaveLength(0)
  })

  it('permiso denegado detiene los reintentos (no bucle)', () => {
    const { c, avanzar, actual, estados } = montar()
    c.iniciar(); avanzar(10)
    actual().error('not-allowed')
    actual().terminar()
    avanzar(20_000)
    expect(RecFalso.creados).toHaveLength(1)
    expect(estados[estados.length - 1]).toBe('error')
    c.iniciar()
    avanzar(10)
    expect(RecFalso.creados).toHaveLength(2)
  })

  it('errores de red reintentan con espera creciente', () => {
    const { c, avanzar, actual } = montar()
    c.iniciar(); avanzar(10)
    actual().error('network'); actual().terminar()
    avanzar(100)
    expect(RecFalso.creados).toHaveLength(1)
    avanzar(300)
    expect(RecFalso.creados).toHaveLength(2)
    actual().error('network'); actual().terminar()
    avanzar(400)
    expect(RecFalso.creados).toHaveLength(2)
    avanzar(300)
    expect(RecFalso.creados).toHaveLength(3)
  })

  it('si el micrófono sigue ocupado al arrancar, reintenta en vez de quedarse mudo', () => {
    const { c, avanzar } = montar()
    RecFalso.activos = 1 // otro reconocedor (otra pestaña/componente) aún no suelta
    c.iniciar(); avanzar(10)
    expect(RecFalso.creados).toHaveLength(1)
    RecFalso.activos = 0
    avanzar(400)
    expect(RecFalso.creados).toHaveLength(2)
    expect(RecFalso.activos).toBe(1)
  })

  it('si abort() nunca dispara onend, no se queda colgado', () => {
    const { c, avanzar, actual } = montar()
    c.iniciar(); avanzar(10)
    const r = actual()
    r.abort = () => { r.abortado = true } // navegador que no avisa
    c.configurar({ turnosCortos: true })
    avanzar(1600)
    RecFalso.activos = 0
    avanzar(400)
    expect(RecFalso.creados.length >= 2).toBe(true)
  })

  it('"sí" que Chrome deja colgado como provisional se emite tras una pausa corta', () => {
    const { c, avanzar, finales, actual } = montar({ mantener: true, turnosCortos: true, pausado: false })
    c.iniciar(); avanzar(10)
    actual().decir(0, 'dale', false)
    avanzar(300)
    expect(finales).toEqual(['dale'])
    actual().decir(0, 'dale', true)
    expect(finales).toEqual(['dale'])
  })

  it('la palabra de activación siempre pasa, aunque se repita', () => {
    const { c, avanzar, finales, actual } = montar()
    c.iniciar(); avanzar(10)
    actual().decir(0, 'hola glowdesk', true)
    actual().decir(1, 'hola glowdesk', true)
    expect(finales).toHaveLength(2)
  })
})
