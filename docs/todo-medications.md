# Medications Feature — Final Spec

Research completed 2026-03-06 via 6 parallel agents + 4 audit agents. Scoped to medications that impact GI or allergies (the app's core tracking loop). Users can still log other medications via free-text.

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
| default_intervals | text[] | Array of dosing_interval values |
| description | text nullable | Standalone, no cross-references |
| created_at | timestamp | |

### `medication_category` enum
allergy, parasite, gi, pain, steroid

### `dosage_form` enum
tablet, chewable, capsule, liquid, injection, topical, spray, powder, gel, collar

### `dosing_interval` enum
four_times_daily, three_times_daily, twice_daily, daily, every_other_day, weekly, biweekly, monthly, every_6_weeks, every_8_weeks, every_3_months, every_6_months, every_8_months, annually, as_needed

### Modify `medications` table (user log)
- Add `medication_product_id` (optional FK -> medication_products.id)
- Add `interval` (dosing_interval enum, nullable)
- Add `digestive_impact` (impact enum: better / no_change / worse, nullable) — subjective assessment when stopping a medication
- Add `itchiness_impact` (impact enum: better / no_change / worse, nullable) — same enum

---

## Allergy (6)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Zenrelia | ilunocitinib | Elanco | tablet | daily | JAK1/JAK2/TYK2 inhibitor for canine atopic dermatitis. #1 reported side effect is GI (diarrhea, vomiting). Immunosuppressive. |
| Apoquel | oclacitinib | Zoetis | tablet | twice_daily, daily | JAK1 inhibitor for canine atopic dermatitis. Typically twice daily for 14 days then once daily maintenance. |
| Cytopoint | lokivetmab | Zoetis | injection | monthly, every_6_weeks, every_8_weeks | Anti-IL-31 monoclonal antibody injection administered at vet clinic. Blocks itch signal only, not broader inflammation. GI safety comparable to placebo. |
| Atopica | cyclosporine | Elanco | capsule | daily | Immunosuppressant (calcineurin inhibitor) for canine atopic dermatitis. Slower onset (4-6 weeks). GI side effects (vomiting, diarrhea) are common. Give 1hr before or 2hr after meals. |
| Cortavance | hydrocortisone aceponate | Virbac | spray | daily | Topical corticosteroid spray for inflammatory and pruritic skin conditions. Short-course (7 consecutive days). Minimal systemic absorption. For localized flares/hot spots. |
| Genesis Spray | triamcinolone acetonide | Virbac | spray | daily | Topical corticosteroid spray for pruritus associated with allergic dermatitis. FDA-approved veterinary product. Different active ingredient than Cortavance. |

---

## Parasite Prevention (21)

### Oral flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Simparica Trio | sarolaner/moxidectin/pyrantel | Zoetis | chewable | monthly | Flea, tick, heartworm, roundworm, and hookworm prevention. |
| Simparica | sarolaner | Zoetis | chewable | monthly | Flea and tick prevention. |
| NexGard | afoxolaner | Boehringer Ingelheim | chewable | monthly | Flea and tick prevention. |
| NexGard PLUS | afoxolaner/moxidectin/pyrantel | Boehringer Ingelheim | chewable | monthly | Flea, tick, heartworm, roundworm, and hookworm prevention. FDA approved 2023. |
| NexGard Spectra | afoxolaner/milbemycin oxime | Boehringer Ingelheim | chewable | monthly | Flea, tick, heartworm, roundworm, hookworm, and whipworm prevention. |
| Bravecto | fluralaner | Merck | chewable | every_3_months | Flea and tick prevention with 12-week dosing interval. Also available as topical. |
| Credelio | lotilaner | Elanco | chewable | monthly | Flea and tick prevention. |
| Credelio Plus | lotilaner/milbemycin oxime | Elanco | chewable | monthly | Flea, tick, heartworm, and roundworm prevention. Also treats demodicosis. |
| Credelio Quattro | lotilaner/moxidectin/praziquantel/pyrantel | Elanco | chewable | monthly | Flea, tick, heartworm, roundworm, hookworm, and tapeworm prevention. The only isoxazoline combo that covers tapeworms. FDA approved October 2024. |

### Topical flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Revolution | selamectin | Zoetis | topical | monthly | Flea, heartworm, ear mite, and sarcoptic mange prevention. Also treats roundworms. |
| Advantage Multi | imidacloprid/moxidectin | Elanco | topical | monthly | Flea, heartworm, roundworm, hookworm, whipworm, and lungworm prevention. |
| K9 Advantix II | imidacloprid/permethrin/pyriproxyfen | Elanco | topical | monthly | Flea, tick, mosquito, biting fly, and lice treatment. Repels and kills on contact. TOXIC TO CATS. |
| Frontline Plus | fipronil/(S)-methoprene | Boehringer Ingelheim | topical | monthly | Flea and tick treatment. Older product, now somewhat superseded by isoxazolines. |

### Collar

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Seresto | imidacloprid/flumethrin | Elanco | collar | every_8_months | Flea and tick prevention collar providing up to 8 months of protection. One of the most widely used flea/tick products by volume. Regulated by EPA (pesticide), not FDA. |

### Heartworm-focused

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Heartgard Plus | ivermectin/pyrantel | Boehringer Ingelheim | chewable | monthly | Heartworm, roundworm, and hookworm prevention. |
| Interceptor Plus | milbemycin oxime/praziquantel | Elanco | chewable | monthly | Heartworm, roundworm, hookworm, whipworm, and tapeworm prevention. |
| ProHeart 6 | moxidectin (sustained-release) | Zoetis | injection | every_6_months | Injectable heartworm preventative providing 6 months of protection. Also treats hookworms. Administered by veterinarian. |
| ProHeart 12 | moxidectin (sustained-release) | Zoetis | injection | annually | Injectable heartworm preventative providing 12 months of protection. Also treats hookworms. FDA approved 2019. US only (not available in Canada). Administered by veterinarian. |

### Injectable flea/tick

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Bravecto Quantum | fluralaner (extended-release) | Merck | injection | annually | First annual flea and tick injectable for dogs. Single subcutaneous dose provides 12 months of protection. Approved in Canada 2025. Administered by veterinarian. |

### Dewormers

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Drontal Plus | praziquantel/pyrantel/febantel | Elanco | tablet | as_needed | Broad-spectrum dewormer for tapeworms (including Echinococcus), hookworms, roundworms, and whipworms. Treatment-focused, not a monthly preventative. |
| Panacur | fenbendazole | Merck | powder | daily | Broad-spectrum dewormer for roundworms, hookworms, whipworms, and Taenia tapeworms. Given over 3-5 consecutive days. Also used off-label for Giardia. |

---

## GI (15)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Metronidazole | metronidazole | generic | tablet | twice_daily | Antibiotic and antiprotozoal for GI infections, Giardia, and inflammatory bowel disease. Also known as Flagyl. Very bitter taste; do not crush. |
| Cerenia | maropitant citrate | Zoetis | tablet | daily | Anti-nausea and anti-vomiting medication. The only veterinary-approved antiemetic for dogs. Also available as injection at vet clinic. |
| Metoclopramide | metoclopramide | generic | tablet | twice_daily, three_times_daily | Prokinetic and antiemetic that stimulates gastric motility and prevents esophageal reflux. One of the most commonly prescribed canine GI medications. Also known as Reglan. |
| Famotidine | famotidine | generic | tablet | daily, twice_daily | H2-receptor antagonist acid reducer for gastritis and acid reflux. Available over-the-counter (Pepcid). Best given on empty stomach before meals. |
| Omeprazole | omeprazole | generic | capsule | daily | Proton pump inhibitor for ulcers and severe acid reflux. Available over-the-counter (Prilosec). Do not crush capsules. |
| Sucralfate | sucralfate | generic | tablet | twice_daily, three_times_daily, four_times_daily | Coats and protects stomach and intestinal lining. Give on empty stomach, separated from other meds by 2 hours. Also known as Sulcrate/Carafate. Also available as liquid suspension. |
| Misoprostol | misoprostol | generic | tablet | twice_daily, three_times_daily, four_times_daily | Prostaglandin E1 analog gastroprotectant used to prevent NSAID-induced gastric ulceration. Commonly co-prescribed with long-term NSAID therapy. Also known as Cytotec. |
| Budesonide | budesonide | generic | capsule | daily | Locally-acting corticosteroid for inflammatory bowel disease. High first-pass hepatic metabolism means fewer systemic side effects. Do not open or crush capsules. |
| Azathioprine | azathioprine | generic | tablet | daily, every_other_day | Immunosuppressive for inflammatory bowel disease when steroids alone are insufficient. Standard second-line IBD therapy. Also known as Imuran. Requires regular blood monitoring. |
| Tylosin | tylosin tartrate | Elanco | powder | daily, twice_daily | Macrolide antibiotic for chronic diarrhea and antibiotic-responsive enteropathy. Extremely bitter; often placed in gelatin capsules for dosing. Also known as Tylan. Labeled for livestock; canine use is off-label. |
| Ondansetron | ondansetron | generic | tablet | twice_daily, three_times_daily | 5-HT3 serotonin receptor antagonist antiemetic for severe nausea and vomiting. Also known as Zofran. Use caution in MDR1-positive breeds (collies, sheepdogs). |
| Sulfasalazine | sulfasalazine | generic | tablet | twice_daily, three_times_daily | Anti-inflammatory for large bowel disease (colitis) and vasculitis. Also known as Salazopyrin. Requires tear testing (Schirmer test) due to risk of dry eye. Give with food. |
| Mesalamine | mesalamine | generic | tablet | twice_daily | 5-ASA anti-inflammatory for colitis. Same active component as sulfasalazine but without the sulfonamide carrier, eliminating the risk of dry eye (KCS). Also known as Asacol/Pentasa. |
| Loperamide | loperamide | generic | tablet | twice_daily, three_times_daily | Antidiarrheal that slows intestinal motility. Available over-the-counter (Imodium). CONTRAINDICATED in dogs with MDR1/ABCB1 gene mutation (collies, Aussies, shelties) — can cause severe neurological toxicity. |
| Pancrelipase | pancrelipase | various | powder | twice_daily | Pancreatic enzyme replacement (lipase, amylase, protease) for exocrine pancreatic insufficiency (EPI). Mixed directly into food with every meal. Also known as Viokase/Pancrezyme. |

---

## Pain / NSAID (9)

All NSAIDs have GI side effects (vomiting, diarrhea, ulceration) as their primary safety concern — directly impacts the app's poop tracking.

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Metacam | meloxicam | Boehringer Ingelheim | liquid | daily | Oxicam-class NSAID oral suspension for pain and inflammation from osteoarthritis and musculoskeletal disorders. Comes with calibrated dosing syringe. |
| Rimadyl | carprofen | Zoetis | chewable | daily, twice_daily | Propionic acid-class NSAID for pain and inflammation from osteoarthritis and post-surgical recovery. Available as chewable tablets and caplets. |
| Previcox | firocoxib | Boehringer Ingelheim | chewable | daily | Selective COX-2 inhibitor NSAID for osteoarthritis pain and postoperative pain from soft tissue and orthopedic surgery. |
| Deramaxx | deracoxib | Elanco | chewable | daily | COX-2 selective NSAID for osteoarthritis, orthopedic surgery, and dental surgery pain. Flexible dosing — lower for chronic OA, higher for short-term post-surgical. |
| Onsior | robenacoxib | Elanco | tablet | daily | Highly selective COX-2 inhibitor NSAID that concentrates at inflammation sites. For OA pain (unlimited duration) and post-op soft tissue surgery pain (max 3 days). |
| Galliprant | grapiprant | Elanco | tablet | daily | EP4 prostaglandin receptor antagonist for osteoarthritis pain and inflammation. Does not inhibit COX enzymes. Targeted mechanism may offer different safety profile than traditional NSAIDs. |
| Librela | bedinvetmab | Zoetis | injection | monthly | Anti-NGF monoclonal antibody injection for osteoarthritis pain. Administered at vet clinic. FDA approved May 2023. GI side effects (vomiting, diarrhea) reported in adverse event data. |
| Gabapentin | gabapentin | generic | capsule | twice_daily, three_times_daily, four_times_daily | Anticonvulsant used off-label for chronic and neuropathic pain. Often used as adjunct alongside NSAIDs for multimodal pain management. Also commonly used for anxiety. |
| Tramadol | tramadol | generic | tablet | twice_daily, three_times_daily, four_times_daily | Synthetic opioid for moderate to moderately severe pain. Used as part of multimodal pain management. Controlled substance. |

---

## Steroid (1)

| Name | Generic | Manufacturer | Form | Intervals | Description |
|---|---|---|---|---|---|
| Prednisone | prednisone | generic | tablet | daily, twice_daily, every_other_day | Broad corticosteroid and immunosuppressant. Used across many conditions: allergies, IBD, immune-mediated disease. Taper required when discontinuing. Significant side effects with long-term use (increased thirst, appetite, urination). |

---

## Summary

**Total: 52 medications across 5 categories**

| Category | Count | Why included |
|---|---|---|
| Allergy | 6 | Direct — controls itching, major GI side effects |
| Parasite | 21 | Routine monthly meds, some cause GI upset |
| GI | 15 | Direct — treats digestive issues |
| Pain/NSAID | 9 | GI side effects are #1 safety concern with NSAIDs |
| Steroid | 1 | Used for both allergies and GI (IBD) |

**Not in catalog (use free-text):** anxiety, cardiac, thyroid, seizure, antibiotic, urinary, and any other medications. The routine editor's existing free-text medication field covers these.

**New dosage_form value:** `collar` added for Seresto.

---

## Future: Correlation Engine Integration

Medications are the #1 confounding variable in food → poop/itch correlation. The structured `category` field tells us what each medication impacts:

| Category | Confounds |
|---|---|
| gi | poop scores |
| pain (NSAIDs) | poop scores (GI side effects) |
| allergy | itch scores |
| steroid | both poop and itch |
| parasite | poop scores (some cause GI upset) |

Enhancements:
- [ ] Flag feeding periods where medications started/stopped — add caveat to correlation results ("medication changed during this period")
- [ ] Optionally exclude medication-change periods from correlation calculations to avoid false attributions
- [ ] Surface medication timeline alongside poop/itch score charts so users can visually spot medication-driven changes

---

## Build Steps

- [ ] Create `scraper/data/medications.json` seed file from tables above
- [ ] Schema changes: new enums (`medication_category`, `dosage_form`, `dosing_interval`) + `medication_products` table + modify `medications` table
- [ ] `yarn db:generate` + migration
- [ ] Update `build.py` to load medications seed data
- [ ] Update routine editor UI to use medication picker (with fallback to free-text for unlisted meds)
- [ ] Add digestiveImpact + itchinessImpact columns to medications table (reuse existing impact enum)
- [ ] Show impact assessment prompt when stopping a medication (setting endDate)
- [ ] Display impact badges on medication cards in routine view
