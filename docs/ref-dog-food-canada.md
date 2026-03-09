# Canadian Dog Food Brands — Scraper Reference

Last updated: 2026-03-09

## Scraper Status

| Brand | Products | Channel | Ingredients | GA | Calories | Status |
|-------|----------|---------|-------------|-----|----------|--------|
| Royal Canin | 153 | retail+vet | 100% | 100% | 100% | Done |
| Purina | 196 | retail+vet | 100% | 97% | 97% | Done |
| Hill's | 148 | retail+vet | 100% | 100% | 100% | Done |
| Go! Solutions | 43 | retail | 100% | 100% | 100% | Done |
| Now Fresh | 22 | retail | 100% | 100% | 100% | Done |
| Taste of the Wild | 21 | retail | 100% | 100% | 100% | Done |
| FirstMate | 53 | retail | 100% | 100% | 100% | Done |
| Canadian Naturals | 20 | retail | 100% | 100% | 100% | Done |
| Nutrience | 76 | retail | 100% | 93% | 92% | Done |
| Rayne | 24 | vet | 100% | 50% | 100% | Done (static GA lookup) |
| Acana + Orijen | 60 | retail | 100% | 100% | 100% | Done |
| Open Farm | 129 | retail | 100% | 91% | 93% | Done |
| Blue Buffalo | 163 | retail | 100% | 100% | 77% | Done |
| Performatrin | 84 | retail | 100% | 100% | 95% | Done |
| Iams | 23 | retail | 100% | 100% | 100% | Done |
| Authority | 45 | retail | 100% | 100% | 100% | Done |
| Pedigree | 29 | retail | 100% | 100% | 100% | Done |
| Nutro | 46 | retail | 100% | 100% | 100% | Done |
| Wellness | 72 | retail | 100% | 100% | 100% | Done |
| Stella & Chewy's | 42 | retail | 100% | 100% | 100% | Done |
| Merrick | 59 | retail | 100% | 100% | 100% | Done |
| Farmina | 15 | vet | 100% | 100% | 100% | Done |

**Total scraped:** 1,528 products (100% with ingredients, 98% GA, 96% calories)

---

## Brand Quick Reference

Each scraper file (`scrapers/{brand}.py`) contains the full parsing details. This section captures site architecture and gotchas that aren't obvious from code.

### Big 3

| Brand | Site | Stack | Discovery | Key Notes |
|-------|------|-------|-----------|-----------|
| Royal Canin | `royalcanin.com/ca` | REST API | POST facets endpoint | All JSON, no HTML parsing. API key in header. |
| Purina | `purina.ca` | Gatsby + Drupal | Pantheon search API | 8 products use static fallback (DentaLife, ALPO, FortiFlora, etc). 5 vet supplements missing GA/calories (by design). |
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

### Manufacturer Sites

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
