CREATE TABLE "sandbox_onboarding" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"seller_key" text NOT NULL,
	"tracking_key" text NOT NULL,
	"referral_id" text,
	"artifact_key" uuid,
	"evidence" jsonb,
	"check_until" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	CONSTRAINT "sandbox_onboarding_seller_key_unique" UNIQUE("seller_key"),
	CONSTRAINT "sandbox_onboarding_tracking_key_unique" UNIQUE("tracking_key")
);
--> statement-breakpoint
ALTER TABLE "sandbox_onboarding" ADD CONSTRAINT "sandbox_onboarding_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;