CREATE TABLE "event_cursor" (
	"consumer" text PRIMARY KEY NOT NULL,
	"last_event_id" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"agency_mandate" jsonb NOT NULL,
	"client_mandate" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiation_turn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negotiation_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"offer" jsonb,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"to" text NOT NULL,
	"provider_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposed_action_id" uuid NOT NULL,
	"side" text NOT NULL,
	"decision" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_proposedActionId_unique" UNIQUE("proposed_action_id")
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"paypal_vault_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"agency_policy" jsonb,
	"client_policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"deal_id" uuid,
	"milestone_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"check_index" integer,
	"passed" boolean,
	"summary" text NOT NULL,
	"data" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"mechanism" text NOT NULL,
	"paypal_order_id" text NOT NULL,
	"paypal_capture_id" text,
	"paypal_authorization_id" text,
	"original_authorized_at" timestamp with time zone,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
	"message" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "magic_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_link_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"criteria" jsonb NOT NULL,
	"payees" jsonb NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"held_minor" bigint DEFAULT 0 NOT NULL,
	"released_minor" bigint DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"release_authorized_at" timestamp with time zone,
	"start_date" date,
	"end_date" date,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposed_action_id" uuid,
	"scheduled_action_id" uuid,
	"kind" text NOT NULL,
	"request" jsonb NOT NULL,
	"request_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "outbox_requestId_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"payee" jsonb NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"paypal_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposed_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reasoning" text NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	CONSTRAINT "proposed_action_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "scheduled_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"duration_days" integer NOT NULL,
	"start_date" date NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependency" (
	"from_task_id" uuid NOT NULL,
	"to_task_id" uuid NOT NULL,
	CONSTRAINT "task_dependency_from_task_id_to_task_id_pk" PRIMARY KEY("from_task_id","to_task_id")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"paypal_merchant_id" text,
	"paypal_onboarding" text DEFAULT 'not_started' NOT NULL,
	"rate_card" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	CONSTRAINT "workspace_member_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "negotiation" ADD CONSTRAINT "negotiation_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_turn" ADD CONSTRAINT "negotiation_turn_negotiation_id_negotiation_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."negotiation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_proposed_action_id_proposed_action_id_fk" FOREIGN KEY ("proposed_action_id") REFERENCES "public"."proposed_action"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold" ADD CONSTRAINT "hold_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link" ADD CONSTRAINT "magic_link_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link" ADD CONSTRAINT "magic_link_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_proposed_action_id_proposed_action_id_fk" FOREIGN KEY ("proposed_action_id") REFERENCES "public"."proposed_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_scheduled_action_id_scheduled_action_id_fk" FOREIGN KEY ("scheduled_action_id") REFERENCES "public"."scheduled_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_hold_id_hold_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."hold"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_action" ADD CONSTRAINT "proposed_action_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_action" ADD CONSTRAINT "scheduled_action_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_from_task_id_task_id_fk" FOREIGN KEY ("from_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_to_task_id_task_id_fk" FOREIGN KEY ("to_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "negotiation_turn_negotiation_id_round_side_index" ON "negotiation_turn" USING btree ("negotiation_id","round","side");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_kind_ref_index" ON "notification" USING btree ("kind","ref");--> statement-breakpoint
CREATE INDEX "deal_workspace_id_status_index" ON "deal" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "event_deal_id_id_index" ON "event" USING btree ("deal_id","id");--> statement-breakpoint
CREATE INDEX "evidence_milestone_id_created_at_index" ON "evidence" USING btree ("milestone_id","created_at");--> statement-breakpoint
CREATE INDEX "hold_milestone_id_index" ON "hold" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "hold_status_expires_at_index" ON "hold" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_source_source_event_id_index" ON "inbox" USING btree ("source","source_event_id");--> statement-breakpoint
CREATE INDEX "inbox_processed_at_index" ON "inbox" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_deal_id_key_index" ON "milestone" USING btree ("deal_id","key");--> statement-breakpoint
CREATE INDEX "milestone_state_index" ON "milestone" USING btree ("state");--> statement-breakpoint
CREATE INDEX "outbox_status_next_attempt_at_index" ON "outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "proposed_action_status_created_at_index" ON "proposed_action" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "proposed_action_deal_id_index" ON "proposed_action" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "scheduled_action_status_due_at_index" ON "scheduled_action" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_deal_id_key_index" ON "task" USING btree ("deal_id","key");