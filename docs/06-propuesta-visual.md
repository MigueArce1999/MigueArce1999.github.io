# 6. Propuesta visual

Basada en el moodboard de marca "Claudia Patricia" (marfil / verde oliva / carbón / champán) y el logo de
mariposa entregado. Implementada como tokens CSS en `app/src/styles/tokens.css` y config de Tailwind en
`app/tailwind.config.ts`.

## Paleta

| Token | Hex | Uso |
|---|---|---|
| `--color-marfil` | `#F7F5EF` | fondo base |
| `--color-blanco` | `#FFFFFF` | superficies, tarjetas |
| `--color-piedra` | `#E6E1D7` | bordes, separadores, fondos secundarios |
| `--color-oliva` | `#394638` | acento primario, botones principales, iconografía |
| `--color-carbon` | `#262923` | texto principal (nunca gris claro sobre marfil) |
| `--color-champan` | `#B6A17B` | acentos, hover, detalles de marca |

Contraste verificado: `carbon` sobre `marfil` ≈ 12.6:1, `blanco` sobre `oliva` ≈ 7.8:1 (AA/AAA para texto).
Los estados de error/éxito/advertencia usan matices propios (rojo terracota, verde salvia, ámbar) que
mantienen el mismo nivel de saturación baja de la paleta, para no romper la identidad.

## Tipografía

- **Cormorant Garamond** (serif) — solo para: nombre de marca, títulos de sección en la web pública (`h1`/`h2`
  del sitio), portadas de tarjetas destacadas. **No** se usa en tablas, formularios ni dashboards.
- **Manrope** (sans, muy legible) — todo lo operativo: cuerpo de texto, formularios, tablas, dashboards,
  navegación, botones.

## Componentes base (`app/src/components/ui/`)

- `Button` — variantes `primary` (oliva), `secondary` (borde piedra), `ghost`, `danger`; tamaños `sm/md/lg`;
  estado `loading` con spinner, nunca deshabilita sin feedback visual.
- `Input`, `Select`, `Textarea`, `DatePicker`, `TimePicker` — label siempre visible (no placeholder-as-label),
  mensaje de error bajo el campo, borde `piedra` → `oliva` en foco.
- `Tabs`, `Card`, `Table` (con `EmptyState`, `ErrorState`, `LoadingSkeleton` incorporados), `Modal`, `Drawer`
  (panel lateral, para detalle de reserva/cliente sin perder el contexto de la lista).
- `StatusBadge` — cada estado combina color + ícono + texto (nunca solo color):
  - Reservas: `pendiente` (reloj, ámbar), `confirmada` (check, oliva), `en_atencion` (persona, champán),
    `completada` (check doble, verde salvia), `cancelada` (x, terracota), `no_asistio` (alerta, gris carbón).
  - Pagos: `pendiente`, `parcial`, `pagado`, `devuelto` — badges independientes de las de cita.
- `Calendar` — vista día/semana/mes compartida entre `/equipo-app/agenda` y `/admin/agenda`, con slots
  ocupados/libres/bloqueados visualmente distintos.
- `DemoBanner` — franja fija superior visible solo cuando `VITE_SUPABASE_URL` no está configurado o
  `import.meta.env.VITE_DEMO_MODE === 'true'`: "Estás viendo datos de demostración — no se guardan cambios reales."

## Principios de interacción

- Registrar una atención y cobrar: máximo 4 pantallas/pasos desde "Mi día".
- Nunca más de 2 tarjetas de KPI por fila en móvil; nunca gráficas decorativas sin una pregunta de negocio
  detrás (cada gráfica del resumen admin tiene su fórmula documentada en `docs/01…`/`docs/03…`).
- Mobile-first para portal cliente y portal empleadas (single column, navegación inferior tipo tab bar);
  el dashboard admin es mobile-adaptable pero prioriza escritorio/tablet (tablas anchas, agenda semanal).
