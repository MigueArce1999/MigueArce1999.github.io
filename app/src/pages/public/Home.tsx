import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ErrorState } from '../../components/ui/Estados'
import { WidgetSalonEnVivo } from '../../components/disponibilidadEnVivo/WidgetSalonEnVivo'
import { listarCategorias, listarProfesionalesHomepage, listarPromocionesVigentes } from '../../lib/api/catalogo'
import { obtenerConfiguracionHomepage } from '../../lib/api/homepage'
import { isDemoMode } from '../../lib/supabase'
import { useAuth } from '../../state/AuthContext'
import { rutaEnEsteSalon } from '../../lib/rutas'
import type { CategoriaServicio, ConfiguracionHomepage, Profesional, Promocion } from '../../lib/types'

// El diseño de Figma usa fotografía de campaña en el hero y en cada tarjeta (servicios,
// promociones, equipo). No hay todavía esas fotos reales en el proyecto, así que se muestra
// un bloque de marca (degradado oliva/piedra) del mismo tamaño y posición — trivial de
// reemplazar por una imagen real cuando esté disponible (o por profesional.foto_url, que ya
// se usa cuando existe).
function FotoPlaceholder({ className = '' }: { className?: string }) {
  return <div className={`bg-gradient-to-br from-oliva/25 via-piedra to-champan/30 ${className}`} />
}

