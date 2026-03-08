# MyDogLog Brand Guide

> The health tracking app your dog deserves and your vet respects.

## Positioning

**Tagline:** "Know what works."

MyDogLog is a **health data company** that takes dogs seriously. The design should feel like a well-designed European health device company (Withings, Oura) — precise, confident, and warm — that genuinely cares about canine health outcomes. We borrow from healthtech and clinical data tools, not the pet aisle. The result should feel trustworthy enough for a vet's office and simple enough for the backyard.

---

## Reference Brands

Listed in order of influence.

### 1. Withings — Primary Anchor

European clinical credibility with consumer warmth. The core aesthetic reference.

- Clean white backgrounds with alternating light gray sections
- Small uppercase category labels above bold section headlines
- App screenshots framed in phone mockups (dark UI on light background)
- Comparison tables with monoline icons per feature row
- Feature cards: screenshot + label + short tagline
- Clinical language: "clinically validated", specific statistics
- Zero illustrations — photography, product shots, or UI screenshots only
- Moire/abstract geometric patterns as subtle brand texture

### 2. Oura — App Data Layer

Nordic minimalism, dark mode, progressive disclosure. The reference for in-app data experience.

- Dark mode as default (near-black, not pure black)
- Ring/arc gauge for daily wellness score
- Single headline metric per category, detail on tap
- Semantic color system (green = optimal, amber = attention, red = alert)
- Large bold numbers as the primary design element
- Restraint: one focus per view, generous space around data elements
- Qualitative ratings where appropriate (Low / Moderate / High)
- Meal Tracker: photo-first input, categorical ratings, non-judgmental language

### 3. Levels — Food-to-Outcome Correlation

The closest functional analogy (connects food input to health output).

- "What you ate" next to "how your body responded" layout
- Biomarker report cards per metric
- Serif headings for editorial content (signals authority)
- Warm earth-tone photography paired with clean data
- Specific outcome statistics ("80% improve out-of-range biomarkers")

### 4. Clue — Destigmatization

Proved a tracking app for a "taboo" bodily function can feel dignified, scientific, and beautiful.

- Treat the subject matter (poop, digestion) with scientific dignity, not humor
- Bold, non-obvious color palette (deliberately NOT the expected colors)
- Science-forward brand voice
- Geometric visual language, not illustrative

### 5. Eight Sleep — Clinical Credibility

How to present clinical/scientific backing.

- Large bold statistical callouts ("Up to 44% improvement")
- Before/after comparison frameworks
- Persona-based sections showing specific medical understanding

---

## Color Palette

The palette is **desert sand + oasis sage**. Warm golden cream backgrounds create a luxurious, wellness-forward canvas. Desert sage green is the primary accent — health-forward without being hospital-teal, distinctive and unexpected for a data app. Think sand dunes at golden hour with a sage bush in the foreground.

Inspired by: Aesop, Norm Architects, Dubai quiet luxury interiors, Le Labo.

### Light Mode

| Name | Hex | Usage |
|------|-----|-------|
| White | `#FFFFFF` | Card surfaces, inputs, elevated content |
| Golden Cream | `#F4EDE3` | Page background, alternating sections |
| Warm Khaki | `#E8DCC8` | Nested surfaces, tab backgrounds, skeletons |
| Warm Near-Black | `#2E2A27` | Headlines, primary content (never pure black) |
| Warm Brown | `#6B5D4F` | Supporting text, labels |
| Medium Taupe | `#8A7A69` | Category labels, placeholder text |
| Desert Sage | `#6B8C6F` | Primary accent — CTAs, interactive elements |
| Deep Sage | `#5A7A5E` | Hover state for primary actions |
| Sand Border | `#D9CFC3` | Dividers, card borders |

### Dark Mode

Warm dark tones — desert at night, not cold blue-black.

