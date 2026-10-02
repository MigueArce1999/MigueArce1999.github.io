import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // autoUpdate reemplaza el service worker en la siguiente visita. Con `prompt` el
      // worker viejo se quedaba instalado y seguía sirviendo un JS que ya no existe.
      registerType: 'autoUpdate',
      // El registro lo hace a mano src/main.tsx (virtual:pwa-register), para poder revisar
      // activamente si hay una versión nueva (al volver del segundo plano y cada cierto rato) en
      // vez de esperar a que el navegador lo note solo — con el acceso directo del celular
      // guardado, eso podía tardar mucho o nunca pasar mientras la empleada no cerrara la app.
      injectRegister: false,
      includeAssets: ['favicon.png', 'favicon.svg', 'logo-claudia-patricia.png', 'icons/apple-touch-icon.png'],
      manifest: {
        // Un solo manifest para los 3 portales (admin, empleadas y clientas comparten el mismo
        // SPA/scope) — nombre y descripción genéricos, nunca de un portal en particular, para que
        // el ícono que queda en la pantalla de inicio tenga sentido sin importar quién instaló.
        name: 'Claudia Patricia',
        short_name: 'C. Patricia',
        description: 'Agenda tu cita, consulta tus puntos y tu Diario de belleza, o atiende el salón, todo desde el celular.',
        // Con HashRouter, cualquier URL real del sitio es "/" — start_url cae ahí y la propia
        // Home.tsx redirige de una a la ruta del rol de quien ya tiene sesión iniciada
        // (ver useEffect en pages/public/Home.tsx), así que cada persona aterriza directo en su
        // portal (clienta, empleada o admin) sin necesitar lógica de redirección extra aquí.
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#e6e1d7',
        theme_color: '#394638',
        lang: 'es',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Solo el cascarón (HTML/JS/CSS/íconos) se precachea para que la app abra instantánea
        // incluso con mala señal — los datos reales (clientas, agenda, ventas) siempre se piden
        // en vivo a Supabase, nunca se sirven desde caché, para no mostrar cifras ni citas
        // desactualizadas en un negocio donde eso importa.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
})