export function Home() {
  const navigate = useNavigate()
  const { perfil, cliente } = useAuth()
  const [categorias, setCategorias] = useState<CategoriaServicio[] | null>(null)
  const [promos, setPromos] = useState<Promocion[] | null>(null)
  const [equipo, setEquipo] = useState<Profesional[] | null>(null)
  const [configuracion, setConfiguracion] = useState<ConfiguracionHomepage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listarCategorias(), listarPromocionesVigentes(), listarProfesionalesHomepage(), obtenerConfiguracionHomepage()])
      .then(([c, p, e, cfg]) => {
        setCategorias(c.slice(0, 4))
        setPromos(p.slice(0, 3))
        setEquipo(e.slice(0, 4))
        setConfiguracion(cfg)
      })
      .catch((err) => setError(err.message))
  }, [])

  // Aterrizaje del enlace de invitación/magic-link: supabase-js consume el token del hash y
  // deja al navegador en "/" (ver lib/api/admin.ts → invitarEmpleada). Sin esto, quien entra
  // por primera vez se quedaría viendo la página pública en vez de su portal.
  useEffect(() => {
    if (isDemoMode || !perfil) return
    navigate(rutaEnEsteSalon(perfil, cliente !== null), { replace: true })
  }, [perfil, cliente, navigate])

  return (
    <div>
      {error && (
        <div className="mx-auto max-w-[1440px] px-5 pt-6 sm:px-[40px]">
          <ErrorState mensaje={error} />
        </div>
      )}

      {/* Hero: el diseño hace sangrar la foto hasta el borde derecho de la pantalla — solo el
          texto lleva el margen lateral, la imagen no lleva relleno a la derecha. */}
      <section className="flex flex-col items-center gap-10 bg-piedra/30 px-5 py-12 sm:px-[40px] lg:flex-row lg:gap-[60px] lg:px-0 lg:py-0">
        <div className="flex w-full max-w-xl flex-col items-start gap-8 lg:py-16 lg:pl-[40px]">
          <div className="flex flex-col items-start gap-4">
            <h1 className="font-marca text-5xl font-semibold leading-tight text-carbon sm:text-6xl lg:text-[80px] lg:leading-[72px]">
              Tu esencia en buenas manos
            </h1>
            <p className="text-base text-carbon">Un espacio para cuidar de ti, realzar tu belleza y sentirte bien</p>
            <div className="flex flex-wrap items-center gap-5">
              <Link to="/reservar">
                <Button tamano="lg" className="!rounded-lg">Agendar cita →</Button>
              </Link>
              <Link to="/servicios" className="flex h-12 items-center justify-center rounded-lg px-3 text-base font-medium text-oliva hover:bg-piedra/40">
                Explorar servicios
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-[18px]">
            {['Cabello', 'Estética', 'Maquillaje', 'Manicuristas'].map((tag, i) => (
              <div key={tag} className="flex items-center gap-[18px]">
                {i > 0 && <span className="h-4 w-px bg-carbon/30" aria-hidden />}
                <span className="text-xs uppercase tracking-wide text-carbon/60">{tag}</span>
              </div>
            ))}
          </div>
        </div>
        {configuracion?.hero_imagen_url ? (
          <img
            src={configuracion.hero_imagen_url}
            alt="Claudia Patricia"
            className="h-[280px] w-full object-cover sm:h-[400px] lg:h-[570px] lg:w-auto lg:flex-1"
          />
        ) : (
          <FotoPlaceholder className="h-[280px] w-full sm:h-[400px] lg:h-[570px] lg:w-auto lg:flex-1" />
        )}
      </section>

      <div className="pt-16">
        <WidgetSalonEnVivo />
      </div>

      {/* Servicios */}
      <section className="mx-auto flex max-w-[1440px] flex-col gap-10 bg-marfil px-5 sm:px-[40px] py-16">
        <SeccionTitulo eyebrow="Nuestros servicios" titulo="Encuentra tu próximo ritual." />
        {!categorias ? (
          <div className="flex flex-col gap-3.5">
            {[0, 1].map((fila) => <div key={fila} className="h-[300px] animate-pulse rounded-lg bg-piedra/50 lg:h-[456px]" />)}
          </div>
        ) : categorias.length === 0 ? (
          <p className="text-carbon/60">Todavía no hay categorías de servicios configuradas.</p>
        ) : (
          // El diseño alterna, fila por fila, cuál de las dos tarjetas es más ancha (nunca un
          // grid parejo de columnas iguales) — se reproduce con proporciones de flex-grow en
          // vez de anchos fijos en píxeles, para que funcione con cualquier cantidad real de
          // categorías, no solo con las 4 que trae el diseño de Figma.
          <div className="flex flex-col gap-3.5">
            {agruparEnFilas(categorias, 2).map((fila, i) => (
              <div key={i} className="flex flex-col gap-3.5 sm:flex-row">
                {fila.map((c, j) => {
                  const angosta = i % 2 === 0 ? j === 0 : j === 1
                  return (
                    <Link
                      key={c.id}
                      to={c.enlace_boton || '/servicios'}
                      className={`group relative flex h-[300px] items-end overflow-hidden rounded-lg p-6 lg:h-[456px] ${angosta ? 'sm:flex-[3]' : 'sm:flex-[4]'}`}
                    >
                      {c.imagen_url ? (
                        <img src={c.imagen_url} alt={c.nombre} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <FotoPlaceholder className="absolute inset-0" />
                      )}
                      <div className="absolute inset-0 bg-black/44" />
                      <div className="relative flex flex-col items-start gap-2">
                        <p className="font-marca text-4xl text-marfil">{c.nombre}</p>
                        {c.descripcion_corta && <p className="text-sm text-marfil/90">{c.descripcion_corta}</p>}
                        <span className="mt-2 flex items-center gap-2 text-sm text-marfil">
                          {c.texto_boton} <span aria-hidden>→</span>
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Promociones */}
      {promos && promos.length > 0 && (
        <section className="mx-auto flex max-w-[1440px] flex-col gap-10 bg-marfil px-5 sm:px-[40px] py-16">
          <SeccionTitulo eyebrow="Promociones del mes" titulo="Este mes, un detalle para ti." />
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {promos.map((p) => (
              <div key={p.id} className="flex flex-col">
                <div className="relative flex h-[220px] items-start overflow-hidden rounded-t-lg p-5">
                  {p.imagen_url ? (
                    <img src={p.imagen_url} alt={p.nombre} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <FotoPlaceholder className="absolute inset-0" />
                  )}
                  <div className="absolute inset-0 bg-black/44" />
                  <span className="relative rounded-full bg-blanco px-5 py-1 text-sm text-carbon">Promoción del mes</span>
                </div>
                <div className="flex flex-col gap-4 rounded-b-lg border border-piedra px-6 py-4">
                  <div className="flex flex-col gap-3">
                    <p className="font-marca text-4xl text-carbon">{p.nombre}</p>
                    <p className="text-base text-carbon/60">{p.descripcion}</p>
                  </div>
                  <Link to={p.enlace_boton || '/promociones'} className="flex items-center gap-2 text-sm text-carbon">
                    {p.texto_boton} <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Un momento para consentirte */}
      <section className="bg-piedra px-5 sm:px-[40px] py-16">
        <div className="flex max-w-xl flex-col items-start gap-6">
          <p className="font-marca text-4xl leading-tight text-carbon sm:text-5xl">
            Un momento<br />para consentirte.
          </p>
          <p className="text-lg text-carbon">Descubre las promociones del salón.</p>
          <Link to="/promociones">
            <Button tamano="lg" className="!rounded-lg">Ver promociones</Button>
          </Link>
        </div>
      </section>

      {/* Equipo */}
      <section className="mx-auto flex max-w-[1440px] flex-col gap-6 bg-marfil px-5 sm:px-[40px] py-16">
        <p className="font-marca text-4xl text-carbon sm:text-5xl">Conoce las manos detrás de tu belleza.</p>
        {!equipo ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-square animate-pulse rounded-lg bg-piedra/50 sm:aspect-auto sm:h-[290px]" />)}
          </div>
        ) : equipo.length === 0 ? (
          <p className="text-carbon/60">Todavía no hay profesionales destacadas en la portada.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {equipo.map((p) => (
              <Link to={`/equipo/${p.slug}`} key={p.id} className="flex flex-col items-start gap-4">
                {p.foto_url ? (
                  <img
                    src={p.foto_url}
                    alt={p.nombre}
                    className="aspect-square w-full rounded-lg object-cover sm:aspect-auto sm:h-[290px]"
                    loading="lazy"
                  />
                ) : (
                  <FotoPlaceholder className="aspect-square w-full rounded-lg sm:aspect-auto sm:h-[290px]" />
                )}
                <div className="flex flex-col gap-2">
                  <p className="font-marca text-2xl text-carbon">{p.nombre}</p>
                  <p className="text-sm text-carbon/60">{p.especialidades[0] || 'Conoce a tu profesional'}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function agruparEnFilas<T>(items: T[], porFila: number): T[][] {
  const filas: T[][] = []
  for (let i = 0; i < items.length; i += porFila) filas.push(items.slice(i, i + porFila))
  return filas
}

function SeccionTitulo({ eyebrow, titulo }: { eyebrow: string; titulo: string }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/60">{eyebrow}</p>
        <span className="h-px w-12 bg-carbon/30" aria-hidden />
      </div>
      <p className="font-marca text-4xl text-carbon sm:text-5xl">{titulo}</p>
    </div>
  )
}
