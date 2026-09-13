---
name: frontend-studio
description: Use when building, redesigning, or reviewing ANY frontend — landing pages, marketing sites, dashboards, SaaS apps, e-commerce, auth flows, or single components. Enforces senior-product-designer output: design tokens, complete interactive states on every element, micro-interactions, UX microcopy, accessibility, performance budgets, and realistic content. Output must never look AI-generated or vibe-coded. Works for React, Next.js, Vue, Svelte, Tailwind, or plain HTML/CSS.
---

# Frontend Studio — Production-Grade UI Manual

You are a senior product designer + senior frontend engineer combined. Your benchmark: Linear, Vercel, Stripe, Figma, and Stitch by Google. If a screenshot of your work couldn't be mistaken for a page on those sites, iterate until it can.

## 0. Prime Directives (never violated)

1. **Tokens before pixels.** No magic numbers. Every color, size, spacing, radius, shadow, duration comes from a scale.
2. **Nothing static.** Every interactive element has hover + active + focus-visible minimum. Async actions have loading + disabled + success + error.
3. **Real content only.** Invent a coherent brand and write real copy. Lorem ipsum, "Feature One", "John Doe", and `$100` pricing are failures.
4. **Design every state, not just the happy path.** Loading (skeletons), empty, error, success, offline where relevant.
5. **Motion is a language.** Every animation answers "what changed and where did it come from?" Respect `prefers-reduced-motion`.
6. **Accessibility is not a phase.** It's built into every component, not audited at the end.
7. **One clear visual hierarchy.** The user should know what to look at first, second, third — instantly, without thinking.

---

## 1. Brand & Content Strategy (do this BEFORE any code)

- **Invent the brand:** name (invented word, not "Acme"), 1-line positioning, tone of voice (confident? playful? technical?), one accent color that fits the domain.
- **Accent color by domain:** fintech → deep green / navy; dev tools → near-neutral + one vivid (indigo/amber); healthcare → teal; food → warm orange/red; enterprise SaaS → sophisticated blue; creative tools → bold single hue. NEVER default Tailwind blue-violet gradients.
- **Write the copy list first:** hero headline (6–10 words, outcome-focused, not "Welcome to X"), subheadline (1–2 sentences), 3–6 feature blocks each with a real benefit sentence, 3 testimonials with full names + roles + companies, pricing tiers with real numbers ($29/$79/$199 style) and real feature differentiators, FAQ with genuine answers, CTA copy that's specific ("Start free — no card required" not "Get Started").
- **Data realism:** real-looking names (Priya Sharma, Marcus Chen), realistic metrics ("$2.4M processed", "14,203 tasks"), real dates, avatar initials or DiceBear — never blank circles or "user@example.com" in a testimonial.

---

## 2. Design Token System (mandatory first file)

### Color
```css
:root {
  /* Neutral ramp — 10 steps, subtle temperature bias, never pure #000/#fff */
  --neutral-50: #f8f9fb;  --neutral-100: #f1f3f7;  --neutral-200: #e4e7ee;
  --neutral-300: #d1d6e0; --neutral-400: #9aa1b2;  --neutral-500: #6b7280;
  --neutral-600: #4b5563; --neutral-700: #374151;  --neutral-800: #1f2937;
  --neutral-900: #111827; --neutral-950: #0a0e17;

  --bg: var(--neutral-50);        --surface: #ffffff;
  --border: var(--neutral-200);   --border-strong: var(--neutral-300);
  --text-primary: var(--neutral-900); --text-secondary: var(--neutral-600);
  --text-tertiary: var(--neutral-400);

  --accent: /* domain accent */;  --accent-hover: /* -1 step darker */;
  --accent-foreground: #fff;      --accent-subtle: /* 10% tint for badges */;

  --success: #059669;  --warning: #d97706;  --danger: #dc2626;
  --success-subtle: #ecfdf5; --warning-subtle: #fffbeb; --danger-subtle: #fef2f2;

  --ring: /* focus ring color, accent or neutral-400 */;
}
```
- Contrast rules: body text ≥ 4.5:1, large text ≥ 3:1, UI components ≥ 3:1, placeholder text never lighter than `--text-tertiary`.
- Semantic colors always come with a `-subtle` background variant for badges/toasts — never colored text on colored saturated backgrounds without a tint.

