# Forja Admin — Design System

Modern minimalist light theme for the bot admin dashboard. This is the
**contract** for every view under `src/admin/views/`. The shell (`layout.ts`)
already loads the fonts, Tailwind config, tokens, lucide, htmx and all the
component classes below. Views only render the **body** — write it to match
this system.

Design read: neutral zinc surfaces + ONE emerald accent (#047857, AA on white),
soft rounded corners (cards 12px, controls 8px, badges full), diffuse shadows,
Inter for UI text. Text colors pass WCAG AA on their surfaces. The old dark
retro-terminal theme AND the intermediate brutalist hard-shadow system are both
retired; token NAMES are unchanged (views reference `text-cream`, `bg-panel`,
etc.), only their values define the theme. Radius scale is locked via
`--r-card` (12px), `--r-ctl` (8px), `--r-pill` (999px).

Stack reminder: no build step. Views are TS template strings → HTML, styled with
**Tailwind CDN utilities** (mapped to the tokens below) and/or inline
`style="…"` using the CSS variables. htmx 2 drives interactivity.

---

## 1. Tokens

Every token exists twice: a **CSS variable** (for `style="…"`) and a **Tailwind
color** (for `class="…"`). Use whichever fits; they resolve to the same hex.

| CSS var | Tailwind | Hex | Use |
|---|---|---|---|
| `--bg` | `bg-bg` | `#fafaf9` | page background (already on `<body>`) |
| `--panel` | `bg-panel` | `#fefefe` | card / panel surface |
| `--panel2` | `bg-panel2` | `#f4f3f1` | nested surface, row hover, inputs-on-panel |
| `--raise` | `bg-raise` | `#eceae6` | raised chips / avatars |
| `--line` | `border-line` | `#e5e3df` | default border / divider |
| `--linelit` | `border-linelit` | `#cfccc6` | lit border, hard-shadow color |
| `--accent` | `text-accent` `bg-accent` `border-accent` | `#047857` | primary accent (emerald, AA on light) |
| `--accent-soft` | `bg-accent-soft` | `rgba(4,120,87,.08)` | accent wash / active bg |
| `--accent-2` | `text-accent2` | `#0f766e` | secondary accent (teal): AI/insights |
| `--cream` | `text-cream` | `#1c1917` | primary text (near-black; name kept for compat) |
| `--muted` | `text-muted` | `#57534e` | secondary text |
| `--dim` | `text-dim` | `#79716b` | tertiary text, labels, captions |
| `--ok` | `text-ok` `border-ok` | `#15803d` | success / green (resolved, online) |
| `--info` | `text-info` `border-info` | `#2563eb` | info / blue (WhatsApp, escalated) |
| `--bad` | `text-bad` `border-bad` | `#b91c1c` | danger / red (angry, handoff, errors) |
| `--violet` | `text-violet` | `#7c3aed` | model/memory accents in the flow canvas |

Buttons on `--accent` use white text (`#ffffff`, ~5:1 on the emerald) —
there is no token for it; write the hex.

Success washes use `rgba(21,128,61,α)` (the `--ok` green) and accent washes
`rgba(4,120,87,α)`. Warning text keeps the amber `#b45309` on purpose
(semantic color, independent of the accent). Don't reintroduce the old dark-theme hexes
(`#f07a3f`, `#7fb77e`, `#1a1206`, `rgba(127,183,126,…)`, …).

Legacy aliases (`--border`, `--border-lit`, `--green`, `--blue`, `--red`) are
still defined so pasted mockup snippets don't break, but **prefer the names in
the table above** in new code.

---

## 2. Typography

- Body / default: **Inter** (already the `<body>` font). Everything is a clean
  sans unless you opt into display or mono.
- Headings / numbers / buttons: **Space Grotesk** → `font-display` (Tailwind) or
  `style="font-family:'Space Grotesk'"`.
- **JetBrains Mono** is still loaded — use it only for IDs, emails and code-ish
  data (`font-mono`), never as body text.

Hierarchy:

| Role | Recipe |
|---|---|
| Page title | shell renders it — **don't repeat it**, see §5 |
| Section heading | `font-display font-semibold text-[15px] text-cream` |
| Big stat number | `font-display font-bold text-[30px] leading-none` (up to `38px` on the overview hero) |
| Body text | `text-[12.5px] text-muted leading-relaxed` |
| Label / caption | `text-[10px] tracking-[.2em] uppercase text-dim` |

---

## 3. Component recipes

Copy these. Sizes are the mockup's; keep them consistent.

### Card / panel
```html
<div class="card bg-panel border border-line p-[18px]"> … </div>
```
`.card` adds the one-shot `rise` entrance animation. Drop it for static panels.

### Primary button (rounded, soft shadow)
```html
<button class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
  style="background:var(--accent);border:1px solid var(--accent);color:#ffffff;padding:10px 18px;display:flex;align-items:center;gap:8px">
  <i data-lucide="check" width="16" height="16"></i> Guardar
</button>
```
`.bigbtn` brings radius (10px), the soft shadow, the hover lift and the active
press (`scale(.98)`). Do NOT add hard `Npx Npx 0` shadows.

### Ghost / secondary button
```html
<button class="ghostbtn text-muted cursor-pointer"
  style="background:var(--panel);border:1px solid var(--line);padding:9px 14px;font-size:12.5px;transition:all .12s ease">…</button>
```

### Chip (filter / small action)
```html
<span class="chip text-muted cursor-pointer"
  style="border:1px solid var(--line);padding:5px 12px;font-size:11px;letter-spacing:.05em">Todas · 32</span>
```

### Pill / badge — variants by color
Same shape, swap the color var. Text = border = the variant color. Radius is
full (pill).
```html
<!-- accent -->  <span style="font-size:10px;color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:1px 8px">Lead</span>
<!-- ok -->      <span style="font-size:10px;color:var(--ok);border:1px solid var(--ok);border-radius:999px;padding:1px 8px">Resuelta</span>
<!-- bad -->     <span style="font-size:10px;color:var(--bad);border:1px solid var(--bad);border-radius:999px;padding:1px 8px">Handoff</span>
```
Solid badge (counts): `background:var(--accent);color:#ffffff;font-weight:700;border-radius:999px;padding:1px 8px`.

### Table / list row
Rows sit inside a `bg-panel border border-line` container, separated by
`border-top:1px solid var(--line)`. Add a hover class for interactivity:
```html
<div class="leadrow" style="display:grid;grid-template-columns:110px 1.1fr 1.1fr 1.6fr 130px;gap:12px;padding:13px 18px;border-top:1px solid var(--line);font-size:12.5px;align-items:center;transition:background .12s ease"> … </div>
```
Hover helpers available: `.leadrow`, `.datarow`, `.kbrow`, `.convrow` (all →
`background:var(--panel2)` on hover). Column-header row: `font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)`.

### Input / textarea / select
```html
<input style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:13px;outline:none">
```
Radius comes free: the shell styles every `input/textarea/select` to
`border-radius:var(--r-ctl)` (8px). Placeholders are auto-styled to `--dim`.
Range inputs are auto-accented (`accent-color:var(--accent)`).

### Stat card (big number)
```html
<div class="bg-panel border border-line rounded-xl p-4">
  <div class="font-display font-bold text-[30px] leading-none">142</div>
  <div class="text-[12px] text-muted mt-1">Conversaciones analizadas</div>
  <div class="text-[11px] text-dim mt-0.5">últimos 7 días</div>
</div>
```
`.bg-panel border border-line` panels should carry `rounded-xl` (12px). Add
`border-l-[3px]` in `--accent`/`--ok`/`--bad` to flag the hero metric. Global
classes `.card`/`.tkcard` already include radius + soft shadow.

### Progress bar
```html
<div style="height:10px;background:var(--panel2);border-radius:99px;overflow:hidden">
  <div style="width:74%;height:100%;background:var(--accent);border-radius:99px"></div>
</div>
```

### Selectable option card (config)
```html
<div class="cfgcard" style="border:1px solid var(--line);background:var(--panel2);padding:14px">…</div>
<!-- selected: border:1px solid var(--accent);background:var(--accent-soft); label + icon in var(--accent) -->
```

### Flow-canvas node
Use `.node` (canvas radiography) or `.node-card` — both get the lift + hard
shadow on hover. Container: `background:var(--panel2);border:1px solid var(--linelit)`.

---

## 4. Global classes provided by the shell

These are defined in `layout.ts` — **do not redefine them**, just use the class:

- Motion / buttons: `.card`, `.bigbtn`, `.ghostbtn`, `.glow`, `.bar` / `.bargrp`
- Rows / interactive: `.convrow` (+`.arr`), `.leadrow`, `.datarow`, `.kbrow`
  (+`.kbedit`), `.tkcard`, `.subtab`, `.chip`, `.cfgcard`, `.navlink`
- Canvas: `.node`, `.node-card`
- Overlays (already wired to existing views): **`.modal-backdrop`**,
  **`.modal-card`**, **`.toast`** — keep using these exact names.
- `.scanlines` is on `<body>` already.
- Keyframes available: `blink`, `pulse`, `ring`, `rise`, `fadeIn`, `popIn`,
  `toastIn`, `toastOut`. All motion collapses under `prefers-reduced-motion`.

Mount points: `#modal-root` (put modal markup here; Escape clears it) and
`#toast-root` (fixed bottom-right, `z-60`).

lucide icons: write `<i data-lucide="name" width="16" height="16"></i>`. The
shell calls `lucide.createIcons()` on load **and after every htmx swap /
oob-swap**, so fragments you return over htmx get their icons drawn — no extra
script needed in the fragment.

---

## 5. Page header — owned by the shell

The shell renders, for every page, a sticky topbar with the **breadcrumb
(`Sección / Tab`) + the page `<h1>` + the "BOT EN LÍNEA" pill**, derived from
`activeTab`. Your view body starts **below** that.

- **Do not render your own top-level page title** (`<h1>`/`<h2>` naming the tab)
  or your own "bot online" indicator — the shell already shows both.
- Start the body with content (filters, stats, the sub-tab strip if the tab has
  sub-views, cards…). Section-level headings inside the body are fine.
- `<main>` already has `padding:22px 26px`. Add vertical rhythm with a flex
  column + gap or margins; don't re-pad the outer edge.

Sidebar nav icons (already in the shell, listed so you don't duplicate them):
`overview` layout-dashboard · `conversations` messages-square · `leads`
user-plus · `tickets` life-buoy · `agente` workflow · `kb` book-open · `mejoras`
sparkles · `config` sliders-horizontal · `insights` scan-eye · `stats`
bar-chart-3 · `costs` receipt.

---

## 6. PROHIBIDO

- ❌ No dark-theme colors: no dark surfaces, no pure `#000`/`#fff` as surfaces,
  no neon glows or glow `text-shadow`s.
- ❌ No brutalist leftovers: no hard offset shadows (`Npx Npx 0`), no sharp
  corners on cards/panels/buttons (use the radius scale), no monospace body
  text. This theme is light, soft and rounded.
- ❌ Don't invent new colors — use the tokens in §1 only.
- ❌ Don't touch htmx attributes (`hx-*`), element `id`s, route paths, or form
  field `name`s. Restyle markup, don't rewire it.
- ❌ Don't change visible text strings / labels (tests and users depend on them):
  keep the Spanish labels, tab names, status strings like `🟢 bot activo`,
  emojis, tool names, etc.
- ❌ Don't redefine the global classes or re-add the page title / online pill
  (§4, §5).
- ❌ Don't add heavy client JS — htmx + the shell's lucide re-init is the model.
- ❌ Don't restyle `layout.ts` (shared shell) — only your view file.
