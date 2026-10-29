CREATE TABLE "notification_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"deal_id" uuid NOT NULL,
	"action_id" uuid,
	"side" text NOT NULL,
	"recipient_id" text NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"link_expires_at" timestamp with time zone NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_job_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "notification_job" ADD CONSTRAINT "notification_job_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;