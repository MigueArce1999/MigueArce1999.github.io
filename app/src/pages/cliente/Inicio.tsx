import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card, Cargando, EmptyState } from '../../components/ui/Estados'
import { EstadoReservaBadge } from '../../components/ui/StatusBadge'
import { TarjetaFidelizacion } from '../../components/fidelizacion/TarjetaFidelizacion'
import { CelebracionFidelizacion } from '../../components/fidelizacion/CelebracionFidelizacion'
import { useMiFidelizacion } from '../../lib/fidelizacion/useMiFidelizacion'
import { useAuth } from '../../state/AuthContext'
import { marcarMiResenaGoogle } from '../../lib/api/cliente'
import { listarPromocionesVigentes } from '../../lib/api/catalogo'
import { listarReservasDeCliente } from '../../lib/api/reservas'
import { formatoFecha, formatoHora } from '../../lib/format'
import { ENLACE_RESENA_GOOGLE } from '../../lib/constantes'
import type { Promocion, Reserva } from '../../lib/types'

export function ClienteInicio() {
  const { cliente, perfil } = useAuth()
  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [promos, setPromos] = useState<Promocion[] | null>(null)
  const { fidelizacion, cargando: cargandoFidelizacion, error: errorFidelizacion, celebraciones, recargar, reconocerCelebracion } =
    useMiFidelizacion(cliente?.id)
  // Estado local para poder ocultar la tarjeta apenas la clienta confirma, sin depender de que
  // AuthContext vuelva a leer su fila de `cliente` (solo lo hace al iniciar sesión).
  const [resenaConfirmada, setResenaConfirmada] = useState(cliente?.resena_google_confirmada ?? false)
  const [marcandoResena, setMarcandoResena] = useState(false)

  useEffect(() => {
    if (!cliente) return
    listarReservasDeCliente(cliente.id).then(setReservas)
    listarPromocionesVigentes().then(setPromos)
    setResenaConfirmada(cliente.resena_google_confirmada)
  }, [cliente])

  async function confirmarResena() {
    if (!cliente) return
    setMarcandoResena(true)
    try {
      await marcarMiResenaGoogle(cliente.id)
      setResenaConfirmada(true)
    } finally {
      setMarcandoResena(false)
    }
  }

  const proxima = reservas
    ?.filter((r) => ['confirmada', 'pendiente'].includes(r.estado) && new Date(r.rango_inicio) > new Date())
    .sort((a, b) => a.rango_inicio.localeCompare(b.rango_inicio))[0]

  const ultimosServicios = reservas?.filter((r) => r.estado === 'completada').slice(0, 3)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-marca text-2xl font-semibold text-carbon">Hola, {perfil?.nombre?.split(' ')[0]}</h1>
        <p className="text-sm text-carbon/60">Aquí tienes un resumen de tu cuenta.</p>
      </div>

      {celebraciones.length > 0 && (
        <CelebracionFidelizacion celebraciones={celebraciones} onReconocer={reconocerCelebracion} />
      )}

      <TarjetaFidelizacion
        nombreClienta={perfil?.nombre}
        fidelizacion={fidelizacion}
        cargando={cargandoFidelizacion}
        error={errorFidelizacion}
        onReintentar={recargar}
      />

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-carbon/50">Próxima cita</p>
        {!reservas ? (
          <Cargando filas={1} />
        ) : proxima ? (
          <div className="mt-2">
            <p className="font-semibold text-carbon">{proxima.servicio_nombre}</p>
            <p className="text-sm text-carbon/60">
              {formatoFecha(proxima.rango_inicio)} · {formatoHora(proxima.rango_inicio)} con {proxima.profesional_nombre}
            </p>
            <div className="mt-2"><EstadoReservaBadge estado={proxima.estado} /></div>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-carbon/60">No tienes citas próximas.</p>
            <Link to="/reservar"><Button tamano="sm">Reservar cita</Button></Link>
          </div>
        )}
      </Card>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold text-carbon">Últimos servicios</p>
          <Link to="/cliente/historial" className="text-sm font-semibold text-oliva">Ver todo</Link>
        </div>
        {!ultimosServicios ? (
          <Cargando />
        ) : ultimosServicios.length === 0 ? (
          <EmptyState titulo="Aún no tienes servicios registrados" />
        ) : (
          <div className="flex flex-col gap-2">
            {ultimosServicios.map((r) => (
              <Card key={r.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-carbon">{r.servicio_nombre}</p>
                  <p className="text-xs text-carbon/60">{formatoFecha(r.rango_inicio)} · {r.profesional_nombre}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {!resenaConfirmada && (
        <Card className="flex flex-col gap-3 bg-champan/10">
          <div>
            <p className="font-semibold text-carbon">¿Nos dejas una reseña en Google?</p>
            <p className="text-sm text-carbon/60">Nos ayuda muchísimo a que más personas nos conozcan. Toma un minuto.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={ENLACE_RESENA_GOOGLE} target="_blank" rel="noopener noreferrer">
              <Button tamano="sm">Escribir reseña ↗</Button>
            </a>
            <Button tamano="sm" variante="outline" onClick={confirmarResena} cargando={marcandoResena}>
              Ya la dejé ✓
            </Button>
          </div>
        </Card>
      )}

      {promos && promos.length > 0 && (
        <div>
          <p className="mb-3 font-semibold text-carbon">Beneficios y promociones vigentes</p>
          <div className="flex flex-col gap-2">
            {promos.map((p) => (
              <Card key={p.id} className="py-3">
                <p className="font-medium text-carbon">{p.nombre}</p>
                <p className="text-xs text-carbon/60">{p.descripcion}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
