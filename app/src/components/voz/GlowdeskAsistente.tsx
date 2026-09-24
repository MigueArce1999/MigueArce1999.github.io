import { useGlowdeskAsistente } from '../../lib/voz/useGlowdeskAsistente'
import { puedeUsarGlowdesk } from '../../lib/voz/conversacionGlowdesk'
import { useAuth } from '../../state/AuthContext'
import { LOCAL_ID } from '../../lib/supabase'

export function GlowdeskAsistente() {
  const { haySesion, perfil, cargando } = useAuth()
  const delSalon = !LOCAL_ID || !perfil?.local_id || perfil.local_id === LOCAL_ID
  if (cargando && !perfil) return null
  if (!puedeUsarGlowdesk(haySesion, perfil) || !delSalon) return null
  return <GlowdeskAsistenteActivo />
}

function GlowdeskAsistenteActivo() {
  const g = useGlowdeskAsistente()

  if (!g.micDisponible) return null

  const oyendo = g.modo === 'silencio' || g.modo === 'escuchando'
  const etiquetaFab = g.abierto
    ? 'Cerrar'
    : g.modo === 'apagado'
      ? 'Toca para activar'
      : 'Di hola Glowdesk'

  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2 md:bottom-6">
      {g.abierto && (
        <div
          className="pointer-events-auto w-[min(100vw-2rem,22rem)] rounded-2xl border border-oliva/30 bg-blanco p-4 shadow-xl"
          role="region"
          aria-label="Asistente Glowdesk"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="font-marca text-base font-semibold text-carbon">Glowdesk</p>
              <p className="text-xs text-carbon/50">
                {g.modo === 'escuchando' && 'Te escucho · español'}
                {g.modo === 'hablando' && 'Hablando'}
                {g.modo === 'pensando' && 'Un momento…'}
                {g.modo === 'silencio' && 'Di hola Glowdesk'}
                {g.modo === 'apagado' && 'En pausa'}
              </p>
            </div>
            <button type="button" onClick={g.apagar} className="rounded-lg px-2 py-1 text-xs font-semibold text-carbon/60 hover:bg-piedra/40" aria-label="Cerrar Glowdesk">
              Cerrar
            </button>
          </div>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {g.dialogo.map((turno, i) => (
              <p
                key={`${i}-${turno.texto.slice(0, 12)}`}
                className={`rounded-xl px-3 py-2 text-sm ${turno.de === 'glowdesk' ? 'bg-oliva/10 text-carbon' : 'bg-piedra/50 text-carbon self-end'}`}
              >
                {turno.de === 'tu' ? `Te oí: ${turno.texto}` : turno.texto}
              </p>
            ))}
            {g.provisional && <p className="text-xs italic text-carbon/40">Oyendo: {g.provisional}</p>}
          </div>
          {g.error && <p className="mt-2 text-xs font-medium text-error">{g.error}</p>}
          <p className="mt-3 text-[11px] leading-snug text-carbon/45">
            Di «atención» o «clienta».
          </p>
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-2">
        {!g.abierto && (
          <span className="rounded-full bg-carbon/80 px-3 py-1 text-[11px] font-medium text-blanco">
            {etiquetaFab}
          </span>
        )}
        <button
          type="button"
          onClick={g.abierto ? g.apagar : () => void g.encender()}
          aria-pressed={g.abierto}
          aria-label={g.abierto ? 'Cerrar Glowdesk' : etiquetaFab}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition ${
            g.abierto ? 'bg-error text-blanco' : 'bg-oliva text-blanco'
          }`}
        >
          {oyendo && !g.abierto && (
            <span className="absolute inset-0 animate-ping rounded-full bg-oliva/50" aria-hidden />
          )}
          <span aria-hidden className="relative text-xl">{g.abierto ? '■' : '🎙️'}</span>
        </button>
      </div>
    </div>
  )
}
