import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { isDemoMode } from '../../lib/supabase'
import { DemoBanner } from '../ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { cerrarSesion } from '../../lib/api/auth'
import { useDialogAccesible } from '../ui/Modal'
import { IconoChevronIzquierda, IconoMenu, IconoX } from '../ui/Icons'
import { InstalarAppBanner } from '../pwa/InstalarApp'

export interface ItemNav {
  to: string
  label: string
  icono: ComponentType<SVGProps<SVGSVGElement>>
}

// "Colapsado" es una preferencia de vista (como recordar una pestaña abierta), no datos del
// negocio, así que persistirla en localStorage está bien — nunca se guarda ahí un cliente, una
// venta ni ninguna otra información real.
function usarSidebarColapsado() {
  const [colapsado, setColapsado] = useState(() => {
    try {
      return localStorage.getItem('sidebar-colapsado') === '1'
    } catch {
      return false
    }
  })
  function alternar() {
    setColapsado((prev) => {
      const next = !prev
      try {
        localStorage.setItem('sidebar-colapsado', next ? '1' : '0')
      } catch {
        // localStorage puede no estar disponible (navegación privada); no es crítico aquí.
      }
      return next
    })
  }
  return { colapsado, alternar }
}

export function PortalLayout({ items, titulo }: { items: ItemNav[]; titulo: string }) {
  const { perfil, profesional, cerrarSesionLocal } = useAuth()
  const { colapsado, alternar } = usarSidebarColapsado()
  const location = useLocation()
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false)

  // Solo aplica a un admin que ADEMÁS tiene perfil de profesional (ver RutaProtegida): le
  // ofrece saltar al otro portal sin cerrar sesión ni tocar su rol en la base de datos.
  const enlaceOtroPortal =
    perfil?.rol === 'admin' && profesional
      ? location.pathname.startsWith('/equipo-app')
        ? { to: '/admin', texto: 'Ir a Administración' }
        : { to: '/equipo-app', texto: 'Ir a portal de empleadas' }
      : null

  async function salir() {
    await cerrarSesion()
    cerrarSesionLocal()
  }

  const itemActivo = items.find((item) => (item.to === items[0].to ? location.pathname === item.to : location.pathname.startsWith(item.to)))

  return (
    <div className="min-h-screen bg-marfil">
      {isDemoMode && <DemoBanner />}
      <div className="flex">
        {/* Sidebar (tablet/escritorio) */}
        <aside className={`hidden shrink-0 flex-col gap-6 border-r border-piedra bg-blanco py-6 md:flex ${colapsado ? 'w-[72px] px-2' : 'w-60 px-4'}`}>
          <div className={`flex items-center ${colapsado ? 'justify-center' : 'justify-between px-2'}`}>
            <Link to="/" className="font-marca text-xl font-semibold text-carbon" title="Claudia Patricia">
              {colapsado ? 'CP' : 'Claudia Patricia'}
            </Link>
          </div>
          {!colapsado && <p className="-mt-4 px-2 font-sans text-[10px] font-semibold uppercase tracking-[0.15em] text-carbon/40">{titulo}</p>}

          <nav className="flex flex-col gap-1.5">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === items[0].to}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors ${colapsado ? 'justify-center px-2' : 'px-3'} ${
                    isActive ? 'bg-piedra text-oliva' : 'text-carbon/70 hover:bg-piedra/40'
                  }`
                }
              >
                <item.icono className="h-[18px] w-[18px] shrink-0" />
                {!colapsado && item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-1 border-t border-piedra pt-3">
            {enlaceOtroPortal && (
              <Link
                to={enlaceOtroPortal.to}
                title={enlaceOtroPortal.texto}
                className={`rounded-lg py-2 text-sm font-medium text-oliva hover:bg-piedra/40 ${colapsado ? 'px-2 text-center' : 'px-3'}`}
              >
                {colapsado ? '⇄' : enlaceOtroPortal.texto}
              </Link>
            )}
            <button
              onClick={alternar}
              aria-label={colapsado ? 'Expandir menú' : 'Contraer menú'}
              title={colapsado ? 'Expandir menú' : 'Contraer menú'}
              className={`flex items-center gap-2 rounded-lg py-2 text-sm font-medium text-carbon/60 hover:bg-piedra/40 ${colapsado ? 'justify-center px-2' : 'px-3'}`}
            >
              <IconoChevronIzquierda className={`h-4 w-4 transition-transform ${colapsado ? 'rotate-180' : ''}`} />
              {!colapsado && 'Contraer'}
            </button>
            {!colapsado && <p className="px-3 text-xs text-carbon/50">{perfil?.nombre}{perfil?.rol ? ` · ${perfil.rol}` : ''}</p>}
            <button
              onClick={salir}
              title="Cerrar sesión"
              className={`rounded-lg py-2 text-left text-sm font-medium text-carbon/70 hover:bg-piedra/40 ${colapsado ? 'px-2 text-center' : 'px-3'}`}
            >
              {colapsado ? '⏻' : 'Cerrar sesión'}
            </button>
          </div>
        </aside>

        {/* Contenido */}
        <div className="min-h-screen min-w-0 flex-1 pb-20 md:pb-6">
          <header className="flex items-center justify-between gap-3 border-b border-piedra bg-blanco px-4 py-3 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button onClick={() => setMenuMovilAbierto(true)} aria-label="Abrir menú" className="text-carbon md:hidden">
                <IconoMenu className="h-6 w-6" />
              </button>
              <nav aria-label="Miga de pan" className="min-w-0 truncate text-sm text-carbon/50">
                <Link to={items[0].to} className="hover:text-carbon hover:underline">Mi salón</Link>
                {itemActivo && itemActivo.to !== items[0].to && (
                  <>
                    <span className="mx-1.5" aria-hidden>›</span>
                    <span className="font-medium text-carbon">{itemActivo.label}</span>
                  </>
                )}
              </nav>
            </div>
            <button onClick={salir} className="text-sm font-medium text-carbon/70 md:hidden">Salir</button>
          </header>
          <div className="flex flex-col gap-4 p-4 sm:p-6 md:p-8">
            {/* Solo el portal de empleadas se ofrece como app instalable (ver pedido) — el resto
                de los portales siguen siendo pestañas de navegador normales. */}
            {titulo === 'Portal de empleadas' && <InstalarAppBanner />}
            <Outlet />
          </div>
        </div>
      </div>

      {/* Navegación inferior (móvil). Si hay más de 5 secciones (p. ej. Administración), la
          última pestaña se reemplaza por "Más", que abre el overlay con el resto — así ninguna
          sección queda inalcanzable en pantallas angostas. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1 border-t border-piedra bg-blanco px-2 py-2 md:hidden">
        {(items.length > 5 ? items.slice(0, 4) : items).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === items[0].to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition-colors ${
                isActive ? 'bg-piedra/60 text-oliva' : 'text-carbon/50'
              }`
            }
          >
            <item.icono className="h-[22px] w-[22px]" />
            {item.label}
          </NavLink>
        ))}
        {items.length > 5 && (
          <button onClick={() => setMenuMovilAbierto(true)} className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-medium text-carbon/50">
            <IconoMenu className="h-[22px] w-[22px]" />
            Más
          </button>
        )}
      </nav>

      <MenuMovilOverlay
        abierto={menuMovilAbierto}
        onCerrar={() => setMenuMovilAbierto(false)}
        items={items}
        titulo={titulo}
        onSalir={salir}
        enlaceOtroPortal={enlaceOtroPortal}
      />
    </div>
  )
}

