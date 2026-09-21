// Detecta si la app corre instalada (modo standalone) y guía la instalación cuando no lo está.
// Android/Chrome ofrecen un evento nativo (`beforeinstallprompt`) que se puede disparar desde un
// botón propio; iOS/Safari nunca lo dispara — ahí la única forma de instalar es el paso a paso
// manual de "Compartir → Agregar a inicio", así que esta app se limita a mostrar esas
// instrucciones en vez de fingir un botón que no puede funcionar.

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type PlataformaInstalacion = 'android' | 'ios' | 'otra'

function detectarPlataforma(): PlataformaInstalacion {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  // iPadOS 13+ se reporta como Mac con soporte táctil — hay que distinguirlo de un Mac real.
  if (/iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'ios'
  return 'otra'
}

export function estaInstalada(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
}

export function useInstallPrompt() {
  const [eventoDiferido, setEventoDiferido] = useState<BeforeInstallPromptEvent | null>(null)
  const [instalada, setInstalada] = useState(estaInstalada)
  const [plataforma] = useState(detectarPlataforma)

  useEffect(() => {
    function alCapturar(e: Event) {
      e.preventDefault()
      setEventoDiferido(e as BeforeInstallPromptEvent)
    }
    function alInstalar() {
      setInstalada(true)
      setEventoDiferido(null)
    }
    window.addEventListener('beforeinstallprompt', alCapturar)
    window.addEventListener('appinstalled', alInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', alCapturar)
      window.removeEventListener('appinstalled', alInstalar)
    }
  }, [])

  async function instalar() {
    if (!eventoDiferido) return 'no_disponible' as const
    await eventoDiferido.prompt()
    const { outcome } = await eventoDiferido.userChoice
    setEventoDiferido(null)
    return outcome
  }

  return {
    instalada,
    plataforma,
    // En Android, solo se puede ofrecer el botón nativo una vez que Chrome disparó el evento
    // (requiere que el manifest+SW ya estén activos); en iOS nunca existe ese evento, así que
    // el llamador debe mostrar la guía manual en su lugar cuando `plataforma === 'ios'`.
    puedeInstalarNativo: eventoDiferido !== null,
    instalar,
  }
}
