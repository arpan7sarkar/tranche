CREATE TABLE "sandbox_allocation" (
	"id" integer PRIMARY KEY NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"committed_cents" integer DEFAULT 0 NOT NULL,
	"consumed_calls" integer DEFAULT 0 NOT NULL,
	"held_calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sandbox_single_allocation" CHECK ("sandbox_allocation"."id" = 1),
	CONSTRAINT "sandbox_money_limit" CHECK ("sandbox_allocation"."reserved_cents" >= 0 AND "sandbox_allocation"."committed_cents" >= 0 AND "sandbox_allocation"."reserved_cents" + "sandbox_allocation"."committed_cents" <= 100),
	CONSTRAINT "sandbox_call_limit" CHECK ("sandbox_allocation"."consumed_calls" >= 0 AND "sandbox_allocation"."held_calls" >= 0 AND "sandbox_allocation"."consumed_calls" + "sandbox_allocation"."held_calls" <= 50)
);
--> statement-breakpoint
CREATE TABLE "sandbox_approval" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"attempt" integer NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_approval_attempt" UNIQUE("operation_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "sandbox_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"operation_id" uuid,
	"kind" text NOT NULL,
	"claim_token" uuid,
	"dispatched" integer DEFAULT 0 NOT NULL,
	"outcome" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_browser_wait" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"expected_alias" text NOT NULL,
	"artifact_key" uuid NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_commitment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"allocation_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"cents" integer NOT NULL,
	"committed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sandbox_principal" CHECK ("sandbox_commitment"."cents" BETWEEN 0 AND 100 AND "sandbox_commitment"."committed" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "sandbox_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"semantic_key" text NOT NULL,
	"spec" jsonb NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"claim_until" timestamp with time zone,
	"fee_committed" integer DEFAULT 0 NOT NULL,
	"held_calls" integer DEFAULT 0 NOT NULL,
	"recovery_reads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sandbox_operation_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "sandbox_operation_semantic_key_unique" UNIQUE("semantic_key")
);
--> statement-breakpoint
CREATE TABLE "sandbox_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"allocation_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_approval" ADD CONSTRAINT "sandbox_approval_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_attempt" ADD CONSTRAINT "sandbox_attempt_run_id_sandbox_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_attempt" ADD CONSTRAINT "sandbox_attempt_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_browser_wait" ADD CONSTRAINT "sandbox_browser_wait_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_commitment" ADD CONSTRAINT "sandbox_commitment_allocation_id_sandbox_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."sandbox_allocation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_operation" ADD CONSTRAINT "sandbox_operation_run_id_sandbox_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sandbox_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_operation" ADD CONSTRAINT "sandbox_operation_commitment_id_sandbox_commitment_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."sandbox_commitment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_run" ADD CONSTRAINT "sandbox_run_allocation_id_sandbox_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."sandbox_allocation"("id") ON DELETE no action ON UPDATE no action;