import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Campos'
import { Cargando, ErrorState } from '../../components/ui/Estados'
import { Drawer, Modal } from '../../components/ui/Modal'
import { actualizarNombreProfesional } from '../../lib/api/admin'
import { listarProfesionales } from '../../lib/api/catalogo'
import {
  actualizarOrdenCategorias,
  actualizarOrdenEquipoHomepage,
  actualizarOrdenPromociones,
  crearPromocion,
  duplicarPromocion,
  editarCategoriaHomepage,
  editarPromocion,
  editarProfesionalHomepage,
  eliminarImagenPublica,
  eliminarPromocion,
  estadoPromocion,
  listarCategoriasAdmin,
  listarPromocionesAdmin,
  obtenerConfiguracionHomepage,
  subirImagenPublica,
  TAMANO_MAXIMO_IMAGEN,
  TIPOS_IMAGEN_PERMITIDOS,
  type DatosCategoriaHomepage,
  type DatosPromocion,
} from '../../lib/api/homepage'
import type { CategoriaServicio, ConfiguracionHomepage, EstadoPromocion, Profesional, Promocion } from '../../lib/types'

type Tamano = 'escritorio' | 'tableta' | 'movil'

export function AdminHomepage() {
  const [categorias, setCategorias] = useState<CategoriaServicio[] | null>(null)
  const [promociones, setPromociones] = useState<Promocion[] | null>(null)
  const [equipo, setEquipo] = useState<Profesional[] | null>(null)
  const [configuracion, setConfiguracion] = useState<ConfiguracionHomepage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sucio, setSucio] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [vistaPrevia, setVistaPrevia] = useState(false)

  function cargar() {
    setError(null)
    Promise.all([listarCategoriasAdmin(), listarPromocionesAdmin(), listarProfesionales(), obtenerConfiguracionHomepage()])
      .then(([c, p, e, cfg]) => {
        setCategorias(c)
        setPromociones(p)
        setEquipo(e)
        setConfiguracion(cfg)
        setSucio(false)
      })
      .catch((err) => setError(err.message))
  }
  useEffect(cargar, [])

  // Avisa antes de cerrar/recargar la pestaña si hay orden o visibilidad sin publicar — los
  // formularios de edición (nombre, imagen, texto…) ya se guardan al instante, así que esto
  // solo protege el reordenamiento y los interruptores rápidos de cada tarjeta.
  useEffect(() => {
    if (!sucio) return
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [sucio])

  async function guardarYPublicar() {
    if (!categorias || !promociones || !equipo || publicando) return
    setPublicando(true)
    setError(null)
    try {
      await Promise.all([
        actualizarOrdenCategorias(categorias.map((c, i) => ({ id: c.id, ordenVisualizacion: i }))),
        ...categorias.map((c) =>
          editarCategoriaHomepage(c.id, {
            nombre: c.nombre,
            descripcionCorta: c.descripcion_corta,
            imagenUrl: c.imagen_url,
            textoBoton: c.texto_boton,
            enlaceBoton: c.enlace_boton,
            activa: c.activa,
          }),
        ),
        actualizarOrdenPromociones(promociones.map((p, i) => ({ id: p.id, ordenVisualizacion: i }))),
        ...promociones.map((p) =>
          editarPromocion(p.id, {
            nombre: p.nombre,
            descripcion: p.descripcion,
            condiciones: p.condiciones,
            vigenteDesde: p.vigente_desde,
            vigenteHasta: p.vigente_hasta,
            tipoDescuento: p.tipo_descuento,
            valor: p.valor,
            activa: p.activa,
            imagenUrl: p.imagen_url,
            textoBoton: p.texto_boton,
            enlaceBoton: p.enlace_boton,
          }),
        ),
        actualizarOrdenEquipoHomepage(equipo.map((p, i) => ({ id: p.id, ordenVisualizacion: i }))),
        ...equipo.map((p) =>
          editarProfesionalHomepage(p.id, {
            bio: p.bio,
            especialidades: p.especialidades,
            fotoUrl: p.foto_url,
            mostrarEnHome: p.mostrar_en_home,
          }),
        ),
      ])
      setSucio(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setPublicando(false)
    }
  }

  const cargando = !categorias || !promociones || !equipo || !configuracion

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-marca text-2xl font-semibold text-carbon">Configuración de la homepage</h1>
          <p className="mt-1 text-sm text-carbon/60">Personaliza el contenido que los clientes ven en la página de inicio.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sucio ? 'bg-advertencia/15 text-advertencia' : 'bg-exito/15 text-exito'}`}>
            {sucio ? 'Cambios pendientes' : 'Cambios guardados'}
          </span>
          <Button variante="secondary" onClick={() => setVistaPrevia(true)} disabled={cargando}>Vista previa</Button>
          <a href="/" target="_blank" rel="noopener noreferrer">
            <Button variante="secondary">Ver homepage ↗</Button>
          </a>
          <Button onClick={guardarYPublicar} cargando={publicando} disabled={!sucio || cargando}>Guardar y publicar</Button>
        </div>
      </div>

      {error && <ErrorState mensaje={error} reintentar={cargar} />}

      {cargando ? (
        <Cargando filas={6} />
      ) : (
        <div className="flex flex-col gap-8">
          <SeccionPortada configuracion={configuracion} />
          <SeccionCategorias
            categorias={categorias}
            onCambiarOrden={(nuevas) => { setCategorias(nuevas); setSucio(true) }}
            onCambiarVisibilidad={(id, activa) => {
              setCategorias((prev) => prev!.map((c) => (c.id === id ? { ...c, activa } : c)))
              setSucio(true)
            }}
            onGuardadaDetalle={(actualizada) => setCategorias((prev) => prev!.map((c) => (c.id === actualizada.id ? actualizada : c)))}
          />
          <SeccionPromociones
            promociones={promociones}
            onCambiarOrden={(nuevas) => { setPromociones(nuevas); setSucio(true) }}
            onCambiarVisibilidad={(id, activa) => {
              setPromociones((prev) => prev!.map((p) => (p.id === id ? { ...p, activa } : p)))
              setSucio(true)
            }}
            onRecargar={cargar}
          />
          <SeccionEquipo
            equipo={equipo}
            onCambiarOrden={(nuevos) => { setEquipo(nuevos); setSucio(true) }}
            onCambiarVisibilidad={(id, mostrar) => {
              setEquipo((prev) => prev!.map((p) => (p.id === id ? { ...p, mostrar_en_home: mostrar } : p)))
              setSucio(true)
            }}
            onGuardadoDetalle={(actualizado) => setEquipo((prev) => prev!.map((p) => (p.id === actualizado.id ? actualizado : p)))}
          />
        </div>
      )}

      {vistaPrevia && categorias && promociones && equipo && (
        <VistaPreviaModal categorias={categorias} promociones={promociones} equipo={equipo} onCerrar={() => setVistaPrevia(false)} />
      )}
    </div>
  )
}

// --- Utilidades de orden -----------------------------------------------------------------------

function moverArriba<T>(lista: T[], i: number): T[] {
  if (i <= 0) return lista
  const copia = [...lista]
  ;[copia[i - 1], copia[i]] = [copia[i], copia[i - 1]]
  return copia
}

function moverAbajo<T>(lista: T[], i: number): T[] {
  if (i >= lista.length - 1) return lista
  const copia = [...lista]
  ;[copia[i + 1], copia[i]] = [copia[i], copia[i + 1]]
  return copia
}

function BotonesOrden({ index, total, onSubir, onBajar }: { index: number; total: number; onSubir: () => void; onBajar: () => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={onSubir}
        disabled={index === 0}
        aria-label="Subir"
        title="Subir"
        className="flex h-6 w-6 items-center justify-center rounded text-carbon/60 hover:bg-piedra/50 disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={onBajar}
        disabled={index === total - 1}
        aria-label="Bajar"
        title="Bajar"
        className="flex h-6 w-6 items-center justify-center rounded text-carbon/60 hover:bg-piedra/50 disabled:opacity-30"
      >
        ↓
      </button>
    </div>
  )
}

function Interruptor({ activo, onCambiar, etiqueta }: { activo: boolean; onCambiar: (v: boolean) => void; etiqueta: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-carbon/70">
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        onClick={() => onCambiar(!activo)}
        className={`relative h-5 w-9 shrink-0 overflow-hidden rounded-full transition-colors ${activo ? 'bg-oliva' : 'bg-piedra'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-blanco transition-transform ${activo ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
      {etiqueta}
    </label>
  )
}

// --- 1. Portada (bloqueada) ----------------------------------------------------------------

function SeccionPortada({ configuracion }: { configuracion: ConfiguracionHomepage }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-marca text-lg font-semibold text-carbon">Portada principal</h2>
      <div className="flex flex-col items-start gap-4 rounded-xl border border-piedra bg-blanco p-5 sm:flex-row sm:items-center">
        {configuracion.hero_imagen_url ? (
          <img src={configuracion.hero_imagen_url} alt="Imagen principal actual" className="h-24 w-40 rounded-lg object-cover" />
        ) : (
          <div className="h-24 w-40 shrink-0 rounded-lg bg-gradient-to-br from-oliva/25 via-piedra to-champan/30" />
        )}
        <div className="flex flex-col gap-1.5">
          <span className="w-fit rounded-full bg-piedra/60 px-3 py-1 text-xs font-semibold text-carbon/70">Edición bloqueada</span>
          <p className="text-sm text-carbon/70">La imagen principal todavía no está disponible para edición.</p>
        </div>
      </div>
    </section>
  )
}

