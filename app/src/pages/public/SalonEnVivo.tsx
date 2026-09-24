// "Salón en vivo" (secciones 4 y 9 del pedido): estado del salón ahora mismo, agrupado por
// zonas, con selector de servicio opcional. Fase 5 — todavía sin el flujo de solicitud (Fase 7):
// tocar una profesional solo abre su detalle de solo lectura.
import { useEffect, useMemo, useState } from 'react'
import { useSalonEnVivo } from '../../lib/disponibilidadEnVivo/useSalonEnVivo'
import { textoDemandaSalon } from '../../lib/disponibilidadEnVivo/textoDisponibilidad'
import { TarjetaZonaSalon } from '../../components/disponibilidadEnVivo/TarjetaZonaSalon'
import { ModalDetalleProfesionalEnVivo } from '../../components/disponibilidadEnVivo/ModalDetalleProfesionalEnVivo'
import { Select } from '../../components/ui/Campos'
import { Card, EmptyState, ErrorState } from '../../components/ui/Estados'
import { listarServicios } from '../../lib/api/catalogo'
import type { ProfesionalEnVivo, Servicio } from '../../lib/types'

const ZONA_SIN_ASIGNAR = { id: '__sin_zona__', nombre: 'Otros' }
const FORMATO_HORA = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' })

export function SalonEnVivo() {
  const [servicioId, setServicioId] = useState<string | null>(null)
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [profesionalSeleccionado, setProfesionalSeleccionado] = useState<ProfesionalEnVivo | null>(null)
  const { salon, cargando, error, conectado, recargar } = useSalonEnVivo(servicioId)

  useEffect(() => {
    listarServicios().then(setServicios).catch(() => setServicios([]))
  }, [])

  const gruposPorZona = useMemo(() => {
    if (!salon || !salon.activo) return []
    const grupos: { zona: { id: string; nombre: string }; profesionales: ProfesionalEnVivo[] }[] = salon.zonas.map((z) => ({
      zona: z,
      profesionales: salon.profesionales.filter((p) => p.zonas.includes(z.id)),
    }))
    const sinZona = salon.profesionales.filter((p) => p.zonas.length === 0)
    if (sinZona.length > 0) grupos.push({ zona: ZONA_SIN_ASIGNAR, profesionales: sinZona })
    return grupos
  }, [salon])

  const hayAlguienDisponible = salon?.activo && salon.profesionales.some((p) => p.estado.status === 'available' || p.estado.status === 'upcoming_appointment')

  const proximaDisponibilidad = useMemo(() => {
    if (!salon || !salon.activo) return null
    const proximas = salon.profesionales
      .map((p) => p.estado.proxima_disponible_en)
      .filter((v): v is string => v != null)
      .map((v) => new Date(v).getTime())
      .sort((a, b) => a - b)
    return proximas.length > 0 ? FORMATO_HORA.format(proximas[0]) : null
  }, [salon])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-[40px]">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/60">Salón en vivo</p>
        <h1 className="font-marca text-4xl text-carbon">Así está el salón ahora</h1>
      </div>

      {cargando && !salon && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-piedra/50" />)}
        </div>
      )}

      {error && <ErrorState mensaje={error} reintentar={() => recargar()} />}

      {salon && !salon.activo && (
        <EmptyState titulo="Esta función no está activa por aquí" descripcion="El salón todavía no habilitó la disponibilidad en vivo." />
      )}

      {salon?.activo && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-lg font-semibold text-carbon">
              <span aria-hidden>{textoDemandaSalon(salon.demanda).emoji}</span>
              {textoDemandaSalon(salon.demanda).texto}
            </span>
            <span className="text-xs text-carbon/50">
              {conectado ? 'Actualizado en vivo' : 'Actualizando disponibilidad…'}
            </span>
          </Card>

          {servicios.length > 0 && (
            <Select
              id="filtro-servicio-salon-en-vivo"
              etiqueta="¿Qué quieres hacerte?"
              value={servicioId ?? ''}
              onChange={(e) => setServicioId(e.target.value || null)}
            >
              <option value="">Cualquier servicio</option>
              {servicios.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </Select>
          )}

          {!hayAlguienDisponible ? (
            <EmptyState
              titulo="No hay profesionales disponibles en este momento."
              descripcion={proximaDisponibilidad ? `Próxima disponibilidad: ${proximaDisponibilidad}` : undefined}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {gruposPorZona.map(({ zona, profesionales }) => (
                <TarjetaZonaSalon key={zona.id} zona={zona} profesionales={profesionales} onVerDetalle={(id) => {
                  const p = salon.profesionales.find((pr) => pr.profesional_id === id)
                  if (p) setProfesionalSeleccionado(p)
                }} />
              ))}
            </div>
          )}
        </>
      )}

      <ModalDetalleProfesionalEnVivo profesional={profesionalSeleccionado} onCerrar={() => setProfesionalSeleccionado(null)} />
    </div>
  )
}
