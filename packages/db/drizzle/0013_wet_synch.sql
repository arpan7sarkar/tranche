CREATE TABLE "evidence_image" (
	"evidence_id" uuid PRIMARY KEY NOT NULL,
	"base64" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_image" ADD CONSTRAINT "evidence_image_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;