CREATE TYPE "public"."ingredient_category" AS ENUM('protein', 'carb', 'fat', 'fiber', 'vitamin', 'mineral', 'additive');--> statement-breakpoint
CREATE TYPE "public"."ingredient_form" AS ENUM('raw', 'meal', 'by_product', 'fat', 'oil', 'hydrolyzed', 'flour', 'bran', 'protein_isolate', 'starch', 'fiber', 'gluten');--> statement-breakpoint
CREATE TYPE "public"."ingredient_source_group" AS ENUM('poultry', 'red_meat', 'fish', 'grain', 'legume', 'root', 'fruit', 'dairy', 'egg', 'other', 'additive', 'fiber', 'vegetable', 'seed');--> statement-breakpoint
CREATE TYPE "public"."itchiness_impact" AS ENUM('better', 'no_change', 'worse');--> statement-breakpoint
CREATE TYPE "public"."meal_slot" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."medication_reason" AS ENUM('itchiness', 'digestive', 'other');--> statement-breakpoint
CREATE TYPE "public"."palatability" AS ENUM('loved', 'ate', 'reluctant', 'refused');--> statement-breakpoint
CREATE TYPE "public"."poop_color" AS ENUM('brown', 'dark_brown', 'black', 'red', 'orange', 'yellow', 'green', 'grey', 'white_spots');--> statement-breakpoint
CREATE TYPE "public"."primary_reason" AS ENUM('bad_poop', 'vomiting', 'gas', 'itchiness', 'refused_to_eat', 'too_expensive', 'other');--> statement-breakpoint
CREATE TYPE "public"."product_channel" AS ENUM('retail', 'vet', 'seed');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('dry_food', 'wet_food', 'treat', 'topper', 'supplement', 'probiotic', 'freeze_dried', 'whole_food');--> statement-breakpoint
CREATE TYPE "public"."quantity_unit" AS ENUM('can', 'cup', 'g', 'scoop', 'piece', 'tbsp', 'tsp', 'ml');--> statement-breakpoint
CREATE TYPE "public"."symptom_severity" AS ENUM('mild', 'moderate', 'severe');--> statement-breakpoint
CREATE TYPE "public"."symptom_type" AS ENUM('gas', 'ear_issue', 'scooting', 'hot_spot', 'grass_eating', 'lethargy', 'appetite_change', 'coat_issue', 'other');--> statement-breakpoint
CREATE TYPE "public"."time_since_meal" AS ENUM('lt_30min', '1_2hr', '3_6hr', '6plus_hr', 'empty_stomach');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('up', 'mixed', 'down');--> statement-breakpoint
CREATE TYPE "public"."vomit_type" AS ENUM('vomiting', 'regurgitation', 'bile');--> statement-breakpoint
CREATE TYPE "public"."vomiting_freq" AS ENUM('none', 'occasional', 'frequent');--> statement-breakpoint
CREATE TABLE "accidental_exposures" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"date" date NOT NULL,
	"datetime" timestamp with time zone NOT NULL,
	"description" text,
	"ingredient_ids" text[],
	"free_text_ingredients" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"country" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "dogs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"breed" text,
	"birth_date" date,
	"weight_kg" numeric,
	"location" text,
	"postal_code" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeding_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"product_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"meal_slot" "meal_slot",
	"quantity" numeric,
	"quantity_unit" "quantity_unit",
	"plan_group_id" text NOT NULL,
	"plan_name" text,
	"is_backfill" boolean DEFAULT false NOT NULL,
	"approximate_duration" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_scorecards" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_group_id" text NOT NULL,
	"poop_quality" integer[],
	"vomiting" "vomiting_freq",
	"palatability" "palatability",
	"digestive_impact" "itchiness_impact",
	"itchiness_impact" "itchiness_impact",
	"verdict" "verdict",
	"primary_reason" "primary_reason",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient_cross_reactivity" (
	"id" text PRIMARY KEY NOT NULL,
	"group_name" text NOT NULL,
	"families" text[] NOT NULL,
	CONSTRAINT "ingredient_cross_reactivity_group_name_unique" UNIQUE("group_name")
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" text PRIMARY KEY NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" text[],
	"category" "ingredient_category",
	"family" text,
	"source_group" "ingredient_source_group",
	"form_type" "ingredient_form",
	"is_hydrolyzed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredients_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "itchiness_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"date" date NOT NULL,
	"datetime" timestamp with time zone,
	"score" integer NOT NULL,
	"body_areas" text[],
	"photo_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"name" text NOT NULL,
	"dosage" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"reason" "medication_reason",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pollen_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"location" text NOT NULL,
	"date" date NOT NULL,
	"pollen_index" numeric,
	"pollen_types" jsonb,
	"source_api" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poop_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"date" date NOT NULL,
	"datetime" timestamp with time zone,
	"firmness_score" integer NOT NULL,
	"color" "poop_color",
	"urgency" boolean,
	"photo_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_ingredients" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"ingredient_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "uq_product_ingredient" UNIQUE("product_id","ingredient_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "product_type",
	"channel" "product_channel",
	"lifestage" text,
	"health_tags" text[],
	"raw_ingredient_string" text,
	"guaranteed_analysis" jsonb,
	"calorie_content" text,
	"image_urls" text[],
	"manufacturer_url" text,
	"variants_json" jsonb,
	"scraped_from" text,
	"scraped_at" timestamp with time zone,
	"is_discontinued" boolean DEFAULT false NOT NULL,
	"discontinued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_product_name_brand" UNIQUE("name","brand_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "symptom_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"date" date NOT NULL,
	"datetime" timestamp with time zone,
	"type" "symptom_type",
	"severity" "symptom_severity",
	"photo_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treat_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"product_id" text NOT NULL,
	"date" date NOT NULL,
	"datetime" timestamp with time zone,
	"quantity" numeric,
	"quantity_unit" "quantity_unit",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "vomit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"date" date NOT NULL,
	"datetime" timestamp with time zone,
	"type" "vomit_type",
	"time_since_meal" time_since_meal,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accidental_exposures" ADD CONSTRAINT "accidental_exposures_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dogs" ADD CONSTRAINT "dogs_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeding_periods" ADD CONSTRAINT "feeding_periods_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeding_periods" ADD CONSTRAINT "feeding_periods_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itchiness_logs" ADD CONSTRAINT "itchiness_logs_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poop_logs" ADD CONSTRAINT "poop_logs_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symptom_logs" ADD CONSTRAINT "symptom_logs_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treat_logs" ADD CONSTRAINT "treat_logs_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treat_logs" ADD CONSTRAINT "treat_logs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vomit_logs" ADD CONSTRAINT "vomit_logs_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exposures_dog_date" ON "accidental_exposures" USING btree ("dog_id","date");--> statement-breakpoint
CREATE INDEX "idx_dogs_owner" ON "dogs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_feeding_periods_dog" ON "feeding_periods" USING btree ("dog_id");--> statement-breakpoint
CREATE INDEX "idx_feeding_periods_plan_group" ON "feeding_periods" USING btree ("dog_id","plan_group_id");--> statement-breakpoint
CREATE INDEX "idx_feeding_periods_dog_start_created" ON "feeding_periods" USING btree ("dog_id","start_date","created_at");--> statement-breakpoint
CREATE INDEX "idx_food_scorecards_plan_group" ON "food_scorecards" USING btree ("plan_group_id");--> statement-breakpoint
CREATE INDEX "idx_ingredient_normalized_name" ON "ingredients" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "idx_itchiness_logs_dog_date" ON "itchiness_logs" USING btree ("dog_id","date");--> statement-breakpoint
CREATE INDEX "idx_medications_dog" ON "medications" USING btree ("dog_id");--> statement-breakpoint
CREATE INDEX "idx_pollen_logs_location_date" ON "pollen_logs" USING btree ("location","date");--> statement-breakpoint
CREATE INDEX "idx_poop_logs_dog_date" ON "poop_logs" USING btree ("dog_id","date");--> statement-breakpoint
CREATE INDEX "idx_product_ingredients_product" ON "product_ingredients" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_product_name" ON "products" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_product_brand" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "idx_symptom_logs_dog_date" ON "symptom_logs" USING btree ("dog_id","date");--> statement-breakpoint
CREATE INDEX "idx_treat_logs_dog_date" ON "treat_logs" USING btree ("dog_id","date");--> statement-breakpoint
CREATE INDEX "idx_vomit_logs_dog_date" ON "vomit_logs" USING btree ("dog_id","date");