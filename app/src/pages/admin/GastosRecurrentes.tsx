import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { CampoMoneda, Input, Select } from '../../components/ui/Campos'
import { Card, EmptyState, ErrorState } from '../../components/ui/Estados'
import {
  cambiarActivaPlantillaRecurrente,
  crearPlantillaRecurrente,
  editarPlantillaRecurrente,
  generarSiguienteGastoRecurrente,
} from '../../lib/api/gastos'
import { fechaBogotaISO, formatoFecha, formatoMoneda } from '../../lib/format'
import type { CategoriaGasto, FrecuenciaRecurrencia, PlantillaGastoRecurrente } from '../../lib/types'

export function GastosRecurrentes({
  plantillas,
  categorias,
  onCambio,
  onGastoGenerado,
}: {
  plantillas: PlantillaGastoRecurrente[]
  categorias: CategoriaGasto[]
  onCambio: () => void
  onGastoGenerado: () => void
}) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState<PlantillaGastoRecurrente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generando, setGenerando] = useState<string | null>(null)
  const [cambiandoEstado, setCambiandoEstado] = useState<string | null>(null)

  async function generar(id: string) {
    setGenerando(id)
    setError(null)
    try {
      await generarSiguienteGastoRecurrente(id)
      onGastoGenerado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGenerando(null)
    }
  }

  async function cambiarActiva(id: string, activa: boolean) {
    setCambiandoEstado(id)
    try {
      await cambiarActivaPlantillaRecurrente(id, activa)
      onCambio()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCambiandoEstado(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-carbon/60">
          Cada plantilla genera un gasto pendiente nuevo cuando pulsas "Generar siguiente gasto" — nunca crea un pago automático.
        </p>
        <Button tamano="sm" onClick={() => { setEditando(null); setMostrarForm(true) }}>Nueva plantilla</Button>
      </div>

      {error && <ErrorState mensaje={error} />}

      {mostrarForm && (
        <FormularioPlantilla
          plantilla={editando}
          categorias={categorias}
          onCancelar={() => setMostrarForm(false)}
          onGuardado={() => { setMostrarForm(false); onCambio() }}
        />
      )}

      {plantillas.length === 0 ? (
        <EmptyState titulo="Sin plantillas recurrentes" descripcion="Crea una para gastos que se repiten cada semana o cada mes, como el arriendo o el internet." />
      ) : (
        <div className="flex flex-col gap-2">
          {plantillas.map((p) => (
            <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium text-carbon">{p.concepto}</p>
                <p className="text-xs text-carbon/60">
                  {p.categoria_nombre} · {formatoMoneda(p.valor_total)} · {p.frecuencia === 'mensual' ? 'Mensual' : 'Semanal'} · próxima referencia: día {new Date(p.primera_fecha_vencimiento + 'T00:00:00').getDate()}
                  {p.fecha_fin ? ` · termina ${formatoFecha(p.fecha_fin)}` : ''}
                </p>
                {!p.activa && <p className="text-xs font-semibold text-carbon/40">Pausada</p>}
              </div>
              <div className="flex items-center gap-2">
                <Button tamano="sm" variante="secondary" onClick={() => { setEditando(p); setMostrarForm(true) }}>Editar</Button>
                <Button tamano="sm" variante="secondary" onClick={() => cambiarActiva(p.id, !p.activa)} cargando={cambiandoEstado === p.id}>
                  {p.activa ? 'Pausar' : 'Reanudar'}
                </Button>
                <Button tamano="sm" onClick={() => generar(p.id)} cargando={generando === p.id} disabled={!p.activa}>
                  Generar siguiente gasto
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function FormularioPlantilla({
  plantilla,
  categorias,
  onCancelar,
  onGuardado,
}: {
  plantilla: PlantillaGastoRecurrente | null
  categorias: CategoriaGasto[]
  onCancelar: () => void
  onGuardado: () => void
}) {
  const editando = !!plantilla
  const [concepto, setConcepto] = useState(plantilla?.concepto ?? '')
  const [categoriaId, setCategoriaId] = useState(plantilla?.categoria_id ?? '')
  const [valorTotal, setValorTotal] = useState<number | null>(plantilla?.valor_total ?? null)
  const [frecuencia, setFrecuencia] = useState<FrecuenciaRecurrencia>(plantilla?.frecuencia ?? 'mensual')
  const [primeraFecha, setPrimeraFecha] = useState(plantilla?.primera_fecha_vencimiento ?? fechaBogotaISO())
  const [fechaFin, setFechaFin] = useState(plantilla?.fecha_fin ?? '')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setError(null)
    if (!concepto.trim()) { setError('El concepto es obligatorio.'); return }
    if (!valorTotal || valorTotal <= 0) { setError('Ingresa un valor mayor que cero.'); return }
    if (!categoriaId) { setError('Elige una categoría.'); return }
    setGuardando(true)
    try {
      if (editando) {
        await editarPlantillaRecurrente({ id: plantilla!.id, concepto: concepto.trim(), categoriaId, valorTotal, frecuencia, fechaFin: fechaFin || null })
      } else {
        await crearPlantillaRecurrente({ concepto: concepto.trim(), categoriaId, valorTotal, frecuencia, primeraFechaVencimiento: primeraFecha, fechaFin: fechaFin || null })
      }
      onGuardado()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      {error && <ErrorState mensaje={error} />}
      <Input id="prConcepto" etiqueta="Concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <CampoMoneda id="prValor" etiqueta="Valor" value={valorTotal} onChange={setValorTotal} />
        <Select id="prCategoria" etiqueta="Categoría" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
          <option value="">Elige una categoría</option>
          {categorias.filter((c) => c.activa).map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select id="prFrecuencia" etiqueta="Frecuencia" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as FrecuenciaRecurrencia)}>
          <option value="mensual">Mensual</option>
          <option value="semanal">Semanal</option>
        </Select>
        {!editando && (
          <Input id="prPrimeraFecha" etiqueta="Primer vencimiento" type="date" value={primeraFecha} onChange={(e) => setPrimeraFecha(e.target.value)} />
        )}
      </div>
      <Input id="prFechaFin" etiqueta="Fecha final (opcional)" type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} ayuda="Después de esta fecha, la plantilla deja de generar ocurrencias nuevas." />
      {editando && <p className="text-xs text-carbon/50">Editar esta plantilla solo afecta las ocurrencias futuras; los gastos ya generados no cambian.</p>}
      <div className="flex gap-2">
        <Button tamano="sm" onClick={guardar} cargando={guardando}>Guardar plantilla</Button>
        <Button tamano="sm" variante="secondary" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
      </div>
    </Card>
  )
}
