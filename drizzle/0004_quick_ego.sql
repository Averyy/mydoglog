CREATE TYPE "public"."product_format" AS ENUM('dry', 'wet');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "format" "public"."product_format";--> statement-breakpoint
-- Populate format from old type values
UPDATE "products" SET "format" = CASE "type"::text
  WHEN 'dry_food' THEN 'dry'
  WHEN 'wet_food' THEN 'wet'
  WHEN 'freeze_dried' THEN 'dry'
  WHEN 'whole_food' THEN 'dry'
  WHEN 'treat' THEN 'dry'
  WHEN 'supplement' THEN 'dry'
  WHEN 'probiotic' THEN 'dry'
  WHEN 'topper' THEN 'wet'
END::product_format;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "format" SET NOT NULL;--> statement-breakpoint
-- Migrate type enum
ALTER TYPE "public"."product_type" RENAME TO "product_type_old";--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('food', 'treat', 'supplement');--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "type" TYPE "public"."product_type" USING (
  CASE "type"::text
    WHEN 'dry_food' THEN 'food'
    WHEN 'wet_food' THEN 'food'
    WHEN 'freeze_dried' THEN 'food'
    WHEN 'whole_food' THEN 'food'
    WHEN 'treat' THEN 'treat'
    WHEN 'supplement' THEN 'supplement'
    WHEN 'probiotic' THEN 'supplement'
    WHEN 'topper' THEN 'supplement'
  END
)::product_type;--> statement-breakpoint
DROP TYPE "public"."product_type_old";
