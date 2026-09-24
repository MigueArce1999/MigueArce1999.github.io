// Experiencia guiada para agregar el portal de empleadas a la pantalla de inicio. Un solo botón
// sirve para las dos plataformas: en Android dispara el prompt nativo de instalación; en iOS
// (que nunca ofrece ese prompt) abre una guía con los pasos manuales de Safari.

import { useState, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { useInstallPrompt } from '../../lib/pwa/useInstallPrompt'

const CLAVE_BANNER_OCULTO = 'pwa-banner-oculto'

export function InstalarAppBanner() {
  const { instalada, plataforma, puedeInstalarNativo, instalar } = useInstallPrompt()
  const [guiaAbierta, setGuiaAbierta] = useState(false)
  const [oculto, setOculto] = useState(() => {
    try {
      return localStorage.getItem(CLAVE_BANNER_OCULTO) === '1'
    } catch {
      return false
    }
  })

  if (instalada || oculto) return null

  function descartar() {
    setOculto(true)
    try {
      localStorage.setItem(CLAVE_BANNER_OCULTO, '1')
    } catch {
      // localStorage puede no estar disponible (navegación privada); no es crítico aquí.
    }
  }

  async function alPulsarInstalar() {
    if (puedeInstalarNativo) {
      const resultado = await instalar()
      if (resultado === 'accepted') descartar()
      return
    }
    setGuiaAbierta(true)
  }

  return (
    <>
      <div className="flex flex-col items-start gap-2 rounded-xl border border-oliva/30 bg-oliva/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden>📲</span>
          <div>
            <p className="text-sm font-semibold text-carbon">Instala la app en tu teléfono</p>
            <p className="text-xs text-carbon/60">Ábrela como una app, sin buscarla en el navegador cada vez.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
          <Button tamano="sm" onClick={alPulsarInstalar}>{puedeInstalarNativo ? 'Instalar' : 'Ver cómo'}</Button>
          <button onClick={descartar} aria-label="Ocultar sugerencia de instalación" className="rounded-lg px-2 py-1.5 text-carbon/40 hover:bg-piedra/50 hover:text-carbon/70">
            ×
          </button>
        </div>
      </div>
      <GuiaInstalacionModal abierta={guiaAbierta} onCerrar={() => setGuiaAbierta(false)} plataforma={plataforma} />
    </>
  )
}

// Punto de entrada permanente (Mi perfil) para quien descartó el banner o quiere reinstalar en
// un celular nuevo — la instalación nunca depende de haber visto el banner a tiempo.
export function BotonInstalarApp() {
  const { instalada, plataforma, puedeInstalarNativo, instalar } = useInstallPrompt()
  const [guiaAbierta, setGuiaAbierta] = useState(false)

  if (instalada) {
    return <p className="text-sm text-carbon/60">✅ Ya tienes esta app instalada en este dispositivo.</p>
  }
  async function alPulsar() {
    if (puedeInstalarNativo) {
      await instalar()
      return
    }
    setGuiaAbierta(true)
  }

  return (
    <>
      <Button variante="outline" onClick={alPulsar}>📲 Instalar en mi teléfono</Button>
      <GuiaInstalacionModal abierta={guiaAbierta} onCerrar={() => setGuiaAbierta(false)} plataforma={plataforma} />
    </>
  )
}

function GuiaInstalacionModal({
  abierta,
  onCerrar,
  plataforma,
}: {
  abierta: boolean
  onCerrar: () => void
  plataforma: 'android' | 'ios' | 'otra'
}) {
  return (
    <Modal abierto={abierta} onCerrar={onCerrar} titulo="Agregar a la pantalla de inicio">
      {plataforma === 'ios' ? (
        <ol className="flex flex-col gap-3 text-sm text-carbon">
          <PasoGuia numero={1} texto="Toca el botón Compartir en la barra de Safari." icono={<IconoCompartirIOS />} />
          <PasoGuia numero={2} texto='Desliza hacia abajo en la lista y toca "Agregar a inicio".' icono="➕" />
          <PasoGuia numero={3} texto='Toca "Agregar" arriba a la derecha.' icono="✔️" />
        </ol>
      ) : plataforma === 'android' ? (
        <ol className="flex flex-col gap-3 text-sm text-carbon">
          <PasoGuia numero={1} texto="Toca el menú (⋮) arriba a la derecha de Chrome." icono="⋮" />
          <PasoGuia numero={2} texto='Toca "Instalar app" o "Agregar a pantalla de inicio".' icono="➕" />
          <PasoGuia numero={3} texto="Confirma tocando Instalar." icono="✔️" />
        </ol>
      ) : (
        <ol className="flex flex-col gap-3 text-sm text-carbon">
          <PasoGuia numero={1} texto="En Chrome o Edge, mira el icono de instalar en la barra de direcciones." icono="💻" />
          <PasoGuia numero={2} texto='Si no está, abre el menú del navegador y elige "Instalar app" o "Instalar Claudia Patricia".' icono="⋮" />
          <PasoGuia numero={3} texto="Confirma. El icono queda en el Dock o en el escritorio." icono="✔️" />
        </ol>
      )}
      <p className="mt-4 text-xs text-carbon/50">
        Una vez instalada, el ícono queda en tu pantalla de inicio como cualquier otra app — no ocupa espacio de más ni descarga nada pesado.
      </p>
    </Modal>
  )
}

function PasoGuia({ numero, texto, icono }: { numero: number; texto: string; icono: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg bg-piedra/30 px-3 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-oliva text-xs font-semibold text-blanco">{numero}</span>
      <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center text-lg">{icono}</span>
      <span>{texto}</span>
    </li>
  )
}

// El glifo nativo de "Compartir" de iOS es un carácter de la zona de uso privado de Apple
// (SF Symbols) que nunca se renderiza en contenido web — ni en este navegador ni en Safari — así
// que se dibuja a mano el mismo ícono (cuadrado con flecha hacia arriba) como SVG.
function IconoCompartirIOS() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-oliva">
      <path d="M12 16V4" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}
