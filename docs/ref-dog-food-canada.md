# Canadian Dog Food Brands — Scraper Reference

Last updated: 2026-03-10

## Scraper Status

| Brand | Products | Channel | Ingredients | GA | Calories | Status |
|-------|----------|---------|-------------|-----|----------|--------|
| Royal Canin | 154 | retail+vet | 100% | 100% | 100% | Done |
| Purina (Vet) | 48 | vet | 100% | 90% | 90% | Done |
| Purina (Retail) | 97 | retail | 100% | 99% | 99% | Done |
| Hill's | 142 | retail+vet | 100% | 100% | 100% | Done |
| Go! Solutions | 43 | retail | 100% | 100% | 100% | Done |
| Now Fresh | 22 | retail | 100% | 100% | 100% | Done |
| Taste of the Wild | 21 | retail | 100% | 100% | 100% | Done |
| FirstMate | 46 | retail | 100% | 100% | 100% | Done |
| Canadian Naturals | 20 | retail | 100% | 100% | 100% | Done |
| Nutrience | 81 | retail | 100% | 94% | 94% | Done |
| Rayne | 24 | vet | 100% | 71% | 100% | Done (static GA lookup) |
| Acana + Orijen | 73 | retail | 100% | 100% | 100% | Done |
| Open Farm | 107 | retail | 100% | 97% | 94% | Done |
| Blue Buffalo | 163 | retail | 100% | 100% | 82% | Done |
| Performatrin | 97 | retail | 100% | 100% | 90% | Done |
| Iams | 21 | retail | 100% | 100% | 100% | Done |
| Authority | 44 | retail | 100% | 100% | 100% | Done |
| Pedigree | 30 | retail | 100% | 100% | 100% | Done |
| Nutro | 46 | retail | 100% | 100% | 100% | Done |
| Wellness | 73 | retail | 100% | 100% | 100% | Done |
| Stella & Chewy's | 42 | retail | 100% | 100% | 100% | Done |
| Merrick | 59 | retail | 100% | 100% | 100% | Done |
| Farmina | 15 | vet | 100% | 100% | 100% | Done |
| Simply Nourish | 59 | retail | 100% | 100% | 100% | Done |
| Natural Balance | 51 | retail | 100% | 100% | 100% | Done |
| Instinct | 37 | retail | 100% | 100% | 100% | Done |
| Nulo | 33 | retail | 100% | 100% | 100% | Done |
| Canidae | 15 | retail | 100% | 100% | 100% | Done |
| Eukanuba | 8 | retail | 100% | 100% | 100% | Done |
| Kirkland Signature | 10 | retail | 100% | 100% | 100% | Done |
| Rachael Ray Nutrish | 36 | retail | 100% | 100% | 100% | Done |

**Total scraped:** 1,717 products (100% with ingredients, 99% GA, 97% calories)

---

## Brand Quick Reference

Each scraper file (`scrapers/{brand}.py`) contains the full parsing details. This section captures site architecture and gotchas that aren't obvious from code.

### Big 3

