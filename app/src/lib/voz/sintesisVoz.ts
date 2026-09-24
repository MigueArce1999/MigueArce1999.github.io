import type { GeneroVozAsistente } from './conversacionGlowdesk'

export function sintesisDisponible(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function vocesEspanol(): SpeechSynthesisVoice[] {
  if (!sintesisDisponible()) return []
  return window.speechSynthesis.getVoices().filter((v) => {
    const lang = v.lang.toLowerCase()
    return lang.startsWith('es') && !lang.startsWith('en')
  })
}

function pareceFemenina(v: SpeechSynthesisVoice): boolean {
  return /female|femenin|woman|paulina|sabina|monica|helena|lucia|lucia|soledad|dalia|elsa|maria|google español/i.test(v.name)
    && !/male|masculin|jorge|carlos|juan|diego|jorge/i.test(v.name)
}

function pareceMasculina(v: SpeechSynthesisVoice): boolean {
  return /male|masculin|man|jorge|carlos|juan|diego|pablo|enrique|google español de estados unidos/i.test(v.name)
}

export function elegirVoz(genero: GeneroVozAsistente): SpeechSynthesisVoice | null {
  const voces = vocesEspanol()
  if (voces.length === 0) return null
  const preferidas = genero === 'masculina' ? voces.filter(pareceMasculina) : voces.filter(pareceFemenina)
  return preferidas[0] ?? voces.find((v) => v.lang.toLowerCase().startsWith('es-co') || v.lang.toLowerCase().startsWith('es-mx')) ?? voces[0]
}

export function hablar(texto: string, genero: GeneroVozAsistente): Promise<void> {
  if (!sintesisDisponible() || !texto.trim()) return Promise.resolve()
  window.speechSynthesis.cancel()
  return new Promise((resolve) => {
    let listo = false
    const terminar = () => {
      if (listo) return
      listo = true
      resolve()
    }
    const u = new SpeechSynthesisUtterance(texto)
    u.lang = 'es-CO'
    u.rate = 1.08
    const voz = elegirVoz(genero)
    if (voz && voz.lang.toLowerCase().startsWith('es')) u.voice = voz
    u.onend = terminar
    u.onerror = terminar
    window.speechSynthesis.speak(u)
    // Chrome a veces no dispara onend; un toque pause/resume y un tope de tiempo despegan el turno.
    window.setTimeout(() => {
      try {
        window.speechSynthesis.pause()
        window.speechSynthesis.resume()
      } catch { /* ignore */ }
    }, 40)
    window.setTimeout(terminar, Math.min(10_000, Math.max(1600, texto.length * 65)))
  })
}

export function callar() {
  if (sintesisDisponible()) window.speechSynthesis.cancel()
}

/** Chrome carga las voces de forma asíncrona; hay que esperarlas una vez. */
export function esperarVoces(): Promise<void> {
  if (!sintesisDisponible()) return Promise.resolve()
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve()
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)
    window.setTimeout(done, 1500)
  })
}
