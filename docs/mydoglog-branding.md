# MyDogLog Design Style Guide

> The health tracking app your dog deserves and your vet respects.

## Positioning

**Tagline:** "Know what works."

MyDogLog is a **health data company** that takes dogs seriously. The design should feel like a well-designed European health device company (Withings, Oura) — precise, confident, and warm — that genuinely cares about canine health outcomes. We borrow from healthtech and clinical data tools, not the pet aisle. The result should feel trustworthy enough for a vet's office and simple enough for the backyard.

---

## Reference Brands (in order of influence)

### 1. Withings (withings.com) -- Primary Anchor

The core aesthetic reference. European clinical credibility with consumer warmth. Key pages to study:

- **Body Scan product page** (`/us/en/body-scan`) -- layout patterns, feature sections, comparison tables, app mockup framing
- **Withings+ page** (`/us/en/landing/withings-plus`) -- feature cards, score displays, subscription tier layout
- **ScanWatch 2 page** (`/us/en/scanwatch-2`) -- hero video, alternating feature sections, spec tables

**What to take from Withings:**
- Clean white website backgrounds with alternating light gray sections
- Small uppercase category labels above bold section headlines
- App screenshots in phone mockup frames (dark UI on light site background)
- Comparison tables with monoline SVG icons per feature row
- Testimonials as simple quote cards (name + product, no photos)
- Feature cards with screenshot + label + short tagline
- Clinical language: "clinically validated", "40+ biomarkers", specific statistics
- Zero illustrations. Everything is photography, product shots, or UI screenshots.
- Moire/abstract geometric patterns as subtle brand texture (optional)

### 2. Oura (ouraring.com) -- App Data Layer

The reference for the in-app data experience. Nordic minimalism, dark mode, progressive disclosure.

**What to take from Oura:**
- Dark mode as the default for the app/dashboard (near-black, not pure black)
- Ring/arc gauge for daily wellness score
- Single headline metric per category, detail on tap
- Semantic color system (green = optimal, amber = attention, red = alert)
- Large bold numbers as the primary design element for scores
- Restraint: one focus per view, generous dark-space around data elements
- Qualitative ratings where appropriate (Low / Moderate / High, not just numbers)
- Oura Labs Meal Tracker specifically: photo-first input, categorical nutrition ratings, 24hr circular clock, non-judgmental language

### 3. Levels (levels.com) -- Food-to-Outcome Correlation

The closest functional analogy (connects food input to health output).

**What to take from Levels:**
- "What you ate" next to "how your body responded" layout
- Biomarker report cards per metric
- Serif headings for editorial/educational content (signals authority)
- Warm earth-tone photography paired with clean data presentation
- Named experts with headshots and credentials for credibility
- Specific outcome statistics ("80% improve out-of-range biomarkers")

### 4. Clue (helloclue.com) -- Destigmatization

Proved that a tracking app for a "taboo" bodily function can feel dignified, scientific, and beautiful.

**What to take from Clue:**
- Treat the subject matter (poop, digestion) with scientific dignity, not humor
- Bold non-obvious color palette (deliberately NOT the expected colors)
- Science-forward brand voice
- Data privacy as a feature
- Geometric visual language, not illustrative

### 5. Eight Sleep (eightsleep.com) -- Clinical Credibility

The reference for how to present clinical/scientific backing.

**What to take from Eight Sleep:**
- Large bold statistical callouts ("Up to 44% improvement")
- Scientific Advisory Board with named experts
- "50+ clinical studies" style credibility messaging
- Persona-based sections showing specific medical understanding
- Before/after comparison frameworks

---

## Color Palette

