ALTER TYPE "public"."quantity_unit" ADD VALUE 'treat';--> statement-breakpoint

-- Backfill nulls before adding NOT NULL constraints
UPDATE feeding_periods SET quantity = 1 WHERE quantity IS NULL;--> statement-breakpoint
UPDATE feeding_periods SET quantity_unit = 'g' WHERE quantity_unit IS NULL;--> statement-breakpoint
UPDATE treat_logs SET quantity = 1 WHERE quantity IS NULL;--> statement-breakpoint
UPDATE treat_logs SET quantity_unit = 'piece' WHERE quantity_unit IS NULL;--> statement-breakpoint

ALTER TABLE "feeding_periods" ALTER COLUMN "quantity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feeding_periods" ALTER COLUMN "quantity_unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "treat_logs" ALTER COLUMN "quantity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "treat_logs" ALTER COLUMN "quantity_unit" SET NOT NULL;