| Name | Hex | Usage |
|------|-----|-------|
| Warm Charcoal | `#1A1814` | Main background |
| Dark Sand | `#242019` | Cards, elevated surfaces |
| Deep Khaki | `#2E2A23` | Nested surfaces, input backgrounds |
| Warm Off-White | `#F0EBE3` | Headlines, primary content |
| Muted Off-White | `#F0EBE3` at 60% | Supporting text, labels |
| Faint Off-White | `#F0EBE3` at 38% | Placeholder text, disabled states |
| Light Sage | `#8FB896` | Primary accent (brighter for dark backgrounds) |
| Pale Sage | `#A3C9A8` | Hover state |
| Subtle Border | `#F0EBE3` at 12% | Dividers, card borders |

**Key principle:** Never use pure `#000000` for text. Warm near-black maintains the desert luxury feel. All neutrals (borders, text, backgrounds) come from the same warm family, creating tone-on-tone depth.

### Semantic Colors (both modes)

Earth-tone family throughout — no cool blues or neon greens.

| Name | Hex | Usage |
|------|-----|-------|
| Sage | `#6B8C6F` | Stool score 1-2 (ideal) — the oasis |
| Light Sage | `#8FB896` | Stool score 3 |
| Warm Amber | `#D4A944` | Stool score 4-5 |
| Terracotta | `#C97C5D` | Stool score 6 |
| Adobe Red | `#B84A3A` | Stool score 7 (diarrhea), accidental exposures |
| Dusty Lavender | `#8B7EB8` | Medication overlays |

---

## Typography

One font family. Hierarchy through weight, size, and color only.

**Primary:** Geist — clean European geometric feel, excellent for data-dense mobile interfaces.

**Monospace:** Geist Mono — for numerical data where tabular alignment matters (correlation tables, score histories).

**Optional editorial:** A serif (Newsreader, Source Serif) for blog/educational content only, following Levels' approach. Signals scientific authority. Not needed at launch.

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Category label | 12px | Medium | Taupe, uppercase, tracked |
| Page title | 32-40px | Bold | Primary |
| Section headline | 24-28px | Semibold | Primary |
| Body text | 16px | Regular | Secondary |
| Data metric (large) | 48-64px | Bold | Primary or semantic |
| Data label | 13px | Medium | Taupe |
| Button text | 14px | Medium | White on sage |

---

## Layout

### Landing Page

A single page, not a full marketing site. Withings-inspired but brief:

- **Hero:** One headline, one subheadline, one CTA. Clean, no clutter.
- **3-4 feature cards:** Screenshot + label + tagline. Keep it tight:
  - "Track what your dog eats. See what works."
  - "Ingredient-level correlation across every food."
  - "Canadian dog food database, built in."
- **Footer:** Sign up, privacy, contact. That's it.

### App

The app is the product. Light and dark mode via user toggle. Bottom nav: Home, Food, Log (+), Insights, Settings.

**Home** — The "open the app in the backyard" view. Quick-log buttons in a 2x2 grid, plus a chronological feed of recent entries. No dashboards, no charts. Just log and see what you logged.

**Food** — The "manage what the dog eats" view. Active routine card at top. Chronological food history below with inline scorecard display.

**Insights** — The "what's working and what isn't" view. Ingredient-level correlation with signal mode toggle. Expandable ingredient rows.

**Data entry** — Three paths, all fast:
- *Daily Check-in* — unified form: routine, stool, itchiness, treats. Once a day.
- *Quick Poop* — 3 seconds: pick score + save. Seven large tap targets, semantic color per score, score 2 highlighted as ideal.
- *Quick Treat* — 3 seconds: pick product + save.

All logging surfaces use a slide-up drawer on mobile, modal on desktop. Same content, different wrapper.

---

## Components

Design language for recurring UI elements.

**Cards** — White on the warm page background. Soft corners (8px). Subtle shadow. Generous internal padding. Clean and elevated.

**Buttons** — 44px height (mobile-friendly). Soft corners. Primary = sage fill + white text. Outline = white + border, subtle hover. No pill shapes, no gradients.

**Score displays** — Large number centered, semantic color applied. Small label underneath in muted tone. Think Withings Health Improvement Score.

**Data tables** — Clean horizontal rules. Monoline icons. No zebra striping. Generous vertical spacing.

**Form inputs** — 44px height, white background, soft corners, clean borders. Consistent height across all input types.

