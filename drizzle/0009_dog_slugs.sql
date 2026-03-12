ALTER TABLE "dogs" ADD COLUMN "slug" text;--> statement-breakpoint

UPDATE "dogs" SET "slug" = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z ]+', '', 'g'), ' +', '-', 'g'));--> statement-breakpoint

ALTER TABLE "dogs" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "idx_dogs_owner_slug" ON "dogs" USING btree ("owner_id","slug");
