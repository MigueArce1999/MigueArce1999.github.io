import { defineConfig } from 'vitest/config'

// Separado de vite.config.ts a propósito: las pruebas de este proyecto son unitarias sobre
// lógica pura (por ahora, el intérprete de voz en lib/voz) y no necesitan los plugins de
// React/Tailwind ni un DOM simulado.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
