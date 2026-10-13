CREATE TABLE "sandbox_buyer_change" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"source_spec" jsonb NOT NULL,
	"target_spec" jsonb NOT NULL,
	"approval_hash" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	CONSTRAINT "sandbox_buyer_change_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "sandbox_maintenance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"source_spec" jsonb NOT NULL,
	"target_context" jsonb,
	"order_id" text,
	"approval_hash" text NOT NULL,
	"state" text NOT NULL,
	"claim_token" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	CONSTRAINT "sandbox_maintenance_operation_id_unique" UNIQUE("operation_id")
);
--> statement-breakpoint
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
ALTER TABLE "sandbox_buyer_change" ADD CONSTRAINT "sandbox_buyer_change_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_maintenance" ADD CONSTRAINT "sandbox_maintenance_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_payment" ADD CONSTRAINT "sandbox_payment_commitment_id_sandbox_commitment_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."sandbox_commitment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_payment" ADD CONSTRAINT "sandbox_payment_run_id_sandbox_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_run"("id") ON DELETE no action ON UPDATE no action;