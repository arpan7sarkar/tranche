CREATE TABLE "sandbox_payment" (
	"commitment_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"context" jsonb NOT NULL,
	"remaining_calls" integer NOT NULL,
	"result" jsonb NOT NULL,
	"readiness_at" timestamp with time zone,
	CONSTRAINT "sandbox_payment_calls" CHECK ("sandbox_payment"."remaining_calls" BETWEEN 0 AND 50)
);
--> statement-breakpoint
ALTER TABLE "sandbox_payment" ADD CONSTRAINT "sandbox_payment_commitment_id_sandbox_commitment_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."sandbox_commitment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_payment" ADD CONSTRAINT "sandbox_payment_run_id_sandbox_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_run"("id") ON DELETE no action ON UPDATE no action;