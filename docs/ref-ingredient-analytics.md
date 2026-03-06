# Ingredient Analytics & Correlation Reference

> Research-backed reference for how MyDogLog correlates ingredients with adverse food reactions. Informs `src/lib/correlation/engine.ts`, `src/lib/ingredients.ts`, and `scraper/data/ingredient_families.json`.

## Two-Track Correlation Model

Skin reactions and GI reactions are **different conditions with different triggers, mechanisms, and timelines**. The engine should treat them as two separate correlation calculations.

| | Skin/Itch Track | GI Track (poop + vomiting) |
|---|---|---|
| **Primary mechanism** | Immune-mediated (IgE or T-cell) | Mixed: immune, osmotic, secretory, motility, fermentation |
| **Trigger pool** | Proteins almost exclusively | Proteins + fats + additives + fiber + carbs |
| **Reference data** | Mueller et al. 2016 (n=297) | No equivalent study exists (research gap) |
| **Cross-reactivity** | Highly relevant | Relevant for proteins; irrelevant for additive/fat/fiber triggers |
| **Fat/oil forms** | Irrelevant (non-allergenic) | Highly relevant (pancreatitis, bile acid diarrhea) |
| **Additives** | Irrelevant | Relevant (carrageenan, CMC, gums) |
| **Position weight** | Standard decay (proteins early = more exposure) | Different for additives (late in list but still meaningful) |
| **Timeline to flare** | 8-12 weeks for full resolution | 2-5 weeks for GI resolution; acute reactions in hours |
| **Overlap** | ~20% of food-allergic dogs have BOTH skin and GI signs (DVM360, Lee 2021) | |

### Current Engine State

The engine already computes `weightedPoopScore` and `weightedItchScore` separately per ingredient. But `COMMON_TRIGGERS` in `ingredients.ts` presents Mueller's skin-only data as universal. The reference data and what we surface to the user should diverge based on which symptom channel is active.

---

## Track 1: Skin/Itch Correlation

### Common Skin Allergens

From Mueller et al. 2016 (n=297 dogs with confirmed **cutaneous** adverse food reactions):

| Allergen | % of dogs reacting | Notes |
|----------|-------------------|-------|
| Beef | 34% | Most common by far, but under-suspected by owners |
| Dairy | 17% | Cheese, whey, yogurt toppers — often overlooked |
| Chicken | 15% | Gets disproportionate attention online vs actual prevalence |
| Wheat | 13% | Most allergenic grain; contains gluten |
| Soy | 6% | Common filler |
| Lamb | 5% | Marketed as hypoallergenic but still triggers 5% |
| Corn | 4% | Less common than internet claims |
| Egg | 4% | Often hiding in treats |
| Pork | 2% | Rarely discussed |
| Fish | 2% | |
| Rice | 2% | Uncommon but exists |

**This data ONLY applies to the itch correlation track.** Do not present these percentages in a GI context.

### Cross-Reactivity Groups

Dogs allergic to one protein may react to related ones. Muscle protein allergens (ACTA1, ALDOA, CKM, ENO3, GAPDH) show A-RISC indices of 0.77-0.98 between species (Olivry et al., Vet Dermatol 2022).

| Group | Families | Biological basis |
|-------|----------|-----------------|
| Poultry | chicken, turkey, duck, quail | Galloanserae — shared albumin/IgG proteins |
| Ruminant | beef, bison, lamb, venison, goat | Bovidae/Cervidae — shared serum albumin |
| Pork | pork, wild_boar | Same species (Sus scrofa) |
| Finfish | all fish families | Shared parvalbumins |
| Shellfish | clam, shrimp | Tropomyosin-driven (distinct from finfish) |

Cross-reactivity between chicken and fish clinically demonstrated (Bexley et al., Vet Dermatol 2019). Beef-lamb and beef-dairy cross-reactivity well-documented (Martin et al., Vet Dermatol 2004).

### Fat/Oil Forms

Pure fats are non-allergenic (reactions target proteins, not lipids). Poorly rendered chicken fat can contain residual protein — some owners report "chicken-allergic" dogs reacting. Hydrolyzed diets containing chicken fat are generally tolerated. Our engine correctly separates fat/oil correlation keys from protein keys — **this separation matters for itch but not for GI** (where fat content itself is a trigger).

### Skin-Specific Confounders

