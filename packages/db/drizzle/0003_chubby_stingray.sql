CREATE TABLE "sandbox_referral_recovery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"referral_id" text NOT NULL,
	"approval_hash" text NOT NULL,
	"state" text NOT NULL,
	"claim_token" uuid,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	CONSTRAINT "sandbox_referral_recovery_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
ALTER TABLE "sandbox_referral_recovery" ADD CONSTRAINT "sandbox_referral_recovery_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;