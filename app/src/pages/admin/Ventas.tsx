import { useEffect, useState } from 'react'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { EstadoAtencionBadge, EstadoPagoBadge } from '../../components/ui/StatusBadge'
import { isDemoMode, supabaseRequerido } from '../../lib/supabase'
import { demoHistorialAtenciones } from '../../lib/demoData'
import { formatoFecha, formatoMoneda } from '../../lib/format'
import type { Atencion } from '../../lib/types'

export function AdminVentas() {
  const [atenciones, setAtenciones] = useState<Atencion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode) {
      setAtenciones(demoHistorialAtenciones)
      return
    }
    const client = supabaseRequerido()
    client
      .from('vista_atencion')
      .select('*')
      .order('creado_en', { ascending: false })
      .limit(50)
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setAtenciones((data ?? []) as unknown as Atencion[])
      })
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Ventas y cobros</h1>
      <p className="text-sm text-carbon/60">
        Registro de operaciones. La apertura/cierre de caja con arqueo de efectivo es un módulo de Fase 2.
      </p>

      {error && <ErrorState mensaje={error} />}
      {!atenciones ? (
        <Cargando />
      ) : atenciones.length === 0 ? (
        <EmptyState titulo="No hay ventas registradas todavía" />
      ) : (
        <div className="flex flex-col gap-2">
          {atenciones.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium text-carbon">{a.cliente_nombre}</p>
                <p className="text-xs text-carbon/60">{formatoFecha(a.completado_en ?? a.creado_en)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-oliva">{formatoMoneda(a.total_pagado)}</span>
                <EstadoPagoBadge pagado={a.total_pagado ?? 0} total={a.total_vendido ?? 0} />
                <EstadoAtencionBadge estado={a.estado} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
