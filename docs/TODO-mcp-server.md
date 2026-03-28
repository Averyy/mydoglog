# TODO: MCP Server

Remote MCP server for MyDogLog, allowing Claude.ai (and other MCP clients) to query and interact with a user's dog health data via authenticated tools.

## Technical Stack

| Component | Package | Role |
|---|---|---|
| MCP SDK | `@modelcontextprotocol/sdk` v1.28+ | Server, transport, tool registration |
| Transport | `WebStandardStreamableHTTPServerTransport` | Streamable HTTP (fits Next.js App Router natively) |
| Auth (AS) | `@better-auth/oauth-provider` v1.5+ | Turns Better Auth into OAuth 2.1 authorization server |
| JWT | `better-auth/plugins` jwt | Signed access tokens with `sub` = user ID |
| Auth (RS) | DIY token validation in route handler | Verify JWT via JWKS, extract user ID, pass as `AuthInfo` |

## Auth Flow

```
Claude.ai                    MyDogLog
   │                            │
   ├─ POST /mcp ───────────►│ 401 + WWW-Authenticate header
   │                            │   resource_metadata="/.well-known/oauth-protected-resource"
   │                            │
   ├─ GET /.well-known/ ───────►│ { authorization_servers: ["https://mydoglog.ca"] }
   │    oauth-protected-resource│
   │                            │
   ├─ GET /.well-known/ ───────►│ { authorization_endpoint, token_endpoint, registration_endpoint }
   │    oauth-authorization-server
   │                            │
   ├─ POST /api/auth/ ─────────►│ Dynamic Client Registration (RFC 7591)
   │    oauth2/register         │   allowUnauthenticatedClientRegistration: true
   │                            │
   ├─ Browser redirect ────────►│ /api/auth/oauth2/authorize → login page → consent page
   │                            │   User logs in with email/password, grants scopes
   │                            │
   ├─ POST /api/auth/ ─────────►│ Exchange auth code for JWT (PKCE S256)
   │    oauth2/token            │   JWT sub claim = user.id
   │                            │
   ├─ POST /mcp ───────────►│ Bearer token validated → AuthInfo.extra.userId
   │  Authorization: Bearer JWT │   Tool handlers scope all queries by userId
   └────────────────────────────┘
```

## Per-User Data Scoping

JWT access tokens carry `sub` = `user.id` from the `user` table. The `/mcp` route handler:

1. Extracts Bearer token from `Authorization` header
2. Verifies JWT signature via JWKS endpoint
3. Validates `iss`, `aud`, `exp`
4. Reads `sub` as `userId`
5. Passes `{ ...authInfo, extra: { userId } }` to transport
6. Tool handlers access `ctx.http?.authInfo?.extra?.userId` and use it in all DB queries

## Auth Config Changes

```ts
// src/lib/auth.ts
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

export const auth = betterAuth({
  disabledPaths: ["/token"],  // avoid conflict with /oauth2/token
  plugins: [
    jwt({ disableSettingJwtHeader: true }),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/consent",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,  // MCP clients can't pre-register
      scopes: ["openid", "profile", "mydoglog:read"],
      validAudiences: ["https://mydoglog.ca/mcp"],
    }),
  ],
  // ... existing config
});
```

## New DB Tables (via Drizzle migration)

- `oauthClient` — registered OAuth clients (Claude, etc.)
- `oauthRefreshToken` — issued refresh tokens
- `oauthAccessToken` — opaque access tokens (JWT tokens not stored)
- `oauthConsent` — user consent records
- `jwks` — JSON Web Key Sets (private keys encrypted at rest)

## New Routes

| Route | Purpose |
|---|---|
| `app/.well-known/oauth-authorization-server/route.ts` | AS metadata (RFC 8414) |
| `app/.well-known/oauth-protected-resource/route.ts` | Protected resource metadata (RFC 9728) |
| `app/mcp/route.ts` | MCP endpoint (POST/GET/DELETE) — `mydoglog.ca/mcp` |
| `app/(auth)/consent/page.tsx` | OAuth consent screen (uses login page shell — BrandMark, same card layout, auth-page styling) |

## MCP Endpoint (`/mcp`)

Stateless mode (single VPS, no session map needed):

```ts
// app/mcp/route.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

function createServer(): McpServer {
  const server = new McpServer({ name: "mydoglog", version: "1.0.0" });
  // register tools...
  return server;
}

export async function POST(req: Request) {
  const authInfo = await validateMcpToken(req);  // JWT verify via JWKS
  if (!authInfo) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer resource_metadata="/.well-known/oauth-protected-resource"' },
    });
  }

  // Stateless: new transport + server per request
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(req, { authInfo, parsedBody: await req.json() });
}

export async function GET(req: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await createServer().connect(transport);
  return transport.handleRequest(req);
}

export async function DELETE(req: Request) {
  return new Response(null, { status: 405 });  // no sessions to terminate in stateless mode
}
```

