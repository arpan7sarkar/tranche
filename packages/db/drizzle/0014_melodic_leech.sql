ALTER TABLE "negotiation" ADD COLUMN "base_plan" jsonb;--> statement-breakpoint
ALTER TABLE "negotiation" ADD COLUMN "base_plan_version" text;--> statement-breakpoint
ALTER TABLE "negotiation" ADD COLUMN "start_date" date;--> statement-breakpoint
CREATE UNIQUE INDEX "negotiation_one_open_per_deal" ON "negotiation" USING btree ("deal_id") WHERE "negotiation"."status" = 'open';