import { Link, NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { isDemoMode } from '../../lib/supabase'
import { DemoBanner } from '../ui/Estados'
import { Button } from '../ui/Button'
import { useAuth } from '../../state/AuthContext'
import type { Rol } from '../../lib/types'
import logo from '../../assets/logo-claudia-patricia.png'

const enlaces = [
  { to: '/', label: 'Inicio' },
  { to: '/servicios', label: 'Servicios' },
  { to: '/equipo', label: 'Nuestro equipo' },
  { to: '/promociones', label: 'Promociones' },
]

const rutaPorRol: Record<Rol, string> = { cliente: '/cliente', empleada: '/equipo-app', admin: '/admin' }

export function PublicLayout() {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const { perfil } = useAuth()
  const rutaCuenta = perfil ? rutaPorRol[perfil.rol] : '/ingresar'
  const etiquetaCuenta = perfil ? 'Mi cuenta' : 'Ingresar'

  return (
    <div className="min-h-screen bg-marfil">
      {isDemoMode && <DemoBanner />}
      <header className="sticky top-0 z-40 border-b border-piedra bg-marfil/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-[40px] py-3">
          <Link to="/" className="flex items-center py-1">
            <img src={logo} alt="Claudia Patricia" className="h-20 w-auto" />
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
            className="text-2xl md:hidden"
            aria-label="Abrir menú"
            onClick={() => setMenuAbierto((v) => !v)}
          >
            ☰
          </button>
        </div>
        {menuAbierto && (
          <nav className="flex flex-col gap-1 border-t border-piedra px-[40px] py-3 md:hidden">
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
            <Link to={rutaCuenta} onClick={() => setMenuAbierto(false)} className="rounded-lg px-2 py-2 text-sm font-medium text-carbon/80 hover:bg-piedra/40">
              {etiquetaCuenta}
            </Link>
            <Link to="/reservar" onClick={() => setMenuAbierto(false)} className="mt-1">
              <Button className="w-full !rounded-lg">Agendar cita</Button>
            </Link>
          </nav>
        )}
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="border-t border-piedra bg-marfil px-[40px] py-12">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-10 sm:flex-row sm:flex-wrap sm:gap-16">
          <div className="flex max-w-md flex-col gap-3">
            <img src={logo} alt="Claudia Patricia" className="h-24 w-auto" />
            <p className="text-sm text-carbon/60">Un espacio para tu belleza y bienestar.</p>
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
        <p className="mx-auto mt-10 max-w-[1440px] text-sm text-carbon/60">© {new Date().getFullYear()} Claudia Patricia · Privacidad · Términos y condiciones</p>
      </footer>

      <div className="bg-oliva px-[40px] py-16">
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
