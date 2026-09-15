import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { Modal } from '../../components/ui/Modal'
import { isDemoMode, supabase, supabaseRequerido } from '../../lib/supabase'
import { listarCategorias, listarServicios } from '../../lib/api/catalogo'
import { formatoMoneda } from '../../lib/format'
import type { CategoriaServicio, Servicio, TipoPrecioServicio } from '../../lib/types'

export function AdminServicios() {
  const [servicios, setServicios] = useState<Servicio[] | null>(null)
  const [categorias, setCategorias] = useState<CategoriaServicio[]>([])
  const [modalAbierto, setModalAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function recargar() {
    listarServicios().then(setServicios).catch((e) => setError(e.message))
  }

  useEffect(() => {
    recargar()
    listarCategorias().then(setCategorias)
  }, [])

  async function alternarActivo(s: Servicio) {
    if (isDemoMode) return
    const client = supabaseRequerido()
    // Desactivar nunca borra: solo dejan de ofrecerse en el sitio público y en nuevas reservas.
    await client.from('servicio').update({ activo: !s.activo }).eq('id', s.id)
    recargar()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Servicios y categorías</h1>
        <Button tamano="sm" onClick={() => setModalAbierto(true)}>+ Nuevo servicio</Button>
      </div>

      {error && <ErrorState mensaje={error} />}
      {!servicios ? (
        <Cargando />
      ) : (
        <div className="flex flex-col gap-2">
          {servicios.map((s) => (
            <Card key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium text-carbon">{s.nombre}</p>
                <p className="text-xs text-carbon/60">{s.categoria_nombre} · {s.duracion_minutos} min</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-oliva">
                  {s.tipo_precio === 'a_valorar' ? 'A valorar' : formatoMoneda(s.precio)}
                </span>
                <button
                  onClick={() => alternarActivo(s)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${s.activo ? 'bg-exito/15 text-exito' : 'bg-carbon/10 text-carbon/60'}`}
                >
                  {s.activo ? 'Activo' : 'Desactivado'}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal abierto={modalAbierto} onCerrar={() => setModalAbierto(false)} titulo="Nuevo servicio">
        <FormularioServicio
          categorias={categorias}
          onCreado={() => {
            setModalAbierto(false)
            recargar()
          }}
        />
      </Modal>
    </div>
  )
}

function FormularioServicio({ categorias, onCreado }: { categorias: CategoriaServicio[]; onCreado: () => void }) {
  const [nombre, setNombre] = useState('')
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id ?? '')
  const [duracion, setDuracion] = useState(60)
  const [tipoPrecio, setTipoPrecio] = useState<TipoPrecioServicio>('fijo')
  const [precio, setPrecio] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (isDemoMode) { onCreado(); return }
    setGuardando(true)
    setError(null)
    try {
      const { error: err } = await supabase!.from('servicio').insert({
        nombre,
        categoria_id: categoriaId,
        duracion_minutos: duracion,
        tipo_precio: tipoPrecio,
        precio: tipoPrecio === 'a_valorar' ? null : precio,
      })
      if (err) throw err
      onCreado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      <Input id="nombre" etiqueta="Nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Select id="categoria" etiqueta="Categoría" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
        {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </Select>
      <Input id="duracion" etiqueta="Duración (minutos)" type="number" required value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} />
      <Select id="tipoPrecio" etiqueta="Tipo de precio" value={tipoPrecio} onChange={(e) => setTipoPrecio(e.target.value as TipoPrecioServicio)}>
        <option value="fijo">Fijo</option>
        <option value="desde">Desde</option>
        <option value="a_valorar">A valorar en salón</option>
      </Select>
      {tipoPrecio !== 'a_valorar' && (
        <Input id="precio" etiqueta="Precio (COP)" type="number" required value={precio} onChange={(e) => setPrecio(Number(e.target.value))} />
      )}
      <Button type="submit" cargando={guardando}>Crear servicio</Button>
    </form>
  )
}