## Tools (4 total, all read-only)

All tools return raw structured data for the LLM to analyze. The MCP server is a data pipe — it never interprets, summarizes, or draws conclusions. All tools are scoped to the authenticated user via JWT `sub` claim. Dog resolution is implicit — if the user has one dog, it's used automatically. If multiple, `dogName` disambiguates or data for all dogs is returned.

### `get_health_data`

The core tool. Date-ranged health data export for a user's dog(s).

| Param | Type | Default |
|---|---|---|
| `dogName` | `string?` | auto if single dog |
| `startDate` | `string?` | 30 days ago |
| `endDate` | `string?` | today |
| `sections` | `string[]?` | all sections |

**Available sections** (4 groups, maps internally to `ExportSection` types):

| Section | Contains |
|---|---|
| `overview` | Dog profile, current diet (products + quantities + ingredients + GA), active supplements, active medications (dosage, interval, drug class, side effects, confounding flags) |
| `daily_logs` | Per-day rows: poop entries (score, time, note), itch entries (score, time, body areas, note), effective pollen level, food names, active meds, transition flag |
| `product_history` | Feeding periods (products, quantities, dates, duration, scorecard ranges, avg poop/itch from logs, avg pollen, high pollen day %, active meds, treats, transition info). Past medications with start/end dates. Medication change events (avg poop/itch before vs after each start/stop). |
| `analysis` | Raw `CorrelationResult` — per-ingredient scores (`IngredientScore`: key, dayCount, weightedPoopScore, weightedItchScore, rawAvgPoopScore, rawAvgItchScore, badDayCount, goodDayCount, confidence, positionCategory, confounding flags, cross-reactivity warnings, form breakdowns, on/off-med score splits). Cross-reactivity groups. Pollen buckets (days, avg poop, avg itch per pollen level). Body area frequency (area, percent). Constant ingredients. |

**Example usage by Claude:**
- "Give me an update" → `sections: ["daily_logs"]`, last 7 days
- "Prepare for my vet" → all sections, last 3-6 months
- "Is his food working?" → `sections: ["daily_logs", "analysis"]`, last 30 days
- "What's he eating?" → `sections: ["overview"]`

**Data source:** Date-ranged version of `export-llm.ts` — the existing LLM export restructured to accept a date window and optional section filter.

### `search_products`

Search the product + medication database.

| Param | Type | Default |
|---|---|---|
| `query` | `string` | required |
| `type` | `"food" \| "treat" \| "supplement" \| "medication"?` | all types |
| `channel` | `"retail" \| "vet"?` | all channels |
| `format` | `"dry" \| "wet"?` | all formats |

**Returns:** Matching products/medications with id, name, brand, type, format, channel, calorie content.

**Data source:** `products` table for food/treat/supplement, `medicationProducts` table for medications. Unified search interface.

### `get_product_details`

Full raw data for a specific product or medication.

| Param | Type |
|---|---|
| `productId` | `string` (required) |

**Returns for food/treat/supplement:** Full ordered ingredient list (normalized name, position, category, source group, form type), guaranteed analysis percentages, calorie content, health tags, brand, format, channel, discontinued status.

**Returns for medication:** Generic name, manufacturer, category, dosage form, common side effects, itch suppression flag, GI side effect flag, sources/learn more URLs.

**Data source:** Detects product vs medication from ID and queries the appropriate table with full joins.

### `find_alternatives`

Raw scored alternatives from the ranking engine.

| Param | Type |
|---|---|
| `productId` | `string` (required) |

**Returns:** Ranked alternatives with scores (overall, ingredient match, nutrition compatibility), cross-reactivity flags, ingredient overlap details, brand, format, channel. Raw numbers — the LLM cross-references against the dog's correlation data from `get_health_data`.

**Data source:** `src/lib/alternatives/engine.ts` — existing alternatives ranking engine. Only applies to food/treat/supplement (not medications).

## Implementation Notes

### Output format

All tools return **markdown**, not JSON. The existing `export-llm.ts` already renders optimized markdown for LLM consumption — compact, token-efficient, with tables for dense data. Keep this pattern for all tools.

### Consent page

`app/(auth)/consent/page.tsx` — same shell as the login page (BrandMark, centered card, `auth-page` / `auth-card` classes). Shows:
- Which app is requesting access (client name from OAuth registration, e.g. "Claude")
- Requested scopes in plain language (e.g. "Read your dog's health data")
- Approve / Deny buttons
- User must already be logged in (redirect to `/login` first if not)

### Deployment

No infra changes. New npm packages (`@modelcontextprotocol/sdk`, `@better-auth/oauth-provider`) are added via `yarn add` and included in the existing Docker build. The 5 new DB tables are created via Drizzle migration, run automatically by `docker-start.sh` on deploy.

### Future: write tools

Not in scope now, but the auth setup supports adding write tools later (e.g. "log a poop score", "add a treat") without any auth changes — just new tool registrations and a `mydoglog:write` scope.
