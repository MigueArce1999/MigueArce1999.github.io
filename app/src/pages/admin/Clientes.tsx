import { useEffect, useState } from 'react'
import { Card, Cargando, EmptyState, ErrorState } from '../../components/ui/Estados'
import { listarClientes } from '../../lib/api/admin'
import { formatoMoneda } from '../../lib/format'
import type { Cliente } from '../../lib/types'

export function AdminClientes() {
  const [busqueda, setBusqueda] = useState('')
  const [clientes, setClientes] = useState<Cliente[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      listarClientes(busqueda || undefined).then(setClientes).catch((e) => setError(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [busqueda])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-marca text-2xl font-semibold text-carbon">Clientes</h1>
      <input
        placeholder="Buscar por nombre, teléfono o correo…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="rounded-lg border border-piedra px-3 py-2 text-sm sm:max-w-sm"
      />

      {error && <ErrorState mensaje={error} />}
      {!clientes ? (
        <Cargando />
      ) : clientes.length === 0 ? (
        <EmptyState titulo="No hay clientes con ese criterio" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-piedra bg-blanco">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-piedra bg-piedra/20 text-xs uppercase tracking-wide text-carbon/50">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Contacto</th>
                <th className="px-4 py-3">Visitas</th>
                <th className="px-4 py-3">Gasto acumulado</th>
                <th className="px-4 py-3">Cuenta</th>
                <th className="px-4 py-3">Marketing</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className="border-b border-piedra/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-carbon">{c.nombre}</td>
                  <td className="px-4 py-3 text-carbon/70">{c.telefono || c.email || '—'}</td>
                  <td className="px-4 py-3">{c.visitas_completadas}</td>
                  <td className="px-4 py-3">{formatoMoneda(c.gasto_acumulado)}</td>
                  <td className="px-4 py-3">{c.usuario_id ? 'Con cuenta' : 'Sin cuenta (recepción)'}</td>
                  <td className="px-4 py-3">{c.consentimiento_marketing ? 'Sí' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Card className="text-xs text-carbon/50">
        Fase 2: detección y fusión asistida de posibles duplicados (mismo teléfono/correo con nombres distintos).
      </Card>
    </div>
  )
}
