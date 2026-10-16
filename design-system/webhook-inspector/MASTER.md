# Webhook Inspector — Modern Glassmorphism Redesign Blueprint

> **Target Audience:** Claude Code / AI Development Agents / Frontend Developers  
> **Design Philosophy:** Minimalist, Vercel & Linear Inspired Glassmorphism (Dark & Light Theme Support)  
> **Priority:** Premium Developer Experience, Ultra-Sharp Micro-Borders, Zero Layout Shift, High Information Density

---

## 1. Executive Summary & Core Objectives

This specification outlines the total UI/UX transformation of **Webhook Inspector** from a basic dark-theme dashboard into a world-class, ultra-modern developer tool inspired by platforms like **Vercel**, **Linear**, and **Apple Developer Tools**.

### Key Principles
1. **Refined Translucency & Layered Depth:** Multi-layered frosted glass panels using CSS `backdrop-filter: blur(...)` over clean obsidian and slate canvases.
2. **1px Micro-Borders & Edge Highlights:** Sharp, crisp 1px borders replace heavy drop shadows, providing a sleek "floating glass pane" aesthetic.
3. **Strict Functionality Preservation:** Refactor visual components, layout structures, and styling without breaking underlying WebSocket connections, backend endpoints, incoming webhook parsers, or local storage state.
4. **Dual Theme First-Class Support:** Flawless Light and Dark theme execution using cascading CSS variables tied to a single root attribute (`data-theme="dark"` / `data-theme="light"`).

---

## 2. Strict Process & Execution Guidelines

To ensure code stability and visual excellence, all implementation work must adhere to the following strict rules:

### Architectural Guidelines
* **Zero Logic Regression:** Do not alter WebSocket handlers, request storage arrays, endpoint generation logic, or backend proxy endpoints.
* **Single Style Cascade:** Maintain all glassmorphism tokens, component rules, and responsive media queries inside a structured CSS file tree (`public/css/style.css` or modular imports).
* **High-Contrast Accessibility (WCAG AA):** Ensure every text element passes a minimum contrast ratio of **4.5:1** against its frosted glass background in both Light and Dark modes.
* **No Layout Shift on Interaction:** Standardize heights for table rows, inputs, buttons, and drawers. Hover and active states must strictly use background/border transitions and subtle GPU-accelerated transforms (`translateY(-1px)` / `scale(1)`).
* **Keyboard Focus Indicators:** Every interactive element (`button`, `a`, `input`, `select`, `tab`) must feature a distinct, visible focus ring (`2px solid var(--accent-blue)` with `2px` offset).

---

## 3. Comprehensive Design Tokens (CSS Variables)

Copy and apply these CSS variables directly into the application stylesheet:

