import { Proximamente } from '../../components/ui/Proximamente'

export function AdminGastos() {
  return (
    <Proximamente
      titulo="Gastos"
      descripcion="El esquema de categorías y gastos ya existe en la base de datos (supabase/migrations/0009_caja_gastos.sql); falta la pantalla de captura y su cruce con el resumen del negocio, previsto para Fase 2 junto con caja."
    />
  )
}