// --- 2. Categorías ----------------------------------------------------------------------------

function SeccionCategorias({
  categorias,
  onCambiarOrden,
  onCambiarVisibilidad,
  onGuardadaDetalle,
}: {
  categorias: CategoriaServicio[]
  onCambiarOrden: (nuevas: CategoriaServicio[]) => void
  onCambiarVisibilidad: (id: string, activa: boolean) => void
  onGuardadaDetalle: (actualizada: CategoriaServicio) => void
}) {
  const [editando, setEditando] = useState<CategoriaServicio | null>(null)

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-marca text-lg font-semibold text-carbon">Categorías de servicios</h2>
        <p className="text-sm text-carbon/60">Las mismas {categorias.length} categorías del catálogo — edítalas, no se pueden crear ni borrar desde aquí.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {categorias.map((c, i) => (
          <div key={c.id} className="flex gap-3 rounded-xl border border-piedra bg-blanco p-4">
            <BotonesOrden index={i} total={categorias.length} onSubir={() => onCambiarOrden(moverArriba(categorias, i))} onBajar={() => onCambiarOrden(moverAbajo(categorias, i))} />
            {c.imagen_url ? (
              <img src={c.imagen_url} alt={c.nombre} className="h-20 w-24 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-20 w-24 shrink-0 rounded-lg bg-gradient-to-br from-oliva/25 via-piedra to-champan/30" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate font-semibold text-carbon">{c.nombre}</p>
              {c.descripcion_corta && <p className="line-clamp-2 text-xs text-carbon/60">{c.descripcion_corta}</p>}
              <p className="text-xs text-carbon/50">Botón: "{c.texto_boton}"</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <Interruptor activo={c.activa} onCambiar={(v) => onCambiarVisibilidad(c.id, v)} etiqueta={c.activa ? 'Visible' : 'Oculta'} />
                <button type="button" onClick={() => setEditando(c)} className="text-xs font-semibold text-oliva hover:underline">Editar</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editando && (
        <Drawer abierto titulo={`Editar "${editando.nombre}"`} onCerrar={() => setEditando(null)}>
          <FormularioCategoria categoria={editando} onCancelar={() => setEditando(null)} onGuardada={(c) => { onGuardadaDetalle(c); setEditando(null) }} />
        </Drawer>
      )}
    </section>
  )
}

function FormularioCategoria({ categoria, onCancelar, onGuardada }: { categoria: CategoriaServicio; onCancelar: () => void; onGuardada: (c: CategoriaServicio) => void }) {
  const [nombre, setNombre] = useState(categoria.nombre)
  const [descripcionCorta, setDescripcionCorta] = useState(categoria.descripcion_corta ?? '')
  const [imagenUrl, setImagenUrl] = useState(categoria.imagen_url)
  const [textoBoton, setTextoBoton] = useState(categoria.texto_boton)
  const [enlaceBoton, setEnlaceBoton] = useState(categoria.enlace_boton ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function validar(): string | null {
    if (!nombre.trim()) return 'El nombre de la categoría es obligatorio.'
    if (!textoBoton.trim()) return 'El texto del botón es obligatorio.'
    if (textoBoton.trim().length > 40) return 'El texto del botón es demasiado largo (máximo 40 caracteres).'
    if (enlaceBoton.trim() && !/^(\/|https?:\/\/)/.test(enlaceBoton.trim())) {
      return 'El enlace debe ser una ruta interna (empieza con /) o una URL completa (http/https).'
    }
    return null
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    const problema = validar()
    if (problema) { setError(problema); return }
    setError(null)
    setGuardando(true)
    try {
      const datos: DatosCategoriaHomepage = {
        nombre: nombre.trim(),
        descripcionCorta: descripcionCorta.trim() || null,
        imagenUrl,
        textoBoton: textoBoton.trim(),
        enlaceBoton: enlaceBoton.trim() || null,
        activa: categoria.activa,
      }
      await editarCategoriaHomepage(categoria.id, datos)
      onGuardada({ ...categoria, ...toCategoria(datos) })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  function toCategoria(d: DatosCategoriaHomepage): Partial<CategoriaServicio> {
    return { nombre: d.nombre, descripcion_corta: d.descripcionCorta, imagen_url: d.imagenUrl, texto_boton: d.textoBoton, enlace_boton: d.enlaceBoton }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      <Input id="catNombre" etiqueta="Nombre o título" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Textarea id="catDescripcion" etiqueta="Descripción corta" value={descripcionCorta} onChange={(e) => setDescripcionCorta(e.target.value)} />
      <CampoImagenPublica etiqueta="Imagen de la categoría" valor={imagenUrl} carpeta="categorias" onCambiar={setImagenUrl} />
      <Input id="catTextoBoton" etiqueta="Texto del botón" required value={textoBoton} onChange={(e) => setTextoBoton(e.target.value)} />
      <Input
        id="catEnlaceBoton"
        etiqueta="Enlace del botón (opcional)"
        placeholder="/servicios"
        value={enlaceBoton}
        onChange={(e) => setEnlaceBoton(e.target.value)}
        ayuda="Si lo dejas vacío, el botón lleva a la página de Servicios."
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variante="ghost" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" cargando={guardando}>Guardar cambios</Button>
      </div>
    </form>
  )
}

// --- 3. Promociones ------------------------------------------------------------------------

const ETIQUETA_ESTADO: Record<EstadoPromocion, string> = { inactiva: 'Oculta', programada: 'Programada', activa: 'Activa', finalizada: 'Finalizada' }
const ESTILO_ESTADO: Record<EstadoPromocion, string> = {
  inactiva: 'bg-piedra/60 text-carbon/60',
  programada: 'bg-champan/25 text-carbon',
  activa: 'bg-exito/15 text-exito',
  finalizada: 'bg-carbon/10 text-carbon/50',
}

function SeccionPromociones({
  promociones,
  onCambiarOrden,
  onCambiarVisibilidad,
  onRecargar,
}: {
  promociones: Promocion[]
  onCambiarOrden: (nuevas: Promocion[]) => void
  onCambiarVisibilidad: (id: string, activa: boolean) => void
  onRecargar: () => void
}) {
  const [editando, setEditando] = useState<Promocion | 'nueva' | null>(null)
  const [borrando, setBorrando] = useState<string | null>(null)
  const [duplicando, setDuplicando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function borrar(p: Promocion) {
    if (!confirm(`¿Borrar la promoción "${p.nombre}"? Esta acción no se puede deshacer.`)) return
    setBorrando(p.id)
    setError(null)
    try {
      await eliminarPromocion(p.id)
      onRecargar()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBorrando(null)
    }
  }

  async function duplicar(p: Promocion) {
    setDuplicando(p.id)
    setError(null)
    try {
      await duplicarPromocion(p)
      onRecargar()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDuplicando(null)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-marca text-lg font-semibold text-carbon">Promociones</h2>
          <p className="text-sm text-carbon/60">Solo se muestran públicamente las que están activas y vigentes según sus fechas.</p>
        </div>
        <Button tamano="sm" onClick={() => setEditando('nueva')}>+ Nueva promoción</Button>
      </div>
      {error && <ErrorState mensaje={error} />}

      {promociones.length === 0 ? (
        <p className="text-sm text-carbon/60">Todavía no hay promociones creadas.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {promociones.map((p, i) => {
            const estado = estadoPromocion(p)
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-piedra bg-blanco p-3">
                <BotonesOrden index={i} total={promociones.length} onSubir={() => onCambiarOrden(moverArriba(promociones, i))} onBajar={() => onCambiarOrden(moverAbajo(promociones, i))} />
                {p.imagen_url ? (
                  <img src={p.imagen_url} alt={p.nombre} className="h-14 w-20 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-14 w-20 shrink-0 rounded-lg bg-gradient-to-br from-oliva/25 via-piedra to-champan/30" />
                )}
                <div className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 sm:basis-0">
                  <p className="truncate font-semibold text-carbon">{p.nombre}</p>
                  <p className="text-xs text-carbon/50">
                    {p.vigente_desde || p.vigente_hasta
                      ? `${p.vigente_desde ? new Date(p.vigente_desde).toLocaleDateString('es-CO') : 'Sin inicio'} — ${p.vigente_hasta ? new Date(p.vigente_hasta).toLocaleDateString('es-CO') : 'Sin fin'}`
                      : 'Sin fechas (usa el interruptor)'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${ESTILO_ESTADO[estado]}`}>{ETIQUETA_ESTADO[estado]}</span>
                <Interruptor activo={p.activa} onCambiar={(v) => onCambiarVisibilidad(p.id, v)} etiqueta="Mostrar" />
                <div className="flex shrink-0 items-center gap-3 text-xs font-semibold sm:flex-col sm:items-end sm:gap-1">
                  <button type="button" onClick={() => setEditando(p)} className="text-oliva hover:underline">Editar</button>
                  <button type="button" onClick={() => duplicar(p)} disabled={duplicando === p.id} className="text-carbon/60 hover:underline disabled:opacity-50">
                    {duplicando === p.id ? 'Duplicando…' : 'Duplicar'}
                  </button>
                  <button type="button" onClick={() => borrar(p)} disabled={borrando === p.id} className="text-error hover:underline disabled:opacity-50">
                    {borrando === p.id ? 'Borrando…' : 'Eliminar'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editando && (
        <Drawer abierto titulo={editando === 'nueva' ? 'Nueva promoción' : `Editar "${editando.nombre}"`} onCerrar={() => setEditando(null)}>
          <FormularioPromocion
            promocion={editando === 'nueva' ? null : editando}
            onCancelar={() => setEditando(null)}
            onGuardada={() => { setEditando(null); onRecargar() }}
          />
        </Drawer>
      )}
    </section>
  )
}

function FormularioPromocion({ promocion, onCancelar, onGuardada }: { promocion: Promocion | null; onCancelar: () => void; onGuardada: () => void }) {
  const [nombre, setNombre] = useState(promocion?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(promocion?.descripcion ?? '')
  const [condiciones, setCondiciones] = useState(promocion?.condiciones ?? '')
  const [tipo, setTipo] = useState<DatosPromocion['tipoDescuento']>(promocion?.tipo_descuento ?? 'porcentaje')
  const [valor, setValor] = useState(promocion?.valor ?? 10)
  const [desde, setDesde] = useState(promocion?.vigente_desde?.slice(0, 10) ?? '')
  const [hasta, setHasta] = useState(promocion?.vigente_hasta?.slice(0, 10) ?? '')
  const [activa, setActiva] = useState(promocion?.activa ?? true)
  const [imagenUrl, setImagenUrl] = useState(promocion?.imagen_url ?? null)
  const [textoBoton, setTextoBoton] = useState(promocion?.texto_boton ?? 'Ver promoción')
  const [enlaceBoton, setEnlaceBoton] = useState(promocion?.enlace_boton ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      const datos: DatosPromocion = {
        nombre,
        descripcion,
        condiciones: condiciones.trim() || null,
        vigenteDesde: desde ? `${desde}T00:00:00` : null,
        vigenteHasta: hasta ? `${hasta}T23:59:59` : null,
        tipoDescuento: tipo,
        valor,
        activa,
        imagenUrl,
        textoBoton,
        enlaceBoton: enlaceBoton.trim() || null,
      }
      if (promocion) await editarPromocion(promocion.id, datos)
      else await crearPromocion(datos)
      onGuardada()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      <Input id="promoNombre" etiqueta="Título" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Textarea id="promoDescripcion" etiqueta="Descripción" required value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      <Textarea id="promoCondiciones" etiqueta="Condiciones (opcional)" value={condiciones} onChange={(e) => setCondiciones(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Select id="promoTipo" etiqueta="Tipo de descuento" value={tipo} onChange={(e) => setTipo(e.target.value as DatosPromocion['tipoDescuento'])}>
          <option value="porcentaje">Porcentaje</option>
          <option value="fijo">Valor fijo</option>
          <option value="precio_especial">Precio especial</option>
        </Select>
        <Input id="promoValor" etiqueta="Valor" type="number" min={0} required value={valor} onChange={(e) => setValor(Number(e.target.value))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input id="promoDesde" etiqueta="Fecha de inicio (opcional)" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Input id="promoHasta" etiqueta="Fecha de fin (opcional)" type="date" min={desde || undefined} value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </div>
      <CampoImagenPublica etiqueta="Imagen (opcional)" valor={imagenUrl} carpeta="promociones" onCambiar={setImagenUrl} />
      <Input id="promoTextoBoton" etiqueta="Texto del botón" required value={textoBoton} onChange={(e) => setTextoBoton(e.target.value)} />
      <Input id="promoEnlaceBoton" etiqueta="Enlace del botón (opcional)" placeholder="/promociones" value={enlaceBoton} onChange={(e) => setEnlaceBoton(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-carbon">
        <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
        Mostrar en la homepage {!desde && !hasta && '(sin fechas, esto decide su visibilidad)'}
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variante="ghost" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" cargando={guardando}>{promocion ? 'Guardar cambios' : 'Crear promoción'}</Button>
      </div>
    </form>
  )
}

// --- 4. Equipo -----------------------------------------------------------------------------

function SeccionEquipo({
  equipo,
  onCambiarOrden,
  onCambiarVisibilidad,
  onGuardadoDetalle,
}: {
  equipo: Profesional[]
  onCambiarOrden: (nuevos: Profesional[]) => void
  onCambiarVisibilidad: (id: string, mostrar: boolean) => void
  onGuardadoDetalle: (p: Profesional) => void
}) {
  const [editando, setEditando] = useState<Profesional | null>(null)

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-marca text-lg font-semibold text-carbon">Equipo</h2>
        <p className="text-sm text-carbon/60">
          Solo se muestran públicamente quienes están activas y con "Mostrar en la homepage" encendido. El resto de su información
          (agenda, comisiones, ventas) se administra en Admin → Equipo.
        </p>
      </div>
      {equipo.length === 0 ? (
        <p className="text-sm text-carbon/60">No hay profesionales activas todavía.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {equipo.map((p, i) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-piedra bg-blanco p-3">
              <BotonesOrden index={i} total={equipo.length} onSubir={() => onCambiarOrden(moverArriba(equipo, i))} onBajar={() => onCambiarOrden(moverAbajo(equipo, i))} />
              {p.foto_url ? (
                <img src={p.foto_url} alt={p.nombre} className="h-14 w-14 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-piedra font-marca text-lg text-oliva">{p.nombre.charAt(0)}</div>
              )}
              <div className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 sm:basis-0">
                <p className="truncate font-semibold text-carbon">{p.nombre}</p>
                <p className="truncate text-xs text-carbon/60">{p.especialidades.join(', ') || 'Sin especialidades registradas'}</p>
              </div>
              <Interruptor activo={p.mostrar_en_home} onCambiar={(v) => onCambiarVisibilidad(p.id, v)} etiqueta="En homepage" />
              <button type="button" onClick={() => setEditando(p)} className="shrink-0 text-xs font-semibold text-oliva hover:underline">Editar</button>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <Drawer abierto titulo={`Editar "${editando.nombre}"`} onCerrar={() => setEditando(null)}>
          <FormularioProfesionalHomepage profesional={editando} onCancelar={() => setEditando(null)} onGuardado={(p) => { onGuardadoDetalle(p); setEditando(null) }} />
        </Drawer>
      )}
    </section>
  )
}

function FormularioProfesionalHomepage({ profesional, onCancelar, onGuardado }: { profesional: Profesional; onCancelar: () => void; onGuardado: (p: Profesional) => void }) {
  const [nombre, setNombre] = useState(profesional.nombre)
  const [especialidades, setEspecialidades] = useState(profesional.especialidades.join(', '))
  const [bio, setBio] = useState(profesional.bio ?? '')
  const [fotoUrl, setFotoUrl] = useState(profesional.foto_url)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      const nombreLimpio = nombre.trim()
      if (nombreLimpio && nombreLimpio !== profesional.nombre) {
        await actualizarNombreProfesional(profesional.id, nombreLimpio)
      }
      const listaEspecialidades = especialidades.split(',').map((s) => s.trim()).filter(Boolean)
      await editarProfesionalHomepage(profesional.id, {
        bio: bio.trim() || null,
        especialidades: listaEspecialidades,
        fotoUrl,
        mostrarEnHome: profesional.mostrar_en_home,
      })
      onGuardado({ ...profesional, nombre: nombreLimpio || profesional.nombre, especialidades: listaEspecialidades, bio: bio.trim() || null, foto_url: fotoUrl })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-4">
      {error && <ErrorState mensaje={error} />}
      <Input id="profNombre" etiqueta="Nombre público" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <CampoImagenPublica etiqueta="Foto de perfil" valor={fotoUrl} carpeta="equipo" onCambiar={setFotoUrl} avatarRedondo />
      <Input
        id="profEspecialidades"
        etiqueta="Cargo o especialidad"
        placeholder="Color, Cortes"
        value={especialidades}
        onChange={(e) => setEspecialidades(e.target.value)}
        ayuda="Puedes separar varias con coma; se muestra la primera como cargo principal."
      />
      <Textarea id="profBio" etiqueta="Descripción corta / biografía" value={bio} onChange={(e) => setBio(e.target.value)} />
      <p className="text-xs text-carbon/50">
        Para agenda, comisiones, servicios asignados o dar de baja a esta profesional, usa Admin → Equipo — este formulario solo
        toca su información pública de la homepage.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variante="ghost" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" cargando={guardando}>Guardar cambios</Button>
      </div>
    </form>
  )
}

// --- Carga de imágenes (compartido por categorías, promociones y equipo) --------------------

function CampoImagenPublica({
  etiqueta,
  valor,
  carpeta,
  onCambiar,
  avatarRedondo,
}: {
  etiqueta: string
  valor: string | null
  carpeta: 'categorias' | 'promociones' | 'equipo'
  onCambiar: (url: string | null) => void
  avatarRedondo?: boolean
}) {
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setError(null)
    setSubiendo(true)
    try {
      const anterior = valor
      const nuevaUrl = await subirImagenPublica(archivo, carpeta)
      onCambiar(nuevaUrl)
      if (anterior) eliminarImagenPublica(anterior)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubiendo(false)
    }
  }

  function quitar() {
    if (valor) eliminarImagenPublica(valor)
    onCambiar(null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-semibold text-carbon">{etiqueta}</p>
      <div className="flex items-center gap-3">
        {valor ? (
          <img src={valor} alt="Vista previa" className={avatarRedondo ? 'h-16 w-16 rounded-full object-cover' : 'h-16 w-24 rounded-lg object-cover'} />
        ) : (
          <div className={`flex items-center justify-center bg-gradient-to-br from-oliva/25 via-piedra to-champan/30 text-xs text-carbon/50 ${avatarRedondo ? 'h-16 w-16 rounded-full' : 'h-16 w-24 rounded-lg'}`}>
            Sin imagen
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="cursor-pointer text-xs font-semibold text-oliva hover:underline">
            {subiendo ? 'Subiendo…' : valor ? 'Reemplazar' : 'Cargar imagen'}
            <input type="file" accept={TIPOS_IMAGEN_PERMITIDOS.join(',')} className="hidden" disabled={subiendo} onChange={elegirArchivo} />
          </label>
          {valor && (
            <button type="button" onClick={quitar} className="text-left text-xs font-semibold text-error hover:underline">Eliminar imagen</button>
          )}
          <p className="text-xs text-carbon/50">JPG, PNG o WEBP, máximo {Math.round(TAMANO_MAXIMO_IMAGEN / 1024 / 1024)} MB.</p>
        </div>
      </div>
      {error && <p className="text-xs font-medium text-error">{error}</p>}
    </div>
  )
}

// --- Vista previa ----------------------------------------------------------------------------

const ANCHOS_PREVIA: Record<Tamano, string> = { escritorio: 'w-full', tableta: 'max-w-[768px]', movil: 'max-w-[390px]' }

function VistaPreviaModal({
  categorias,
  promociones,
  equipo,
  onCerrar,
}: {
  categorias: CategoriaServicio[]
  promociones: Promocion[]
  equipo: Profesional[]
  onCerrar: () => void
}) {
  const [tamano, setTamano] = useState<Tamano>('escritorio')
  const categoriasVisibles = categorias.filter((c) => c.activa)
  const promocionesVisibles = promociones.filter((p) => estadoPromocion(p) === 'activa')
  const equipoVisible = equipo.filter((p) => p.mostrar_en_home)

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Vista previa">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {(['escritorio', 'tableta', 'movil'] as Tamano[]).map((t) => (
            <button
              key={t}
              onClick={() => setTamano(t)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${tamano === t ? 'bg-oliva text-blanco' : 'bg-piedra/40 text-carbon'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className={`mx-auto flex flex-col gap-6 rounded-xl border border-piedra bg-marfil p-4 ${ANCHOS_PREVIA[tamano]}`}>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-carbon/50">Nuestros servicios ({categoriasVisibles.length} visibles)</p>
            <div className="grid grid-cols-2 gap-2">
              {categoriasVisibles.map((c) => (
                <div key={c.id} className="flex h-20 items-end overflow-hidden rounded-lg bg-piedra p-2">
                  {c.imagen_url && <img src={c.imagen_url} alt="" className="absolute h-20 w-full object-cover" />}
                  <p className="relative text-xs font-semibold text-carbon">{c.nombre}</p>
                </div>
              ))}
              {categoriasVisibles.length === 0 && <p className="col-span-2 text-xs text-carbon/50">Ninguna categoría visible.</p>}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-carbon/50">Promociones ({promocionesVisibles.length} activas)</p>
            <div className="flex flex-col gap-2">
              {promocionesVisibles.map((p) => (
                <div key={p.id} className="rounded-lg border border-piedra bg-blanco p-2">
                  <p className="text-xs font-semibold text-carbon">{p.nombre}</p>
                  <p className="line-clamp-1 text-[11px] text-carbon/60">{p.descripcion}</p>
                </div>
              ))}
              {promocionesVisibles.length === 0 && <p className="text-xs text-carbon/50">Ninguna promoción vigente.</p>}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-carbon/50">Equipo ({equipoVisible.length} en portada)</p>
            <div className="grid grid-cols-3 gap-2">
              {equipoVisible.map((p) => (
                <div key={p.id} className="flex flex-col items-center gap-1">
                  {p.foto_url ? (
                    <img src={p.foto_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-piedra text-xs text-oliva">{p.nombre.charAt(0)}</div>
                  )}
                  <p className="text-[11px] text-carbon">{p.nombre}</p>
                </div>
              ))}
              {equipoVisible.length === 0 && <p className="col-span-3 text-xs text-carbon/50">Nadie destacado todavía.</p>}
            </div>
          </div>
        </div>
        <p className="text-xs text-carbon/50">
          Esta vista previa refleja el orden y la visibilidad tal como quedarían al publicar; los datos de contenido ya editados en
          cada formulario se ven siempre en vivo apenas se guardan.
        </p>
      </div>
    </Modal>
  )
}
