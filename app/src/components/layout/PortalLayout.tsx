import { Link, NavLink, Outlet } from 'react-router-dom'
import { isDemoMode } from '../../lib/supabase'
import { DemoBanner } from '../ui/Estados'
import { useAuth } from '../../state/AuthContext'
import { cerrarSesion } from '../../lib/api/auth'

export interface ItemNav {
  to: string
  label: string
  icono: string
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
        <aside className="hidden w-60 shrink-0 flex-col gap-1 border-r border-piedra px-4 py-6 md:flex">
          <Link to="/" className="mb-6 font-marca text-xl font-semibold text-carbon">
            Claudia Patricia
          </Link>
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-carbon/40">{titulo}</p>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-oliva text-blanco' : 'text-carbon/80 hover:bg-piedra/40'
                }`
              }
            >
              <span aria-hidden>{item.icono}</span>
              {item.label}
            </NavLink>
          ))}
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

      {/* Navegación inferior (móvil) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-piedra bg-blanco py-1.5 md:hidden">
        {items.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium ${
                isActive ? 'text-oliva' : 'text-carbon/60'
              }`
            }
          >
            <span aria-hidden className="text-lg leading-none">
              {item.icono}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
