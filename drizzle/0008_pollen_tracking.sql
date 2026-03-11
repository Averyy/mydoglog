-- Step 1: Add environmentEnabled column
ALTER TABLE "dogs" ADD COLUMN "environment_enabled" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- Step 2: Auto-enable for dogs with existing location data (before dropping location)
UPDATE "dogs" SET "environment_enabled" = true WHERE "location" IS NOT NULL AND "location" != '';--> statement-breakpoint

-- Step 3: Drop old columns from dogs
ALTER TABLE "dogs" DROP COLUMN IF EXISTS "location";--> statement-breakpoint
ALTER TABLE "dogs" DROP COLUMN IF EXISTS "postal_code";--> statement-breakpoint
ALTER TABLE "dogs" DROP COLUMN IF EXISTS "notes";--> statement-breakpoint

-- Step 4: Drop old pollen_logs table
DROP TABLE IF EXISTS "pollen_logs";--> statement-breakpoint

-- Step 5: Create daily_pollen table
CREATE TABLE IF NOT EXISTS "daily_pollen" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"provider" text NOT NULL,
	"location" text NOT NULL,
	"date" date NOT NULL,
	"pollen_level" integer NOT NULL,
	"spore_level" integer,
	"total_trees" integer,
	"total_grasses" integer,
	"total_weeds" integer,
	"top_allergens" jsonb,
	"source" text NOT NULL,
	"out_of_season" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_daily_pollen_provider_location_date" UNIQUE("provider","location","date")
);
