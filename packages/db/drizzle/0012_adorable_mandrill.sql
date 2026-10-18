CREATE TABLE "agent_event_receipt" (
	"consumer" text NOT NULL,
	"event_id" bigint NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_event_receipt_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
ALTER TABLE "agent_event_receipt" ADD CONSTRAINT "agent_event_receipt_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;