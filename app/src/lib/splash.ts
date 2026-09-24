export const SPLASH_CACHE_KEY = 'glowdesk-splash-url'
export const SPLASH_DURACION_MS = 3000
export const SPLASH_DEFAULT = '/logo-claudia-patricia.png'

export function esVideoSplash(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url)
}

export function splashDesdeMarca(marca: { splash_url?: string | null; logo_url?: string | null }) {
  return marca.splash_url || marca.logo_url || SPLASH_DEFAULT
}

export function leerSplashCache(): string | null {
  try {
    return localStorage.getItem(SPLASH_CACHE_KEY)
  } catch {
    return null
  }
}

export function guardarSplashCache(url: string) {
  try {
    localStorage.setItem(SPLASH_CACHE_KEY, url)
  } catch {
    /* privado / cuota */
  }
}

export function retirarPantallaCargaHtml() {
  const p = document.getElementById('pantalla-carga')
  if (!p) return
  p.classList.add('oculta')
  window.setTimeout(() => p.remove(), 300)
}
