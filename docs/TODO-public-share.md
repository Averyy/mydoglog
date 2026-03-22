# TODO: Public Share Link

**Priority:** Lightweight read-only sharing. Full multi-user pack access is a separate future feature (see `TODO-sharing.md`).

## Overview

Generate a public link for a dog that gives anyone read-only access to all pages — food, insights, compare, log feed. No authentication required. All edit/log UI is hidden via context, and API routes already reject unauthenticated writes via `requireDogOwnership`.

## Schema

Add to `dogs` table:

| Column | Type | Notes |
|---|---|---|
| `share_token` | text | Nullable. Presence = public link active. nanoid or uuid. |

## Routing

Single catch-all route: `/share/[token]/[...path]`

- Validates token against `dogs.share_token`
- Looks up the dog, provides dog context to child pages
- Renders the **same page components** as the authenticated app
- Wrapped in a `PublicViewProvider` that exposes `isPublicView: true`
- Layout has nav links pointing to `/share/[token]/food`, `/share/[token]/insights`, etc.
- No log FAB, no settings link, no edit actions in nav

### Route mapping

| Public route | Renders same component as |
|---|---|
| `/share/[token]` | `[slug]` homepage (log feed) |
| `/share/[token]/food` | `[slug]/food` |
| `/share/[token]/insights` | `[slug]/insights` |
| `/share/[token]/compare` | `[slug]/compare` |

## Context

```tsx
const PublicViewContext = createContext({ isPublicView: false })
```

Components check `isPublicView` to hide:
- Log FAB / quick-log grid
- Edit/delete buttons on log entries
- Routine editor actions
- Food transition controls
- Dog settings link
- Any create/write UI

This is cosmetic only. Security comes from API auth — `requireDogOwnership` rejects all writes without a valid session.

## API

### New endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/dogs/[id]/share` | Generate `share_token`, return public URL |
| `DELETE` | `/api/dogs/[id]/share` | Null out `share_token`, kill the link |
| `GET` | `/api/share/[token]` | Look up dog by token, return dog data for public layout |

### Existing endpoints

Read-only API routes (GET) used by the public pages need a parallel auth path:
- Accept either a valid session (existing) OR a valid share token (new)
- Write endpoints (POST/PUT/DELETE) remain session-only — no changes needed

## Dog Settings UI

- **Share section**: toggle to enable/disable public link
- When enabled: show the URL with a copy button
- When disabled: link immediately stops working

## What this does NOT include

- Multi-user editing (pack access) — separate TODO
- Invite system — separate TODO
- Expiring links — token is permanent until revoked
- Caching/revalidation — can add later if traffic warrants it
