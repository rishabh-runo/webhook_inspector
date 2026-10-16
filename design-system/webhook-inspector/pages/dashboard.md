# Dashboard decisions (Webhook Inspector)

`MASTER.md` is the glassmorphism redesign blueprint and wins on everything it states. This file records how its open points were settled (agreed 2026-10-16), so later UI work stays consistent.

## Settled with the product owner
- **Inspector**: opens inline as a drawer under the row (smooth expand/collapse), not a side panel.
- **Resend Request**: re-fires the stored method, headers and body to the same channel URL from the browser. No forwarding to other URLs.
- **Contrast**: blueprint tokens are used exactly as written. Colours under 4.5:1 on light glass (`--accent-emerald`, `--accent-amber`, `--method-get`, `--method-put`, `--text-code`, `--text-subtle`) are used only for borders, dots and icons; text uses `--text-main` / `--text-muted`, and errors use `--method-delete` (passes in both themes).
- **Lock Channel**: shown in the toggle group only on a password-protected channel this browser has unlocked; it forgets the password.

## Changes the product owner asked for after review (override MASTER.md)
- **Full width**: no 1440 px cap; the app fills the screen (24 px padding).
- **Softer light theme**: canvas `#dfe5ec` / `#d2dae4`, glass `rgba(241,245,249,.78)`, secondary `rgba(226,232,240,.6)`, hover `rgba(203,213,225,.75)`, input `rgba(248,250,252,.9)`. Error text in light uses `--text-danger` (a darker mix of `--method-delete`) to keep 4.5:1 on the greys.
- **Filters**: always-visible chip bar under the log toolbar (no popover), one bordered box per group (METHOD, STATUS, TIME, SHOW) with the label inside. Each group starts with an "All"/"Any" chip that is selected while the group isn't filtering; clicking it clears the group. Method and Status are multi-select, Time is one window, Show = All / Starred. Unselected chips look the same whatever their count; a selected chip gets a coloured fill + border, bold text and a check mark instead of the dot ("All" uses a neutral highlight). "Reset filters" sits at the right while any filter or search is on.
- **Collapse all**: toolbar button (disabled when nothing is open) and `Shift+C`.
- **Channel row end**: the count badge and the delete × share one slot; the × replaces the count on hover or keyboard focus (no reserved gap). Touch screens and the phone strip show both side by side.
- **Favicon & title**: `public/favicon.svg` (emerald bolt on obsidian); page title = `<channel name> · Webhook Inspector`, with the unread count in front while the tab is hidden.
- **Channel icons**: icon in front of each channel = lock (password, locked) / open lock (unlocked here) / shield (auth-key required) / globe (open). Icon colour = state: green live, amber paused, muted locked; a small pause icon also shows when paused.

## Interpretations of the blueprint
- Styles live in `public/css/style.css`. Fonts: Inter (UI) + JetBrains Mono (code).
- App shell: every region a `.glass-panel`; canvas = `--bg-canvas` with a `--bg-canvas-subtle` top fade, no decorative gradients.
- Header: brand badge, global search pill (current channel's logs; `/` or Ctrl/⌘K; clear button), req/s badge, LIVE pill with pulsing dot, sun/moon theme toggle, shortcuts button.
- Sidebar rows: security icon (see above), name, path, count, × on hover/active. `+` in the `CHANNELS` header.
- Banner: endpoint box with Copy → "Copied!", uppercase chips (ACTIVE/PAUSED, OPEN/AUTH-KEY, status, extra state), segmented `Pause Listener | Notifications | Sound Alerts | Lock Channel`, Settings button.
- Log toolbar: `N of M LOGS`, Collapse all, Compare, Export (menu), Import, Clear; filter chip bar below it.
- Rows: 44 px, 3 px method border, compare checkbox + star visible; `...` menu = Copy as cURL, Resend Request, Delete.
- Inspector tabs: Summary, Headers, Query, Body (JSON) with Parsed/Raw switch, Response, Timing. Code viewer: dark glass in both themes, line numbers, JSON colours, no folding.
- Primary buttons use the inverted surface (`--text-main` background, `--bg-canvas` text).
- Above 100 logs only rows near the viewport are rendered.
- Kept although not in the blueprint (existing functionality): Settings, paused banner, password lock screen, footer credit, keyboard help.

## Shortcuts
`/` or Ctrl/⌘K search · J/K move · Space (also O, Enter) expand · C copy endpoint URL · Shift+C collapse all · S star · X compare · P pause · [ ] channel · N/M alerts · T theme · ? help · Esc closes menus, drawers, dialogs.
