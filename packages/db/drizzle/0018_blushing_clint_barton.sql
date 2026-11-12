CREATE TABLE "gmail_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connected_by" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"google_subject" text NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_connection_workspaceId_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "sender_identity" text;--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "notification_job" ADD COLUMN "sender_identity" text;--> statement-breakpoint
ALTER TABLE "gmail_connection" ADD CONSTRAINT "gmail_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_connection" ADD CONSTRAINT "gmail_connection_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;