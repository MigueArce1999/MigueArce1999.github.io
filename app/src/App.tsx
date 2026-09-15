import { HashRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './state/AuthContext'
import { PublicLayout } from './components/layout/PublicLayout'
import { PortalLayout } from './components/layout/PortalLayout'
import { RutaProtegida } from './components/layout/RutaProtegida'

import { Home } from './pages/public/Home'
import { Nosotros } from './pages/public/Nosotros'
import { Servicios } from './pages/public/Servicios'
import { ServicioDetalle } from './pages/public/ServicioDetalle'
import { Promociones } from './pages/public/Promociones'
import { Equipo } from './pages/public/Equipo'
import { ProfesionalDetalle } from './pages/public/ProfesionalDetalle'
import { Ubicacion } from './pages/public/Ubicacion'
import { Ingresar } from './pages/public/Ingresar'
import { Registro } from './pages/public/Registro'
import { Reservar } from './pages/public/Reservar'

import { ClienteInicio } from './pages/cliente/Inicio'
import { ClienteReservas } from './pages/cliente/Reservas'
import { ClienteHistorial } from './pages/cliente/Historial'
import { ClientePuntos } from './pages/cliente/Puntos'
import { ClientePerfil } from './pages/cliente/Perfil'

import { EmpleadaDia } from './pages/empleada/Dia'
import { EmpleadaAgenda } from './pages/empleada/Agenda'
import { EmpleadaAtender } from './pages/empleada/Atender'
import { EmpleadaVentas } from './pages/empleada/Ventas'
import { EmpleadaPerfil } from './pages/empleada/Perfil'

import { AdminResumen } from './pages/admin/Resumen'
import { AdminAgenda } from './pages/admin/Agenda'
import { AdminClientes } from './pages/admin/Clientes'
import { AdminEquipo } from './pages/admin/Equipo'
import { AdminServicios } from './pages/admin/Servicios'
import { AdminVentas } from './pages/admin/Ventas'
import { AdminComisiones } from './pages/admin/Comisiones'
import { AdminGastos } from './pages/admin/Gastos'
import { AdminFidelizacion } from './pages/admin/Fidelizacion'
import { AdminPromociones } from './pages/admin/Promociones'
import { AdminContenido } from './pages/admin/Contenido'
import { AdminReportes } from './pages/admin/Reportes'
import { AdminConfiguracion } from './pages/admin/Configuracion'

const navCliente = [
  { to: '/cliente', label: 'Inicio', icono: '🏠' },
  { to: '/cliente/reservas', label: 'Reservas', icono: '📅' },
  { to: '/cliente/historial', label: 'Historial', icono: '🧾' },
  { to: '/cliente/puntos', label: 'Puntos', icono: '⭐' },
  { to: '/cliente/perfil', label: 'Perfil', icono: '👤' },
]

const navEmpleada = [
  { to: '/equipo-app', label: 'Mi día', icono: '🏠' },
  { to: '/equipo-app/agenda', label: 'Agenda', icono: '📅' },
  { to: '/equipo-app/atender', label: 'Atender', icono: '✂️' },
  { to: '/equipo-app/ventas', label: 'Ventas', icono: '💰' },
  { to: '/equipo-app/perfil', label: 'Perfil', icono: '👤' },
]

const navAdmin = [
  { to: '/admin', label: 'Resumen', icono: '📊' },
  { to: '/admin/agenda', label: 'Agenda', icono: '📅' },
  { to: '/admin/clientes', label: 'Clientes', icono: '👥' },
  { to: '/admin/equipo', label: 'Equipo', icono: '💼' },
  { to: '/admin/servicios', label: 'Servicios', icono: '✂️' },
  { to: '/admin/ventas', label: 'Ventas', icono: '💰' },
  { to: '/admin/comisiones', label: 'Comisiones', icono: '🧮' },
  { to: '/admin/gastos', label: 'Gastos', icono: '📉' },
  { to: '/admin/fidelizacion', label: 'Fidelización', icono: '⭐' },
  { to: '/admin/promociones', label: 'Promociones', icono: '🏷️' },
  { to: '/admin/contenido', label: 'Contenido', icono: '🖼️' },
  { to: '/admin/reportes', label: 'Reportes', icono: '📈' },
  { to: '/admin/configuracion', label: 'Configuración', icono: '⚙️' },
]

function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/nosotros" element={<Nosotros />} />
            <Route path="/servicios" element={<Servicios />} />
            <Route path="/servicios/:id" element={<ServicioDetalle />} />
            <Route path="/promociones" element={<Promociones />} />
            <Route path="/equipo" element={<Equipo />} />
            <Route path="/equipo/:slug" element={<ProfesionalDetalle />} />
            <Route path="/ubicacion" element={<Ubicacion />} />
            <Route path="/ingresar" element={<Ingresar />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/reservar" element={<Reservar />} />
          </Route>

          <Route element={<RutaProtegida rolRequerido="cliente"><PortalLayout items={navCliente} titulo="Portal cliente" /></RutaProtegida>}>
            <Route path="/cliente" element={<ClienteInicio />} />
            <Route path="/cliente/reservas" element={<ClienteReservas />} />
            <Route path="/cliente/historial" element={<ClienteHistorial />} />
            <Route path="/cliente/puntos" element={<ClientePuntos />} />
            <Route path="/cliente/perfil" element={<ClientePerfil />} />
          </Route>

          <Route element={<RutaProtegida rolRequerido="empleada"><PortalLayout items={navEmpleada} titulo="Portal de empleadas" /></RutaProtegida>}>
            <Route path="/equipo-app" element={<EmpleadaDia />} />
            <Route path="/equipo-app/agenda" element={<EmpleadaAgenda />} />
            <Route path="/equipo-app/atender" element={<EmpleadaAtender />} />
            <Route path="/equipo-app/ventas" element={<EmpleadaVentas />} />
            <Route path="/equipo-app/perfil" element={<EmpleadaPerfil />} />
          </Route>

          <Route element={<RutaProtegida rolRequerido="admin"><PortalLayout items={navAdmin} titulo="Administración" /></RutaProtegida>}>
            <Route path="/admin" element={<AdminResumen />} />
            <Route path="/admin/agenda" element={<AdminAgenda />} />
            <Route path="/admin/clientes" element={<AdminClientes />} />
            <Route path="/admin/equipo" element={<AdminEquipo />} />
            <Route path="/admin/servicios" element={<AdminServicios />} />
            <Route path="/admin/ventas" element={<AdminVentas />} />
            <Route path="/admin/comisiones" element={<AdminComisiones />} />
            <Route path="/admin/gastos" element={<AdminGastos />} />
            <Route path="/admin/fidelizacion" element={<AdminFidelizacion />} />
            <Route path="/admin/promociones" element={<AdminPromociones />} />
            <Route path="/admin/contenido" element={<AdminContenido />} />
            <Route path="/admin/reportes" element={<AdminReportes />} />
            <Route path="/admin/configuracion" element={<AdminConfiguracion />} />
          </Route>
        </Routes>
      </AuthProvider>
    </HashRouter>
  )
}

export default App
