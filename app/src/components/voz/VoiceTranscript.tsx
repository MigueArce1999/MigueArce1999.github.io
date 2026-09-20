// Transcripción provisional mientras la persona sigue hablando (sección 20): se muestra en
// vivo, en cursiva, y desaparece en cuanto llega el resultado final (que pasa a formar parte
// del draft, no de este componente — nunca se re-muestra el texto crudo después).

export function VoiceTranscript({ texto, escuchando }: { texto: string; escuchando: boolean }) {
  if (!escuchando || !texto) return null
  return (
    <p className="rounded-lg bg-blanco px-3 py-2 text-sm italic text-carbon/60" aria-live="off">
      {texto}…
    </p>
  )
}
