import type { ComponentType, SVGProps } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { isDemoMode } from '../../lib/supabase'
import { DemoBanner } from '../ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { cerrarSesion } from '../../lib/api/auth'

export interface ItemNav {
  to: string
  label: string
  icono: ComponentType<SVGProps<SVGSVGElement>>
}

export function PortalLayout({ items, titulo }: { items: ItemNav[]; titulo: string }) {
  const { perfil, cerrarSesionLocal } = useAuth()

  async function salir() {
    await cerrarSesion()
    cerrarSesionLocal()
  }

  return (
    <div className="min-h-screen bg-marfil">
      {isDemoMode && <DemoBanner />}
      <div className="mx-auto flex max-w-6xl">
        {/* Sidebar (tablet/escritorio) */}
        <aside className="hidden w-60 shrink-0 flex-col gap-7 border-r border-piedra px-4 py-8 md:flex">
          <Link to="/" className="px-2 font-marca text-xl font-semibold text-carbon">
            Claudia Patricia
            <span className="mt-1 block font-sans text-[10px] font-semibold uppercase tracking-[0.15em] text-carbon/40">
              {titulo}
            </span>
          </Link>
          <nav className="flex flex-col gap-1.5">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-oliva text-blanco' : 'text-carbon/70 hover:bg-piedra/40'
                  }`
                }
              >
                <item.icono className="h-[18px] w-[18px] shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-1 border-t border-piedra pt-3">
            <p className="px-3 text-xs text-carbon/50">{perfil?.nombre}</p>
            <button onClick={salir} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-carbon/70 hover:bg-piedra/40">
              Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Contenido */}
        <div className="min-h-screen flex-1 pb-20 md:pb-6">
          <header className="flex items-center justify-between border-b border-piedra px-4 py-3 md:hidden">
            <span className="font-marca text-lg font-semibold text-carbon">{titulo}</span>
            <button onClick={salir} className="text-sm font-medium text-carbon/70">
              Salir
            </button>
          </header>
          <div className="p-4 sm:p-6">
            <Outlet />
          </div>
        </div>
      </div>

      {/* Navegación inferior (móvil): la pestaña activa recibe un fondo suave en vez de solo
          cambiar el color del texto, para que se note de un vistazo cuál sección está abierta. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1 border-t border-piedra bg-blanco px-2 py-2 md:hidden">
        {items.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
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
      </nav>
    </div>
  )
}