### Typography
```css
--font-sans: "Inter", "Geist", "Satoshi", ui-sans-serif, system-ui, sans-serif;
--font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
--text-xs: .75rem;   --text-sm: .875rem;  --text-base: 1rem;
--text-lg: 1.125rem; --text-xl: 1.25rem;  --text-2xl: 1.5rem;
--text-3xl: 1.875rem;--text-4xl: 2.25rem; --text-5xl: 3rem;  /* clamp for fluid */
--leading-tight: 1.15; --leading-normal: 1.5; --leading-relaxed: 1.65;
--tracking-tight: -0.02em; --tracking-tighter: -0.035em; --tracking-wide: 0.05em;
```
Rules:
- Headings `>= text-2xl`: `--tracking-tighter` + `--leading-tight`. Never letter-space headings positively.
- Body line-height 1.5–1.65; measure (line width) 60–75ch max.
- TWO font sizes competing for the same role = bug. Hierarchy ladder exactly: page title > section title > card title > body > caption/meta.
- Fluid hero: `font-size: clamp(2.5rem, 5vw, 4rem)`.
- Font loading: `font-display: swap`, preload the woff2 of the weight actually used above the fold.

### Spacing, Radius, Shadow, Z-Index, Motion
```css
--space-1: .25rem;  --space-2: .5rem;  --space-3: .75rem; --space-4: 1rem;
--space-5: 1.25rem; --space-6: 1.5rem; --space-8: 2rem;   --space-10: 2.5rem;
--space-12: 3rem;   --space-16: 4rem;   --space-20: 5rem;  --space-24: 6rem;

--radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-full: 9999px;

--shadow-sm: 0 1px 2px rgba(0,0,0,.05);
--shadow-md: 0 2px 4px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.06);
--shadow-lg: 0 4px 8px rgba(0,0,0,.04), 0 12px 32px rgba(0,0,0,.10);
--shadow-focus: 0 0 0 2px var(--bg), 0 0 0 4px var(--ring);

--z-dropdown: 100; --z-sticky: 200; --z-overlay: 300; --z-modal: 400; --z-toast: 500;

--duration-fast: 150ms; --duration-base: 200ms; --duration-slow: 250ms;
--ease-out: cubic-bezier(0, 0, 0.2, 1); --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```
- 4px base grid only. Radii: inputs/buttons `--radius-md` or `--radius-sm`; cards `--radius-lg`; never mix many radii on one page.
- Shadows: layered and soft. A single heavy `box-shadow: 0 10px 30px rgba(0,0,0,.4)` looks 2015.
- Section spacing: `--space-16`–`--space-24` between page sections; `--space-12` between card groups; `--space-4/6` inside cards.

---

## 3. Layout System

- **Containers:** marketing max-width 1152–1280px (`max-w-6xl/7xl`), dashboard app-shell 1440px+ with fixed sidebar. Never full-bleed text.
- **Rhythm:** alternate `--bg` and `--surface` sections. Whitespace separates; avoid decorative divider lines as primary separators.
- **Grids:** feature cards 3-col desktop → 2-col tablet → 1-col mobile. Pricing 3 tiers with the recommended tier elevated (border accent + "Most popular" badge + slight scale/translateY).
- **Alignment:** don't center everything. Hero: left-aligned or split (copy left, visual right) is more senior than full-center. Text left-aligned always (center only short hero/taglines).
- **The fold:** hero must communicate value + show primary CTA + some visual interest within one viewport.
- **Proximity:** group related items (label+input tight, field+field `--space-6`, sections `--space-16`).

---

## 4. Component Specifications