The palette is **desert sand + oasis sage**. Warm golden cream backgrounds (#F4EDE3) create a luxurious, wellness-forward canvas. Desert sage green (#6B8C6F) is the primary accent — health-forward without being hospital-teal, distinctive and unexpected for a data app. Think sand dunes at golden hour with a sage bush in the foreground.

Inspired by: Aesop, Norm Architects, Dubai quiet luxury interiors, Le Labo.

### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` / `--background` | `#FFFFFF` | Card surfaces, inputs, elevated content |
| `--bg-secondary` / `--secondary` | `#F4EDE3` | Page background, alternating sections (golden cream) |
| `--bg-tertiary` / `--muted` | `#E8DCC8` | Nested surfaces, TabsList, skeletons (warm khaki) |
| `--text-primary` / `--foreground` | `#2E2A27` | Headlines, primary content (warm near-black, never pure #000) |
| `--text-secondary` / `--muted-foreground` | `#6B5D4F` | Supporting text, labels (warm brown) |
| `--text-tertiary` | `#8A7A69` | Category labels, placeholder text (medium taupe) |
| `--accent` / `--primary` | `#6B8C6F` | CTAs, interactive elements, brand sage |
| `--accent-hover` | `#5A7A5E` | Hover state for primary actions |
| `--border` | `#D9CFC3` | Warm dividers, card borders |

> **Implementation note:** The shadcn CSS variables (`--background`, `--primary`, `--secondary`, etc.) are aligned 1:1 with these branding tokens in `globals.css`. Components should use shadcn utility classes (`bg-background`, `text-foreground`, `bg-primary`, etc.) — the custom `bg-bg-primary` / `text-text-primary` aliases work too but prefer the shadcn names for consistency with component internals.
>
> **Key principle:** Never use pure `#000000` for text. Warm near-black (#2E2A27) maintains the desert luxury feel. All neutrals (borders, text, backgrounds) are from the same warm family, creating tone-on-tone depth.

### Dark Mode

Warm dark tones — desert at night, not cold blue-black.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` / `--background` | `#1A1814` | Main background (warm charcoal) |
| `--bg-secondary` / `--card` | `#242019` | Cards, elevated surfaces |
| `--bg-tertiary` / `--muted` | `#2E2A23` | Nested surfaces, input backgrounds |
| `--text-primary` / `--foreground` | `#F0EBE3` | Headlines, primary content (warm off-white) |
| `--text-secondary` | `rgba(240,235,227,0.6)` | Supporting text, labels |
| `--text-tertiary` | `rgba(240,235,227,0.38)` | Placeholder text, disabled states |
| `--accent` / `--primary` | `#8FB896` | CTAs, interactive elements (lighter sage for dark bg) |
| `--accent-hover` | `#A3C9A8` | Hover state |
| `--border` | `rgba(240,235,227,0.12)` | Subtle dividers, card borders |

### Semantic / Data Colors (shared, both modes)

These colors are chosen to work on both sand and dark backgrounds, staying within the warm earth-tone family. No cool blues or neon greens — everything stays grounded.

| Token | Value | Usage |
|-------|-------|-------|
| `--score-excellent` | `#6B8C6F` | Stool 1-2 (ideal range) — sage green, the oasis |
| `--score-good` | `#8FB896` | Stool 3 — lighter sage |
| `--score-fair` | `#D4A944` | Stool 4-5 — warm amber |
| `--score-poor` | `#C97C5D` | Stool 6 — terracotta |
| `--score-critical` | `#B84A3A` | Stool 7 (diarrhea) — adobe red |
| `--exposure` | `#B84A3A` | Accidental exposure markers |
| `--medication` | `#8B7EB8` | Medication period overlays — dusty lavender |
| `--food-period` | `#6B8C6F` | Active feeding period bars — sage |

---

## Typography

One font family. Hierarchy through weight, size, and color only.

**Primary font:** Geist (Vercel's font). Free, clean European geometric feel similar to Withings, excellent for data-dense interfaces on mobile. Loaded via `next/font/local` from the `geist` npm package.

**Monospace (data/code):** Geist Mono. For numerical data displays where tabular alignment matters (correlation tables, score histories).

**Optional editorial font:** A serif (e.g., Newsreader, Source Serif) for blog/educational content only, following Levels' approach. Signals scientific authority. Not needed at launch.

| Element | Size | Weight | Color | Transform |
|---------|------|--------|-------|-----------|
| Category label | 12px | 500 | `--text-tertiary` | uppercase, 0.05em tracking |
| Page title | 32-40px | 700 | `--text-primary` | none |
| Section headline | 24-28px | 600 | `--text-primary` | none |
| Body text | 16px | 400 | `--text-secondary` | none |
| Data metric (large) | 48-64px | 700 | `--text-primary` or semantic color | none |
| Data label | 13px | 500 | `--text-tertiary` | none |
| Button text | 14px | 500 | white on accent | none |

---

## Layout Patterns

### Landing Page (mydoglog.ca -- minimal, one page)

A single page, not a full marketing site. Withings-inspired but brief:

- **Hero:** One headline, one subheadline, one CTA (sign up / log in). Clean, no clutter.
- **3-4 feature cards:** Withings+ style. Screenshot + label + short tagline. Keep it tight:
  - "Track what your dog eats. See what works."
  - "Ingredient-level correlation across every food."
  - "Canadian dog food database, built in."
- **Footer:** Links to sign up, privacy, contact. That's it.

### Dashboard (Primary Interface)

The dashboard is the product. It supports light and dark mode via user toggle.

**Dashboard home:** One daily summary view. Active routine shown as a clean list (product photos, brand). Quick-log buttons that are prominent but not playful (no cartoon icons). Bottom nav `+` button opens entry selector (Daily Check-in / Poop / Treat).

**Data entry — three entry points:**
- **Daily Check-in** — unified form with expandable sections: Routine (food + supplements + meds, pre-filled from template), Stool, Itchiness, Treats. Once a day. Routine section has "Apply going forward" checkbox to update the template.
- **Quick Poop** — 3-second flow: score (7 large tap targets, Purina 1-7, semantic color per score, score 2 highlighted as ideal) + save. Timestamp auto-captured.
- **Quick Treat** — 3-second flow: pick product + save. Timestamp auto-captured.
- If only quick entries are logged on a day, the routine is assumed unchanged.

**Responsive container pattern:** All logging UI uses shadcn Drawer (slide-up) on mobile viewports, Dialog (modal) on tablet/desktop. The content component is shared — only the container wrapper changes by breakpoint.

**Food Scorecard page:** Dedicated page (not a modal) showing all foods organized into three sections: Scored (rated foods with verdict badges), Needs Scoring (fed but unrated), Untracked (products in DB the user hasn't fed). Pull-based — user reviews what's missing on their own schedule.

**Timeline/Reports:** Horizontal time axis. Food periods as colored bars. Stool scores as dots. Medication as a separate row. Minimal chart chrome. Inspired by Oura's sleep timeline and Withings' trend views.

**Food Database:** Card grid. Product photo, name, brand, channel badge. Clean filter chips. Withings-style spec tables for product detail (ingredient list, guaranteed analysis).

---

## Component Patterns

All components use shadcn/ui as the base. Customizations are made in the component files, not via inline styles on consumers. This means the look-and-feel is defined once and inherited everywhere.

**Cards:** White (`bg-card`) on the warm page background. `rounded-lg` (8px). Subtle `shadow-sm`. 24px internal padding via `px-6`. Clean and elevated.

**Buttons:** Default h-11 (44px — mobile-friendly tap target). `rounded-lg` (8px). Primary variant = sage fill + white text. Outline variant = white bg + border, subtle hover. No pill shapes, no gradients.

**Score displays:** Large number centered, semantic color applied to the number. Small label underneath in muted-foreground. Like Withings' Health Improvement Score.

**Data tables:** Withings comparison grid style. Monoline icons per row. Clean horizontal rules. No zebra striping. Generous vertical spacing.

**Form inputs:** h-11 (44px), `bg-background` (white), `rounded-lg` (8px), clean borders. SelectTrigger matches Input height. All defaults — no need to add className overrides for standard sizing.

**Toggles/ToggleGroup:** Selected state = `bg-primary text-primary-foreground` (sage). Hover = `bg-secondary` (subtle). Used for enum pickers, mode selectors.

**Badges/Tags:** Small, muted. `rounded-full`. Secondary variant for quantities, outline variant for labels.

---

## Responsive Strategy

**Mobile and desktop are equally important.** Most logging happens on mobile exclusively (kitchen, backyard, on the go). Data review and catching up happens on both mobile and desktop.

Design mobile-first, then expand for desktop:

- **Logging flows:** Optimized for one-handed mobile use. Large tap targets (44px+), minimal scrolling per step, one action per screen.
- **Dashboard home:** Single-column on mobile, two-column grid on desktop. The daily summary should feel complete on a phone without horizontal scrolling.
- **Timeline/Reports:** Horizontal scrolling timeline on mobile, full-width on desktop. Charts should be touch-interactive (pinch, pan) on mobile.
- **Food Database:** Single-column card list on mobile, 2-3 column grid on desktop. Filter chips scroll horizontally on mobile.
- **Breakpoints:** 640px (sm), 768px (md), 1024px (lg). No design decisions that only work above 1024px.

---

## Photography & Visual Style

- **No illustrations.** Everything is photography, product shots, or UI screenshots.
- **No emoji or icon-heavy interfaces** in the data layer.
- **Lifestyle photography** (if used on landing page): Warm, natural light. Real dogs in real settings. Diverse breeds. Not overly styled or Instagram-aesthetic.
- **App screenshots:** Always in phone mockup frames on the landing page. Dark UI shown against light backgrounds.
- **Icons:** Monoline SVG, consistent stroke weight (1.5-2px). Used sparingly for navigation and category indicators. Not decorative.

### Product Image Framing

Product images are scraped from Canadian retailers and will vary in quality, background color, and aspect ratio. The goal is to present them cohesively without requiring manual cleanup.

**Grid cards (food database, active foods list):**
- Fixed `aspect-ratio: 1/1` container with `--bg-tertiary` background
- `object-fit: contain` so the full package is always visible (bags, cans, pouches are all different shapes)
- 12px internal padding to keep images off container edges
- `mix-blend-mode: multiply` to blend away white/off-white image backgrounds into the container
- 12px border radius on the container

**List thumbnails (food log entries, search results):**
- 48-64px square, 8px border radius
- `object-fit: cover` with center crop (image is supplementary to text here)
- `--bg-tertiary` background

**Missing image fallback hierarchy:**
1. Scraped product image (if URL resolves and image is reasonable quality)
2. Brand/manufacturer logo if available
3. Category silhouette placeholder (bag, can, or treat shape) at 30% opacity on `--bg-tertiary`

Never show a broken image icon or empty space.

---

## Voice & Tone

**Scientific confidence with genuine warmth.** We take the subject matter seriously because the people using this app are dealing with a real problem — a sick or uncomfortable dog they love. We respect that.

**Core vocabulary:** "correlation", "transition period", "baseline", "feeding period", "stool quality", "digestive health"
**Avoid:** "fur baby", "pawsome", "good boy/girl", gamification language

**How we talk about data:**
- Specific and concrete: "Stool quality averaged 4.2 during chicken-based foods" not "things were rough with chicken"
- Confident but not prescriptive: "Consider" and "you could try" not "you should" (Oura's approach)
- Genuinely encouraging when things improve: "Stool consistency improved 40% since switching" — celebrate progress without being cheesy

**Personality notes:**
- We can be direct and concise — this isn't a cold app, it's a focused one
- A little dry wit is OK in empty states and onboarding ("No logs yet. Your dog is out there making data right now.")
- We never make fun of the subject matter, but we don't treat it like a funeral either
- Copy should feel like it was written by a smart friend who happens to know a lot about canine nutrition

---

## Design Guardrails

We achieve warmth through **confidence and clarity**, not decoration:

- **Earned delight only** — celebrate real milestones (30-day streak of consistent stool, successful food transition) with a well-timed message, not confetti
- **Photography over illustration** — real dogs, real food, real data. The subject matter is interesting enough
- **The brand color does the heavy lifting** — sage accents on warm surfaces create the personality. We don't need paw prints
- **Data is the decoration** — a well-formatted score, a clean trend line, a crisp correlation table. These ARE the visual interest
- **Both modes, equal citizens** — light mode default, dark mode supported via user toggle. Both are designed, not afterthoughts

---

## Oura Meals Feature: Specific Patterns to Adopt

Oura's meal tracker (graduated from Labs in May 2025, built on their Veri acquisition) is the closest UX precedent for MyDogLog's food logging:

- **Photo-first input.** Snap a photo of the dog food bag, AI reads it. Text input as fallback. Not database searching as the primary flow (though MyDogLog's scraped DB is the backend, the UX should feel effortless).
- **Categorical ratings over numbers.** Oura rates nutrients as Low/Moderate/High, not grams. MyDogLog's food scorecard already does this (gas: none/mild/bad/terrible). Lean into this pattern everywhere.
- **Non-judgmental feedback.** "Consider" not "you should." Meals rated on a spectrum from "limited" to "nutritious," not "good" to "bad."
- **Integration with other data.** Food sits on a timeline alongside sleep, activity, and other health metrics. MyDogLog should show food alongside stool, symptoms, medications, and pollen.
- **Sparse, opt-in detail.** Top-level view is simple. Tap to expand. Never show everything at once.

---

## Motion & Animation

Animation should feel clinical and precise, not playful. Think Oura's measured reveals, not Duolingo's bouncing.

### Library: Framer Motion

Oura's production site runs Framer Motion on the same stack (Next.js App Router + Tailwind). It's the natural fit. Tree-shakeable, first-class Next.js support, declarative API that composes cleanly with shadcn/ui components.

Use `LazyMotion` + `domAnimation` features to keep the bundle lean (~5KB for basic animations, ~32KB full).

### Animation Patterns

**Scroll reveals (page sections, cards entering viewport):**
Oura's signature: fade in + blur clear + slide up. Trigger once on scroll into view.
- `initial`: opacity 0, blur 5px, translateY 25px
- `animate`: opacity 1, blur 0, translateY 0
- Duration: 0.8-1s, tween easing
- `viewport: { once: true }` so elements don't re-animate on scroll back
- Stagger children by 0.15-0.25s increments for sequential content

**Score/metric animations:**
- Numbers count up from 0 to final value on first appearance
- Score ring/arc fills clockwise over 0.8-1s
- Semantic color fades in as the number lands

**Micro-interactions (hover, tap, state changes):**
- Duration: 0.15-0.2s, ease-out
- Buttons: subtle scale (0.97) on tap, background color transition on hover
- Cards: faint lift on hover (translateY -2px + shadow increase)
- Toggle/switch: smooth slide with spring physics
- Use `whileHover` and `whileTap` props, not CSS hover states, for anything beyond color changes

**Page/view transitions:**
- Content fades in on route change (opacity 0 to 1, 0.3s)
- No sliding page transitions. Keep it calm.
- `AnimatePresence` for exit animations where needed

**Chart animations:**
- Lines draw left-to-right on first render
- Bars grow upward from baseline
- Timeline dots appear with a small scale-in (0 to 1, 0.2s)
- Minimal: only animate on first load, not on every data update

### What NOT to animate

- No bounce or elastic easing on data elements
- No confetti, sparkles, or celebration animations
- No skeleton loading shimmers (use simple opacity pulse if needed)
- No parallax scrolling
- No continuous/looping animations except loading indicators
- Respect `prefers-reduced-motion`: check `useReducedMotion()` from Framer Motion and fall back to instant transitions

### SSR Fallback

Follow Oura's pattern: set a CSS class that forces `opacity: 1; transform: none; filter: none` on motion elements, removed after hydration. Content should be visible even if JS hasn't loaded.

---

## Implementation Notes

- **Framework:** Next.js with Tailwind CSS (via shadcn/ui). Define these tokens as CSS custom properties and Tailwind theme extensions.
- **Icons:** Lucide (monoline, consistent, already works with shadcn/ui). Or a custom subset.
- **Animation:** Framer Motion (`motion` package). Use `LazyMotion` + `domAnimation` for smaller bundle. CSS transitions via Tailwind for simple color/opacity changes.
- **Charts:** Recharts or Nivo for the timeline and correlation views. Style to be minimal-chrome (remove gridlines, reduce tick marks, use semantic colors).
- **Images:** Consider server-side normalization (resize, pad to square canvas) at scrape time. Cloudinary or imgix for on-the-fly transforms if needed. `mix-blend-mode: multiply` client-side as baseline.
- **Font loading:** Geist via `next/font/local` from the `geist` npm package. Single font family, no layout shift.
- **Dark mode:** User toggle on the dashboard. Light mode is the default. CSS custom properties switch per mode.
