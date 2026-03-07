# Dog Data Export/Import

## Purpose

Sync a dog's full data between dev and prod databases via JSON file. Export from one environment, import into another. This is a dev tool, not a user-facing backup feature.

## Export Format

```typescript
interface DogExportData {
  version: 1
  exportedAt: string // ISO timestamp
  dog: {
    name: string
    breed: string | null
    birthDate: string | null
    weightKg: string | null
    location: string | null
    postalCode: string | null
    notes: string | null
  }
  feedingPeriods: Array<{
    productId: string
    productName: string   // human readability
    brandName: string     // human readability
    startDate: string
    endDate: string | null
    mealSlot: string | null
    quantity: string | null
    quantityUnit: string | null
    planGroupId: string   // preserved — scorecards link via this
    planName: string | null
    isBackfill: boolean
    approximateDuration: string | null
    notes: string | null
    createdAt: string
    updatedAt: string
  }>
  treatLogs: Array<{...}>       // productId + productName + brandName + date fields
  foodScorecards: Array<{...}>  // planGroupId + all scorecard fields
  poopLogs: Array<{...}>        // date + firmnessScore + color + urgency + notes
  itchinessLogs: Array<{...}>   // date + score + bodyAreas + notes
  symptomLogs: Array<{...}>     // date + type + severity + notes
  vomitLogs: Array<{...}>       // date + type + timeSinceMeal + notes
  accidentalExposures: Array<{...}> // date + description + ingredientIds + notes
  medications: Array<{...}>     // name + dosage + startDate + endDate + reason + notes
}
```

**Excluded from export:**
- `id` fields (regenerated on import)
- `dogId` fields (assigned to new/existing dog on import)
- `photoUrl` fields (URLs won't be valid cross-environment)
- `pollenLogs` (location-based, not dog-specific)

**Included for readability but not used on import:**
- `productName` and `brandName` on feedingPeriods and treatLogs

## Export API

`GET /api/dogs/[id]/export`

- Auth: `requireDogOwnership(id)` (same pattern as all dog routes)
- Queries all 9 child tables in parallel (independent reads)
- feedingPeriods + treatLogs joined with products/brands for names
- foodScorecards fetched via planGroupId IN (...) from feedingPeriods
- Returns JSON with `Content-Disposition: attachment; filename="{name}-export.json"`

## Import API

`POST /api/dogs/import`

- Auth: `auth.api.getSession` (no dog ownership check — creating/replacing)
- Validates `version === 1` and required fields
- Pre-validates all `productId` references exist in products table. Returns 400 with list of missing product names if any are absent (products must be loaded via build.py first)
- Wrapped in `db.transaction()`:
  1. If dog with same name exists for this user → delete it (cascade handles all child records)
  2. Insert dog with `ownerId = session.user.id`
  3. Insert all child records with new dogId
  4. Preserve `planGroupId` values (scorecard linkage)
  5. Preserve `createdAt`/`updatedAt` timestamps (timeline integrity)
- Returns `{ dogId, name }` with status 201

## UI

On the Settings page (`/settings`):
- **Export button** per dog — fetches blob, triggers download via temporary `<a>` element
- **Import button** — hidden `<input type="file" accept=".json">`, reads file, POSTs to import endpoint, refreshes page

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/dog-transfer.ts` | `DogExportData` type definition |
| `src/app/api/dogs/[id]/export/route.ts` | Export endpoint |
| `src/app/api/dogs/import/route.ts` | Import endpoint |

Modify `src/app/(app)/settings/settings-client.tsx` to add export/import buttons.

## Key Assumptions

- Product IDs are identical across dev and prod (both loaded by the same `build.py` from the same brand JSONs)
- Import is destructive — same-name dog gets deleted and recreated, not merged
- No conflict resolution needed — this is a one-way sync tool