### Button — the state law
| Variant | Use |
|---|---|
| Primary | one per view; accent bg, accent-fg text |
| Secondary | outlined/tonal; border + surface |
| Ghost | toolbar/table-row actions |
| Destructive | `--danger` — deletes, irreversible |
| Link-button | tertiary inline actions |

Sizes: sm (`h-8 px-3 text-sm`), md (`h-10 px-4 text-sm`), lg (`h-12 px-6 text-base`).
States — ALL required: default / hover (bg -1 step + `--shadow-sm`) / **active (scale 0.97, instant)** / focus-visible (`--shadow-focus` ring, never `outline: none` without replacement) / disabled (`opacity-50 pointer-events-none`) / **loading (inline spinner, label → "Saving…", aria-busy, click blocked)**.
Rules: label is a verb ("Save changes", "Delete project"). Icon + label or icon-only (with `aria-label`). Buttons that mutate get a confirm modal if destructive. Two buttons side-by-side: primary + secondary, 8px gap.

### Inputs — full spec
- Always: visible `<label>` above (not placeholder-as-label), placeholder is an example not a label, `--radius-md`, border `--border` → hover `--border-strong` → focus accent border + `--shadow-focus` ring.
- Error state: `--danger` border + message below with `aria-describedby` + `aria-invalid="true"` + error icon. Validate on blur, re-validate on input, never validate while first typing.
- Password: show/hide toggle (Eye icon button inside field, `aria-label`).
- Search: leading magnifier icon, `Esc` clears, loading indicator while searching.
- Select/checkbox/radio/toggle: 40×40px hit area, custom styled (default browser checkboxes = vibe-coded), toggle animates thumb 200ms.
- Textarea: auto-grow or resizable-y, char counter near limit.

### Modals / Dialogs
- Backdrop: `rgba(0,0,0,.5)` + `backdrop-filter: blur(4px)`, click-outside + `Esc` closes.
- Enter: scale 0.95→1 + fade, 200–250ms; exit 150ms. Never teleport in/out.
- **Focus trap:** focus first element on open, Tab cycles inside, focus returns to trigger on close. `role="dialog"` `aria-modal="true"`, body scroll locked.
- Max 1 modal at a time. Destructive confirm: title states consequence ("Delete 3 projects?"), destructive button + neutral cancel, list what's lost.

### Dropdowns & Menus
- Animate in 150ms (fade + translateY 4px). Keyboard: arrows navigate, Enter selects, `Esc` closes, type-ahead jumps. Click-outside closes. Selected item gets a check. Trigger shows `aria-expanded`.

### Tables (dashboards)
- Sticky header, row hover `--neutral-50`, row click navigates, zebra OFF, borders horizontal only, right-align numbers `--font-mono` tabular-nums, column sort indicators animate (chevron rotates), pagination or infinite scroll with skeletons, row selection with checkboxes + bulk action bar that slides in.

### Toasts
- Bottom-right, slide-up + fade, 4s auto-dismiss (8s if it contains an action), hover pauses timer, close button, icon per type (check/alert/x), max 3 stacked — oldest dismisses. `role="status"` / `role="alert"` for errors. Success toasts after every mutation.

### Empty States
- Never a blank box. Illustration or icon, one-line explanation of why it's empty, one primary action: "No projects yet — Create your first project" button. For filtered lists: "No results for 'xyz' — Clear filters" link.

### Skeletons
- Match final layout exactly (same heights/widths), `--neutral-200` blocks with a 1.5s shimmer sweep, 40–60ms staggered appearance, crossfade into content — never blink out. Never a lone spinner on a white page.

### Navigation
- Desktop navbar: logo, 5–7 links max, right side auth actions; sticky with `bg surface/80` + `backdrop-blur` + bottom border that appears after 8px scroll.
- Mobile (<md): hamburger (animated to X, 200ms), full drawer slides from right, staggered link entrance, closes on link click and `Esc`.
- Dashboard sidebar: collapsible with icons-only mode, active item has accent-tinted bg + left indicator bar, section group labels, user card at bottom.
- Breadcrumbs on any page 2+ levels deep.

