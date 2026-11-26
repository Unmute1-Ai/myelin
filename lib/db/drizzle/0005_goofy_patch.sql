CREATE TYPE "public"."pilot_proposal_status" AS ENUM('pending', 'executed', 'declined');--> statement-breakpoint
CREATE TABLE "pilot_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"invite_id" uuid,
	"contact_method" text NOT NULL,
	"contact_value" text NOT NULL,
	"captions_enabled" boolean DEFAULT true NOT NULL,
	"text_size" text_size DEFAULT 'medium' NOT NULL,
	"aac_input_enabled" boolean DEFAULT false NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"consent_to_participate" boolean NOT NULL,
	"consent_to_learning_data" boolean NOT NULL,
	"data_flow_disclosure" text NOT NULL,
	"consent_version" text NOT NULL,
	"source" text DEFAULT 'invite_code' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_enrollments_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "pilot_enrollments_participation_consented" CHECK ("pilot_enrollments"."consent_to_participate" IS TRUE),
	CONSTRAINT "pilot_enrollments_disclosure_recorded" CHECK (length("pilot_enrollments"."data_flow_disclosure") > 0)
);
--> statement-breakpoint
CREATE TABLE "pilot_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"issued_by" uuid,
	"note" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_invites_code_unique" UNIQUE("code"),
	CONSTRAINT "pilot_invites_code_not_empty" CHECK (length("pilot_invites"."code") > 0)
);
--> statement-breakpoint
CREATE TABLE "pilot_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"status" "pilot_proposal_status" DEFAULT 'pending' NOT NULL,
	"check_line" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposed_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pilot_enrollments" ADD CONSTRAINT "pilot_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_enrollments" ADD CONSTRAINT "pilot_enrollments_invite_id_pilot_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."pilot_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_invites" ADD CONSTRAINT "pilot_invites_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_invites" ADD CONSTRAINT "pilot_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_proposals" ADD CONSTRAINT "pilot_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_proposals" ADD CONSTRAINT "pilot_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pilot_proposals_status_created_idx" ON "pilot_proposals" USING btree ("status","created_at");