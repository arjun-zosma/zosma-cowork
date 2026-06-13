# Zosma Cowork — Design Guidelines

The single source of truth for how Zosma Cowork **looks, feels, and moves.**
Every screen — chat, sidebar, composer, settings — must read as one coherent,
first‑class product. When in doubt, reuse what's here; don't invent a new
system.

> **Tokens & utilities live in [`src/App.css`](../src/App.css).** That file is
> the canonical implementation; this document explains the intent and the rules.
> If they ever disagree, fix the code _and_ this doc in the same PR.

---

## 1. Design principles

1. **Elevated blue‑glass over a living aurora.** Surfaces are translucent,
   blurred glass panels that visibly _float_ over a soft, animated brand‑blue
   aurora backdrop. Nothing is a flat opaque sheet.
2. **One language everywhere.** Chat, sidebar, composer and settings share the
   same surfaces, radii, brand wash, motion and focus treatment. A new screen
   should feel like it was always there.
3. **Brand‑blue is the accent, not the wallpaper.** Use `--brand` for accents,
   focus, active states and gradients — never as a full-bleed background.
4. **Curvy, soft, deep.** Generous corner radii, layered soft shadows and a 1px
   inset top highlight so cards read as hanging _above_ the backdrop.
5. **Calm, purposeful motion.** Content animates in like a polished dashboard;
   transitions are quick, eased, and always respect reduced‑motion.
6. **Accessible by default.** Legible contrast, visible focus rings, honors
   light / dark / explicit `data-theme`, and `prefers-reduced-motion`.

---

## 2. Brand & tokens

All colors are HSL channel triplets consumed as `hsl(var(--token) / <alpha>)`,
mapped to Tailwind utilities via `@theme` in `App.css`. **Never hard‑code hex.**

