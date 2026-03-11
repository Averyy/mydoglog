# Medications Feature

> Check git log to see what's been done. Continue from where you left off.

Research completed 2026-03-06 via 6 parallel agents + 4 audit agents. Scoped to medications that impact GI or allergies (the app's core tracking loop). Users can still log other medications via free-text.

## Definition of Done
- [ ] `medication_products` table exists with 67 seeded medications across 5 categories
- [ ] `medications` table has `medication_product_id` FK + `interval` column, no `reason` column
- [ ] All medication code removed from routine editor, daily check-in, active plan card, food page, and correlation engine
- [ ] Navigation updated: mobile "More" popover (Meds + Settings), desktop flat "Meds" link
- [ ] `/dogs/[id]/meds` page shows active meds (no end date) and past meds (has end date, reverse chronological)
- [ ] Add/edit medication form: searchable catalog picker + free-text fallback, dosage, interval dropdown (pre-filled from catalog defaults), start/end dates, notes
- [ ] Medication API routes updated for new schema (no `reason`, added `medication_product_id` + `interval`)
- [ ] `seed_medications.py` upserts catalog from `medications.json`, called by `build.py`
- [ ] `yarn build` succeeds with no errors
- [ ] All existing tests pass (correlation tests updated to remove medication references)
- [ ] Refer to `docs/mydoglog-branding.md` before any UI work

---

## Schema

### `medication_products` table (catalog, seed data)
| Field | Type | Notes |
|---|---|---|
| id | text PK | UUID |
| name | text | Brand name |
| generic_name | text | Active ingredient(s) |
| manufacturer | text nullable | |
| category | medication_category enum | |
| drug_class | text nullable | e.g. "isoxazoline", "NSAID" |
| dosage_form | dosage_form enum | |
| default_intervals | dosing_interval[] | Array of dosing_interval enum values (typed) |
| description | text nullable | Standalone, no cross-references |
| common_side_effects | text nullable | Pre-formatted comma-separated string, e.g. `"Vomiting (17%), Diarrhea (12.1%), Lethargy (4.3%), Constipation (uncommon)"`. Render as-is. Display-only — not used in calculations. |
| created_at | timestamp | |

### `medication_category` enum
allergy, parasite, gi, pain, steroid

### `dosage_form` enum
tablet, chewable, capsule, liquid, injection, topical, spray, powder, gel, collar

### `dosing_interval` enum
four_times_daily, three_times_daily, twice_daily, daily, every_other_day, weekly, biweekly, monthly, every_6_weeks, every_8_weeks, every_12_weeks, every_3_months, every_6_months, every_8_months, annually, as_needed

### Modify `medications` table (user log)
- Add `medication_product_id` (optional FK -> medication_products.id)
- Add `interval` (dosing_interval enum, nullable)
- Remove `reason` column — category from `medication_products` replaces it for catalog meds; free-text meds use `notes` for context
- **Migration: nuke all existing medication records** — will be re-added manually via new Meds page

**`medications` table `name` column:** Kept for both catalog and free-text meds. Catalog meds copy name from `medication_products` at creation time (denormalized — no joins for display, catalog names won't change). Free-text meds: user types name directly. `medication_product_id` is null for free-text, populated for catalog.

Note: `digestive_impact` and `itchiness_impact` were proposed but never added to the schema — no columns to drop.

---

## Medication Catalog (67 total)

### Allergy (13)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Numelvi | atinvicitinib | Merck Animal Health | tablet | daily | Second-generation selective JAK1 inhibitor (10x+ selectivity over JAK2/JAK3/TYK2) for allergic dermatitis. No vaccine interaction warnings. Dogs 6+ months. Give with food. FDA approved Feb 2026. |
| Zenrelia | ilunocitinib | Elanco | tablet | daily | Non-selective JAK inhibitor (JAK1/JAK2/TYK2) for canine atopic dermatitis. Immunosuppressive. Boxed warning: inadequate immune response to vaccines — discontinue 28d-3mo before vaccination, withhold 28d after. Dogs 12+ months. |
| Apoquel | oclacitinib | Zoetis | tablet | twice_daily, daily | First-generation JAK1-preferring inhibitor for canine atopic dermatitis (1.8x JAK1/JAK2 selectivity). Typically twice daily for 14 days then once daily maintenance. Also available as chewable (NADA 141-555, 2023). Dogs 12+ months. |
| Cytopoint | lokivetmab | Zoetis | injection | monthly, every_6_weeks, every_8_weeks | Anti-IL-31 monoclonal antibody injection administered at vet clinic. Blocks itch signal only, not broader inflammation. USDA-licensed biologic. |
| Atopica | cyclosporine | Elanco | capsule | daily | Immunosuppressant (calcineurin inhibitor) for canine atopic dermatitis. Slower onset (4-6 weeks). Give 1hr before or 2hr after meals. |
| Cortavance | hydrocortisone aceponate | Virbac | spray | daily | Topical corticosteroid spray for inflammatory and pruritic skin conditions. Short-course (7 consecutive days). Minimal systemic absorption. For localized flares/hot spots. EMA-authorized (not FDA). |
| Genesis Spray | triamcinolone acetonide | Virbac | spray | twice_daily, daily, every_other_day | Topical corticosteroid spray for pruritus associated with allergic dermatitis. FDA-approved tapering regimen: BID x7d, SID x7d, EOD x14d (28 days total). |
| Diphenhydramine (Benadryl) | diphenhydramine | generic (OTC) | tablet | twice_daily, three_times_daily | First-generation antihistamine. Most commonly used canine antihistamine. OTC but vet-directed dosing. Sedating. |
| Hydroxyzine (Atarax) | hydroxyzine | generic | tablet | twice_daily, three_times_daily | First-generation antihistamine. Most prescribed Rx antihistamine for canine atopic dermatitis. Sedating. |
| Cetirizine (Zyrtec) | cetirizine | generic (OTC) | tablet | daily, twice_daily | Second-generation antihistamine. Less sedating. Increasingly recommended by veterinary dermatologists. Known as Reactine in Canada. |
| Temaril-P | trimeprazine/prednisolone | Zoetis | tablet | twice_daily, daily | Combination antihistamine + low-dose steroid for allergic dermatitis and pruritus. FDA-approved for dogs. Known as Vanectyl-P in Canada. |
| Ketoconazole | ketoconazole | generic | tablet | daily, twice_daily | Oral antifungal for Malassezia yeast dermatitis (common secondary to atopic dermatitis). Requires liver monitoring. Give with food for absorption. More hepatotoxic than itraconazole. |
| Itraconazole (Sporanox) | itraconazole | generic | capsule | daily | Preferred systemic antifungal for Malassezia yeast dermatitis and dermatophytosis. Better tolerated than ketoconazole (less hepatotoxic). Give with food. |

### Parasite Prevention (21)

#### Oral flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Simparica Trio | sarolaner/moxidectin/pyrantel | Zoetis | chewable | monthly | Flea, tick, heartworm, roundworm, and hookworm prevention. |
| Simparica | sarolaner | Zoetis | chewable | monthly | Isoxazoline flea and tick prevention. |
| NexGard | afoxolaner | Boehringer Ingelheim | chewable | monthly | Isoxazoline flea and tick prevention. Most prescribed flea/tick product in North America. |
| NexGard PLUS | afoxolaner/moxidectin/pyrantel | Boehringer Ingelheim | chewable | monthly | Flea, tick, heartworm, roundworm, and hookworm prevention. FDA approved 2023. |
| NexGard Spectra | afoxolaner/milbemycin oxime | Boehringer Ingelheim | chewable | monthly | Flea, tick, heartworm, roundworm, hookworm, and whipworm prevention. |
| Bravecto | fluralaner | Merck | chewable | every_12_weeks | Flea and tick prevention with 12-week dosing interval (8 weeks for lone star ticks). Also available as topical. |
| Credelio | lotilaner | Elanco | chewable | monthly | Isoxazoline flea and tick prevention. Smallest tablet size of the isoxazoline class. |
| Credelio Plus | lotilaner/milbemycin oxime | Elanco | chewable | monthly | Flea, tick, heartworm, and roundworm prevention. Also treats demodicosis. |
| Credelio Quattro | lotilaner/moxidectin/praziquantel/pyrantel | Elanco | chewable | monthly | Flea, tick, heartworm, roundworm, hookworm, and tapeworm prevention. The only isoxazoline combo that covers tapeworms. FDA approved October 2024. |

#### Topical flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Revolution | selamectin | Zoetis | topical | monthly | Flea, heartworm, ear mite, and sarcoptic mange prevention. Also treats roundworms. |
| Advantage Multi | imidacloprid/moxidectin | Elanco | topical | monthly | Flea, heartworm, roundworm, hookworm, whipworm, and lungworm prevention. |
| K9 Advantix II | imidacloprid/permethrin/pyriproxyfen | Elanco | topical | monthly | Flea, tick, mosquito, biting fly, and lice treatment. Repels and kills on contact. TOXIC TO CATS. |
| Frontline Plus | fipronil/(S)-methoprene | Boehringer Ingelheim | topical | monthly | Flea and tick treatment. Older product, now somewhat superseded by isoxazolines. |

#### Collar

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Seresto | imidacloprid/flumethrin | Elanco | collar | every_8_months | Flea and tick prevention collar providing up to 8 months of protection. One of the most widely used flea/tick products by volume. Regulated by EPA (pesticide), not FDA. |

#### Heartworm-focused

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Heartgard Plus | ivermectin/pyrantel | Boehringer Ingelheim | chewable | monthly | Heartworm, roundworm, and hookworm prevention. |
| Interceptor Plus | milbemycin oxime/praziquantel | Elanco | chewable | monthly | Heartworm, roundworm, hookworm, whipworm, and tapeworm prevention. |
| ProHeart 6 | moxidectin (sustained-release) | Zoetis | injection | every_6_months | Injectable heartworm preventative providing 6 months of protection. Also treats hookworms. Administered by veterinarian. |
| ProHeart 12 | moxidectin (sustained-release) | Zoetis | injection | annually | Injectable heartworm preventative providing 12 months of protection. Also treats hookworms. FDA approved 2019. Available in US, AU/NZ, select EU countries. Canada has ProHeart 6 only. Administered by veterinarian. |

#### Injectable flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Bravecto Quantum | fluralaner (extended-release) | Merck | injection | annually | First annual flea and tick injectable for dogs. Single subcutaneous dose provides 12 months of protection. AU/NZ 2023, EU 2024, US FDA July 2025, Canada Sep 2025. Administered by veterinarian. |

#### Dewormers

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Drontal Plus | praziquantel/pyrantel/febantel | Elanco | tablet | as_needed | Broad-spectrum dewormer for tapeworms (including Echinococcus), hookworms, roundworms, and whipworms. Treatment-focused, not a monthly preventative. |
| Panacur | fenbendazole | Merck | powder | daily | Broad-spectrum dewormer for roundworms, hookworms, whipworms, and Taenia tapeworms. Given over 3-5 consecutive days. Also used off-label for Giardia. |

### GI (21)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Metronidazole | metronidazole | generic | tablet | twice_daily | Antibiotic and antiprotozoal for GI infections, Giardia, and inflammatory bowel disease. Also known as Flagyl. Very bitter taste; do not crush. |
| Cerenia | maropitant citrate | Zoetis | tablet | daily | Anti-nausea and anti-vomiting medication. The only FDA-approved veterinary antiemetic for dogs. Also available as injection at vet clinic. |
| Metoclopramide | metoclopramide | generic | tablet | twice_daily, three_times_daily | Prokinetic and antiemetic that stimulates gastric motility and prevents esophageal reflux. Also known as Reglan. |
| Famotidine | famotidine | generic | tablet | daily, twice_daily | H2-receptor antagonist acid reducer for gastritis and acid reflux. Available over-the-counter (Pepcid). Best given on empty stomach before meals. |
| Omeprazole | omeprazole | generic | capsule | daily | Proton pump inhibitor for ulcers and severe acid reflux. Available over-the-counter (Prilosec). Do not crush capsules. |
| Sucralfate | sucralfate | generic | tablet | twice_daily, three_times_daily, four_times_daily | Coats and protects stomach and intestinal lining. Give on empty stomach, separated from other meds by 2 hours. Also known as Sulcrate/Carafate. Also available as liquid suspension. |
| Misoprostol | misoprostol | generic | tablet | twice_daily, three_times_daily, four_times_daily | Prostaglandin E1 analog gastroprotectant used to prevent NSAID-induced gastric ulceration. Commonly co-prescribed with long-term NSAID therapy. Also known as Cytotec. |
| Budesonide | budesonide | generic | capsule | daily | Locally-acting corticosteroid for inflammatory bowel disease. High first-pass hepatic metabolism. Do not open or crush capsules. |
| Azathioprine | azathioprine | generic | tablet | daily, every_other_day | Immunosuppressive for inflammatory bowel disease when steroids alone are insufficient. Standard second-line IBD therapy. Also known as Imuran. Requires regular blood monitoring. |
| Tylosin | tylosin tartrate | Elanco | powder | daily, twice_daily | Macrolide antibiotic for chronic diarrhea and antibiotic-responsive enteropathy. Extremely bitter; often placed in gelatin capsules for dosing. Also known as Tylan. Labeled for livestock; canine use is off-label. |
| Ondansetron | ondansetron | generic | tablet | twice_daily, three_times_daily | 5-HT3 serotonin receptor antagonist antiemetic for severe nausea and vomiting. Also known as Zofran. Use caution in MDR1-positive breeds (collies, sheepdogs). |
| Sulfasalazine | sulfasalazine | generic | tablet | twice_daily, three_times_daily | Anti-inflammatory for large bowel disease (colitis) and vasculitis. Also known as Salazopyrin. Give with food. |
| Mesalamine | mesalamine | generic | tablet | twice_daily | 5-ASA anti-inflammatory for colitis. Same active component as sulfasalazine but without the sulfonamide carrier. KCS risk still applies (5-ASA itself is causative) — requires Schirmer test monitoring. Also known as Asacol/Pentasa. |
| Loperamide | loperamide | generic | tablet | twice_daily, three_times_daily | Antidiarrheal that slows intestinal motility. Available over-the-counter (Imodium). CONTRAINDICATED in MDR1/ABCB1 breeds (collies, Aussies, shelties). |
| Pancrelipase | pancrelipase | various | powder | twice_daily | Pancreatic enzyme replacement (lipase, amylase, protease) for exocrine pancreatic insufficiency (EPI). Mixed directly into food with every meal. Also known as Viokase/Pancrezyme. |
| Clavamox | amoxicillin/clavulanic acid | Zoetis | tablet | twice_daily | One of the most commonly prescribed veterinary antibiotics. Used for GI bacterial infections and secondary skin infections from allergic dermatitis. Also known as Augmentin (human equivalent). Give with food. |
| Cephalexin | cephalexin | generic | capsule | twice_daily, three_times_daily | First-generation cephalosporin antibiotic. First-line treatment for pyoderma (bacterial skin infections secondary to allergies). |
| Cefpodoxime (Simplicef) | cefpodoxime proxetil | Zoetis | tablet | daily | Third-generation cephalosporin antibiotic. Convenient once-daily alternative to cephalexin for canine pyoderma. Generics available. |
| Clindamycin (Antirobe) | clindamycin | Zoetis | capsule | twice_daily | Lincosamide antibiotic for deep pyoderma, dental infections, and bone infections. Commonly prescribed for allergy-related skin infections. Significant GI side effects (diarrhea). |
| Convenia | cefovecin sodium | Zoetis | injection | biweekly | Long-acting injectable cephalosporin — single subcutaneous injection provides 14 days of antibiotic coverage. FDA-approved for skin infections; also used off-label for UTIs. Administered by veterinarian. |
| Enrofloxacin (Baytril) | enrofloxacin | Elanco | tablet | daily | Fluoroquinolone antibiotic for deep/resistant pyoderma, UTIs, and some GI infections. Reserved for infections unresponsive to first-line antibiotics. |

### Pain / NSAID (9)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Metacam | meloxicam | Boehringer Ingelheim | liquid | daily | Oxicam-class NSAID oral suspension for pain and inflammation from osteoarthritis and musculoskeletal disorders. Comes with calibrated dosing syringe. |
| Rimadyl | carprofen | Zoetis | chewable | daily, twice_daily | Propionic acid-class NSAID for pain and inflammation from osteoarthritis and post-surgical recovery. Available as chewable tablets and caplets. |
| Previcox | firocoxib | Boehringer Ingelheim | chewable | daily | Selective COX-2 inhibitor NSAID for osteoarthritis pain and postoperative pain from soft tissue and orthopedic surgery. |
| Deramaxx | deracoxib | Elanco | chewable | daily | COX-2 selective NSAID for osteoarthritis, orthopedic surgery, and dental surgery pain. Flexible dosing — lower for chronic OA, higher for short-term post-surgical. |
| Onsior | robenacoxib | Elanco | tablet | daily | Highly selective COX-2 inhibitor NSAID that concentrates at inflammation sites. For OA pain (unlimited duration) and post-op soft tissue surgery pain (max 3 days). |
| Galliprant | grapiprant | Elanco | tablet | daily | EP4 prostaglandin receptor antagonist for osteoarthritis pain and inflammation. Does not inhibit COX enzymes — distinct mechanism from traditional NSAIDs. |
| Librela | bedinvetmab | Zoetis | injection | monthly | Anti-NGF monoclonal antibody injection for osteoarthritis pain. Administered at vet clinic. FDA approved May 2023. |
| Gabapentin | gabapentin | generic | capsule | twice_daily, three_times_daily, four_times_daily | Anticonvulsant used off-label for chronic and neuropathic pain. Often used as adjunct alongside NSAIDs for multimodal pain management. Also commonly used for anxiety. |
| Tramadol | tramadol | generic | tablet | twice_daily, three_times_daily, four_times_daily | Synthetic opioid for moderate to moderately severe pain. Used as part of multimodal pain management. Controlled substance. |

### Steroid (3)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Prednisone | prednisone | generic | tablet | daily, twice_daily, every_other_day | Broad corticosteroid and immunosuppressant. Used across many conditions: allergies, IBD, immune-mediated disease. Taper required when discontinuing. |
| Prednisolone | prednisolone | generic | tablet | daily, twice_daily, every_other_day | Active metabolite of prednisone — identical effects. Preferred for dogs with hepatic insufficiency (prednisone requires liver conversion). Some vets prescribe this instead of prednisone. |
| Dexamethasone | dexamethasone | generic | tablet | daily, every_other_day | ~5-7X more potent than prednisone (~25X hydrocortisone). Used for severe allergic reactions, IBD, and autoimmune skin conditions. Often sent home as oral tablets after initial injectable dose at clinic. |

### Catalog Summary

| Category | Count | Why included |
|---|---|---|
| Allergy | 13 | Direct — controls itching, major GI side effects. Includes JAK inhibitors (3 generations), antihistamines, immunosuppressants, topical steroids, antifungals |
| Parasite | 21 | Routine monthly meds, some cause GI upset |
| GI | 21 | Direct — treats digestive issues. Includes common antibiotics that impact GI (cephalosporins, fluoroquinolones, lincosamides) |
| Pain/NSAID | 9 | GI side effects are #1 safety concern with NSAIDs |
| Steroid | 3 | Used for both allergies and GI (IBD) |

**Not in catalog (use free-text):** anxiety, cardiac, thyroid, seizure, urinary, and any other medications. Also: fluconazole (niche antifungal), lactulose (osmotic laxative), chlorambucil/mycophenolate (niche IBD immunosuppressants), allergen-specific immunotherapy (custom formulations), vet probiotics (FortiFlora/Proviable — already excluded from correlation). The Meds page free-text fallback covers these. Free-text meds only require name + dosage + interval + dates (no category/drug class/dosage form) — keeps it low friction. Tradeoff: free-text meds won't trigger correlation caveats on scorecards.

**Catalog maintenance:** Hand-maintained JSON, not scraped. No single scrapeable veterinary drug database exists. New drug approvals in relevant categories happen ~2-3/year — manual `medications.json` updates are sufficient.

**New dosage_form value:** `collar` added for Seresto.
**New dosing_interval value:** `every_12_weeks` added for Bravecto.

---

## Common Side Effects by Medication

Side effects from FDA FOI/NADA summaries, EMA EPARs, and published peer-reviewed clinical trials. Listed by incidence percentage where clinical trial data exists; qualitative frequency (common/uncommon/rare) where it doesn't. **Display-only — shown to users as advisory info, never used in score calculations.**

All isoxazoline-class parasite products carry an [FDA class-wide neurologic warning](https://www.fda.gov/animal-veterinary/animal-health-literacy/fact-sheet-pet-owners-and-veterinarians-about-potential-adverse-events-associated-isoxazoline-flea) (tremors, ataxia, seizures). EPA-registered products (K9 Advantix II, Frontline Plus, Seresto) lack formal clinical trial adverse reaction tables. Gabapentin and tramadol are not FDA-approved for dogs — no formal canine FOI data exists.

### Allergy

| Medication | Side Effects | Sources |
|---|---|---|
| Numelvi | Vomiting/nausea (6.9% vs 4.2% placebo), Otitis externa (6.3%), Hematuria (4.9%), Anorexia (4.2%), Diarrhea (4.2% vs 10.4% placebo), Crystalluria (3.5%), Lethargy (3.5%), Upset stomach/flatulence/bloating (2.1%). Lab: leukopenia, elevated ALT/AST. Safety study: demodicosis at 5X dose | [FDA NADA 141-596 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/18155) (n=144 treated vs n=144 placebo, 28 days) |
| Zenrelia | Vomiting/nausea (15.5–22.1%), Diarrhea (12.6–19.9%), Lethargy (12.1–12.2%), Otitis externa (3.9–10.5%), Anorexia (4.9–9.4%), Dermal growths (1.5–8.8%), Elevated liver enzymes (3.9–5.5%), UTI (5.5–6.3%) | [FDA NADA 141-585 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/15865) (n=181+206, 112 days) |
| Apoquel | Pyoderma (12.0%), Dermal lumps (12.0%), Otitis (9.9%), Vomiting (2.3–9.2%), Diarrhea (2.3–6.0%), Histiocytoma (3.9%), Cystitis (3.5%), Anorexia (1.4–3.2%), Lethargy (1.8–2.8%) | [FDA NADA 141-345 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/902) (n=283, up to 112 days); [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=275a2c51-9679-4f42-b8cc-21b04369a056) |
| Cytopoint | Adverse events at rates similar to placebo — no drug-attributable percentages. USDA-licensed biologic (not FDA NADA). No specific incidence percentages in published clinical data. EMA: anaphylaxis/facial swelling (rare) | [Michels et al. 2016 Vet Dermatol](https://pubmed.ncbi.nlm.nih.gov/27647569/) (efficacy, n=211); [EMA EPAR](https://www.ema.europa.eu/en/medicines/veterinary/EPAR/cytopoint) |
| Atopica | Vomiting (30.9%), Diarrhea (20.0%), Otitis externa (6.8%), UTI (3.8%), Anorexia (3.0%), Lethargy (2.3%), Gingival hyperplasia (2.3%), Lymphadenopathy (2.3%) | [FDA NADA 141-218 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/749) (n=265) |
| Cortavance | One transient local reaction (1/54, 1.9%) — aggravated erythema, resolved by Day 7. No systemic adverse effects. HPA axis suppression at 3–5X dose (reversible) | [EMA EPAR](https://www.ema.europa.eu/en/medicines/veterinary/EPAR/cortavance) (n=54, 7 days) |
| Genesis Spray | Polyuria (5.3%), Polydipsia (5.3%), Polyphagia (1.8%), Local reactions/sneezing/watery eyes (≤3.6% — pooled across both groups). Note: polydipsia matched placebo rate (5.7%); polyuria was 5.3% vs 0% placebo | [FDA NADA 141-210 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/734) (n=57, 28 days) |
| Diphenhydramine (Benadryl) | Sedation/drowsiness (common), Dry mouth (common), Urinary retention (uncommon), GI upset (uncommon). No canine clinical trial incidence data — OTC human antihistamine used off-label | [VCA monograph](https://vcahospitals.com/know-your-pet/diphenhydramine) |
| Hydroxyzine (Atarax) | Sedation/drowsiness (common), Fine tremors at high doses (uncommon), GI upset (uncommon). No canine clinical trial incidence data | [VCA monograph](https://vcahospitals.com/know-your-pet/hydroxyzine) |
| Cetirizine (Zyrtec) | Sedation/drowsiness (uncommon — 2nd-gen, less sedating), Vomiting (uncommon), Hypersalivation (uncommon). No canine clinical trial incidence data | [VCA monograph](https://vcahospitals.com/know-your-pet/cetirizine) |
| Temaril-P | Combines trimeprazine sedation + prednisolone steroid effects. Sedation/drowsiness (common), Polydipsia/polyuria (common with prolonged use), Increased appetite (common). No separate incidence data — side effects are the sum of both components | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=9de07d0d-44df-47da-b4b7-24f5fc803b46) |
| Ketoconazole | Lack of appetite, Vomiting, Diarrhea, Liver toxicity (requires monitoring — liver enzymes every 2-3 months), Lightened coat color with prolonged use. No canine clinical trial with specific incidence percentages. No frequency labels in source | [VCA monograph](https://vcahospitals.com/know-your-pet/ketoconazole) |
| Itraconazole (Sporanox) | Lack of appetite, Vomiting, Weight loss, Liver toxicity (requires monitoring). No canine clinical trial with specific incidence percentages. No frequency labels in source | [VCA monograph](https://vcahospitals.com/know-your-pet/itraconazole) |

### Parasite Prevention — Oral Flea/Tick

| Medication | Side Effects | Sources |
|---|---|---|
| Simparica Trio | Vomiting (14.3%), Diarrhea (13.2%), Lethargy (8.5%), Anorexia (5.1%), Polyuria (3.7%), Polydipsia (2.2%), Hyperactivity (2.2%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=0f83bcf4-7e89-479f-a980-4cb40456ee78) (n=272) |
| Simparica | Vomiting (0.95%), Diarrhea (0.63%), Lethargy (0.32%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=91fc9ba1-35e6-4e37-8c37-c5e40699bd5b) (n=315) |
| NexGard | Vomiting (4.1%), Dry/flaky skin (3.1%), Diarrhea (3.1%), Lethargy (1.7%), Anorexia (1.2%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e10f7434-d00c-44de-af79-7b0886b2e948) (FDA NADA 141-406, n=415) |
| NexGard PLUS | Diarrhea (6.7%), Vomiting (4.5%), Lethargy (2.2%), Itching (2.2%), Dermatitis (1.5%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=1eb7bc46-cac9-47d2-bbdc-6801690dfbc4) (FDA NADA 141-554, n=134, 330 days) |
| NexGard Spectra | Vomiting, diarrhea, lethargy, anorexia, pruritus (each uncommon, 0.1–1%). Not FDA-approved — EMA frequency bands only, no exact percentages | [EMA EPAR](https://www.ema.europa.eu/en/medicines/veterinary/EPAR/nexgard-spectra) |
| Bravecto | Vomiting (7.1%), Decreased appetite (6.7%), Lethargy (5.4%), Diarrhea (4.9%), Polydipsia (1.8%), Flatulence (1.3%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=1fcbf232-cfd4-481e-ba9b-6251b7b468d7) (FDA NADA 141-426, n=224, 182 days) |
| Credelio | Weight loss (1.5%), Elevated BUN (1.0%), Polyuria (1.0%), Diarrhea (1.0%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=427f2ebc-ce24-452b-bbb3-43d4ef8b63b0) (n=198) |
| Credelio Plus | Diarrhea (8.8%), Vomiting (8.2%), Anorexia (5.0%), Lethargy (3.1%) | [Health Canada product monograph](https://pdf.hres.ca/dpd_pm/00064937.PDF) (US field study, n=159); [EMA EPAR](https://www.ema.europa.eu/en/medicines/veterinary/EPAR/credelio-plus) |
| Credelio Quattro | Diarrhea w/ or w/o blood (11.0%), Vomiting (9.4%), Lethargy (6.3%), Anorexia (5.8%), Dermatitis (5.2%), Weight loss (3.1%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ad403eb7-0c03-4bda-9698-3757860043cf) (FDA NADA 141-581, n=191, 330 days) |

### Parasite Prevention — Topical/Collar/Injectable/Dewormer

| Medication | Side Effects | Sources |
|---|---|---|
| Revolution | Vomiting, diarrhea, lethargy, salivation (each ≤0.5% of dogs and cats combined). Application-site alopecia ~1% in cats (not reported in dogs) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=8032a1ae-d192-4514-80f1-9a3b50dc2155) (n=1,743 dogs+cats) |
| Advantage Multi | Pruritus (14.8%), Residue at site (7.0%), Medicinal odor (3.9%), Hyperactivity (0.8%), Lethargy (0.8%), Inappetence (0.8%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3fc1a42b-6576-4890-aa0c-5c0eb903c85a) (HW-negative dogs, n=128) |
| K9 Advantix II | Skin irritation/redness at site, scratching, lethargy, vomiting (all uncommon — no clinical trial %). EPA-registered pesticide | [EPA product label](https://www3.epa.gov/pesticides/chem_search/ppls/011556-00143-20220214.pdf) |
| Frontline Plus | Application-site irritation (uncommon). Very rarely: lethargy, vomiting, diarrhea. EPA-registered pesticide | [EPA product label](https://www3.epa.gov/pesticides/chem_search/ppls/065331-00005-20151119.pdf) |
| Seresto | Application-site reactions: itching, redness, slight hair loss (<0.3% of sales per post-market data). EPA-registered pesticide | [EPA review](https://www.epa.gov/pets/seresto-pet-collar-review) |
| Heartgard Plus | Vomiting or diarrhea within 24hrs (1.1% of administered doses — not per dog) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=595a4883-6b37-4190-9579-a2c7ca4738eb) |
| Interceptor Plus | Vomiting, diarrhea, lethargy, ataxia, anorexia (reported — no specific field trial %) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=86b367e3-64e5-4c44-9961-6caea5d12e75) |
| ProHeart 6 | Same formulation as ProHeart 12 at lower concentration. Post-market: anaphylaxis (uncommon), vomiting, diarrhea, lethargy | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ec3ba375-9519-4a3d-afe3-eda451bb3488) |
| ProHeart 12 | Vomiting (25.3%), Lethargy (15.5%), Diarrhea (14.5%), Anorexia (13.8%), Seizures (3.4%), Hepatopathy (2.7%), Hypersalivation (2.4%), Anaphylactoid reactions (2.0%). Note: 605-day study inflates absolute rates; control group had similar rates (e.g. vomiting 26.4%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e856da36-f717-4645-8841-27460cf87d91) (n=297, 605 days) |
| Bravecto Quantum | Lethargy (4.9%), Decreased appetite (4.4%), Vomiting (4.0%), Diarrhea (2.7%), Elevated liver enzymes (2.7%), Pruritus (1.8%), Injection site lumps (1.3%), Seizures (0.9%) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=82f1fc7c-41f1-4a1d-8117-6d8eb9d0b54f) (FDA NADA 141-599, n=225, 455 days) |
| Drontal Plus | No drug-related side effects in field study (n=103). Lab studies: vomiting and soft stool at 5X dose | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=9ccf3782-220d-4e8e-95d0-8e79a9a909ae) |
| Panacur | Vomiting (~1%, 3/240 dogs). Prolonged off-label use: pancytopenia/bone marrow hypoplasia (12 reports as of Oct 2023) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=68790921-c3e3-4d99-b406-fe55b5549636); [FDA Dear Vet letter Apr 2024](https://www.fda.gov/animal-veterinary/product-safety-information/dear-veterinarian-letter-regarding-adverse-events-associated-extra-label-use-fenbendazole-dogs) |

### GI

| Medication | Side Effects | Sources |
|---|---|---|
| Metronidazole | Nausea/anorexia (common), Hypersalivation (common — bitter taste), Vomiting (common), Significant fecal microbiome dysbiosis lasting 4+ weeks (documented in healthy dogs). Neurotoxicity at high doses — ataxia, nystagmus, head tilt, seizures (uncommon, dose-dependent >60 mg/kg/day). No canine clinical trial with adverse event incidence percentages exists | [Pilla et al. 2020 JVIM](https://pubmed.ncbi.nlm.nih.gov/32856349/) (microbiome); [VCA monograph](https://vcahospitals.com/know-your-pet/metronidazole) |
| Cerenia | Hypersalivation (common), Vomiting unrelated to motion (common), Lethargy (uncommon). Motion sickness field study (8 mg/kg oral). Injection-site pain on subcutaneous administration (common). No canine incidence data for lower-dose acute vomiting indication. Note: specific percentages from original FOI could not be independently verified against study denominators | [FDA NADA 141-262 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/816) (motion sickness); [VCA monograph](https://vcahospitals.com/know-your-pet/maropitant-citrate) |
| Metoclopramide | Restlessness/hyperactivity (uncommon), Extrapyramidal signs — muscle spasms, twitching (uncommon, dose-dependent), Drowsiness (uncommon), Constipation (uncommon). No canine study with incidence percentages exists | [VCA monograph](https://vcahospitals.com/know-your-pet/metoclopramide) |
| Famotidine | Very well tolerated. Vomiting (rare), Diarrhea (rare), Decreased appetite (rare). No canine study with incidence percentages exists | [VCA monograph](https://vcahospitals.com/know-your-pet/famotidine) |
| Omeprazole | GI adverse effects (2 dogs with GI signs: one with diarrhea+hematochezia, one with nausea→vomiting→diarrhea), Hypergastrinemia — elevated gastrin in 100% of dogs by day 30 (clinically silent). Note: paper's AE section says "2 out of 11" but methods section states n=8 in omeprazole group — internal inconsistency in source | [Gil-Vicente et al. 2024 Animals](https://pubmed.ncbi.nlm.nih.gov/38672316/) (60-day trial; methods: n=8 omeprazole group, AE section: 2/11) |
| Sucralfate | Constipation (~2% — extrapolated from human data). Essentially no systemic side effects — not absorbed. Primary concern is drug interactions (binds other meds — separate by 2hrs) | [VCA monograph](https://vcahospitals.com/know-your-pet/sucralfate) |
| Misoprostol | Diarrhea (common, dose-dependent — most frequent adverse effect), Abdominal cramping (common), Vomiting (common), Abortion in pregnant animals (contraindicated). No canine study with specific incidence percentages exists | [VCA monograph](https://vcahospitals.com/know-your-pet/misoprostol); [Johnston et al. 1995 JAVMA](https://pubmed.ncbi.nlm.nih.gov/7891360/) |
| Budesonide | Polydipsia (common), Excessive panting (common), Polyuria (common), Increased appetite (common), Lethargy (uncommon), Elevated ALP/ALT (common). Note: adverse effect profile was not significantly different from prednisone in Dye et al. 2013 RCT (n=20 budesonide vs n=20 prednisone) — specific percentages may reflect combined cohort rather than budesonide-only | [Dye et al. 2013 JVIM](https://pubmed.ncbi.nlm.nih.gov/24112400/) (RCT, n=40 total) |
| Azathioprine | Hepatotoxicity/elevated ALT (5/34 with ALT follow-up = 15%), Bone marrow suppression — leukopenia, thrombocytopenia, anemia (4/48 with CBC follow-up = 8.3%), Anorexia (common), Vomiting (common), Diarrhea (common), Acute pancreatitis (uncommon). German Shepherds significantly overrepresented in hepatotoxicity cases. Requires regular CBC + liver monitoring | [Wallisch & Trepanier 2015 JVIM](https://pubmed.ncbi.nlm.nih.gov/25641386/) (52 dogs enrolled; different subsets had different follow-up); [Eberhardy et al. 2022 Vet Derm](https://pubmed.ncbi.nlm.nih.gov/36000613/) (n=41, alternate-day: hepatotox 4.9%) |
| Tylosin | Very well tolerated. Bitter taste (primary practical issue — requires capsule), Mild GI upset (rare), Fecal microbiome shifts (documented). Diarrhea recurs in ~55% within 20 days of discontinuation (retrospective owner-reported history) | [Kilpinen et al. 2011 Acta Vet Scand](https://pubmed.ncbi.nlm.nih.gov/21489311/) (Table 1, owner history, n=27); [Manchester et al. 2019 JVIM](https://pubmed.ncbi.nlm.nih.gov/31674054/) (microbiome, n=16) |
| Ondansetron | Very few side effects. Sedation/drowsiness (uncommon), Constipation (uncommon), Transient liver enzyme elevation (rare). No canine study with incidence percentages exists | [VCA monograph](https://vcahospitals.com/know-your-pet/ondansetron); [Foth et al. 2021 BMC Vet Res](https://pubmed.ncbi.nlm.nih.gov/34154584/) (n=16, no AEs reported) |
| Sulfasalazine | GI upset — nausea, vomiting, diarrhea (common), Keratoconjunctivitis sicca/dry eye (common with prolonged use — requires Schirmer test monitoring), Cholestatic jaundice (rare). No canine clinical trial with specific incidence percentages | [VCA monograph](https://vcahospitals.com/know-your-pet/sulfasalazine) |
| Mesalamine | Limited canine-specific data — no published canine clinical trials exist. Expected side effects extrapolated from sulfasalazine (same active moiety): GI upset, KCS/dry eye with prolonged use (requires Schirmer test monitoring — 5-ASA itself causes KCS in dogs per Barnett & Joseph 1987 toxicity study, not just the sulfonamide carrier). Nephrotoxicity (rare, from human 5-ASA data). All frequency estimates are theoretical, not from canine studies | [MSD Vet Manual — IBD drugs](https://www.msdvetmanual.com/pharmacology/systemic-pharmacotherapeutics-of-the-digestive-system/drugs-used-to-treat-inflammatory-bowel-disease-in-monogastric-animals); [Barnett & Joseph 1987 Hum Toxicol](https://pubmed.ncbi.nlm.nih.gov/3692495/) (5-ASA-induced KCS in dogs, 12-month study) |
| Loperamide | Constipation (common — expected effect), Bloat/GI distension (uncommon), Sedation (uncommon in normal dogs; severe in MDR1-mutant breeds — contraindicated). CNS toxicity in MDR1 breeds — ataxia, mydriasis, coma. MDR1 prevalence: ~70% Collies, ~50% Australian Shepherds | [VCA monograph](https://vcahospitals.com/know-your-pet/loperamide); [WSU MDR1 database](https://prime.vetmed.wsu.edu/mdr1caddie/) |
| Pancrelipase | Oral bleeding (reported — resolves with dose reduction), Diarrhea (uncommon — dose-related), Vomiting (uncommon), Perioral irritation from enzyme contact (uncommon) | [Rutz et al. 2002 JAVMA](https://pubmed.ncbi.nlm.nih.gov/12494968/) (3 EPI dogs with oral bleeding) |
| Clavamox | Vomiting (common), Diarrhea (common), Anorexia (uncommon). No canine clinical trial with specific incidence percentages | [VCA monograph](https://vcahospitals.com/know-your-pet/amoxicillin) |
| Cephalexin | Vomiting (common), Diarrhea (common), Anorexia (uncommon), Panting (uncommon). No canine clinical trial with specific incidence percentages. First-line for pyoderma secondary to allergies | [VCA monograph](https://vcahospitals.com/know-your-pet/cephalexin) |
| Cefpodoxime (Simplicef) | Vomiting (common), Diarrhea (common), Decreased appetite (uncommon). No canine clinical trial with specific incidence percentages. Once-daily convenience makes it a popular alternative to cephalexin for pyoderma | [VCA monograph](https://vcahospitals.com/know-your-pet/cefpodoxime) |
| Clindamycin (Antirobe) | Vomiting (common), Diarrhea (common), Anorexia (uncommon). No canine clinical trial with specific incidence percentages | [VCA monograph](https://vcahospitals.com/know-your-pet/clindamycin) |
| Convenia | Vomiting (common), Diarrhea (common), Lethargy (uncommon), Anorexia (uncommon). Single injection with 14-day duration — side effects cannot be stopped once administered. No canine clinical trial with specific incidence percentages | [VCA monograph](https://vcahospitals.com/know-your-pet/cefovecin) |
| Enrofloxacin (Baytril) | Vomiting (common), Diarrhea (common), Anorexia (uncommon), Retinal toxicity at high doses (rare — avoid in cats). No canine clinical trial with specific incidence percentages | [VCA monograph](https://vcahospitals.com/know-your-pet/enrofloxacin) |

### Pain / NSAID

| Medication | Side Effects | Sources |
|---|---|---|
| Metacam | Vomiting (16.7–29.4%), Diarrhea/soft stool (6.3–13.8%), Inappetence (2.8–4.2%), GI ulceration (rare — at 3–5X dose), Elevated liver enzymes (rare). Note: high raw vomiting rate includes background; Study #1 placebo was 13.0% | [FDA NADA 141-213 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/736) (Study #1 n=109 treated, Study #2 n=48 treated); [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c27c35d7-07e1-47d4-97cd-ed1fb17750ce) |
| Rimadyl | Oral caplets (OA, 2 mg/lb QD): Vomiting (3.1% — similar to 3.8% placebo), Diarrhea (3.1%), Inappetence (1.6%), Elevated ALP (7.8%), Elevated ALT (5.4%). Caplets (postop, 2 mg/lb QD): Vomiting (10.1%). Post-market: hepatic toxicity (rare — ~25% of hepatic AE reports involved Labradors), GI ulceration (rare), IMHA (rare) | [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=dbc05493-d1cc-4c00-be6b-d1e3352273fd) (OA n=129 vs n=132 placebo; postop n=148 vs n=149 placebo) |
| Previcox | Vomiting (3.9%), Decreased appetite (2.3%), Diarrhea (0.8%), Lethargy (0.8%). Active control (etodolac) had higher rates: diarrhea 8.3%, vomiting 6.6%. GI ulceration rare at supratherapeutic doses | [FDA NADA 141-230 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/768) (n=128 treated vs n=121 etodolac) |
| Deramaxx | Postop (3–4 mg/kg): Vomiting (10.5%), Diarrhea (5.7%), Hematochezia (3.8%), Hematuria (1.9%), Elevated ALT (2.9%). OA (1–2 mg/kg): Vomiting (2.9%), Diarrhea (2.9%) — comparable to placebo | [FDA NADA 141-203 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/717) (postop n=105); [FDA NADA 141-203 OA supplement FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/718) (OA n=105+104) |
| Onsior | Diarrhea/soft stool (5.0%), Vomiting (5.0%), Decreased appetite (2.5%), Weight loss (0.8%). Post-market (foreign): elevated liver enzymes, hepatic necrosis, and death reported with long-term use | [EMA EPAR](https://www.ema.europa.eu/en/medicines/veterinary/EPAR/onsior) (n=119 treated, n=120 control); [DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=onsior) |
| Galliprant | Vomiting (17.0% vs 6.3% placebo), Diarrhea/soft stool (12.1% vs 9.0%), Anorexia (6.4% vs 4.9%), Lethargy (4.3% vs 1.4%), Buccal ulcer (0.7%), IMHA (0.7%) | [FDA NADA 141-455 FOI](https://animaldrugsatfda.fda.gov/adafda/app/search/public/document/downloadFoi/941) (n=141+144); [EMA EPAR](https://www.ema.europa.eu/en/medicines/veterinary/EPAR/galliprant) |
| Librela | UTI (11.1%), Bacterial skin infection (8.1%), Dermatitis (7.4%), Dermal mass (5.9%), Erythema (4.4%), Injection site pain (3.0%), Elevated BUN (3.7%). Post-market: neurologic events (ataxia, seizures, paresis, paralysis), musculoskeletal adverse events, death/euthanasia (reported). AE rate ~9.5/10,000 doses | [VCA monograph](https://vcahospitals.com/know-your-pet/bedinvetmab) (n=135+137); [FDA Dear Vet letter Dec 2024](https://www.fda.gov/animal-veterinary/product-safety-information/dear-veterinarian-letter-notifying-veterinarians-about-adverse-events-reported-dogs-treated-librela) |
| Gabapentin | Sedation (41.6% overall; more likely at doses >30 mg/kg), Agitation (24%), Ataxia (18%), Increased activity (14%), Aggression (6–8%), Increased appetite (6%), Diarrhea (4%). 30% showed no side effects. Retrospective owner survey, not a controlled trial | [Kirby-Madden et al. 2024 Animals](https://pubmed.ncbi.nlm.nih.gov/38791679/) (n=50); not FDA-approved for dogs |
| Tramadol | Sedation (common), Nausea/vomiting (common), Constipation (common), Diarrhea (common), Anxiety/agitation (uncommon). Serotonin syndrome risk with SSRIs/MAOIs (rare). No canine clinical trial with reliable incidence percentages — systematic review of 26 RCTs (848 dogs) found AE reporting was "inconsistently reported" with "very low" certainty | [Donati et al. 2021 Vet Anaesth Analg](https://pubmed.ncbi.nlm.nih.gov/33745825/) (systematic review, 26 RCTs); not FDA-approved for dogs |

### Steroid

| Medication | Side Effects | Sources |
|---|---|---|
| Prednisone | Any behavioral change (74% by day 5, 90% by day 14), Increased water consumption (common — 55% reported filling bowl 2x+ as often by day 5), Polyphagia (~47%, derived from Tables 4/5), Panting (~50%, derived from Tables 4/5), Urinary accidents (23–35% by day 14), Behavioral changes — anxiety, aggression, restlessness (26–36% by day 14), Muscle wasting (chronic use), Steroid hepatopathy/elevated ALP (chronic use), Skin thinning (chronic use), Iatrogenic Cushing's (chronic use). Note: Gober & Hillier was a small prospective survey (n=31). Elkholly et al. 2020 VetCompass (n=3,000) found only 4.9% had any recorded side effect; among those, polydipsia was 39.2% and polyuria 28.4% of presenting signs | [Gober & Hillier 2023 BMC Vet Res](https://pubmed.ncbi.nlm.nih.gov/37488543/) (n=31 prospective owner survey); [Elkholly et al. 2020 Front Vet Sci](https://pubmed.ncbi.nlm.nih.gov/32923470/) (VetCompass, n=3,000) |
| Prednisolone | Same active metabolite as prednisone — identical side effect profile. Preferred over prednisone for dogs with hepatic insufficiency (prednisone requires hepatic conversion). See prednisone data above | [Gober & Hillier 2023 BMC Vet Res](https://pubmed.ncbi.nlm.nih.gov/37488543/) (study used both prednisone and prednisolone) |
| Dexamethasone | ~5-7X more potent than prednisone (~25X hydrocortisone) — same side effect categories (PU/PD, polyphagia, panting, behavioral changes) but at proportionally lower doses. Immunosuppression, GI ulceration risk, adrenal suppression. No separate canine clinical trial with incidence percentages — potency-adjusted, expect similar or higher rates than prednisone | [MSD Vet Manual — corticosteroids](https://www.msdvetmanual.com/pharmacology/inflammation/corticosteroids-in-animals) (potency table); [VCA monograph](https://vcahospitals.com/know-your-pet/dexamethasone) (general side effects) |

**Notes on data quality:**
- **VCA frequency labels are editorial:** VCA monographs list side effects but do not assign frequency categories (common/uncommon/rare). Where a VCA monograph is the sole source, frequency labels in this doc are pharmacological interpretations based on clinical consensus, NOT from the cited source. Entries sourced from FDA FOI/DailyMed/EMA use frequencies from those regulatory documents. Entries sourced only from VCA that use frequency labels: Diphenhydramine, Hydroxyzine, Cetirizine, Metoclopramide, Famotidine, Sulfasalazine, Loperamide, Clavamox, Cephalexin, Cefpodoxime, Clindamycin, Convenia, Enrofloxacin.
- Ranges (e.g., 16.7–29.4%) indicate variation across multiple field studies for the same drug.
- ProHeart 12's high rates partly reflect its 605-day study duration vs. 90-day studies for most oral parasite products. Control group had similar rates.
- Budesonide's adverse effect profile was not significantly different from prednisone in the Dye et al. 2013 controlled trial, despite its "locally acting" designation. Specific percentages (50% polydipsia, 40% panting) may reflect combined cohort rates rather than budesonide-only — use qualitative frequencies for side effects string.
- Librela's post-market neurologic reports prompted an [FDA Dear Veterinarian letter in December 2024](https://www.fda.gov/animal-veterinary/product-safety-information/dear-veterinarian-letter-notifying-veterinarians-about-adverse-events-reported-dogs-treated-librela).
- Metacam's previous entry incorrectly cited 3.1% vomiting (from Rimadyl's label). Corrected to actual FOI data: 16.7–29.4%.
- Tramadol: Donati et al. 2021 systematic review (26 RCTs, 848 dogs) confirms no reliable incidence data exists.
- Credelio Plus side effects (8.8%/8.2%) sourced from US field study (n=159) in the [Health Canada product monograph](https://pdf.hres.ca/dpd_pm/00064937.PDF), not from the EMA EPAR. Now confirmed: 14/159 diarrhea, 13/159 vomiting.
- Zenrelia: FDA issued [warning letter to Elanco (Jan 28, 2025)](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/elanco-animal-health-695170-01282025) for misbranding — downplaying vaccine warnings, misrepresenting cause of death of study dog, and publishing lower AE rates than the FDA-approved PI. Sep 2025 label update removed "fatal vaccine-induced disease" language but retained boxed warning about inadequate immune response and the discontinuation timeline (28d-3mo before, 28d after vaccination).

---

## Navigation Changes

**Mobile bottom nav** stays at 5 items: **Home, Food, [Log], Insights, Meds**

The current Settings slot is replaced by **Meds** (pill icon). Settings access moves to the header (gear icon next to theme toggle) or is accessible from the dog profile page. This avoids the complexity and touch-UX issues of a popover near the bottom nav edge.

**Desktop top nav** has room for everything flat: Home, Food, Insights, Meds, Settings (icon-only, as it currently is).

---

## Meds Page (`/dogs/[id]/meds`)

Dedicated page for medication management. Medications are **removed from the routine editor**. Daily check-in keeps a read-only "Medications" accordion showing active meds as an FYI.

### Layout
- **Active meds** at top — card list of medications with no `endDate` (ongoing)
- **Past meds** below — card list of medications with `endDate`, reverse chronological
- **Add medication** button

### Medication Card
Same visual pattern as food cards (no picture/stats). Shows:
- Medication name (from catalog or free-text)
- Dosage (e.g. "4.25mg")
- Interval (e.g. "Daily")
- Start date
- End date (past meds only)
- Tap to edit

### Add/Edit Medication
- **Medication picker**: searchable from catalog (67 meds) + free-text fallback for unlisted meds
- **Dosage**: free text (e.g. "4.25mg", "1 tablet")
- **Interval**: dropdown from `dosing_interval` enum (pre-filled from catalog `default_intervals` if picking from catalog)
- **Start date**: date picker (defaults to today)
- **End date**: optional date picker (null = ongoing)
- **Notes**: optional free text
- **Remove**: sets end date to today (or a picked date) — soft delete, preserves history
- No reason field — catalog meds derive context from `medication_products.category`, free-text meds use notes
- No impact assessment — users see the effect in their stool/itch data directly

### History View
Simple chronological list (like the home page log feed but only meds). Each past med card shows the date range it was active. No timeline visualization initially — just the card list sorted by end date descending.

---

## Correlation Engine — Report Only (No Score Adjustments)

Medications are the #1 confounding variable in food → poop/itch correlation, but actually adjusting scores is impractical: meds that *treat* GI issues vs meds that *cause* GI side effects require opposite adjustments, many dogs are on long-term meds so excluding those days loses most data, and there's no calibration data for weighting. Instead, **report medication context alongside scores** so users can interpret it themselves.

The structured `category` field tells us what each medication impacts:

| Category | Confounds |
|---|---|
| gi | poop scores |
| pain (NSAIDs) | poop scores (GI side effects) |
| allergy | itch scores |
| steroid | both poop and itch |
| parasite | poop scores (some cause GI upset) |

**Decision: No calculation changes.** Remove `onDigestiveMedication` / `onItchnessMedication` flags from the correlation engine entirely — they were premature infrastructure that nothing uses. Remove `excludeMedicationPeriods` option too. The engine stops fetching/processing medications. If Phase 5 scorecard caveats are built later, they'll query medications + catalog directly rather than pre-computing per-day flags.

### Reporting enhancements (display-only, future):
- [ ] On scorecard: show caveat badge when a medication started/stopped during the feeding period (e.g. "GI medication changed" on poop scores, "Allergy medication changed" on itch scores) — uses `medication_products.category` to pick the right caveat
- [ ] Surface medication timeline alongside poop/itch score charts so users can visually spot medication-driven changes

### Deferred (revisit if needed):
- Optionally exclude medication-change periods from correlation calculations
- Weight/discount scores during medication periods

---

## Approach

Four sequential phases. Phase 1 is schema + seed data (backend only). Phase 2 surgically removes medications from all existing UI/engine code. Phase 3 adds navigation. Phase 4 builds the new Meds page UI. Each phase should `yarn build` cleanly before moving to the next.

### Technologies & APIs
- Drizzle ORM (schema, enums, migrations)
- PostgreSQL (via Docker container `mydoglog-db-dev`, port 5433)
- psycopg2-binary (Python seed script, raw SQL upserts)
- shadcn/ui (Card, Button, Input, Select, Popover, Command for searchable picker)
- Line Awesome icons via `react-icons/lia` (LiaPillsSolid or similar)
- ResponsiveModal pattern (Drawer on mobile, Dialog on desktop)

### Key Areas

**Phase 1 files:**
- `scraper/data/medications.json` — **new** seed data file (67 medications)
- `scraper/seed_medications.py` — **new** seed script
- `scraper/build.py` — add call to `seed_medications.py`
- `src/lib/db/schema.ts` — new enums + `medicationProducts` table + modify `medications` table

**Phase 2 files (removals):**
- `src/components/routine-editor.tsx` — remove medication section
- `src/components/daily-checkin.tsx` — remove medication display from routine accordion, add separate read-only "Medications" accordion section
- `src/components/active-plan-card.tsx` — remove medications prop
- `src/components/medication-item.tsx` — **delete entirely** (Phase 4 creates new `medication-card.tsx`)
- `src/app/(app)/dogs/[id]/food/page.tsx` — remove medication fetch/state
- `src/app/api/dogs/[id]/food/routine/route.ts` — remove medications from response
- `src/lib/labels.ts` — remove `MEDICATION_REASON_LABELS`
- `src/lib/types.ts` — update `MedicationSummary`, remove `medications` from `RoutineData`
- `src/lib/routine.ts` — remove `getActiveMedicationsForDog()`
- `src/lib/correlation/types.ts` — remove medication flags/interfaces
- `src/lib/correlation/engine.ts` — remove medication logic
- `src/lib/correlation/query.ts` — remove medication query
- `src/lib/correlation/engine.test.ts` — remove medication tests
- `src/app/api/dogs/[id]/medications/route.ts` — update for new schema
- `src/app/api/medications/[id]/route.ts` — update for new schema

**Phase 3 files (navigation):**
- `src/app/(app)/nav-links.tsx` — replace Settings bottom nav slot with Meds (mobile), add Meds flat link on desktop, move Settings access to header/dog profile
- `src/app/(app)/dogs/[id]/meds/page.tsx` — **new** page route

**Phase 4 files (UI):**
- `src/components/medication-picker.tsx` — **new** searchable catalog + free-text
- `src/components/medication-form.tsx` — **new** add/edit form in ResponsiveModal
- `src/components/medication-card.tsx` — **new** display card
- `src/app/(app)/dogs/[id]/meds/page.tsx` — full page implementation
- `src/app/api/medication-products/route.ts` — **new** GET endpoint for catalog search

---

## Build Steps

### Phase 1: Schema + Seed Data

1. Create `scraper/data/medications.json` with all 67 medications from the catalog tables above. Structure each entry with: `name`, `generic_name`, `manufacturer`, `category`, `drug_class`, `dosage_form`, `default_intervals` (array), `description`, `common_side_effects` (pre-formatted string or null — populated from the "Common Side Effects by Medication" section for all 67 meds, e.g. `"Vomiting (17%), Diarrhea (12.1%)"`). Stored as-is, rendered as-is.
   **Verify**: JSON is valid, has 67 entries, counts match (13 allergy, 21 parasite, 21 GI, 9 pain, 3 steroid).

2. Add three new enums to `schema.ts`: `medicationCategoryEnum` (allergy, parasite, gi, pain, steroid), `dosageFormEnum` (tablet, chewable, capsule, liquid, injection, topical, spray, powder, gel, collar), `dosingIntervalEnum` (15 values from spec).
   **Verify**: Enums defined, no TypeScript errors.

3. Add `medicationProducts` table to `schema.ts` with fields matching spec: `id` (text PK), `name`, `genericName`, `manufacturer` (nullable), `category` (enum), `drugClass` (nullable), `dosageForm` (enum), `defaultIntervals` (array of enum), `description` (nullable), `commonSideEffects` (text, nullable — pre-formatted string), `createdAt`.
   **Verify**: Table definition compiles.

4. Modify `medications` table in `schema.ts`: add `medicationProductId` (optional FK → medicationProducts.id), add `interval` (dosingIntervalEnum, nullable). Remove `reason` column and `medicationReasonEnum`.
   **Verify**: Schema compiles, no references to `reason` or `medicationReasonEnum` remain in schema.

5. Run `yarn db:generate` to create migration. Manually edit migration SQL to: (a) add the three new enums, (b) create `medication_products` table, (c) `DELETE FROM medications` to nuke existing records, (d) alter `medications` table (add columns, drop `reason` column + enum). Run migration locally.
   **Verify**: `docker exec mydoglog-db-dev psql -U mydoglog -d mydoglog -c "\d medication_products"` shows correct columns. `SELECT count(*) FROM medications` returns 0.

6. Create `scraper/seed_medications.py`: reads `medications.json`, connects to PostgreSQL (same connection pattern as `build.py` — localhost:5433, user mydoglog), upserts each medication into `medication_products` using `ON CONFLICT (name) DO UPDATE` (match on name since these are hand-maintained). Generate UUIDs with `uuid.uuid4()`.
   **Verify**: `uv run python seed_medications.py` succeeds. `SELECT count(*) FROM medication_products` returns 67.

7. Add call to `seed_medications.py` at the end of `build.py` (import and call the seed function, or subprocess call).
   **Verify**: `cd scraper && uv run python build.py` completes without error, medication_products still has 67 rows.

8. `yarn build` succeeds (will likely fail until Phase 2 removes `reason` references — that's expected, just note it).

### Phase 2: Remove Meds from Existing UI

1. **Schema cleanup**: Remove `medicationReasonEnum` from `schema.ts` (already done in Phase 1 step 4, but verify no lingering references).
   **Verify**: `grep -r "medicationReason" src/` returns nothing.

2. **Types**: In `types.ts`, update `MedicationSummary` — remove `reason`, add `medicationProductId: string | null` and `interval: string | null`. Remove `medications` field from `RoutineData`.
   **Verify**: TypeScript compiles for types.ts.

3. **Labels**: Remove `MEDICATION_REASON_LABELS` from `labels.ts`.
   **Verify**: No imports of `MEDICATION_REASON_LABELS` remain.

4. **Routine helpers**: In `routine.ts`, remove `getActiveMedicationsForDog()` function entirely.
   **Verify**: No imports of `getActiveMedicationsForDog` remain.

5. **Routine API**: In `food/routine/route.ts`, remove the medications fetch. Return only `{ plan }` (no `medications` key).
   **Verify**: Route compiles.

6. **Components — routine-editor.tsx**: Remove all medication state (`medications`, `editingMedication`, etc.), medication handlers (`saveMedications`, medication form fields), and medication render sections. Keep only food plan editing.
   **Verify**: Component compiles, no medication imports remain.

7. **Components — daily-checkin.tsx**: Remove medication display from the routine accordion section. Add a **separate** read-only "Medications" accordion section that fetches active medications directly via `GET /api/dogs/[id]/medications` (not from RoutineData). Shows each active med's name, dosage, and interval as a simple list — informational only, no edit controls. If no active medications, hide the section entirely.
   **Verify**: Component compiles. Active meds show in their own accordion. No meds = no section.

8. **Components — active-plan-card.tsx**: Remove `medications` prop and medication display section.
   **Verify**: Component compiles.

9. **Components — medication-item.tsx**: Delete this file entirely. Phase 4 creates a new `medication-card.tsx` with a different design (shows interval, dates, tap-to-edit). The old badge-style component won't be reused.
   **Verify**: No imports of `medication-item` remain anywhere.

10. **Food page**: In `food/page.tsx`, remove `activeMedications` state, remove medication fetch logic, stop passing meds to `ActivePlanCard`.
    **Verify**: Page compiles.

11. **Correlation engine — types.ts**: Remove `onItchinessMedication` and `onDigestiveMedication` from `DayOutcome`. Remove `excludeMedicationPeriods` from options. Remove `RawMedication` interface. Remove `medications` from `CorrelationInput`.
    **Verify**: Types compile.

12. **Correlation engine — engine.ts**: Remove medication flag computation, medication period exclusion logic, and medication flags from backfill outcome construction.
    **Verify**: Engine compiles.

13. **Correlation engine — query.ts**: Remove medication fetch query and `medications` import from schema.
    **Verify**: Query module compiles.

14. **Correlation engine — engine.test.ts**: Remove medication-specific tests, remove `medications: []` from test fixtures, remove medication flags from `emptyOutcome` and other test helpers.
    **Verify**: `yarn test` passes.

15. **API routes**: Update `api/dogs/[id]/medications/route.ts` and `api/medications/[id]/route.ts` — remove `reason` field handling, add `medicationProductId` and `interval` to POST/PATCH handlers.
    **Verify**: API routes compile.

16. `yarn build` succeeds. `yarn test` passes.
    **Verify**: Clean build output, all tests green.

### Phase 3: Navigation

1. Read `docs/mydoglog-branding.md` for design system reference before any UI work.

2. **Mobile nav**: In `nav-links.tsx`, replace the Settings bottom nav slot with "Meds" linking to `/dogs/[id]/meds`. Use a pill icon (`LiaPillsSolid` or similar from `react-icons/lia`). Settings access moves to the header area (gear icon next to theme toggle in `DesktopNavLinks`, or accessible from dog profile). The current Settings icon (`LiaDogSolid`) is already rendered as an icon-only link on desktop (line 82) — this pattern works for a header gear icon too.
   **Verify**: Mobile bottom nav shows Home, Food, Log, Insights, Meds. Settings still accessible.

3. **Desktop nav**: Add "Meds" as a flat link in the desktop top nav bar (between Insights and Settings). Links to `/dogs/[id]/meds`. Keep Settings as the final item (icon-only as it currently is).
   **Verify**: Desktop nav shows Home, Food, Insights, Meds, Settings.

4. **Create page route**: Create `src/app/(app)/dogs/[id]/meds/page.tsx` as a minimal placeholder (page title + empty state).
   **Verify**: Navigating to `/dogs/[id]/meds` renders without error. `yarn build` succeeds.

### Phase 4: Meds Page UI

1. Read `docs/mydoglog-branding.md` again for component patterns and color tokens.

2. **Catalog API**: Create `src/app/api/medication-products/route.ts` — GET endpoint that returns all 67 medications from `medication_products` table, optionally filtered by search query param. Used by the medication picker.
   **Verify**: `curl` returns 67 medications. Search param filters correctly.

3. **Medication picker component**: Create `src/components/medication-picker.tsx` — searchable list using shadcn Command component. Shows catalog medications grouped or filtered by search. At the bottom, a "Use custom name" option that switches to free-text input. When a catalog med is selected, pre-fill `interval` from `default_intervals[0]`. Return selected medication product (or free-text name) to parent.
   **Verify**: Component renders, search filters catalog, free-text fallback works, selection returns correct data.

4. **Medication form component**: Create `src/components/medication-form.tsx` — add/edit form inside ResponsiveModal (Drawer on mobile, Dialog on desktop). Fields: medication picker (step 3), dosage (text input), interval (Select dropdown from `dosingIntervalEnum` values — pre-filled from catalog if applicable), start date (date picker, defaults to today), end date (optional date picker), notes (optional textarea). On save: POST to `/api/dogs/[id]/medications` (new) or PATCH to `/api/medications/[id]` (edit). On "Stop medication": PATCH with endDate = today.
   **Verify**: Form opens in drawer (mobile) / dialog (desktop). Can create catalog med, create free-text med, edit existing med, stop a med.

5. **Medication card component**: Create `src/components/medication-card.tsx` — displays a single medication. Shows: name, dosage, interval label, start date, end date (if past). Tap opens edit form. Same visual density as food cards (no picture/stats). Use pill icon from Line Awesome.
   **Verify**: Card renders correctly for both active (no end date) and past (with end date) medications.

6. **Meds page**: Implement `src/app/(app)/dogs/[id]/meds/page.tsx` fully. Fetches medications via GET `/api/dogs/[id]/medications`. Splits into active (endDate is null) and past (endDate is not null). Active meds at top as card list. Past meds below, sorted by endDate descending. "Add medication" button opens the form. Page title: "Medications".
   **Verify**: Page loads, shows active/past sections, add button works, cards are tappable for edit.

7. **Interval display labels**: Add human-readable labels for `dosingIntervalEnum` values to `labels.ts` (e.g., `twice_daily` → "Twice daily", `every_3_months` → "Every 3 months", `as_needed` → "As needed").
   **Verify**: Interval labels display correctly on medication cards and in the interval dropdown.

8. **Final build**: `yarn build` succeeds. Manual test: navigate to Meds page, add a catalog medication (e.g., "Zenrelia"), add a free-text medication, edit one, stop one, verify it moves to past section.
   **Verify**: Full CRUD flow works end-to-end. Build is clean.

### Phase 5: Scorecard Caveats (display-only, future)
- [ ] Detect med start/stop during feeding period in scorecard API
- [ ] Show caveat badges on scorecard UI using `medication_products.category`

---

## Risks & Considerations
- **Migration order matters**: The migration must create enums and `medication_products` table BEFORE altering `medications` (FK dependency). The `DELETE FROM medications` must happen BEFORE dropping the `reason` column.
- **Drizzle enum arrays**: `defaultIntervals` on `medication_products` is an array of enum values. Drizzle supports this via `dosingIntervalEnum().array()` — verify this generates correct SQL.
- **Phase 2 is destructive to existing UI**: Many components change simultaneously. Do Phase 2 in one pass and verify `yarn build` at the end, not piecemeal (intermediate states will have broken imports).
- **The `medications` table `name` column stays**: Both catalog and free-text meds store the display name directly. For catalog meds, copy from `medication_products.name` at creation time.
- **Settings relocation**: Moving Settings out of the bottom nav means it needs a new home. A gear icon in the header (next to theme toggle) is the simplest option. Verify it's discoverable.

## If Blocked
- If Drizzle enum array type doesn't work: use `text().array()` instead and validate values at the application layer
- If migration fails: check enum creation order — enums must exist before tables that reference them
- If `seed_medications.py` can't connect: verify Docker container is running (`docker ps | grep mydoglog-db-dev`) and port 5433 is exposed
- If Settings in the header feels hidden: add a "Settings" link at the bottom of the Meds page or dog profile page as a secondary access point
- If tests fail after 3 attempts: document what's failing and stop
- If `yarn build` fails on type errors after Phase 2: likely a missed reference to removed types — grep for the specific type name and clean up

---
**Completion Signal**: When ALL "Definition of Done" items are checked and verified, output: RALPH_COMPLETE
