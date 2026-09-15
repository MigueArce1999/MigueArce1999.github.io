import type { ButtonHTMLAttributes } from 'react'

type Variante = 'primary' | 'secondary' | 'ghost' | 'danger'
type Tamano = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  tamano?: Tamano
  cargando?: boolean
}

const variantes: Record<Variante, string> = {
  primary: 'bg-oliva text-blanco hover:bg-oliva-hover disabled:opacity-60',
  secondary: 'bg-blanco text-carbon border border-piedra hover:border-oliva disabled:opacity-60',
  ghost: 'bg-transparent text-carbon hover:bg-piedra/50 disabled:opacity-60',
  danger: 'bg-error text-blanco hover:opacity-90 disabled:opacity-60',
}

const tamanos: Record<Tamano, string> = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-sm px-4 py-2.5',
  lg: 'text-base px-5 py-3',
}

export function Button({ variante = 'primary', tamano = 'md', cargando, className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed ${variantes[variante]} ${tamanos[tamano]} ${className}`}
      disabled={disabled || cargando}
      {...rest}
    >
      {cargando && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </button>
  )
}
