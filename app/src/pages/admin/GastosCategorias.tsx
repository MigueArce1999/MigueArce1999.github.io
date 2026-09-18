import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Campos'
import { ErrorState } from '../../components/ui/Estados'
import { cambiarActivaCategoriaGasto, crearCategoriaGasto } from '../../lib/api/gastos'
import type { CategoriaGasto } from '../../lib/types'

// Desactivar (nunca borrar) conserva el historial de los gastos ya registrados con esa
// categoría — solo deja de ofrecerse para gastos nuevos (ver categoriasDisponibles en
// GastosFormulario.tsx).
export function GastosCategorias({ categorias, onCambio }: { categorias: CategoriaGasto[]; onCambio: () => void }) {
  const [nombreNueva, setNombreNueva] = useState('')
  const [creando, setCreando] = useState(false)
  const [cambiandoId, setCambiandoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function crear() {
    setError(null)
    const nombre = nombreNueva.trim()
    if (!nombre) return
    if (categorias.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) {
      setError('Ya existe una categoría con ese nombre.')
      return
    }
    setCreando(true)
    try {
      await crearCategoriaGasto(nombre)
      setNombreNueva('')
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreando(false)
    }
  }

  async function cambiarActiva(id: string, activa: boolean) {
    setCambiandoId(id)
    setError(null)
    try {
      await cambiarActivaCategoriaGasto(id, activa)
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCambiandoId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id="catNueva"
            etiqueta="Nueva categoría"
            value={nombreNueva}
            onChange={(e) => setNombreNueva(e.target.value)}
            placeholder="Ej: Insumos"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); crear() } }}
          />
        </div>
        <Button tamano="sm" onClick={crear} cargando={creando} disabled={!nombreNueva.trim()}>Agregar</Button>
      </div>

      <ul className="flex flex-col divide-y divide-piedra rounded-xl border border-piedra">
        {categorias.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className={`text-sm ${c.activa ? 'text-carbon' : 'text-carbon/40 line-through'}`}>{c.nombre}</span>
            <button
              onClick={() => cambiarActiva(c.id, !c.activa)}
              disabled={cambiandoId === c.id}
              className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                c.activa ? 'bg-piedra text-carbon/70 hover:bg-piedra/70' : 'bg-oliva/15 text-oliva hover:bg-oliva/25'
              }`}
            >
              {cambiandoId === c.id ? '…' : c.activa ? 'Desactivar' : 'Reactivar'}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-carbon/50">
        Desactivar una categoría no borra el historial de los gastos ya registrados con ella; solo deja de
        ofrecerse para gastos nuevos.
      </p>
    </div>
  )
}
