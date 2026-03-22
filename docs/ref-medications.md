# Medications Catalog — Reference

Last updated: 2026-03-22

## Overview

The medications catalog lives in `scraper/data/medications.json` and is seeded into the `medication_products` table on every deploy via `scraper/seed_db.py`. The catalog is read-only from the app — users select from it when logging medications, or enter a custom medication name.

**Current count:** 77 medications across 5 categories (allergy: 16, parasite: 21, gi: 28, pain: 9, steroid: 3)

## Adding a New Medication

### Required Fields

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Brand name (e.g., "Apoquel") or "Generic (Brand)" for less known drugs |
| `generic_name` | string | Lowercase generic/active ingredient (e.g., "oclacitinib") |
| `manufacturer` | string or null | Company that makes it |
| `category` | enum | `allergy`, `parasite`, `gi`, `pain`, `steroid` |
| `drug_class` | string | Pharmacological class (e.g., "JAK inhibitor", "NSAID") |
| `dosage_form` | enum | `tablet`, `chewable`, `capsule`, `liquid`, `injection`, `topical`, `spray`, `powder`, `granules`, `gel`, `collar` |
| `default_intervals` | string[] | From `dosing_interval` enum (see schema). Most common interval first |
| `description` | string | 1-3 sentences. Include key warnings (contraindications, hazardous handling, monitoring). No marketing language |
| `common_side_effects` | string | Comma-separated. Include percentages with study size when available. Note severity (common/uncommon/rare) |
| `side_effects_sources` | string | Markdown links to sources. Format: `[Author Year Journal](url) (study details)` |
| `suppresses_itch` | boolean | Does this medication suppress itch signaling? Used by correlation engine to flag confounding |
| `has_gi_side_effects` | boolean | Does this medication cause GI side effects? Used by correlation engine |
| `learn_more_url` | string or null | External URL for pet owners to learn more (see Learn More URL Hierarchy below) |

### What to Include vs. Exclude

**Include:** Prescription medications commonly prescribed for dogs that affect stool, GI health, itch, allergy, pain, or parasite prevention. Both brand-name and generic-only entries.

**Exclude:**
- OTC supplements (psyllium, probiotics, pumpkin, slippery elm) — these are supplements/food, not medications
- Vitamins/minerals (B12 injections, folate) — supplements
- OTC GI protectants at consumer doses (Pepto-Bismol, Kaopectate) — OTC = supplement category
- Human-only medications not used in veterinary practice

### Verification Requirements

Every claim in `description` and `common_side_effects` must be backed by at least one verifiable source. Better to have less information than inaccurate information.

**Source hierarchy for side effects data (best to acceptable):**

1. **FDA FOI / NADA label / DailyMed** — Gold standard. Field study data with exact percentages and sample sizes (e.g., "Diarrhea 7.0% vs 6.8% placebo, n=171")
2. **Peer-reviewed clinical studies** — Published in JVIM, Vet Dermatol, J Vet Pharmacol Ther, etc. Include PMID, sample size, study design
3. **Peer-reviewed review articles** — Comprehensive reviews in Vet Clin North Am, etc. Useful when no single RCT exists
4. **VCA / VIN monographs** — Vet-written, reliable for qualitative side effect lists. Use when no clinical trial data exists
5. **MSD Veterinary Manual** — Authoritative textbook-level reference, good for class-level pharmacology

**Always note when canine-specific data is limited.** If side effects are extrapolated from human data or pharmacological class effects, say so explicitly (e.g., "Constipation (common — expected effect, from human/class data)").

### Side Effects Format

Use this consistent format:
```
"Effect name (frequency — qualifying detail), Effect name (frequency)"
```

Frequency terms: `common`, `uncommon`, `rare`. Include percentages when available from clinical data. Include comparator when available (e.g., "7.0% vs 6.8% placebo").

Examples:
- With study data: `"Diarrhea (7.0% vs 6.8% placebo), Vomiting (6.4% vs 5.5% placebo)"`
- Without study data: `"Vomiting (common), Diarrhea (uncommon)"`
- Class effect: `"Constipation (common — expected effect, from human/class data)"`

### Sources Format

Markdown links with study context:
```
"[Author Year Journal](https://pubmed.ncbi.nlm.nih.gov/PMID) (study design, n=X); [VCA monograph](url)"
```

Always include at least one source. Two is better — ideally a clinical study + a monograph.

## Learn More URL Hierarchy

Every medication should have a `learn_more_url` linking to a trustworthy external page where pet owners can read more. Apply this fallback hierarchy:

| Priority | Source | URL Pattern | Coverage | Notes |
|----------|--------|-------------|----------|-------|
| 1 | **VCA Hospitals** | `vcahospitals.com/know-your-pet/{slug}` | 71/77 | Best for individual drug monographs. Vet-written (LifeLearn), consumer-friendly, free. Covers what it is, how to give, side effects, interactions, storage |
| 2 | **Drugs.com/vet** | `drugs.com/vet/{product}.html` | Brand-name vet products | Full FDA/Health Canada prescribing info. More technical but comprehensive. Good for combo parasite products that VCA indexes under generic combos with unpredictable slugs |
| 3 | **DailyMed (FDA/NLM)** | `dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={id}` | FDA-approved + human drugs | Official FDA labeling. Dense but authoritative and unbiased. Use for very new drugs not yet on VCA, and off-label human drugs (mesalamine, cholestyramine) |
| 4 | **Manufacturer site** | varies | Product-specific | Accurate but promotional. Last resort |

**Current breakdown:** VCA: 71, Drugs.com/vet: 3, DailyMed: 3

### Verifying URLs

When adding or updating `learn_more_url`:
1. VCA slugs are unpredictable — always verify the URL returns 200, don't guess
2. For combo products, search VCA for the generic combo name (they use formats like `moxidectin--sarolaner--pyrantel`)
3. Drugs.com/vet blocks HEAD requests (returns 403) — verify with a GET/fetch instead
4. DailyMed URLs use a `setid` parameter that's stable per drug label

## Database Schema

The `medication_products` table mirrors the JSON fields. The seeder (`seed_db.py`) upserts on `name` (unique). See `drizzle/0007_medications_feature.sql` and `drizzle/0014_medication_confounding.sql` for the schema.

**Note:** `learn_more_url` needs a migration to add the column to `medication_products` if it doesn't already exist. Check the schema before deploying.

## Veterinary Information Sources

Trustworthy sources used in this catalog:

| Source | URL | Authority | Use For |
|--------|-----|-----------|---------|
| FDA Animal Drugs (FOI/NADA) | animaldrugsatfda.fda.gov | Regulatory | Side effect percentages from field studies |
| DailyMed | dailymed.nlm.nih.gov | FDA/NLM | Official drug labeling |
| PubMed | pubmed.ncbi.nlm.nih.gov | NIH/NLM | Peer-reviewed clinical studies |
| VCA Hospitals | vcahospitals.com/know-your-pet | Mars Petcare (LifeLearn) | Consumer-facing drug monographs |
| VIN / Veterinary Partner | veterinarypartner.vin.com | VIN (largest vet community) | Vet-authored drug articles |
| MSD Veterinary Manual | msdvetmanual.com | Merck | Textbook-level pharmacology reference |
| EMA (European Medicines Agency) | ema.europa.eu | EU regulatory | EPARs for EU-authorized vet drugs |

**Avoid:** Consumer pet blogs, manufacturer marketing materials (as primary source), AI-generated content, undated/unattributed articles.
