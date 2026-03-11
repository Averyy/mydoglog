-- Create new enums
CREATE TYPE "public"."medication_category" AS ENUM('allergy', 'parasite', 'gi', 'pain', 'steroid');--> statement-breakpoint
CREATE TYPE "public"."dosage_form" AS ENUM('tablet', 'chewable', 'capsule', 'liquid', 'injection', 'topical', 'spray', 'powder', 'granules', 'gel', 'collar');--> statement-breakpoint
CREATE TYPE "public"."dosing_interval" AS ENUM('four_times_daily', 'three_times_daily', 'twice_daily', 'daily', 'every_other_day', 'weekly', 'biweekly', 'monthly', 'every_6_weeks', 'every_8_weeks', 'every_12_weeks', 'every_3_months', 'every_6_months', 'every_8_months', 'annually', 'as_needed');--> statement-breakpoint

-- Create medication_products table
CREATE TABLE "medication_products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"generic_name" text NOT NULL,
	"manufacturer" text,
	"category" "medication_category" NOT NULL,
	"drug_class" text,
	"dosage_form" "dosage_form" NOT NULL,
	"default_intervals" dosing_interval[] NOT NULL,
	"description" text,
	"common_side_effects" text,
	"side_effects_sources" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medication_products_name_unique" UNIQUE("name")
);--> statement-breakpoint

-- Nuke existing medication records (will be re-added via new Meds page)
DELETE FROM medications;--> statement-breakpoint

-- Add new columns to medications
ALTER TABLE "medications" ADD COLUMN "medication_product_id" text;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "interval" "dosing_interval";--> statement-breakpoint

-- Add FK constraint
ALTER TABLE "medications" ADD CONSTRAINT "medications_medication_product_id_medication_products_id_fk" FOREIGN KEY ("medication_product_id") REFERENCES "public"."medication_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Drop reason column and enum
ALTER TABLE "medications" DROP COLUMN IF EXISTS "reason";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."medication_reason";