| Token | Value (light) | Use |
|-------|---------------|-----|
| `--brand` | `210 99% 48%` (#017cf3) | Primary brand blue — accents, gradients |
| `--brand-2` | `217 100% 59%` | Gradient / secondary brand blue |
| `--primary` / `--ring` | `210 99% 48%` | Buttons, active states, focus rings |
| `--foreground` / `--muted-foreground` | text | Primary / secondary text |
| `--border` | hairline | Non‑elevated dividers |

**Elevation tokens** (drive the glass system, per‑theme):

| Token | Purpose |
|-------|---------|
| `--elev-bg` | Glass fill base color |
| `--elev-border` | Glass hairline border |
| `--elev-highlight` | Inset top highlight |
| `--elev-shadow` | Drop‑shadow color |
| `--elev-glass-blur` | Backdrop blur radius (14–16px) |
| `--elev-glass-alpha` | Glass opacity (0.6–0.72) |
| `--aurora-1/2`, `--aurora-alpha` | Backdrop aurora |

**Typography:** `--font-sans` is **Chakra Petch** (display/UI); **Space Grotesk**
is the accent/mono companion. Loaded in `index.html`, applied on `body`.

**Radii:** `--radius: 0.9rem`; `--radius-xl = radius+4px`; `--radius-2xl =
radius+10px`. Cards use `xl`, floating panels use `2xl`. Don't use sharp corners
on elevated surfaces.

---

## 3. Surfaces — the glass utility set

Reuse these classes. Each is defined once in `App.css`. **Do not** rebuild a
card out of raw `border + bg-card`.

| Class | What it is | Use it for |
|-------|------------|-----------|
| `panel-sidebar` | Rounded floating glass panel + brand wash + inset highlight | The left nav rail (home **and** settings) |
| `panel-raised` | Rounded floating glass content panel | Main content area / settings content |
| `glass` | Lighter glass card: blur, brand wash, soft shadow, inset highlight | Section cards, info boxes, tiles |
| `composer-glass` | Brand‑tinted slab with focus glow | The message composer |
| `chat-bubble(-user/-assistant)` | Elevated message slabs | Chat messages |
| `settings-rail(-right/-bottom)` | Glass rail variant for mobile chrome bars | Settings mobile top bar / tab strip |
| `brand-gradient` / `brand-gradient-text` | Brand blue → blue‑2 gradient (fill / clipped text) | Accents, emphasized headings |

**Layout pattern (the app shell):** two floating panels — `panel-sidebar` (rail)
+ `panel-raised` (content) — separated by `md:gap-2.5`, inside a
`md:p-2.5` shell, hovering over the `body::before` aurora. Settings mirrors this
exact structure; it is not a separate visual world.

---

## 4. Motion

- **Easing:** `easeOutExpo` → `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Durations:** micro‑interactions `0.12–0.18s`; view/section transitions
  `~0.2–0.26s`.
- **Section changes** animate in with a subtle `opacity + x + scale(0.985→1)`
  (keyed on the active section) — a calm "dashboard" reveal.
- **Active nav pill** uses a shared `layoutId` so it glides between items.
- **Always** branch on `useReducedMotion()` (or `@media (prefers-reduced-motion)`)
  and fall back to opacity‑only or no motion.

---

## 5. Controls

- **Focus:** visible brand ring — `focus-visible:ring-2 focus-visible:ring-ring`
  (mirrors `composer-glass:focus-within`). Never remove focus outlines without a
  replacement.
- **Active / selected:** brand‑tinted, e.g. `border-primary/25 bg-primary/12`
  with `text-primary` icon — _not_ a flat `bg-accent` block.
- **Primary buttons:** `bg-primary text-primary-foreground`, rounded `lg/xl`,
  `hover:brightness-110`, `active:scale-[0.98]`. Size primary actions generously
  and right‑align them in a form/editor footer.
- **Inputs / editors:** transparent over glass where possible so the surface
  shows through; brand focus ring.

---

## 6. Theming

Light (default), dark (`data-theme` / system) and explicit `data-theme`
overrides are all driven by the **same token names** redefined per theme in
`App.css`. Build with tokens and your component themes itself for free. Test in
light **and** dark before opening a PR.

---

## 7. Do / Don't

✅ **Do**
- Reuse `panel-sidebar` / `panel-raised` / `glass` for any new surface.
- Drive every color from a token via a Tailwind utility.
- Add a regression guard when you add/upgrade a surface (see §8).
- Respect reduced motion and both color modes.

🚫 **Don't**
- Paint opaque `bg-background` / `bg-card` over an elevated context (it kills the
  glass and the aurora behind it).
- Build flat `border border-border` boxes where a `glass` card belongs.
- Use inline `style={{ background: "hsl(var(--token))" }}` for static colors —
  prefer utilities (the `lint:styles` guardrail ratchets these **down**).
- Introduce new accent colors or fonts. Extend the tokens instead.
- Hard‑code hex colors or pixel radii that bypass the token scale.

---

## 8. Code & engineering standards

Design quality is enforced in code, not vibes:

- **Token‑style guardrail:** `npm run lint:styles` — inline `hsl(var(--token))`
  usage may only decrease. Regenerate the baseline with
  `npm run lint:styles -- --update` when you migrate styles to utilities.
- **Theme regression guards (TDD):** design changes ship with file‑content
  guards that assert the system stays consistent. See
  [`src/test/theme-consistency.test.ts`](../src/test/theme-consistency.test.ts)
  and [`src/test/settings-theme.test.ts`](../src/test/settings-theme.test.ts).
  Write the guard first, watch it fail, then implement.
- **Formatting & types:** `npm run format` (Biome), `npm run typecheck`.
- **One command:** `npm run validate` runs lint + styles + typecheck + tests.
- **Tauri note:** the full UI only boots via `npm run dev` (the Rust sidecar
  backs initialization); `npm run dev:frontend` in a plain browser stops at the
  splash.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the full workflow.

---

_When you add to the design system, update this file in the same PR. A living
guideline is the difference between a product and a pile of screens._