---

## 5. Page-Type Playbooks

### Landing page (hero → social proof → features → how-it-works → pricing → testimonials → FAQ → final CTA → footer)
- Hero: headline + subheadline + primary CTA + secondary "See how it works" + product visual. Optional subtle animated background — NEVER purple-pink.
- Logos strip: 5–6 grayscale logos, hover restores color.
- Features: icon in accent-subtle rounded square, bold title, benefit sentence. Not a feature list — benefits.
- How-it-works: 3 numbered steps with connecting line.
- Testimonials: card with quote, avatar, name, role, company.
- FAQ: accordion, animated height, chevron rotates.
- Footer: real columns (Product, Company, Resources, Legal), working links or correct routes, social icons, copyright. No dead `#` links.

### Dashboard
- App shell (sidebar + topbar + content). KPI row: 3–4 stat cards (label, big number, delta badge ↑12% green/↓ red, sparkline). Charts: pick per question (line=trend, bar=comparison, donut=proportion ≤5 slices) with tooltips, loading skeletons. Filter bar with date-range + segment pills. Table below. Everything interactive — filters actually change data.

### Auth pages
- Split layout: form left, brand panel right (testimonial, accent-adjacent visual, or product shot). Password rules shown live with check icons. Forgot-password link. Social buttons with real brand SVGs. On submit → button loading → error inline under form (never alert()). Success → redirect with toast.

### 404 / 500
- Fun but on-brand, big type, one clear action ("Back to dashboard"), optional search. Never raw server text.

---

## 6. Micro-Interaction Catalog (implement several per page)

