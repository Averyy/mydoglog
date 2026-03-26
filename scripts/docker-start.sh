#!/bin/sh
set -e

echo "Waiting for database..."
sleep 3

echo "Checking database connection..."
until psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; do
  echo "Database not ready, waiting..."
  sleep 2
done
echo "Database connected!"

echo "Running database migrations..."
MIGRATION_ERRORS=0
for migration in $(ls drizzle/*.sql 2>/dev/null | sort); do
  echo "Applying migration: $migration"
  OUTPUT=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$migration" 2>&1) || true
  # Filter out expected "already exists" noise, flag anything else
  UNEXPECTED=$(echo "$OUTPUT" | grep -i "ERROR" | grep -iv "already exists\|duplicate\|cannot drop.*does not exist\|does not exist" || true)
  if [ -n "$UNEXPECTED" ]; then
    echo "WARNING: Unexpected errors in $migration:"
    echo "$UNEXPECTED"
    MIGRATION_ERRORS=$((MIGRATION_ERRORS + 1))
  fi
done
if [ "$MIGRATION_ERRORS" -gt 0 ]; then
  echo "WARNING: $MIGRATION_ERRORS migration(s) had unexpected errors (see above)"
fi

echo "Seeding product and medication data..."
python3 /app/scraper/seed_db.py

echo "Starting Next.js server..."
exec node server.js
