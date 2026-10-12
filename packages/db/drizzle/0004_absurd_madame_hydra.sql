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
ALTER TABLE "sandbox_buyer_change" ADD CONSTRAINT "sandbox_buyer_change_operation_id_sandbox_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."sandbox_operation"("id") ON DELETE no action ON UPDATE no action;