import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { isDemoMode } from '../../lib/supabase'
import { DemoBanner } from '../ui/Estados'
import { Button } from '../ui/Button'
import { useAuth } from '../../state/AuthContext'
import { useBranding } from '../../state/BrandingContext'
import { useDialogAccesible } from '../ui/Modal'
import { IconoChevronDerecha, IconoMenu, IconoPerfil, IconoX } from '../ui/Icons'
import { rutaEnEsteSalon } from '../../lib/rutas'
import logoFallback from '../../assets/logo-claudia-patricia.png'

const enlaces = [
  { to: '/', label: 'Inicio' },
  { to: '/servicios', label: 'Servicios' },
  { to: '/equipo', label: 'Nuestro equipo' },
  { to: '/promociones', label: 'Promociones' },
]

export function PublicLayout() {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const { perfil, cliente } = useAuth()
  const { marca } = useBranding()
  const logo = marca.logo_url || logoFallback
  const logoFooter = marca.logo_footer_url || logo
  const rutaCuenta = perfil ? rutaEnEsteSalon(perfil, cliente !== null) : '/ingresar'
  const etiquetaCuenta = perfil ? 'Mi cuenta' : 'Ingresar'

  return (
    <div className="min-h-screen bg-marfil">
      {isDemoMode && <DemoBanner />}
      <header className="sticky top-0 z-40 border-b border-piedra bg-blanco/95 backdrop-blur">
        <div
          className="mx-auto flex max-w-[1440px] items-center justify-between px-5 sm:px-[40px] py-4 md:py-3"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <Link to="/" className="flex items-center">
            <img src={logo} alt={marca.nombre} className="h-12 w-auto" />
          </Link>
          <nav className="hidden items-center gap-6 md:flex lg:gap-12">
            {enlaces.map((e) => (
              <NavLink
                key={e.to}
                to={e.to}
                end={e.to === '/'}
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors ${isActive ? 'text-oliva' : 'text-carbon/70 hover:text-carbon'}`
                }
              >
                {e.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <Link
              to={rutaCuenta}
              className="flex h-12 items-center justify-center rounded-lg px-4 text-base font-medium text-oliva hover:bg-piedra/40"
            >
              {etiquetaCuenta}
            </Link>
            <Link to="/reservar">
              <Button tamano="lg" className="!rounded-lg">Agendar cita</Button>
            </Link>
          </div>
          <button
            className="rounded-lg p-2 text-carbon md:hidden"
            aria-label="Abrir menú"
            onClick={() => setMenuAbierto(true)}
          >
            <IconoMenu className="h-7 w-7" />
          </button>
        </div>
      </header>

      <MenuMovil
        abierto={menuAbierto}
        onCerrar={() => setMenuAbierto(false)}
        rutaCuenta={rutaCuenta}
        etiquetaCuenta={etiquetaCuenta}
        logo={logo}
        nombre={marca.nombre}
      />

      <main>
        <Outlet />
      </main>

      <footer className="border-t border-piedra bg-blanco px-5 sm:px-[40px] py-12">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-10 sm:flex-row sm:flex-wrap sm:gap-16">
          <div className="flex max-w-sm flex-col gap-4">
            <img
              src={logoFooter}
              alt={marca.nombre}
              className="h-16 w-auto max-w-[240px] object-contain object-left"
            />
            <p className="text-sm leading-relaxed text-carbon/60">
              {marca.eslogan || 'Un espacio para tu belleza y bienestar.'}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-base text-carbon">Conoce el salón</p>
            <Link to="/nosotros" className="text-sm text-carbon/60 hover:text-carbon">Nuestra historia</Link>
            <Link to="/equipo" className="text-sm text-carbon/60 hover:text-carbon">Nuestro equipo</Link>
            <Link to="/ubicacion" className="text-sm text-carbon/60 hover:text-carbon">Dónde estamos</Link>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-base text-carbon">Tu próximo ritual</p>
            <Link to="/servicios" className="text-sm text-carbon/60 hover:text-carbon">Servicios y promociones</Link>
            <Link to={rutaCuenta} className="text-sm text-carbon/60 hover:text-carbon">Mi cuenta</Link>
            <Link to="/cliente/reservas" className="text-sm text-carbon/60 hover:text-carbon">Mis reservas</Link>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-[1440px] text-sm text-carbon/60">© {new Date().getFullYear()} {marca.nombre} · Privacidad · Términos y condiciones</p>
      </footer>

      <div className="bg-oliva px-5 sm:px-[40px] py-16">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-marfil">Tu bienestar nos inspira</p>
          <p className="font-marca text-4xl leading-tight text-marfil sm:text-5xl">
            Tu próxima visita<br />empieza aquí.
          </p>
          <Link to="/reservar">
            <span className="mt-2 flex h-12 items-center justify-center rounded-lg border border-marfil bg-blanco px-6 text-base font-medium text-oliva">
              Agendar cita
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}

// Antes era una lista angosta que se desplegaba debajo del header, con "Ingresar" (la puerta al
// portal de empleadas — y de clientas/admin, todos comparten el mismo login) mezclado ahí sin
// distinguirse del resto. En un celular eso lo hacía fácil de pasar por alto. Este panel le da
// su propio bloque grande y con jerarquía propia, separado de la navegación, como en
// PortalLayout.tsx → MenuMovilOverlay.
function MenuMovil({
  abierto,
  onCerrar,
  rutaCuenta,
  etiquetaCuenta,
  logo,
  nombre,
}: {
  abierto: boolean
  onCerrar: () => void
  rutaCuenta: string
  etiquetaCuenta: string
  logo: string
  nombre: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogAccesible(abierto, onCerrar, panelRef)
  const location = useLocation()
  useEffect(() => { if (abierto) onCerrar() }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end md:hidden" onClick={onCerrar}>
      <div className="absolute inset-0 bg-carbon/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full max-w-xs flex-col gap-6 overflow-y-auto bg-blanco px-5 pb-5 shadow-xl"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center justify-between">
          <img src={logo} alt={nombre} className="h-10 w-auto" />
          <button onClick={onCerrar} aria-label="Cerrar menú" className="rounded-lg p-1.5 text-carbon/60 hover:bg-piedra/40 hover:text-carbon">
            <IconoX className="h-6 w-6" />
          </button>
        </div>

        <Link
          to={rutaCuenta}
          onClick={onCerrar}
          className="flex items-center gap-3 rounded-2xl border-2 border-oliva bg-oliva/5 px-4 py-4"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-oliva text-blanco">
            <IconoPerfil className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-semibold text-carbon">{etiquetaCuenta}</span>
            <span className="block text-xs text-carbon/60">Empleadas, clientas y administración entran por aquí</span>
          </span>
          <IconoChevronDerecha className="h-5 w-5 shrink-0 text-oliva" />
        </Link>

        <nav className="flex flex-col gap-1">
          {enlaces.map((e) => (
            <NavLink
              key={e.to}
              to={e.to}
              end={e.to === '/'}
              onClick={onCerrar}
              className={({ isActive }) =>
                `rounded-lg px-3 py-3 text-base font-medium ${isActive ? 'bg-piedra text-oliva' : 'text-carbon/80 hover:bg-piedra/40'}`
              }
            >
              {e.label}
            </NavLink>
          ))}
        </nav>

        <Link to="/reservar" onClick={onCerrar} className="mt-auto">
          <Button className="w-full !rounded-lg" tamano="lg">Agendar cita</Button>
        </Link>
      </div>
    </div>
  )
}
