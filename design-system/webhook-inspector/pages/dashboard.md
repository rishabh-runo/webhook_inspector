# Dashboard overrides (Webhook Inspector)

These rules override `MASTER.md` for the dashboard (`public/`). MASTER's "FAQ/Documentation Landing" pattern does not apply: this is a single-page tool.

## Layout
- Title bar across the top, then two columns: a vertical channel sidebar (`--sidebar-w`, `--strip` colour, sticky) and the main column.
- Sidebar rows: 44px, name + mono `/hook/<id>`, status icons, count badge, close `×` on hover/active. Active row = `--chrome` background + 2px accent bar on the left.
- Below 720px the sidebar turns into a horizontally scrollable row (paths and the "New channel" label hidden).
- Copyright bar fixed to the bottom (`--footer-h`); body padding keeps content clear of it.
- Toolbar band, three rows:
  1. Channel name + endpoint pill (copy icon inside), chips on a line below; right side: segmented `Pause | Notify | Sound` + Settings/Lock.
  2. Search + styled selects + **Starred** toggle chip (`aria-pressed`, filled amber star + count when on) + "Reset" (only while a filter is active). Active selects get the accent tint (`.is-set`).
  3. List bar above the logs: count (`3 of 12 logs`) on the left, Compare / Export / Import / Clear on the right.
- Never pair a checkbox with an icon for the same toggle; use one toggle chip.
- Log list: dense cards, 44px header rows, 3px left border in the method colour.

## Theme
- Dark first (MASTER palette). Light is opt-in via the theme toggle (`data-theme="light"`).
- Light palette: bg `#F8FAFC`, card `#FFFFFF`, border `#E2E8F0`, text `#0F172A`, muted `#475569`, accent `#15803D` (green-700, AA on white).
- All text pairs checked at WCAG AA 4.5:1 or better in both themes.

## Colour roles
| Role | Dark | Light |
|---|---|---|
| GET | `#22C55E` | `#15803D` |
| POST | `#60A5FA` | `#1D4ED8` |
| PUT | `#FBBF24` | `#B45309` |
| PATCH | `#C084FC` | `#7E22CE` |
| DELETE | `#F87171` | `#B91C1C` |

## Type
- IBM Plex Sans 14px / 1.5 for UI text.
- JetBrains Mono for anything code-like: URLs, methods, status codes, badges, sizes, times, JSON, the title.
- Minimum 11px only for badges and kbd; body text never below 12px.

## Icons
- Lucide outline icons, inline SVG sprite in `index.html`, used via `icon(name)` in `public/js/utils.js`.
- One family only, no emoji. Decorative icons get `aria-hidden="true"`; icon-only buttons get `aria-label` and `aria-pressed` for toggles.
- (MASTER suggests Phosphor/Heroicons; Lucide chosen because it works as an inline sprite with no build step.)

## Shape and motion
- Radius 6px (cards), 4px (controls), 8px only for tab tops and dialogs.
- No glows or heavy shadows. Hover changes border/background in 150ms.
- Chevrons rotate 90° for expand. `prefers-reduced-motion` turns transitions off.

## Interaction
- Visible focus ring on every control (`--ring`).
- Touch screens (`pointer: coarse`): icon buttons and tabs grow to 44px.
