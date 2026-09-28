import { useEffect, useMemo, useState } from 'react'
import { Card, Cargando, EmptyState, ErrorState } from '../ui/Estados'
import { EstadoAtencionBadge } from '../ui/StatusBadge'
import { listarVentasDetalle } from '../../lib/api/admin'
import { formatoFecha, formatoMoneda } from '../../lib/format'
import type { Profesional, RangoFecha, VentaLinea } from '../../lib/types'

// Tabla de auditoría del Dashboard: de dónde salen los números de arriba. Reutiliza
// listarVentasDetalle (la misma que ya usa la pantalla de Ventas) en vez de crear una segunda
// consulta — filtrada por el mismo rango global, nunca uno propio.
//
// Pendiente para una siguiente vuelta: columnas de "Productos" y "Método de pago" por fila.
// vista_atencion_servicio (la fuente de listarVentasDetalle) no trae esos datos — una atención
// puede tener varios productos y varios métodos de pago a la vez, y day no hay hoy una vista que
// junte servicio+producto+pago en una sola fila sin duplicar renglones. Se necesitaría una vista
// nueva para hacerlo bien; se deja explícito en vez de inventar una columna a medias.
export function SalesTable({ rango, equipo }: { rango: RangoFecha; equipo: Profesional[] }) {
  const [filas, setFilas] = useState<VentaLinea[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profesionalFiltro, setProfesionalFiltro] = useState('todas')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda.trim().toLowerCase()), 300)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    setFilas(null)
    listarVentasDetalle(rango.desde.toISOString(), rango.hasta.toISOString(), profesionalFiltro === 'todas' ? null : profesionalFiltro)
      .then(setFilas)
      .catch((e) => setError(e.message))
  }, [rango, profesionalFiltro])

  const filtradas = useMemo(() => {
    if (!filas) return null
    if (!busquedaDebounced) return filas
    return filas.filter((f) => f.cliente_nombre?.toLowerCase().includes(busquedaDebounced) || f.nombre_snapshot.toLowerCase().includes(busquedaDebounced))
  }, [filas, busquedaDebounced])

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold text-carbon">Detalle de ventas</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente o servicio"
            aria-label="Buscar cliente o servicio"
            className="w-56 rounded-full border border-piedra bg-blanco px-3 py-1.5 text-xs text-carbon outline-none focus:border-oliva"
          />
          <select
            value={profesionalFiltro}
            onChange={(e) => setProfesionalFiltro(e.target.value)}
            aria-label="Filtrar por empleada"
            className="rounded-full border border-piedra bg-blanco px-3 py-1.5 text-xs font-semibold text-carbon"
          >
            <option value="todas">Todas las empleadas</option>
            {equipo.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorState mensaje={error} />}
      {!filtradas ? (
        <Cargando />
      ) : filtradas.length === 0 ? (
        <EmptyState titulo="No se registraron ventas en este periodo" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-piedra">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-piedra/30 text-left text-xs uppercase tracking-wide text-carbon/60">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Servicio</th>
                <th className="px-3 py-2">Profesional</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((f) => (
                <tr key={f.id} className="border-t border-piedra/60">
                  <td className="px-3 py-2 text-carbon/70">{formatoFecha(f.atencion_completado_en ?? f.atencion_creado_en)}</td>
                  <td className="px-3 py-2 font-medium text-carbon">{f.cliente_nombre}</td>
                  <td className="px-3 py-2 text-carbon">{f.nombre_snapshot}</td>
                  <td className="px-3 py-2 text-carbon/70">{f.profesional_nombre ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-carbon">{formatoMoneda((f.precio_snapshot - f.descuento) * f.cantidad)}</td>
                  <td className="px-3 py-2">
                    <EstadoAtencionBadge estado={f.atencion_estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
