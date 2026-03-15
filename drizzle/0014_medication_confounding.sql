ALTER TABLE "medication_products" ADD COLUMN "suppresses_itch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "medication_products" ADD COLUMN "has_gi_side_effects" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "suppresses_itch" boolean;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "has_gi_side_effects" boolean;