**Toggles** — Selected state = sage fill + white text. Hover = subtle warm background. Used for mode selectors and enum pickers.

**Badges** — Small, muted, fully rounded. Used for quantities and labels.

---

## Responsive

**Mobile and desktop are equally important.** Logging happens on the phone (kitchen, backyard, on the go). Data review happens on both.

- **Logging flows:** One-handed mobile use. Large tap targets (44px+), minimal scrolling, one action per screen.
- **Home:** Single column on mobile, two columns on desktop. Complete experience on a phone without horizontal scrolling.
- **Charts/Timeline:** Horizontal scroll on mobile, full width on desktop. Touch-interactive.

---

## Photography & Visual Style

- **No illustrations.** Photography, product shots, or UI screenshots only.
- **No emoji or icon-heavy interfaces** in the data layer.
- **Lifestyle photography:** Warm, natural light. Real dogs, real settings. Diverse breeds. Not Instagram-aesthetic.
- **Icons:** Monoline, consistent stroke weight. Used sparingly for navigation. Not decorative.

### Product Images

Product images are scraped and vary in quality/background/aspect ratio. Present them cohesively:

- **Grid cards:** Square container, warm khaki background, product fully visible (contain-fit), blended backgrounds to absorb white packaging backdrops. Soft corners.
- **List thumbnails:** 48-64px square, center-cropped, warm khaki background.
- **Missing image:** Brand logo if available, otherwise a category silhouette (bag, can, treat shape) at low opacity. Never show a broken image or empty space.

---

## Voice & Tone

**Scientific confidence with genuine warmth.** We take the subject matter seriously because people using this app are dealing with a real problem — a sick or uncomfortable dog they love. We respect that.

**Core vocabulary:** "correlation", "transition period", "baseline", "feeding period", "stool quality", "digestive health", "pack" (for shared access)

**Avoid:** "fur baby", "pawsome", "good boy/girl", gamification language, paw print iconography

**How we talk about data:**
- Specific and concrete: "Stool quality averaged 4.2 during chicken-based foods" not "things were rough with chicken"
- Confident but not prescriptive: "Consider" and "you could try" not "you should"
- Genuinely encouraging when things improve: "Stool consistency improved 40% since switching" — celebrate progress without being cheesy

**Personality:**
- Direct and concise — this isn't a cold app, it's a focused one
- Dry wit in empty states and onboarding ("No logs yet. Your dog is out there making data right now.")
- We never make fun of the subject matter, but we don't treat it like a funeral either
- Copy should feel like it was written by a smart friend who happens to know a lot about canine nutrition

---

## Design Guardrails

We achieve warmth through **confidence and clarity**, not decoration.

- **Earned delight only** — celebrate real milestones (consistent stool streak, successful food transition) with a well-timed message, not confetti
- **Photography over illustration** — real dogs, real food, real data. The subject matter is interesting enough
- **The brand color does the heavy lifting** — sage accents on warm surfaces create the personality. No paw prints needed
- **Data is the decoration** — a well-formatted score, a clean trend line, a crisp correlation table. These ARE the visual interest
- **Both modes, equal citizens** — light mode default, dark mode fully designed. Not an afterthought

---

## Motion

Animation should feel clinical and precise, not playful. Think Oura's measured reveals, not Duolingo's bouncing.

**Scroll reveals:** Fade in + blur clear + slide up. Trigger once on scroll into view. 0.8-1s duration. Stagger children by 0.15-0.25s for sequential content.

**Score animations:** Numbers count up from zero on first appearance. Score arcs fill clockwise. Semantic color fades in as the number lands.

**Micro-interactions:** 0.15-0.2s, ease-out. Subtle scale on tap (0.97). Faint lift on card hover. Smooth toggle slides.

**Page transitions:** Content fades in on route change (0.3s). No sliding transitions. Keep it calm.

**Charts:** Lines draw left-to-right on first render. Bars grow upward. Timeline dots scale in. Only animate on first load, not on data updates.

**Never:** bounce/elastic easing on data, confetti, skeleton shimmers, parallax, continuous animations (except loading indicators). Always respect reduced-motion preferences.
