import { Link, NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { isDemoMode } from '../../lib/supabase'
import { DemoBanner } from '../ui/Estados'
import { Button } from '../ui/Button'

const enlaces = [
  { to: '/', label: 'Inicio' },
  { to: '/servicios', label: 'Servicios' },
  { to: '/promociones', label: 'Promociones' },
  { to: '/equipo', label: 'Equipo' },
  { to: '/nosotros', label: 'Nosotros' },
  { to: '/ubicacion', label: 'Ubicación' },
]

export function PublicLayout() {
  const [menuAbierto, setMenuAbierto] = useState(false)

  return (
    <div className="min-h-screen bg-marfil">
      {isDemoMode && <DemoBanner />}
      <header className="sticky top-0 z-40 border-b border-piedra bg-marfil/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="font-marca text-2xl font-semibold text-carbon">
            Claudia Patricia
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
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
            <Link to="/ingresar" className="text-sm font-medium text-carbon/70 hover:text-carbon">
              Ingresar
            </Link>
            <Link to="/reservar">
              <Button tamano="sm">Reservar cita</Button>
            </Link>
          </div>
          <button
            className="text-2xl md:hidden"
            aria-label="Abrir menú"
            onClick={() => setMenuAbierto((v) => !v)}
          >
            ☰
          </button>
        </div>
        {menuAbierto && (
          <nav className="flex flex-col gap-1 border-t border-piedra px-4 py-3 md:hidden">
            {enlaces.map((e) => (
              <NavLink
                key={e.to}
                to={e.to}
                end={e.to === '/'}
                onClick={() => setMenuAbierto(false)}
                className="rounded-lg px-2 py-2 text-sm font-medium text-carbon/80 hover:bg-piedra/40"
              >
                {e.label}
              </NavLink>
            ))}
            <Link to="/ingresar" onClick={() => setMenuAbierto(false)} className="rounded-lg px-2 py-2 text-sm font-medium text-carbon/80 hover:bg-piedra/40">
              Ingresar
            </Link>
            <Link to="/reservar" onClick={() => setMenuAbierto(false)} className="mt-1">
              <Button className="w-full">Reservar cita</Button>
            </Link>
          </nav>
        )}
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="mt-16 border-t border-piedra bg-blanco px-4 py-10 text-sm text-carbon/70 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-marca text-lg font-semibold text-carbon">Claudia Patricia</p>
            <p>Salón de belleza · Cartagena, Colombia</p>
          </div>
          <div className="flex flex-col gap-1">
            <Link to="/ubicacion" className="hover:text-carbon">Ubicación y horarios</Link>
            <Link to="/servicios" className="hover:text-carbon">Servicios</Link>
            <Link to="/ingresar" className="hover:text-carbon">Acceso equipo</Link>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-6xl text-xs text-carbon/50">© {new Date().getFullYear()} Claudia Patricia Salón de Belleza.</p>
      </footer>
    </div>
  )
}
