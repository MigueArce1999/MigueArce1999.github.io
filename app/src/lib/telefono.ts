// Normalización de teléfono compartida por el formulario admin y el público, reflejando la
// MISMA comparación que ya usa fn_registrar_cliente_publico en el servidor (últimos 10 dígitos
// iguales = mismo número, con o sin indicativo de país): "3001234567" y "+57 300 123 4567"
// deben reconocerse como el mismo teléfono. Ver supabase/migrations/0024.
export function soloDigitos(telefono: string): string {
  return telefono.replace(/\D/g, '')
}

export function normalizarTelefono(telefono: string): string {
  return telefono.replace(/[^0-9+]/g, '')
}

export function telefonoValido(telefono: string): boolean {
  return soloDigitos(telefono).length >= 7
}

export function telefonosEquivalentes(a: string, b: string): boolean {
  const da = soloDigitos(a)
  const db = soloDigitos(b)
  if (da.length < 7 || db.length < 7) return false
  return da.slice(-10) === db.slice(-10)
}
