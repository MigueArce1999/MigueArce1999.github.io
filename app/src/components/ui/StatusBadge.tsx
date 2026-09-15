import type { EstadoAtencion, EstadoReserva } from '../../lib/types'

// Cada estado combina color + ícono + texto — nunca solo color (ver docs/06-propuesta-visual.md)
// para que quien tenga dificultad para distinguir colores igual entienda el estado.

const estadosReserva: Record<EstadoReserva, { texto: string; clase: string; icono: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-advertencia/15 text-advertencia', icono: '⏳' },
  confirmada: { texto: 'Confirmada', clase: 'bg-oliva/15 text-oliva', icono: '✓' },
  en_atencion: { texto: 'En atención', clase: 'bg-champan/25 text-carbon', icono: '●' },
  completada: { texto: 'Completada', clase: 'bg-exito/15 text-exito', icono: '✓✓' },
  cancelada: { texto: 'Cancelada', clase: 'bg-error/15 text-error', icono: '✕' },
  no_asistio: { texto: 'No asistió', clase: 'bg-carbon/10 text-carbon/70', icono: '!' },
}

const estadosAtencion: Record<EstadoAtencion, { texto: string; clase: string; icono: string }> = {
  en_progreso: { texto: 'En progreso', clase: 'bg-champan/25 text-carbon', icono: '●' },
  completada: { texto: 'Completada', clase: 'bg-exito/15 text-exito', icono: '✓✓' },
  anulada: { texto: 'Anulada', clase: 'bg-error/15 text-error', icono: '✕' },
}

function Badge({ texto, clase, icono }: { texto: string; clase: string; icono: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${clase}`}>
      <span aria-hidden>{icono}</span>
      {texto}
    </span>
  )
}

export function EstadoReservaBadge({ estado }: { estado: EstadoReserva }) {
  return <Badge {...estadosReserva[estado]} />
}

export function EstadoAtencionBadge({ estado }: { estado: EstadoAtencion }) {
  return <Badge {...estadosAtencion[estado]} />
}

export function EstadoPagoBadge({ pagado, total }: { pagado: number; total: number }) {
  if (pagado <= 0) return <Badge texto="Pendiente de pago" clase="bg-advertencia/15 text-advertencia" icono="⏳" />
  if (pagado < total) return <Badge texto="Pago parcial" clase="bg-champan/25 text-carbon" icono="½" />
  return <Badge texto="Pagado" clase="bg-exito/15 text-exito" icono="✓" />
}