```css
/* ==========================================================================
   GLOBAL DESIGN TOKENS (DARK MODE DEFAULT)
   ========================================================================== */
:root {
  /* Canvas & Base Layers */
  --bg-canvas: #07090e;
  --bg-canvas-subtle: #0b0f17;

  /* Glass Panel Surfaces */
  --glass-bg-primary: rgba(15, 23, 42, 0.65);
  --glass-bg-secondary: rgba(30, 41, 59, 0.45);
  --glass-bg-hover: rgba(51, 65, 85, 0.55);
  --glass-bg-active: rgba(16, 185, 129, 0.12);
  --glass-bg-input: rgba(15, 23, 42, 0.85);

  /* Micro-Borders & Edge Highlights */
  --border-glass: 1px solid rgba(255, 255, 255, 0.08);
  --border-glass-bright: 1px solid rgba(255, 255, 255, 0.16);
  --border-glass-accent: 1px solid rgba(16, 185, 129, 0.4);
  
  /* Border Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-pill: 9999px;

  /* Blur Depth */
  --blur-panel: blur(16px);
  --blur-popover: blur(24px);

  /* Typography */
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-subtle: #64748b;
  --text-code: #38bdf8;

  /* Brand Accents */
  --accent-emerald: #10b981;
  --accent-emerald-glow: rgba(16, 185, 129, 0.25);
  --accent-blue: #3b82f6;
  --accent-amber: #f59e0b;
  --accent-rose: #ef4444;
  --accent-purple: #a855f7;

  /* HTTP Method Colors */
  --method-get: #10b981;
  --method-post: #3b82f6;
  --method-put: #f59e0b;
  --method-patch: #a855f7;
  --method-delete: #ef4444;

  /* Shadows & Glows */
  --shadow-glass: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
  --shadow-glow-emerald: 0 0 16px rgba(16, 185, 129, 0.25);
  --shadow-popover: 0 20px 40px rgba(0, 0, 0, 0.6);

  /* Fonts */
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

/* ==========================================================================
   LIGHT MODE GLASSMORPHISM OVERRIDES
   ========================================================================== */
[data-theme="light"] {
  /* Canvas & Base Layers */
  --bg-canvas: #f1f5f9;
  --bg-canvas-subtle: #e2e8f0;

  /* Glass Panel Surfaces (Light Frosted Glass) */
  --glass-bg-primary: rgba(255, 255, 255, 0.75);
  --glass-bg-secondary: rgba(241, 245, 249, 0.65);
  --glass-bg-hover: rgba(226, 232, 240, 0.85);
  --glass-bg-active: rgba(16, 185, 129, 0.15);
  --glass-bg-input: rgba(255, 255, 255, 0.95);

  /* Micro-Borders & Edge Highlights */
  --border-glass: 1px solid rgba(15, 23, 42, 0.08);
  --border-glass-bright: 1px solid rgba(15, 23, 42, 0.18);
  --border-glass-accent: 1px solid rgba(16, 185, 129, 0.5);

  /* Typography */
  --text-main: #0f172a;
  --text-muted: #475569;
  --text-subtle: #94a3b8;
  --text-code: #0284c7;

  /* HTTP Method Colors (Higher Contrast for Light Surface) */
  --method-get: #059669;
  --method-post: #2563eb;
  --method-put: #d97706;
  --method-patch: #7c3aed;
  --method-delete: #dc2626;

  /* Shadows */
  --shadow-glass: 0 8px 32px 0 rgba(31, 38, 135, 0.08);
  --shadow-glow-emerald: 0 0 16px rgba(16, 185, 129, 0.2);
  --shadow-popover: 0 20px 40px rgba(15, 23, 42, 0.15);
}
```

---

## 4. UI Component Specifications

### 4.1. Dashboard Container & Grid
* **Layout Structure:** Max-width `1440px`, centered with `24px` horizontal padding.
* **Panels Class:** Wrap outer container cards with `.glass-panel`:
  ```css
  .glass-panel {
    background: var(--glass-bg-primary);
    backdrop-filter: var(--blur-panel);
    -webkit-backdrop-filter: var(--blur-panel);
    border: var(--border-glass);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-glass);
  }
  ```

### 4.2. Header Navigation
* **Brand Logo:** Lightning bolt icon inside a glowing glass badge adjacent to "Webhook Inspector".
* **Global Search Box:** Translucent pill input with inline search icon, keyboard shortcut badge (`⌘K` or `/`), and clear action button.
* **Header Actions:**
  * **Theme Switcher:** Moon/Sun toggle smoothly flipping `data-theme` attribute between `dark` and `light`.
  * **Live Status Pill:** Translucent pill badge with a pulsing emerald status dot (`((•)) LIVE`).

### 4.3. Channel Sidebar
* **Header:** Uppercase monospace title `CHANNELS` with an inline `+` button to launch the "New Channel" modal.
* **Channel Pill Items:**
  * Displays channel display name, status indicator dot, path snippet, and request count badge.
  * **Active State:** Highlighted with `var(--glass-bg-active)`, an emerald border `var(--border-glass-accent)`, and `var(--shadow-glow-emerald)`.

### 4.4. Webhook Endpoint Banner
* **Monospace Endpoint Box:** Monospace URL container with one-click copy button providing visual feedback ("Copied!").
* **Metadata Chips:** Compact glass badges displaying state (`ACTIVE`, `OPEN`, `200`).
* **Quick Toggle Group:** Segmented controls for `Pause Listener`, `Notifications`, `Sound Alerts`, and `Lock Channel`.

