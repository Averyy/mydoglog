# Sharing & Pack Access

## Concept

- **Pack** = all users who can access a dog. Flat, no roles — everyone can do everything.
- **Invite link** = how you join a pack. Owner texts it, recipient signs up/logs in, clicks link, joins.
- **Public share link** = unauthenticated read-only view of a dog's logs/scorecard.
- Last member cannot be removed from a pack (prevents orphaned dogs).

## Schema Changes

### New: `pack_members` table
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| dogId | uuid | FK → dogs.id, cascade delete |
| userId | text | FK → user.id, cascade delete |
| joinedAt | timestamp | default now() |
| **unique** | | (dogId, userId) |

### Modify: `dogs` table
- Remove `ownerId` column (replaced by pack_members)
- Add `shareToken` column (uuid, nullable) — presence = public link active

### Migration
- Backfill: insert a `pack_members` row for each existing dog's `ownerId`
- Then drop `ownerId`

## API Changes

### Auth helper
- `requireDogOwnership()` → `requirePackAccess()` — checks `pack_members` for (dogId, userId)

### New endpoints
| Method | Route | Description |
|---|---|---|
| POST | `/api/dogs/[id]/invite` | Generate invite code |
| DELETE | `/api/dogs/[id]/invite` | Revoke active invite |
| POST | `/api/join/[code]` | Accept invite, add to pack |
| GET | `/api/dogs/[id]/pack` | List pack members |
| DELETE | `/api/dogs/[id]/pack/[userId]` | Remove member (block if last) |
| POST | `/api/dogs/[id]/share` | Toggle public share link |
| GET | `/api/share/[token]` | Public read-only dog data |

## UI Changes

### Dog settings page
- **Pack section**: list members, remove button, invite link generator
- **Public link section**: toggle on/off, copy link

### Public share route (`/share/[token]`)
- Unauthenticated, read-only, single-dog view
- No settings page, no action grid
- Homepage-style layout but for one dog: dog info header + recent logs/food/insights inline
- Reuses same data-display components as the app, just without create/edit controls
- 1 hour revalidate cache (stats generation is heavy)

## Constraints
- Cannot remove the last pack member
- Invite codes are single-use with 1-week expiry
- Public share token is a UUID; nulling it kills the link
- All existing log/food/routine routes just swap to `requirePackAccess()`
