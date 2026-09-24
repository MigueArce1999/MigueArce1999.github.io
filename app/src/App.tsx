import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './state/AuthContext'
import { BrandingProvider } from './state/BrandingContext'
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
import { SalonEnVivo } from './pages/public/SalonEnVivo'
import { Ingresar } from './pages/public/Ingresar'
import { Registro } from './pages/public/Registro'
import { RegistroSalon } from './pages/public/RegistroSalon'
import { Reservar } from './pages/public/Reservar'

import { ClienteInicio } from './pages/cliente/Inicio'
import { ClienteReservas } from './pages/cliente/Reservas'
import { ClienteHistorial } from './pages/cliente/Historial'
import { ClientePuntos } from './pages/cliente/Puntos'
import { ClientePerfil } from './pages/cliente/Perfil'

import { EmpleadaDia } from './pages/empleada/Dia'
import { EmpleadaAgenda } from './pages/empleada/Agenda'
import { EmpleadaDisponibilidad } from './pages/empleada/Disponibilidad'
import { EmpleadaAtender } from './pages/empleada/Atender'
import { EmpleadaVentas } from './pages/empleada/Ventas'
import { EmpleadaPerfil } from './pages/empleada/Perfil'

import { AdminResumen } from './pages/admin/Resumen'
import { AdminDashboard } from './pages/admin/Dashboard'
import { AdminAgenda } from './pages/admin/Agenda'
import { AdminClientes } from './pages/admin/Clientes'
import { ClientePerfilAdmin } from './pages/admin/ClientePerfilAdmin'
import { AdminCampanas } from './pages/admin/Campanas'
import { AdminEquipo } from './pages/admin/Equipo'
import { AdminServicios } from './pages/admin/Servicios'
import { AdminVentas } from './pages/admin/Ventas'
import { AdminComisiones } from './pages/admin/Comisiones'
import { AdminGastos } from './pages/admin/Gastos'
import { AdminFidelizacion } from './pages/admin/Fidelizacion'
import { AdminPromociones } from './pages/admin/Promociones'
import { AdminHomepage } from './pages/admin/Homepage'
import { AdminContenido } from './pages/admin/Contenido'
import { AdminReportes } from './pages/admin/Reportes'
import { AdminConfiguracion } from './pages/admin/Configuracion'
import { AdminDisponibilidadEnVivo } from './pages/admin/DisponibilidadEnVivo'
import {
  IconoAgenda,
  IconoAtender,
  IconoCampanas,
  IconoClientes,
  IconoComisiones,
  IconoConfiguracion,
  IconoContenido,
  IconoDashboard,
  IconoEnVivo,
  IconoEquipo,
  IconoGastos,
  IconoHistorial,
  IconoHomepage,
  IconoInicio,
  IconoPerfil,
  IconoPromociones,
  IconoPuntos,
  IconoReportes,
  IconoResumen,
  IconoVentas,
} from './components/ui/Icons'
import type { ItemNav } from './components/layout/PortalLayout'

const navCliente: ItemNav[] = [
  { to: '/cliente', label: 'Inicio', icono: IconoInicio },
  { to: '/cliente/reservas', label: 'Reservas', icono: IconoAgenda },
  { to: '/cliente/historial', label: 'Historial', icono: IconoHistorial },
  { to: '/cliente/puntos', label: 'Mis recompensas', icono: IconoPuntos },
  { to: '/cliente/perfil', label: 'Perfil', icono: IconoPerfil },
]

const navEmpleada: ItemNav[] = [
  { to: '/equipo-app', label: 'Mi día', icono: IconoInicio },
  { to: '/equipo-app/agenda', label: 'Agenda', icono: IconoAgenda },
  { to: '/equipo-app/disponibilidad', label: 'Disponibilidad', icono: IconoConfiguracion },
  { to: '/equipo-app/atender', label: 'Atender', icono: IconoAtender },
  { to: '/equipo-app/ventas', label: 'Ventas', icono: IconoVentas },
  { to: '/equipo-app/perfil', label: 'Perfil', icono: IconoPerfil },
]

