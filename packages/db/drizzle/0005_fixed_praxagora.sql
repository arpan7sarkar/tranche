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
ALTER TABLE "sandbox_maintenance" ADD CONSTRAINT "sandbox_maintenance_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;