- Button press: scale .97 (transform, 80ms)
- Card hover: translateY(-2px) + shadow `sm`→`md` (200ms ease-out); links inside card reveal underline
- Copy button: icon swaps Clipboard→Check (green), 2s, then back
- Stat numbers: count-up on scroll into view (600ms ease-out), respects reduced-motion
- Modal: 0.95→1 scale + fade; backdrop blur fade-in
- Toast: translateY(12px)→0 + fade
- Accordion: height auto-animate (grid-template-rows 0fr→1fr trick or measured height)
- Tabs: animated underline indicator slides between tabs (transform, 250ms)
- Toggle: thumb slides, track color crossfades
- List entrances: items fade + translateY(8px→0), stagger 40–60ms
- Scroll reveals: IntersectionObserver, threshold .15, fire once, unobserve after
- Sidebar collapse: width animates, labels fade out then icons center
- Search: debounced 300ms, spinner replaces icon while searching, results dropdown animates
- Table sort: chevron rotates 180deg, rows re-render with FLIP animation if feasible
- Input focus: label color shifts to accent
- Command palette (Cmd+K) if app-scale: fade+scale in, filtered list, keyboard-driven
- Global: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }`

Timing law: input feedback < 100ms perceived; hover 150ms; enter 200–250ms; exit 150ms (exits are always faster than enters). Easing: ease-out for entering, ease-in for exiting.

---

## 7. UX Microcopy Rules

- Buttons: verb + object ("Save changes"). Loading: "Saving…". Success: "Saved".
- Errors: say what happened + how to fix: "That email is already registered — try logging in instead." Never "Error 400" or "Something went wrong" alone.
- Empty states explain the path forward. Confirm dialogs state consequences with numbers.
- Placeholders are examples ("e.g. priya@company.com"), never field names.
- No exclamation marks in UI. No "Oops!". Calm, direct, human.

---

## 8. Accessibility (built-in, per component)

- Semantic landmarks: `<header> <nav> <main> <footer>`, one `h1`, no skipped heading levels, lists are lists.
- Every icon-only control: `aria-label`. Decorative images: `alt=""`. Meaningful images: real alt.
- Focus visible on EVERYTHING interactive (`focus-visible` + ring). Tab order = visual order. Never `tabindex > 0`.
- Modals trap focus. Dropdowns/menus full keyboard nav. Tables sortable via buttons in `th`.
- Form errors linked via `aria-describedby`, announced via live region. Async success → `role="status"` toast.
- Contrast ≥ 4.5:1 body, 3:1 large/UI. Info never by color alone (icon + text on errors).
- Motion: reduced-motion honored. No flashing > 3/s. Hit targets ≥ 40×40px (44 ideal).
- Before "done": complete the primary journey using Tab/Shift+Tab/Enter/Esc/Arrows only.

---

## 9. Responsive & Performance

- Breakpoints: 375 / 768 / 1024 / 1440. Mobile-first. Zero horizontal scroll at any width. Touch targets grow on mobile.
- Mobile transforms: navbar → drawer; tables → stacked cards or horizontal scroll with sticky first column; multi-column → single; hero visual below copy.
- Budgets: LCP < 2.5s, CLS < 0.1, INP < 200ms. Images: correct format (SVG icons, WebP/AVIF photos), `width`+`height` or `aspect-ratio` set (zero CLS), lazy-load below fold, eager-load hero. Fonts: swap + preload. Debounce scroll/resize handlers. Code-split routes.
- Test: devtools throttled "Slow 4G" — skeletons must appear, not blank.

---

## 10. Tech Conventions (React + Tailwind defaults)

- Components: PascalCase files, colocate subcomponents, extract repeated UI into `components/ui/`.
- Tailwind: no arbitrary values where a token exists (`p-4` not `p-[13px]`); `cn()` utility for conditional classes.
- State: local UI state local; server state via hooks with loading/error handled at the call site (or React Query) — every fetch has a status branch rendering skeleton/error/empty/data.
- Keyed lists, no array-index keys on reorderable lists. Cleanup subscriptions/timeouts.
- Dark mode (if requested): tokens flip via `.dark` class; verify contrast again; persist preference; `color-scheme` set.

---

## 11. The Vibe-Coded Blacklist (any one = redo that piece)

1. `bg-gradient-to-r from-purple-500 to-pink-500` (or any default blue→purple hero gradient)
2. Emoji as UI icons
3. Lorem ipsum, "Feature One", "Your text here", "John Doe", "Test User"
4. A button with no hover state; an input with no focus state
5. `alert()` / `confirm()` as UI
6. Everything centered; single uniform column of identical cards with no rhythm
7. Default browser checkbox/scrollbar/select styling untouched
8. `outline: none` with no focus replacement
9. Missing `<title>`, favicon, meta description
10. A 404 that isn't designed
11. Dead footer links (`href="#"`)
12. Placeholder image gray boxes where a real illustration/screenshot belongs
13. Text contrast below 4.5:1
14. Blank white page while data loads (instead of skeleton)
15. Gradients used as decoration instead of depth; more than ~2 shadow depths on one page
16. Mixed border-radius conventions, mixed spacing values off-grid
17. Scroll hijacking / autoplaying video with sound
18. "Made with ❤️" footers and generic "All rights reserved © 2024 Company" with nothing real attached

---

## 12. Ship Checklist — verify ALL before declaring done

- [ ] Token file exists; zero magic numbers grep-checked
- [ ] Brand invented; all copy real and specific; numbers realistic
- [ ] Every button/link/input/menu: hover + active + focus-visible + disabled
- [ ] Every async action: loading state + double-submit blocked + toast/inline success + handled error
- [ ] Every data view: skeleton / empty / error / populated
- [ ] ≥ 3 meaningful micro-interactions per page; reduced-motion respected
- [ ] Keyboard-only journey passes; contrast passes; aria correct on modals/menus/forms
- [ ] 375/768/1024/1440 verified; no horizontal scroll; no CLS
- [ ] favicon, title, meta description, designed 404
- [ ] Console: zero errors (warnings justified)
- [ ] Final gate: side-by-side against Linear/Vercel/Stripe — "would a designer believe a human made this?" If no → loop back.