const navAdmin: ItemNav[] = [
  { to: '/admin', label: 'Resumen', icono: IconoResumen },
  { to: '/admin/dashboard', label: 'Dashboard', icono: IconoDashboard },
  { to: '/admin/agenda', label: 'Agenda', icono: IconoAgenda },
  { to: '/admin/clientes', label: 'Clientes', icono: IconoClientes },
  { to: '/admin/campanas', label: 'Campañas', icono: IconoCampanas },
  { to: '/admin/equipo', label: 'Equipo', icono: IconoEquipo },
  { to: '/admin/servicios', label: 'Servicios', icono: IconoAtender },
  { to: '/admin/ventas', label: 'Ventas', icono: IconoVentas },
  { to: '/admin/ventas/nueva', label: 'Registrar venta', icono: IconoAtender },
  { to: '/admin/comisiones', label: 'Comisiones', icono: IconoComisiones },
  { to: '/admin/gastos', label: 'Gastos', icono: IconoGastos },
  { to: '/admin/fidelizacion', label: 'Fidelización', icono: IconoPuntos },
  { to: '/admin/promociones', label: 'Promociones', icono: IconoPromociones },
  { to: '/admin/homepage', label: 'Homepage', icono: IconoHomepage },
  { to: '/admin/contenido', label: 'Contenido', icono: IconoContenido },
  { to: '/admin/reportes', label: 'Reportes', icono: IconoReportes },
  { to: '/admin/disponibilidad-en-vivo', label: 'GlowDesk Live', icono: IconoEnVivo },
  { to: '/admin/configuracion', label: 'Configuración', icono: IconoConfiguracion },
]

function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <BrandingProvider>
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
            <Route path="/salon-en-vivo" element={<SalonEnVivo />} />
            <Route path="/ingresar" element={<Ingresar />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/reservar" element={<Reservar />} />
          </Route>

          {/* Fuera de PublicLayout a propósito: es la pantalla que abre el QR/enlace de
              "Compartir registro" (Admin → Clientes) y debe verse sin el header/nav del sitio,
              sin sesión de ningún tipo. */}
          <Route path="/registro-salon" element={<RegistroSalon />} />

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
            <Route path="/equipo-app/disponibilidad" element={<EmpleadaDisponibilidad />} />
            <Route path="/equipo-app/atender" element={<EmpleadaAtender />} />
            <Route path="/equipo-app/ventas" element={<EmpleadaVentas />} />
            <Route path="/equipo-app/perfil" element={<EmpleadaPerfil />} />
          </Route>

          <Route element={<RutaProtegida rolRequerido="admin"><PortalLayout items={navAdmin} titulo="Administración" /></RutaProtegida>}>
            <Route path="/admin" element={<AdminResumen />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/agenda" element={<AdminAgenda />} />
            <Route path="/admin/clientes" element={<AdminClientes />} />
            <Route path="/admin/clientes/:id" element={<ClientePerfilAdmin />} />
            <Route path="/admin/campanas" element={<AdminCampanas />} />
            <Route path="/admin/equipo" element={<AdminEquipo />} />
            <Route path="/admin/servicios" element={<AdminServicios />} />
            <Route path="/admin/ventas" element={<AdminVentas />} />
            <Route path="/admin/ventas/nueva" element={<EmpleadaAtender rutaFinalizar="/admin/ventas" etiquetaFinalizar="Volver a Ventas" />} />
            <Route path="/admin/comisiones" element={<AdminComisiones />} />
            <Route path="/admin/gastos" element={<AdminGastos />} />
            <Route path="/admin/fidelizacion" element={<AdminFidelizacion />} />
            <Route path="/admin/promociones" element={<AdminPromociones />} />
            <Route path="/admin/homepage" element={<AdminHomepage />} />
            <Route path="/admin/contenido" element={<AdminContenido />} />
            <Route path="/admin/reportes" element={<AdminReportes />} />
            <Route path="/admin/disponibilidad-en-vivo" element={<AdminDisponibilidadEnVivo />} />
            <Route path="/admin/configuracion" element={<AdminConfiguracion />} />
          </Route>

          <Route path="/plataforma" element={<Navigate to="/" replace />} />
        </Routes>
        </BrandingProvider>
      </AuthProvider>
    </HashRouter>
  )
}

export default App
