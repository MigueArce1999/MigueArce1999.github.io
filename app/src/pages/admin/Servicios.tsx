import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Campos'
import { Card, Cargando, ErrorState } from '../../components/ui/Estados'
import { Modal } from '../../components/ui/Modal'
import { isDemoMode, LOCAL_ID, supabase, supabaseRequerido } from '../../lib/supabase'
import { eliminarServicio, listarCategorias, listarServiciosAdmin } from '../../lib/api/catalogo'
import { formatoPrecioServicio } from '../../lib/format'
import type { CategoriaServicio, Servicio, TipoPrecioServicio } from '../../lib/types'

export function AdminServicios() {
  const [servicios, setServicios] = useState<Servicio[] | null>(null)
  const [categorias, setCategorias] = useState<CategoriaServicio[]>([])
  const [categoriaFiltro, setCategoriaFiltro] = useState<string | null>(null)
  const [modalServicio, setModalServicio] = useState<'nuevo' | Servicio | null>(null)
  const [modalCategoria, setModalCategoria] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function recargar() {
    setServicios(null)
    listarServiciosAdmin(categoriaFiltro ?? undefined).then(setServicios).catch((e) => setError(e.message))
    listarCategorias().then(setCategorias)
  }

  useEffect(recargar, [categoriaFiltro])

  async function alternarActivo(s: Servicio) {
    if (isDemoMode) return
    const client = supabaseRequerido()
    // Desactivar nunca borra: solo dejan de ofrecerse en el sitio público y en nuevas reservas.
    await client.from('servicio').update({ activo: !s.activo }).eq('id', s.id)
    recargar()
  }

  async function borrar(s: Servicio) {
    if (!confirm(`¿Borrar "${s.nombre}" por completo? Esto no se puede deshacer.`)) return
    try {
      await eliminarServicio(s.id)
      recargar()
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-marca text-2xl font-semibold text-carbon">Servicios y categorías</h1>
        <div className="flex gap-2">
          <Button variante="secondary" tamano="sm" onClick={() => setModalCategoria(true)}>+ Categoría</Button>
          <Button tamano="sm" onClick={() => setModalServicio('nuevo')}>+ Nuevo servicio</Button>
        </div>
      </div>

      {categorias.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoriaFiltro(null)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              categoriaFiltro === null ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon hover:bg-piedra/60'
            }`}
          >
            Todas
          </button>
          {categorias.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoriaFiltro(c.id === categoriaFiltro ? null : c.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                categoriaFiltro === c.id ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon hover:bg-piedra/60'
              }`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorState mensaje={error} />}
      {!servicios ? (
        <Cargando />
      ) : servicios.length === 0 ? (
        <p className="text-sm text-carbon/60">Aún no hay servicios. Crea una categoría primero si hace falta, y luego un servicio.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {servicios.map((s) => (
            <Card key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <button className="text-left" onClick={() => setModalServicio(s)}>
                <p className="font-medium text-carbon underline-offset-2 hover:underline">{s.nombre}</p>
                <p className="text-xs text-carbon/60">{s.categoria_nombre}{s.duracion_minutos != null ? ` · ${s.duracion_minutos} min` : ''}</p>
              </button>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-oliva">{formatoPrecioServicio(s)}</span>
                <button onClick={() => setModalServicio(s)} className="text-xs font-semibold text-oliva underline underline-offset-2">
                  Editar
                </button>
                <button
                  onClick={() => alternarActivo(s)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${s.activo ? 'bg-exito/15 text-exito' : 'bg-carbon/10 text-carbon/60'}`}
                >
                  {s.activo ? 'Activo' : 'Desactivado'}
                </button>
                <button onClick={() => borrar(s)} className="text-xs font-semibold text-error hover:underline">
                  Borrar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        abierto={modalServicio !== null}
        onCerrar={() => setModalServicio(null)}
        titulo={modalServicio === 'nuevo' ? 'Nuevo servicio' : 'Editar servicio'}
      >
        <FormularioServicio
          categorias={categorias}
          servicio={modalServicio !== 'nuevo' ? modalServicio : null}
          onGuardado={() => {
            setModalServicio(null)
            recargar()
          }}
        />
      </Modal>

      <Modal abierto={modalCategoria} onCerrar={() => setModalCategoria(false)} titulo="Nueva categoría">
        <FormularioCategoria
          onCreada={() => {
            setModalCategoria(false)
            recargar()
          }}
        />
      </Modal>
    </div>
  )
}

function FormularioServicio({
  categorias,
  servicio,
  onGuardado,
}: {
  categorias: CategoriaServicio[]
  servicio: Servicio | null
  onGuardado: () => void
}) {
  const [nombre, setNombre] = useState(servicio?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(servicio?.descripcion ?? '')
  const [categoriaId, setCategoriaId] = useState(servicio?.categoria_id ?? categorias[0]?.id ?? '')
  // Vacío = sin confirmar todavía (ver 0027): un servicio nuevo puede quedar así, seleccionable
  // igual en Atender, solo sin ofrecerse para reservar en línea hasta que se defina.
  const [duracion, setDuracion] = useState<number | ''>(servicio?.duracion_minutos ?? '')
  const [tipoPrecio, setTipoPrecio] = useState<TipoPrecioServicio>(servicio?.tipo_precio ?? 'fijo')
  const [precio, setPrecio] = useState(servicio?.precio ?? 0)
  const [precioMaximo, setPrecioMaximo] = useState(servicio?.precio_maximo ?? 0)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (isDemoMode) { onGuardado(); return }
    setGuardando(true)
    setError(null)
    try {
      const datos = {
        nombre,
        descripcion: descripcion || null,
        categoria_id: categoriaId,
        duracion_minutos: duracion === '' ? null : duracion,
        tipo_precio: tipoPrecio,
        precio: tipoPrecio === 'a_valorar' ? null : precio,
        precio_maximo: tipoPrecio === 'rango' ? precioMaximo : null,
      }
      const { error: err } = servicio
        ? await supabase!.from('servicio').update(datos).eq('id', servicio.id)
        : await supabase!.from('servicio').insert({ ...datos, local_id: LOCAL_ID })
      if (err) throw err
      onGuardado()
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
      <Textarea id="descripcion" etiqueta="Descripción (opcional)" value={descripcion ?? ''} onChange={(e) => setDescripcion(e.target.value)} />
      <Select id="categoria" etiqueta="Categoría" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
        {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </Select>
      <Input
        id="duracion"
        etiqueta="Duración (minutos)"
        type="number"
        value={duracion}
        onChange={(e) => setDuracion(e.target.value === '' ? '' : Number(e.target.value))}
        ayuda="Déjalo vacío si todavía no está confirmada — el servicio se puede elegir igual al registrar una atención, solo no se ofrece para reservar en línea hasta que tenga una duración."
      />
      <Select id="tipoPrecio" etiqueta="Tipo de precio" value={tipoPrecio} onChange={(e) => setTipoPrecio(e.target.value as TipoPrecioServicio)}>
        <option value="fijo">Fijo</option>
        <option value="desde">Desde</option>
        <option value="rango">Rango (entre dos precios)</option>
        <option value="a_valorar">A valorar en salón</option>
      </Select>
      {tipoPrecio !== 'a_valorar' && (
        <Input
          id="precio"
          etiqueta={tipoPrecio === 'rango' ? 'Precio mínimo (COP)' : 'Precio (COP)'}
          type="number"
          required
          value={precio ?? 0}
          onChange={(e) => setPrecio(Number(e.target.value))}
        />
      )}
      {tipoPrecio === 'rango' && (
        <Input
          id="precioMaximo"
          etiqueta="Precio máximo (COP)"
          type="number"
          required
          value={precioMaximo ?? 0}
          onChange={(e) => setPrecioMaximo(Number(e.target.value))}
        />
      )}
      <Button type="submit" cargando={guardando}>{servicio ? 'Guardar cambios' : 'Crear servicio'}</Button>
    </form>
  )
}

function FormularioCategoria({ onCreada }: { onCreada: () => void }) {
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (isDemoMode) { onCreada(); return }
    setGuardando(true)
    setError(null)
    try {
      const { error: err } = await supabase!.from('categoria_servicio').insert({ nombre, local_id: LOCAL_ID })
      if (err) throw err
      onCreada()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      <Input id="nombreCategoria" etiqueta="Nombre de la categoría" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Button type="submit" cargando={guardando}>Crear categoría</Button>
    </form>
  )
}
