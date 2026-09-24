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
      includeAssets: ['favicon.png', 'favicon.svg', 'logo-claudia-patricia.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Claudia Patricia · Equipo',
        short_name: 'CP Equipo',
        description: 'Portal de empleadas de Claudia Patricia: agenda, atención, ventas y disponibilidad desde el celular.',
        // Con HashRouter, cualquier URL real del sitio es "/" — start_url cae ahí y la propia
        // Home.tsx redirige de una a la ruta del rol de quien ya tiene sesión iniciada
        // (ver useEffect en pages/public/Home.tsx), así que cada empleada aterriza directo en
        // su "Mi día" sin necesitar lógica de redirección extra aquí.
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