### 4.5. Log Table & Inspection Drawer
* **Toolbar Bar:** Request count (`3 of 12 LOGS`), filter toggle button, and quick logs management (`Compare 0/2`, `Export`, `Import`, `Clear`).
* **Row Card Structure:**
  * 44px compact height.
  * Left border indicator (3px width) colored dynamically by HTTP Method (`POST`: Blue, `GET`: Green, `PUT`: Amber, `DELETE`: Red).
* **Multi-Tab Payload Inspector:**
  * Segmented navigation tabs (`Summary`, `Headers`, `Query`, `Body (JSON)`, `Response`, `Timing`).
  * Inset code viewer with dark glass styling, JetBrains Mono font, line numbering, and JSON syntax highlighting.

---

## 5. Strategic Enhancements (Added Value Features)

To make Webhook Inspector standard-setting for modern developers, the following visual and functional enhancements are integrated into this overhaul:

### 🚀 Enhancement 1: Instant "Send Test Webhook" Action (Onboarding)
* **Problem:** New users land on an empty log workspace and must open cURL or Postman to test their webhook endpoint.
* **Solution:** Add a single-click `"Send Sample Webhook"` button inside empty state screens. Triggering this sends a synthetic JSON payload (`{"event": "user.signup", "status": "success"}`) directly to the active channel for immediate visual validation.

### ⚡ Enhancement 2: One-Click cURL Generator & Replay Tool
* **Problem:** Developers often need to reproduce an incoming webhook locally or resend it after fixing a bug.
* **Solution:** 
  1. Add a **"Copy as cURL"** option in the floating `...` log action menu.
  2. Add a **"Resend Request"** button that re-fires the stored payload, headers, and method back to the client or target server.

### 🔍 Enhancement 3: Interactive JSON Diff Viewer
* **Problem:** Comparing two similar webhook payloads (e.g. order updates) line-by-line is tedious.
* **Solution:** Utilize the existing `Compare 0/2` feature to launch a side-by-side glass modal diffing two selected requests, highlighting added, removed, or modified JSON properties in green and red.

### ⌨️ Enhancement 4: Developer Keyboard Shortcuts
* Implement instant hotkeys for common workflows:
  * `/` or `⌘K` → Focus global search field
  * `J` / `K` → Navigate up/down through the log list
  * `Space` → Expand / collapse selected request log
  * `C` → Copy active endpoint URL
  * `Esc` → Close open modals or drawers

### 📊 Enhancement 5: High-Volume Buffer Indicator & Virtualized Rendering
* **Problem:** Heavy webhook traffic (100+ req/sec) can cause browser DOM lag.
* **Solution:** Add a subtle frosted buffer status badge showing inbound throughput rate (`e.g., 24 req/s`). Utilize virtual list DOM rendering for request history items exceeding 100 rows.

---

## 6. Implementation Checklist & Roadmap for Claude Code

Execute the refactoring sequentially according to this checklist:

- [ ] **Step 1: CSS Variables Injection**
  - Inject global tokens into `public/css/style.css` for both dark and light modes.
  - Test theme switching logic via browser console.
- [ ] **Step 2: HTML Layout Wrap**
  - Wrap top header, sidebar, endpoint banner, and request list containers in `.glass-panel` cards.
  - Replace emojis with inline SVG Lucide icons.
- [ ] **Step 3: Component Styling & Method Color Coding**
  - Apply method border accents for GET, POST, PUT, PATCH, DELETE.
  - Refactor channel buttons and search input fields to glass style.
- [ ] **Step 4: Interactive States & Dropdowns**
  - Implement backdrop blur popovers for Advanced Filters and `...` log action menus.
  - Implement smooth expand/collapse transitions for request detail drawers.
- [ ] **Step 5: Enhanced Features Rollout**
  - Add "Send Test Webhook" trigger to empty state views.
  - Integrate cURL generator into log item action menus.
  - Wire up keyboard shortcuts (`⌘K`, `J/K`, `Esc`).
- [ ] **Step 6: Accessibility & Final Review**
  - Confirm WCAG AA contrast for text and status indicators in both themes.
  - Ensure focus rings appear on keyboard `Tab` navigation.