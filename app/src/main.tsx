import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Registro activo del service worker (en vez del script auto-inyectado, ver vite.config.ts):
// con la app guardada como acceso directo en el celular, el navegador puede tardar mucho — o no
// llegar nunca — a notar por su cuenta que hay una versión nueva mientras la empleada no cierre
// la app del todo. Acá se revisa explícitamente cada vez que la app vuelve a primer plano y cada
// 30 minutos mientras queda abierta, y ante una versión nueva se activa y recarga sola, sin
// pedirle nada a quien la esté usando (mismo criterio que registerType: 'autoUpdate').
const actualizarSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    actualizarSW(true)
  },
  onRegisteredSW(_url, registro) {
    if (!registro) return
    const revisarActualizacion = () => registro.update().catch(() => {})
    setInterval(revisarActualizacion, 30 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revisarActualizacion()
    })
  },
})