function MenuMovilOverlay({
  abierto,
  onCerrar,
  items,
  titulo,
  onSalir,
  enlaceOtroPortal,
}: {
  abierto: boolean
  onCerrar: () => void
  items: ItemNav[]
  titulo: string
  onSalir: () => void
  enlaceOtroPortal: { to: string; texto: string } | null
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogAccesible(abierto, onCerrar, panelRef)
  // Cerrar automáticamente al navegar, para no dejar el overlay abierto tapando la página nueva.
  const location = useLocation()
  useEffect(() => { if (abierto) onCerrar() }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex md:hidden" onClick={onCerrar}>
      <div className="absolute inset-0 bg-carbon/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Menú de ${titulo}`}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-72 max-w-[80vw] flex-col gap-4 overflow-y-auto bg-blanco p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <p className="font-marca text-lg font-semibold text-carbon">Claudia Patricia</p>
          <button onClick={onCerrar} aria-label="Cerrar menú" className="text-carbon/60 hover:text-carbon">
            <IconoX className="h-5 w-5" />
          </button>
        </div>
        <p className="-mt-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-carbon/40">{titulo}</p>
        <nav className="flex flex-col gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === items[0].to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-piedra text-oliva' : 'text-carbon/70 hover:bg-piedra/40'}`
              }
            >
              <item.icono className="h-[18px] w-[18px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        {enlaceOtroPortal && (
          <Link to={enlaceOtroPortal.to} className="mt-auto rounded-lg px-3 py-2.5 text-sm font-medium text-oliva hover:bg-piedra/40">
            {enlaceOtroPortal.texto}
          </Link>
        )}
        <button onClick={onSalir} className={`rounded-lg px-3 py-2.5 text-left text-sm font-medium text-carbon/70 hover:bg-piedra/40 ${enlaceOtroPortal ? '' : 'mt-auto'}`}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