| Brand | Site | Stack | Discovery | Key Notes |
|-------|------|-------|-----------|-----------|
| Royal Canin | `royalcanin.com/ca` | REST API | POST facets endpoint | All JSON, no HTML parsing. API key in header. |
| Purina (Vet) | `purina.ca` | Gatsby + Drupal | Pantheon search API | Vet-channel products only (PPVD, FortiFlora). 5 supplements missing GA/calories (by design). |
| Purina (Retail) | `petsmart.ca` | Next.js RSC | Multi-brand filter URL | 7 sub-brands (Pro Plan, ONE, Beneful, Beyond, DentaLife, Beggin', Dog Chow/Puppy Chow). Single scrape via brand filter. |
| Hill's | `hillspet.ca` | Adobe Experience Manager | Sitemap XML | US site fallback for missing data. 36 products use static fallback. Sub-brands: Prescription Diet (vet), Science Diet (retail). |

### Retail

| Brand | Site | Stack | Key Notes |
|-------|------|-------|-----------|
| Go! Solutions | `go-solutions.com/en-ca` | Next.js + Contentful | compositeList expansion for vitamin blocks. Same Petcurean platform as Now Fresh. |
| Now Fresh | `nowfresh.com/en-ca` | Next.js + Contentful | Same parsing as Go! |
| Taste of the Wild | `tasteofthewildpetfood.com` | WordPress | Word-boundary regex for type detection (`\bwet\b` prevents "Wetlands" match). |
| FirstMate | `firstmate.com` | WooCommerce | Product sitemap discovery. Cat filter on URL slug. |
| Canadian Naturals | `canadiannaturals.com` | WordPress | GA in `<ul>` list items (not table). Dedup by product name. |
| Nutrience | `nutrience.com` | WooCommerce | 5 products missing GA, 6 missing calories (supplements/treats). |
| Acana + Orijen | `homesalive.ca` | Magento | Brand sites are bot-protected — scraped via retailer. |
| Open Farm | `openfarmpet.com` | Shopify + HTML | Shopify API for metadata, full HTML for ingredients. 11 missing GA, 9 missing calories (bundles, supplements, broths). |
| Blue Buffalo | `bluebuffalo.com/en-ca` | Episerver | Canadian sitemap. JS variables for ingredients/GA. 36 treats missing calories. |
| Performatrin | `petvalu.ca` | Next.js + Contentful | Pet Valu house brand. GA is plain-text `<br>` lines (not table). |

### Vet-Only

| Brand | Site | Stack | Key Notes |
|-------|------|-------|-----------|
| Rayne | `raynenutrition.com` | Shopify | GA from static lookup (InDesign diet pages). Novel proteins: kangaroo, rabbit, crocodilian, BSFL. 12 missing GA (DIAG products by design, treats/rolls use g/1000kcal only). |
| Authority | `petsmart.ca` | Next.js RSC + JSON-LD | PetSmart private-label. Discovery via XML sitemaps (listing page is unreliable). RSC flight payloads for nutritional data. |
| Iams | `petsmart.ca` | Next.js RSC + JSON-LD | iams.ca has nutritional data as images — PetSmart has text. Same parsing as Authority. |
| Farmina | `farmina.com/ca` | PHP SSR | Vet Life canine only (15 products). AJAX listing via POST to `a_prodotti_eshop.php` (Referer + X-Requested-With). GA can be in `div.text1`, `div.text2`, or `div.etichetta`. Calories embedded in GA paragraph or separate "energy value" section. |

### PetSmart.ca RSC Pattern

| Brand | Key Notes |
|-------|-----------|
| Pedigree | ~29 products. Same RSC parsing as Authority/Iams. |
| Nutro | ~46 products. nutro.ca has nutrition as images — PetSmart has text. |
| Wellness | ~72 products. Simple LID (~6 dry) not on PetSmart, accepted as known gap. |
| Stella & Chewy's | ~42 products. Discovery via `/featured-brands/stella-and-chewys?page=N`. |
| Simply Nourish | ~59 products. PetSmart private label. |
| Natural Balance | ~51 products. Manufacturer site has ingredients as images — PetSmart only viable source. LID line relevant for digestive tracking. |
| Instinct | ~37 products. Canadian subset. |
| Nulo | ~33 products. 3 products with manual data (2 missing GA, 1 missing calories). |
| Canidae | ~15 products. canidae.com uses BigCommerce + Vue.js (client-side rendered). 1 manual calorie override. |
| Eukanuba | ~8 products. No featured-brands page — uses search. 1 manual GA/calorie override. |

### Manufacturer Sites

| Brand | Site | Stack | Key Notes |
|-------|------|-------|-----------|
| Rachael Ray Nutrish | `nutrish.com` | WordPress SSR | Bootstrap accordions. Discovery via product sitemap. 36 products. 2 discontinued (Big Life) auto-skipped, 9 variety packs skipped. |

### Grocery / Mass-Market

| Brand | Site | Stack | Key Notes |
|-------|------|-------|-----------|
| Kirkland Signature | `costco.com` | SSR HTML | Diamond-manufactured. costco.ca is JS SPA with PDFs — US pages have identical formulas as plain text. 10 products, 1 manual (biscuits from packaging). |

| Brand | Site | Stack | Key Notes |
|-------|------|-------|-----------|
| Merrick | `merrickpetcare.com/canada` | Drupal 11 SSR | Canada catalog at `/canada/dog-food?page=N`. JSON-LD ItemList for discovery, product data in `<h3>` sections. GA in inline or list format. 59 products. |

---

## Not Yet Scraped

See `docs/todo-new-sources.md` for investigation status and scraper plans.

---

## MyVetStore Reference

MyVetStore (`myvetstore.ca`) is not scrapable (ASP.NET, all APIs 401, clinic-specific). Manual product dump from Wilson's Animal Hospital saved in `docs/ref-mar2026-myvetstore-pricing.md`.

Used as ground truth to verify Big 3 scraper completeness — every product at the vet store should exist in our DB.