- **Seasonal allergies cause 80-95% of atopic dermatitis** — food changes during pollen season produce false correlations
- Only 5-20% of atopic dermatitis is food-related (Olivry & Mueller, BMC Vet Res 2017)
- **Pollen index** data (already logged) should be actively used to discount itch correlations during high-pollen periods
- Storage mites in kibble cross-react with house dust mites and can mimic food allergy (PMC6822402, 2019)

### Skin Timeline

- Minimum 8-week elimination trial for 90%+ sensitivity (Olivry/Mueller 2015)
- Rechallenge flare: median 12 hours, 80% within 7 days, >90% within 14 days
- Our food scorecard should enforce minimum 8-week evaluation for itch-focused analysis

---

## Track 2: GI Correlation (Poop + Vomiting)

### The Research Gap

**No GI-specific allergen ranking exists.** Mueller's data is from dermatology referral populations using cutaneous flare methodology. No equivalent systematic review exists for dogs presenting with GI-only signs. The allergen ranking for GI presentations may be identical or may differ — the data does not exist. (Mueller & Olivry 2018, PMC6233561)

This means we cannot present "beef 34%" to a user whose dog only has soft stool. **Our GI correlation must be data-driven from the user's own logs, not reference-data-driven.**

### Food-Responsive Enteropathy (FRE)

FRE is the most common subtype of chronic enteropathy in dogs. It is **clinically distinct from food allergy** — the mechanism may be immune, non-immune, or microbiome-mediated, but the treatment (diet change) works regardless.

| Stat | Value | Source |
|------|-------|--------|
| % of chronic enteropathy that is food-responsive | 50-70% | Volkmann 2017, Allenspach 2007, Suchodolski 2022 |
| FRE response to hydrolyzed diet | 83-95% | Rodrigues 2025 (PMC12053874) |
| FRE response to novel protein diet | ~60% | Multiple |
| Dogs improving with alternative diet after first trial fails | 69% | Rodrigues 2025 |
| 3-year remission rate (hydrolyzed > highly digestible) | Significant | Mandigers 2010 |

