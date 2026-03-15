# Multi-stage build for Next.js production
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN yarn next build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy drizzle SQL migration files
COPY --from=builder /app/drizzle ./drizzle

# Install psql for migrations + python3/psycopg2 for DB seeding
RUN apk add --no-cache postgresql-client python3 py3-psycopg2

# Copy DB seeder and its data files (no scraper deps, no images)
COPY --from=builder /app/scraper/seed_db.py ./scraper/seed_db.py
COPY --from=builder /app/scraper/data/brands ./scraper/data/brands
COPY --from=builder /app/scraper/data/medications.json ./scraper/data/medications.json
COPY --from=builder /app/scraper/data/ingredient_families.json ./scraper/data/ingredient_families.json
COPY --from=builder /app/scraper/data/manual_products.json ./scraper/data/manual_products.json

COPY --from=builder /app/scripts/docker-start.sh ./docker-start.sh

USER nextjs

EXPOSE 3847
ENV PORT=3847
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "./docker-start.sh"]
