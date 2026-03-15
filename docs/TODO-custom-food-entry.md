# TODO: Custom Food Entry

## Goal

Allow users to manually enter products that aren't in the scraped database. Covers raw diets, home-cooked meals, local/niche brands, and any product not yet scraped.

## Schema

- New `custom_products` table (or extend `products` with an `is_custom` flag + `owner_id`)
- Fields: `name`, `brand` (free text), `type` (dry/wet/raw/freeze-dried/dehydrated), `ingredients` (free text), `guaranteed_analysis` (optional structured: protein/fat/fiber/moisture), `calories_per_kg` (optional), `owner_id`
- Custom products are private to the user who created them

## Ingredient Parsing

- Parse free-text ingredient list into individual ingredients on save
- Attempt to match each ingredient to existing `ingredients` table (AAFCO family lookup via `ingredient_families.json`)
- Unmatched ingredients stored as-is with `family = null` — still tracked but won't participate in family-level correlation until manually mapped
- No ingredient normalization UI needed initially — just best-effort matching

## UI

- "Can't find your product?" link in product search → custom entry form
- Fields: name (required), brand (optional), type (required), ingredients (required, textarea), GA (optional, 4 fields), calories (optional)
- Custom products appear in product search alongside scraped products (tagged as "Custom")
- Editable after creation (user's own products only)

## Correlation

- Custom products with parsed ingredients participate fully in the correlation engine
- Unmatched ingredients get their own correlation entries (ingredient-level, not family-level)

## API

- `POST /api/custom-products` — create custom product
- `GET /api/custom-products` — list user's custom products
- `PUT /api/custom-products/[id]` — edit
- `DELETE /api/custom-products/[id]` — delete (only if no feeding periods reference it)

## Notes

- This replaces the previously-skipped "Custom food builder" — scope is simpler (data entry, not recipe building)
- No photo upload for custom products initially
- No sharing of custom products between users