**Key insight: one failed diet trial does NOT rule out FRE.** The biggest mistake is giving up after one attempt (Schmid & Galloni, Today's Vet Practice 2022).

### GI Trigger Categories

Unlike skin reactions (almost always protein-immune), GI reactions have multiple distinct mechanisms:

#### A. Protein Sensitivity (immune-mediated)

Same proteins as skin track, but no separate prevalence data. Cross-reactivity groups still apply. Hydrolyzed proteins effective for GI (88% improved in Rodrigues 2025). ~20-50% of dogs react to hydrolysates of their trigger protein (Bizikova & Olivry 2016).

#### B. Fat-Related GI Issues

Fat is a **GI-specific trigger** — irrelevant to skin correlation but critical for poop and especially vomiting.

**Mechanisms:**
- Malabsorbed fatty acids cause **secretory diarrhea** in the colon (bacteria deconjugate bile acids and hydroxylate fatty acids, stimulating fluid secretion)
- High fat delays gastric emptying → nausea, vomiting
- Abrupt fat changes are more dangerous than chronic high-fat (dogs metabolically adapt)
- Dietary indiscretion (sudden fatty meals) is the strongest pancreatitis predictor: trash access = 13x risk, unusual foods = 4-6x risk (Lem et al., JAVMA 2008)

**Fat thresholds (ACVN, Shmalberg 2016):**

| Level | g/1000 kcal | Use case |
|-------|-------------|----------|
| Ultra-low fat | < 17 | Hypertriglyceridemic dogs |
| Low fat | < 30 | Recurrent pancreatitis |
| Minimum essential | > 14 | Below this impairs fat-soluble vitamin absorption |
| Caution | > 50-60 | Reduce for dogs with clinical pancreatitis history |

**Pancreatitis timeline:** onset 12-72h after high-fat event. Vomiting in 90% of severe cases (Saunders Manual). If user logs a high-fat meal/treat and vomiting appears in that window, high-signal correlation.

**Action: Correlate fat % from GA data with vomiting and poop scores. Fat/oil correlation keys should contribute to GI track (not just be excluded as non-allergenic like in skin track).**

#### C. Vomiting-Specific Triggers

Vomiting from true food allergy is **rare** — only ~7% of food-allergic dogs present with vomiting (93% present with diarrhea). Mueller & Olivry 2018, PMC7156131.

When a dog vomits after eating, **food intolerance, fat overload, or contamination is more likely than allergy.** Vomiting-specific triggers:

| Trigger | Mechanism | Evidence |
|---------|-----------|----------|
| High-fat meals | Pancreatic stimulation, delayed gastric emptying | Strong |
| Biogenic amines in fish meals | Histamine + putrescine + cadaverine potentiate; heat-stable | Moderate (PetfoodIndustry, Radosevich 2007) |
| Vomitoxin/DON | Mycotoxin in wheat/corn/barley; FDA allows 5ppm in grain ingredients | Strong (named literally for causing vomiting) |
| Bilious vomiting syndrome | Fasting duration, not ingredients — bile reflux into empty stomach | Strong (Ferguson et al. 2016, JAAHA) |
| Rancid fats/oxidized lipids | Aldehydes from surface fat oxidation on opened kibble | Moderate |
| Lactose | Lactase deficiency post-weaning; dose-dependent | Moderate |

**Bilious vomiting syndrome (BVS)** is a **meal-timing problem, not an ingredient problem.** Morning bile vomiting = fasting gap too long. Tracking meal times (not just content) is needed to identify this pattern.

**Biogenic Amine Index (BAI):** (histamine + putrescine + cadaverine) / (1 + spermine + spermidine). BAI >10 = very poor quality. Amines are heat-stable — cooking/extrusion does not destroy them. Not detectable from ingredient lists, but fish meal quality varies enormously. Amines may lower the food allergy tolerance threshold in predisposed dogs.

#### D. Additive-Related GI Issues

Additives are **GI-track-only triggers** — no evidence they cause skin reactions.

**Carrageenan — Strongest Evidence:**
- Found in ~70% of commercial canned dog food
- Degraded carrageenan (poligeenan) reliably induces intestinal ulceration in animal models (Watt, Gut 1971; Fath 1984; Munyaka 2016)
- Food-grade carrageenan activates NF-kB, increasing IL-8 and disrupting tight junction ZO-1 (Kimilu et al., Nutrients 2024)
- Small human RCT: 100mg/day caused UC relapses (Bhattacharyya et al., 2017)
- Removed from USDA organic permitted list 2016
- **Evidence: Moderate-strong. Mechanism known. Dose-dependent.**

**CMC (Cellulose Gum / Carboxymethylcellulose):**
- Thins protective intestinal mucus layer, promotes inflammation, alters gut microbiota in mice (Chassaing et al., Nature 2015)
- **Evidence: Moderate (human/mouse). Mechanism known.**

**Titanium Dioxide (E171):**
- EU banned as food additive 2022 — genotoxicity could not be ruled out (EFSA 2021)
- Intestinal inflammation, lesions, nanoparticle accumulation in animal studies
- Still allowed in Canadian pet food as whitening agent
- **Evidence: Moderate-strong (regulatory action).**

**Gums (Guar, Xanthan, Locust Bean):**
- Guar: highly fermentable, gas and diarrhea at high doses
- Xanthan: generally safest. Bloating in sensitive dogs
- Locust bean / agar-agar: minimal controversy
- **Evidence: Weak-moderate. Dose-dependent.**

**Food Dyes (Red 40, Yellow 5/6):**
- No dog-specific GI research. Zero nutritional benefit
- **Evidence: Weak. Flag as unnecessary.**

**Status: `additive` source group implemented.** Carrageenan, CMC, guar_gum, xanthan_gum, locust_bean_gum, titanium_dioxide tracked as additive source group. Engine applies floor weight (0.5) for GI correlation regardless of position.

#### E. Legume/Pulse Fermentation

Peas, lentils, chickpeas contain oligosaccharides (raffinose, stachyose, verbascose) that dogs cannot digest. These pass to colon and are fermented → gas, bloating, loose stool.

- U of Illinois (Reilly et al., 2021, PMC8212060): legume diets produced significantly higher fecal SCFA (627.6 vs 381.1 umol/g control). Green lentil: 1.17% stachyose + 0.43% verbascose. Control near-zero
- Extrusion eliminates trypsin inhibitors and lectins but does NOT reduce oligosaccharide content
- U of Guelph 2023: pulse-based diets showed decreased macronutrient digestibility and increased fecal bile acid excretion
- **Ingredient splitting:** foods listing peas + pea protein + pea starch + pea fiber may be 40-50% legume total
- Effect was subclinical in healthy dogs but relevant for dogs with sensitive GI tracts
- **Evidence: Moderate for GI. Strong for digestibility reduction.**

**Status: Legume splitting detection implemented.** Engine tracks `ingredientCount` per family key. When 3+ ingredients from same legume family appear in a product, `isSplit = true` flags the ingredient with a UI warning.

#### F. Fiber Type Mismatch

Different fiber sources have radically different effects. A dog doing poorly on one "sensitive stomach" formula may thrive on another purely due to fiber profile.

| Fiber | Fermentability | Solubility | Effect |
|-------|---------------|------------|--------|
| Guar gum | High | Soluble | Thickener but gas-producing |
| Pectin | Mod-High | Soluble | Stool firming |
| Psyllium | Moderate | Mod-soluble | Versatile — firms loose AND softens hard stool |
| Beet pulp | Moderate | Mostly insoluble | Industry standard; >= 5% increases stool volume |
| Pea fiber | Moderate | Insoluble | Bulk, less gas |
| Cellulose | Low | Insoluble | Firms stool, minimal gas |

**Large bowel diarrhea** (small volume, mucus, straining) responds to added fiber. **Small bowel diarrhea** (large volume, watery) needs low-fiber highly digestible food first (Torres, Today's Vet Practice 2025).

Butyrate from fermentable fiber is the preferred energy source for enterocytes with anti-inflammatory effects (Torres 2025; Moreno et al., JAVMA 2022). 68% of dogs with chronic large bowel diarrhea had complete resolution on fiber-supplemented diet (BMC Vet Res 2022).

**Status: `fiber` source group implemented.** Beet pulp (split from beet family), chicory, and psyllium are tracked as fiber source group. Cellulose and miscanthus not yet in families JSON (add when encountered as uncategorized).

#### G. Carbohydrate/Processing Effects

- Dry food (moisture <= 14%) was significantly associated with confirmed chronic enteropathy (OR 5.71, p=0.03) — possibly AGEs from extrusion, preservatives, or moisture/carb profile (Trewin & Kathrani 2023, PMC10658591)
- Dietary carbohydrate presence was a risk factor for CE in combined analysis
- Extrusion temperatures (125-150C) cause protein aggregation and Maillard reactions that reduce digestibility (Geary et al., Transl Anim Sci 2024)
- Rendered meat meals have ~30% lower digestibility than fresh meat; quality highly variable by source

### GI Diet Trial Protocol (Different from Skin)

The approach for GI-presenting dogs differs from dermatology:

| GI Sign Location | First-Line Diet | If No Response |
|-----------------|-----------------|----------------|
| Small intestinal (large volume, watery) | Highly digestible, low-residue | Hydrolyzed/novel protein |
| Large intestinal (small volume, mucus, straining) | Fiber-enriched | Hydrolyzed/novel protein |
| Concurrent skin signs | Hydrolyzed/novel protein directly | — |
| Delayed motility / pancreatitis / fat malabsorption | Low-fat (17-26 g/Mcal ME) | — |

Source: Schmid & Galloni, Today's Vet Practice 2022

**GI response time is faster:** 2-4 weeks for improvement (vs 8-12 for skin). But evaluation minimums should be **asymmetric by verdict direction:**

- **"This food is bad" (thumbs down):** No minimum. 80% of reactive dogs flare within 7 days (median 12h). 3-5 consecutive bad days on the same food is high-confidence signal.
- **"This food is good" (thumbs up):** 2-4 week minimum for GI, 8-week minimum for itch. Need time to rule out slow-onset issues and confirm microbiome has adjusted (7-14 day shift).

It takes days to detect a problem. It takes weeks to confirm the absence of one.

---

## Shared: Adverse Food Reaction Framework

"Food allergy" is a subset. The umbrella term is **Adverse Food Reaction (AFR)**:

| Type | Mechanism | Onset | Dose-dependent? | Symptom |
|------|-----------|-------|-----------------|---------|
| IgE-mediated allergy (Type I) | Immediate immune response | Minutes to hours | No | Skin + GI |
| Cell-mediated allergy (Type IV) | Delayed T-cell response | Hours to days | No | Skin + GI |
| Food intolerance | Non-immunologic | Variable | Yes | Mostly GI |
| Osmotic | Malabsorbed nutrients pull water | Hours | Yes | GI only |
| Secretory (bile acid/fat) | Fat/bile stimulates fluid secretion | Hours-days | Yes | GI only |
| Fermentative | Oligosaccharides → bacterial gas | Hours | Yes | GI only (gas, bloating) |

Cell-mediated and intolerance reactions are likely more common than IgE-mediated but under-diagnosed — serum IgE tests miss them entirely (Jackson, JAVMA 2023). **The only valid diagnostic is an elimination diet trial** (Lam et al., JAVMA 2019; Coyner & Schick, JSAP 2019).

### Prevalence

- 50-70% of dogs with chronic enteropathy are food-responsive (Volkmann; Suchodolski 2022; Procoli 2025)
- ~20% of food-allergic dogs have both skin AND GI signs; most have one or the other (Lee, DVM360 2021)
- Food allergy accounts for ~18% (range 9-40%) of dogs presenting with pruritus (Olivry & Mueller, BMC Vet Res 2017)
- 9.4% of all dogs seen by vets have signs of GI disease (Dandrieux 2019)

### Novel Protein Reality Check

"Novel" is relative to the individual dog. As of 2026, truly uncommon proteins: kangaroo, alligator/crocodile, insect, camel. Duck, venison, and rabbit are increasingly mainstream.

**OTC diet contamination:** 65% of OTC foods tested contained undeclared chicken DNA; 41% undeclared pork (Kepinska-Pacelik et al., 2023). OTC "limited ingredient" diets should NOT be trusted for diagnostic elimination trials.

### Hydrolyzed Proteins

- Effective for both skin and GI (88% GI improvement in Rodrigues 2025)
- 20-50% of dogs still react to hydrolysates of their trigger protein (Olivry & Bizikova 2010)
- Peptides > 4.5 kDa can still trigger immune reactions
- Hydrolyzed diets alter lipid metabolism in IBD dogs, increasing metabolites that protect gut cell membrane integrity (Ambrosini et al., 2020, PMC7406657)
- Our engine correctly flags `is_hydrolyzed` and separates from whole protein keys

---

## Correlation Timelines

| Window | What it captures | Applies to | Source |
|--------|-----------------|------------|--------|
| 0-24h | GI transit time; acute vomiting from fat/toxin | GI | PetMD, Purina |
| 12h (median) | Allergen rechallenge flare | Both | Today's Vet Practice 2024 |
| 12-72h | Pancreatitis onset after high-fat event | GI (vomiting) | Saunders Manual |
| 1-3 days | Transition diarrhea (self-limiting) | GI | Multiple |
| 7 days | 80% of allergic dogs have flared | Both | Olivry/Mueller 2024 |
| 7-14 days | Gut microbiome compositional shift | GI | Frontiers Vet Sci 2023 |
| 14 days | >90% of allergic dogs have flared | Both | Today's Vet Practice 2024 |
| 2-5 weeks | GI symptom improvement on elimination diet | GI | VCA Hospitals |
| 8-12 weeks | Full skin symptom improvement | Skin | Olivry/Mueller 2015 |

**Our 5-day transition buffer is reasonable** for GI (covers 1-3 day transition diarrhea + margin). For itch, the buffer could arguably be longer since skin changes are slower.

---

## Confounders

### Already tracked:
- Medications (itch meds, digestive meds) — can mask symptoms
- Accidental exposures — with buffer exclusion
- Pollen index — logged but not yet used for filtering

### Should be tracked / surfaced:

| Confounder | Affects | Why it matters |
|------------|---------|---------------|
| **Stress events** (boarding, moves, visitors) | GI | Stress colitis mimics food reactions; resolves in 3-5 days (VCA) |
| **Treats/chews/supplements** | Both | #1 reason elimination diets fail (Dr. Gould, DACVD) |
| **Seasonal allergies** | Skin | 80-95% of atopic dermatitis is environmental |
| **Meal timing** | GI (vomiting) | Bilious vomiting syndrome = fasting gap, not ingredients |
| **Parasites** (whipworms) | GI | Mimic food intolerance for years; cycle every ~3 months |
| **EPI** | GI | Chronic soft stool from enzyme deficiency, not food sensitivity |

### Treats Are First-Class Correlation Data

Items that invalidate elimination diets but owners forget to track:
- Flavored medications (most chewable heartworm/flea meds are chicken-flavored)
- Pill pockets (even peanut butter-flavored ones often contain chicken)
- Pet toothpaste, joint supplements (glucosamine chews — often chicken-flavored)
- Fish oil capsules (cross-contamination)
- Dental chews (Greenies etc. — contain multiple proteins)
- Rawhides, bully sticks, Himalayan cheese chews

Source: Preventive Vet (Dr. Alexandra Gould, DACVD)

### Storage/Freshness Confounders

**Storage mites:** proliferate on opened kibble in warm/humid conditions (>23C, >71% RH). 80% of open bags contaminated within 6 weeks. Cross-react with house dust mite allergens → can mimic food allergy. Not detectable from ingredient lists. (Olivry & Mueller 2019, PMC6822402)

**Fat rancidity:** surface fats oxidize after bag opening, producing aldehydes. Dogs may refuse or vomit. Unsaturated fats (fish oil, flaxseed) oxidize faster. Storing kibble in plastic containers (without original bag) accelerates rancidity.

**Mycotoxins:** 75% of grain-based dry food samples tested contained mycotoxins. Vomitoxin (DON) specifically targets GI at low levels (1-2 ppm = feed refusal + vomiting). Corn and wheat are highest risk. Not flaggable per-product.

---

## Additional Data Dimensions Worth Tracking

### Stool (beyond Purina 1-7)

Vets use CIBDAI (Canine IBD Activity Index) which scores: attitude/activity, appetite, vomiting, stool consistency, stool frequency, weight loss.

Additional stool signals with clinical value:
- **Mucus** (yes/no) — large bowel inflammation/colitis indicator
- **Blood** (yes/no) — fresh = large bowel; dark/melena = small bowel
- **Frequency** (count/day) — increased = large bowel; normal but voluminous = small bowel

Our daily check-in already captures appetite and vomiting. **Adding optional mucus and blood toggles to poop logging would increase clinical signal** without friction.

### Vomiting (beyond count)

- **Digested vs undigested** — vomiting (active, digested) vs regurgitation (passive, undigested/tubular). Different causes, different food associations
- **Bile-only vs food** — bile vomiting = fasting duration problem, not ingredient problem
- **Timing relative to meal** — within 30min suggests regurgitation/format issue; hours later suggests GI irritant

---

## Ingredient Families JSON — Current State

### Implemented:
- Families, source groups, forms, cross-reactivity groups, ambiguous ingredients, hydrolyzed flags
- **`category` field** on each family: `protein`, `carb`, `fat`, `fiber`, `vitamin`, `mineral`, `additive` (or null for ambiguous families like yeast/herb/algae). Written to DB `ingredients.category` column via build.py.
- **`additive` source group** — carrageenan, cmc, guar_gum, xanthan_gum, locust_bean_gum, titanium_dioxide. Position weight override in engine (min floor 0.5 for GI track).
- **`fiber` source group** — beet_pulp, chicory, psyllium. GI track only — fiber type correlates with stool outcomes.
- **`vegetable` source group** — alfalfa, broccoli, carrot, celery, collard, garlic, ginger, green_bean, kale, parsley, pepper, rosemary, spinach, tomato, turmeric, turnip, zucchini. No longer mapped to `other`.
- **`seed` source group** — borage, canola, chia, coconut, flaxseed, hemp, olive, safflower, sunflower. No longer mapped to `other`.
- **beet / beet_pulp split** — beet (root/carb) has whole beets; beet_pulp (fiber/fiber) has dried/plain beet pulp. Different nutritional roles.
- **Expanded form_type enum** — `protein_isolate`, `starch`, `fiber`, `gluten` are now proper DB enum values. Previously mapped to `raw`, losing information. `concentrate` → `protein_isolate`.

### Ingredient splitting detection:
- When multiple ingredients from the same legume family appear in a product (e.g. peas + pea protein + pea starch + pea fiber), the engine tracks `ingredientCount` and `worstPosition` per family key.
- If `ingredientCount >= 3` for a legume source group, `isSplit = true` is set on the IngredientScore.
- UI shows informational warning: "This ingredient appears split across 3+ positions in some products."

### Remaining TODO:

1. **Fat % from GA data as a GI correlation input** — not just ingredient-level, but product-level fat content
2. **Asymmetric evaluation minimums** — "bad" verdicts need no minimum (3-5 bad days is enough). "Good" verdicts need 2-4 weeks (GI) or 8 weeks (skin) to confirm absence of problems

### Already correct (no changes needed):
- `COMMON_SKIN_TRIGGERS` (Mueller data) only shown in itch context — no `COMMON_GI_TRIGGERS` list (GI correlations are purely data-driven)
- Fat/oil separation from protein
- Hydrolyzed flagging
- Cross-reactivity groups — biologically accurate
- Position-based weighting for proteins — aligns with ingredient label regulation
- Additive position weight override — carrageenan at position 25 flags in GI track (floor weight 0.5)

---

## Key Sources

- Mueller RS, Olivry T, Prelaud P. "Critically appraised topic on adverse food reactions." BMC Vet Res. 2016;12:9. PMC4710035.
- Mueller RS, Olivry T. "Noncutaneous manifestations of adverse food reactions." BMC Vet Res. 2018. PMC6233561, PMC7156131.
- Jackson HA. "Food allergy in dogs and cats; current perspectives." JAVMA. 2023;261(S1).
- Yamka R et al. "High fat, high risk? Evaluating dietary fat and pancreatitis in dogs." JAVMA. 2026.
- Olivry T et al. "Evaluation of cross-reactivity among recently identified food allergens for dogs." Vet Dermatol. 2022;33:523-526.
- Torres C. "The Role of Dietary Fiber in Pet Nutrition." Today's Vet Practice. 2025 Sep/Oct.
- Tham HL. "Elimination Diet Trials: Steps for Success." Today's Vet Practice. 2024 Jul/Aug.
- Schmid SM, Galloni R. "Nutritional Management of GI Tract Diseases." Today's Vet Practice. 2022.
- Kimilu N et al. "Carrageenan in the Diet: Friend or Foe for IBD?" Nutrients. 2024;16(11):1780.
- Kepinska-Pacelik J et al. "Assessment of adulteration in dog food by DNA identification." Animal Feed Science & Tech. 2023;298.
- Lem KY et al. "Associations between dietary factors and pancreatitis in dogs." JAVMA. 2008;233:1425.
- Moreno AA et al. "Dietary fiber in management of canine and feline GI disease." JAVMA. 2022;260(S3).
- Shmalberg J. "Controversies in Nutritional Management of Pancreatitis." Today's Vet Practice. 2016 Nov/Dec.
- Bexley J et al. Cross-reactivity between chicken and fish. Vet Dermatol. 2019.
- Suchodolski JS. Dysbiosis Index research. Texas A&M GI Laboratory. 2022.
- Olivry T, Bizikova P. "Evidence of reduced allergenicity of food hydrolysates." Vet Dermatol. 2010;21:32-41.
- Volkmann M et al. Chronic diarrhea classification. WSAVA 2017/2018.
- Allenspach K et al. "Chronic enteropathies in dogs." J Vet Intern Med. 2007;21:700-708.
- Rodrigues BM et al. "Hydrolyzed protein diet in naive chronic enteropathy dogs." PMC12053874. 2025.
- Mandigers PJJ et al. "Hydrolyzed vs highly digestible diet for chronic small bowel enteropathy." 2010.
- Trewin B, Kathrani A. "Pre-illness dietary risk factors for chronic enteropathy in dogs." PMC10658591. 2023.
- Preventive Vet. "Elimination Diets for Dogs & Cats." Dr. Alexandra Gould, DACVD.
- Chassaing B et al. "Dietary emulsifiers promote colitis and metabolic syndrome." Nature. 2015;519:92-96.
- EFSA. "Safety assessment of titanium dioxide (E171)." 2021. PMC8207357.
- Tobacman JK. "Harmful gastrointestinal effects of carrageenan." Environ Health Perspect. 2001;109(10). PMC1242073.
- Reilly LM et al. "Legumes and lentils in dog diets." Front Vet Sci. 2021;8:667642. PMC8212060.
- Olivry T, Mueller RS. "Storage mites in pet food allergy." BMC Vet Res. 2019;15:385. PMC6822402.
- Geary TW et al. "Digestibility of raw, fresh, and extruded dog foods." Transl Anim Sci. 2024;8:txae163.
- Ambrosini YM et al. "Hydrolyzed diet and lipid metabolism in IBD dogs." Front Vet Sci. 2020;7:451. PMC7406657.
- Lee G. "Dermatology/nutrition crossover in food allergy." DVM360. 2021.
- Ferguson LE et al. "Bilious vomiting syndrome in dogs." JAAHA. 2016.
- Radosevich J. "Biogenic amines in pet food." PetfoodIndustry. 2007.
- Dandrieux JRS. "Inflammatory bowel disease vs chronic enteropathy in dogs." 2019. PMC6902862.
